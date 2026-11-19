import { motion } from 'framer-motion';
import { useState } from 'react';
import { Action, PlayerView } from '../net/protocol';
import { inviteLink } from '../net/site';
import { Avatar, Seg, SHARE_INVITES, shareInvite } from './common';
import { LetterTile } from './TileView';

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
  const place = (i: number) => (i - (view.you ?? 0) + 4) % 4;

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
        <div className="label">Table code</div>
        <div className="room-code">
          {view.roomCode.split('').map((c, i) => (
            <motion.div key={i} initial={{ y: -16, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: [-3, 2, -1, 3][i] }} transition={{ delay: i * 0.06 }}>
              <LetterTile ch={c} color={(['r', 'b', 'o', 'k'] as const)[i]} />
            </motion.div>
          ))}
        </div>
        <div className="row wrap-center">
          <button className="btn primary" onClick={invite}>
            {SHARE_INVITES ? 'Invite friends' : 'Copy invite link'}
          </button>
          {shared && <span className="note">{shared}</span>}
        </div>
        {netState !== 'online' && netDetail && <div className="err">{netDetail}</div>}

        <div className="seat-grid">
          {view.seats.map((seat, i) => (
            <div key={i} className={`lobby-seat ${seat ? 'taken' : 'empty'}`} style={{ order: place(i) }}>
              {seat ? (
                <>
                  <Avatar seat={seat} you={i === view.you} index={i} />
                  {i === view.you && editing ? (
                    <form
                      className="rename"
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
                  )}
                  <div className="tags">
                    {seat.isHost && <span className="tag gold">Host</span>}
                    {seat.isBot && <span className="tag">Bot</span>}
                    {i === view.you && <span className="tag us">You</span>}
                    {!seat.online && <span className="tag">Away</span>}
                  </div>
                  {view.isHost && !seat.isHost && (
                    <button className="btn small ghost" onClick={() => send({ type: 'removeSeat', seat: i })}>
                      Remove
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="nm dim">Open seat</div>
                  <div className="actions">
                    {view.isHost && (
                      <button className="btn small" onClick={() => send({ type: 'addBot', seat: i })}>
                        Add a bot
                      </button>
                    )}
                    {!view.isHost && view.you !== null && (
                      <button className="btn small ghost" onClick={() => send({ type: 'sit', seat: i })}>
                        Sit here
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="panel settings-row">
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

        <div className="row wrap-center">
          <button className="btn ghost" onClick={onLeave}>
            Leave
          </button>
          {view.isHost ? (
            <button className="btn primary" disabled={seated < 2} onClick={() => send({ type: 'start' })}>
              {seated < 2 ? 'Waiting for players' : `Start with ${seated}`}
            </button>
          ) : (
            <span className="note">Waiting for the host to start…</span>
          )}
        </div>
        {view.error && <div className="err">{view.error.text}</div>}
      </div>
    </div>
  );
}
