'use client';
/**
 * Rider support tickets explorer. List with message counts + last activity;
 * row click opens a drawer with the full message thread, a reply box, and a
 * status selector. Replies POST to /api/platform/rider-support/:id.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { fmtDate, relTime } from '@/lib/utils';
import { LifeBuoy, Phone, Bike, MessageSquare, Loader2, Send } from 'lucide-react';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_RIDER' | 'RESOLVED' | 'CLOSED';

interface Message {
  id: string;
  ticketId: string;
  fromRider: boolean;
  authorName: string | null;
  body: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  riderId: string;
  subject: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastActivityAt: string;
  messages: Message[];
  rider: { id: string; name: string | null; phone: string | null };
}

const STATUSES: (TicketStatus | 'ALL')[] = ['ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_RIDER', 'RESOLVED', 'CLOSED'];

export function RiderSupportClient({ initial }: { initial: Ticket[] }) {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>(initial);
  const [status, setStatus] = useState<TicketStatus | 'ALL'>('ALL');
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = tickets.slice();
    if (status !== 'ALL') r = r.filter((x) => x.status === status);
    return r;
  }, [tickets, status]);

  const selected = tickets.find((t) => t.id === activeId) ?? null;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'All' : prettyStatus(s as TicketStatus)}
              </Chip>
            ))}
            <span className="text-xs text-muted-foreground ml-2">
              {filtered.length} ticket{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={LifeBuoy} title="No tickets" description="No support tickets match the current filter." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Subject</Th>
                    <Th>Rider</Th>
                    <Th>Category</Th>
                    <Th>Status</Th>
                    <Th>Messages</Th>
                    <Th>Last activity</Th>
                    <th className="text-right px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(t.id)}>
                      <td className="px-4 py-3 font-medium text-xs max-w-[260px] truncate">{t.subject}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{t.rider.name ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{t.rider.phone ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-[10px]">
                          {prettyCategory(t.category)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="size-3" />
                          {t.messageCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{relTime(t.lastActivityAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveId(t.id);
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <TicketDrawer
          ticket={selected}
          onClose={() => setActiveId(null)}
          onUpdated={(t) => {
            setTickets((prev) => prev.map((x) => (x.id === t.id ? t : x)));
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function TicketDrawer({
  ticket,
  onClose,
  onUpdated,
}: {
  ticket: Ticket;
  onClose: () => void;
  onUpdated: (t: Ticket) => void;
}) {
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [sending, setSending] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    const r = await fetch(`/api/platform/rider-support/${ticket.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply.trim(), status: status !== ticket.status ? status : undefined }),
    });
    setSending(false);
    if (!r.ok) return toast.error(`Reply failed: ${await r.text()}`);
    const { ticket: updated } = await r.json();
    toast.success('Reply sent');
    setReply('');
    setStatus(updated.status);
    onUpdated(updated);
  }

  async function saveStatus() {
    setSavingStatus(true);
    const r = await fetch(`/api/platform/rider-support/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setSavingStatus(false);
    if (!r.ok) return toast.error(`Update failed: ${await r.text()}`);
    const { ticket: updated } = await r.json();
    toast.success('Status updated');
    onUpdated(updated);
  }

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={ticket.subject}
      subtitle={`Opened ${fmtDate(ticket.createdAt)} · ${prettyCategory(ticket.category)}`}
      badge={<StatusPill status={ticket.status} />}
      width="640px"
      footer={
        <div className="space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type a reply to the rider…"
            className="min-h-[70px]"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send reply
            </Button>
          </div>
        </div>
      }
    >
      <DrawerSection title="Rider">
        <div className="p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <Bike className="size-4 text-success" />
            {ticket.rider.name ?? '—'}
          </div>
          {ticket.rider.phone && (
            <a
              href={`tel:${ticket.rider.phone}`}
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <Phone className="size-3.5" /> <span className="font-mono">{ticket.rider.phone}</span>
            </a>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Status">
        <div className="p-4 flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ticket status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
              className="h-9 mt-1 w-full rounded-md border bg-card px-2 text-sm"
            >
              {(['OPEN', 'IN_PROGRESS', 'WAITING_ON_RIDER', 'RESOLVED', 'CLOSED'] as TicketStatus[]).map((s) => (
                <option key={s} value={s}>
                  {prettyStatus(s)}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={saveStatus}
            disabled={savingStatus || status === ticket.status}
          >
            {savingStatus ? <Loader2 className="size-3.5 animate-spin" /> : null} Update
          </Button>
        </div>
      </DrawerSection>

      <DrawerSection title={`Conversation (${ticket.messages.length})`}>
        <div className="p-4 space-y-3">
          {ticket.messages.length === 0 && (
            <p className="text-xs text-muted-foreground">No messages yet.</p>
          )}
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg p-3 text-sm ${
                m.fromRider ? 'bg-muted/50' : 'bg-primary/5 border border-primary/15'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.fromRider ? ticket.rider.name ?? 'Rider' : m.authorName ?? 'Support'}
                </span>
                <span className="text-[10px] text-muted-foreground">{fmtDate(m.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-xs">{m.body}</p>
            </div>
          ))}
        </div>
      </DrawerSection>
    </DetailDrawer>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: TicketStatus }) {
  const map: Record<TicketStatus, { variant: 'warning' | 'default' | 'secondary' | 'success' | 'muted'; label: string }> =
    {
      OPEN: { variant: 'warning', label: 'Open' },
      IN_PROGRESS: { variant: 'default', label: 'In progress' },
      WAITING_ON_RIDER: { variant: 'secondary', label: 'Waiting on rider' },
      RESOLVED: { variant: 'success', label: 'Resolved' },
      CLOSED: { variant: 'muted', label: 'Closed' },
    };
  const x = map[status];
  return (
    <Badge variant={x.variant} className="text-[10px]">
      {x.label}
    </Badge>
  );
}

function prettyStatus(s: TicketStatus): string {
  return {
    OPEN: 'Open',
    IN_PROGRESS: 'In progress',
    WAITING_ON_RIDER: 'Waiting on rider',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  }[s];
}

function prettyCategory(c: string): string {
  return c
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
