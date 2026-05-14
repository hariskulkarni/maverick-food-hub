'use client';

/**
 * Reusable date-range picker used by all reports pages.
 *
 * Renders presets + custom from/to inputs and tracks the chosen range in
 * client state. Children get a `(report) => { csv, xlsx }` builder so each
 * card can wire up its own Download buttons against a single shared range.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export type Preset = 'today' | '7d' | '30d' | '90d' | 'custom';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface ReportLinks {
  csv: string;
  xlsx: string;
}

export function ReportRangePicker({
  apiBase,
  reports
}: {
  apiBase: string;
  reports: Array<{
    slug: string;
    title: string;
    description: string;
  }>;
}) {
  const [preset, setPreset] = React.useState<Preset>('30d');
  const [from, setFrom] = React.useState<string>(daysAgoIso(30));
  const [to, setTo] = React.useState<string>(todayIso());

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'today') { setFrom(todayIso()); setTo(todayIso()); }
    else if (p === '7d') { setFrom(daysAgoIso(7)); setTo(todayIso()); }
    else if (p === '30d') { setFrom(daysAgoIso(30)); setTo(todayIso()); }
    else if (p === '90d') { setFrom(daysAgoIso(90)); setTo(todayIso()); }
  }

  function buildLinks(slug: string): ReportLinks {
    const qs = new URLSearchParams({ from, to });
    const csv = `${apiBase}/${slug}?${qs.toString()}&format=csv`;
    const xlsx = `${apiBase}/${slug}?${qs.toString()}&format=xlsx`;
    return { csv, xlsx };
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <PresetBtn current={preset} value="today" onClick={() => applyPreset('today')}>Today</PresetBtn>
            <PresetBtn current={preset} value="7d" onClick={() => applyPreset('7d')}>7 days</PresetBtn>
            <PresetBtn current={preset} value="30d" onClick={() => applyPreset('30d')}>30 days</PresetBtn>
            <PresetBtn current={preset} value="90d" onClick={() => applyPreset('90d')}>90 days</PresetBtn>
            <PresetBtn current={preset} value="custom" onClick={() => setPreset('custom')}>Custom</PresetBtn>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">From</label>
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">To</label>
              <Input
                type="date"
                value={to}
                min={from}
                max={todayIso()}
                onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
                className="w-44"
              />
            </div>
            <div className="text-xs text-muted-foreground ml-auto">
              Showing {from} → {to}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => {
          const links = buildLinks(r.slug);
          return (
            <Card key={r.slug}>
              <CardContent className="p-5 flex flex-col gap-3 h-full">
                <div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
                </div>
                <div className="flex gap-2 mt-auto">
                  <Button variant="outline" size="sm" asChild>
                    <a href={links.csv}>Download CSV</a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={links.xlsx}>Download XLSX</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PresetBtn({
  current, value, children, onClick
}: { current: Preset; value: Preset; children: React.ReactNode; onClick: () => void }) {
  const active = current === value;
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
