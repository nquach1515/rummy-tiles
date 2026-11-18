/**
 * Bots. They only ever get a redacted game (redactFor): their own rack and the table.
 *
 * easy:   a first meld, then only new sets from its own rack
 * normal: also adds tiles onto the ends of runs and to groups
 * hard:   also rearranges the whole table when that places more tiles (an exact search over the table and the rack,
 *         with a node budget so a turn costs a few milliseconds)
 */
import { checkTurn, GameState, turnInput } from './engine';
import { analyzeSet } from './rules';
import { colorIndex, isJoker, Tile, tileOf } from './tiles';

export type Difficulty = 'easy' | 'normal' | 'hard';

const JOKER = 52;
const kindOf = (t: Tile) => (isJoker(t) ? JOKER : (t.n - 1) * 4 + colorIndex(t.color!));
const nOf = (k: number) => Math.floor(k / 4) + 1;
const cOf = (k: number) => k % 4;
const kindAt = (n: number, c: number) => (n - 1) * 4 + c;

/** Sets that start at kind k (their lowest real tile), as lists of kinds with JOKER for a joker, in shown order. */
const CANDIDATES: number[][][] = (() => {
  const out: number[][][] = [];
  for (let k = 0; k < 52; k++) {
    const n = nOf(k);
    const c = cOf(k);
    const list: number[][] = [];
    // runs of 3–5 (longer runs are made of these, and merged back afterwards)
    for (let lead = 0; lead <= 2 && n - lead >= 1; lead++) {
      for (let len = 3; len <= 5; len++) {
        const top = n - lead + len - 1;
        if (top > 13) continue;
        const after = len - lead - 1;
        // each place after the first real tile is the real tile or a joker
        for (let mask = 0; mask < 1 << after; mask++) {
          const set: number[] = Array(lead).fill(JOKER);
          set.push(k);
          for (let i = 0; i < after; i++) set.push(mask & (1 << i) ? JOKER : kindAt(n + i + 1, c));
          if (set.filter((x) => x === JOKER).length <= 2) list.push(set);
        }
      }
    }
    // groups of 3–4: this colour, some higher colours, jokers for the rest
    const higher = [0, 1, 2, 3].filter((x) => x > c);
    for (let mask = 0; mask < 1 << higher.length; mask++) {
      const real = [k, ...higher.filter((_, i) => mask & (1 << i)).map((x) => kindAt(n, x))];
      for (const size of [3, 4]) {
        const jokers = size - real.length;
        if (jokers < 0 || jokers > 2) continue;
        list.push([...real, ...Array(jokers).fill(JOKER)]);
      }
    }
    // fewer jokers first (they're worth keeping), then longer
    const jk = (s: number[]) => s.filter((x) => x === JOKER).length;
    list.sort((a, b) => jk(a) - jk(b) || b.length - a.length);
    out.push(list);
  }
  return out;
})();

interface Solution {
  sets: number[][];
  handUsed: number;
  points: number;
}

/**
 * The most rack tiles that can join the table: every `required` tile must be used, any of `available` beyond those
 * may be. With `minPoints`, the sets must be worth that much (a first meld). Null if no arrangement was found within
 * the node budget.
 */
function solve(required: Int8Array, available: Int8Array, budget: number, minPoints = 0, beat = 0): Solution | null {
  const avail = Int8Array.from(available);
  const req = Int8Array.from(required);
  const sets: number[][] = [];
  let handUsed = 0;
  let points = 0;
  let nodes = 0;
  let best: Solution | null = null;
  let bestHand = beat;

  const handLeft = (from: number) => {
    let t = avail[JOKER] - req[JOKER];
    for (let i = from; i < JOKER; i++) t += avail[i] - req[i];
    return t;
  };
  const take = (x: number): boolean => {
    avail[x]--;
    if (req[x] > 0) {
      req[x]--;
      return true;
    }
    handUsed++;
    return false;
  };
  const give = (x: number, wasReq: boolean) => {
    avail[x]++;
    if (wasReq) req[x]++;
    else handUsed--;
  };
  const setPoints = (set: number[]) => analyzeSet(set.map(sampleTile))!.points;

  const rec = (k: number) => {
    if (++nodes > budget) return;
    while (k < JOKER && avail[k] === 0) k++;
    if (k === JOKER) {
      if (req[JOKER] > 0) return;
      if (handUsed > bestHand && points >= minPoints) {
        bestHand = handUsed;
        best = { sets: sets.map((s) => [...s]), handUsed, points };
      }
      return;
    }
    if (handUsed + handLeft(k) <= bestHand) return;
    for (const cand of CANDIDATES[k]) {
      let ok = true;
      const need = new Map<number, number>();
      for (const x of cand) need.set(x, (need.get(x) ?? 0) + 1);
      for (const [x, c] of need) if (avail[x] < c) ok = false;
      if (!ok) continue;
      const flags = cand.map(take);
      const pts = minPoints ? setPoints(cand) : 0;
      points += pts;
      sets.push(cand);
      rec(k);
      sets.pop();
      points -= pts;
      for (let i = cand.length - 1; i >= 0; i--) give(cand[i], flags[i]);
      if (nodes > budget) return;
    }
    if (req[k] === 0) {
      const saved = avail[k];
      avail[k] = 0;
      rec(k + 1);
      avail[k] = saved;
    }
  };
  rec(0);
  return best;
}

const SAMPLE = new Map<number, Tile>();
function sampleTile(k: number): Tile {
  let t = SAMPLE.get(k);
  if (!t) {
    t = k === JOKER ? { id: 'j', color: null, n: 0 } : { id: `s${k}`, color: (['r', 'b', 'o', 'k'] as const)[cOf(k)], n: nOf(k) };
    SAMPLE.set(k, t);
  }
  return t;
}

