'use client';
/**
 * Admin ⇄ rider chat. Left column = conversations + a "start new chat" rider
 * picker; right pane = the selected thread with chat bubbles and a composer.
 * The open thread is polled every ~4s for liveness; sending is disabled while
 * a POST is in flight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { relTime, fmtDate } from '@/lib/utils';
import { MessageSquare, Loader2, Send, Bike, Plus, Search, X, AlertCircle } from 'lucide-react';

interface Message {
  id: string;
  conversationId: string;
  sender: 'RIDER' | 'ADMIN' | 'SUPER_ADMIN';
  senderName: string | null;
  body: string;
  readByRider: boolean;
  readByStaff: boolean;
  createdAt: string;
}

interface Conversation {
  id: string;
  riderId: string;
  party: string;
  restaurantId: string | null;
  subject: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  unreadCount: number;
  lastMessage: Message | null;
  messages: Message[];
  rider: { id: string; name: string | null; phone: string | null; avatarUrl: string | null } | null;
}

interface Rider {
  id: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isOnline: boolean;
  dedicated: boolean;
}

export function AdminMessagesClient({
  restaurantName,
  initialConversations,
  initialRiders,
}: {
  restaurantName: string;
  initialConversations: Conversation[];
  initialRiders: Rider[];
}) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [riders] = useState<Rider[]>(initialRiders);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [riderQuery, setRiderQuery] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  const sortedConversations = useMemo(
    () =>
      conversations
        .slice()
        .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt)),
    [conversations]
  );

  // Riders without an existing conversation yet — candidates for "new chat".
  const startableRiders = useMemo(() => {
    const withConvo = new Set(conversations.map((c) => c.riderId));
    const q = riderQuery.trim().toLowerCase();
    return riders
      .filter((r) => !withConvo.has(r.id))
      .filter(
        (r) =>
          !q ||
          (r.name ?? '').toLowerCase().includes(q) ||
          (r.phone ?? '').toLowerCase().includes(q)
      );
  }, [riders, conversations, riderQuery]);

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setThreadLoading(true);
      setThreadError(null);
    }
    try {
      const r = await fetch(`/api/admin/messages/${id}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(await r.text());
      const { conversation } = (await r.json()) as { conversation: Conversation };
      setThread(conversation);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversation.id ? { ...conversation } : c))
      );
    } catch (e) {
      if (!silent) setThreadError(e instanceof Error ? e.message : 'Failed to load thread');
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  // Open a thread when the active conversation changes.
  useEffect(() => {
    if (!activeId) {
      setThread(null);
      return;
    }
    loadThread(activeId);
  }, [activeId, loadThread]);

  // Poll the open thread every ~4s for liveness.
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => loadThread(activeId, true), 4000);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  // Auto-scroll to the newest message whenever the thread changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages.length, activeId]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      let convoId = activeId;
      let res: Response;
      if (convoId) {
        res = await fetch(`/api/admin/messages/${convoId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text }),
        });
      } else {
        // Shouldn't happen — composer is only shown with an active thread.
        throw new Error('No conversation selected');
      }
      if (!res.ok) throw new Error(await res.text());
      const { conversation } = (await res.json()) as { conversation: Conversation };
      setThread(conversation);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversation.id ? { ...conversation } : c))
      );
      setDraft('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function startChat(rider: Rider) {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/admin/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: rider.id, body: `Hi ${rider.name ?? 'there'} 👋` }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { conversation } = (await res.json()) as { conversation: Conversation };
      setConversations((prev) => {
        const without = prev.filter((c) => c.id !== conversation.id);
        return [conversation, ...without];
      });
      setPicking(false);
      setRiderQuery('');
      setActiveId(conversation.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start chat');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ── Left: conversation list ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <span className="text-sm font-semibold">Conversations</span>
            <Button size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>
              {picking ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
              {picking ? 'Close' : 'New'}
            </Button>
          </div>

          {picking && (
            <div className="border-b bg-muted/30 p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={riderQuery}
                  onChange={(e) => setRiderQuery(e.target.value)}
                  placeholder="Search riders…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {startableRiders.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No other riders to start a chat with.
                  </p>
                ) : (
                  startableRiders.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => startChat(r)}
                      disabled={sending}
                      className="flex w-full items-center gap-2 rounded-md p-2 text-left text-xs hover:bg-accent disabled:opacity-50"
                    >
                      <RiderAvatar rider={r} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.name ?? 'Rider'}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.phone ?? '—'}
                        </span>
                      </span>
                      {r.dedicated && (
                        <Badge variant="secondary" className="text-[9px]">
                          Dedicated
                        </Badge>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto">
            {sortedConversations.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={MessageSquare}
                  title="No conversations yet"
                  description="Start a chat with one of your riders using the New button."
                />
              </div>
            ) : (
              <ul className="divide-y">
                {sortedConversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      className={`flex w-full items-start gap-2.5 p-3 text-left transition-colors hover:bg-muted/40 ${
                        activeId === c.id ? 'bg-muted/60' : ''
                      }`}
                    >
                      <RiderAvatar rider={c.rider} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {c.rider?.name ?? 'Rider'}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {relTime(c.lastMessageAt)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastMessage
                            ? `${c.lastMessage.sender === 'RIDER' ? '' : 'You: '}${c.lastMessage.body}`
                            : 'No messages yet'}
                        </p>
                      </div>
                      {c.unreadCount > 0 && (
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {c.unreadCount}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Right: thread + composer ────────────────────────────────────── */}
      <Card className="flex min-h-[60vh] flex-col overflow-hidden">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessageSquare}
              title="Select a conversation"
              description="Pick a rider on the left to read and reply to their messages."
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b p-3">
              <RiderAvatar rider={thread?.rider ?? null} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {thread?.rider?.name ?? 'Rider'}
                </div>
                {thread?.rider?.phone && (
                  <a
                    href={`tel:${thread.rider.phone}`}
                    className="text-[11px] font-mono text-primary hover:underline"
                  >
                    {thread.rider.phone}
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
              {threadLoading && !thread ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : threadError ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-destructive">
                  <AlertCircle className="size-6" />
                  <span>{threadError}</span>
                  <Button size="sm" variant="outline" onClick={() => loadThread(activeId)}>
                    Retry
                  </Button>
                </div>
              ) : thread && thread.messages.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  No messages yet — say hello.
                </p>
              ) : (
                thread?.messages.map((m) => <Bubble key={m.id} message={m} />)
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={`Message as ${restaurantName}…`}
                  className="min-h-[44px] flex-1 resize-none"
                />
                <Button onClick={send} disabled={sending || !draft.trim()}>
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** A chat bubble — rider messages left/muted, staff messages right/primary. */
function Bubble({ message }: { message: Message }) {
  const fromRider = message.sender === 'RIDER';
  return (
    <div className={`flex ${fromRider ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${
          fromRider
            ? 'rounded-bl-sm bg-card border'
            : 'rounded-br-sm bg-primary text-primary-foreground'
        }`}
      >
        <div
          className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            fromRider ? 'text-muted-foreground' : 'text-primary-foreground/70'
          }`}
        >
          {fromRider ? message.senderName ?? 'Rider' : message.senderName ?? 'You'}
        </div>
        <p className="whitespace-pre-wrap">{message.body}</p>
        <div
          className={`mt-1 text-[10px] ${
            fromRider ? 'text-muted-foreground' : 'text-primary-foreground/70'
          }`}
        >
          {fmtDate(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function RiderAvatar({
  rider,
}: {
  rider: { name: string | null; avatarUrl: string | null; isOnline?: boolean } | null;
}) {
  return (
    <div className="relative shrink-0">
      {rider?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rider.avatarUrl}
          alt={rider.name ?? 'Rider'}
          className="size-9 rounded-full object-cover"
        />
      ) : (
        <div className="grid size-9 place-items-center rounded-full bg-success/10 text-success">
          <Bike className="size-4" />
        </div>
      )}
      {rider?.isOnline && (
        <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-success" />
      )}
    </div>
  );
}
