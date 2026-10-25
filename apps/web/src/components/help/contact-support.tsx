'use client';
/**
 * "Still need help?" fallback — opens a ticket through the existing
 * POST /api/support/tickets flow (the same inbox /platform/support reads;
 * restaurant staff tickets are tied to their restaurant server-side).
 */
import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { submitIssue } from '@/lib/help-issue';

export function ContactSupport({ context }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const description = context ? `${message.trim()}\n\n— ${context}` : message.trim();
    const r = await submitIssue({ category: 'OTHER', description, orderId });
    setState(r.ok ? 'done' : 'error');
  }

  return (
    <section className="rounded-xl border bg-secondary/40 p-4">
      <div className="flex items-start gap-3">
        <LifeBuoy className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Still need help?</h2>
          {state === 'done' ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Your request has been sent to the Flavrly support team. They will get back to you.
            </p>
          ) : !open ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Send a message to the Flavrly support team.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
                Contact support
              </Button>
            </>
          ) : (
            <form onSubmit={submit} className="mt-2 space-y-2">
              <Textarea
                required
                minLength={3}
                maxLength={1800}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe what you need help with"
                aria-label="Message to support"
              />
              <Input
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Order ID (optional)"
                aria-label="Order ID (optional)"
                maxLength={64}
              />
              {state === 'error' && <p className="text-sm text-destructive">Could not send — please try again.</p>}
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={state === 'sending' || message.trim().length < 3}>
                  {state === 'sending' ? 'Sending…' : 'Send'}
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
