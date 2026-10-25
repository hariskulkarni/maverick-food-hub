/**
 * F8 — SMTP adapters send `body` as the text/plain part and only add an HTML
 * part when `html` is passed. Every notify.email() caller must therefore pass
 * plain text in `body` and markup in `html` — never HTML in `body` (which
 * arrives as raw tags in the recipient's inbox).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Each `notify.email({ ... })` call's argument text (balanced braces). */
function emailCalls(src: string): string[] {
  const calls: string[] = [];
  let i = src.indexOf('notify.email(');
  while (i !== -1) {
    const start = src.indexOf('{', i);
    let depth = 0;
    let j = start;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    calls.push(src.slice(start, j + 1));
    i = src.indexOf('notify.email(', j);
  }
  return calls;
}

describe('F8: notify.email callers pass text in body, markup in html', () => {
  const root = path.resolve(__dirname, '../../src');
  const offenders: string[] = [];
  let count = 0;
  for (const f of walk(root)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const call of emailCalls(src)) {
      count++;
      const bad =
        /\bbody\s*:\s*(html|msg\.html|[a-zA-Z_.]*\.html)\b/.test(call) ||
        /\bbody\s*:\s*`\s*</.test(call);
      if (bad) offenders.push(`${path.relative(root, f)}: ${call.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
  it('finds the email call sites (sanity)', () => {
    expect(count).toBeGreaterThan(5);
  });
  it('no caller passes HTML as the text body', () => {
    expect(offenders).toEqual([]);
  });
});
