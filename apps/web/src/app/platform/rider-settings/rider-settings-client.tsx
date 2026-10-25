'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { BadgeCheck, GraduationCap, Layers, Wallet, Timer, RefreshCw, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { reportApiError } from '@/lib/api-error';
import {
  type RiderSettingsDto,
  type RiderGateImpact,
  MAX_ACTIVE_ORDERS_BOUNDS,
  DAILY_GOAL_MAX,
  WEEKLY_GOAL_MAX,
  validateMaxActiveOrders,
  validateGoal,
} from '@/lib/rider-settings';

const KYC_LABEL: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  DRIVING_LICENSE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  VEHICLE_INSURANCE: 'Vehicle insurance',
};

type Gate = 'kycGate' | 'trainingShiftGate';
type Pending = { gate: Gate; next: boolean } | null;

export function RiderSettingsClient({ initial, initialImpact }: { initial: RiderSettingsDto; initialImpact: RiderGateImpact }) {
  const [settings, setSettings] = useState<RiderSettingsDto>(initial);
  const [impact, setImpact] = useState<RiderGateImpact>(initialImpact);
  const [impactLoading, setImpactLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const [cap, setCap] = useState(String(initial.maxActiveOrders));
  const [daily, setDaily] = useState(String(initial.dailyGoal));
  const [weekly, setWeekly] = useState(String(initial.weeklyGoal));
  const capError = validateMaxActiveOrders(cap);
  const dailyError = validateGoal(daily, DAILY_GOAL_MAX);
  const weeklyError = validateGoal(weekly, WEEKLY_GOAL_MAX);

  async function refreshImpact(): Promise<void> {
    setImpactLoading(true);
    try {
      const r = await fetch('/api/platform/rider-settings/impact', { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not count affected riders'); return; }
      setImpact(await r.json());
    } catch {
      toast.error('Could not count affected riders');
    } finally {
      setImpactLoading(false);
    }
  }

  async function save(patch: Partial<RiderSettingsDto>, key: string, success: string): Promise<boolean> {
    setSaving(key);
    try {
      const r = await fetch('/api/platform/rider-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) { await reportApiError(r, 'Could not save rider settings'); return false; }
      const next: RiderSettingsDto = await r.json();
      setSettings(next);
      setCap(String(next.maxActiveOrders));
      setDaily(String(next.dailyGoal));
      setWeekly(String(next.weeklyGoal));
      toast.success(success);
      return true;
    } catch {
      toast.error('Could not save rider settings — check your connection');
      return false;
    } finally {
      setSaving(null);
    }
  }

  function askGate(gate: Gate, next: boolean) {
    setPending({ gate, next });
    void refreshImpact();
  }

  async function confirmGate() {
    if (!pending) return;
    const { gate, next } = pending;
    const label = gate === 'kycGate' ? 'KYC gate' : 'Training gate';
    const ok = await save({ [gate]: next }, gate, `${label} turned ${next ? 'on' : 'off'}`);
    if (ok) setPending(null);
  }

  const capDirty = !capError && Number(cap) !== settings.maxActiveOrders;
  const goalsDirty = !dailyError && !weeklyError && (Number(daily) !== settings.dailyGoal || Number(weekly) !== settings.weeklyGoal);

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display text-2xl sm:text-3xl font-semibold">Rider operations settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-wide rules for every rider. Each change is saved immediately and written to the audit log.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshImpact()} disabled={impactLoading}>
          {impactLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-2">Refresh counts</span>
        </Button>
      </header>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Active riders" value={impact.activeRiders} />
        <Stat label="Online now" value={impact.onlineRiders} />
        <Stat label="Failing KYC" value={impact.kyc.blocked} warn={impact.kyc.blocked > 0} />
        <Stat label="Missing safety training" value={impact.training.blocked} warn={impact.training.blocked > 0} />
      </div>

      {/* KYC gate */}
      <SettingCard
        icon={<BadgeCheck className="size-5" />}
        title="KYC gate"
        badge={<Badge variant={settings.kycGate ? 'success' : 'warning'}>{settings.kycGate ? 'On' : 'Off'}</Badge>}
        control={
          <Switch
            checked={settings.kycGate}
            disabled={saving !== null}
            onCheckedChange={(v) => askGate('kycGate', v)}
            aria-label="KYC gate"
          />
        }
      >
        <p>
          When on, a rider can only go online, claim an order from the pool, accept a batch invitation or be assigned by a
          restaurant when all four required documents — Aadhaar, driving licence, vehicle RC and vehicle insurance — are
          approved and not expired. An expired document still counts for 3 days (grace) so a renewal under review doesn&apos;t
          strand the rider. PAN is not required here.
        </p>
        <p>
          When off, riders can work without approved KYC. Recommended: keep it on.
        </p>
        <ImpactLine
          blocked={impact.kyc.blocked}
          online={impact.kyc.blockedOnline}
          total={impact.activeRiders}
          what="fail the KYC check"
        />
        {impact.kyc.blocked > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(impact.kyc.byType).map(([t, n]) => (
              <Badge key={t} variant="muted">{KYC_LABEL[t] ?? t}: {n}</Badge>
            ))}
            <Link href="/platform/kyc" className="text-xs text-primary underline-offset-4 hover:underline inline-flex items-center">
              Review KYC queue <ArrowRight className="size-3 ml-1" />
            </Link>
          </div>
        )}
      </SettingCard>

      {/* Training gate */}
      <SettingCard
        icon={<GraduationCap className="size-5" />}
        title="Safety training gate"
        badge={<Badge variant={settings.trainingShiftGate ? 'success' : 'muted'}>{settings.trainingShiftGate ? 'On' : 'Off'}</Badge>}
        control={
          <Switch
            checked={settings.trainingShiftGate}
            disabled={saving !== null}
            onCheckedChange={(v) => askGate('trainingShiftGate', v)}
            aria-label="Safety training gate"
          />
        }
      >
        <p>
          When on, a rider can&apos;t go online until they have passed every required training module marked
          &ldquo;blocks shift&rdquo; (current version). It is checked when the rider taps Go online — riders already online
          are not pushed offline, and going offline is never blocked. Default: off.
        </p>
        <ImpactLine
          blocked={impact.training.blocked}
          online={impact.training.blockedOnline}
          total={impact.activeRiders}
          what="are missing a shift-blocking module"
        />
        <Link href="/platform/training-modules" className="text-xs text-primary underline-offset-4 hover:underline inline-flex items-center">
          Manage training modules <ArrowRight className="size-3 ml-1" />
        </Link>
      </SettingCard>

      {/* Concurrent order cap */}
      <SettingCard icon={<Layers className="size-5" />} title="Concurrent order cap">
        <p>
          The most deliveries one rider can hold at the same time (assigned, accepted or picked up). It applies to pool
          claims, batch add-ons and restaurant assignments. Lowering it never takes away orders a rider already has — they
          just can&apos;t take new ones until they are under the limit. Default: 2.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => { e.preventDefault(); if (capDirty) void save({ maxActiveOrders: Number(cap) }, 'cap', 'Concurrent order cap saved'); }}
        >
          <div className="sm:w-40">
            <label htmlFor="rs-cap" className="text-xs font-medium text-muted-foreground">Orders per rider ({MAX_ACTIVE_ORDERS_BOUNDS.min}–{MAX_ACTIVE_ORDERS_BOUNDS.max})</label>
            <Input
              id="rs-cap"
              type="number"
              inputMode="numeric"
              min={MAX_ACTIVE_ORDERS_BOUNDS.min}
              max={MAX_ACTIVE_ORDERS_BOUNDS.max}
              step={1}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              aria-invalid={!!capError}
              aria-describedby={capError ? 'rs-cap-err' : undefined}
              className="mt-1"
            />
            {capError && <p id="rs-cap-err" className="mt-1 text-xs text-destructive">{capError}</p>}
          </div>
          <Button type="submit" className="sm:mt-5" disabled={!capDirty || saving !== null}>
            {saving === 'cap' && <Loader2 className="size-4 mr-2 animate-spin" />}Save
          </Button>
        </form>
      </SettingCard>

      {/* Earnings goals */}
      <SettingCard icon={<Wallet className="size-5" />} title="Rider earnings goals">
        <p>
          The daily and weekly targets shown as progress bars on the rider app&apos;s Earnings tab. They are motivation only —
          they don&apos;t change pay, incentives or payouts. Defaults: ₹1,500 a day, ₹9,000 a week.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (goalsDirty) void save({ dailyGoal: Number(daily), weeklyGoal: Number(weekly) }, 'goals', 'Earnings goals saved');
          }}
        >
          <div>
            <label htmlFor="rs-daily" className="text-xs font-medium text-muted-foreground">Daily goal (₹)</label>
            <Input id="rs-daily" type="number" inputMode="decimal" min={1} max={DAILY_GOAL_MAX} value={daily}
              onChange={(e) => setDaily(e.target.value)} aria-invalid={!!dailyError}
              aria-describedby={dailyError ? 'rs-daily-err' : undefined} className="mt-1" />
            {dailyError && <p id="rs-daily-err" className="mt-1 text-xs text-destructive">{dailyError}</p>}
          </div>
          <div>
            <label htmlFor="rs-weekly" className="text-xs font-medium text-muted-foreground">Weekly goal (₹)</label>
            <Input id="rs-weekly" type="number" inputMode="decimal" min={1} max={WEEKLY_GOAL_MAX} value={weekly}
              onChange={(e) => setWeekly(e.target.value)} aria-invalid={!!weeklyError}
              aria-describedby={weeklyError ? 'rs-weekly-err' : undefined} className="mt-1" />
            {weeklyError && <p id="rs-weekly-err" className="mt-1 text-xs text-destructive">{weeklyError}</p>}
          </div>
          <Button type="submit" className="sm:mt-5" disabled={!goalsDirty || saving !== null}>
            {saving === 'goals' && <Loader2 className="size-4 mr-2 animate-spin" />}Save goals
          </Button>
        </form>
      </SettingCard>

      {/* Dispatch JIT — lives on dispatch insights */}
      <SettingCard icon={<Timer className="size-5" />} title="Dispatch timing (JIT invitations)">
        <p>
          Whether riders are invited before the food is ready (just-in-time), plus the buffer, speed and range used to time
          it. These are edited next to the dispatch KPIs they affect.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/platform/dispatch-insights">Open dispatch insights <ArrowRight className="size-4 ml-2" /></Link>
        </Button>
      </SettingCard>

      <GateConfirmDialog
        pending={pending}
        impact={impact}
        impactLoading={impactLoading}
        saving={saving !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmGate()}
      />
    </div>
  );
}

