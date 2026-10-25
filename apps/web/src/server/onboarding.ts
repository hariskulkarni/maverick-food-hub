/**
 * Guided onboarding — DB layer for OnboardingProgress + live readiness.
 *
 *   getOnboardingState(restaurantId)  → progress DTO + readiness (never writes)
 *   saveOnboardingStep(id, input)      → upsert step state / draft / current step
 *   goLive(id)                         → re-runs readiness; completes only if ready
 *   dismissChecklist(id)               → hide the dashboard widget (completed only)
 *   loadReadinessSnapshot(id)          → facts the pure rules in lib/onboarding/readiness use
 */
import { prisma } from './db';
import { evaluateReadiness, type ReadinessResult, type ReadinessSnapshot } from '@/lib/onboarding/readiness';
import {
  applyDraft, applyStepState, firstIncompleteStep, normaliseDrafts, normaliseSteps, progressPercent,
  ProgressUpdateError, type StepDrafts, type StepStates,
} from '@/lib/onboarding/progress';
import type { OnboardingStepKey, StepState } from '@/lib/onboarding/steps';

export { ProgressUpdateError };

export interface OnboardingProgressDto {
  steps: StepStates;
  drafts: StepDrafts;
  currentStep: OnboardingStepKey;
  percent: number;
  completedAt: string | null;
  dismissedAt: string | null;
  /** false until the owner first saves anything. */
  started: boolean;
}

export interface OnboardingState {
  progress: OnboardingProgressDto;
  readiness: ReadinessResult;
}

type ProgressRow = {
  steps: unknown; drafts: unknown; currentStep: string | null;
  completedAt: Date | null; dismissedAt: Date | null;
} | null;

export function toProgressDto(row: ProgressRow): OnboardingProgressDto {
  const steps = normaliseSteps(row?.steps);
  const completed = !!row?.completedAt;
  const current = row?.currentStep && row.currentStep in steps ? (row.currentStep as OnboardingStepKey) : firstIncompleteStep(steps);
  return {
    steps,
    drafts: normaliseDrafts(row?.drafts),
    currentStep: current,
    percent: progressPercent(steps, completed),
    completedAt: row?.completedAt?.toISOString() ?? null,
    dismissedAt: row?.dismissedAt?.toISOString() ?? null,
    started: !!row,
  };
}

export async function loadReadinessSnapshot(restaurantId: string): Promise<ReadinessSnapshot> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, contactPhone: true, logoUrl: true, gstin: true, ownerUserId: true },
  });
  if (!restaurant) throw new Error('Restaurant not found');

  const branches = await prisma.branch.findMany({
    where: { restaurantId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, line1: true, city: true, postalCode: true, latitude: true, longitude: true,
      serviceRadiusKm: true, fssaiLicenseNumber: true, fssaiExpiresOn: true,
      hours: { select: { openMin: true, closeMin: true } },
      _count: { select: { deliveryZones: { where: { isActive: true } } } },
    },
  });
  const branchIds = branches.map((b) => b.id);

  const [availableItems, otherStaff, qr] = await Promise.all([
    branchIds.length === 0 ? 0 : prisma.menuItem.count({
      where: { branchId: { in: branchIds }, isAvailable: true, price: { gt: 0 }, category: { isActive: true } },
    }),
    prisma.restaurantUser.count({ where: { restaurantId, userId: { not: restaurant.ownerUserId } } }),
    prisma.qrCode.findFirst({ where: { restaurantId, isActive: true }, select: { id: true } }),
  ]);

  return {
    restaurant: { name: restaurant.name, contactPhone: restaurant.contactPhone, logoUrl: restaurant.logoUrl, gstin: restaurant.gstin },
    branches: branches.map((b) => ({
      id: b.id, name: b.name, line1: b.line1, city: b.city, postalCode: b.postalCode,
      latitude: b.latitude, longitude: b.longitude, serviceRadiusKm: b.serviceRadiusKm,
      fssaiLicenseNumber: b.fssaiLicenseNumber, fssaiExpiresOn: b.fssaiExpiresOn,
      hourRows: b.hours.length,
      // Same convention as server/operating-hours.ts: 0/0 = closed, overnight windows count as open.
      openDays: b.hours.filter((h) => !(h.openMin === 0 && h.closeMin === 0)).length,
      activeZones: b._count.deliveryZones,
    })),
    availableItems,
    otherStaff,
    hasQr: !!qr,
  };
}

export async function getReadiness(restaurantId: string): Promise<ReadinessResult> {
  return evaluateReadiness(await loadReadinessSnapshot(restaurantId));
}

export async function getOnboardingProgress(restaurantId: string): Promise<OnboardingProgressDto> {
  return toProgressDto(await prisma.onboardingProgress.findUnique({ where: { restaurantId } }));
}

export async function getOnboardingState(restaurantId: string): Promise<OnboardingState> {
  const [progress, readiness] = await Promise.all([getOnboardingProgress(restaurantId), getReadiness(restaurantId)]);
  return { progress, readiness };
}

export interface SaveStepInput {
  step: OnboardingStepKey;
  state?: StepState;
  /** Form draft for the step; null clears it. */
  draft?: unknown;
  currentStep?: OnboardingStepKey;
}

export async function saveOnboardingStep(restaurantId: string, input: SaveStepInput): Promise<OnboardingProgressDto> {
  const row = await prisma.onboardingProgress.findUnique({ where: { restaurantId } });
  let steps = normaliseSteps(row?.steps);
  let drafts = normaliseDrafts(row?.drafts);
  if (input.state) steps = applyStepState(steps, input.step, input.state);
  if (input.draft !== undefined) drafts = applyDraft(drafts, input.step, input.draft);
  // A finished step no longer needs its draft.
  if (input.state === 'done') drafts = applyDraft(drafts, input.step, null);
  const data = {
    steps: steps as object,
    drafts: drafts as object,
    currentStep: input.currentStep ?? row?.currentStep ?? null,
  };
  const saved = await prisma.onboardingProgress.upsert({
    where: { restaurantId },
    create: { restaurantId, ...data },
    update: data,
  });
  return toProgressDto(saved);
}

export type GoLiveResult =
  | { ok: true; progress: OnboardingProgressDto; readiness: ReadinessResult; alreadyLive: boolean }
  | { ok: false; readiness: ReadinessResult };

export async function goLive(restaurantId: string): Promise<GoLiveResult> {
  const readiness = await getReadiness(restaurantId);
  if (!readiness.ready) return { ok: false, readiness };
  const row = await prisma.onboardingProgress.findUnique({ where: { restaurantId } });
  if (row?.completedAt) return { ok: true, progress: toProgressDto(row), readiness, alreadyLive: true };
  const steps = { ...normaliseSteps(row?.steps), golive: 'done' as const };
  const saved = await prisma.onboardingProgress.upsert({
    where: { restaurantId },
    create: { restaurantId, steps, drafts: {}, currentStep: 'golive', completedAt: new Date() },
    update: { steps, currentStep: 'golive', completedAt: new Date() },
  });
  return { ok: true, progress: toProgressDto(saved), readiness, alreadyLive: false };
}

export async function dismissChecklist(restaurantId: string): Promise<OnboardingProgressDto> {
  const row = await prisma.onboardingProgress.findUnique({ where: { restaurantId } });
  if (!row?.completedAt) throw new ProgressUpdateError('Finish setup and go live before hiding the checklist.');
  return toProgressDto(await prisma.onboardingProgress.update({ where: { restaurantId }, data: { dismissedAt: new Date() } }));
}
