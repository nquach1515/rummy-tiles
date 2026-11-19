import { AnimatePresence, motion } from 'framer-motion';
import { ReactNode } from 'react';
import { SeatView } from '../net/protocol';

/** Each seat has its own colour (coral, sky, lime, violet); yours also gets a white ring. */
export function Avatar({ seat, you, size, index }: { seat: Pick<SeatView, 'name' | 'online'>; you: boolean; size?: number; index: number }) {
  return (
    <div className={`avatar p${index % 4} ${you ? 'you' : ''} ${seat.online ? '' : 'offline'}`} style={size ? ({ '--size': `${size}px` } as React.CSSProperties) : undefined}>
      {seat.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Phones share invite links through the system share sheet; computers copy them. */
export const SHARE_INVITES = typeof navigator !== 'undefined' && !!navigator.share && matchMedia('(pointer: coarse)').matches;

export async function shareInvite(code: string, url: string): Promise<'shared' | 'copied' | 'none'> {
  const data = { title: 'Join my Rummy Tiles table', text: `Join my Rummy Tiles table (code ${code})`, url };
  if (SHARE_INVITES) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'none';
    }
  }
  return (await copyText(url)) ? 'copied' : 'none';
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className={`panel modal ${wide ? 'wide' : ''}`}
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className={`seg ${disabled ? 'off' : ''}`}>
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(v)}>
          {v === value && <motion.span layoutId={`pill-${options.map((o) => o[0]).join()}`} className="pill" transition={{ duration: 0.25 }} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Rules() {
  return (
    <div className="rules">
      <h2 className="serif">How to play</h2>
      <p>
        106 tiles: numbers 1 to 13 in four colours, two of each, and two jokers. Everyone starts with 14 tiles on their rack. Empty
        your rack first to win the round.
      </p>
      <h3>Sets</h3>
      <ul>
        <li>
          <b>Run</b>: three or more numbers in a row in one colour (4-5-6 in blue). 1 is always low.
        </li>
        <li>
          <b>Group</b>: three or four tiles of one number, every colour different (8 red, 8 blue, 8 black).
        </li>
        <li>A joker stands in for any tile a set needs.</li>
      </ul>
      <h3>Your turn</h3>
      <ul>
        <li>Lay down sets from your rack, add tiles to sets on the table, or rearrange the whole table any way you like: split, join and swap sets.</li>
        <li>When you press Done, every row on the table must be a valid set and you must have placed at least one tile of your own.</li>
        <li>If you can't or don't want to play, draw a tile instead.</li>
        <li>
          <b>First meld</b>: the first time you play in a round, your new sets have to add up to 30 points from your own tiles (a
          joker counts as the tile it stands for), and you can't touch the table's sets yet.
        </li>
      </ul>
      <h3>Scoring</h3>
      <p>
        Whoever goes out wins the round. Everyone else loses the points left on their rack (a joker costs 30), and the winner gains them
        all. If the pool runs out and nobody can play, the lowest rack wins.
      </p>
      <h3>Moving tiles</h3>
      <p>Drag tiles where you want them, or tap tiles to pick them up and tap a set's + to drop them. Drop onto the empty space to start a new set.</p>
    </div>
  );
}
