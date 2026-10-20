#!/usr/bin/env node
/**
 * check-responsive.mjs — guardrail that fails CI when the forbidden
 * responsive anti-patterns from RESPONSIVE.md sneak back into the codebase.
 *
 * The list of forbidden patterns is intentionally narrow. We only check the
 * ones the audit (Phase 0) found to be the dominant defects across 75+
 * surfaces — chasing every borderline P2 here would make the lint
 * over-zealous and people would learn to add `// eslint-disable` everywhere.
 *
 * Rules enforced:
 *   1. NO `grid-cols-3` or `grid-cols-4` on a `className=` literal without
 *      ALSO including `sm:grid-cols-` or `md:grid-cols-` or `lg:grid-cols-`
 *      somewhere in the same string. (Catches "3-col form on phones" defects.)
 *   2. NO `h-6 px-2 text-[10px]` on a `<Button>` — that's the touch-target
 *      violation we already fixed in /platform/qr. The check is exact-string
 *      so it doesn't flag a legitimate `h-6` on an icon badge.
 *   3. NO `min-w-[180px]` or `min-w-[200px]` or `min-w-[240px]` on a flex item
 *      WITHOUT a `sm:` or `md:` qualifier — these are the search-input
 *      bug from Phases 3+4.
 *
 *   4. (overflow rules, scan all of apps/web/src — see checkOverflow* below)
 *      a. `w-[Npx]` / `min-w-[Npx]` with N >= 360, un-prefixed, in a class
 *         string with no `max-w-full` / `max-w-[..vw..]` → overflows a 360px phone.
 *      b. raw `<table` in a .tsx whose file has no `overflow-x-auto` (or
 *         `overflow-x-scroll` / `overflow-auto`) wrapper → table cut off on mobile.
 *      c. un-prefixed `-ml-[Npx]` / `-mr-[Npx]` / `-mx-[Npx]` with N >= 24 in a
 *         file with no `overflow-x-hidden|auto|clip|scroll` / `overflow-hidden`.
 *
 * Scope (rules 1-3): scans only apps/web/src/app/** files (page.tsx, *-client.tsx,
 * *.tsx). Skips legacy `_old.tsx`, generated files, and the e2e suite.
 *
 * Allowlist: if a violation is intentional, add the file path to ALLOW.
 * Keep this list short — each entry is a "we know about this and we own
 * the consequences" stamp. Prefer fixing the code.
 *
 * Run locally:  node scripts/check-responsive.mjs
 * CI hook:      added as a step in .github/workflows/ci.yml
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
// Node 20 shim: fsPromises.glob is Node 22+. Emulate '**/*.{tsx,ts}' walk.
async function* glob(_pattern, { cwd }) {
  for (const entry of readdirSync(cwd, { recursive: true })) {
    const f = String(entry).replace(/\\/g, '/');
    if (/\.(tsx|ts)$/.test(f)) yield f;
  }
}
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use fileURLToPath so paths containing spaces (e.g. "Restaurant Manager")
// don't get URL-percent-encoded. Plain `new URL().pathname` returns
// "Restaurant%20Manager" which then doesn't match the real filesystem.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'apps/web/src/app');

/** Paths that are knowingly exempt — each entry has a citation in the
 *  Phase 0 audit (RESPONSIVE_AUDIT.md) confirming it's safe at 360px. */
const ALLOW = new Set([
  // BOGO admin editor: two short pill choosers ("Percentage" / "Fixed ₹ off" /
  // "Fixed price" and "All items" / "Category" / "Items"). Audit ack'd P2.
  'apps/web/src/app/admin/offers/offer-editor.tsx',
  // Restaurant card mini-stats and umbrella divide-x rows — short labels
  // (Owner / Commission / Joined). Audit ack'd P2.
  'apps/web/src/app/platform/restaurants/explorer.tsx',
  // Filter wrappers in flex-wrap parents — wrap cleanly on phone per audit.
  'apps/web/src/app/admin/settings/notifications-table.tsx',
  'apps/web/src/app/platform/cod/cod-client.tsx',
  'apps/web/src/app/platform/observability/observability-client.tsx',
  'apps/web/src/app/platform/support/support-client.tsx',
  'apps/web/src/app/platform/brands/[id]/brand-detail-client.tsx',
  'apps/web/src/app/platform/training-modules/training-modules-client.tsx',
  // Stat strip in user drawer — short labels, audit P2.
  'apps/web/src/app/platform/users/explorer.tsx',
  // Super-admin dashboard Min/Avg/Peak strip — short rounded ₹ values,
  // audit P1 "fits at 360px but tight" (cells use text-right / text-center
  // alignment so they don't overlap visually).
  'apps/web/src/app/platform/page.tsx',
  // Customer surfaces audited as P2 / intentional:
  //   - signup trust badges (short labels, max-w-lg centered)
  //   - signup password-strength meter (4 thin 1px bars)
  //   - rider-app earnings-calculator pill chooser
  //   - /r/[slug]/me 3-KPI tile row (Wallet / Loyalty / Orders)
  //   - /orders filter wrapper (flex-wrap parent)
  //   - tracker tip presets (₹40 / ₹60 / ₹100)
  'apps/web/src/app/(customer)/signup/restaurant/page.tsx',
  'apps/web/src/app/(customer)/signup/restaurant/form.tsx',
  'apps/web/src/app/(customer)/rider-app/earnings-calculator.tsx',
  'apps/web/src/app/(customer)/r/[slug]/me/me-client.tsx',
  'apps/web/src/app/(customer)/orders/orders-client.tsx',
  'apps/web/src/app/(customer)/orders/[id]/tracker-client.tsx',
]);

