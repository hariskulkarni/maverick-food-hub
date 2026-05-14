/**
 * Audio cues for the admin order board.
 * Pure Web Audio API — no asset files required.
 */

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx && ctx.state !== 'closed') return ctx;
  const w = window as WindowWithWebkitAudio;
  const Ctor = window.AudioContext || w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function blip(c: AudioContext, freq: number, startOffset: number, duration: number, gainPeak = 0.35) {
  const t0 = c.currentTime + startOffset;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);

  // Quick ADSR — sharp attack so it cuts through kitchen noise.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/**
 * 3-tone arpeggio: an attention-grabbing "ding-ding-ding" rising.
 * Returns true if it actually played.
 */
export function playNewOrderChime(): boolean {
  const c = getCtx();
  if (!c) return false;

  // Some browsers suspend the context until a user gesture. Try to resume.
  if (c.state === 'suspended') c.resume().catch(() => {});

  // Rising arpeggio: A5 -> C#6 -> E6 -> repeat top note
  blip(c, 880,    0.00, 0.18);
  blip(c, 1108.7, 0.18, 0.18);
  blip(c, 1318.5, 0.36, 0.32, 0.4);
  return true;
}
