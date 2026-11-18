/**
 * Headless checks: the set rules, the turn rules, and many whole bot-vs-bot rounds, checking after every turn that
 * no tile appeared, vanished or was duplicated, and that the table is always made of valid sets.
 *   npm run sim [rounds]
 */
import { botTurn, Difficulty } from '../src/game/bot';
import { checkTurn, commit, draw, GameState, newGame, redactFor, startRound } from '../src/game/engine';
import { analyzeSet } from '../src/game/rules';
import { tileOf } from '../src/game/tiles';

let failures = 0;
function expect(cond: boolean, what: string) {
  if (!cond) {
    failures++;
    console.error('FAIL:', what);
  }
}
const set = (ids: string) => ids.split(' ').map(tileOf);
const valid = (ids: string) => analyzeSet(set(ids)) !== null;

// ---- sets ----
expect(valid('r1a r2a r3a'), 'run 1-2-3');
expect(valid('r3a r1a r2a'), 'run out of order is put in order');
expect(!valid('r12a r13a r1a'), 'no wrapping 12-13-1');
expect(!valid('r1a r2a b3a'), 'run must be one colour');
expect(valid('r5a b5a k5a'), 'group of three');
expect(valid('r5a b5a k5a o5a'), 'group of four');
expect(!valid('r5a r5b k5a'), 'group colours must differ');
expect(!valid('r5a b5a'), 'too short');
expect(valid('r5a j1 r7a'), 'joker in a gap');
expect(valid('j1 r5a r6a'), 'joker at the low end');
expect(valid('r5a b5a j1 j2'), 'group with two jokers');
expect(!valid('r5a b5a k5a o5a j1'), 'group of five');
expect(valid('r12a r13a j1'), 'joker below 12-13');
expect(analyzeSet(set('r12a r13a j1'))!.values.join() === '11,12,13', 'joker goes below when it cannot go above');
expect(analyzeSet(set('r5a j1 r7a'))!.points === 18, 'joker counts as the tile it stands for');
expect(analyzeSet(set('j1 r5a r6a'))!.values[0] === 4, 'leading joker kept where the player put it');
expect(valid('r1a r2a r3a r4a r5a r6a r7a r8a r9a r10a r11a r12a r13a'), 'run 1-13');
expect(!valid('r1a r2a r3a r4a r5a r6a r7a r8a r9a r10a r11a r12a r13a j1'), 'run longer than 13');

// ---- turns ----
const hand = ['r10a', 'r11a', 'r12a', 'b1a', 'b2a', 'b3a', 'k9a'];
const t0 = { oldTable: [['o1a', 'o2a', 'o3a']], hand, melded: false, firstMeld: 30 };
expect(checkTurn(t0, [['o1a', 'o2a', 'o3a'], ['r10a', 'r11a', 'r12a']]).error === null, 'first meld of 33');
expect(checkTurn(t0, [['o1a', 'o2a', 'o3a'], ['b1a', 'b2a', 'b3a']]).error !== null, 'first meld under 30');
expect(checkTurn(t0, [['o1a', 'o2a', 'o3a', 'b3a'], ['r10a', 'r11a', 'r12a']]).error !== null, 'first meld cannot touch the table');
expect(checkTurn(t0, [['r10a', 'r11a', 'r12a']]).error !== null, 'table tiles must stay');
expect(checkTurn({ ...t0, melded: true }, [['o1a', 'o2a', 'o3a', 'k9a']]).error !== null, 'invalid set rejected');
expect(checkTurn({ ...t0, melded: true }, [['o1a', 'o2a', 'o3a']]).error !== null, 'must place a tile');
expect(checkTurn({ ...t0, melded: true }, [['o1a', 'o2a'], ['o3a', 'b3a', 'r3x']]).error !== null, 'unknown tile');
expect(checkTurn({ ...t0, melded: true }, [['o1a', 'o2a', 'o3a'], ['b1a', 'b2a', 'b3a']]).error === null, 'after melding, any amount');

// ---- whole rounds ----
const names = (i: number) => `P${i}`;
function audit(s: GameState, before: number) {
  const ids = [...s.pool, ...s.hands.flat()].map((t) => t.id).concat(s.table.flat());
  expect(ids.length === 106 && new Set(ids).size === 106, `tiles conserved (${ids.length}, round start ${before})`);
  for (const row of s.table) expect(analyzeSet(row.map(tileOf)) !== null, `table row valid: ${row.join(' ')}`);
}

const rounds = Number(process.argv[2] ?? 60);
const levels: Difficulty[][] = [
  ['hard', 'hard', 'hard', 'hard'],
  ['hard', 'normal', 'easy', 'normal'],
  ['easy', 'hard'],
  ['normal', 'hard', 'easy'],
];
const wins = new Map<string, { w: number; g: number }>();
let turns = 0;
let slowest = 0;
let totalMs = 0;
let blocked = 0;
for (let r = 0; r < rounds; r++) {
  const lv = levels[r % levels.length];
  const s = newGame(lv.length, 30);
  startRound(s);
  for (let guard = 0; s.phase === 'playing' && guard < 2000; guard++) {
    const seat = s.turn;
    const t = performance.now();
    const table = botTurn(redactFor(s, seat), seat, lv[seat]);
    const ms = performance.now() - t;
    slowest = Math.max(slowest, ms);
    totalMs += ms;
    turns++;
    if (table) {
      const err = commit(s, seat, table, names);
      expect(err === null, `bot move accepted: ${err}`);
      if (err) draw(s, seat, names);
    } else draw(s, seat, names);
    audit(s, r);
  }
  expect(s.phase === 'roundEnd', 'round finished');
  if (s.result?.reason === 'blocked') blocked++;
  expect(s.scores.reduce((a, b) => a + b, 0) === 0, 'scores add to zero');
  lv.forEach((l, i) => {
    const e = wins.get(l) ?? { w: 0, g: 0 };
    e.g++;
    if (s.result?.winner === i) e.w++;
    wins.set(l, e);
  });
}

console.log(`${rounds} rounds, ${turns} bot turns: ${(totalMs / turns).toFixed(2)} ms a turn on average, slowest ${slowest.toFixed(0)} ms; ${blocked} rounds ended with the pool empty`);
for (const [l, e] of wins) console.log(`  ${l.padEnd(6)} won ${e.w} of ${e.g} seats (${((100 * e.w) / e.g).toFixed(0)}%)`);
if (failures) {
  console.error(`${failures} checks failed`);
  process.exit(1);
}
console.log('all checks passed');
