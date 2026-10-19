'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/brand/logo';
import { brand } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { GoogleGLogo, AnthropicLogo, OpenAILogo, NvidiaLogo } from './provider-logos';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Save, KeyRound, Star, Sparkles, Check } from 'lucide-react';

type Status = 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
interface Part { status: Status; summary: Record<string, any> | null }
interface AutoReply { enabled: boolean; autoPostMinRating: number; draftMaxRating: number; tonePrompt: string | null }
interface ConfigResponse { google: Part; llm: Part; autoReply: AutoReply }

const RATINGS = [1, 2, 3, 4, 5];
const TONE_EXAMPLES = [
  'Warm and personal, thank them by name.',
  'Brief and professional, one or two sentences.',
  'Playful, with a little humour, sign off as the owner.',
];
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', hint: 'Claude', Logo: AnthropicLogo },
  { id: 'openai', label: 'OpenAI', hint: 'GPT', Logo: OpenAILogo },
  { id: 'nvidia', label: 'NVIDIA', hint: 'Free models', Logo: NvidiaLogo },
];

export function ReviewsSettings({ restaurantId }: { restaurantId?: string } = {}) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/config${qs}`, { cache: 'no-store' });
    if (r.ok) setCfg(await r.json());
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  if (!cfg) return <div className="rounded-2xl border bg-muted/20 h-24 shimmer" />;

  return (
    <div className="grid gap-4">
      <header className="flex items-center gap-3 rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-5">
        <LogoMark className="size-11 shrink-0 shadow-sm" />
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight tracking-tight text-gradient-brand">Google Reviews</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Reply to your Google reviews, manually or with AI, powered by {brand.name}.
          </p>
        </div>
      </header>
      <GoogleCard part={cfg.google} qs={qs} />
      <LlmCard part={cfg.llm} qs={qs} onSaved={load} />
      <AutoReplyCard initial={cfg.autoReply} qs={qs} />
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const tone =
    status === 'CONNECTED'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : status === 'FAILED'
        ? 'bg-destructive/10 text-destructive border-destructive/30'
        : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', tone)}>
      <span className={cn('size-1.5 rounded-full', status === 'CONNECTED' ? 'bg-emerald-500' : status === 'FAILED' ? 'bg-destructive' : 'bg-muted-foreground/60')} />
      {status === 'CONNECTED' ? 'Connected' : status === 'FAILED' ? 'Failed' : 'Not connected'}
    </span>
  );
}

function CardHead({ icon, title, desc, right }: { icon: React.ReactNode; title: string; desc: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border bg-background">{icon}</div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function GoogleCard({ part, qs }: { part: Part; qs: string }) {
  const connected = part.status === 'CONNECTED';
  const locations: Array<{ id: string; title: string }> = Array.isArray(part.summary?.locations) ? part.summary!.locations : [];
  const locationId: string = part.summary?.locationId ? String(part.summary.locationId) : '';
  const chosen = locations.find((l) => l.id === locationId);
  const [forcePick, setForcePick] = useState(false);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('pickLocation') === '1') setForcePick(true);
  }, []);
  const needsPick = connected && locations.length > 1 && (!locationId || forcePick);

  async function choose() {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/integrations/google-business/select-location${qs}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locationId: selected }),
      });
      if (!r.ok) throw new Error('failed');
      const u = new URL(window.location.href);
      u.searchParams.delete('pickLocation');
      window.location.href = u.toString();
    } catch {
      toast.error('Could not save location. Try again.');
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <CardHead
          icon={<GoogleGLogo className="size-5" />}
          title="Google Business Profile"
          desc="Where your reviews are pulled from and replies are posted."
          right={<StatusPill status={part.status} />}
        />
        {connected ? (
          <>
            {needsPick ? (
              <div className="space-y-2" role="radiogroup" aria-label="Choose your Google location">
                <p className="text-sm font-medium">Which location is this restaurant?</p>
                <p className="text-xs text-muted-foreground">Your Google account manages several locations. Pick the one whose reviews should sync here.</p>
                <div className="grid gap-2">
                  {locations.map((l) => (
                    <label key={l.id}
                      className={cn('flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2 text-sm transition-colors',
                        selected === l.id && 'border-primary bg-primary/10')}>
                      <input type="radio" name="google-location" className="size-4 accent-primary"
                        checked={selected === l.id} onChange={() => setSelected(l.id)} />
                      <span className="min-w-0 truncate font-medium" title={l.title}>{l.title}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" className="min-h-[44px] w-full sm:w-auto" disabled={!selected || saving} onClick={choose}>
                    <Check className="size-4" /> {saving ? 'Saving...' : 'Use this location'}
                  </Button>
                  {locationId && (
                    <Button size="sm" variant="ghost" className="min-h-[44px] w-full sm:w-auto" onClick={() => setForcePick(false)}>Cancel</Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {chosen || locationId ? (
                  <div className="rounded-xl border bg-muted/30 px-3 py-2 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Location</div>
                    <div className="text-xs font-medium truncate" title={chosen?.title ?? locationId}>{chosen?.title ?? locationId}</div>
                    {locations.length > 1 && (
                      <button type="button" className="mt-1 min-h-[44px] text-xs font-medium text-primary hover:underline sm:min-h-0"
                        onClick={() => { setSelected(locationId); setForcePick(true); }}>
                        Change location
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No location found on this Google account yet. Reconnect once a location is verified.</p>
                )}
                <p className="text-xs text-muted-foreground">Reviews sync from this location.</p>
              </>
            )}
            {/* Disconnect intentionally omitted: use Manage on the Google card in the integrations grid above. */}
          </>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-center">
            <p className="text-sm font-medium">No Google account linked yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Connect your Google Business Profile so {brand.name} can pull reviews and post replies.</p>
          </div>
        )}
        <Button size="sm" variant={connected ? 'outline' : 'default'} className="w-full sm:w-auto"
          onClick={() => { window.location.href = '/api/admin/integrations/google-business/connect'; }}>
          <GoogleGLogo className="size-4" /> {connected ? 'Reconnect Google' : 'Connect Google Business'}
        </Button>
      </CardContent>
    </Card>
  );
}

function LlmCard({ part, qs, onSaved }: { part: Part; qs: string; onSaved: () => void }) {
  const [provider, setProvider] = useState<string>(String(part.summary?.provider ?? 'nvidia'));
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(String(part.summary?.model ?? ''));
  const [busy, setBusy] = useState(false);
  const connected = part.status === 'CONNECTED';
  const ready = apiKey.trim() !== '' && model.trim() !== '';

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/integrations/LLM_REVIEWS${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { provider, apiKey, model } }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(`Test/save failed: ${data?.error ?? 'unknown'}`); return; }
      toast.success('AI key verified and saved.');
      setApiKey('');
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <CardHead
          icon={<Sparkles className="size-4 text-primary" />}
          title="AI reply model"
          desc="Pick the provider that drafts your replies."
          right={<StatusPill status={part.status} />}
        />
        {connected && part.summary && (
          <p className="rounded-xl border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground font-mono break-all">
            {String(part.summary.provider)} · {String(part.summary.apiKey)} · {String(part.summary.model)}
          </p>
        )}
        <div className="space-y-1.5">
          <Label id="llm-provider-label">Provider</Label>
          <div role="radiogroup" aria-labelledby="llm-provider-label" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PROVIDERS.map(({ id, label, hint, Logo }) => {
              const on = provider === id;
              return (
                <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setProvider(id)}
                  className={cn(
                    'relative flex min-[420px]:flex-col items-center gap-2 rounded-xl border px-3 py-3 text-left min-[420px]:text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-background hover:bg-muted/40',
                  )}>
                  <Logo className="size-6 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[11px] text-muted-foreground">{hint}</span>
                  </span>
                  {on && <Check className="absolute right-2 top-2 size-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="llm-key">API key</Label>
            <Input id="llm-key" type="password" autoComplete="off" value={apiKey}
              placeholder={connected ? 'Enter a new key to replace' : 'Paste API key'}
              onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llm-model">Model</Label>
            <Input id="llm-model" value={model} placeholder="meta/llama-3.1-70b-instruct" onChange={(e) => setModel(e.target.value)} />
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={busy || !ready} className="w-full sm:w-auto">
          <KeyRound className="size-3.5" /> {busy ? 'Testing…' : 'Test & save'}
        </Button>
      </CardContent>
    </Card>
  );
}

function StarPicker({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex items-center gap-1">
        {RATINGS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onClick={() => onChange(n)}
            className="rounded-md p-1 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Star className={cn('size-6', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          </button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">{value} / 5</span>
      </div>
    </div>
  );
}

function AutoReplyCard({ initial, qs }: { initial: AutoReply; qs: string }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [autoPost, setAutoPost] = useState(initial.autoPostMinRating);
  const [draftMax, setDraftMax] = useState(initial.draftMaxRating);
  const [tone, setTone] = useState(initial.tonePrompt ?? '');
  const [busy, setBusy] = useState(false);
  const invalid = draftMax >= autoPost;

  async function save() {
    if (invalid) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/config${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, autoPostMinRating: autoPost, draftMaxRating: draftMax, tonePrompt: tone.trim() || null }),
      });
      if (!r.ok) { toast.error('Save failed'); return; }
      toast.success('Auto-reply settings saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <CardHead
          icon={<Star className="size-4 fill-amber-400 text-amber-400" />}
          title="Auto-reply"
          desc="Decide which reviews are answered automatically."
          right={<Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable auto-reply" />}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <StarPicker id="ar-post" label="Auto-post at or above" value={autoPost} onChange={setAutoPost} />
          <StarPicker id="ar-draft" label="Draft for approval at or below" value={draftMax} onChange={setDraftMax} />
        </div>
        {invalid && (
          <p className="text-xs text-destructive">The draft threshold must be lower than the auto-post threshold.</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ar-tone">Tone instructions (optional)</Label>
          <Textarea id="ar-tone" rows={3} value={tone} placeholder="Warm, brief, sign off with the owner's name." onChange={(e) => setTone(e.target.value)} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {TONE_EXAMPLES.map((t) => (
              <button key={t} type="button" onClick={() => setTone(t)}
                className="rounded-full border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground">
                {t}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={busy || invalid} className="w-full sm:w-auto">
          <Save className="size-3.5" /> {busy ? 'Saving…' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
