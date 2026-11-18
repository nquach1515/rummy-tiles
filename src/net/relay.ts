/*
 * Connection to the message relay (relay/ in this repo, a Cloudflare Worker). Everyone, host included, connects to it
 * over a WebSocket, which works through VPNs and work networks that block browser-to-browser WebRTC. The relay only
 * forwards messages; the game itself runs in the host's browser.
 */

/**
 * The relay answers on the site's own hostname (site/worker.js passes /room/* to it), so a network that lets the page
 * load lets the game connect too. VITE_RELAY_URL overrides it, for local testing against `wrangler dev`.
 */
export const RELAY_URL: string =
  import.meta.env?.VITE_RELAY_URL ??
  (typeof location !== 'undefined' ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` : 'ws://localhost:8787');

export function roomUrl(code: string, role: 'host' | 'player') {
  return `${RELAY_URL}/room/${code}?role=${role}`;
}

/**
 * How often we ping the relay, how long a connection may stay silent before we count it dead (on screen, and in a
 * background tab, whose timers the browser slows down), and how long opening may take. Pings are a few bytes each and
 * the relay answers them without waking up, so pinging often costs next to nothing and finds a dead connection fast.
 */
export const PING_MS = 5000;
const SILENT_MS = 12000;
const SILENT_HIDDEN_MS = 60000;
const OPEN_MS = 8000;
/** After the network comes back, the page returns to the screen, or the player acts on a quiet connection: how long to wait for an answer to a ping. */
const PROBE_MS = 3000;
/** A gap this long between our once-a-second checks means our page was frozen, not that the connection went quiet. */
const FROZEN_MS = 4000;
/** A player's action on a connection quiet for this long checks it first. */
const QUIET_MS = 5000;

/**
 * Watches one socket for the ways phone connections fail, which mostly don't fire `close`: a connection that dies
 * silently (cell tower handoffs, dead zones, Wi-Fi to data, the phone locking or switching apps) and one that hangs
 * while opening. Pings the relay (which answers 'pong' itself) every PING_MS; `onDead` runs once if the socket isn't
 * open within OPEN_MS, if nothing at all arrives for SILENT_MS, or if a ping after the network returns (or the page
 * comes back on screen, or the player acts on a quiet connection) goes unanswered for PROBE_MS. The caller then drops the socket and reconnects. Call `heard()`
 * on every message; the returned `stop()` ends the watch.
 */
export function watchSocket(ws: WebSocket, onDead: (why: string) => void): { heard: () => void; stop: () => void; acting: () => void } {
  const opened = Date.now();
  let lastHeard = opened;
  let lastPing = 0;
  let probeBy = 0;
  let done = false;
  const ping = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send('ping');
    } catch {
      /* the check below catches a dead socket */
    }
    lastPing = Date.now();
  };
  const dead = (why: string) => {
    if (done) return;
    stop();
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    onDead(why);
  };
  let lastTick = opened;
  const tick = () => {
    const now = Date.now();
    // Our own timers stopped for a while (the page was frozen: phone locked, app in the background, or busy). The
    // silence was ours, not the connection's, and messages that arrived meanwhile may not be processed yet: ask first,
    // and only count the socket dead if that goes unanswered.
    const frozen = now - lastTick > FROZEN_MS;
    lastTick = now;
    if (frozen && ws.readyState === WebSocket.OPEN) {
      lastHeard = Math.max(lastHeard, now - PING_MS);
      if (!probeBy) {
        probeBy = now + PROBE_MS;
        ping();
      }
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      if (now - opened > OPEN_MS) dead('open timed out');
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return; // close is on its way and handled by the caller
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (now - lastHeard > (hidden ? SILENT_HIDDEN_MS : SILENT_MS)) return dead('silent');
    if (probeBy && now > probeBy) return dead('no answer after resume');
    if (now - lastPing >= PING_MS) ping();
  };
  // the network came back, or the page is back on screen: the socket may have died meanwhile, so ask right away
  const probe = () => {
    if (ws.readyState !== WebSocket.OPEN || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    probeBy = Date.now() + PROBE_MS;
    ping();
  };
  const timer = setInterval(tick, 1000);
  if (typeof window !== 'undefined') window.addEventListener('online', probe);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', probe);
  function stop() {
    if (done) return;
    done = true;
    clearInterval(timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', probe);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', probe);
  }
  return {
    heard: () => {
      lastHeard = Date.now();
      probeBy = 0;
    },
    // the player just did something: if the connection has been quiet a while, make sure it's alive right now
    acting: () => {
      if (!probeBy && Date.now() - lastHeard > QUIET_MS) probe();
    },
    stop,
  };
}

/** The host's end of one player's connection, relayed through the host's own socket. */
export class PlayerLink {
  open = true;
  private onData: ((msg: unknown) => void)[] = [];
  private onClose: (() => void)[] = [];
  constructor(
    public id: string,
    private socket: WebSocket,
  ) {}
  on(ev: 'data', fn: (msg: unknown) => void): void;
  on(ev: 'close', fn: () => void): void;
  on(ev: 'data' | 'close', fn: ((msg: unknown) => void) | (() => void)) {
    if (ev === 'data') this.onData.push(fn as (msg: unknown) => void);
    else this.onClose.push(fn as () => void);
  }
  send(data: unknown) {
    if (this.open && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ to: this.id, data }));
  }
  close() {
    if (!this.open) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ to: this.id, close: true }));
    this.closed();
  }
  /** @internal */
  deliver(msg: unknown) {
    for (const fn of this.onData) fn(msg);
  }
  /** @internal */
  closed() {
    if (!this.open) return;
    this.open = false;
    for (const fn of this.onClose) fn();
  }
}
