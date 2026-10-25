'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bell, FileText, Mail, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { reportApiError } from '@/lib/api-error';
import { renderTemplate, TEMPLATE_VARIABLES } from '@/lib/review-templates';
import { checkReplySafety } from '@/lib/review-reply-safety';

type Settings = {
  skipKeywords: string[]; brandVoiceSummary: string | null; brandVoiceUpdatedAt: string | null;
  alertEnabled: boolean; alertMaxRating: number; alertSms: boolean; alertWhatsapp: boolean;
  slaHours: number; escalationEmail: string | null; escalationPhone: string | null;
  digestEnabled: boolean; digestSms: boolean; digestWhatsapp: boolean; digestLastSentAt: string | null;
};
type Template = { id: string; name: string; body: string };

function Head({ icon, title, desc, right }: { icon: React.ReactNode; title: string; desc: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">{icon}</span>
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3">
      <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ReviewResponseSettings({ qs }: { qs: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/response-settings${qs}`, { cache: 'no-store' });
    if (r.ok) setS(await r.json());
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<Settings>, msg: string): Promise<boolean> {
    const r = await fetch(`/api/admin/reviews/response-settings${qs}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!r.ok) { await reportApiError(r, 'Save failed'); return false; }
    setS(await r.json());
    toast.success(msg);
    return true;
  }

  if (!s) return <div className="h-24 rounded-2xl border bg-muted/20 shimmer" />;
  return (
    <>
      <RulesCard s={s} qs={qs} save={save} onVoice={(v) => setS({ ...s, ...v })} />
      <TemplatesCard qs={qs} />
      <AlertsCard s={s} save={save} />
      <DigestCard s={s} qs={qs} save={save} />
    </>
  );
}

type SaveFn = (patch: Partial<Settings>, msg: string) => Promise<boolean>;

function RulesCard({ s, qs, save, onVoice }: { s: Settings; qs: string; save: SaveFn; onVoice: (v: Partial<Settings>) => void }) {
  const [keywords, setKeywords] = useState<string[]>(s.skipKeywords);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  function add() {
    const k = draft.trim().toLowerCase();
    if (k.length < 2 || keywords.includes(k)) { setDraft(''); return; }
    setKeywords([...keywords, k]);
    setDraft('');
  }
  async function refreshVoice() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/brand-voice${qs}`, { method: 'POST' });
      if (!r.ok) { await reportApiError(r, 'Could not learn brand voice'); return; }
      const d = await r.json();
      onVoice({ brandVoiceSummary: d.brandVoiceSummary, brandVoiceUpdatedAt: d.brandVoiceUpdatedAt });
      toast.success(d.brandVoiceSummary ? 'Brand voice updated' : `Need at least 3 posted replies (found ${d.samples}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <Head icon={<ShieldCheck className="size-4 text-primary" />} title="Reply rules & brand voice"
          desc="Reviews that mention these words are never auto-posted; they wait for your approval." />
        <div className="space-y-2">
          <Label htmlFor="kw-add">Hold for approval when a review mentions</Label>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1 text-xs">
                {k}
                <button type="button" aria-label={`Remove ${k}`} className="rounded-full p-1 hover:bg-muted" onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {keywords.length === 0 && <span className="text-xs text-muted-foreground">No keywords: high ratings always auto-post.</span>}
          </div>
          <div className="flex gap-2">
            <Input id="kw-add" value={draft} placeholder="e.g. allergy" onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <Button type="button" variant="outline" className="min-h-[44px] shrink-0" onClick={add}><Plus className="size-4" /> Add</Button>
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl border bg-muted/20 p-3">
          <p className="text-sm font-medium">Brand voice</p>
          <p className="text-xs text-muted-foreground">
            {s.brandVoiceSummary ?? 'Not learned yet. It is learned from your last 20 posted replies (at least 3 needed).'}
          </p>
          <p className="text-[11px] text-muted-foreground">Your tone notes in the Auto-reply card are added on top of this.</p>
          <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy} onClick={refreshVoice}>
            <RefreshCw className="size-3.5" /> {busy ? 'Learning…' : 'Re-learn from my replies'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Every reply, AI or typed, is checked before posting: no offers or discounts for reviews, no requests to change a review,
          and no phone numbers, emails or order details.
        </p>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => save({ skipKeywords: keywords }, 'Reply rules saved.')}>
          <Save className="size-3.5" /> Save rules
        </Button>
      </CardContent>
    </Card>
  );
}

