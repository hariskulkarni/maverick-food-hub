'use client';
/**
 * Confirm dialog for Flavrly PG money/ops actions: states what will happen, collects the required
 * inputs (reason, amount, ...) and only then calls `onConfirm`. Used by the platform PG ops page and
 * the merchant PG page.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface ActionField {
  name: string;
  label: string;
  kind?: 'text' | 'textarea' | 'amount';
  required?: boolean;
  defaultValue?: string;
  help?: string;
  placeholder?: string;
}

export interface ActionSpec {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  fields?: ActionField[];
  /** Return an error message to keep the dialog open, or null on success. */
  onConfirm: (values: Record<string, string>) => Promise<string | null>;
}

export function ConfirmActionDialog({ spec, onClose }: { spec: ActionSpec | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries((spec?.fields ?? []).map((f) => [f.name, f.defaultValue ?? ''])));
    setError(null);
    setBusy(false);
  }, [spec]);

  const missing = (spec?.fields ?? []).some((f) => f.required && !values[f.name]?.trim());

  async function confirm() {
    if (!spec || missing) return;
    setBusy(true);
    setError(null);
    try {
      const err = await spec.onConfirm(values);
      if (err) setError(err);
      else onClose();
    } catch {
      setError('Network error. Nothing was changed on your side; try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!spec} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        {spec && (
          <>
            <DialogHeader>
              <DialogTitle>{spec.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">{spec.body}</div>
              </DialogDescription>
            </DialogHeader>
            {(spec.fields ?? []).map((f) => (
              <div key={f.name} className="space-y-1">
                <Label htmlFor={`act-${f.name}`}>{f.label}{f.required ? ' *' : ''}</Label>
                {f.kind === 'textarea' ? (
                  <Textarea id={`act-${f.name}`} value={values[f.name] ?? ''} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                ) : (
                  <Input
                    id={`act-${f.name}`}
                    inputMode={f.kind === 'amount' ? 'decimal' : undefined}
                    autoComplete="off"
                    value={values[f.name] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                )}
                {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
              </div>
            ))}
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant={spec.destructive ? 'destructive' : 'default'} onClick={confirm} disabled={busy || missing}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : spec.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "250.00" / "₹1,234.5" -> integer paise, or null. Exact string arithmetic, no floats. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/₹|,|\s/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const p = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return p > 0 ? p : null;
}

export const paiseToRupees = (p: number | null | undefined) => (p == null ? '' : `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`);
