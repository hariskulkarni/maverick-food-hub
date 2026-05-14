'use client';

import { useState } from 'react';
import { Percent, Tag, Gift, Crown, Sparkles, Copy, Check, Clock } from 'lucide-react';

/**
 * Loose Offer shape (matches what `prisma.offer.findMany()` returns, JSON-
 * serialized). We accept everything as `unknown`-ish strings/numbers because
 * the server hands us a JSON.parse(JSON.stringify(...)) of the Prisma rows.
 */
export interface OfferCardData {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  code?: string | null;
  percentOff?: number | null;
  flatOff?: string | number | null;
  maxDiscount?: string | number | null;
  minOrderAmount?: string | number | null;
  validTo?: string | null;
}

function iconForType(type: string) {
  switch (type) {
    case 'PERCENTAGE':
      return Percent;
    case 'FIXED':
      return Tag;
    case 'BUY_X_GET_Y':
    case 'COMBO_DISCOUNT':
      return Gift;
    case 'FREE_ITEM_ABOVE':
      return Gift;
    case 'FIRST_ORDER':
      return Sparkles;
    case 'REPEAT_CUSTOMER':
      return Crown;
    case 'DINE_IN_TO_ONLINE':
    case 'ONLINE_TO_DINE_IN':
      return Tag;
    default:
      return Tag;
  }
}

function bigValue(o: OfferCardData): string {
  if (o.percentOff && Number(o.percentOff) > 0) return `${Number(o.percentOff)}%`;
  const flat = Number(o.flatOff ?? 0);
  if (flat > 0) return `₹${flat}`;
  if (o.type === 'BUY_X_GET_Y') return 'BOGO';
  if (o.type === 'FREE_ITEM_ABOVE') return 'FREE';
  if (o.type === 'COMBO_DISCOUNT') return 'COMBO';
  return 'OFF';
}

function validityLabel(validTo?: string | null): string | null {
  if (!validTo) return 'Limited time';
  const d = new Date(validTo);
  if (isNaN(d.getTime())) return null;
  return `Valid until ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export function OfferCards({ offers }: { offers: OfferCardData[] }) {
  if (!offers || offers.length === 0) return null;

  return (
    <section className="container py-8 border-b">
      <div className="mb-4 reveal">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> Today's offers
        </div>
        <h2 className="display mt-1 text-2xl font-semibold">Save while you devour</h2>
      </div>
      <div className="-mx-4 md:mx-0 overflow-x-auto no-scrollbar">
        <div className="flex gap-3 px-4 md:px-0 snap-x snap-mandatory">
          {offers.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      </div>
    </section>
  );
}

function OfferCard({ offer }: { offer: OfferCardData }) {
  const [copied, setCopied] = useState(false);
  const Icon = iconForType(offer.type);
  const val = bigValue(offer);
  const validity = validityLabel(offer.validTo ?? null);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!offer.code) return;
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard not available — ignore */
    }
  };

  return (
    <div
      className="relative shrink-0 snap-start w-[280px] md:w-[320px] overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-warning to-primary text-primary-foreground shadow-lg shadow-primary/20 tap-press card-lift"
      role="article"
      aria-label={offer.name}
    >
      {/* glow */}
      <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-white/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 size-40 rounded-full bg-black/10 blur-2xl" />

      <div className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="inline-flex items-center justify-center size-10 rounded-full bg-white/20 backdrop-blur-sm">
            <Icon className="size-5" />
          </div>
          {offer.minOrderAmount && Number(offer.minOrderAmount) > 0 && (
            <div className="text-[10px] font-medium uppercase tracking-wider bg-black/20 rounded-full px-2 py-1">
              Min ₹{Number(offer.minOrderAmount)}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-1.5">
          <div className="display text-5xl font-bold leading-none tracking-tight drop-shadow-sm">{val}</div>
          <div className="text-sm font-semibold opacity-90">OFF</div>
        </div>

        <div className="mt-3 font-semibold text-base leading-snug line-clamp-1">{offer.name}</div>
        {offer.description && (
          <div className="mt-1 text-xs opacity-90 leading-snug line-clamp-2">{offer.description}</div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {offer.code ? (
            <button
              type="button"
              onClick={onCopy}
              className="group/code inline-flex items-center gap-1.5 rounded-md border border-dashed border-white/60 bg-white/10 backdrop-blur-sm px-2.5 py-1 text-xs font-mono font-bold tracking-wider hover:bg-white/20 transition-colors"
              aria-label={`Copy code ${offer.code}`}
            >
              {offer.code}
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5 opacity-75 group-hover/code:opacity-100" />}
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium opacity-90">
              <Sparkles className="size-3.5" /> Auto-applied
            </div>
          )}
          {validity && (
            <div className="inline-flex items-center gap-1 text-[10px] opacity-85">
              <Clock className="size-3" /> {validity}
            </div>
          )}
        </div>
        {copied && (
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/30 backdrop-blur px-2 py-0.5 text-[10px] font-medium">
            <Check className="size-3" /> Copied
          </div>
        )}
      </div>
    </div>
  );
}
