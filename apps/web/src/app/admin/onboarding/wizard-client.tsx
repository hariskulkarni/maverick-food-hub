'use client';
/**
 * "Get your restaurant live" — wizard shell. Owns the current step (mirrored
 * to ?step= so every step is deep-linkable), the progress bar + stepper, and
 * the persistence calls (PATCH /api/admin/onboarding). Each step component
 * saves its real data through the existing admin APIs, then calls complete().
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Circle, CircleDashed, ChevronLeft, ChevronRight, Rocket, SkipForward } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ONBOARDING_STEPS, stepDef, type OnboardingStepKey } from '@/lib/onboarding/steps';
import { progressPercent } from '@/lib/onboarding/progress';
import { apiJson } from './parts';
import type { OnboardingData } from './types';
import { ProfileStep } from './steps/profile-step';
import { LegalStep } from './steps/legal-step';
import { BranchStep } from './steps/branch-step';
import { MenuStep } from './steps/menu-step';
import { DeliveryStep } from './steps/delivery-step';
import { StaffStep } from './steps/staff-step';
import { PaymentsStep, NotificationsStep } from './steps/channels-steps';
import { StorefrontStep } from './steps/storefront-step';
import { GoLiveStep } from './steps/golive-step';

export interface StepProps {
  data: OnboardingData;
  draft: unknown;
  saveDraft: (draft: unknown) => void;
  /** Mark this step done and move to the next one. */
  complete: () => Promise<void>;
  refresh: () => void;
  goTo: (k: OnboardingStepKey) => void;
}

const STEP_COMPONENTS: Record<OnboardingStepKey, (p: StepProps) => React.ReactElement> = {
  profile: ProfileStep,
  legal: LegalStep,
  branches: BranchStep,
  menu: MenuStep,
  delivery: DeliveryStep,
  staff: StaffStep,
  payments: PaymentsStep,
  notifications: NotificationsStep,
  storefront: StorefrontStep,
  golive: GoLiveStep,
};

export function OnboardingWizard({ data, initialStep }: { data: OnboardingData; initialStep: OnboardingStepKey }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<OnboardingStepKey>(initialStep);
  const [steps, setSteps] = useState(data.progress.steps);
  const [drafts, setDrafts] = useState(data.progress.drafts);
  const [busy, setBusy] = useState(false);

  // Server re-renders (router.refresh) bring fresh progress — adopt it.
  useEffect(() => { setSteps(data.progress.steps); }, [data.progress.steps]);

  // First visit: record that the owner has opened the guide (stops the
  // dashboard's one-time redirect and starts the resume pointer).
  useEffect(() => {
    if (data.progress.started) return;
    void fetch('/api/admin/onboarding', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: initialStep, currentStep: initialStep }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const index = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const def = stepDef(step);
  const completed = !!data.progress.completedAt;
  const percent = useMemo(() => progressPercent(steps, completed), [steps, completed]);
  const failingByStep = useMemo(() => {
    const m = new Map<OnboardingStepKey, number>();
    for (const c of data.readiness.checks) if (c.required && !c.ok) m.set(c.step, (m.get(c.step) ?? 0) + 1);
    return m;
  }, [data.readiness]);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const goTo = useCallback((k: OnboardingStepKey) => {
    setStep(k);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('step', k);
      window.history.replaceState(null, '', url.toString());
    } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Remember where the owner is so "Continue setup" resumes here.
    void fetch('/api/admin/onboarding', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: k, currentStep: k }),
    }).catch(() => {});
  }, []);

  const saveDraft = useCallback((draft: unknown) => {
    setDrafts((d) => ({ ...d, [step]: draft }));
    void fetch('/api/admin/onboarding', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step, draft }),
    }).catch(() => {});
  }, [step]);

  const setState = useCallback(async (state: 'done' | 'skipped') => {
    const next = ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)]!.key;
    setBusy(true);
    const res = await apiJson<{ progress: OnboardingData['progress'] }>('/api/admin/onboarding', 'PATCH', { step, state, currentStep: next }, 'Could not save your progress');
    setBusy(false);
    if (!res) return;
    setSteps(res.progress.steps);
    if (state === 'skipped') toast.message(`${def.title} skipped — it stays on your checklist.`);
    refresh();
    goTo(next);
  }, [index, step, def.title, refresh, goTo]);

  const StepComponent = STEP_COMPONENTS[step];

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="display text-2xl sm:text-3xl font-semibold flex items-center gap-2">
              <Rocket className="size-6 text-primary" /> Get your restaurant live
            </h1>
            <p className="text-sm text-muted-foreground">
              {completed ? 'Setup complete — revisit any step to make changes.' : 'Ten short steps. Your progress saves automatically — leave any time and pick up where you left off.'}
            </p>
          </div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">Back to dashboard</Link>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium">Step {index + 1} of {ONBOARDING_STEPS.length}</span>
            <span className="text-muted-foreground">{percent}% complete</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <nav aria-label="Setup steps" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <ol className="flex gap-1.5 min-w-max">
            {ONBOARDING_STEPS.map((s, i) => {
              const st = steps[s.key];
              const active = s.key === step;
              const needsFix = (failingByStep.get(s.key) ?? 0) > 0 && st !== 'todo';
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => goTo(s.key)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      active ? 'border-primary bg-primary text-primary-foreground'
                        : needsFix ? 'border-warning/40 bg-warning/10 text-warning'
                        : st === 'done' ? 'border-success/30 bg-success/10 text-success'
                        : st === 'skipped' ? 'border-dashed text-muted-foreground'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {st === 'done' ? <CheckCircle2 className="size-3.5" /> : st === 'skipped' ? <CircleDashed className="size-3.5" /> : <Circle className="size-3.5" />}
                    <span>{i + 1}. {s.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <StepComponent
            key={step}
            data={data}
            draft={drafts[step]}
            saveDraft={saveDraft}
            complete={() => setState('done')}
            refresh={refresh}
            goTo={goTo}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => goTo(ONBOARDING_STEPS[Math.max(0, index - 1)]!.key)} disabled={index === 0 || busy}>
          <ChevronLeft className="size-4" /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {def.skippable && steps[step] !== 'done' && (
            <Button variant="ghost" onClick={() => setState('skipped')} disabled={busy}>
              <SkipForward className="size-4" /> Skip for now
            </Button>
          )}
          {step !== 'golive' && (
            <Button variant="outline" onClick={() => goTo(ONBOARDING_STEPS[index + 1]!.key)} disabled={busy}>
              Next <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
