import { motion } from 'framer-motion';
import { ReactNode, useState } from 'react';
import type { Difficulty } from '../game/bot';
import { loadSavedHost } from '../net/host';
import { DEFAULT_SETTINGS } from '../net/protocol';
import { StartMode } from './App';
import { Modal, Rules, Seg } from './common';
import { LetterTile, reducedMotion } from './TileView';

function savedName(): string {
  try {
    return localStorage.getItem('rt-name') ?? '';
  } catch {
    return '';
  }
}

function prefs<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

const COLORS = ['r', 'b', 'o', 'k'] as const;
type Choice = 'bots' | 'host' | 'join';

export function Home({ onStart }: { onStart: (mode: StartMode, name: string) => void }) {
  const [name, setName] = useState(savedName);
  const invite = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const invited = /^[A-Z]{4}$/.test(invite);
  const [code, setCode] = useState(invited ? invite : '');
  const [solo, setSolo] = useState(() => prefs('rt-solo', { bots: 3, difficulty: 'normal' as Difficulty, firstMeld: 30 }));
  const [choice, setChoice] = useState<Choice>(invited ? 'join' : 'bots');
  const [rules, setRules] = useState(false);
  const saved = loadSavedHost();
  const savedSolo = loadSavedHost('solo');
  const go = (mode: StartMode) => {
    const n = name.trim().slice(0, 16) || 'Player';
    try {
      localStorage.setItem('rt-name', n);
      localStorage.setItem('rt-solo', JSON.stringify(solo));
    } catch {
      /* ignore */
    }
    onStart(mode, n);
  };
  const setSoloPref = (p: Partial<typeof solo>) => setSolo({ ...solo, ...p });

  return (
    <div className="home">
      <div className="home-inner">
        <section className="hero">
          <h1 className="title-racks" aria-label="Rummy Tiles">
            {['RUMMY', 'TILES'].map((word, w) => (
              <div key={word} className="title-rack">
                <div className="title-row">
                  {word.split('').map((ch, k) => (
                    <TitleLetter key={k} ch={ch} color={COLORS[(k + w) % 4]} delay={0.08 + 0.06 * (k + w * 5)} tilt={((k * 7 + w * 3) % 5) - 2} />
                  ))}
                </div>
              </div>
            ))}
          </h1>
          <p className="tagline">Make runs and groups, rearrange the table, and be first to empty your rack. Free with friends or bots.</p>
          <label className="nametag">
            <span className="nametag-top">
              <b>Hello</b>my name is
            </span>
            <input className="nametag-input" value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
          </label>
        </section>

        <section className="choices">
          {invited && (
            <motion.div className="invite-banner" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <span>You're invited to table</span>
              <b>{invite}</b>
            </motion.div>
          )}
          <div className="choice-grid" role="tablist">
            <ChoiceTile on={choice === 'bots'} onClick={() => setChoice('bots')} title="Play bots" sub="On this device" delay={0.35} icon={<BotIcon />} />
            <ChoiceTile on={choice === 'host'} onClick={() => setChoice('host')} title="Host" sub="Invite friends" delay={0.42} icon={<TableIcon />} />
            <ChoiceTile on={choice === 'join'} onClick={() => setChoice('join')} title="Join" sub="With a code" delay={0.49} icon={<KeyIcon />} />
          </div>

          {/* no exit animation: waiting on the old sheet's exit (with a Seg pill mid-slide inside) can leave no sheet at all */}
          <motion.div
              key={choice}
              className="panel choice-sheet"
              initial={reducedMotion() ? false : { y: 14, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {choice === 'bots' && (
                <>
                  <div className="opt-row">
                    <span className="label">Bots</span>
                    <Seg value={solo.bots} options={[[1, '1'], [2, '2'], [3, '3']]} onChange={(bots) => setSoloPref({ bots })} />
                  </div>
                  <div className="opt-row">
                    <span className="label">Level</span>
                    <Seg
                      value={solo.difficulty}
                      options={[
                        ['easy', 'Easy'],
                        ['normal', 'Normal'],
                        ['hard', 'Hard'],
                      ]}
                      onChange={(difficulty) => setSoloPref({ difficulty })}
                    />
                  </div>
                  <div className="opt-row">
                    <span className="label">Opening</span>
                    <Seg
                      value={solo.firstMeld}
                      options={[
                        [30, '30 points'],
                        [0, 'Any'],
                      ]}
                      onChange={(firstMeld) => setSoloPref({ firstMeld })}
                    />
                  </div>
                  <div className="sheet-actions">
                    {savedSolo && (
                      <button className="btn" onClick={() => go({ kind: 'resumeSolo' })}>
                        Resume your game
                      </button>
                    )}
                    <button
                      className="btn primary big"
                      onClick={() => go({ kind: 'practice', bots: solo.bots, settings: { ...DEFAULT_SETTINGS, difficulty: solo.difficulty, firstMeld: solo.firstMeld } })}
                    >
                      Deal me in
                    </button>
                  </div>
                </>
              )}
              {choice === 'host' && (
                <>
                  <p className="sheet-note">Open a table, then send the link. Empty seats can be bots, and you choose the rules before you start.</p>
                  <div className="sheet-actions">
                    {saved && saved.state.phase !== 'lobby' && (
                      <button className="btn" onClick={() => go({ kind: 'resume' })}>
                        Resume table {saved.code}
                      </button>
                    )}
                    <button className="btn primary big" onClick={() => go({ kind: 'host' })}>
                      Open a table
                    </button>
                  </div>
                </>
              )}
              {choice === 'join' && (
                <>
                  <p className="sheet-note">Type the four letters your host shared.</p>
                  <div className="code-boxes">
                    <input
                      className="input code"
                      value={code}
                      maxLength={4}
                      placeholder="CODE"
                      aria-label="Table code"
                      onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && go({ kind: 'join', code })}
                    />
                  </div>
                  <div className="sheet-actions">
                    <button className="btn primary big" disabled={code.length !== 4} onClick={() => go({ kind: 'join', code })}>
                      Take a seat
                    </button>
                  </div>
                </>
              )}
          </motion.div>
        </section>
      </div>
      <div className="foot">
        <button className="link" onClick={() => setRules(true)}>
          How to play
        </button>
        <span className="version">
          v{__APP_VERSION__} · {__BUILD_SHA__}
        </span>
      </div>
      <Modal open={rules} onClose={() => setRules(false)} wide>
        <Rules />
        <div className="modal-actions">
          <button className="btn primary" onClick={() => setRules(false)}>
            Got it
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** A title letter: drops onto its rack, and lifts when you poke it. */
function TitleLetter({ ch, color, delay, tilt }: { ch: string; color: (typeof COLORS)[number]; delay: number; tilt: number }) {
  return (
    <motion.div
      className="title-letter"
      initial={reducedMotion() ? false : { y: -120, opacity: 0, rotate: tilt * 6 }}
      animate={{ y: 0, opacity: 1, rotate: tilt }}
      transition={{ delay, type: 'spring', stiffness: 420, damping: 15 }}
      whileHover={{ y: -6, transition: { type: 'spring', stiffness: 500, damping: 15 } }}
      whileTap={{ y: -18, rotate: -tilt * 3, transition: { type: 'spring', stiffness: 500, damping: 12 } }}
    >
      <LetterTile ch={ch} color={color} />
    </motion.div>
  );
}

function ChoiceTile({ on, onClick, title, sub, icon, delay }: { on: boolean; onClick: () => void; title: string; sub: string; icon: ReactNode; delay: number }) {
  return (
    <motion.button
      role="tab"
      aria-selected={on}
      className={`choice ${on ? 'on' : ''}`}
      onClick={onClick}
      initial={reducedMotion() ? false : { y: 30, opacity: 0 }}
      animate={{ y: on ? -4 : 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24, delay: on ? 0 : delay }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="choice-icon">{icon}</span>
      <span className="choice-title">{title}</span>
      <span className="choice-sub">{sub}</span>
      {on && <motion.span layoutId="choice-pip" className="choice-pip" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
    </motion.button>
  );
}

function BotIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="8" y="12" width="24" height="20" rx="6" fill="var(--t-blue)" />
      <circle cx="16" cy="21" r="3" fill="#fff" />
      <circle cx="24" cy="21" r="3" fill="#fff" />
      <rect x="15" y="26.5" width="10" height="2.4" rx="1.2" fill="#fff" opacity=".85" />
      <rect x="19" y="5" width="2" height="7" fill="var(--t-blue)" />
      <circle cx="20" cy="5" r="2.6" fill="var(--t-red)" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="10" y="10" width="20" height="20" rx="5" fill="var(--baize)" stroke="var(--wood)" strokeWidth="2.5" />
      <circle cx="20" cy="4.5" r="3.4" fill="var(--p0)" />
      <circle cx="35.5" cy="20" r="3.4" fill="var(--p1)" />
      <circle cx="20" cy="35.5" r="3.4" fill="var(--p2)" />
      <circle cx="4.5" cy="20" r="3.4" fill="var(--p3)" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="4" y="11" width="9" height="12" rx="2.5" fill="var(--cream)" stroke="var(--edge)" strokeWidth="1.5" />
      <rect x="15.5" y="11" width="9" height="12" rx="2.5" fill="var(--cream)" stroke="var(--edge)" strokeWidth="1.5" />
      <rect x="27" y="11" width="9" height="12" rx="2.5" fill="var(--cream)" stroke="var(--edge)" strokeWidth="1.5" />
      <text x="8.5" y="20.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--t-red)" fontFamily="Fredoka">A</text>
      <text x="20" y="20.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--t-blue)" fontFamily="Fredoka">B</text>
      <text x="31.5" y="20.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--t-orange)" fontFamily="Fredoka">C</text>
      <path d="M12 31h16m-5-4 5 4-5 4" stroke="var(--accent-lo)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
