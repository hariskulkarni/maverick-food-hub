'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Monitor, ShieldOff, LogOut } from 'lucide-react';

/** Plain (Date-free) shape passed in from the server page. */
export interface SessionRow {
  id: string;
  label: string;
  ipAddress: string | null;
  createdAt: string; // ISO
  lastSeenAt: string; // ISO
  active: boolean;
  revoked: boolean;
}

/** Compact "3 minutes ago" / "2 days ago" relative formatter. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? '' : 's'} ago`;
  const yr = Math.round(mon / 12);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

export function SessionsClient({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const hasOtherActive = sessions.some((s) => s.active === false && !s.revoked);
  const activeCount = sessions.filter((s) => !s.revoked).length;

  async function terminate(id: string) {
    if (busyId) return;
    if (!confirm('Sign out this session?')) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/customer/sessions/${id}`, { method: 'DELETE' });
      if (r.ok) {
        toast.success('Session terminated');
        router.refresh();
      } else {
        toast.error(r.status === 404 ? 'Session not found' : 'Could not terminate session');
      }
    } catch {
      toast.error('Could not terminate session');
    } finally {
      setBusyId(null);
    }
  }

  async function terminateOthers() {
    if (busyAll) return;
    if (!confirm('Sign out of all other sessions?')) return;
    setBusyAll(true);
    try {
      const r = await fetch('/api/customer/sessions/terminate-others', { method: 'POST' });
      if (r.ok) {
        toast.success('Signed out of other sessions');
        router.refresh();
      } else {
        toast.error('Could not sign out other sessions');
      }
    } catch {
      toast.error('Could not sign out other sessions');
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <div className="space-y-4">
      {hasOtherActive && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={terminateOthers}
            disabled={busyAll}
            className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <ShieldOff className="size-4" />
            {busyAll ? 'Signing out…' : 'Sign out everywhere else'}
          </Button>
        </div>
      )}

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">No login history yet.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card className={s.active ? 'border-primary/30' : undefined}>
                <CardContent className="p-4 md:p-5 flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground shrink-0">
                    <Monitor className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{s.label}</span>
                      {s.active && <Badge variant="success" className="text-[10px]">Active now</Badge>}
                      {s.revoked && <Badge variant="muted" className="text-[10px]">Signed out</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>Signed in {relativeTime(s.createdAt)}</div>
                      <div>Last active {relativeTime(s.lastSeenAt)}</div>
                      {s.ipAddress && <div>IP {s.ipAddress}</div>}
                    </div>
                  </div>
                  {!s.revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => terminate(s.id)}
                      disabled={busyId === s.id}
                      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                    >
                      <LogOut className="size-4" />
                      <span className="hidden sm:inline">{busyId === s.id ? 'Ending…' : 'Terminate'}</span>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {activeCount <= 1
          ? 'Only this device is currently signed in.'
          : `${activeCount} sessions shown. Terminating a session signs that device out immediately.`}
      </p>
    </div>
  );
}
