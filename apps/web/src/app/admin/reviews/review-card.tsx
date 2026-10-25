'use client';
import { useState } from 'react';
import {
  AlertTriangle, Bot, CheckCircle2, Clock, Copy, ExternalLink, MessageSquareReply, Package, RefreshCw,
  RotateCcw, Save, ShieldAlert, Sparkles, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';
import { checkReplySafety } from '@/lib/review-reply-safety';
import { renderTemplate } from '@/lib/review-templates';

export type ReplyState = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'FAILED' | 'SKIPPED';

export type Review = {
  id: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  reviewCreatedAt: string;
  reviewUpdatedAt?: string | null;
  /** 'gbp' = Business Profile (inline reply) | 'places' = Places API (read-only). */
  source?: 'gbp' | 'places';
  media?: Array<{ url: string; thumbnailUrl: string | null; type: string }>;
  hasOrderMatch?: boolean;
  overdue?: boolean;
  reply: {
    state: ReplyState; text: string | null; source: string | null; postedAt: string | null;
    error?: string | null; holdReason?: string | null; moderationState?: string | null;
    policyViolation?: string | null; reviewReplyUrl?: string | null;
  } | null;
};

export type Template = { id: string; name: string; body: string };

type OrderMatch = {
  orderId: string; code: string; confidence: number | null;
  items: Array<{ name: string; quantity: number }>;
  deliveredAt: string | null; promisedAt: string | null; lateByMin: number | null; riderName: string | null;
};

// Places API is read-only, so owners reply in Google's own UI.
export const GOOGLE_REPLY_URL = 'https://business.google.com/reviews';

export function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden="true"
          className={cn('h-4 w-4', i <= n ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/30')} />
      ))}
    </span>
  );
}

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : '');

