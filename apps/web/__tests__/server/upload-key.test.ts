/**
 * H5 — the stored upload extension must be whitelisted (derived safely), never
 * taken from the attacker-controlled filename. `evil.html`/`.svg`/`.php` collapse
 * to `.bin` so nginx can't serve them as renderable/executable docs.
 */
import { describe, it, expect } from 'vitest';
import { buildKey } from '@/server/storage';

const ext = (k: string) => k.slice(k.lastIndexOf('.'));

describe('H5: buildKey extension whitelist', () => {
  it('collapses dangerous extensions to .bin', () => {
    expect(ext(buildKey('evil.html', 'misc'))).toBe('.bin');
    expect(ext(buildKey('x.svg', 'misc'))).toBe('.bin');
    expect(ext(buildKey('shell.php', 'misc'))).toBe('.bin');
    expect(ext(buildKey('noext', 'misc'))).toBe('.bin');
  });
  it('keeps safe image/video extensions (jpeg → jpg)', () => {
    expect(ext(buildKey('pic.PNG', 'menu'))).toBe('.png');
    expect(ext(buildKey('photo.jpeg', 'menu'))).toBe('.jpg');
    expect(ext(buildKey('clip.mp4', 'hero'))).toBe('.mp4');
    expect(ext(buildKey('a.webp', 'misc'))).toBe('.webp');
  });
  it('always lands under uploads/', () => {
    expect(buildKey('evil.html', 'misc').startsWith('uploads/')).toBe(true);
  });
});
