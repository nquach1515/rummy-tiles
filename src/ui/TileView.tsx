import { CSSProperties, memo } from 'react';
import { Tile } from '../game/tiles';

/** One tile: an ivory face with its number in the tile's colour, or a joker's star. Its size comes from --tw. */
export const TileView = memo(function TileView({
  tile,
  selected,
  glow,
  mine,
  ghost,
  style,
  ...rest
}: {
  tile: Tile;
  selected?: boolean;
  /** just placed by the last player */
  glow?: boolean;
  /** placed from your rack this turn */
  mine?: boolean;
  /** the space a dragged tile left */
  ghost?: boolean;
  style?: CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  const cls = ['tile', tile.color ?? 'joker', selected && 'selected', glow && 'glow', mine && 'mine', ghost && 'ghost'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style} {...rest}>
      {tile.color ? <span className="num">{tile.n}</span> : <span className="star">★</span>}
      <span className="dot" />
    </div>
  );
});

/** A face-down tile, for counts. */
export function TileBack({ style }: { style?: CSSProperties }) {
  return <div className="tile back" style={style} />;
}
