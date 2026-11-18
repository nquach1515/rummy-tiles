import { motion } from 'framer-motion';
import { useState } from 'react';
import type { Difficulty } from '../game/bot';
import { tileOf } from '../game/tiles';
import { loadSavedHost } from '../net/host';
import { DEFAULT_SETTINGS } from '../net/protocol';
import { StartMode } from './App';
import { Modal, Rules, Seg } from './common';
import { TileView } from './TileView';

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

const LOGO = ['r7a', 'b7a', 'j1', 'o7a', 'k7a'];

export function Home({ onStart }: { onStart: (mode: StartMode, name: string) => void }) {
  const [name, setName] = useState(savedName);
  const invite = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [code, setCode] = useState(/^[A-Z]{4}$/.test(invite) ? invite : '');
  const [solo, setSolo] = useState(() => prefs('rt-solo', { bots: 3, difficulty: 'normal' as Difficulty, firstMeld: 30 }));
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
        <div className="logo-tiles" aria-hidden>
          {LOGO.map((id, i) => (
            <motion.div
              key={id}
              initial={{ y: 40, opacity: 0, rotate: 0 }}
              animate={{ y: Math.abs(i - 2) * 7, opacity: 1, rotate: (i - 2) * 7 }}
              transition={{ delay: 0.08 * i, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <TileView tile={tileOf(id)} />
            </motion.div>
          ))}
        </div>
        <div className="wordmark">
          <div className="big">Rummy Tiles</div>
          <div className="sub">Runs · Groups · Jokers</div>
        </div>
        <p className="tagline">Make runs and groups, rearrange the table, and be first to empty your rack. Free with friends or bots.</p>

        <div className="name-row">
          <span className="label">Your name</span>
          <input className="input" value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
        </div>

        {invite && /^[A-Z]{4}$/.test(invite) && (
          <motion.div className="panel invite-card" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <div>
              <div className="label">You're invited</div>
              <div className="serif invite-title">Table {invite}</div>
            </div>
            <button className="btn primary" onClick={() => go({ kind: 'join', code: invite })}>
              Take a seat
            </button>
          </motion.div>
        )}

        <div className="mode-cards">
          <motion.div className="panel mode-card" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
            <h3>Play with friends</h3>
            <p>Host a table and share the link, or join with a code. Empty seats can be bots.</p>
            {saved && saved.state.phase !== 'lobby' && (
              <button className="btn" onClick={() => go({ kind: 'resume' })}>
                Resume your table {saved.code}
              </button>
            )}
            <button className="btn primary" onClick={() => go({ kind: 'host' })}>
              Host a table
            </button>
            <div className="divider">or join</div>
            <div className="row">
              <input
                className="input code grow"
                value={code}
                maxLength={4}
                placeholder="CODE"
                onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && go({ kind: 'join', code })}
              />
              <button className="btn" disabled={code.length !== 4} onClick={() => go({ kind: 'join', code })}>
                Join
              </button>
            </div>
          </motion.div>

          <motion.div className="panel mode-card" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.18 }}>
            <h3>Play against bots</h3>
            <p>A game on this device, right away.</p>
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
            {savedSolo && (
              <button className="btn" onClick={() => go({ kind: 'resumeSolo' })}>
                Resume your game
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => go({ kind: 'practice', bots: solo.bots, settings: { ...DEFAULT_SETTINGS, difficulty: solo.difficulty, firstMeld: solo.firstMeld } })}
            >
              Deal me in
            </button>
          </motion.div>
        </div>
        <div className="foot">
          <button className="link" onClick={() => setRules(true)}>
            How to play
          </button>
          <div className="version">v{__APP_VERSION__} · {__BUILD_SHA__}</div>
        </div>
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
