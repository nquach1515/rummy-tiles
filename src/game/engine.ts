/**
 * The game, run by the host. Each turn a player either rearranges the table (and must place at least one tile of
 * their own) or draws a tile. The first time a player places tiles in a round, those tiles must make new sets worth
 * at least `firstMeld` points by themselves, without touching the table. The first player to empty their rack wins
 * the round; the others lose what's left on their racks (a joker costs 30) and the winner gains it all.
 */
import { analyzeSet } from './rules';
import { fullSet, HIDDEN, rackPoints, randomInt, shuffle, Tile, tileOf } from './tiles';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const RACK_START = 14;

export type Phase = 'lobby' | 'playing' | 'roundEnd';

export interface Move {
  seat: number;
  kind: 'play' | 'draw' | 'pass' | 'timeout';
  /** tiles they put on the table */
  placed: string[];
  /** points of a first meld */
  meld?: number;
}

export interface RoundResult {
  winner: number;
  reason: 'out' | 'blocked';
  /** what each rack held when the round ended */
  racks: Tile[][];
  rackTotals: number[];
  /** change in each player's score */
  deltas: number[];
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface GameState {
  phase: Phase;
  players: number;
  pool: Tile[];
  hands: Tile[][];
  /** sets on the table, as tile ids in the order shown */
  table: string[][];
  melded: boolean[];
  turn: number;
  /** when the current turn runs out (ms since epoch), 0 for no limit */
  turnDeadline: number;
  round: number;
  /** who started the current round */
  starter: number;
  scores: number[];
  /** turns in a row that ended without anyone placing a tile, once the pool is empty */
  stuckTurns: number;
  firstMeld: number;
  lastMove: Move | null;
  result: RoundResult | null;
  log: LogEntry[];
  logSeq: number;
}

export function newGame(players = MAX_PLAYERS, firstMeld = 30): GameState {
  return {
    phase: 'lobby',
    players,
    pool: [],
    hands: Array.from({ length: players }, () => []),
    table: [],
    melded: Array(players).fill(false),
    turn: 0,
    turnDeadline: 0,
    round: 0,
    starter: -1,
    scores: Array(players).fill(0),
    stuckTurns: 0,
    firstMeld,
    lastMove: null,
    result: null,
    log: [],
    logSeq: 0,
  };
}

function log(s: GameState, text: string) {
  s.log = [...s.log.slice(-29), { id: ++s.logSeq, text }];
}

export function startRound(s: GameState, rand: (n: number) => number = randomInt) {
  const pool = shuffle(fullSet(), rand);
  s.hands = Array.from({ length: s.players }, () => pool.splice(0, RACK_START));
  s.pool = pool;
  s.table = [];
  s.melded = Array(s.players).fill(false);
  if (s.scores.length !== s.players) s.scores = Array(s.players).fill(0);
  s.round += 1;
  // a random player starts the first round, then it goes round the table
  s.starter = s.starter < 0 ? rand(s.players) : (s.starter + 1) % s.players;
  s.turn = s.starter;
  s.stuckTurns = 0;
  s.lastMove = null;
  s.result = null;
  s.phase = 'playing';
  log(s, `Round ${s.round}`);
}

export interface TurnCheck {
  error: string | null;
  /** ids of rack tiles the new table uses */
  placed: string[];
  /** indexes of rows that aren't valid sets */
  badSets: number[];
  /** a first meld's points (only counted before a player has melded) */
  meldPoints: number;
}

export interface TurnInput {
  oldTable: string[][];
  hand: string[];
  melded: boolean;
  firstMeld: number;
}

const key = (set: string[]) => [...set].sort().join(',');

/** Is this new table a legal end to the turn? Used by the host to enforce it and by the player's screen to explain. */
export function checkTurn(t: TurnInput, table: string[][]): TurnCheck {
  const out: TurnCheck = { error: null, placed: [], badSets: [], meldPoints: 0 };
  const fail = (error: string) => ({ ...out, error });
  if (!Array.isArray(table) || table.some((set) => !Array.isArray(set))) return fail('Bad table');
  const old = new Set(t.oldTable.flat());
  const hand = new Set(t.hand);
  const seen = new Set<string>();
  for (const id of table.flat()) {
    if (seen.has(id)) return fail('A tile is on the table twice');
    seen.add(id);
    if (!old.has(id) && !hand.has(id)) return fail('That tile isn’t yours');
    if (hand.has(id)) out.placed.push(id);
  }
  for (const id of old) if (!seen.has(id)) return fail('Tiles already on the table have to stay there');
  table.forEach((set, i) => {
    if (!analyzeSet(set.map(tileOf))) out.badSets.push(i);
  });
  if (out.placed.length === 0) return fail('Place at least one of your tiles, or draw');
  if (out.badSets.length) return fail(out.badSets.length === 1 ? 'One row isn’t a valid set yet' : `${out.badSets.length} rows aren’t valid sets yet`);
  if (!t.melded) {
    // the first meld: the table's sets stay as they were, and new sets are made from your own tiles only
    const oldKeys = new Map<string, number>();
    for (const set of t.oldTable) oldKeys.set(key(set), (oldKeys.get(key(set)) ?? 0) + 1);
    for (const set of table) {
      const k = key(set);
      const left = oldKeys.get(k) ?? 0;
      if (left > 0) {
        oldKeys.set(k, left - 1);
        continue;
      }
      if (set.some((id) => !hand.has(id))) return { ...fail('Your first meld has to be new sets of your own tiles; you can’t change the table yet'), placed: out.placed };
      out.meldPoints += analyzeSet(set.map(tileOf))!.points;
    }
    if (out.meldPoints < t.firstMeld) return fail(`Your first meld needs ${t.firstMeld} points (you have ${out.meldPoints})`);
  }
  return out;
}

export const turnInput = (s: GameState, seat: number): TurnInput => ({
  oldTable: s.table,
  hand: s.hands[seat].map((t) => t.id),
  melded: s.melded[seat],
  firstMeld: s.firstMeld,
});

/** Ends a turn by laying down this table. Returns an error, or null if it worked. */
export function commit(s: GameState, seat: number, table: string[][], name: (seat: number) => string): string | null {
  if (s.phase !== 'playing') return 'The round isn’t on';
  if (s.turn !== seat) return 'It’s not your turn';
  const check = checkTurn(turnInput(s, seat), table);
  if (check.error) return check.error;
  const placed = new Set(check.placed);
  s.hands[seat] = s.hands[seat].filter((t) => !placed.has(t.id));
  // show each valid set in its own order (a run reads low to high)
  s.table = table.map((set) => analyzeSet(set.map(tileOf))!.tiles.map((t) => t.id));
  const first = !s.melded[seat];
  s.melded[seat] = true;
  s.stuckTurns = 0;
  s.lastMove = { seat, kind: 'play', placed: check.placed, ...(first ? { meld: check.meldPoints } : {}) };
  const n = check.placed.length;
  log(s, first ? `${name(seat)} opened with ${check.meldPoints} points` : `${name(seat)} placed ${n} tile${n === 1 ? '' : 's'}`);
  if (s.hands[seat].length === 0) endRound(s, seat, 'out', name);
  else nextTurn(s);
  return null;
}

/** Ends a turn by drawing a tile (or, with the pool empty, passing). `timeout`: the turn ran out. */
export function draw(s: GameState, seat: number, name: (seat: number) => string, timeout = false): string | null {
  if (s.phase !== 'playing') return 'The round isn’t on';
  if (s.turn !== seat) return 'It’s not your turn';
  const tile = s.pool.shift();
  if (tile) {
    s.hands[seat].push(tile);
    s.stuckTurns = 0;
  } else s.stuckTurns += 1;
  s.lastMove = { seat, kind: timeout ? 'timeout' : tile ? 'draw' : 'pass', placed: [] };
  log(s, timeout ? `${name(seat)} ran out of time${tile ? ' and drew' : ''}` : tile ? `${name(seat)} drew a tile` : `${name(seat)} passed`);
  // nobody can play and the pool is empty: lowest rack wins
  if (s.pool.length === 0 && s.stuckTurns >= s.players) {
    const totals = s.hands.map((h) => h.reduce((t, x) => t + rackPoints(x), 0));
    let best = 0;
    for (let i = 1; i < s.players; i++) {
      if (totals[i] < totals[best] || (totals[i] === totals[best] && s.hands[i].length < s.hands[best].length)) best = i;
    }
    endRound(s, best, 'blocked', name);
  } else nextTurn(s);
  return null;
}

function nextTurn(s: GameState) {
  s.turn = (s.turn + 1) % s.players;
}

function endRound(s: GameState, winner: number, reason: RoundResult['reason'], name: (seat: number) => string) {
  const totals = s.hands.map((h) => h.reduce((t, x) => t + rackPoints(x), 0));
  const deltas = totals.map((t, i) => (i === winner ? 0 : -t));
  deltas[winner] = -deltas.reduce((t, x) => t + x, 0);
  s.scores = s.scores.map((sc, i) => sc + deltas[i]);
  s.result = { winner, reason, racks: s.hands.map((h) => [...h]), rackTotals: totals, deltas };
  s.phase = 'roundEnd';
  s.turnDeadline = 0;
  log(s, reason === 'out' ? `${name(winner)} went out and won round ${s.round}` : `No moves left: ${name(winner)} wins round ${s.round} with the lowest rack`);
}

/** A copy of the game as one seat may know it: other racks and the pool are blanked out (same sizes). */
export function redactFor(s: GameState, seat: number): GameState {
  const hide = (tiles: Tile[]) => tiles.map(() => ({ id: HIDDEN, color: null, n: -1 }) as Tile);
  return {
    ...s,
    pool: hide(s.pool),
    hands: s.hands.map((h, i) => (i === seat ? h.map((t) => ({ ...t })) : hide(h))),
    table: s.table.map((set) => [...set]),
    melded: [...s.melded],
    scores: [...s.scores],
    // the result shows every rack, but only once the round is over
    result: s.phase === 'roundEnd' ? s.result : null,
    log: [...s.log],
  };
}