function GateConfirmDialog({
  pending, impact, impactLoading, saving, onCancel, onConfirm,
}: {
  pending: Pending;
  impact: RiderGateImpact;
  impactLoading: boolean;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isKyc = pending?.gate === 'kycGate';
  const turningOn = pending?.next === true;
  const counts = isKyc ? impact.kyc : impact.training;
  const name = isKyc ? 'KYC gate' : 'safety training gate';
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn {turningOn ? 'on' : 'off'} the {name}?</DialogTitle>
          <DialogDescription>
            {turningOn
              ? isKyc
                ? 'Riders who fail the KYC check stop getting new orders straight away and cannot go online again until their documents are approved.'
                : 'Riders missing a shift-blocking safety module will be stopped the next time they try to go online.'
              : isKyc
                ? 'Riders without approved, in-date KYC documents will be able to go online and take orders again.'
                : 'Riders will be able to go online without passing the shift-blocking safety modules.'}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
          {impactLoading ? (
            <span className="inline-flex items-center text-muted-foreground"><Loader2 className="size-4 mr-2 animate-spin" />Counting riders…</span>
          ) : (
            <span className="inline-flex items-start gap-2">
              {counts.blocked > 0 && <AlertTriangle className="size-4 mt-0.5 shrink-0 text-warning" />}
              <span>
                <strong>{counts.blocked}</strong> of {impact.activeRiders} active riders {turningOn ? 'would be blocked' : 'are currently affected'}
                {counts.blockedOnline > 0 && <> — <strong>{counts.blockedOnline}</strong> of them are online right now</>}.
              </span>
            </span>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant={turningOn ? 'default' : 'destructive'} onClick={onConfirm} disabled={saving || impactLoading}>
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Turn {turningOn ? 'on' : 'off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingCard({
  icon, title, badge, control, children,
}: { icon: ReactNode; title: string; badge?: ReactNode; control?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-primary shrink-0">{icon}</span>
            <h2 className="font-semibold">{title}</h2>
            {badge}
          </div>
          {control && <div className="shrink-0 pt-0.5">{control}</div>}
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

function ImpactLine({ blocked, online, total, what }: { blocked: number; online: number; total: number; what: string }) {
  return (
    <p className={blocked > 0 ? 'text-foreground' : undefined}>
      Right now <strong>{blocked}</strong> of {total} active riders {what}
      {online > 0 ? <> (<strong>{online}</strong> online)</> : null}.
    </p>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${warn ? 'text-warning' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
