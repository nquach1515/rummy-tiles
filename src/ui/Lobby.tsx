import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Action, PlayerView } from '../net/protocol';
import { inviteLink } from '../net/site';
import { Avatar, Seg, SHARE_INVITES, shareInvite } from './common';
import { LetterTile, reducedMotion } from './TileView';

export function Lobby({
  view,
  send,
  onLeave,
  netState,
  netDetail,
}: {
  view: PlayerView;
  send: (a: Action) => void;
  onLeave: () => void;
  netState: string;
  netDetail: string;
}) {
  const [shared, setShared] = useState('');
  const [editing, setEditing] = useState(false);
  const me = view.you !== null ? view.seats[view.you] : null;
  const [name, setName] = useState(me?.name ?? '');
  const seated = view.seats.filter(Boolean).length;
  const url = inviteLink(view.roomCode);
  const s = view.settings;
  // your seat comes first, then the others in turn order
  const order = view.seats.map((_, i) => i).sort((a, b) => ((a - (view.you ?? 0) + 4) % 4) - ((b - (view.you ?? 0) + 4) % 4));

  const invite = async () => {
    const r = await shareInvite(view.roomCode, url);
    if (r === 'copied') {
      setShared('Link copied');
      setTimeout(() => setShared(''), 2000);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-inner">
        <section className="lobby-head">
          <div className="label">Table code</div>
          <div className="code-rack">
            {view.roomCode.split('').map((c, i) => (
              <motion.div
                key={i}
                initial={reducedMotion() ? false : { y: -60, opacity: 0, rotate: 0 }}
                animate={{ y: 0, opacity: 1, rotate: [-3, 2, -1, 3][i] }}
                transition={{ delay: 0.1 + i * 0.07, type: 'spring', stiffness: 420, damping: 15 }}
              >
                <LetterTile ch={c} color={(['r', 'b', 'o', 'k'] as const)[i]} />
              </motion.div>
            ))}
          </div>
          <div className="row wrap-center">
            <button className="btn primary" onClick={invite}>
              {SHARE_INVITES ? 'Invite friends' : 'Copy invite link'}
            </button>
            <AnimatePresence>
              {shared && (
                <motion.span className="note" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  {shared}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {netState !== 'online' && netDetail && <div className="err">{netDetail}</div>}
        </section>

        <section className="panel guest-list">
          <div className="guest-head">
            <h3 className="serif">At the table</h3>
            <span className="guest-count">
              {seated}
              <span className="dim">/4</span>
            </span>
          </div>
          <ol>
            {order.map((i, k) => {
              const seat = view.seats[i];
              return (
                <motion.li
                  key={i}
                  className={`guest p${i % 4} ${seat ? 'taken' : 'open'}`}
                  initial={reducedMotion() ? false : { x: -16, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.12 + k * 0.06 }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {seat ? (
                      <motion.div key={`in:${seat.name}:${seat.isBot}`} className="guest-in" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', stiffness: 460, damping: 22 }}>
                        <Avatar seat={seat} you={i === view.you} index={i} size={40} />
                      </motion.div>
                    ) : (
                      <motion.div key="open" className="seat-hole" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                    )}
                  </AnimatePresence>
                  <div className="guest-text">
                    {seat ? (
                      i === view.you && editing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            send({ type: 'rename', name });
                            setEditing(false);
                          }}
                        >
                          <input className="input small" autoFocus value={name} maxLength={16} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
                        </form>
                      ) : (
                        <div className="nm" onClick={() => i === view.you && setEditing(true)} title={i === view.you ? 'Change your name' : undefined}>
                          {seat.name}
                          {i === view.you && <span className="edit">✎</span>}
                        </div>
                      )
                    ) : (
                      <div className="nm dim">Open seat</div>
                    )}
                    {seat && (
                      <div className="tags">
                        {seat.isHost && <span className="tag gold">Host</span>}
                        {seat.isBot && <span className="tag">Bot</span>}
                        {i === view.you && <span className="tag us">You</span>}
                        {!seat.online && <span className="tag">Away</span>}
                      </div>
                    )}
                  </div>
                  <div className="guest-act">
                    {seat && view.isHost && !seat.isHost && (
                      <button className="btn small ghost" onClick={() => send({ type: 'removeSeat', seat: i })}>
                        Remove
                      </button>
                    )}
                    {!seat && view.isHost && (
                      <button className="btn small" onClick={() => send({ type: 'addBot', seat: i })}>
                        + Bot
                      </button>
                    )}
                    {!seat && !view.isHost && view.you !== null && (
                      <button className="btn small ghost" onClick={() => send({ type: 'sit', seat: i })}>
                        Sit here
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </section>

        <section className="lobby-side">
          <div className="panel settings-row">
            <h3 className="serif">House rules</h3>
            <div className="opt-row">
              <span className="label">Opening</span>
              <Seg
                value={s.firstMeld}
                disabled={!view.isHost}
                options={[
                  [30, '30 points'],
                  [0, 'Any'],
                ]}
                onChange={(firstMeld) => send({ type: 'settings', settings: { firstMeld } })}
              />
            </div>
            <div className="opt-row">
              <span className="label">Turns</span>
              <Seg
                value={s.turnSeconds}
                disabled={!view.isHost}
                options={[
                  [0, 'No limit'],
                  [60, '1 min'],
                  [90, '1½ min'],
                  [120, '2 min'],
                ]}
                onChange={(turnSeconds) => send({ type: 'settings', settings: { turnSeconds } })}
              />
            </div>
            <div className="opt-row">
              <span className="label">Bots</span>
              <Seg
                value={s.difficulty}
                disabled={!view.isHost}
                options={[
                  ['easy', 'Easy'],
                  ['normal', 'Normal'],
                  ['hard', 'Hard'],
                ]}
                onChange={(difficulty) => send({ type: 'settings', settings: { difficulty } })}
              />
            </div>
            {s.turnSeconds > 0 && <div className="opt-note">When time runs out, a legal arrangement is played; otherwise the tiles go back and you draw.</div>}
          </div>

          <div className="lobby-actions">
            <button className="btn ghost" onClick={onLeave}>
              Leave
            </button>
            {view.isHost ? (
              <button className="btn primary big" disabled={seated < 2} onClick={() => send({ type: 'start' })}>
                {seated < 2 ? 'Waiting for players' : `Start with ${seated}`}
              </button>
            ) : (
              <span className="note">Waiting for the host to start…</span>
            )}
          </div>
          {view.error && <div className="err">{view.error.text}</div>}
        </section>
      </div>
    </div>
  );
}
