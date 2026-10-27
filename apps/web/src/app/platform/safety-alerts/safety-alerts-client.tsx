'use client';
/**
 * Safety-alert settings editor. One card per alert type with an enable toggle
 * and its threshold inputs. Each card saves independently (audited PATCH).
 */
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Route, Clock, Store, WifiOff, Loader2, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { reportApiError } from '@/lib/api-error';

export interface SafetyAlertSettingsDto {
  routeDeviation: { enabled: boolean; minutes: number; metres: number };
  etaBreach: { enabled: boolean; minutes: number };
  longWaitAtRestaurant: { enabled: boolean; minutes: number };
  signalLoss: { enabled: boolean; minutes: number };
}

type Key = keyof SafetyAlertSettingsDto;

export function SafetyAlertsClient({ initial }: { initial: SafetyAlertSettingsDto }) {
  const [settings, setSettings] = useState<SafetyAlertSettingsDto>(initial);
  const [saving, setSaving] = useState<Key | null>(null);

  async function save(key: Key, patch: Partial<SafetyAlertSettingsDto[Key]>): Promise<void> {
    setSaving(key);
    try {
      const r = await fetch('/api/platform/safety-alerts/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: patch }),
      });
      if (!r.ok) {
        await reportApiError(r, 'Could not save safety-alert settings');
        return;
      }
      const next: SafetyAlertSettingsDto = await r.json();
      setSettings(next);
      toast.success('Saved');
    } catch {
      toast.error('Could not save — check your connection');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <ShieldAlert className="size-7 text-warning" /> Rider safety alerts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Thresholds for the anomaly detectors that surface on{' '}
          <Link href="/platform/live-ops" className="underline inline-flex items-center gap-0.5">
            live ops <ArrowUpRight className="size-3.5" />
          </Link>
          . Operational location &amp; status data only. Each type can be turned off.
        </p>
      </header>

      <AlertCard
        icon={Route}
        title="Route deviation"
        desc="Rider persistently off the restaurant→customer corridor on an active delivery."
        enabled={settings.routeDeviation.enabled}
        saving={saving === 'routeDeviation'}
        onToggle={(v) => save('routeDeviation', { enabled: v })}
        fields={[
          { label: 'For at least (min)', value: settings.routeDeviation.minutes, min: 1, max: 60, key: 'minutes' },
          { label: 'Off-route by (m)', value: settings.routeDeviation.metres, min: 50, max: 5000, step: 50, key: 'metres' },
        ]}
        onSave={(vals) => save('routeDeviation', vals)}
      />

      <AlertCard
        icon={Clock}
        title="ETA breach / running late"
        desc="Order is past its promised delivery time by this many minutes."
        enabled={settings.etaBreach.enabled}
        saving={saving === 'etaBreach'}
        onToggle={(v) => save('etaBreach', { enabled: v })}
        fields={[{ label: 'Past promise by (min)', value: settings.etaBreach.minutes, min: 1, max: 120, key: 'minutes' }]}
        onSave={(vals) => save('etaBreach', vals)}
      />

      <AlertCard
        icon={Store}
        title="Long wait at restaurant"
        desc="Rider at the restaurant geofence with food ready, but not picked up."
        enabled={settings.longWaitAtRestaurant.enabled}
        saving={saving === 'longWaitAtRestaurant'}
        onToggle={(v) => save('longWaitAtRestaurant', { enabled: v })}
        fields={[{ label: 'Waiting for (min)', value: settings.longWaitAtRestaurant.minutes, min: 1, max: 120, key: 'minutes' }]}
        onSave={(vals) => save('longWaitAtRestaurant', vals)}
      />

      <AlertCard
        icon={WifiOff}
        title="Prolonged signal loss"
        desc="No GPS ping on an active delivery — ops should call the rider (masked)."
        enabled={settings.signalLoss.enabled}
        saving={saving === 'signalLoss'}
        onToggle={(v) => save('signalLoss', { enabled: v })}
        fields={[{ label: 'No ping for (min)', value: settings.signalLoss.minutes, min: 1, max: 120, key: 'minutes' }]}
        onSave={(vals) => save('signalLoss', vals)}
      />
    </div>
  );
}

interface Field {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  key: string;
}

function AlertCard({
  icon: Icon,
  title,
  desc,
  enabled,
  saving,
  onToggle,
  fields,
  onSave,
}: {
  icon: any;
  title: string;
  desc: string;
  enabled: boolean;
  saving: boolean;
  onToggle: (v: boolean) => void;
  fields: Field[];
  onSave: (vals: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, String(f.value)]))
  );

  const errors = fields.map((f) => {
    const n = Number(draft[f.key]);
    return !Number.isInteger(n) || n < f.min || n > f.max ? `${f.label}: ${f.min}–${f.max}` : null;
  });
  const hasError = errors.some(Boolean);
  const dirty = fields.some((f) => String(f.value) !== draft[f.key]);

  return (
    <Card className={enabled ? '' : 'opacity-70'}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-warning/15 text-warning shrink-0">
            <Icon className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} disabled={saving} aria-label={`Enable ${title}`} />
        </div>

        <div className="flex flex-wrap items-end gap-4 pl-[52px]">
          {fields.map((f, i) => (
            <label key={f.key} className="text-xs">
              <span className="block text-muted-foreground mb-1">{f.label}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                step={f.step ?? 1}
                value={draft[f.key]}
                disabled={!enabled || saving}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className={`w-32 ${errors[i] ? 'border-destructive' : ''}`}
              />
            </label>
          ))}
          <Button
            size="sm"
            disabled={!enabled || saving || hasError || !dirty}
            onClick={() => onSave(Object.fromEntries(fields.map((f) => [f.key, Number(draft[f.key])])))}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
        {errors.filter(Boolean).length > 0 && (
          <div className="text-xs text-destructive pl-[52px]">{errors.filter(Boolean).join(' · ')}</div>
        )}
      </CardContent>
    </Card>
  );
}
