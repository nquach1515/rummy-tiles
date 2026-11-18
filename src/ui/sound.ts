/** Quiet, synthesised table sounds: a soft tap when a tile lands, a gentle two-note chime when it's your turn. */
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('rt-muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('rt-muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** A short wooden tap. */
export function tap(volume = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.04);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1800;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = 0.11 * volume;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

function note(a: AudioContext, freq: number, at: number, dur: number, vol: number) {
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

export function yourTurn() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  note(a, 660, t, 0.35, 0.04);
  note(a, 880, t + 0.12, 0.45, 0.035);
}

export function win() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => note(a, f, t + i * 0.11, 0.5, 0.035));
}
