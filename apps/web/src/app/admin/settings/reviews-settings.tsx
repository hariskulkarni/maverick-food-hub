'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Save, ExternalLink, KeyRound } from 'lucide-react';

type Status = 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
interface Part { status: Status; summary: Record<string, any> | null }
interface AutoReply { enabled: boolean; autoPostMinRating: number; draftMaxRating: number; tonePrompt: string | null }
interface ConfigResponse { google: Part; llm: Part; autoReply: AutoReply }

const RATINGS = [1, 2, 3, 4, 5];
const selectCls = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

export function ReviewsSettings({ restaurantId }: { restaurantId?: string } = {}) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/config${qs}`, { cache: 'no-store' });
    if (r.ok) setCfg(await r.json());
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  if (!cfg) return <div className="rounded-lg border bg-muted/20 h-24 shimmer" />;

  return (
    <div className="grid gap-4">
      <GoogleCard part={cfg.google} />
      <LlmCard part={cfg.llm} qs={qs} onSaved={load} />
      <AutoReplyCard initial={cfg.autoReply} qs={qs} />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant={status === 'CONNECTED' ? 'success' : status === 'FAILED' ? 'destructive' : 'muted'} className="text-[10px]">
      {status === 'CONNECTED' ? 'Connected' : status === 'FAILED' ? 'Failed' : 'Not connected'}
    </Badge>
  );
}

function GoogleCard({ part }: { part: Part }) {
  const connected = part.status === 'CONNECTED';
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Google Business Profile</h3>
          <StatusBadge status={part.status} />
        </div>
        {connected ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {Object.entries(part.summary ?? {}).slice(0, 4).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground capitalize">{k}</dt>
                  <dd className="font-mono truncate" title={String(v)}>{String(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">Reviews sync from this location. To switch location, reconnect.</p>
            {/* Disconnect intentionally omitted: use Manage on the Google card in the integrations grid above. */}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Connect your Google Business Profile so Flavrly can pull reviews and post replies.</p>
        )}
        <Button asChild size="sm" variant={connected ? 'outline' : 'default'}>
          <a href="/api/admin/integrations/google-business/connect">
            <ExternalLink className="size-3.5" /> {connected ? 'Reconnect Google' : 'Connect Google Business'}
          </a>
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
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">AI reply model</h3>
          <StatusBadge status={part.status} />
        </div>
        {connected && part.summary && (
          <p className="text-[11px] text-muted-foreground font-mono">
            {String(part.summary.provider)} · {String(part.summary.apiKey)} · {String(part.summary.model)}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="llm-provider">Provider</Label>
            <select id="llm-provider" className={selectCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="nvidia">NVIDIA (free models)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
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
        <Button size="sm" onClick={save} disabled={busy || !ready}>
          <KeyRound className="size-3.5" /> {busy ? 'Testing…' : 'Test & save'}
        </Button>
      </CardContent>
    </Card>
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
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Auto-reply</h3>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable auto-reply" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ar-post">Auto-post at or above (stars)</Label>
            <select id="ar-post" className={selectCls} value={autoPost} onChange={(e) => setAutoPost(Number(e.target.value))}>
              {RATINGS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ar-draft">Draft for approval at or below (stars)</Label>
            <select id="ar-draft" className={selectCls} value={draftMax} onChange={(e) => setDraftMax(Number(e.target.value))}>
              {RATINGS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        {invalid && (
          <p className="text-xs text-destructive">The draft threshold must be lower than the auto-post threshold.</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ar-tone">Tone instructions (optional)</Label>
          <Textarea id="ar-tone" rows={3} value={tone} placeholder="Warm, brief, sign off with the owner's name." onChange={(e) => setTone(e.target.value)} />
        </div>
        <Button size="sm" onClick={save} disabled={busy || invalid}>
          <Save className="size-3.5" /> {busy ? 'Saving…' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
