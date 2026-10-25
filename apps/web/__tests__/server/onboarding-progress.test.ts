import { describe, it, expect, vi, beforeEach } from 'vitest';

let row: any = null;
const upsert = vi.fn(async ({ create, update }: any) => (row = { ...(row ?? create), ...(row ? update : {}) }));
const update = vi.fn(async ({ data }: any) => (row = { ...row, ...data }));
let readinessReady = true;
vi.mock('@/server/db', () => ({
  prisma: {
    onboardingProgress: { findUnique: vi.fn(async () => row), upsert: (a: any) => upsert(a), update: (a: any) => update(a) },
    restaurant: { findUnique: vi.fn(async () => ({ name: 'Spice Garden', contactPhone: readinessReady ? '9876543210' : null, logoUrl: null, gstin: null, ownerUserId: 'o' })) },
    branch: { findMany: vi.fn(async () => [{ id: 'b1', name: 'Main', line1: 'x', city: 'y', postalCode: '560034', latitude: 12.9, longitude: 77.6, serviceRadiusKm: 5, fssaiLicenseNumber: '10020042007183', fssaiExpiresOn: null, hours: [{ openMin: 600, closeMin: 1300 }], _count: { deliveryZones: 0 } }]) },
    menuItem: { count: vi.fn(async () => 4) },
    restaurantUser: { count: vi.fn(async () => 0) },
    qrCode: { findFirst: vi.fn(async () => null) },
  },
}));

import { normaliseSteps, applyStepState, applyDraft, progressPercent, firstIncompleteStep, MAX_DRAFT_BYTES } from '@/lib/onboarding/progress';
import { saveOnboardingStep, goLive, dismissChecklist, getOnboardingProgress, ProgressUpdateError } from '@/server/onboarding';

beforeEach(() => { row = null; readinessReady = true; upsert.mockClear(); update.mockClear(); });

describe('progress helpers', () => {
  it('normalises junk JSON and never persists a required step as skipped', () => {
    const s = normaliseSteps({ profile: 'done', menu: 'skipped', staff: 'skipped', bogus: 'done', legal: 42 });
    expect(s.profile).toBe('done');
    expect(s.menu).toBe('todo');
    expect(s.staff).toBe('skipped');
    expect(s.legal).toBe('todo');
    expect(Object.keys(s)).not.toContain('bogus');
    expect(normaliseSteps(null).golive).toBe('todo');
  });

  it('rejects skipping required steps and self-completing go-live', () => {
    const s = normaliseSteps({});
    expect(() => applyStepState(s, 'menu', 'skipped')).toThrow(/required/);
    expect(() => applyStepState(s, 'golive', 'done')).toThrow(/Go live/);
    expect(applyStepState(s, 'payments', 'skipped').payments).toBe('skipped');
  });

  it('caps draft size and clears with null', () => {
    expect(applyDraft({}, 'profile', { name: 'x' })).toEqual({ profile: { name: 'x' } });
    expect(applyDraft({ profile: { a: 1 } }, 'profile', null)).toEqual({});
    expect(() => applyDraft({}, 'menu', { blob: 'x'.repeat(MAX_DRAFT_BYTES) })).toThrow(/too large/);
  });

  it('percent + next step', () => {
    let s = normaliseSteps({});
    expect(progressPercent(s, false)).toBe(0);
    expect(firstIncompleteStep(s)).toBe('profile');
    s = normaliseSteps({ profile: 'done', legal: 'done', branches: 'done' });
    expect(progressPercent(s, false)).toBe(33);
    expect(firstIncompleteStep(s)).toBe('menu');
    expect(progressPercent(s, true)).toBe(100);
  });
});

describe('progress persistence', () => {
  it('returns a default (unstarted) DTO before anything is saved', async () => {
    const p = await getOnboardingProgress('r1');
    expect(p).toMatchObject({ started: false, percent: 0, currentStep: 'profile', completedAt: null });
  });

  it('saves state + draft, then drops the draft when the step is done (resume works)', async () => {
    await saveOnboardingStep('r1', { step: 'profile', draft: { tagline: 'Home-style' }, currentStep: 'profile' });
    expect(upsert.mock.calls[0][0].where).toEqual({ restaurantId: 'r1' });
    let p = await getOnboardingProgress('r1');
    expect(p.started).toBe(true);
    expect(p.drafts.profile).toEqual({ tagline: 'Home-style' });

    p = await saveOnboardingStep('r1', { step: 'profile', state: 'done', currentStep: 'legal' });
    expect(p.steps.profile).toBe('done');
    expect(p.drafts.profile).toBeUndefined();
    expect(p.currentStep).toBe('legal');
  });

  it('refuses invalid transitions without writing', async () => {
    await expect(saveOnboardingStep('r1', { step: 'delivery', state: 'skipped' })).rejects.toBeInstanceOf(ProgressUpdateError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('go-live completes only when required checks pass; dismiss only after completion', async () => {
    await expect(dismissChecklist('r1')).rejects.toThrow(/Finish setup/);

    readinessReady = false;
    const blocked = await goLive('r1');
    expect(blocked.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    readinessReady = true;
    const ok = await goLive('r1');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.alreadyLive).toBe(false);
      expect(ok.progress.completedAt).not.toBeNull();
      expect(ok.progress.steps.golive).toBe('done');
    }
    const again = await goLive('r1');
    expect(again.ok && again.alreadyLive).toBe(true);

    const d = await dismissChecklist('r1');
    expect(d.dismissedAt).not.toBeNull();
  });
});
