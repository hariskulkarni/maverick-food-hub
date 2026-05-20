'use client';

/**
 * ReserveClient — the interactive booking flow for /r/[slug]/reserve.
 *
 * Three phases driven by local state:
 *   1. form     — date / time / party-size / notes → "Check availability"
 *   2. tables   — pick from the free tables the API returned, see deposit +
 *                 discount benefit, choose payment method, confirm
 *   3. success  — reservation code + redeemable-deposit confirmation
 *
 * All server work goes through the public availability API and the
 * auth-required create API; this component never touches Prisma.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/utils';
import {
  CalendarClock, Users, Minus, Plus, BadgePercent, Wallet, CheckCircle2,
  Loader2, ArrowRight, Armchair, Receipt,
} from 'lucide-react';

interface AvailableTable {
  id: string;
  name: string;
  capacity: number;
}

interface CreatedReservation {
  code: string;
  reservedAt: string;
  partySize: number;
  durationMin: number;
  depositAmount: number;
  discountPct: number;
  tableName: string | null;
}

export interface ReserveClientProps {
  slug: string;
  restaurantName: string;
  isAuthedCustomer: boolean;
  depositAmount: number;
  discountPct: number;
  defaultDurationMin: number;
}

type PaymentMethod = 'cod' | 'online';

// Default to "tomorrow" so the first paint is always a valid future date.
function defaultDate(): string {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function ReserveClient(props: ReserveClientProps) {
  const { slug, restaurantName, isAuthedCustomer, depositAmount, discountPct, defaultDurationMin } = props;

  const [date, setDate] = useState<string>(defaultDate());
  const [time, setTime] = useState<string>('19:00');
  const [partySize, setPartySize] = useState<number>(2);
  const [notes, setNotes] = useState<string>('');

  const [checking, setChecking] = useState(false);
  const [tables, setTables] = useState<AvailableTable[] | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('online');

  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreatedReservation | null>(null);

  // Combine the date + time fields into an ISO string the API expects.
  function reservedAtIso(): string | null {
    if (!date || !time) return null;
    const dt = new Date(`${date}T${time}`);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  }

  async function checkAvailability() {
    setError(null);
    setSelectedTableId(null);
    const iso = reservedAtIso();
    if (!iso) {
      setError('Please pick a valid date and time.');
      return;
    }
    if (new Date(iso).getTime() <= Date.now()) {
      setError('Please pick a date and time in the future.');
      return;
    }
    setChecking(true);
    try {
      const qs = new URLSearchParams({ partySize: String(partySize), reservedAt: iso });
      const res = await fetch(`/api/r/${slug}/reservations/availability?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not check availability.');
        setTables(null);
        return;
      }
      setTables((data.tables ?? []) as AvailableTable[]);
    } catch {
      setError('Could not reach the server. Please try again.');
      setTables(null);
    } finally {
      setChecking(false);
    }
  }

  async function confirmBooking() {
    setError(null);
    const iso = reservedAtIso();
    if (!iso || !selectedTableId) return;
    setBooking(true);
    try {
      const res = await fetch(`/api/r/${slug}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: selectedTableId,
          partySize,
          reservedAt: iso,
          customerNotes: notes || undefined,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not complete your booking.');
        // A 409 usually means the table was just taken — refresh availability.
        if (res.status === 409) await checkAvailability();
        return;
      }
      const r = data.reservation;
      setSuccess({
        code: r.code,
        reservedAt: r.reservedAt,
        partySize: r.partySize,
        durationMin: r.durationMin,
        depositAmount: r.depositAmount,
        discountPct: r.discountPct,
        tableName: r.tableName,
      });
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBooking(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    const when = new Date(success.reservedAt);
    return (
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-success/15 via-success/5 to-transparent p-6 text-center">
          <div className="mx-auto inline-flex items-center justify-center size-14 rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <h2 className="display text-2xl font-semibold mt-3">Table reserved!</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your table at {restaurantName} is confirmed.
          </p>
        </div>
        <CardContent className="p-6 space-y-4">
          <div className="rounded-xl border bg-card p-4 text-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Reservation code</div>
            <div className="display text-3xl font-semibold mt-1 tracking-wide text-primary">{success.code}</div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="When" value={when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} />
            <Detail label="Party" value={`${success.partySize} ${success.partySize === 1 ? 'guest' : 'guests'}`} />
            <Detail label="Table" value={success.tableName ?? '—'} />
            <Detail label="Held for" value={`${success.durationMin} min`} />
          </dl>

          <div className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium text-warning">
              <Wallet className="size-4" /> {money(success.depositAmount)} deposit collected
            </div>
            <p className="text-xs text-muted-foreground">
              Your deposit is redeemable on your dine-in bill — it&apos;s applied automatically when you
              order at the table. You&apos;ll also get <strong>{success.discountPct}% off your dine-in bill</strong>.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <Button asChild variant="outline" className="w-full">
              <Link href={`/r/${slug}/me/reservations`}>
                <Receipt className="size-4" /> My reservations
              </Link>
            </Button>
            <Button asChild className="w-full">
              <Link href={`/r/${slug}`}>Back to menu <ArrowRight className="size-4" /></Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectedTable = tables?.find((t) => t.id === selectedTableId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Step 1: booking form ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 md:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            <h2 className="font-semibold">When would you like to dine?</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="rsv-date">Date</Label>
              <Input
                id="rsv-date"
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setDate(e.target.value); setTables(null); }}
              />
            </div>
            <div>
              <Label htmlFor="rsv-time">Time</Label>
              <Input
                id="rsv-time"
                type="time"
                value={time}
                onChange={(e) => { setTime(e.target.value); setTables(null); }}
              />
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-1.5"><Users className="size-3.5" /> Party size</Label>
            <div className="mt-1.5 inline-flex items-center gap-3 rounded-lg border p-1">
              <Button
                type="button" variant="ghost" size="icon"
                onClick={() => { setPartySize((n) => Math.max(1, n - 1)); setTables(null); }}
                disabled={partySize <= 1}
                aria-label="Decrease party size"
              >
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-lg font-semibold tabular-nums">{partySize}</span>
              <Button
                type="button" variant="ghost" size="icon"
                onClick={() => { setPartySize((n) => Math.min(50, n + 1)); setTables(null); }}
                disabled={partySize >= 50}
                aria-label="Increase party size"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="rsv-notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="rsv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Birthday celebration, high chair needed, window seat preferred…"
            />
          </div>

          <Button onClick={checkAvailability} disabled={checking} className="w-full md:w-auto">
            {checking ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
            Check availability
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border-l-4 border-destructive bg-destructive/5 p-3 text-sm text-destructive/90">
          {error}
        </div>
      )}

      {/* ── Step 2: available tables ─────────────────────────────────────────── */}
      {tables !== null && (
        <Card>
          <CardContent className="p-5 md:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Armchair className="size-4 text-primary" />
              <h2 className="font-semibold">Available tables</h2>
            </div>

            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tables fit a party of {partySize} at that time. Try a different time or a smaller party.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {tables.map((t) => {
                    const active = t.id === selectedTableId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTableId(t.id)}
                        className={`text-left rounded-lg border p-3 transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-accent/30'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm">{t.name}</span>
                          {active && <CheckCircle2 className="size-4 text-primary" />}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Users className="size-3" /> Seats up to {t.capacity}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Deposit + discount benefit summary */}
                <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground"><Wallet className="size-4" /> Deposit to confirm</span>
                    <span className="font-semibold">{money(depositAmount)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-success">
                    <BadgePercent className="size-4" />
                    <span>{discountPct}% off your dine-in bill — and your deposit is redeemable on it.</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Held for {defaultDurationMin} minutes from your slot.</p>
                </div>

                {/* Payment method */}
                <div>
                  <Label>Deposit payment</Label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    <PaymentOption
                      active={paymentMethod === 'online'}
                      onSelect={() => setPaymentMethod('online')}
                      title="Pay deposit online"
                      hint="Confirm instantly"
                    />
                    <PaymentOption
                      active={paymentMethod === 'cod'}
                      onSelect={() => setPaymentMethod('cod')}
                      title="Pay on arrival"
                      hint="Settle the deposit at the table"
                    />
                  </div>
                </div>

                {!isAuthedCustomer ? (
                  <div className="rounded-md border bg-card p-3 text-sm">
                    <p className="text-muted-foreground">Please sign in to confirm your reservation.</p>
                    <Button asChild size="sm" className="mt-2">
                      <Link href={`/login?role=customer&next=${encodeURIComponent(`/r/${slug}/reserve`)}`}>
                        Sign in to book <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={confirmBooking}
                    disabled={!selectedTableId || booking}
                    className="w-full"
                    size="lg"
                  >
                    {booking ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {selectedTable
                      ? `Confirm ${selectedTable.name} · ${money(depositAmount)} deposit`
                      : 'Select a table to continue'}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentOption({ active, onSelect, title, hint }: { active: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-accent/30'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{title}</span>
        {active && <CheckCircle2 className="size-4 text-primary" />}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
