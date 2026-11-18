import { botTurn } from '../game/bot';
import { checkTurn, commit, draw, GameState, MAX_PLAYERS, MIN_PLAYERS, newGame, redactFor, startRound, turnInput } from '../game/engine';
import { isTileId, randomInt, sortTiles } from '../game/tiles';
import { Action, ClientMsg, DEFAULT_SETTINGS, HostMsg, PlayerView, Settings } from './protocol';
import { PlayerLink, roomUrl, watchSocket } from './relay';
import { reliableTimeout } from './timer';

export interface SeatInfo {
  clientId: string;
  name: string;
  isBot: boolean;
  online: boolean;
}

const BOT_NAMES = ['Ada', 'Bo', 'Cleo', 'Dex', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Lou', 'Mira', 'Nico', 'Odie', 'Pia', 'Rex', 'Sol', 'Tess', 'Vic'];
/** how long bots take over a turn (ms): long enough to see what they did */
const BOT_THINK = [900, 1700];

export type SaveSlot = 'table' | 'solo';
const SAVE_KEYS: Record<SaveSlot, string> = { table: 'rt-host-session', solo: 'rt-solo-session' };
const SAVE_DAYS = 7;

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

// Dev only: a running game keeps the rules it started with; reload fully instead of hot-swapping them.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

interface Saved {
  code: string;
  state: GameState;
  seats: (SeatInfo | null)[];
  settings?: Settings;
  savedAt: number;
}

export function loadSavedHost(slot: SaveSlot = 'table'): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEYS[slot]);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (Date.now() - saved.savedAt > SAVE_DAYS * 24 * 3600 * 1000) return null;
    if (slot === 'solo' && saved.state.phase === 'lobby') return null;
    return saved;
  } catch {
    return null;
  }
}

export function clearSavedHost(slot: SaveSlot = 'table') {
  try {
    localStorage.removeItem(SAVE_KEYS[slot]);
  } catch {
    /* ignore */
  }
}

export function randomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join('');
}

/** Runs the authoritative game in the host's browser and serves each player their own view. */
export class HostController {
  state: GameState;
  /** four seats in the lobby; once a game starts, exactly the players in it */
  seats: (SeatInfo | null)[];
  settings: Settings = { ...DEFAULT_SETTINGS };
  status: NetStatus = 'offline';
  statusDetail = '';
  private socket: WebSocket | null = null;
  private links = new Map<string, PlayerLink>();
  private conns = new Map<string, PlayerLink>();
  private errors = new Map<string, { id: number; text: string }>();
  private hints = new Map<string, { id: number; table: string[][] | null }>();
  private seq = 0;
  private emotes: { id: number; seat: number; emoji: string }[] = [];
  private draft: { seat: number; table: string[][]; turnKey: string } | null = null;
  private cancelTimer: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private destroyed = false;
  private botThinking: string | null = null;

  constructor(
    public code: string,
    public hostClientId: string,
    hostName: string,
    public online: boolean,
    saved?: Saved,
    settings?: Partial<Settings>,
  ) {
    this.settings = { ...this.settings, ...saved?.settings, ...settings };
    if (saved) {
      this.state = saved.state;
      this.seats = saved.seats.map((s) => (s ? { ...s, online: s.isBot || s.clientId === hostClientId } : null));
      // a turn timer restarts from full after a resume
      if (this.state.phase === 'playing' && this.state.turnDeadline) this.state.turnDeadline = Date.now() + this.settings.turnSeconds * 1000;
    } else {
      this.state = newGame(MAX_PLAYERS, this.settings.firstMeld);
      this.seats = [{ clientId: hostClientId, name: hostName, isBot: false, online: true }, null, null, null];
    }
    if (online) this.openRelay(0);
    this.pump();
  }

  // ---------- networking ----------