/** className regex — matches the className= literal contents only. */
const CLASSNAME_RE = /className=(?:{?["'`])([^"'`]+)["'`]}?/g;

const violations = [];

async function* iterFiles() {
  for await (const f of glob('**/*.{tsx,ts}', { cwd: WEB_SRC })) {
    if (f.endsWith('.d.ts')) continue;
    if (f.endsWith('_old.tsx')) continue;
    yield path.join(WEB_SRC, f);
  }
}

async function* iterFilesIn(dir) {
  for await (const f of glob('**/*.{tsx,ts}', { cwd: dir })) {
    if (f.endsWith('.d.ts') || f.endsWith('_old.tsx')) continue;
    yield path.join(dir, f);
  }
}

function relFromRoot(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function checkUnqualifiedGrid(content, file) {
  const rel = relFromRoot(file);
  if (ALLOW.has(rel)) return;
  let m;
  let lineStart = 0;
  // Build a line index for clean error reporting.
  const lines = content.split('\n');
  CLASSNAME_RE.lastIndex = 0;
  while ((m = CLASSNAME_RE.exec(content)) !== null) {
    const cls = m[1];
    if (!/\b(?:grid-cols-3|grid-cols-4)\b/.test(cls)) continue;
    // Already qualified somewhere in the same string → OK.
    if (/\b(?:sm|md|lg|xl):grid-cols-/.test(cls)) continue;
    // Locate the line number of the match.
    const before = content.slice(0, m.index);
    const lineNum = before.split('\n').length;
    violations.push({
      file: rel,
      line: lineNum,
      rule: 'no-unqualified-grid-cols-N',
      detail: `grid-cols-3/4 without a sm:/md:/lg: qualifier — '${cls.slice(0, 80)}…'`,
    });
  }
}

function checkTouchTargetButton(content, file) {
  const rel = relFromRoot(file);
  if (ALLOW.has(rel)) return;
  // Exact-string check: 'h-6 px-2 text-[10px]' inside a className that also
  // mentions Button or button. Looking for the conjunction so a span/badge
  // with h-6 doesn't trip the rule.
  const re = /<Button[^>]*className=["'`][^"'`]*h-6[^"'`]*text-\[10px\][^"'`]*["'`]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    const lineNum = before.split('\n').length;
    violations.push({
      file: rel,
      line: lineNum,
      rule: 'no-tiny-button-touch-target',
      detail: '<Button h-6 px-2 text-[10px]> — below 44px tap target',
    });
  }
}

