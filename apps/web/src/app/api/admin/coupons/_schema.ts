/**
 * Coupon field bounds shared by create + edit (P2-14): a percentage over 100,
 * a negative flat amount or a zero usage limit would either over-discount at
 * checkout or create a coupon nobody can ever redeem.
 */
import { z } from 'zod';

export const couponNumbers = {
  flatOff: z.number().min(0, 'Flat discount can’t be negative').max(100000).nullable().optional(),
  percentOff: z.number().min(0, 'Percent off can’t be negative').max(100, 'Percent off can’t exceed 100').nullable().optional(),
  minOrderAmount: z.number().min(0, 'Minimum order can’t be negative').nullable().optional(),
  maxDiscount: z.number().min(0, 'Max discount can’t be negative').nullable().optional(),
  usageLimit: z.number().int().min(1, 'Usage limit must be at least 1').nullable().optional(),
  perUserLimit: z.number().int().min(1, 'Per-customer limit must be at least 1').optional(),
};

/**
 * Coupon codes are globally unique (checkout resolves a code with
 * findUnique({ code })), so a clash may be with ANOTHER restaurant's coupon.
 * Never say whose — one generic message for every clash.
 */
export const CODE_TAKEN = { error: 'That code isn’t available. Try a different code.', reason: 'code_unavailable' } as const;
