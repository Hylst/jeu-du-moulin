/* ------------------------------------------------------------------ */
/* Système audio procédural : Nine Men's Morris                       */
/* Pas de fichiers externes : tout est généré par Web Audio API.      */
/* ------------------------------------------------------------------ */

export type SoundName =
  | 'place'
  | 'move'
  | 'mill'
  | 'capture'
  | 'select'
  | 'win'
  | 'lose'
  | 'invalid'
  | 'hover'
  | 'levelUp';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicInterval: ReturnType<typeof setInterval> | null = null;
let musicEnabled = false;
let sfxEnabled = true;

function ensureCtx(): AudioContext {
  if (!ctx) {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const c: AudioContext = new Ctx();
    ctx = c;

    masterGain = c.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(c.destination);

    musicGain = c.createGain();
    musicGain.gain.value = 0.22;
    musicGain.connect(masterGain);

    sfxGain = c.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(masterGain);
  }
  return ctx;
}

function getCtxAndSfx(): { ctx: AudioContext; gain: GainNode } {
  const c = ensureCtx();
  if (!sfxGain) throw new Error('audio not initialized');
  return { ctx: c, gain: sfxGain };
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  attack = 0.01,
  release = 0.15
): void {
  const { ctx: context, gain: destination } = getCtxAndSfx();
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, context.currentTime);
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(1, context.currentTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration - release);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(context.currentTime);
  osc.stop(context.currentTime + duration);
}

function playChord(
  freqs: number[],
  duration: number,
  type: OscillatorType = 'triangle'
): void {
  freqs.forEach((f, i) => {
    setTimeout(() => playTone(f, duration, type, 0.04, 0.2), i * 40);
  });
}

/* ------------------------------- SFX -------------------------------- */

const sfx: Record<SoundName, () => void> = {
  place: () => playTone(420, 0.22, 'sine', 0.005, 0.08),
  move: () => playTone(360, 0.18, 'sine', 0.005, 0.08),
  mill: () => {
    playChord([523.25, 659.25, 783.99], 0.55, 'triangle');
    setTimeout(() => playChord([659.25, 783.99, 987.77], 0.7, 'triangle'), 160);
  },
  capture: () => {
    playTone(220, 0.12, 'sawtooth', 0.005, 0.04);
    setTimeout(() => playTone(150, 0.25, 'sawtooth', 0.01, 0.12), 80);
  },
  select: () => playTone(880, 0.08, 'sine', 0.005, 0.04),
  win: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => setTimeout(() => playTone(f, 0.35, 'triangle', 0.02, 0.1), i * 110));
  },
  lose: () => {
    const notes = [392, 349.23, 311.13, 293.66, 261.63];
    notes.forEach((f, i) => setTimeout(() => playTone(f, 0.45, 'sawtooth', 0.02, 0.15), i * 140));
  },
  invalid: () => playTone(150, 0.12, 'square', 0.005, 0.04),
  hover: () => playTone(1200, 0.04, 'sine', 0.005, 0.02),
  levelUp: () => {
    playTone(523.25, 0.18, 'triangle', 0.01, 0.06);
    setTimeout(() => playTone(659.25, 0.18, 'triangle', 0.01, 0.06), 100);
    setTimeout(() => playTone(783.99, 0.3, 'triangle', 0.01, 0.08), 200);
  },
};

export function playSound(name: SoundName): void {
  if (!sfxEnabled) return;
  try {
    ensureCtx();
    sfx[name]();
  } catch {
    // ignore audio errors
  }
}

/* ----------------------------- Ambient music ------------------------ */

const scale = [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0];

function playAmbientNote(): void {
  if (!musicEnabled || !musicGain) return;
  const c = ensureCtx();
  const freq = scale[Math.floor(Math.random() * scale.length)];
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.value = freq;
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.08, c.currentTime + 1.2);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 3.5);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(musicGain);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 3.6);
}

export function toggleMusic(enabled?: boolean): boolean {
  ensureCtx();
  musicEnabled = enabled !== undefined ? enabled : !musicEnabled;
  if (musicEnabled) {
    playAmbientNote();
    if (musicInterval) clearInterval(musicInterval);
    musicInterval = setInterval(() => {
      if (Math.random() > 0.35) playAmbientNote();
    }, 1400);
  } else if (musicInterval) {
    clearInterval(musicInterval);
    musicInterval = null;
  }
  return musicEnabled;
}

export function toggleSfx(enabled?: boolean): boolean {
  sfxEnabled = enabled !== undefined ? enabled : !sfxEnabled;
  return sfxEnabled;
}

export function isMusicOn(): boolean {
  return musicEnabled;
}

export function isSfxOn(): boolean {
  return sfxEnabled;
}

export function initAudio(): void {
  ensureCtx();
}
