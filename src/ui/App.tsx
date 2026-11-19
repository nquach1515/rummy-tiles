import { motion } from 'framer-motion';
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { GameConnection, getClientId, LocalConnection, RemoteConnection } from '../net/client';
import { clearSavedHost, HostController, loadSavedHost, randomCode } from '../net/host';
import { Settings } from '../net/protocol';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Table } from './Table';

export type StartMode =
  | { kind: 'host' }
  | { kind: 'practice'; settings: Settings; bots: number }
  | { kind: 'join'; code: string }
  | { kind: 'resume' }
  | { kind: 'resumeSolo' };

function useConnection(conn: GameConnection | null) {
  const subscribe = useCallback((fn: () => void) => (conn ? conn.subscribe(fn) : () => {}), [conn]);
  const view = useSyncExternalStore(subscribe, () => conn?.view() ?? null);
  const status = useSyncExternalStore(subscribe, () => {
    const s = conn?.status();
    return s ? `${s.state}|${s.detail}` : '';
  });
  const [state, detail] = status.split('|');
  return { view, status: { state, detail } };
}

export function App() {
  const [conn, setConn] = useState<GameConnection | null>(null);
  const { view, status } = useConnection(conn);

  const start = (mode: StartMode, name: string) => {
    const clientId = getClientId();
    let c: GameConnection;
    if (mode.kind === 'join') {
      c = new RemoteConnection(mode.code.toUpperCase(), clientId, name);
      setRoomInUrl(mode.code.toUpperCase());
    } else if (mode.kind === 'resume') {
      const saved = loadSavedHost()!;
      c = new LocalConnection(new HostController(saved.code, clientId, name, true, saved));
      setRoomInUrl(saved.code);
    } else if (mode.kind === 'resumeSolo') {
      const saved = loadSavedHost('solo')!;
      c = new LocalConnection(new HostController('SOLO', clientId, name, false, saved));
    } else if (mode.kind === 'host') {
      clearSavedHost();
      const code = randomCode();
      c = new LocalConnection(new HostController(code, clientId, name, true));
      setRoomInUrl(code);
    } else {
      clearSavedHost('solo');
      const host = new HostController('SOLO', clientId, name, false, undefined, mode.settings);
      for (let seat = 1; seat <= mode.bots; seat++) host.handle(clientId, { type: 'addBot', seat });
      host.handle(clientId, { type: 'start' });
      c = new LocalConnection(host);
    }
    setConn(c);
  };

  /** keep: leave the game saved on this device, to resume from the home screen (host or bot game only) */
  const leave = (keep = false) => {
    if (conn instanceof LocalConnection && !keep) clearSavedHost(conn.host.online ? 'table' : 'solo');
    conn?.leave();
    setConn(null);
    setRoomInUrl(null);
  };

  let screen: JSX.Element;
  let key: string;
  if (!conn) {
    key = 'home';
    screen = <Home onStart={start} />;
  } else if (!view) {
    key = 'connecting';
    screen = <Connecting state={status.state} detail={status.detail} onCancel={() => leave()} />;
  } else if (view.phase === 'lobby') {
    key = 'lobby';
    screen = <Lobby view={view} send={(a) => conn.send(a)} onLeave={() => leave()} netState={status.state} netDetail={status.detail} />;
  } else {
    key = 'table';
    screen = <Table view={view} send={(a) => conn.send(a)} onLeave={leave} netState={status.state} netDetail={status.detail} />;
  }

  // the game screen is locked to the window; the others scroll as a page
  const locked = key === 'table';
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('locked', locked);
    if (!locked) window.scrollTo(0, 0);
  }, [locked]);

  return (
    <>
      <div className="backdrop" />
      {/* the new screen fades in straight away: waiting on the old one's exit animation could leave it stuck on screen */}
      {/* opacity only: a transform here would make the dialogs inside position against this (page-tall) screen */}
      <motion.div key={key} className={`screen ${locked ? 'fixed' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
        {screen}
      </motion.div>
    </>
  );
}

function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

function Connecting({ state, detail, onCancel }: { state: string; detail: string; onCancel: () => void }) {
  return (
    <div className="home">
      <div className="panel mode-card connecting">
        {state === 'rejected' || state === 'error' ? (
          <div className="err">{detail || 'Could not connect'}</div>
        ) : (
          <div className="row">
            <div className="spinner" />
            <span>{detail || 'Finding the table…'}</span>
          </div>
        )}
        <button className="btn small" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
