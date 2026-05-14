'use client';

/**
 * Activity feed list. Filter chips (All / Menu / Integrations) + date-range
 * chips (today / 7d / 30d). Each row is a 1-line summary, with an expandable
 * before/after diff when both snapshots are present.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Utensils, Package, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityRow } from './page';

type Kind = 'all' | 'menu' | 'integration';
type Range = 'today' | '7d' | '30d' | 'all';

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function iconFor(action: string) {
  if (action.startsWith('menu.combo')) return Package;
  if (action.startsWith('menu.')) return Utensils;
  if (action.startsWith('integration.')) return Settings;
  return Utensils;
}

/** Humanise an audit action and its before/after blob into a 1-line summary. */
function summarise(row: ActivityRow): string {
  const who = row.actorName ?? row.actorEmail ?? 'Someone';
  const before = row.before as any;
  const after = row.after as any;

  if (row.action === 'menu.item.toggle') {
    const verb = after?.isAvailable === false ? 'disabled' : 'enabled';
    return `${who} ${verb} menu item ${row.entityId ?? ''}`.trim();
  }
  if (row.action === 'menu.category.toggle') {
    const verb = after?.isActive ? 'enabled' : 'disabled';
    return `${who} ${verb} category ${row.entityId ?? ''}`.trim();
  }
  if (row.action === 'menu.combo.toggle' || row.action === 'menu.combo.update') {
    if (after?.isAvailable !== undefined && before?.isAvailable !== after?.isAvailable) {
      return `${who} ${after?.isAvailable ? 'enabled' : 'disabled'} combo ${after?.name ?? row.entityId ?? ''}`.trim();
    }
    return `${who} updated combo ${after?.name ?? before?.name ?? row.entityId ?? ''}`.trim();
  }
  if (row.action === 'menu.combo.delete') {
    return `${who} deleted combo ${before?.name ?? row.entityId ?? ''}`.trim();
  }
  if (row.action === 'menu.category.schedule.update') {
    return `${who} updated category schedule`;
  }
  if (row.action === 'menu.category.schedule.disable') {
    return `${who} disabled category schedule`;
  }
  if (row.action === 'menu.bulk_toggle') {
    const n = after?.count ?? '';
    const flip = after?.patch?.isAvailable;
    if (flip !== undefined) return `${who} ${flip ? 'enabled' : 'disabled'} ${n} item(s) in bulk`;
    return `${who} bulk-updated ${n} item(s)`;
  }
  if (row.action === 'integration.connect') return `${who} connected ${row.entityId ?? 'integration'}`;
  if (row.action === 'integration.disconnect') return `${who} disconnected ${row.entityId ?? 'integration'}`;
  if (row.action === 'integration.test') return `${who} tested ${row.entityId ?? 'integration'}`;
  return `${who} performed ${row.action}`;
}

function matchesKind(action: string, kind: Kind): boolean {
  if (kind === 'all') return true;
  if (kind === 'menu') return action.startsWith('menu.');
  if (kind === 'integration') return action.startsWith('integration.');
  return true;
}

function withinRange(iso: string, range: Range): boolean {
  if (range === 'all') return true;
  const t = new Date(iso).getTime();
  const cutoff = Date.now() - ({ today: 24, '7d': 24 * 7, '30d': 24 * 30 }[range]) * 3600 * 1000;
  return t >= cutoff;
}

export default function ActivityClient({ rows }: { rows: ActivityRow[] }) {
  const [kind, setKind] = useState<Kind>('all');
  const [range, setRange] = useState<Range>('7d');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return rows.filter((r) => matchesKind(r.action, kind) && withinRange(r.createdAt, range));
  }, [rows, kind, range]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <ChipGroup
          value={kind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'menu', label: 'Menu' },
            { value: 'integration', label: 'Integrations' }
          ]}
          onChange={setKind}
        />
        <span className="mx-2 self-center text-muted-foreground">|</span>
        <ChipGroup
          value={range}
          options={[
            { value: 'today', label: 'Today' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
            { value: 'all', label: 'All time' }
          ]}
          onChange={setRange}
        />
      </div>

      <Card><CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No activity in this range.</div>
        ) : (
          <ul className="divide-y">
            {filtered.map((r) => {
              const Icon = iconFor(r.action);
              const hasDiff = r.before != null && r.after != null;
              const isOpen = expanded.has(r.id);
              return (
                <li key={r.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 size-8 grid place-items-center rounded-md bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        {summarise(r)}{' '}
                        <span className="text-muted-foreground">({r.actorRole ?? 'ADMIN'}, {relativeTime(r.createdAt)})</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="font-mono text-[10px]">{r.action}</Badge>
                        {hasDiff && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(r.id)}
                            className="flex items-center gap-1 hover:text-foreground"
                          >
                            {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            {isOpen ? 'Hide diff' : 'Show diff'}
                          </button>
                        )}
                      </div>
                      {isOpen && hasDiff && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <DiffBlock label="Before" value={r.before} />
                          <DiffBlock label="After" value={r.after} />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}

function ChipGroup<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-3 py-1 text-xs border transition-colors ${
              active ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground hover:bg-accent border-input'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DiffBlock({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border bg-muted/40 p-2 text-xs">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
