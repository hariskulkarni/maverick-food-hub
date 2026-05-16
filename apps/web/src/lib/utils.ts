import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || 'INR';
const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
const formatterDecimal = new Intl.NumberFormat('en-IN', { style: 'currency', currency: CURRENCY });

export function money(amount: number | string | bigint | { toString(): string }, opts: { decimal?: boolean } = {}): string {
  const n = typeof amount === 'number' ? amount : Number(amount.toString());
  return (opts.decimal ? formatterDecimal : formatter).format(isNaN(n) ? 0 : n);
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function relTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-IN', opts).format(date);
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function clampTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

export function genOrderCode(): string {
  return 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Generate the customer's 4-digit hand-over code shown on the order tracker.
 *
 * Contract:
 *   - Always 4 ASCII digits.
 *   - Range 1000-9999 (no leading zeros, so the rider sees the same number of
 *     digits as the customer regardless of font / kerning).
 *   - Stable for the lifetime of the order — set once at creation, never rotated.
 *
 * The `.padStart(4, '0')` is defensive: today the math already guarantees a
 * 4-digit string, but if the range ever changes (e.g. to 6-digit codes) callers
 * that hard-coded a 4-wide UI won't silently render shorter codes.
 */
export function genDeliveryOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000)).padStart(4, '0');
}

/**
 * Canonicalise a delivery OTP for comparison.
 *
 * Strips every non-digit character (whitespace, hidden BOMs, autofill bullets,
 * dashes that some keyboards insert, NBSPs from copy/paste). Use this on BOTH
 * sides of every OTP equality check so a rider can never fail verification
 * because their keyboard inserted an invisible character or because the stored
 * code had a stray space.
 *
 * Returns '' if `s` is null/undefined/empty after stripping — callers should
 * treat that as a verification failure (don't equate two empty strings).
 */
export function normalizeOtp(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/\D+/g, '');
}

export const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Order Received',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for Pickup',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUND_INITIATED: 'Refund Initiated',
  REFUNDED: 'Refunded',
  PAYMENT_FAILED: 'Payment Failed'
};

export const STATUS_PROGRESSION = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export type ActiveStatus = (typeof STATUS_PROGRESSION)[number];
