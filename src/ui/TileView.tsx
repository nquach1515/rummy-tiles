import { animate, motion, useMotionValue } from 'framer-motion';
import { CSSProperties, memo, useLayoutEffect, useRef } from 'react';
import { Tile } from '../game/tiles';

type TileFlags = {
  tile: Tile;
  selected?: boolean;
  /** just placed by the last player */
  glow?: boolean;
  /** placed from your rack this turn */
  mine?: boolean;
  /** the space a dragged tile left */
  ghost?: boolean;
  /** just landed: a quick settle */
  land?: boolean;
};

function tileClass({ tile, selected, glow, mine, ghost, land }: TileFlags) {
  return ['tile', tile.color ?? 'joker', selected && 'selected', glow && 'glow', mine && 'mine', ghost && 'ghost', land && 'land'].filter(Boolean).join(' ');
}

function Face({ tile }: { tile: Tile }) {
  return (
    <>
      {tile.color ? <span className="num">{tile.n}</span> : <span className="star">★</span>}
      <span className="dot" />
    </>
  );
}

/** One tile: an ivory face with its number in the tile's colour, or a joker's star. Its size comes from --tw. */
export const TileView = memo(function TileView({ tile, selected, glow, mine, ghost, land, style, ...rest }: TileFlags & { style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={tileClass({ tile, selected, glow, mine, ghost, land })} style={style} {...rest}>
      <Face tile={tile} />
    </div>
  );
});

// ---- flights: a tile that appears flies in from somewhere (the bag, a player's seat, where you dropped it) ----

export interface Flight {
  /** the screen point it starts from (its centre) */
  x: number;
  y: number;
  delay?: number;
  /** size at the start, relative to its final size */
  scale?: number;
  rotate?: number;
}

const flights = new Map<string, Flight>();
/** The tile with this layout id flies in from `f` when it next mounts. */
export function queueFlight(lid: string, f: Flight) {
  flights.set(lid, f);
  // forget it if no tile picks it up
  setTimeout(() => flights.get(lid) === f && flights.delete(lid), 1500);
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A tile that animates: it slides to its new place when the table or rack changes (shared layout id), and flies in when
 * a flight is queued for it. `dep` changes whenever anything on screen may have moved, so tiles only measure then.
 */
export const MotionTile = memo(function MotionTile({
  lid,
  dep,
  onPointerDown,
  drop,
  ...flags
}: TileFlags & {
  lid: string;
  dep: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** its drop target key (data-drop) */
  drop?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const rotate = useMotionValue(0);
  useLayoutEffect(() => {
    const f = flights.get(lid);
    const el = ref.current;
    if (!f || !el) return;
    setTimeout(() => flights.delete(lid), 0);
    if (reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const dx = f.x - (r.left + r.width / 2);
    const dy = f.y - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    x.set(dx);
    y.set(dy);
    scale.set(f.scale ?? 1);
    rotate.set(f.rotate ?? 0);
    el.style.zIndex = '30';
    const o = { type: 'spring' as const, stiffness: 260, damping: 26, delay: f.delay ?? 0 };
    const anims = [animate(x, 0, o), animate(y, 0, o), animate(scale, 1, o), animate(rotate, 0, o)];
    void anims[0].then(() => (el.style.zIndex = ''));
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <motion.div
      ref={ref}
      layoutId={lid}
      layout
      layoutDependency={dep}
      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
      onLayoutAnimationStart={() => ref.current && (ref.current.style.zIndex = '30')}
      onLayoutAnimationComplete={() => ref.current && (ref.current.style.zIndex = '')}
      className={tileClass(flags)}
      style={{ x, y, scale, rotate }}
      onPointerDown={onPointerDown}
      data-drop={drop}
    >
      <Face tile={flags.tile} />
    </motion.div>
  );
});

/** A tile with a letter on it, for titles and the table code. */
export function LetterTile({ ch, color, style }: { ch: string; color: 'r' | 'b' | 'o' | 'k'; style?: CSSProperties }) {
  return (
    <div className={`tile letter ${color}`} style={style}>
      <span className="num">{ch}</span>
    </div>
  );
}

/** A face-down tile, for counts. */
export function TileBack({ style }: { style?: CSSProperties }) {
  return <div className="tile back" style={style} />;
}
