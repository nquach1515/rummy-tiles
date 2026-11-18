import type { Difficulty } from '../game/bot';
import type { LogEntry, Move, Phase, RoundResult } from '../game/engine';
import type { Tile } from '../game/tiles';

export type Action =
  | { type: 'sit'; seat: number }
  | { type: 'rename'; name: string }
  | { type: 'addBot'; seat: number }
  | { type: 'removeSeat'; seat: number }
  | { type: 'botify'; seat: number }
  | { type: 'start' }
  | { type: 'settings'; settings: Partial<Settings> }
  /** end your turn with this table */
  | { type: 'commit'; table: string[][] }
  /** end your turn by drawing a tile */
  | { type: 'draw' }
  /** the table as you're arranging it, so everyone can watch (null: put back as it was) */
  | { type: 'draft'; table: string[][] | null }
  | { type: 'hint' }
  | { type: 'nextRound' }
  | { type: 'newGame' }
  | { type: 'emote'; emoji: string };

export interface Settings {
  /** points a first meld needs (0: none) */
  firstMeld: number;
  /** seconds a turn may take (0: no limit) */
  turnSeconds: number;
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: Settings = { firstMeld: 30, turnSeconds: 0, difficulty: 'normal' };

export interface SeatView {
  name: string;
  isBot: boolean;
  /** a bot playing for a person who dropped out (the host can hand the seat back) */
  standIn: boolean;
  isHost: boolean;
  online: boolean;
  tileCount: number;
  melded: boolean;
  score: number;
}

export interface PlayerView {
  roomCode: string;
  online: boolean;
  you: number | null;
  isHost: boolean;
  /** four seats in the lobby; the players in play once the game starts */
  seats: (SeatView | null)[];
  phase: Phase;
  round: number;
  turn: number;
  /** time left in the current turn (ms), or null with no limit */
  turnRemainingMs: number | null;
  poolCount: number;
  hand: Tile[];
  table: string[][];
  /** the player whose turn it is, as they arrange the table */
  draft: { seat: number; table: string[][] } | null;
  firstMeld: number;
  lastMove: Move | null;
  result: RoundResult | null;
  log: LogEntry[];
  emotes: { id: number; seat: number; emoji: string }[];
  /** error for the last action you sent, if any */
  error: { id: number; text: string } | null;
  /** a suggested table after you ask for a hint (null table: no move, draw) */
  hint: { id: number; table: string[][] | null } | null;
  settings: Settings;
}

export type ClientMsg = { t: 'hello'; clientId: string; name: string } | { t: 'action'; action: Action };
export type HostMsg =
  | { t: 'view'; view: PlayerView }
  | { t: 'reject'; reason: string }
  // from the relay itself: the host's connection has gone quiet (often their phone locked), and when it's back
  | { t: 'hostAway'; away: boolean };
