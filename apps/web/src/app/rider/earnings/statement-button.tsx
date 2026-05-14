'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function StatementButton() {
  const [from, setFrom] = React.useState<string>(daysAgoIso(30));
  const [to, setTo] = React.useState<string>(todayIso());
  const qs = new URLSearchParams({ from, to });
  const csvHref = `/api/rider/reports/statement?${qs.toString()}&format=csv`;
  const xlsxHref = `/api/rider/reports/statement?${qs.toString()}&format=xlsx`;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-semibold">Download statement</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">From</label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">To</label>
            <Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><a href={csvHref}>Download CSV</a></Button>
          <Button variant="outline" size="sm" asChild><a href={xlsxHref}>Download XLSX</a></Button>
        </div>
        <p className="text-xs text-muted-foreground">Includes delivered orders, base, bonus, tip, total, and COD collected.</p>
      </CardContent>
    </Card>
  );
}