const counts = (tiles: Tile[]) => {
  const c = new Int8Array(53);
  for (const t of tiles) c[kindOf(t)]++;
  return c;
};

/** Turns kind lists back into tile ids: table tiles are used first, so every one of them is placed. */
function toIds(sets: number[][], table: Tile[], hand: Tile[]): string[][] {
  const pools = new Map<number, string[]>();
  for (const t of [...table, ...hand]) {
    const k = kindOf(t);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k)!.push(t.id);
  }
  return sets.map((set) => set.map((k) => pools.get(k)!.shift()!));
}

/** Joins runs that continue each other (the search builds long runs from short pieces). */
function mergeRuns(sets: string[][]): string[][] {
  const out = sets.map((s) => [...s]);
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue;
        const a = analyzeSet(out[i].map(tileOf));
        const b = analyzeSet(out[j].map(tileOf));
        if (a?.kind !== 'run' || b?.kind !== 'run') continue;
        if (a.values[a.values.length - 1] + 1 !== b.values[0]) continue;
        const joined = [...out[i], ...out[j]];
        if (!analyzeSet(joined.map(tileOf))) continue;
        const ca = a.tiles.find((t) => !isJoker(t))!.color;
        const cb = b.tiles.find((t) => !isJoker(t))!.color;
        if (ca !== cb) continue;
        out[i] = joined;
        out.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return out;
}

/** Keeps sets that didn't change where they were, so a rearrangement doesn't shuffle the whole table on screen. */
function stabilize(oldTable: string[][], next: string[][]): string[][] {
  const k = (s: string[]) => [...s].sort().join();
  const left = next.map((s) => s);
  const kept: string[][] = [];
  for (const set of oldTable) {
    const i = left.findIndex((s) => k(s) === k(set));
    if (i >= 0) {
      kept.push(set);
      left.splice(i, 1);
    } else {
      // a set that grew stays in its place too
      const j = left.findIndex((s) => set.every((id) => s.includes(id)));
      if (j >= 0) {
        kept.push(left[j]);
        left.splice(j, 1);
      }
    }
  }
  return [...kept, ...left];
}

/** New sets from the rack alone. */
function rackSets(hand: Tile[], budget: number, minPoints = 0): string[][] | null {
  const sol = solve(new Int8Array(53), counts(hand), budget, minPoints);
  return sol ? mergeRuns(toIds(sol.sets, [], hand)) : null;
}

/** Adds rack tiles to the ends of table runs and to groups, one at a time, while any fit. */
function extend(table: string[][], hand: Tile[], jokers: boolean): { table: string[][]; used: Set<string> } {
  const out = table.map((s) => [...s]);
  const used = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of hand) {
      if (used.has(t.id) || (isJoker(t) && !jokers)) continue;
      for (const set of out) {
        const tiles = set.map(tileOf);
        const end = analyzeSet([...tiles, t]);
        const start = end ? null : analyzeSet([t, ...tiles]);
        const got = end ?? start;
        if (!got) continue;
        set.splice(0, set.length, ...got.tiles.map((x) => x.id));
        used.add(t.id);
        changed = true;
        break;
      }
    }
  }
  return { table: out, used };
}

export const BUDGET: Record<Difficulty, number> = { easy: 1500, normal: 6000, hard: 25000 };

/**
 * The bot's turn: the table it lays down, or null to draw. `state` must be redacted for `seat`.
 */
export function botTurn(state: GameState, seat: number, level: Difficulty): string[][] | null {
  const hand = state.hands[seat];
  const input = turnInput(state, seat);
  const ok = (table: string[][] | null) => (table && !checkTurn(input, table).error ? table : null);
  if (!state.melded[seat]) {
    const sets = rackSets(hand, BUDGET[level], state.firstMeld);
    return ok(sets ? [...state.table.map((s) => [...s]), ...sets] : null);
  }
  // new sets from the rack, keeping jokers back unless they help go out
  const plain = hand.filter((t) => !isJoker(t));
  let sets = rackSets(plain, BUDGET[level]) ?? [];
  let usedIds = new Set(sets.flat());
  let table = [...state.table.map((s) => [...s]), ...sets];
  if (level !== 'easy') {
    const rest = hand.filter((t) => !usedIds.has(t.id));
    const ext = extend(table, rest, false);
    table = ext.table;
    for (const id of ext.used) usedIds.add(id);
  }
  // the jokers too, if that empties the rack
  const jokers = hand.filter(isJoker);
  if (jokers.length && hand.length - usedIds.size <= jokers.length + 2) {
    const all = rackSets(hand, BUDGET[level]);
    if (all && all.flat().length === hand.length) {
      table = [...state.table.map((s) => [...s]), ...all];
      usedIds = new Set(all.flat());
    } else if (level !== 'easy') {
      const ext = extend(table, hand.filter((t) => !usedIds.has(t.id)), true);
      if (usedIds.size + ext.used.size === hand.length) {
        table = ext.table;
        for (const id of ext.used) usedIds.add(id);
      }
    }
  }
  if (level === 'hard') {
    const tableTiles = state.table.flat().map(tileOf);
    const sol = solve(counts(tableTiles), counts([...tableTiles, ...hand]), BUDGET.hard, 0, usedIds.size);
    // jokers from the rack only when the rearrangement places them as well as more tiles
    if (sol && sol.handUsed > usedIds.size) {
      const next = stabilize(state.table, mergeRuns(toIds(sol.sets, tableTiles, hand)));
      if (ok(next)) {
        table = next;
        usedIds = new Set(next.flat().filter((id) => hand.some((t) => t.id === id)));
      }
    }
  }
  if (usedIds.size === 0) return null;
  return ok(table);
}

// exported for tests
export const _internal = { solve, counts, toIds, mergeRuns, kindOf };