function TemplatesCard({ qs }: { qs: string }) {
  const [list, setList] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/templates${qs}`, { cache: 'no-store' });
    if (r.ok) setList((await r.json()).templates);
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  async function req(url: string, init: RequestInit, ok: string) {
    setBusy(true);
    try {
      const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      if (!r.ok) { await reportApiError(r, 'Template action failed'); return false; }
      toast.success(ok);
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!editing) return;
    const body = JSON.stringify({ name: editing.name, body: editing.body });
    const done = editing.id
      ? await req(`/api/admin/reviews/templates/${editing.id}${qs}`, { method: 'PATCH', body }, 'Template saved')
      : await req(`/api/admin/reviews/templates${qs}`, { method: 'POST', body }, 'Template added');
    if (done) setEditing(null);
  }
  const issues = editing ? checkReplySafety(renderTemplate(editing.body, { name: 'Asha', dish: 'Biryani' })) : [];

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <Head icon={<FileText className="size-4 text-primary" />} title="Reply templates"
          desc={`Reusable snippets for the reply box. Variables: ${TEMPLATE_VARIABLES.join(', ')}.`}
          right={<Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditing({ id: null, name: '', body: '' })}><Plus className="size-3.5" /> New</Button>} />
        {list === null ? <div className="h-12 rounded-xl bg-muted/30 shimmer" /> : list.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            <p>No templates yet.</p>
            <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy}
              onClick={() => req(`/api/admin/reviews/templates${qs}`, { method: 'POST', body: JSON.stringify({ starter: true }) }, 'Starter templates added')}>
              Add starter templates
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 rounded-xl border p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing({ id: t.id, name: t.name, body: t.body })}>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{t.body}</p>
                </button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} className="min-h-[44px]" disabled={busy}
                  onClick={() => req(`/api/admin/reviews/templates/${t.id}${qs}`, { method: 'DELETE' }, 'Template deleted')}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Text</Label>
              <Textarea id="tpl-body" rows={3} value={editing.body} maxLength={1500} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </div>
            {editing.body.trim() && (
              <p className="text-xs text-muted-foreground">Preview: {renderTemplate(editing.body, { name: 'Asha Rao', dish: 'Biryani' })}</p>
            )}
            {issues.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-xs text-destructive">{issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="min-h-[44px]" disabled={busy || !editing.name.trim() || !editing.body.trim() || issues.length > 0} onClick={submit}>
                <Save className="size-3.5" /> Save template
              </Button>
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertsCard({ s, save }: { s: Settings; save: SaveFn }) {
  const [f, setF] = useState({
    alertEnabled: s.alertEnabled, alertMaxRating: s.alertMaxRating, alertSms: s.alertSms, alertWhatsapp: s.alertWhatsapp,
    slaHours: s.slaHours, escalationEmail: s.escalationEmail ?? '', escalationPhone: s.escalationPhone ?? '',
  });
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <Head icon={<Bell className="size-4 text-primary" />} title="Alerts & reply target"
          desc="Get told about low ratings fast, with the AI draft and a link to reply."
          right={<Switch checked={f.alertEnabled} onCheckedChange={(v) => setF({ ...f, alertEnabled: v })} aria-label="Enable negative review alerts" />} />
        <div className="space-y-1.5">
          <Label id="alert-max-label">Alert on new reviews rated at or below</Label>
          <div role="radiogroup" aria-labelledby="alert-max-label" className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={f.alertMaxRating === n} onClick={() => setF({ ...f, alertMaxRating: n })}
                className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 text-sm ${f.alertMaxRating === n ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}>
                {n}★
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Email goes to the owner and restaurant admins. Text messages use your SMS / WhatsApp setup.</p>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle id="alert-sms" label="Also send SMS" checked={f.alertSms} onChange={(v) => setF({ ...f, alertSms: v })} />
          <Toggle id="alert-wa" label="Also send WhatsApp" checked={f.alertWhatsapp} onChange={(v) => setF({ ...f, alertWhatsapp: v })} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sla-hours">Reply target (hours)</Label>
            <Input id="sla-hours" type="number" inputMode="numeric" min={1} max={168} value={f.slaHours}
              onChange={(e) => setF({ ...f, slaHours: Number(e.target.value) || 1 })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esc-email">Escalate overdue to (email)</Label>
            <Input id="esc-email" type="email" value={f.escalationEmail} placeholder="manager@example.com" onChange={(e) => setF({ ...f, escalationEmail: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esc-phone">or phone (SMS)</Label>
            <Input id="esc-phone" type="tel" value={f.escalationPhone} placeholder="+91…" onChange={(e) => setF({ ...f, escalationPhone: e.target.value })} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Reviews without a reply after the target show as Overdue in the inbox, and each is escalated once to this second contact.</p>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => save(f, 'Alert settings saved.')}><Save className="size-3.5" /> Save alerts</Button>
      </CardContent>
    </Card>
  );
}

function DigestCard({ s, qs, save }: { s: Settings; qs: string; save: SaveFn }) {
  const [f, setF] = useState({ digestEnabled: s.digestEnabled, digestSms: s.digestSms, digestWhatsapp: s.digestWhatsapp });
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/digest/test${qs}`, { method: 'POST' });
      if (!r.ok) { await reportApiError(r, 'Could not send the test digest'); return; }
      const d = await r.json();
      toast.success(`Test digest sent to ${d.recipients} email recipient${d.recipients === 1 ? '' : 's'}.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <Head icon={<Mail className="size-4 text-primary" />} title="Weekly digest"
          desc="Every Monday at 9:00 AM: rating, reply rate, praised dishes, top issues and overdue replies."
          right={<Switch checked={f.digestEnabled} onCheckedChange={(v) => setF({ ...f, digestEnabled: v })} aria-label="Enable weekly digest" />} />
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle id="dg-sms" label="Short version by SMS" checked={f.digestSms} onChange={(v) => setF({ ...f, digestSms: v })} />
          <Toggle id="dg-wa" label="Short version on WhatsApp" checked={f.digestWhatsapp} onChange={(v) => setF({ ...f, digestWhatsapp: v })} />
        </div>
        {s.digestLastSentAt && <p className="text-[11px] text-muted-foreground">Last sent {new Date(s.digestLastSentAt).toLocaleString()}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="sm" className="min-h-[44px]" onClick={() => save(f, 'Digest settings saved.')}><Save className="size-3.5" /> Save digest</Button>
          <Button size="sm" variant="outline" className="min-h-[44px]" disabled={busy} onClick={test}>
            <Send className="size-3.5" /> {busy ? 'Sending…' : 'Send test digest now'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
