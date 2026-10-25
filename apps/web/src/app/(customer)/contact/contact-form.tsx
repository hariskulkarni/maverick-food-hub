'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { reportApiError } from '@/lib/api-error';

const fieldCls = 'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** Public contact form → POST /api/support/contact (creates a support ticket). */
export function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      topic: String(fd.get('topic') ?? 'other'),
      message: String(fd.get('message') ?? ''),
      website: String(fd.get('website') ?? '')
    };
    setBusy(true);
    try {
      const res = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        await reportApiError(res, 'Could not send your message');
        return;
      }
      form.reset();
      setSent(true);
      toast.success('Message sent. Our support team will reply by email.');
    } catch {
      toast.error('Could not send your message. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-4 rounded-md border bg-muted/30 p-4 text-sm" role="status">
        Thanks — your message has reached our support team. We&apos;ll reply to the email you gave.{' '}
        <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setSent(false)}>
          Send another
        </button>
      </div>
    );
  }

  return (
    <form className="mt-4 space-y-4" aria-label="Contact form" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="text-sm font-medium">Your name</label>
          <input id="contact-name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={80} className={fieldCls} />
        </div>
        <div>
          <label htmlFor="contact-email" className="text-sm font-medium">Email</label>
          <input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={120} className={fieldCls} />
        </div>
      </div>
      <div>
        <label htmlFor="contact-topic" className="text-sm font-medium">Topic</label>
        <select id="contact-topic" name="topic" defaultValue="order" className={fieldCls}>
          <option value="order">Help with an order</option>
          <option value="refund">Refund or payment</option>
          <option value="account">My account</option>
          <option value="restaurant">Restaurant partnership</option>
          <option value="rider">Riding with us</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div>
        <label htmlFor="contact-message" className="text-sm font-medium">Message</label>
        <textarea id="contact-message" name="message" rows={4} required minLength={10} maxLength={2000} className={fieldCls} />
      </div>
      {/* Honeypot: hidden from people, bots tend to fill it. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</Button>
    </form>
  );
}
