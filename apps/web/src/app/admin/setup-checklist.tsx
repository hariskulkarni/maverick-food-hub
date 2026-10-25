/**
 * Dashboard "Get your restaurant live" checklist. Server component: shows the
 * remaining onboarding steps and any failing required readiness checks, each
 * deep-linked into /admin/onboarding. Once setup is complete it collapses to a
 * success note the owner can dismiss for good.
 */
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle, CircleAlert, CircleDashed, Rocket } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ONBOARDING_STEPS, onboardingHref } from '@/lib/onboarding/steps';
import type { OnboardingState } from '@/server/onboarding';
import { DismissChecklistButton } from './setup-checklist-dismiss';

export function SetupChecklist({ state }: { state: OnboardingState }) {
  const { progress, readiness } = state;
  if (progress.dismissedAt) return null;
  const failing = readiness.checks.filter((c) => c.required && !c.ok);

  if (progress.completedAt) {
    return (
      <Card className="border-success/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="size-6 shrink-0 text-success" />
            <div>
              <div className="font-semibold">Setup complete</div>
              <div className="text-sm text-muted-foreground">
                {failing.length === 0 ? 'Everything customers need is in place.' : `${failing.length} required item${failing.length === 1 ? '' : 's'} changed since you went live — `}
                {failing.length > 0 && <Link href={onboardingHref('golive')} className="text-primary underline">review</Link>}
              </div>
            </div>
          </div>
          <DismissChecklistButton />
        </CardContent>
      </Card>
    );
  }

  const remaining = ONBOARDING_STEPS.filter((s) => s.key !== 'golive' && progress.steps[s.key] !== 'done');
  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Rocket className="size-5" /></div>
            <div>
              <h2 className="font-semibold">Get your restaurant live</h2>
              <p className="text-sm text-muted-foreground">
                {progress.percent}% done · {failing.length === 0 ? 'all required checks pass — you can go live' : `${failing.length} required item${failing.length === 1 ? '' : 's'} left`}
              </p>
            </div>
          </div>
          <Button asChild>
            <Link href={onboardingHref(failing.length === 0 ? 'golive' : progress.currentStep)}>
              {progress.started ? 'Continue setup' : 'Start setup'} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {failing.map((c) => (
            <li key={c.key}>
              <Link href={onboardingHref(c.step)} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                <CircleAlert className="size-4 shrink-0 text-destructive mt-0.5" />
                <span className="min-w-0"><span className="font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.detail}</span></span>
              </Link>
            </li>
          ))}
          {remaining.filter((s) => !failing.some((c) => c.step === s.key)).map((s) => (
            <li key={s.key}>
              <Link href={onboardingHref(s.key)} className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent">
                {progress.steps[s.key] === 'skipped' ? <CircleDashed className="size-4 shrink-0 text-muted-foreground mt-0.5" /> : <Circle className="size-4 shrink-0 text-muted-foreground mt-0.5" />}
                <span className="min-w-0"><span className="font-medium">{s.title}</span>{progress.steps[s.key] === 'skipped' && <span className="text-xs text-muted-foreground"> · skipped</span>}<span className="block text-xs text-muted-foreground">{s.summary}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
