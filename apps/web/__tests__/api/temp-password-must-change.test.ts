/**
 * Lead item 4: every account created with a password chosen by someone else
 * (super-admin wizard / add-staff / IAM, restaurant onboarding temp password)
 * must be forced to change it at first login (User.mustChangePassword).
 * Self-chosen passwords (restaurant self-signup) are exempt.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../src/app/api');
const CREATORS = [
  'platform/restaurants/wizard/route.ts',
  'platform/restaurants/[id]/staff/route.ts',
  'platform/iam/users/route.ts',
  'platform/iam/super-admins/route.ts',
  'admin/onboarding/staff/route.ts',
];

describe('temp passwords force a change at first login', () => {
  for (const rel of CREATORS) {
    it(rel, () => {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const creates = src.match(/user\.create\(\{[\s\S]*?\n\s*\}\)/g) ?? [];
      const withPassword = creates.filter((c) => c.includes('passwordHash'));
      expect(withPassword.length).toBeGreaterThan(0);
      for (const c of withPassword) expect(c).toContain('mustChangePassword: true');
    });
  }
  it('self-signup keeps the owner-chosen password', () => {
    const src = fs.readFileSync(path.join(root, 'signup/restaurant/route.ts'), 'utf8');
    expect(src).not.toContain('mustChangePassword: true');
  });
});
