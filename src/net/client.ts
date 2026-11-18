import { HostController, NetStatus } from './host';
import { Action, ClientMsg, HostMsg, PlayerView } from './protocol';
import { roomUrl, watchSocket } from './relay';

/** What the UI talks to — either the in-browser host, or a remote host through the relay. */
export interface GameConnection {
  view(): PlayerView | null;
  status(): { state: NetStatus | 'rejected'; detail: string };
  send(action: Action): void;
  subscribe(fn: () => void): () => void;
  leave(): void;
}

export function getClientId(): string {
  try {
    let id = localStorage.getItem('rt-client-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('rt-client-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class LocalConnection implements GameConnection {
  private cached: PlayerView | null = null;
  private listeners = new Set<() => void>();
  constructor(public host: HostController) {
    host.subscribe(() => {
      this.cached = null;
      for (const fn of this.listeners) fn();
    });
  }
  view() {
    return (this.cached ??= this.host.viewFor(this.host.hostClientId));
  }
  status() {
    return { state: this.host.online ? this.host.status : ('online' as NetStatus), detail: this.host.statusDetail };
  }
  send(action: Action) {
    this.host.handle(this.host.hostClientId, action);
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  leave() {
    this.host.destroy();
  }
}

/** Moves worth sending again after a reconnect, and for how long. */
const RESENDABLE = new Set<Action['type']>(['commit', 'draw']);
const PENDING_MS = 30000;

export class RemoteConnection implements GameConnection {
  private current: PlayerView | null = null;
  private state: NetStatus | 'rejected' = 'connecting';
  private detail = 'Connecting…';
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private left = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watch: ReturnType<typeof watchSocket> | null = null;
  /** The last move you made (laying down tiles or drawing) and when: if the connection drops around then, it may never have
   *  reached the host, so it's sent again after reconnecting if the table shows it still hasn't happened. */
  private pending: { action: Action; at: number; handKey: string } | null = null;
  /** The relay said the host was away (or reconnecting) since our last view. */
  private hostWasAway = false;

  constructor(
    public code: string,
    private clientId: string,
    private name: string,
  ) {
    this.connect();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(state: NetStatus | 'rejected', detail: string) {
    this.state = state;
    this.detail = detail;
    this.emit();
  }

  private connect() {
    if (this.left) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomUrl(this.code, 'player'));
    } catch {
      this.retry(3000);
      return;
    }
    this.socket = ws;
    // A guest who is connected but hasn't heard from the host: the relay may still think a host is there whose own
    // connection died (often a host on mobile data), so try again rather than wait on "Connecting…" forever.
    let noView: ReturnType<typeof setTimeout> | null = null;
    let gotView = false;
    const watch = (this.watch = watchSocket(ws, () => {
      if (this.current) this.setStatus('connecting', 'Reconnecting…');
      lost(0);
    }));
    const lost = (code: number) => {
      watch.stop();
      if (noView) clearTimeout(noView);
      if (this.left || this.socket !== ws) return;
      this.socket = null; // a late close from this socket is ignored
      this.failures++;
      if (code === 4004 || code === 4003) {
        this.setStatus('error', this.current ? 'Host disconnected — waiting for them to come back…' : `No table found with code ${this.code}`);
        this.retry(this.current ? 3000 : 5000);
      } else if (code === 4001) {
        this.setStatus('connecting', 'Reconnecting to host…');
        this.retry(2000);
      } else {
        this.setStatus(this.failures > 2 ? 'error' : 'connecting', this.failures > 2 ? "Can't reach the game server — retrying…" : 'Reconnecting…');
        // straight away the first time (the network is usually fine again by now), then backing off
        this.retry(this.failures <= 1 ? 200 : Math.min(8000, 1000 * 2 ** Math.min(this.failures - 1, 3)));
      }
    };
    ws.onopen = () => {
      watch.heard();
      ws.send(JSON.stringify({ t: 'hello', clientId: this.clientId, name: this.name } satisfies ClientMsg));
      noView = setTimeout(() => {
        if (this.socket !== ws) return;
        this.setStatus('connecting', this.current ? 'Reconnecting to host…' : 'Waiting for the host…');
        try {
          ws.close();
        } catch {
          /* closing anyway */
        }
        lost(0);
      }, 8000);
    };
    ws.onmessage = (e) => {
      watch.heard();
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      const msg = JSON.parse(e.data) as HostMsg;
      if (msg.t === 'view') {
        if (noView) clearTimeout(noView);
        noView = null;
        this.failures = 0;
        const first = !gotView;
        gotView = true;
        this.current = msg.view;
        if (this.state !== 'online') this.setStatus('online', '');
        else this.emit();
        // a move made while the host was away never reached it: send it again now (the relay keeps us connected then)
        if (first || this.hostWasAway) this.resendPending(ws);
        this.hostWasAway = false;
      } else if (msg.t === 'hostAway') {
        // our connection is fine, the host is the one who's quiet: don't give up on this socket while we wait
        if (noView) clearTimeout(noView);
        noView = null;
        if (msg.away) this.hostWasAway = true;
        if (msg.away) this.setStatus('connecting', `Waiting for ${this.hostName()} — their app may be in the background`);
        else if (this.state !== 'online') this.setStatus('online', '');
      } else if (msg.t === 'reject') {
        this.left = true;
        this.setStatus('rejected', msg.reason);
      }
    };
    ws.onclose = (e) => lost(e.code);
  }

  private retry(ms: number) {
    if (this.left || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, ms);
  }

  view() {
    return this.current;
  }
  status() {
    return { state: this.state, detail: this.detail };
  }
  send(action: Action) {
    this.watch?.acting();
    if (RESENDABLE.has(action.type)) this.pending = { action, at: Date.now(), handKey: this.current?.hand.map((t) => t.id).join() ?? '' };
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ t: 'action', action } satisfies ClientMsg));
  }

  /** Just reconnected: send your last move again if it's recent and the table shows it still hasn't happened. */
  private resendPending(ws: WebSocket) {
    const p = this.pending;
    this.pending = null;
    const v = this.current;
    if (!p || !v || v.you === null || Date.now() - p.at > PENDING_MS || ws.readyState !== WebSocket.OPEN) return;
    // still your turn, with the same tiles on your rack as when you made the move: it never arrived
    const needed = v.phase === 'playing' && v.turn === v.you && p.handKey === v.hand.map((t) => t.id).join();
    if (needed) ws.send(JSON.stringify({ t: 'action', action: p.action } satisfies ClientMsg));
  }

  private hostName() {
    return this.current?.seats.find((s) => s?.isHost)?.name ?? 'the host';
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  leave() {
    this.left = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close(1000, 'left'); // a normal leave, so the relay doesn't count it as a lost connection
  }
}
