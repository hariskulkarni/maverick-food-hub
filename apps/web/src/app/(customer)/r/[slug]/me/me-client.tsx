'use client';

/**
 * MeClient — the interactive shell for `/r/[slug]/me`.
 *
 * Everything except sign-out and "add to cart" is pre-rendered server-side and
 * passed in via props. We only mark this as a client component because:
 *   1. We need `useCart()` from the cart context to wire the "Add to cart"
 *      buttons in the Most-Ordered section.
 *   2. We render a sign-out button with the same robust pattern as
 *      <LogoutButton>, but reused inline so the dashboard sidebar can live
 *      alongside other client-only bits without dragging in the existing
 *      component's `/login` redirect (we want this one to return to /r/<slug>).
 *
 * Layout: mobile = single column of cards; md+ = two columns
 *   left:  hero, KPIs, recent orders, most ordered, addresses
 *   right: wallet, loyalty, offers, near-you placeholder, account actions
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { money, fmtDate } from '@/lib/utils';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { useCart } from '../../../cart-context';
import {
  Wallet as WalletIcon, Sparkles, Flame, MapPin, BadgePercent, Heart,
  CreditCard, User as UserIcon, ChevronRight, LogOut, ArrowRight, Plus,
  Receipt, Star, Gift
} from 'lucide-react';

// ── Prop types ──────────────────────────────────────────────────────────────
// Kept inline (rather than in a shared types file) because the page is the
// only consumer and the shapes are tied 1:1 to the server-side bundle.

interface RestaurantProp {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  tagline: string | null;
}

interface UserProp {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
}

interface MostOrderedProp {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  isVeg: boolean;
  branchId: string;
  timesOrdered: number;
}

interface RecentOrderProp {
  id: string;
  code: string;
  status: string;
  total: number;
  placedAt: string;
}

interface WalletTxnProp {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: string;
  orderId: string | null;
}

interface AddressProp {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  isDefault: boolean;
}

interface CouponProp {
  id: string;
  code: string;
  description: string | null;
  percentOff: number | null;
  flatOff: number | null;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  validTo: string | null;
}

export interface MeClientProps {
  restaurant: RestaurantProp;
  user: UserProp;
  wallet: { balance: number; currency: string };
  walletTxns: WalletTxnProp[];
  loyalty: { pointsBalance: number; lifetimeEarn: number; lifetimeRedeem: number };
  addresses: AddressProp[];
  recentOrders: RecentOrderProp[];
  ordersFromHereCount: number;
  mostOrdered: MostOrderedProp[];
  activeCoupons: CouponProp[];
}

// ── Component ───────────────────────────────────────────────────────────────

export function MeClient(props: MeClientProps) {
  const { restaurant, user, wallet, walletTxns, loyalty, addresses, recentOrders, ordersFromHereCount, mostOrdered, activeCoupons } = props;
  const initials = getInitials(user.name, user.phone);

  // Loyalty milestone — first hit at 200 pts (₹50 cashback), bar shows pct.
  const MILESTONE = 200;
  const milestonePct = Math.min(100, Math.round((loyalty.pointsBalance / MILESTONE) * 100));
  const pointsToGo = Math.max(0, MILESTONE - loyalty.pointsBalance);

  return (
    <div className="bg-gradient-to-b from-primary/5 via-background to-background min-h-dvh pb-12">
      <div className="container py-6 md:py-10 grid gap-6 md:grid-cols-2">
        {/* ═══════════════════════ LEFT COLUMN ═══════════════════════ */}
        <div className="space-y-6 reveal-stagger">
          <HeroGreeting restaurant={restaurant} user={user} initials={initials} />
          <KpiTiles
            walletBalance={wallet.balance}
            loyaltyPoints={loyalty.pointsBalance}
            ordersFromHereCount={ordersFromHereCount}
          />
          <RecentOrdersCard orders={recentOrders} slug={restaurant.slug} />
          <MostOrderedCard items={mostOrdered} />
          <AddressesCard addresses={addresses} />
        </div>

        {/* ═══════════════════════ RIGHT COLUMN ══════════════════════ */}
        <div className="space-y-6 reveal-stagger">
          <WalletCard balance={wallet.balance} txns={walletTxns} />
          <LoyaltyCard
            points={loyalty.pointsBalance}
            lifetimeEarn={loyalty.lifetimeEarn}
            lifetimeRedeem={loyalty.lifetimeRedeem}
            milestone={MILESTONE}
            milestonePct={milestonePct}
            pointsToGo={pointsToGo}
          />
          <OffersCard coupons={activeCoupons} />
          <NearYouPlaceholder />
          <AccountActionsCard restaurantSlug={restaurant.slug} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hero — tenant chrome on left, customer identity on right.