function checkUnqualifiedMinW(content, file) {
  const rel = relFromRoot(file);
  if (ALLOW.has(rel)) return;
  CLASSNAME_RE.lastIndex = 0;
  let m;
  while ((m = CLASSNAME_RE.exec(content)) !== null) {
    const cls = m[1];
    if (!/\bmin-w-\[(180|200|220|240|260)px\]/.test(cls)) continue;
    // Skip if there's a sm: or md: qualifier on the min-w-* somewhere.
    if (/\b(?:sm|md|lg|xl):min-w-\[/.test(cls)) continue;
    const before = content.slice(0, m.index);
    const lineNum = before.split('\n').length;
    violations.push({
      file: rel,
      line: lineNum,
      rule: 'no-unqualified-min-w-search',
      detail: `min-w-[180-260px] without a sm:/md: qualifier — '${cls.slice(0, 80)}…'`,
    });
  }
}

// ---------------------------------------------------------------------------
// Overflow / off-screen-cutoff rules (4a-4c). They scan all of apps/web/src
// (components included), and are deliberately narrow to keep false positives
// low. Responsive-prefixed utilities (sm:w-[480px], md:-ml-[40px]) are NOT
// flagged: the lookbehind `(?<![\w:-])` requires the utility to start a token,
// i.e. apply at the base (phone) breakpoint. ALLOW does not apply to these.
// ---------------------------------------------------------------------------
const WEB_ROOT = path.join(ROOT, 'apps/web/src');
/** Any quoted string literal (class lists live in "..", '..' or `..`). */
const STRING_RE = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
const FIXED_W_RE = /(?<![\w:-])(?:min-)?w-\[(\d+)px\]/g;
const MAX_W_OK_RE = /(?<![\w:-])max-w-(?:full|\[[^\]]*vw[^\]]*\])/;
const NEG_MARGIN_RE = /(?<![\w:])-m[lrx]-\[(\d+)px\]/g;
const OVERFLOW_CONTAIN_RE = /overflow-x-(?:hidden|auto|clip|scroll)|overflow-hidden|overflow-auto/;

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function checkFixedWidthOverflow(content, file) {
  const rel = relFromRoot(file);
  STRING_RE.lastIndex = 0;
  let m;
  while ((m = STRING_RE.exec(content)) !== null) {
    const str = m[2];
    if (!/w-\[/.test(str)) continue;
    FIXED_W_RE.lastIndex = 0;
    let w;
    while ((w = FIXED_W_RE.exec(str)) !== null) {
      if (Number(w[1]) < 360) continue;
      if (MAX_W_OK_RE.test(str)) break;
      violations.push({
        file: rel,
        line: lineOf(content, m.index),
        rule: 'no-fixed-width-overflow',
        detail: `${w[0]} (>=360px) without max-w-full / max-w-[..vw] — overflows a 360px phone`,
      });
      break;
    }
  }
}

function checkTableScrollWrapper(content, file) {
  if (!file.endsWith('.tsx')) return;
  const rel = relFromRoot(file);
  if (/overflow-x-(?:auto|scroll)|overflow-auto/.test(content)) return;
  const re = /<table[\s>]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    violations.push({
      file: rel,
      line: lineOf(content, m.index),
      rule: 'table-needs-overflow-x-auto',
      detail: 'raw <table> in a file with no overflow-x-auto wrapper — cut off on mobile',
    });
  }
}

function checkNegativeMarginBleed(content, file) {
  const rel = relFromRoot(file);
  if (OVERFLOW_CONTAIN_RE.test(content)) return;
  STRING_RE.lastIndex = 0;
  let m;
  while ((m = STRING_RE.exec(content)) !== null) {
    if (!/-m[lrx]-\[/.test(m[2])) continue;
    NEG_MARGIN_RE.lastIndex = 0;
    let n;
    while ((n = NEG_MARGIN_RE.exec(m[2])) !== null) {
      if (Number(n[1]) < 24) continue;
      violations.push({
        file: rel,
        line: lineOf(content, m.index),
        rule: 'no-uncontained-negative-margin',
        detail: `${n[0]} (>=24px) with no overflow-x containment in file — can push content off-screen`,
      });
    }
  }
}

async function main() {
  for await (const file of iterFilesIn(WEB_ROOT)) {
    const content = readFileSync(file, 'utf8');
    checkFixedWidthOverflow(content, file);
    checkTableScrollWrapper(content, file);
    checkNegativeMarginBleed(content, file);
  }
  for await (const file of iterFiles()) {
    const content = readFileSync(file, 'utf8');
    checkUnqualifiedGrid(content, file);
    checkTouchTargetButton(content, file);
    checkUnqualifiedMinW(content, file);
  }

  if (violations.length === 0) {
    console.log('✓ Responsive guardrail — no forbidden patterns found.');
    process.exit(0);
  }

  // Group by file for readable output.
  const grouped = new Map();
  for (const v of violations) {
    if (!grouped.has(v.file)) grouped.set(v.file, []);
    grouped.get(v.file).push(v);
  }
  console.error('\n✗ Responsive guardrail — found anti-patterns from RESPONSIVE.md:\n');
  for (const [file, vs] of grouped) {
    console.error(`  ${file}`);
    for (const v of vs) {
      console.error(`    L${v.line}  [${v.rule}]  ${v.detail}`);
    }
    console.error('');
  }
  console.error(
    `Total: ${violations.length} violation${violations.length === 1 ? '' : 's'} ` +
      `across ${grouped.size} file${grouped.size === 1 ? '' : 's'}.\n` +
      'Fix using the primitives in apps/web/src/components/responsive/ — see RESPONSIVE.md.\n' +
      'If a violation is intentional, add the file path to the ALLOW set in scripts/check-responsive.mjs\n' +
      'with a comment explaining why.\n'
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('check-responsive.mjs crashed:', err);
  process.exit(2);
});
