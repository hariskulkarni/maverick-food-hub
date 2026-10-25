'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, CircleAlert, Loader2, PartyPopper, RefreshCw, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { stepDef } from '@/lib/onboarding/steps';
import type { ReadinessResult } from '@/lib/onboarding/readiness';
import { StepFrame } from '../parts';
import type { StepProps } from '../wizard-client';

export function GoLiveStep({ data, refresh, goTo }: StepProps) {
  const [readiness, setReadiness] = useState<ReadinessResult>(data.readiness);
  useEffect(() => setReadiness(data.readiness), [data.readiness]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const completed = !!data.progress.completedAt;
  const required = readiness.checks.filter((c) => c.required);
  const recommended = readiness.checks.filter((c) => !c.required);
  const live = data.restaurant.status === 'ACTIVE';

  async function recheck() {
    setChecking(true);
    try {
      const r = await fetch('/api/admin/onboarding', { cache: 'no-store' });
      if (r.ok) setReadiness((await r.json()).readiness);
    } finally { setChecking(false); }
  }

  async function goLive() {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/onboarding/go-live', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.readiness) {
        setReadiness(j.readiness);
        toast.error(j.error ?? 'Some required items still need attention.');
        return;
      }
      if (!r.ok) { toast.error(j.error ?? 'Could not finish setup — please retry.'); return; }
      toast.success(live ? 'You are live! 🎉' : 'Setup complete — waiting for Flavrly approval.');
      refresh();
    } catch {
      toast.error('Network problem — check your connection and retry.');
    } finally { setBusy(false); }
  }

  return (
    <StepFrame
      title="Readiness check & go live"
      intro="We check your real setup — not just the boxes you ticked. Required items must pass before you can go live; recommended ones are worth doing soon."
      why="A customer's first order is your best chance to win a regular. These checks catch the things that cause failed first orders: no orderable dishes, closed hours, no delivery area, missing licence."
      example={<>“Menu: 0 dishes available” fails until at least one dish is priced and marked available. Fix it in the Menu step, come back, and press <b>Re-check</b>.</>}
    >
      {completed && (
        <div className="flex items-start gap-3 rounded-xl border border-success/40 bg-success/5 p-4">
          <PartyPopper className="size-6 shrink-0 text-success" />
          <div className="text-sm">
            <div className="font-semibold">{live ? 'You are live and taking orders.' : 'Setup complete.'}</div>
            <div className="text-muted-foreground">
              {live ? 'Keep an eye on the Orders screen — new orders ring there.' : `Your restaurant is ${data.restaurant.status.toLowerCase()}; customers will see it once Flavrly approves it.`}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild size="sm"><Link href="/admin/orders">Open Orders</Link></Button>
              <Button asChild size="sm" variant="outline"><a href={`/r/${data.restaurant.slug}`} target="_blank" rel="noreferrer">View my page</a></Button>
            </div>
          </div>
        </div>
      )}

      <CheckList title="Required" checks={required} goTo={goTo} />
      <CheckList title="Recommended" checks={recommended} goTo={goTo} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" onClick={recheck} disabled={checking}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-check
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {!readiness.ready && <span className="text-xs text-muted-foreground">{readiness.requiredFailing} required item{readiness.requiredFailing === 1 ? '' : 's'} left</span>}
          {!completed && (
            <Button size="lg" variant="success" onClick={goLive} disabled={busy || !readiness.ready}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Go live
            </Button>
          )}
        </div>
      </div>
    </StepFrame>
  );
}

function CheckList({ title, checks, goTo }: { title: string; checks: ReadinessResult['checks']; goTo: StepProps['goTo'] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge variant={checks.every((c) => c.ok) ? 'success' : title === 'Required' ? 'destructive' : 'warning'}>
          {checks.filter((c) => c.ok).length}/{checks.length}
        </Badge>
      </div>
      <ul className="divide-y rounded-xl border">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 p-3">
            {c.ok ? <CheckCircle2 className="size-5 shrink-0 text-success" />
              : c.required ? <CircleAlert className="size-5 shrink-0 text-destructive" />
              : <AlertTriangle className="size-5 shrink-0 text-warning" />}
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', !c.ok && c.required && 'text-destructive')}>{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.detail}</div>
            </div>
            {!c.ok && <Button size="sm" variant="outline" onClick={() => goTo(c.step)}>Fix in {stepDef(c.step).title.split(' ')[0]}</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
