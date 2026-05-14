/**
 * Pure tests for the super-admin restaurant wizard helpers. The DB-touching
 * route handler is covered separately by integration tests; here we just want
 * to guarantee the slug-validation and password-generation primitives stay
 * trustworthy across refactors — both of them are external-facing (slugs
 * become URLs; temp passwords get handed to humans), so silent regressions
 * would be expensive.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import {
  RESERVED_RESTAURANT_SLUGS,
  normaliseRestaurantSlug,
  isReservedSlug,
  generateTempPassword,
  isValidLatLng
} from '@/server/restaurant-wizard';

describe('normaliseRestaurantSlug', () => {
  it('slugifies the input', () => {
    expect(normaliseRestaurantSlug('Olive Bistro')).toBe('olive-bistro');
  });

  it('falls back to the restaurant name when raw is empty', () => {
    expect(normaliseRestaurantSlug('', 'Coastal Kitchens')).toBe('coastal-kitchens');
  });

  it('returns null for empty input with no fallback', () => {
    expect(normaliseRestaurantSlug('')).toBeNull();
  });

  it('rejects every reserved slug', () => {
    for (const s of RESERVED_RESTAURANT_SLUGS) {
      expect(normaliseRestaurantSlug(s)).toBeNull();
    }
  });

  it('rejects reserved slug even via casing/whitespace tricks', () => {
    expect(normaliseRestaurantSlug('  ADMIN  ')).toBeNull();
    expect(normaliseRestaurantSlug('Platform')).toBeNull();
    expect(normaliseRestaurantSlug('rider!!!')).toBeNull();
  });

  it('rejects slugs shorter than 2 chars', () => {
    expect(normaliseRestaurantSlug('a')).toBeNull();
    expect(normaliseRestaurantSlug('!')).toBeNull();
  });
});

describe('isReservedSlug', () => {
  it('returns true for reserved slugs', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('API')).toBe(true);
    expect(isReservedSlug('platform')).toBe(true);
  });

  it('returns false for ordinary slugs', () => {
    expect(isReservedSlug('olive-bistro')).toBe(false);
    expect(isReservedSlug('biryani-house')).toBe(false);
  });
});

describe('generateTempPassword', () => {
  it('returns the requested length by default (12)', () => {
    expect(generateTempPassword().length).toBe(12);
  });

  it('respects a custom length', () => {
    expect(generateTempPassword(16).length).toBe(16);
    expect(generateTempPassword(20).length).toBe(20);
  });

  it('clamps to a sane minimum length', () => {
    // Anything < 8 should be bumped to 8.
    expect(generateTempPassword(4).length).toBe(8);
  });

  it('only emits characters from the unambiguous alphabet', () => {
    const allowed = /^[A-HJ-NP-Za-hjkm-np-z2-9]+$/; // no 0/O/1/l/I
    for (let i = 0; i < 25; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(allowed);
    }
  });

  it('does not return the same value twice in a row', () => {
    // Smoke-test the entropy — with 12 chars from 55 symbols, collisions over
    // a handful of samples are vanishingly unlikely.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateTempPassword());
    expect(seen.size).toBe(50);
  });
});

describe('isValidLatLng', () => {
  it('accepts plausible coordinates', () => {
    expect(isValidLatLng(12.9352, 77.6245)).toBe(true);
    expect(isValidLatLng(-89.9, 179.9)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });

  it('rejects NaN/Infinity', () => {
    expect(isValidLatLng(NaN, 0)).toBe(false);
    expect(isValidLatLng(0, Infinity)).toBe(false);
  });
});
