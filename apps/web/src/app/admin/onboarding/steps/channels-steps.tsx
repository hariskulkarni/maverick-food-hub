'use client';
/**
 * Payments + notification channels. Both are review steps: they show the
 * restaurant's current integration status (read-only) and link to the existing
 * settings pages where credentials are entered. No payment code is touched here.
 */
import Link from 'next/link';
import { CheckCircle2, CircleSlash, ExternalLink, Mail, MessageCircle, Smartphone, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StepFrame } from '../parts';
import type { StepProps } from '../wizard-client';
import type { OnbIntegration } from '../types';

function StatusRow({ i }: { i: OnbIntegration | undefined; }) {
  if (!i) return null;
  const ok = i.status === 'CONNECTED';
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="truncate">{i.title}</span>
      <Badge variant={ok ? 'success' : i.status === 'FAILED' ? 'destructive' : 'muted'}>
        {ok ? <CheckCircle2 className="size-3 mr-1" /> : <CircleSlash className="size-3 mr-1" />}
        {ok ? 'Connected' : i.status === 'FAILED' ? 'Failing' : 'Not connected'}
      </Badge>
    </li>
  );
}

const pick = (list: OnbIntegration[], keys: string[]) => keys.map((k) => list.find((i) => i.provider === k)).filter(Boolean) as OnbIntegration[];

export function PaymentsStep({ data, complete }: StepProps) {
  const gateways = pick(data.integrations, ['RAZORPAY', 'PHONEPE']);
  const r = data.restaurant;
  const cycle = r.settlementCycle === 'DAILY' ? 'daily' : r.settlementCycle === 'T_PLUS_1' ? 'the next working day (T+1)' : 'weekly';
  return (
    <StepFrame
      title="Payments"
      intro="Review how customers pay you and how your money reaches you. Payment credentials are managed on the Integrations page."
      why="Online payments mean fewer cash-handling errors and faster checkouts. Knowing your settlement cycle and fees up front avoids payout surprises."
      example={<>On a ₹1,000 online order with a {r.commissionPct}% platform commission and {r.paymentFeePct}% gateway fee, about ₹{Math.round(1000 * (1 - (r.commissionPct + r.paymentFeePct) / 100))} is settled to you (before taxes and any offers you fund). Exact figures appear line-by-line in your settlement report.</>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Wallet className="size-4 text-primary" /> Your payout terms</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Platform commission</dt><dd className="font-medium">{r.commissionPct}%</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Online payment fee</dt><dd className="font-medium">{r.paymentFeePct}%</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Settlements</dt><dd className="font-medium capitalize">{cycle}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">Set by your agreement with Flavrly — contact platform support to change them.</p>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-sm font-medium">Your own payment gateway (optional)</div>
          <ul className="divide-y">{gateways.map((g) => <StatusRow key={g.provider} i={g} />)}</ul>
          <p className="text-[11px] text-muted-foreground">Not connected? Checkout uses the payment options configured by the Flavrly platform for your restaurant.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/admin/settings?tab=integrations">Payment gateways <ExternalLink className="size-3.5" /></Link></Button>
        <Button asChild variant="outline"><Link href="/admin/settings/order-flow">Order flow (pickup, scheduled orders)</Link></Button>
      </div>
      <div className="flex justify-end"><Button onClick={complete}>I&apos;ve reviewed this — continue</Button></div>
    </StepFrame>
  );
}

export function NotificationsStep({ data, complete, goTo }: StepProps) {
  const sms = pick(data.integrations, ['TWOFACTOR', 'MSG91', 'FAST2SMS', 'TEXTLOCAL', 'TWILIO_SMS']);
  const wa = pick(data.integrations, ['META_WHATSAPP', 'TWILIO_WHATSAPP']);
  const email = pick(data.integrations, ['SMTP', 'ZOHO_SMTP', 'BREVO_SMTP']);
  const groups = [
    { title: 'SMS', icon: Smartphone, items: sms, use: 'Order confirmations and delivery OTPs.' },
    { title: 'WhatsApp', icon: MessageCircle, items: wa, use: 'Rich order updates customers actually read. Needs approved message templates from Meta.' },
    { title: 'Email', icon: Mail, items: email, use: 'Receipts and your own payout / licence reminders.' },
  ];
  const r = data.restaurant;
  return (
    <StepFrame
      title="Notification channels"
      intro="Choose how customers and your team hear about orders. You can use Flavrly's shared senders or connect your own accounts for branded messages."
      why="Customers who get a confirmation and an 'out for delivery' message cancel less and call you less. Your own contact details receive kitchen alerts and reminders."
      example={<>Customer gets an SMS “Spice Garden accepted order #A1B2 — arriving by 8:40 pm”, a WhatsApp when the rider picks up, and an email receipt. Your team gets a reminder once your FSSAI licence is within 30 days of expiry.</>}
    >
      <div className="rounded-xl border p-4 text-sm">
        <div className="font-medium">Where we reach you</div>
        <div className="mt-1 text-muted-foreground">Phone: <span className="text-foreground">{r.contactPhone || 'not set'}</span> · Email: <span className="text-foreground">{r.contactEmail || 'not set'}</span></div>
        <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => goTo('profile')}>Change in Business profile</button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><g.icon className="size-4 text-primary" /> {g.title}</div>
            <p className="text-xs text-muted-foreground">{g.use}</p>
            <ul className="divide-y">{g.items.map((i) => <StatusRow key={i.provider} i={i} />)}</ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        If you don&apos;t connect your own account for a channel, messages go through Flavrly&apos;s platform sender where the platform team has configured one. Every message sent is listed under Settings → Notifications.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/admin/settings?tab=integrations">Connect SMS / WhatsApp / email <ExternalLink className="size-3.5" /></Link></Button>
        <Button asChild variant="ghost"><Link href="/admin/settings?tab=notifications">View sent messages</Link></Button>
      </div>
      <div className="flex justify-end"><Button onClick={complete}>Continue</Button></div>
    </StepFrame>
  );
}