export function relTime(d: string | null) {
  if (!d) return '';
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

function StatusPill({ state }: { state: ReplyState }) {
  const map: Record<ReplyState, { label: string; cls: string }> = {
    POSTED: { label: 'Posted', cls: 'border-success/30 bg-success/10 text-success' },
    PENDING_APPROVAL: { label: 'Draft - pending', cls: 'border-warning/40 bg-warning/10 text-warning' },
    DRAFT: { label: 'Saved draft', cls: 'border-warning/40 bg-warning/10 text-warning' },
    FAILED: { label: 'Failed', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
    SKIPPED: { label: 'Skipped', cls: 'border-border bg-muted text-muted-foreground' },
  };
  const m = map[state];
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', m.cls)}>{m.label}</span>;
}

function Avatar({ name }: { name: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 font-display text-base font-semibold text-primary ring-1 ring-primary/20">
      {initial}
    </span>
  );
}

const isRejected = (r: Review['reply']) => !!r && (/reject/i.test(r.moderationState ?? '') || !!r.policyViolation);
const isPendingModeration = (r: Review['reply']) => !!r && /pending|review/i.test(r.moderationState ?? '') && !isRejected(r);

/** Inline warning list for the public-reply safety filter (same rules as the server). */
function SafetyWarnings({ text, terms }: { text: string; terms: string[] }) {
  const issues = text.trim() ? checkReplySafety(text, terms) : [];
  if (!issues.length) return null;
  return (
    <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
      <p className="flex items-center gap-1.5 font-medium"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> This reply cannot be posted yet</p>
      <ul className="list-disc pl-5">{issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
    </div>
  );
}

export function ReviewCard({ r, templates, highlight, onChanged }: {
  r: Review; templates: Template[]; highlight?: boolean; onChanged: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [match, setMatch] = useState<OrderMatch | null | undefined>(undefined);
  const reply = r.reply;
  const editable = !reply || reply.state !== 'POSTED';
  const base = reply && reply.state !== 'POSTED' && reply.state !== 'SKIPPED' ? reply.text ?? '' : '';
  const value = text ?? base;
  const terms = match ? [match.code, match.riderName ?? '', (match.riderName ?? '').split(/\s+/)[0]].filter(Boolean) : [];
  const unsafe = value.trim() ? checkReplySafety(value, terms).length > 0 : false;

  async function call(path: string, init: RequestInit, ok: string): Promise<any | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/reviews/${r.id}/${path}`, {
        headers: { 'Content-Type': 'application/json' }, ...init,
      });
      if (!res.ok) {
        await reportApiError(res, 'Action failed');
        if (res.status === 502) onChanged(); // stored as FAILED: show Retry
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (ok) toast.success(ok);
      return data;
    } catch {
      toast.error('Action failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function post(body: string) {
    const d = await call('reply', { method: 'POST', body: JSON.stringify({ text: body }) }, 'Reply posted');
    if (d) { setText(null); onChanged(); }
  }
  async function approve() {
    if (value.trim() === (reply?.text ?? '').trim()) {
      const d = await call('approve', { method: 'POST' }, 'Reply posted');
      if (d) onChanged();
      return;
    }
    await post(value.trim());
  }
  async function generate(label = 'Draft generated') {
    const d = await call('generate', { method: 'POST' }, label);
    if (d) { setText(null); onChanged(); }
  }
  async function saveDraft() {
    const d = await call('reply', { method: 'PUT', body: JSON.stringify({ text: value.trim() }) }, 'Draft saved');
    if (d) { setText(null); onChanged(); }
  }
  async function retry() {
    if (reply?.text?.trim()) return post(text?.trim() || reply.text);
    return generate('New draft generated');
  }
  async function placesDraft() {
    const d = await call('draft', { method: 'POST' }, '');
    if (d?.text) setAiDraft(d.text);
  }
  async function loadMatch(rematch: boolean) {
    const d = await call('order-context', { method: rematch ? 'POST' : 'GET' }, '');
    if (d) {
      setMatch(d.match ?? null);
      if (!d.match) toast.message('No matching order found in the 72 hours before this review.');
    }
  }
  function insertTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const dish = match?.items[0]?.name ?? null;
    setText(renderTemplate(t.body, { name: r.reviewerName, dish }));
  }
  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(aiDraft ?? '');
      toast.success('Copied. Paste it into your Google reply.');
    } catch {
      toast.error('Copy failed. Select the text and copy manually.');
    }
  }

  const pendingLike = reply?.state === 'PENDING_APPROVAL' || reply?.state === 'DRAFT';

  return (
    <Card id={`review-${r.id}`} className={cn('shadow-sm transition-shadow hover:shadow-md', pendingLike && 'border-l-4 border-l-warning', highlight && 'ring-2 ring-primary')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar name={r.reviewerName} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{r.reviewerName ?? 'Anonymous'}</span>
              {r.source === 'places' && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">via Google Places</span>
              )}
              <span className="text-xs text-muted-foreground" title={fmt(r.reviewCreatedAt)}>{relTime(r.reviewCreatedAt)}</span>
              {r.reviewUpdatedAt && new Date(r.reviewUpdatedAt).getTime() - new Date(r.reviewCreatedAt).getTime() > 60_000 && (
                <span className="text-[11px] text-muted-foreground" title={fmt(r.reviewUpdatedAt)}>edited</span>
              )}
              {r.overdue && (
                <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  <Clock className="h-3 w-3" aria-hidden="true" /> Overdue
                </span>
              )}
            </div>
            <Stars n={r.rating} />
          </div>
          {reply && <StatusPill state={reply.state} />}
        </div>

        {r.comment && <p className="whitespace-pre-wrap break-words text-sm">{r.comment}</p>}

        {!!r.media?.length && (
          <div className="flex flex-wrap gap-2" aria-label="Review photos">
            {r.media.map((m) => (
              <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbnailUrl ?? m.url} alt="Photo attached to the review" className="h-16 w-16 rounded-lg border object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        )}

        {r.source !== 'places' && (
          <div className="space-y-2">
            {match === undefined ? (
              <Button variant="ghost" size="sm" className="min-h-[44px] gap-2 px-2 text-xs" disabled={busy} onClick={() => loadMatch(!r.hasOrderMatch)}>
                <Package className="h-3.5 w-3.5" aria-hidden="true" /> {r.hasOrderMatch ? 'Show likely order' : 'Find matching order'}
              </Button>
            ) : match && (
              <div className="space-y-1 rounded-xl border border-dashed bg-muted/30 p-3 text-xs">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  <Package className="h-3.5 w-3.5" aria-hidden="true" /> Likely order {match.code}
                  {match.confidence != null && <span className="text-muted-foreground">({Math.round(match.confidence * 100)}% match)</span>}
                </p>
                <p>{match.items.map((i) => `${i.name} x${i.quantity}`).join(', ') || 'No items'}</p>
                <p className="text-muted-foreground">
                  Delivered {fmt(match.deliveredAt) || '-'}
                  {match.lateByMin != null && (match.lateByMin > 5 ? ` · ${match.lateByMin} min late vs promised` : ' · on time')}
                  {match.riderName ? ` · Rider ${match.riderName}` : ''}
                </p>
                <p className="text-muted-foreground">Private context for you and the AI draft. Never posted publicly.</p>
              </div>
            )}
          </div>
        )}

        {reply?.state === 'POSTED' ? (
          <div className="ml-4 space-y-2 rounded-2xl rounded-tl-sm border border-success/20 bg-success/5 p-3 text-sm sm:ml-12">
            <p className="flex items-center gap-1.5 text-xs font-medium text-success">
              <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" /> Your reply
            </p>
            <p className="whitespace-pre-wrap break-words">{reply.text}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Posted {fmt(reply.postedAt)}</span>
              {isPendingModeration(reply) && <span className="text-warning">Awaiting Google moderation</span>}
              {reply.reviewReplyUrl && (
                <a href={reply.reviewReplyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                  View on Google <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
            {isRejected(reply) && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Google rejected this reply</p>
                {reply.policyViolation && <p>Reason: {reply.policyViolation}</p>}
                <Button size="sm" className="min-h-[44px] gap-2" disabled={busy} onClick={() => generate('Redraft ready for approval')}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Redraft
                </Button>
              </div>
            )}
          </div>
        ) : r.source === 'places' ? (
          <div className="space-y-2 rounded-xl bg-muted/40 p-3" data-testid="places-actions">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild className="min-h-[44px] gap-2">
                <a href={GOOGLE_REPLY_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Reply on Google
                </a>
              </Button>
              <Button variant="outline" className="min-h-[44px] gap-2" disabled={busy} onClick={placesDraft}>
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {aiDraft ? 'Regenerate AI draft' : 'AI draft'}
              </Button>
            </div>
            {aiDraft && (
              <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" /> AI draft - copy, then paste into Google
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{aiDraft}</p>
                <SafetyWarnings text={aiDraft} terms={terms} />
                <Button variant="outline" className="min-h-[44px] gap-2" onClick={copyDraft}>
                  <Copy className="h-4 w-4" aria-hidden="true" /> Copy
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Replies to these reviews are posted on Google, not here.</p>
          </div>
        ) : editable && (
          <div className={cn('space-y-2 rounded-xl p-3', pendingLike ? 'border border-warning/30 bg-warning/5' : 'bg-muted/40')}>
            {pendingLike && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <Bot className="h-3.5 w-3.5" aria-hidden="true" /> {reply?.state === 'DRAFT' ? 'Saved draft - finish and post' : 'Suggested reply - edit before posting'}
              </p>
            )}
            {reply?.holdReason && <p className="text-xs text-muted-foreground">{reply.holdReason}</p>}
            {reply?.state === 'FAILED' && (
              <p role="alert" className="text-xs text-destructive">Posting failed: {reply.error ?? 'unknown error'}</p>
            )}
            <textarea
              aria-label={pendingLike ? 'Draft reply' : 'Reply'}
              className="w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={pendingLike ? 4 : 3}
              placeholder="Write a reply…"
              value={value}
              onChange={(e) => setText(e.target.value)}
            />
            <SafetyWarnings text={value} terms={terms} />
            <div className="flex flex-wrap items-center gap-2">
              {reply?.state === 'FAILED' ? (
                <Button className="min-h-[44px] gap-2" disabled={busy || (!!value.trim() && unsafe)} onClick={retry}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                </Button>
              ) : pendingLike ? (
                <Button className="min-h-[44px] gap-2" disabled={busy || !value.trim() || unsafe} onClick={approve}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve &amp; Post
                </Button>
              ) : (
                <Button className="min-h-[44px]" disabled={busy || !value.trim() || unsafe} onClick={() => post(value.trim())}>
                  Post reply
                </Button>
              )}
              <Button variant="outline" className="min-h-[44px] gap-2" disabled={busy} onClick={() => generate()}>
                {pendingLike ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                {pendingLike ? 'Regenerate' : 'Generate draft'}
              </Button>
              <Button variant="ghost" className="min-h-[44px] gap-2" disabled={busy || !value.trim()} onClick={saveDraft}>
                <Save className="h-4 w-4" aria-hidden="true" /> Save draft
              </Button>
              {templates.length > 0 && (
                <select
                  aria-label="Insert a reply template"
                  className="min-h-[44px] max-w-full rounded-md border bg-background px-2 text-sm"
                  value=""
                  onChange={(e) => insertTemplate(e.target.value)}
                >
                  <option value="">Insert template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
