import { describe, it, expect } from 'vitest';
import {
  istDayKey, istStartOfDay, istEndOfDay, istHour, addDaysToKey, lastIstDayKeys, formatIst,
} from '@/lib/ist';
import { parseRange } from '@/server/reports/range';

describe('IST helpers (P1-8)', () => {
  it('keys an order at 00:30 IST to the IST day, not the UTC day', () => {
    const t = new Date('2026-10-24T19:00:00Z'); // 00:30 IST on 25 Oct
    expect(istDayKey(t)).toBe('2026-10-25');
    expect(t.toISOString().slice(0, 10)).toBe('2026-10-24'); // the old (wrong) bucket
  });

  it('day boundaries are IST midnight expressed in UTC', () => {
    expect(istStartOfDay('2026-10-25').toISOString()).toBe('2026-10-24T18:30:00.000Z');
    expect(istEndOfDay('2026-10-25').toISOString()).toBe('2026-10-25T18:29:59.999Z');
    expect(istStartOfDay(new Date('2026-10-25T20:00:00Z')).toISOString()).toBe('2026-10-25T18:30:00.000Z');
  });

  it('hour buckets and day arithmetic', () => {
    expect(istHour(new Date('2026-10-25T14:45:00Z'))).toBe(20);
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(lastIstDayKeys(3, new Date('2026-10-24T19:00:00Z'))).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
  });

  it('formats in IST regardless of server zone', () => {
    expect(formatIst(new Date('2026-10-24T19:00:00Z'), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('00:30');
  });
});

describe('parseRange uses IST day boundaries', () => {
  it('from/to date-only strings span whole IST days', () => {
    const { from, to } = parseRange(new URL('http://x/r?from=2026-10-01&to=2026-10-25'));
    expect(from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-10-25T18:29:59.999Z');
  });

  it('400s on garbage dates and on from after to', () => {
    expect(() => parseRange(new URL('http://x/r?from=nope'))).toThrow();
    let err: unknown;
    try { parseRange(new URL('http://x/r?from=2026-10-25&to=2026-10-01')); } catch (e) { err = e; }
    expect((err as Response).status).toBe(400);
  });
});
