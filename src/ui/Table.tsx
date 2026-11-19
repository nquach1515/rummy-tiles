import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { checkTurn } from '../game/engine';
import { displayOrder } from '../game/rules';
import { colorIndex, isJoker, sortTiles, tileOf } from '../game/tiles';
import { Action, PlayerView, SeatView } from '../net/protocol';
import { inviteLink } from '../net/site';
import { Avatar, Modal, Rules, shareInvite } from './common';
import { isMuted, setMuted, tap, win, yourTurn } from './sound';
import { TileBack, TileView } from './TileView';

type Target = { kind: 'set'; index: number; pos?: number } | { kind: 'new' } | { kind: 'rack'; pos?: number };

const EMOJI = ['👍', '😄', '😮', '😅', '🔥', '👏'];

/** Board geometry, as multiples of the tile width (styles.css uses the same numbers). */
const G = { tileH: 1.34, inner: 0.06, pad: 0.12, setGap: 0.32, rowGap: 0.32, border: 2 };

/** The largest tile width at which every set fits on the board without wrapping inside a set or scrolling. */
function fitTiles(w: number, h: number, lens: number[], newZone: number, max: number): { tw: number; fits: boolean } {
  const all = newZone ? [...lens, -newZone] : lens;
  for (let tw = max; tw >= 18; tw--) {
    let x = 0;
    let rows = 1;
    let ok = true;
    for (const len of all) {
      const sw =
        len < 0
          ? -len * tw + 2 * G.pad * tw + G.border
          : len * tw + (len - 1) * G.inner * tw + 2 * G.pad * tw + G.border;
      if (sw > w) {
        ok = false;
        break;
      }
      if (x > 0 && x + sw > w) {
        rows++;
        x = sw + G.setGap * tw;
      } else x += sw + G.setGap * tw;
    }
    if (!ok) continue;
    const height = rows * (G.tileH * tw + 2 * G.pad * tw + G.border) + (rows - 1) * G.rowGap * tw;
    if (height <= h) return { tw, fits: true };
  }
  return { tw: 18, fits: false };
}

function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Moves tiles to a set, a new set, or out of the table (for the rack). Sets left empty disappear. */
function moveOnTable(table: string[][], ids: string[], target: Target): string[][] {
  const moving = new Set(ids);
  const ordered = [...ids].sort((a, b) => {
    const x = tileOf(a);
    const y = tileOf(b);
    if (isJoker(x) !== isJoker(y)) return isJoker(x) ? 1 : -1;
    return x.n - y.n || colorIndex(x.color ?? 'r') - colorIndex(y.color ?? 'r');
  });
  let next = table.map((set, i) => {
    const kept = set.filter((id) => !moving.has(id));
    if (target.kind !== 'set' || target.index !== i) return kept;
    const pos = target.pos ?? set.length;
    const before = set.slice(0, pos).filter((id) => moving.has(id)).length;
    kept.splice(pos - before, 0, ...ordered);
    return kept;
  });
  if (target.kind === 'new') next.push(ordered);
  next = next.filter((s) => s.length > 0);
  return next.map((s) => displayOrder(s.map(tileOf)).map((t) => t.id));
}

function parseTarget(key: string | null, el: Element | null, x: number): Target | null {
  if (!key) return null;
  const [kind, a, b] = key.split(':');
  const after = el ? x > el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 : false;
  if (kind === 'set') return { kind: 'set', index: Number(a), pos: b === undefined ? undefined : Number(b) + (after ? 1 : 0) };
  if (kind === 'new') return { kind: 'new' };
  if (kind === 'rack') return { kind: 'rack', pos: a === undefined ? undefined : Number(a) + (after ? 1 : 0) };
  return null;
}

interface Drag {
  grab: string;
  ids: string[];
  x0: number;
  y0: number;
  active: boolean;
  fromRack: boolean;
}