  private openRelay(attempt: number) {
    if (this.destroyed) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomUrl(this.code, 'host'));
    } catch {
      setTimeout(() => this.openRelay(attempt + 1), 3000);
      return;
    }
    this.socket = ws;
    const watch = watchSocket(ws, () => lost(0));
    const lost = (code: number) => {
      watch.stop();
      for (const link of this.links.values()) link.closed();
      this.links.clear();
      if (this.destroyed || this.socket !== ws) return;
      this.socket = null;
      this.status = 'error';
      if (code === 4000) {
        this.statusDetail = 'This table was opened in another tab';
        this.emit();
        return;
      }
      this.statusDetail = 'Lost connection to the server — retrying…';
      this.emit();
      setTimeout(() => this.openRelay(attempt + 1), attempt === 0 ? 200 : Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)));
    };
    ws.onopen = () => {
      watch.heard();
      this.status = 'online';
      this.statusDetail = '';
      attempt = 0;
      this.emit();
    };
    ws.onmessage = (e) => {
      watch.heard();
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let msg: { k: 'open' | 'msg' | 'close'; id: string; data?: unknown };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.k === 'open') {
        const link = new PlayerLink(msg.id, ws);
        this.links.set(msg.id, link);
        this.attach(link);
      } else if (msg.k === 'msg') this.links.get(msg.id)?.deliver(msg.data);
      else {
        this.links.get(msg.id)?.closed();
        this.links.delete(msg.id);
      }
    };
    ws.onclose = (e) => lost(e.code);
  }

  private attach(conn: PlayerLink) {
    let clientId: string | null = null;
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      if (msg?.t === 'hello' && typeof msg.clientId === 'string') {
        clientId = msg.clientId;
        if (!this.join(msg.clientId, String(msg.name ?? ''))) {
          conn.send({ t: 'reject', reason: this.state.phase === 'lobby' ? 'This table is full' : 'This game has already started' } satisfies HostMsg);
          setTimeout(() => conn.close(), 500);
          return;
        }
        const old = this.conns.get(msg.clientId);
        if (old && old !== conn) old.close();
        this.conns.set(msg.clientId, conn);
        this.changed();
      } else if (msg?.t === 'action' && clientId && msg.action && typeof msg.action === 'object') {
        this.handle(clientId, msg.action);
      }
    });
    conn.on('close', () => {
      if (clientId && this.conns.get(clientId) === conn) {
        this.conns.delete(clientId);
        const seat = this.seatOf(clientId);
        if (seat !== null) this.seats[seat]!.online = false;
        this.changed();
      }
    });
  }

  /** Seats a player (or re-seats a returning one). New players can only join in the lobby. */
  private join(clientId: string, name: string): boolean {
    const existing = this.seatOf(clientId);
    if (existing !== null) {
      const s = this.seats[existing]!;
      s.online = true;
      s.isBot = false;
      return true;
    }
    if (this.state.phase !== 'lobby') return false;
    const empty = this.seats.findIndex((s) => s === null);
    if (empty < 0) return false;
    this.seats[empty] = { clientId, name: name.trim().slice(0, 16) || 'Player', isBot: false, online: true };
    return true;
  }

  private seatOf(clientId: string): number | null {
    const i = this.seats.findIndex((s) => s?.clientId === clientId);
    return i >= 0 ? i : null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private changed() {
    for (const [clientId, conn] of this.conns) {
      if (conn.open) conn.send({ t: 'view', view: this.viewFor(clientId) } satisfies HostMsg);
    }
    this.persist();
    this.emit();
    this.pump();
  }

  private persist() {
    try {
      const saved: Saved = { code: this.code, state: this.state, seats: this.seats, settings: this.settings, savedAt: Date.now() };
      localStorage.setItem(SAVE_KEYS[this.online ? 'table' : 'solo'], JSON.stringify(saved));
    } catch {
      /* storage unavailable: resume just won't work */
    }
  }

  destroy() {
    this.destroyed = true;
    this.cancelTimer?.();
    this.socket?.close(1000, 'left');
    this.listeners.clear();
  }

  // ---------- actions ----------

  private name = (seat: number) => this.seats[seat]?.name ?? `Seat ${seat + 1}`;

  handle(clientId: string, action: Action) {
    const err = this.apply(clientId, action);
    if (err) this.errors.set(clientId, { id: ++this.seq, text: err });
    // a draft only changes what others watch: no need to save the game for it
    if (action.type === 'draft') this.broadcast(clientId);
    else this.changed();
  }

  /** After a draft: send the new view to everyone but the player arranging (their own screen is ahead already). */
  private broadcast(except: string) {
    for (const [clientId, conn] of this.conns) {
      if (clientId !== except && conn.open) conn.send({ t: 'view', view: this.viewFor(clientId) } satisfies HostMsg);
    }
    this.emit();
  }

  private turnKey() {
    const s = this.state;
    return `${s.round}:${s.logSeq}:${s.turn}`;
  }

  private apply(clientId: string, a: Action): string | null {
    const s = this.state;
    const seat = this.seatOf(clientId);
    const isHost = clientId === this.hostClientId;
    const lobby = s.phase === 'lobby';
    const inSeat = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < this.seats.length;
    switch (a.type) {
      case 'sit':
        if (!lobby || seat === null || !inSeat(a.seat)) return null;
        if (this.seats[a.seat]) return 'Seat taken';
        this.seats[a.seat] = this.seats[seat];
        this.seats[seat] = null;
        return null;
      case 'rename': {
        if (seat === null) return 'You are not seated';
        if (!lobby) return 'Names are locked once the game starts';
        const name = String(a.name ?? '').trim().slice(0, 16);
        if (!name) return 'Name can’t be empty';
        this.seats[seat]!.name = name;
        return null;
      }
      case 'addBot': {
        if (!isHost || !lobby) return 'Only the host can add bots';
        if (!inSeat(a.seat) || this.seats[a.seat]) return 'Seat taken';
        const used = new Set(this.seats.map((x) => x?.name));
        const free = BOT_NAMES.filter((n) => !used.has(n));
        const name = free.length ? free[randomInt(free.length)] : 'Bot';
        this.seats[a.seat] = { clientId: `bot-${a.seat}-${Date.now()}`, name, isBot: true, online: true };
        return null;
      }
      case 'removeSeat': {
        if (!isHost || !lobby || !inSeat(a.seat)) return null;
        const target = this.seats[a.seat];
        if (!target || target.clientId === this.hostClientId) return null;
        this.conns.get(target.clientId)?.close();
        this.conns.delete(target.clientId);
        this.seats[a.seat] = null;
        return null;
      }
      case 'botify': {
        if (!isHost || !inSeat(a.seat)) return null;
        const target = this.seats[a.seat];
        if (!target || target.clientId === this.hostClientId) return null;
        target.isBot = !target.isBot;
        target.online = true;
        return null;
      }
      case 'settings': {
        if (!isHost) return 'Only the host can change settings';
        const n = a.settings ?? {};
        const next = { ...this.settings };
        if ([0, 30].includes(n.firstMeld as number)) next.firstMeld = n.firstMeld!;
        if ([0, 60, 90, 120].includes(n.turnSeconds as number)) next.turnSeconds = n.turnSeconds!;
        if (['easy', 'normal', 'hard'].includes(n.difficulty as string)) next.difficulty = n.difficulty!;
        this.settings = next;
        if (lobby) s.firstMeld = next.firstMeld;
        return null;
      }
      case 'start': {
        if (!isHost || !lobby) return 'Only the host can start';
        const players = this.seats.filter((x): x is SeatInfo => x !== null);
        if (players.length < MIN_PLAYERS) return 'Need at least 2 players — add a bot';
        this.seats = players;
        this.state = newGame(players.length, this.settings.firstMeld);
        this.startRound();
        return null;
      }
      case 'nextRound':
        if (!isHost) return 'Waiting for the host';
        if (s.phase !== 'roundEnd') return null;
        this.startRound();
        return null;
      case 'newGame': {
        if (!isHost) return 'Waiting for the host';
        if (!this.online) {
          // a game against bots goes straight into a fresh game
          this.state = newGame(this.seats.length, this.settings.firstMeld);
          this.startRound();
          return null;
        }
        this.seats = [...this.seats, null, null, null, null].slice(0, MAX_PLAYERS);
        this.state = newGame(MAX_PLAYERS, this.settings.firstMeld);
        return null;
      }
      case 'emote':
        if (seat === null) return null;
        this.emotes = [...this.emotes.slice(-9), { id: ++this.seq, seat, emoji: String(a.emoji ?? '').slice(0, 4) }];
        return null;
    }
    if (seat === null) return 'You are not seated';
    switch (a.type) {
      case 'commit': {
        const err = commit(s, seat, a.table, this.name);
        if (!err) this.turnStarted();
        return err;
      }
      case 'draw': {
        const err = draw(s, seat, this.name);
        if (!err) this.turnStarted();
        return err;
      }
      case 'draft':
        if (s.phase !== 'playing' || s.turn !== seat) return null;
        if (a.table === null) {
          this.draft = null;
          return null;
        }
        if (!this.draftOk(seat, a.table)) return null;
        this.draft = { seat, table: a.table.map((r) => [...r]), turnKey: this.turnKey() };
        return null;
      case 'hint': {
        if (s.phase !== 'playing' || s.turn !== seat) return null;
        // the same move a hard bot would make in this seat
        this.hints.set(clientId, { id: ++this.seq, table: botTurn(redactFor(s, seat), seat, 'hard') });
        return null;
      }
    }
    return null;
  }

  /** A draft may only hold the table's tiles and the player's own, each once. */
  private draftOk(seat: number, table: unknown): boolean {
    if (!Array.isArray(table) || table.length > 60) return false;
    const allowed = new Set([...this.state.table.flat(), ...this.state.hands[seat].map((t) => t.id)]);
    const seen = new Set<string>();
    for (const row of table) {
      if (!Array.isArray(row)) return false;
      for (const id of row) {
        if (!isTileId(id) || !allowed.has(id) || seen.has(id)) return false;
        seen.add(id);
      }
    }
    return true;
  }

  private startRound() {
    startRound(this.state);
    this.turnStarted();
  }

  /** A new turn: clear the last player's draft and start the clock. */
  private turnStarted() {
    this.draft = null;
    this.hints.clear();
    const s = this.state;
    s.turnDeadline = s.phase === 'playing' && this.settings.turnSeconds ? Date.now() + this.settings.turnSeconds * 1000 : 0;
  }

  // ---------- clock: bots and the turn timer ----------

  private isBot(seat: number) {
    return !!this.seats[seat]?.isBot;
  }

  private pump() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    // whatever was scheduled (a bot's move, the turn clock) is scheduled again below
    this.botThinking = null;
    const s = this.state;
    if (s.phase !== 'playing' || this.destroyed) return;
    if (this.isBot(s.turn)) {
      const key = this.turnKey();
      if (this.botThinking === key) return;
      this.botThinking = key;
      const seat = s.turn;
      const delay = BOT_THINK[0] + Math.random() * (BOT_THINK[1] - BOT_THINK[0]);
      this.cancelTimer = reliableTimeout(() => {
        this.cancelTimer = null;
        this.botThinking = null;
        if (this.destroyed || this.turnKey() !== key || !this.isBot(seat)) return;
        // bots only ever see a redacted copy: other racks and the pool are blanked out
        const table = botTurn(redactFor(this.state, seat), seat, this.settings.difficulty);
        if (!table || commit(this.state, seat, table, this.name)) draw(this.state, seat, this.name);
        this.turnStarted();
        this.changed();
      }, delay);
      return;
    }
    if (s.turnDeadline) {
      const key = this.turnKey();
      this.cancelTimer = reliableTimeout(() => {
        this.cancelTimer = null;
        if (this.destroyed || this.turnKey() !== key || this.state.phase !== 'playing') return;
        const seat = this.state.turn;
        // time's up: what they've arranged stands if it's a legal move, otherwise it's put back and they draw
        const d = this.draft;
        const legal = d && d.turnKey === key && !checkTurn(turnInput(this.state, seat), d.table).error;
        if (!(legal && !commit(this.state, seat, d.table, this.name))) draw(this.state, seat, this.name, true);
        this.turnStarted();
        this.changed();
      }, Math.max(0, s.turnDeadline - Date.now()));
    }
  }

  // ---------- views ----------

  viewFor(clientId: string): PlayerView {
    const s = this.state;
    const you = this.seatOf(clientId);
    const lobby = s.phase === 'lobby';
    const draft = this.draft && this.draft.turnKey === this.turnKey() && s.phase === 'playing' ? { seat: this.draft.seat, table: this.draft.table } : null;
    return {
      roomCode: this.code,
      online: this.online,
      you,
      isHost: clientId === this.hostClientId,
      seats: this.seats.map((x, i) =>
        x
          ? {
              name: x.name,
              isBot: x.isBot,
              standIn: x.isBot && !x.clientId.startsWith('bot-'),
              isHost: x.clientId === this.hostClientId,
              online: x.online,
              tileCount: lobby ? 0 : s.hands[i]?.length ?? 0,
              melded: !lobby && !!s.melded[i],
              score: lobby ? 0 : s.scores[i] ?? 0,
            }
          : null,
      ),
      phase: s.phase,
      round: s.round,
      turn: s.turn,
      turnRemainingMs: s.turnDeadline ? Math.max(0, s.turnDeadline - Date.now()) : null,
      poolCount: s.pool.length,
      hand: you === null || lobby ? [] : sortTiles(s.hands[you] ?? [], 'color'),
      table: s.table,
      draft,
      firstMeld: s.firstMeld,
      lastMove: s.lastMove,
      result: s.phase === 'roundEnd' ? s.result : null,
      log: s.log,
      emotes: this.emotes,
      error: this.errors.get(clientId) ?? null,
      hint: this.hints.get(clientId) ?? null,
      settings: this.settings,
    };
  }
}
