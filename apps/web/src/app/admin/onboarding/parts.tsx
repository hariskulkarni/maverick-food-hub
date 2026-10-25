'use client';
/** Shared building blocks for the onboarding steps: step frame, worked-example box, fields, API helper. */
import { useEffect, useRef, type ReactNode } from 'react';
import { Lightbulb, Info, AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

export function StepFrame({ title, intro, why, example, children }: {
  title: string;
  intro: ReactNode;
  why: ReactNode;
  example?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="display text-xl sm:text-2xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">{intro}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">
          <Info className="size-4 shrink-0 text-primary mt-0.5" />
          <div><span className="font-semibold text-foreground">Why this matters. </span>{why}</div>
        </div>
        {example && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed">
            <Lightbulb className="size-4 shrink-0 text-warning mt-0.5" />
            <div><span className="font-semibold text-foreground">Worked example. </span>{example}</div>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, hint, error, required, className, children, htmlFor }: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5 min-w-0', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error ? <FieldError message={error} /> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1 text-[11px] text-destructive" role="alert">
      <AlertCircle className="size-3.5 shrink-0 mt-px" /> {message}
    </p>
  );
}

/** JSON request with structured-error toasts. Returns parsed JSON, or null when the request failed. */
export async function apiJson<T = unknown>(url: string, method: string, body: unknown, errorTitle: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    toast.error(errorTitle, { description: 'Network problem — check your connection and retry.' });
    return null;
  }
  if (!res.ok) {
    await reportApiError(res, errorTitle);
    return null;
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** Calls `save(value)` 900 ms after `value` stops changing (skips the first render). */
export function useDebouncedSave<T>(value: T, save: (v: T) => void, enabled = true) {
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const json = JSON.stringify(value);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!enabled) return;
    const t = setTimeout(() => saveRef.current(JSON.parse(json) as T), 900);
    return () => clearTimeout(t);
  }, [json, enabled]);
}

export function minutesToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function timeToMinutes(s: string) {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function VegDot({ veg }: { veg: boolean }) {
  return (
    <span className={cn('inline-grid size-3.5 place-items-center rounded-sm border-2 shrink-0', veg ? 'border-success' : 'border-destructive')} aria-label={veg ? 'Veg' : 'Non-veg'}>
      <span className={cn('block size-1.5 rounded-full', veg ? 'bg-success' : 'bg-destructive')} />
    </span>
  );
}

/** How a dish appears to customers — used as the "sample item card" in the menu step. */
export function SampleItemCard({ item, accent = '#f23e5c', sample }: {
  item: { name: string; description?: string | null; price: number; isVeg: boolean; imageUrl?: string | null; category?: string };
  accent?: string;
  sample?: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <VegDot veg={item.isVeg} />
          {sample && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Sample</span>}
          {item.category && <span className="text-[10px] text-muted-foreground truncate">{item.category}</span>}
        </div>
        <div className="font-semibold leading-tight">{item.name || 'Dish name'}</div>
        <div className="text-sm font-medium">₹{Number.isFinite(item.price) ? item.price : 0}</div>
        {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
      </div>
      <div className="relative w-20 shrink-0">
        <div className="size-20 overflow-hidden rounded-lg bg-muted">
          {item.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
            : <div className="grid h-full place-items-center text-[10px] text-muted-foreground">Photo</div>}
        </div>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-md border bg-background px-3 py-0.5 text-xs font-bold shadow-sm" style={{ color: accent }}>ADD</span>
      </div>
    </div>
  );
}
