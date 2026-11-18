/**
 * Which tile rows are valid sets.
 *  run:   3–13 tiles of one colour with consecutive numbers (1 is low only: 12-13-1 doesn't count)
 *  group: 3–4 tiles of one number, every colour different
 * A joker stands for whatever tile its place in the set needs.
 */
import { colorIndex, isJoker, Tile } from './tiles';

export interface SetInfo {
  kind: 'run' | 'group';
  /** the tiles in the order they're shown */
  tiles: Tile[];
  /** the number each tile counts as (a joker counts as the tile it stands for) */
  values: number[];
  /** what the set is worth towards a first meld */
  points: number;
}

const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

/** The tiles as a run, in exactly this order, or null. */
function runInOrder(tiles: Tile[]): SetInfo | null {
  const first = tiles.findIndex((t) => !isJoker(t));
  if (first < 0) return null;
  const color = tiles[first].color;
  const start = tiles[first].n - first;
  if (start < 1 || start + tiles.length - 1 > 13) return null;
  const values: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const v = start + i;
    if (!isJoker(t) && (t.color !== color || t.n !== v)) return null;
    values.push(v);
  }
  return { kind: 'run', tiles, values, points: sum(values) };
}

function group(tiles: Tile[]): SetInfo | null {
  if (tiles.length > 4) return null;
  const real = tiles.filter((t) => !isJoker(t));
  if (real.length === 0) return null;
  const n = real[0].n;
  if (real.some((t) => t.n !== n)) return null;
  if (new Set(real.map((t) => t.color)).size !== real.length) return null;
  const ordered = [...real.sort((a, b) => colorIndex(a.color!) - colorIndex(b.color!)), ...tiles.filter(isJoker)];
  return { kind: 'group', tiles: ordered, values: ordered.map(() => n), points: n * ordered.length };
}

/** The tiles as a run in number order, with jokers filling gaps and then extending it (upwards first). */
function canonicalRun(tiles: Tile[]): SetInfo | null {
  const real = tiles.filter((t) => !isJoker(t)).sort((a, b) => a.n - b.n);
  const jokers = tiles.filter(isJoker);
  if (real.length === 0 || tiles.length > 13) return null;
  if (real.some((t) => t.color !== real[0].color)) return null;
  for (let i = 1; i < real.length; i++) if (real[i].n === real[i - 1].n) return null;
  const lo = real[0].n;
  const hi = real[real.length - 1].n;
  const gaps = hi - lo + 1 - real.length;
  if (gaps > jokers.length) return null;
  let extra = jokers.length - gaps;
  const above = Math.min(extra, 13 - hi);
  extra -= above;
  if (extra > lo - 1) return null;
  const out: Tile[] = [];
  let j = 0;
  for (let k = 0; k < extra; k++) out.push(jokers[j++]);
  let r = 0;
  for (let v = lo; v <= hi; v++) {
    if (real[r]?.n === v) out.push(real[r++]);
    else out.push(jokers[j++]);
  }
  for (let k = 0; k < above; k++) out.push(jokers[j++]);
  return runInOrder(out);
}

/**
 * Reads a row of tiles as a set, or null if it isn't one. A run keeps the order it's in when that order works (so a
 * player can put a joker at either end); otherwise it's put in order.
 */
export function analyzeSet(tiles: Tile[]): SetInfo | null {
  if (tiles.length < 3) return null;
  return runInOrder(tiles) ?? group(tiles) ?? canonicalRun(tiles);
}

export function isValidSet(tiles: Tile[]): boolean {
  return analyzeSet(tiles) !== null;
}

/** The order to show a row in: a valid set's own order, anything else as the player left it. */
export function displayOrder(tiles: Tile[]): Tile[] {
  return analyzeSet(tiles)?.tiles ?? tiles;
}
