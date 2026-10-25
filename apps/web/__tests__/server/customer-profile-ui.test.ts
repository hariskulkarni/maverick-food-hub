/**
 * Lead item 7 (UI): profile details card renders the editable fields; the
 * profile grid columns can shrink below their content (no 390px clipping);
 * the cookie banner pads the page so it never covers primary actions.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { EditProfile } from '@/app/(customer)/profile/edit-profile';

const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8');

describe('customer profile UI', () => {
  it('shows name / email / phone with an Edit action', () => {
    const html = renderToStaticMarkup(createElement(EditProfile, { name: 'Asha', email: 'a@x.com', phone: '+9199' }));
    expect(html).toContain('Asha');
    expect(html).toContain('a@x.com');
    expect(html).toContain('Edit');
  });
  it('profile grid children are min-w-0 (mobile clipping fix)', () => {
    const page = src('app/(customer)/profile/page.tsx');
    expect(page).toMatch(/<aside className="[^"]*min-w-0/);
    expect(page).toMatch(/<section className="[^"]*min-w-0/);
  });
  it('cookie banner reserves its height at the bottom of the page', () => {
    const banner = src('components/cookie-consent.tsx');
    expect(banner).toContain('document.body.style.paddingBottom');
  });
});
