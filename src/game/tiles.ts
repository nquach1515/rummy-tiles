/** Tiles: four colours, numbers 1–13, two copies of each, and two jokers (106 tiles). */

export type Color = 'r' | 'b' | 'o' | 'k';
export const COLORS: Color[] = ['r', 'b', 'o', 'k'];
export const COLOR_NAMES: Record<Color, string> = { r: 'red', b: 'blue', o: 'orange', k: 'black' };

export interface Tile {
  id: string;
  /** null for a joker */
  color: Color | null;
  /** 1–13, or 0 for a joker */
  n: number;
}

/** A tile nobody but its owner may see (a bot's redacted copy of the other racks and the pool). */
export const HIDDEN = 'hidden';

export const JOKER_POINTS = 30;

export function isJoker(t: Tile): boolean {
  return t.color === null;
}

export function fullSet(): Tile[] {
  const tiles: Tile[] = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 13; n++) {
      for (const copy of ['a', 'b']) tiles.push({ id: `${color}${n}${copy}`, color, n });
    }
  }
  tiles.push({ id: 'j1', color: null, n: 0 }, { id: 'j2', color: null, n: 0 });
  return tiles;
}

const ALL = new Map(fullSet().map((t) => [t.id, t]));

/** The tile with this id (ids say what the tile is, so anyone can look one up). */
export function tileOf(id: string): Tile {
  const t = ALL.get(id);
  if (!t) throw new Error(`no tile ${id}`);
  return t;
}

export function isTileId(id: unknown): id is string {
  return typeof id === 'string' && ALL.has(id);
}

/** Uniform random integer in [0, n), without modulo bias. */
export function randomInt(n: number): number {
  if (n <= 1) return 0;
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return Math.floor(Math.random() * n);
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Fisher–Yates, in place. */
export function shuffle<T>(a: T[], rand: (n: number) => number = randomInt): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Points a tile left on a rack costs at the end of a round. */
export function rackPoints(t: Tile): number {
  return isJoker(t) ? JOKER_POINTS : t.n;
}

const COLOR_ORDER: Record<Color, number> = { r: 0, b: 1, o: 2, k: 3 };
export const colorIndex = (c: Color) => COLOR_ORDER[c];

/** Rack orders: by colour then number (runs line up), or by number then colour (groups line up). Jokers go last. */
export function sortTiles(tiles: Tile[], by: 'color' | 'number'): Tile[] {
  return [...tiles].sort((a, b) => {
    if (isJoker(a) !== isJoker(b)) return isJoker(a) ? 1 : -1;
    if (isJoker(a)) return a.id < b.id ? -1 : 1;
    const ca = COLOR_ORDER[a.color!];
    const cb = COLOR_ORDER[b.color!];
    const d = by === 'color' ? ca - cb || a.n - b.n : a.n - b.n || ca - cb;
    return d || (a.id < b.id ? -1 : 1);
  });
}