// ─────────────────────────────────────────────────────────────────────────────
function HeroGreeting({ restaurant, user, initials }: { restaurant: RestaurantProp; user: UserProp; initials: string }) {
  return (
    <Card className="overflow-hidden card-lift">
      <div className="relative h-28 md:h-32 bg-gradient-to-r from-primary/20 via-warning/15 to-primary/10">
        {restaurant.coverImageUrl && (
          <Image
            src={restaurant.coverImageUrl}
            alt=""
            fill
            sizes="(min-width:768px) 50vw, 100vw"
            className="object-cover opacity-30"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-transparent" />
      </div>
      <CardContent className="p-5 -mt-12 relative">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-end gap-3 min-w-0">
            {restaurant.logoUrl ? (
              <div className="size-14 rounded-2xl overflow-hidden border-2 border-background shadow-lg bg-card relative shrink-0">
                <Image src={restaurant.logoUrl} alt={restaurant.name} fill sizes="56px" className="object-cover" />
              </div>
            ) : (
              <div className="size-14 rounded-2xl border-2 border-background shadow-lg bg-primary/10 text-primary grid place-items-center font-bold shrink-0">
                {restaurant.name[0]}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">My account at</div>
              <div className="display text-lg md:text-xl font-semibold truncate">{restaurant.name}</div>
            </div>
          </div>
          {/* Customer avatar with initials — symmetric with the tenant logo. */}
          <div className="size-12 rounded-full border-2 border-background shadow-lg bg-warning/15 text-warning grid place-items-center text-sm font-bold shrink-0">
            {initials}
          </div>
        </div>
        <div className="mt-3">
          <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight">
            Hi {user.name || 'there'},
          </h1>
          <p className="text-sm text-muted-foreground">
            Welcome back to {restaurant.name}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  KPI tiles — three at-a-glance numbers right under the hero.
// ─────────────────────────────────────────────────────────────────────────────
function KpiTiles({ walletBalance, loyaltyPoints, ordersFromHereCount }: {
  walletBalance: number; loyaltyPoints: number; ordersFromHereCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <KpiTile icon={<WalletIcon className="size-4" />} label="Wallet" value={money(walletBalance)} accent="text-primary" />
      <KpiTile icon={<Sparkles className="size-4" />} label="Loyalty" value={`${loyaltyPoints} pts`} accent="text-warning" />
      <KpiTile icon={<Receipt className="size-4" />} label="Orders" value={String(ordersFromHereCount)} accent="text-success" />
    </div>
  );
}

function KpiTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3 md:p-4 card-lift tap-press">
      <div className={`flex items-center gap-1.5 text-xs font-medium ${accent}`}>{icon}{label}</div>
      <div className="mt-1.5 font-semibold text-base md:text-lg">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Most ordered — top 4 dishes from this restaurant with quick-add.
// ─────────────────────────────────────────────────────────────────────────────
function MostOrderedCard({ items }: { items: MostOrderedProp[] }) {
  const { add } = useCart();
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-5">
          <SectionHeader icon={<Flame className="size-4 text-primary" />} title="Most ordered here" />
          <p className="text-sm text-muted-foreground mt-2">
            Order something delicious to start building your favorites.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeader icon={<Flame className="size-4 text-primary" />} title="Most ordered here" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((it) => (
            <div key={it.id} className="rounded-2xl border bg-card overflow-hidden card-lift tap-press group">
              <div className="relative h-24 overflow-hidden bg-muted">
                <Image
                  src={it.imageUrl || FOOD_FALLBACK}
                  alt={it.name}
                  fill
                  sizes="(min-width:768px) 25vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute top-1.5 left-1.5">
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border-[1.5px] bg-background/95 ${it.isVeg ? 'border-success' : 'border-destructive'}`}>
                    <span className={`h-1 w-1 rounded-full ${it.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                  </span>
                </div>
              </div>
              <div className="p-2.5">
                <div className="font-medium text-sm truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Flame className="size-3 text-primary" /> Ordered {it.timesOrdered}×
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm text-primary">{money(it.price)}</div>
                  <Button
                    size="sm"
                    className="h-7 px-2 gap-1"
                    onClick={() => add({
                      id: it.id,
                      refId: it.id,
                      kind: 'item',
                      branchId: it.branchId,
                      name: it.name,
                      unitPrice: it.price,
                      imageUrl: it.imageUrl,
                      isVeg: it.isVeg
                    })}
                  >
                    <Plus className="size-3" /> Add
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Active offers — platform-wide coupons currently in play.
// ─────────────────────────────────────────────────────────────────────────────
function OffersCard({ coupons }: { coupons: CouponProp[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeader icon={<BadgePercent className="size-4 text-warning" />} title="Active offers" />
        {coupons.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">No active offers right now. Check back soon.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {coupons.map((c) => (
              <li key={c.id} className="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-3 card-lift">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-bold tracking-wider px-2 py-0.5 rounded-md bg-warning/15 text-warning">{c.code}</code>
                      {c.percentOff != null && <Badge variant="secondary">{c.percentOff}% off</Badge>}
                      {c.flatOff != null && <Badge variant="secondary">{money(c.flatOff)} off</Badge>}
                    </div>
                    {c.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</div>}
                    {c.minOrderAmount != null && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">Min order {money(c.minOrderAmount)}</div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1">
          <ArrowRight className="size-3" /> Apply at checkout.
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Recent orders — 5 most recent orders from this restaurant.
// ─────────────────────────────────────────────────────────────────────────────
function RecentOrdersCard({ orders, slug }: { orders: RecentOrderProp[]; slug: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <SectionHeader icon={<Receipt className="size-4 text-primary" />} title="Recent orders" />
          <Link href={`/orders?restaurant=${slug}`} className="text-xs text-primary hover:underline flex items-center gap-1">
            View all <ChevronRight className="size-3" />
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">
            You haven&apos;t ordered from here yet — your future orders will show up here for quick tracking.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3 tap-press hover:bg-accent/40 rounded-md -mx-2 px-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{o.code}</span>
                      <OrderStatusBadge status={o.status as any} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{fmtDate(o.placedAt)}</div>
                  </div>
                  <div className="text-sm font-semibold shrink-0">{money(o.total)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Saved addresses
// ─────────────────────────────────────────────────────────────────────────────
function AddressesCard({ addresses }: { addresses: AddressProp[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <SectionHeader icon={<MapPin className="size-4 text-primary" />} title="Saved addresses" />
          <Link href="/profile/addresses" className="text-xs text-primary hover:underline flex items-center gap-1">
            Manage <ChevronRight className="size-3" />
          </Link>
        </div>
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">No addresses saved yet. Add one to speed up checkout.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {addresses.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 card-lift">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{a.label}</div>
                  {a.isDefault && <Badge variant="success">Default</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postalCode}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wallet — balance pill + last 5 txns as a ledger-style mini table.
// ─────────────────────────────────────────────────────────────────────────────
function WalletCard({ balance, txns }: { balance: number; txns: WalletTxnProp[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeader icon={<WalletIcon className="size-4 text-primary" />} title="Wallet" />
        <div className="mt-3 rounded-xl border bg-gradient-to-br from-primary/10 to-primary/5 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Current balance</div>
          <div className="display text-3xl font-semibold mt-1 text-primary">{money(balance)}</div>
        </div>
        {txns.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">No transactions yet.</p>
        ) : (
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent activity</div>
            <div className="rounded-lg border overflow-hidden">
              {txns.map((t, i) => {
                const isCredit = t.type === 'TOPUP' || t.type === 'REFUND' || t.type === 'REFERRAL_REWARD';
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${i % 2 === 0 ? 'bg-muted/30' : 'bg-background'} ${i > 0 ? 'border-t' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate">{walletTxnLabel(t.type)}</div>
                      {t.note && <div className="text-[11px] text-muted-foreground truncate">{t.note}</div>}
                      <div className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(t.createdAt)}</div>
                    </div>
                    <div className={`font-semibold text-sm shrink-0 ${isCredit ? 'text-success' : 'text-muted-foreground'}`}>
                      {isCredit ? '+' : '−'}{money(Math.abs(t.amount))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function walletTxnLabel(type: string): string {
  switch (type) {
    case 'TOPUP': return 'Wallet top-up';
    case 'ORDER_DEBIT': return 'Used on order';
    case 'REFUND': return 'Refund credited';
    case 'REFERRAL_REWARD': return 'Referral bonus';
    case 'ADJUSTMENT': return 'Adjustment';
    default: return type;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Loyalty — balance + how to earn + progress bar to next milestone.
// ─────────────────────────────────────────────────────────────────────────────
function LoyaltyCard({ points, lifetimeEarn, lifetimeRedeem, milestone, milestonePct, pointsToGo }: {
  points: number; lifetimeEarn: number; lifetimeRedeem: number;
  milestone: number; milestonePct: number; pointsToGo: number;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeader icon={<Sparkles className="size-4 text-warning" />} title="Loyalty" />
        <div className="mt-3 rounded-xl border bg-gradient-to-br from-warning/10 to-warning/5 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Points balance</div>
              <div className="display text-3xl font-semibold mt-1 text-warning">{points}</div>
            </div>
            <Star className="size-8 text-warning/40" />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Earned {lifetimeEarn} · Redeemed {lifetimeRedeem}</span>
          </div>
        </div>

        {/* Progress to next milestone */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium">Next reward at {milestone} pts</span>
            <span className="text-muted-foreground">{pointsToGo > 0 ? `${pointsToGo} pts to go` : 'Unlocked!'}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-gradient-to-r from-warning to-primary" style={{ width: `${milestonePct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Earn 1 pt for every ₹10 spent. Hit {milestone} pts to unlock ₹50 cashback at checkout.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Phase-2 placeholder — "Offers near you" with a heart icon, per spec.
// ─────────────────────────────────────────────────────────────────────────────
function NearYouPlaceholder() {
  return (
    <Card className="border-dashed">
      <CardContent className="p-5 text-center">
        <div className="mx-auto size-10 rounded-full bg-primary/10 grid place-items-center mb-3">
          <Heart className="size-5 text-primary" />
        </div>
        <div className="font-medium text-sm">Offers near you</div>
        <p className="text-xs text-muted-foreground mt-1">
          More offers coming soon — we&apos;ll surface deals from restaurants close to your saved addresses.
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Account actions — edit profile, saved cards (placeholder), sign out.
//  We duplicate the LogoutButton's `signOut({ redirect: false }) → hard nav`
//  pattern so the redirect target is the tenant's storefront, not /login.
// ─────────────────────────────────────────────────────────────────────────────
function AccountActionsCard({ restaurantSlug }: { restaurantSlug: string }) {
  const [busy, setBusy] = useState(false);
  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try { await signOut({ redirect: false }).catch(() => {}); }
    finally { window.location.href = `/r/${restaurantSlug}`; }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeader icon={<UserIcon className="size-4 text-primary" />} title="Account" />
        <nav className="mt-3 grid gap-1 text-sm">
          <Link href="/profile" className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 hover:bg-accent tap-press">
            <span className="flex items-center gap-2"><UserIcon className="size-4 text-muted-foreground" /> Edit profile</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <button
            type="button"
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 hover:bg-accent text-left tap-press disabled:opacity-50"
            disabled
            title="Coming soon"
          >
            <span className="flex items-center gap-2"><CreditCard className="size-4 text-muted-foreground" /> Saved cards</span>
            <Badge variant="muted">Soon</Badge>
          </button>
          <Link href="/profile/favorites" className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 hover:bg-accent tap-press">
            <span className="flex items-center gap-2"><Gift className="size-4 text-muted-foreground" /> Favorites</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </nav>
        <Button
          variant="outline"
          size="md"
          onClick={handleSignOut}
          disabled={busy}
          className="w-full mt-3 justify-center gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive font-medium"
        >
          <LogOut className="size-4" />
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="font-semibold text-sm md:text-base">{title}</h2>
    </div>
  );
}

function getInitials(name: string | null, phone: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  }
  if (phone) return phone.slice(-2);
  return '?';
}
