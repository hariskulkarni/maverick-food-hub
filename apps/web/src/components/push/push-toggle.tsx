'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getExistingSubscription, pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push-client';

/** Opt-in toggle for order-status web push. Opt-in is persisted as a server-side subscription row. */
export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    setSupported(true);
    getExistingSubscription()
      .then((s) => setOn(!!s && Notification.permission === 'granted'))
      .catch(() => undefined);
  }, []);

  if (!supported) return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (on) {
        await unsubscribeFromPush();
        setOn(false);
      } else {
        const r = await subscribeToPush();
        setOn(r === 'subscribed');
        if (r === 'denied') setMsg('Notifications are blocked in your browser settings.');
        else if (r === 'unavailable') setMsg('Notifications are not available right now.');
        else if (r === 'error') setMsg('Could not enable notifications. Try again.');
      }
    } catch {
      setMsg('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary shrink-0">
            <Bell className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">Order notifications</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get push alerts when your order is confirmed, prepared, out for delivery, arrived and delivered.
            </p>
            {msg && <p role="status" className="text-xs text-destructive mt-1">{msg}</p>}
          </div>
        </div>
        <Button
          type="button"
          variant={on ? 'outline' : 'default'}
          size="md"
          onClick={toggle}
          disabled={busy}
          aria-pressed={on}
          className="shrink-0 min-h-11"
        >
          {busy ? '…' : on ? 'Turn off' : 'Turn on'}
        </Button>
      </CardContent>
    </Card>
  );
}