export function Table({
  view,
  send,
  onLeave,
  netState,
  netDetail,
}: {
  view: PlayerView;
  send: (a: Action) => void;
  onLeave: (keep?: boolean) => void;
  netState: string;
  netDetail: string;
}) {
  const you = view.you;
  const me = you !== null ? view.seats[you] : null;
  const playing = view.phase === 'playing';
  const myTurn = playing && you !== null && view.turn === you;
  const handIds = useMemo(() => view.hand.map((t) => t.id), [view.hand]);
  const handSet = useMemo(() => new Set(handIds), [handIds]);
  const lastLog = view.log[view.log.length - 1]?.id ?? 0;
  const turnKey = `${view.round}:${view.turn}:${lastLog}`;

  // ---- your rack's order: kept on this device; new tiles join at the end ----
  const orderRef = useRef<string[]>([]);
  const [orderVersion, setOrderVersion] = useState(0);
  const [sortBy, setSortBy] = useState<'color' | 'number' | null>(null);
  const rackOrder = useMemo(() => {
    const kept = orderRef.current.filter((id) => handSet.has(id));
    const added = handIds.filter((id) => !kept.includes(id));
    return [...kept, ...added];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handSet, handIds, orderVersion]);
  orderRef.current = rackOrder;
  const setOrder = (ids: string[]) => {
    orderRef.current = ids;
    setOrderVersion((v) => v + 1);
  };
  const sortRack = (by: 'color' | 'number') => {
    setSortBy(by);
    const sorted = sortTiles(orderRef.current.map(tileOf), by).map((t) => t.id);
    setOrder(sorted);
  };
  // tiles you drew since your last turn, highlighted for a moment
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prevHand = useRef<string[] | null>(null);
  useEffect(() => {
    const prev = prevHand.current;
    prevHand.current = handIds;
    if (!prev || view.phase !== 'playing') return;
    const added = handIds.filter((id) => !prev.includes(id));
    if (added.length && added.length < 3) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 2600);
      return () => clearTimeout(t);
    }
  }, [handIds, view.phase]);

  // ---- your turn: the table as you're arranging it ----
  const [work, setWork] = useState<string[][] | null>(null);
  const [history, setHistory] = useState<string[][][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set());
    setHistory([]);
    if (myTurn) {
      setWork(view.table.map((s) => [...s]));
      yourTurn();
    } else setWork(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, myTurn]);

  const update = (next: string[][]) => {
    if (!work) return;
    setHistory((h) => [...h.slice(-49), work]);
    setWork(next);
    send({ type: 'draft', table: next });
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setWork(prev);
    setSelected(new Set());
    send({ type: 'draft', table: prev });
  };
  const reset = () => {
    if (!work) return;
    setHistory((h) => [...h, work]);
    setWork(view.table.map((s) => [...s]));
    setSelected(new Set());
    send({ type: 'draft', table: null });
  };

  const table = myTurn && work ? work : view.draft?.table ?? view.table;
  const onTable = useMemo(() => new Set(table.flat()), [table]);
  const rack = rackOrder.filter((id) => !(myTurn && onTable.has(id)));
  const check = useMemo(
    () => (myTurn && work && me ? checkTurn({ oldTable: view.table, hand: handIds, melded: me.melded, firstMeld: view.firstMeld }, work) : null),
    [myTurn, work, me, view.table, handIds, view.firstMeld],
  );
  const changed = !!work && JSON.stringify(work) !== JSON.stringify(view.table);
  const bad = new Set(myTurn ? check?.badSets ?? [] : []);

  // ---- toasts: your errors, hints with no move ----
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const say = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const lastError = useRef(view.error?.id ?? 0);
  useEffect(() => {
    if (view.error && view.error.id !== lastError.current) {
      lastError.current = view.error.id;
      say(view.error.text);
    }
  }, [view.error, say]);
  const lastHint = useRef(view.hint?.id ?? 0);
  const [hinting, setHinting] = useState(false);
  useEffect(() => {
    if (!view.hint || view.hint.id === lastHint.current) return;
    lastHint.current = view.hint.id;
    setHinting(false);
    if (!myTurn || !work) return;
    if (view.hint.table) {
      update(view.hint.table);
      setSelected(new Set());
      tap();
    } else say('No move found: draw a tile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.hint]);

  // ---- the last player's tiles glow for a moment; a soft tap when anyone places tiles ----
  const [glow, setGlow] = useState<Set<string>>(new Set());
  const lastMoveKey = useRef(lastLog);
  useEffect(() => {
    if (lastMoveKey.current === lastLog) return;
    lastMoveKey.current = lastLog;
    const m = view.lastMove;
    if (m?.kind === 'play' && m.seat !== you) {
      setGlow(new Set(m.placed));
      tap(0.8);
      const t = setTimeout(() => setGlow(new Set()), 3000);
      return () => clearTimeout(t);
    }
  }, [lastLog, view.lastMove, you]);
  useEffect(() => {
    if (view.phase === 'roundEnd' && view.result?.winner === you) win();
  }, [view.phase, view.result, you]);

  // ---- turn timer ----
  const deadline = useMemo(() => (view.turnRemainingMs === null ? null : Date.now() + view.turnRemainingMs), [view.turnRemainingMs, turnKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [deadline]);
  const secondsLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

  // ---- moving tiles ----
  const doMove = (ids: string[], target: Target) => {
    if (!ids.length) return;
    if (target.kind === 'rack') {
      if (ids.some((id) => !handSet.has(id))) {
        say('Tiles from the table have to stay on the table');
        return;
      }
      // reorder the rack (and take back your own tiles from the table)
      // the drop position counts tiles as shown on the rack; insert before the tile that's there
      const p = Math.min(target.pos ?? rack.length, rack.length);
      const shown = rack.filter((id) => !ids.includes(id));
      const anchor = shown[p - rack.slice(0, p).filter((id) => ids.includes(id)).length];
      const rest = orderRef.current.filter((id) => !ids.includes(id));
      const idx = anchor === undefined ? rest.length : rest.indexOf(anchor);
      setOrder([...rest.slice(0, idx), ...ids, ...rest.slice(idx)]);
      setSortBy(null);
      if (myTurn && work && ids.some((id) => onTable.has(id))) update(moveOnTable(work, ids, { kind: 'rack' }));
    } else {
      if (!myTurn || !work) return;
      update(moveOnTable(work, ids, target));
    }
    setSelected(new Set());
    tap();
  };

  const toggle = (id: string) => {
    if (!myTurn) return;
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const dragRef = useRef<Drag | null>(null);
  const [ghost, setGhost] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** Tapping a tile picks it up (or puts it down); with tiles picked up, tapping a tile in another set drops them beside it. */
  const tapTile = (id: string, fromRack: boolean, x: number) => {
    if (!myTurn || fromRack || selected.size === 0) return toggle(id);
    const i = table.findIndex((set) => set.includes(id));
    if (i < 0 || table[i].some((t) => selected.has(t))) return toggle(id);
    const el = document.querySelector(`[data-drop="set:${i}:${table[i].indexOf(id)}"]`);
    doMove([...selected], parseTarget(`set:${i}:${table[i].indexOf(id)}`, el, x)!);
  };
  const live = useRef({ doMove, toggle, tapTile, myTurn, selected });
  live.current = { doMove, toggle, tapTile, myTurn, selected };

  useEffect(() => {
    const targetAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-drop]') ?? null;
      return { el, key: el?.getAttribute('data-drop') ?? null };
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7) return;
        d.active = true;
        const { selected: sel, myTurn: mine } = live.current;
        d.ids = mine && sel.has(d.grab) ? [...sel] : [d.grab];
      }
      e.preventDefault();
      setGhost({ ids: d.ids, x: e.clientX, y: e.clientY });
      setHover(targetAt(e.clientX, e.clientY).key);
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      setGhost(null);
      setHover(null);
      if (!d.active) {
        live.current.tapTile(d.grab, d.fromRack, e.clientX);
        return;
      }
      const { el, key } = targetAt(e.clientX, e.clientY);
      const target = parseTarget(key, key?.split(':').length === 3 || key?.startsWith('rack:') ? el : null, e.clientX);
      if (!target) return;
      // not your turn: you can only rearrange your rack
      if (!live.current.myTurn && target.kind !== 'rack') return;
      live.current.doMove(d.ids, target);
    };
    const cancel = () => {
      dragRef.current = null;
      setGhost(null);
      setHover(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  const grab = (id: string, fromRack: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!fromRack && !myTurn) return;
    dragRef.current = { grab: id, ids: [id], x0: e.clientX, y0: e.clientY, active: false, fromRack };
  };

  // ---- layout: the biggest tiles at which the whole table fits ----
  const [boardRef, board] = useSize<HTMLDivElement>();
  const [rackRef, rackSize] = useSize<HTMLDivElement>();
  const wide = board.w > 700;
  const { tw, fits } = useMemo(
    () => fitTiles(board.w - 4, board.h - 4, table.map((s) => s.length), myTurn ? 2.2 : 0, wide ? 60 : 50),
    [board.w, board.h, table, myTurn, wide],
  );
  /** rack tile size, and the rows the whole hand needs at that size (kept for the turn, so the rack doesn't jump) */
  const { rackTw, rackRows } = useMemo(() => {
    const n = Math.max(myTurn ? handIds.length : rack.length, 1);
    const gap = 5;
    let tw = 32;
    for (const rows of [2, 3, 4]) {
      const per = Math.ceil(n / rows);
      tw = Math.floor((rackSize.w - (per - 1) * gap) / per);
      if (tw >= 32 || rows === 4) break;
    }
    tw = Math.max(24, Math.min(tw, wide ? 56 : 44));
    const perRow = Math.max(1, Math.floor((rackSize.w + gap) / (tw + gap)));
    return { rackTw: tw, rackRows: Math.max(1, Math.ceil(n / perRow)) };
  }, [rack.length, handIds.length, myTurn, rackSize.w, wide]);

  // ---- seats ----
  const order = view.seats.map((_, i) => ((you ?? 0) + i) % view.seats.length);
  const others = order.filter((i) => i !== you);
  const name = (i: number) => view.seats[i]?.name ?? `Seat ${i + 1}`;
  const turnName = name(view.turn);

  const [menu, setMenu] = useState(false);
  const [rules, setRules] = useState(false);
  const [emotes, setEmotes] = useState(false);
  const [muted, setMute] = useState(isMuted());

  let status: React.ReactNode;
  if (!playing) status = 'Round over';
  else if (myTurn) {
    if (changed && check?.error) status = <span className="warn">{check.error}</span>;
    else if (changed) status = <span className="ok">Ready: press Done</span>;
    else status = me && !me.melded && view.firstMeld ? `Your turn: open with ${view.firstMeld} points from your own tiles, or draw` : 'Your turn: play tiles or draw';
  } else status = view.draft ? `${turnName} is rearranging the table…` : `${turnName} is thinking…`;

  const meldProgress = myTurn && me && !me.melded && view.firstMeld > 0 && changed ? (check?.meldPoints ?? 0) : null;

  return (
    <div className={`game ${myTurn ? 'my-turn' : ''}`}>
      <header className="topbar">
        <button className="btn icon-btn ghost" onClick={() => setMenu(true)} aria-label="Menu">
          ☰
        </button>
        <div className="top-info">
          <span className="label">Round {view.round}</span>
          <span className="pool" title="Tiles left in the pool">
            <TileBack /> {view.poolCount}
          </span>
        </div>
        {view.online && <span className="code-chip">{view.roomCode}</span>}
        <button className="btn icon-btn ghost" onClick={() => setEmotes((x) => !x)} aria-label="React">
          ☺
        </button>
      </header>
      {netState !== 'online' && netDetail && <div className="net-banner">{netDetail}</div>}

      <div className="opponents">
        {others.map((i) => (
          <SeatPlate
            key={i}
            index={i}
            seat={view.seats[i]!}
            active={playing && view.turn === i}
            secondsLeft={view.turn === i ? secondsLeft : null}
            emote={view.emotes.filter((e) => e.seat === i).slice(-1)[0]}
            canBotify={view.isHost && view.online && !view.seats[i]!.isHost && (view.seats[i]!.standIn || (!view.seats[i]!.isBot && !view.seats[i]!.online))}
            onBotify={() => send({ type: 'botify', seat: i })}
          />
        ))}
      </div>

      <div className="board-wrap">
        <div className="mat">
          <div ref={boardRef} className={`board ${fits ? '' : 'scroll'}`} style={{ '--tw': `${tw}px` } as React.CSSProperties}>
            {table.length === 0 && !myTurn && <div className="board-empty">The table is empty</div>}
            <div className="sets">
              {table.map((set, i) => (
                <div
                  key={`${i}:${set[0]}`}
                  className={`set ${bad.has(i) ? 'bad' : ''} ${hover === `set:${i}` || hover?.startsWith(`set:${i}:`) ? 'hover' : ''}`}
                  data-drop={`set:${i}`}
                  onClick={(e) => e.target === e.currentTarget && selected.size > 0 && doMove([...selected], { kind: 'set', index: i })}
                >
                  {set.map((id, j) => (
                    <TileView
                      key={id}
                      tile={tileOf(id)}
                      data-drop={`set:${i}:${j}`}
                      selected={selected.has(id)}
                      glow={glow.has(id)}
                      mine={myTurn && handSet.has(id)}
                      ghost={!!ghost?.ids.includes(id)}
                      onPointerDown={grab(id, false)}
                    />
                  ))}
                </div>
              ))}
              {myTurn && (
                <button
                  className={`new-set ${hover === 'new' ? 'hover' : ''} ${selected.size ? 'ready' : ''}`}
                  data-drop="new"
                  onClick={() => selected.size && doMove([...selected], { kind: 'new' })}
                >
                  New set
                </button>
              )}
            </div>
          </div>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div key={toast.id} className="toast" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="status-row">
        {me && (
          <SeatPlate
            seat={me}
            index={you!}
            you
            active={myTurn}
            secondsLeft={myTurn ? secondsLeft : null}
            emote={view.emotes.filter((e) => e.seat === you).slice(-1)[0]}
            compact
          />
        )}
        <div className="status">
          {status}
          {meldProgress !== null && (
            <span className={`meld ${meldProgress >= view.firstMeld ? 'ok' : ''}`}>
              {meldProgress} / {view.firstMeld}
            </span>
          )}
        </div>
      </div>

      <div className="rack-area">
        <div ref={rackRef} className={`rack ${hover?.startsWith('rack') ? 'hover' : ''}`} data-drop="rack" style={{ '--tw': `${rackTw}px`, minHeight: rackRows * rackTw * 1.34 + (rackRows - 1) * 5 } as React.CSSProperties} onClick={(e) => {
          if (e.target === e.currentTarget && selected.size) doMove([...selected].filter((id) => handSet.has(id) && onTable.has(id)), { kind: 'rack' });
        }}>
          {rack.map((id, k) => (
            <TileView
              key={id}
              tile={tileOf(id)}
              data-drop={`rack:${k}`}
              selected={selected.has(id)}
              glow={fresh.has(id)}
              ghost={!!ghost?.ids.includes(id)}
              onPointerDown={grab(id, true)}
            />
          ))}
          {rack.length === 0 && <div className="rack-empty">{myTurn ? 'All your tiles are on the table' : ''}</div>}
        </div>
        <div className="controls">
          <div className="seg small-seg">
            <button className={sortBy === 'color' ? 'on' : ''} onClick={() => sortRack('color')} title="Sort by colour: runs line up">
              <span>Runs</span>
            </button>
            <button className={sortBy === 'number' ? 'on' : ''} onClick={() => sortRack('number')} title="Sort by number: groups line up">
              <span>Groups</span>
            </button>
          </div>
          {myTurn && (
            <>
              <button className="btn small" disabled={!history.length} onClick={undo}>
                Undo
              </button>
              <button className="btn small" disabled={!changed} onClick={reset}>
                Reset
              </button>
              <button
                className="btn small"
                disabled={hinting}
                onClick={() => {
                  setHinting(true);
                  send({ type: 'hint' });
                }}
              >
                {hinting ? '…' : 'Hint'}
              </button>
              {changed ? (
                <button className="btn primary" disabled={!!check?.error} onClick={() => work && send({ type: 'commit', table: work })}>
                  Done
                </button>
              ) : (
                <button className="btn primary" onClick={() => send({ type: 'draw' })}>
                  {view.poolCount ? 'Draw' : 'Pass'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y, '--tw': `${Math.max(tw, 36)}px` } as React.CSSProperties}>
          {ghost.ids.map((id) => (
            <TileView key={id} tile={tileOf(id)} selected />
          ))}
        </div>
      )}

      <AnimatePresence>
        {emotes && (
          <motion.div className="emote-picker panel" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
            {EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => {
                  send({ type: 'emote', emoji: e });
                  setEmotes(false);
                }}
              >
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <RoundEnd view={view} send={send} onLeave={() => onLeave()} />

      <Modal open={menu} onClose={() => setMenu(false)}>
        <div className="menu">
          <h2 className="serif">Rummy Tiles</h2>
          {view.online && (
            <button
              className="btn"
              onClick={async () => {
                const r = await shareInvite(view.roomCode, inviteLink(view.roomCode));
                if (r === 'copied') say('Invite link copied');
                setMenu(false);
              }}
            >
              Invite link · {view.roomCode}
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              setMuted(!muted);
              setMute(!muted);
            }}
          >
            Sound: {muted ? 'off' : 'on'}
          </button>
          <button
            className="btn"
            onClick={() => {
              setMenu(false);
              setRules(true);
            }}
          >
            How to play
          </button>
          <button className="btn ghost" onClick={() => onLeave(true)}>
            {view.isHost && view.online ? 'Leave (you can resume this table later)' : view.isHost ? 'Leave (resume later)' : 'Leave the table'}
          </button>
          <button className="btn primary" onClick={() => setMenu(false)}>
            Back to the game
          </button>
        </div>
      </Modal>
      <Modal open={rules} onClose={() => setRules(false)} wide>
        <Rules />
        <div className="modal-actions">
          <button className="btn primary" onClick={() => setRules(false)}>
            Back to the game
          </button>
        </div>
      </Modal>
    </div>
  );
}

function SeatPlate({
  seat,
  index,
  you,
  active,
  secondsLeft,
  emote,
  compact,
  canBotify,
  onBotify,
}: {
  seat: SeatView;
  index: number;
  you?: boolean;
  active: boolean;
  secondsLeft: number | null;
  emote?: { id: number; emoji: string };
  compact?: boolean;
  canBotify?: boolean;
  onBotify?: () => void;
}) {
  const [shown, setShown] = useState<{ id: number; emoji: string } | null>(null);
  const seen = useRef(emote?.id ?? 0);
  useEffect(() => {
    if (!emote || emote.id === seen.current) return;
    seen.current = emote.id;
    setShown(emote);
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
  }, [emote]);
  return (
    <div className={`plate seat-plate p${index % 4} ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}>
      <Avatar seat={seat} you={!!you} size={compact ? 32 : 34} index={index} />
      <div className="seat-text">
        <div className="nm">
          {seat.name}
          {seat.isBot && <span className="tag">Bot</span>}
          {!seat.online && <span className="tag">Away</span>}
        </div>
        <div className="sub">
          <span className="count">
            <TileBack /> {seat.tileCount}
          </span>
          {!compact && (
            <span className="mini-rack" aria-hidden>
              {Array.from({ length: Math.min(seat.tileCount, 12) }, (_, k) => (
                <i key={k} />
              ))}
            </span>
          )}
          <span className={`score ${seat.score < 0 ? 'neg' : ''}`}>{seat.score > 0 ? `+${seat.score}` : seat.score}</span>
          {secondsLeft !== null && <span className={`clock ${secondsLeft <= 10 ? 'low' : ''}`}>{secondsLeft}s</span>}
        </div>
      </div>
      {canBotify && (
        <button className="btn small ghost botify" onClick={onBotify}>
          {seat.isBot ? 'Hand back' : 'Bot plays'}
        </button>
      )}
      <AnimatePresence>
        {shown && (
          <motion.div key={shown.id} className="emote-bubble" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, y: -8 }}>
            {shown.emoji}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RoundEnd({ view, send, onLeave }: { view: PlayerView; send: (a: Action) => void; onLeave: () => void }) {
  const r = view.result;
  const open = view.phase === 'roundEnd' && !!r;
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [view.round]);
  if (!r) return null;
  const winner = view.seats[r.winner]?.name ?? 'Someone';
  const order = view.seats.map((_, i) => i).sort((a, b) => (view.seats[b]?.score ?? 0) - (view.seats[a]?.score ?? 0));
  return (
    <>
      <Modal open={open && !hidden} wide>
        <div className="round-end">
          <div className="label">Round {view.round}</div>
          <h2 className="serif">{r.winner === view.you ? 'You won the round!' : `${winner} won the round`}</h2>
          <p className="dim">{r.reason === 'out' ? `${winner} emptied their rack.` : 'The pool ran out and nobody could play: the lowest rack wins.'}</p>
          <div className="results">
            {order.map((i) => {
              const seat = view.seats[i]!;
              return (
                <div key={i} className={`result-row ${i === r.winner ? 'winner' : ''}`}>
                  <Avatar seat={seat} you={i === view.you} size={30} index={i} />
                  <div className="who">
                    <div className="nm">{seat.name}</div>
                    <div className="left-tiles" style={{ '--tw': '22px' } as React.CSSProperties}>
                      {r.racks[i].length === 0 ? <span className="dim">Out!</span> : sortTiles(r.racks[i], 'color').map((t) => <TileView key={t.id} tile={t} />)}
                    </div>
                  </div>
                  <div className={`delta ${r.deltas[i] < 0 ? 'neg' : 'pos'}`}>{r.deltas[i] > 0 ? `+${r.deltas[i]}` : r.deltas[i]}</div>
                  <div className="total">{seat.score}</div>
                </div>
              );
            })}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setHidden(true)}>
              See the table
            </button>
            {view.isHost ? (
              <>
                <button className="btn" onClick={() => send({ type: 'newGame' })}>
                  {view.online ? 'New game' : 'New game'}
                </button>
                <button className="btn primary" onClick={() => send({ type: 'nextRound' })}>
                  Next round
                </button>
              </>
            ) : (
              <span className="note">Waiting for the host…</span>
            )}
          </div>
        </div>
      </Modal>
      {open && hidden && (
        <div className="reopen">
          <button className="btn primary" onClick={() => setHidden(false)}>
            Scores
          </button>
          {!view.isHost && (
            <button className="btn ghost" onClick={onLeave}>
              Leave
            </button>
          )}
        </div>
      )}
    </>
  );
}
