/**
 * Synthesise three short notification chimes as MP3 using nothing but Node
 * built-ins + ffmpeg (already in PATH on Mac & Linux dev boxes).
 *
 * 1. Build raw 16-bit PCM mono @ 44.1 kHz with sine waves.
 * 2. Apply a 20 ms linear fade-in / 40 ms fade-out on every tone segment so
 *    we don't get clicks at the boundaries.
 * 3. Wrap with a minimal WAV header.
 * 4. Shell out to ffmpeg → libmp3lame -qscale:a 2.
 * 5. Delete the temporary WAV.
 *
 * Re-runnable — overwrites existing files.
 *
 * Usage:  node apps/web/scripts/gen-chimes.mjs   (from repo root)
 */

import { writeFileSync, unlinkSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, '..');
const SOUNDS_DIR = join(WEB_ROOT, 'public', 'sounds');
const RIDER_SOUNDS_DIR = join(WEB_ROOT, '..', 'rider-native', 'assets', 'sounds');

const SR = 44100; // sample rate
const FADE_IN_S = 0.020;
const FADE_OUT_S = 0.040;

mkdirSync(SOUNDS_DIR, { recursive: true });

/**
 * Generate samples for a tone segment. Returns Float32-like numbers in [-1, 1].
 * `freq` may be either a single number (constant) or a [from, to] pair for a
 * linear glissando.
 */
function tone({ freqStart, freqEnd, durationS, amplitude }) {
  const n = Math.round(SR * durationS);
  const out = new Float32Array(n);
  // We want continuous-phase across the glissando. Numerically integrate the
  // instantaneous frequency: phase[i+1] = phase[i] + 2π·f(t)/SR.
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1);
    const f = freqStart + (freqEnd - freqStart) * t;
    phase += (2 * Math.PI * f) / SR;
    let env = 1;
    const tSec = i / SR;
    if (tSec < FADE_IN_S) env = tSec / FADE_IN_S;
    const tailStart = durationS - FADE_OUT_S;
    if (tSec > tailStart) env = Math.max(0, (durationS - tSec) / FADE_OUT_S);
    out[i] = Math.sin(phase) * amplitude * env;
  }
  return out;
}

function silence(durationS) {
  return new Float32Array(Math.round(SR * durationS));
}

function concat(...chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Float32 [-1,1] → 16-bit PCM little-endian Buffer. */
function toPcm16(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    const s = Math.round(v * 32767);
    buf.writeInt16LE(s, i * 2);
  }
  return buf;
}

/** Build a canonical 44-byte WAV header for PCM16 mono. */
function wavHeader(dataLength) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);        // PCM fmt chunk size
  h.writeUInt16LE(1, 20);         // audio format = PCM
  h.writeUInt16LE(1, 22);         // channels = 1
  h.writeUInt32LE(SR, 24);        // sample rate
  h.writeUInt32LE(SR * 2, 28);    // byte rate = SR * channels * bytesPerSample
  h.writeUInt16LE(2, 32);         // block align = channels * bytesPerSample
  h.writeUInt16LE(16, 34);        // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

function writeWav(path, samples) {
  const pcm = toPcm16(samples);
  const header = wavHeader(pcm.length);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

function ffmpegWavToMp3(wavPath, mp3Path) {
  const r = spawnSync('ffmpeg', [
    '-y',
    '-i', wavPath,
    '-codec:a', 'libmp3lame',
    '-qscale:a', '2',
    mp3Path
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    const stderr = r.stderr ? r.stderr.toString() : '';
    throw new Error(`ffmpeg failed (${r.status}): ${stderr}`);
  }
}

function buildAndWrite(name, samples) {
  const wavPath = join(SOUNDS_DIR, `${name}.wav`);
  const mp3Path = join(SOUNDS_DIR, `${name}.mp3`);
  writeWav(wavPath, samples);
  ffmpegWavToMp3(wavPath, mp3Path);
  try { unlinkSync(wavPath); } catch {}
  const size = statSync(mp3Path).size;
  console.log(`wrote: ${mp3Path} (${size} bytes)`);
  return mp3Path;
}

// ─── kitchen.mp3 — 3 ascending tones G5→C6→E6, LOUD ─────────────────────────
const kitchen = concat(
  tone({ freqStart: 800,  freqEnd: 800,  durationS: 0.180, amplitude: 0.85 }),
  silence(0.030),
  tone({ freqStart: 1047, freqEnd: 1047, durationS: 0.180, amplitude: 0.85 }),
  silence(0.030),
  tone({ freqStart: 1318, freqEnd: 1318, durationS: 0.180, amplitude: 0.85 })
);

// ─── admin.mp3 — bell-like two tones E5→A5, softer ──────────────────────────
const admin = concat(
  tone({ freqStart: 659, freqEnd: 659, durationS: 0.220, amplitude: 0.60 }),
  silence(0.080),
  tone({ freqStart: 880, freqEnd: 880, durationS: 0.220, amplitude: 0.60 })
);

// ─── rider.mp3 — single rising glissando 600→1200 Hz ────────────────────────
const rider = tone({ freqStart: 600, freqEnd: 1200, durationS: 0.350, amplitude: 0.75 });

buildAndWrite('kitchen', kitchen);
buildAndWrite('admin', admin);
const riderMp3 = buildAndWrite('rider', rider);

// Mirror the rider chime into the native app so Agent B can wire it in.
mkdirSync(RIDER_SOUNDS_DIR, { recursive: true });
const riderTarget = join(RIDER_SOUNDS_DIR, 'new-order.mp3');
copyFileSync(riderMp3, riderTarget);
const riderTargetSize = statSync(riderTarget).size;
console.log(`wrote: ${riderTarget} (${riderTargetSize} bytes)`);
