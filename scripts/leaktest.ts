/**
 * Bots must decide only from what their seat can know. For random positions, deal the hidden tiles (the other racks
 * and the pool) differently and check that the redacted game and every bot decision come out exactly the same.
 *   npm run leaktest
 */
import { botTurn, Difficulty } from '../src/game/bot';
import { commit, draw, GameState, newGame, redactFor, startRound } from '../src/game/engine';
import { shuffle } from '../src/game/tiles';

const names = (i: number) => `P${i}`;
let checked = 0;
let failures = 0;

/** The same game with the tiles this seat can't see dealt again at random. */
function redeal(s: GameState, seat: number): GameState {
  const copy: GameState = structuredClone(s);
  const hidden = shuffle([...copy.pool, ...copy.hands.filter((_, i) => i !== seat).flat()]);
  copy.pool = hidden.splice(0, copy.pool.length);
  copy.hands = copy.hands.map((h, i) => (i === seat ? h : hidden.splice(0, h.length)));
  return copy;
}

for (let g = 0; g < 30; g++) {
  const s = newGame(2 + (g % 3), 30);
  startRound(s);
  for (let turn = 0; s.phase === 'playing' && turn < 400; turn++) {
    const seat = s.turn;
    if (turn % 3 === 0) {
      const other = redeal(s, seat);
      if (JSON.stringify(redactFor(s, seat)) !== JSON.stringify(redactFor(other, seat))) {
        failures++;
        console.error('FAIL: the redacted game depends on hidden tiles');
      }
      for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
        const a = JSON.stringify(botTurn(redactFor(s, seat), seat, level));
        const b = JSON.stringify(botTurn(redactFor(other, seat), seat, level));
        checked++;
        if (a !== b) {
          failures++;
          console.error(`FAIL: ${level} bot decided differently with the hidden tiles dealt differently`);
        }
      }
    }
    const table = botTurn(redactFor(s, seat), seat, 'hard');
    if (!table || commit(s, seat, table, names)) draw(s, seat, names);
  }
}
console.log(`${checked} decisions checked, ${failures} leaks`);
if (failures) process.exit(1);
