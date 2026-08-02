'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  CheckCircle2, AlertTriangle, ExternalLink, Loader2, Lock, ShieldCheck,
  Eye, EyeOff, ChevronRight, ChevronLeft
} from 'lucide-react';

/**
 * Mirrors FieldDef in src/server/integrations/providers.ts. It is duplicated
 * rather than imported because that module is server-only (it pulls in the
 * crypto + prisma layers) and this is a Client Component. Keep the two in step.
 */
export interface FieldOption {
  value: string;
  label: string;
  detail?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'email' | 'select';
  placeholder?: string;
  required?: boolean;
  hint?: string;
  secret?: boolean;
  options?: FieldOption[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  provider: string;
  title: string;
  vendor: string;
  description: string;
  docsUrl: string;
  fields: FieldDef[];
  initialSummary: Record<string, any> | null;
  isConnected: boolean;
  /** Super-admin only: target another tenant. Ignored by the API otherwise. */
  restaurantId?: string;
  onSaved: () => void;
}

type TestResult = { ok: boolean; detail?: string; error?: string };

export function IntegrationWizard(props: Props) {
  const { open, onClose, provider, title, vendor, description, docsUrl, fields, initialSummary, isConnected, restaurantId } = props;
  const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';
  const [step, setStep] = useState<1 | 2 | 3>(isConnected ? 2 : 1);
  const [values, setValues] = useState<Record<string, string>>(() =>
    fields.reduce<Record<string, string>>(
      (acc, f) => ({ ...acc, [f.key]: f.type === 'select' ? f.options?.[0]?.value ?? '' : '' }),
      {},
    )
  );
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function reset() {
    setStep(isConnected ? 2 : 1);
    setValues(
      fields.reduce<Record<string, string>>(
        (acc, f) => ({ ...acc, [f.key]: f.type === 'select' ? f.options?.[0]?.value ?? '' : '' }),
        {},
      ),
    );
    setShowSecret({});
    setTesting(false); setSaving(false); setTestResult(null);
  }
  function close() { reset(); onClose(); }

  function set(k: string, v: string) {
    setValues((p) => ({ ...p, [k]: v }));
    setTestResult(null);
  }

  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  const canTest = missing.length === 0;

  async function runTest(): Promise<TestResult | null> {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`/api/admin/integrations/${provider}/test${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: values })
      });
      const data = await r.json();
      setTestResult(data);
      return data;
    } catch (e) {
      const fail = { ok: false, error: (e as Error).message };
      setTestResult(fail);
      return fail;
    } finally {
      setTesting(false);
    }
  }

  async function saveAndEnable() {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/integrations/${provider}${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: values })
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Save failed: ${data?.error ?? 'unknown'}`);
        return;
      }
      toast.success(`${title} connected.`);
      props.onSaved();
      close();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${title}? The system will fall back to mock mode.`)) return;
    const r = await fetch(`/api/admin/integrations/${provider}${qs}`, { method: 'DELETE' });
    if (!r.ok) return toast.error('Disconnect failed');
    toast.success(`${title} disconnected.`);
    props.onSaved();
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-3 border-b bg-gradient-to-br from-primary/5 via-card to-card">
          <div className="flex items-center justify-between">
            <DialogTitle className="display text-xl">{title}</DialogTitle>
            <Badge variant={isConnected ? 'success' : 'muted'} className="text-[10px]">
              {isConnected ? 'Connected' : 'Not configured'}
            </Badge>
          </div>
          <DialogDescription className="text-xs">{vendor} · {description}</DialogDescription>
          <Stepper step={step} hasExisting={isConnected} />
        </DialogHeader>

        {/* ── Step 1: Intro ── */}
        {step === 1 && (
          <div className="p-6 space-y-4">
            <p className="text-sm">
              To connect {vendor}, you'll need credentials from their dashboard. We'll test them before saving and store them encrypted in your database.
            </p>
            <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Get your credentials from {vendor} <ExternalLink className="size-3.5" />
            </a>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-3.5 text-success" /> What we store</div>
              <ul className="ml-5 list-disc text-muted-foreground space-y-0.5">
                <li>Credentials are encrypted at rest with AES-256-GCM.</li>
                <li>Secrets are never shown again after saving — only the last 4 characters.</li>
                <li>Disconnect any time to revert to mock mode.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── Step 2: Form ── */}
        {step === 2 && (
          <div className="p-6 space-y-4">
            {isConnected && initialSummary && (
              <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-success mb-1.5">
                  <CheckCircle2 className="size-3.5" /> Currently connected
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  {Object.entries(initialSummary).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="opacity-70">{k}</dt>
                      <dd className="font-mono truncate" title={String(v)}>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-muted-foreground">Enter new values below to rotate the credentials.</p>
              </div>
            )}
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs font-medium">{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                {f.type === 'select' && f.options?.length ? (
                  <Select
                    value={values[f.key] || f.options[0].value}
                    onValueChange={(v) => set(f.key, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={f.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="font-medium">{o.label}</span>
                          {o.detail && (
                            <span className="block text-[11px] text-muted-foreground">{o.detail}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                <div className="relative">
                  <Input
                    type={f.type === 'password' && !showSecret[f.key] ? 'password' : (f.type === 'number' ? 'number' : 'text')}
                    inputMode={f.type === 'number' ? 'numeric' : undefined}
                    value={values[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    className={f.secret ? 'font-mono pr-9' : ''}
                  />
                  {f.secret && (
                    <button
                      type="button"
                      onClick={() => setShowSecret((p) => ({ ...p, [f.key]: !p[f.key] }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showSecret[f.key] ? 'Hide' : 'Show'}
                    >
                      {showSecret[f.key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </div>
                )}
                {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── Step 3: Test result ── */}
        {step === 3 && testResult && (
          <div className="p-6 space-y-4">
            {testResult.ok ? (
              <div className="rounded-lg border-2 border-success/40 bg-success/5 p-4 burst">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="size-6 text-success shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Connection verified</div>
                    <p className="text-sm text-muted-foreground mt-1">{testResult.detail ?? 'Credentials authenticated successfully.'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-6 text-destructive shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">Connection failed</div>
                    <p className="text-sm text-muted-foreground mt-1 break-words">{testResult.error ?? 'Provider rejected the credentials.'}</p>
                    <p className="text-xs text-muted-foreground mt-2">Go back, double-check the values, and try again.</p>
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-lg bg-muted/40 p-3 text-xs flex items-start gap-2">
              <Lock className="size-3.5 mt-0.5 shrink-0" />
              <span>Credentials are only saved if the test passes. Your secrets stay in memory until then.</span>
            </div>
          </div>
        )}

        <DialogFooter className="p-4 border-t bg-muted/20 flex-row items-center justify-between gap-2">
          <div>
            {isConnected && step !== 3 && (
              <Button variant="outline" size="sm" onClick={disconnect} className="text-destructive border-destructive/40 hover:bg-destructive/5">
                Disconnect
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <>
                <Button variant="outline" onClick={close}>Cancel</Button>
                <Button onClick={() => setStep(2)}>Get started <ChevronRight className="size-4" /></Button>
              </>
            )}
            {step === 2 && (
              <>
                {!isConnected && <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="size-4" /> Back</Button>}
                <Button
                  onClick={async () => {
                    const r = await runTest();
                    if (r) setStep(3);
                  }}
                  disabled={!canTest || testing}
                >
                  {testing ? <><Loader2 className="size-4 animate-spin" /> Testing…</> : <>Test connection <ChevronRight className="size-4" /></>}
                </Button>
              </>
            )}
            {step === 3 && (
              <>
                <Button variant="outline" onClick={() => setStep(2)}><ChevronLeft className="size-4" /> Edit values</Button>
                {testResult?.ok ? (
                  <Button onClick={saveAndEnable} disabled={saving}>
                    {saving ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : <>Save &amp; enable</>}
                  </Button>
                ) : (
                  <Button onClick={async () => { await runTest(); }} disabled={testing}>
                    {testing ? <><Loader2 className="size-4 animate-spin" /> Retesting…</> : 'Retry test'}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step, hasExisting }: { step: 1 | 2 | 3; hasExisting: boolean }) {
  const steps = hasExisting
    ? [{ n: 2, label: 'Credentials' }, { n: 3, label: 'Verify' }]
    : [{ n: 1, label: 'Overview' }, { n: 2, label: 'Credentials' }, { n: 3, label: 'Verify' }];
  return (
    <div className="flex items-center gap-1.5 mt-3">
      {steps.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-1.5 text-[10px]">
            <div className={`grid size-5 place-items-center rounded-full font-bold ${
              done ? 'bg-success text-success-foreground'
              : active ? 'bg-primary text-primary-foreground ring-saffron'
              : 'bg-muted text-muted-foreground'
            }`}>
              {done ? '✓' : i + 1}
            </div>
            <span className={active ? 'font-medium text-foreground' : 'text-muted-foreground'}>{s.label}</span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-border mx-1" />}
          </div>
        );
      })}
    </div>
  );
}
