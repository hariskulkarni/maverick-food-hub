/**
 * Exact INR <-> integer paise conversion for Flavrly PG (contract D12).
 * Never multiply a binary float by 100: go through decimal strings.
 */
import { Prisma } from '@prisma/client';

const INR = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Prisma Decimal / decimal string / JS number (INR) -> positive-or-zero integer paise. Throws on >2dp or junk. */
export function decimalToPaise(v: Prisma.Decimal | string | number): number {
  const s = (typeof v === 'number' ? (Number.isFinite(v) ? new Prisma.Decimal(v) : null) : v)?.toString().trim();
  const m = s ? INR.exec(s) : null;
  if (!m) throw new Error(`Invalid INR amount: ${String(v)}`);
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) throw new Error(`INR amount out of range: ${String(v)}`);
  return paise;
}

/** Integer paise -> "123.45" (gateway wire format / Decimal input). */
export function paiseToInrString(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error(`Invalid paise: ${paise}`);
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}
