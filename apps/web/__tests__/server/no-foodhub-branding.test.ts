/** Defect 12 — no user-facing "FoodHub" strings in the web app (old product name). */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe('branding', () => {
  it('has no "FoodHub" in apps/web/src (internal storage keys excepted)', () => {
    const src = path.resolve(__dirname, '../../src');
    const hits = walk(src).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f: path.relative(src, f), i: i + 1, line }))
        .filter(({ line }) => /food\s?hub/i.test(line) && !/'foodhub:onboarding:v\d+'/.test(line))
    );
    expect(hits.map((h) => `${h.f}:${h.i}`)).toEqual([]);
  });
});
