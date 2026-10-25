import { describe, it, expect } from 'vitest';
import { classifyPoints } from '@/server/rider-location-points';

const P = (recordedAt: number) => ({ lat: 12.9, lng: 77.5, recordedAt });

describe('classifyPoints clock correction', () => {
  it('does not shift by network latency, so a re-sent duplicate stays a duplicate', () => {
    const now = 1_000_000_000;
    const first = classifyPoints([P(now - 1_000)], now, undefined, now - 200);
    // Same fix re-sent later with a slightly different send/arrive gap.
    const again = classifyPoints([P(now - 1_000)], now + 900, first.lastAcceptedAt, now + 100);
    expect(first.accepted).toHaveLength(1);
    expect(again.accepted).toHaveLength(0);
  });

  it('still corrects a phone clock that is far off', () => {
    const now = 1_000_000_000;
    const phoneNow = now - 60 * 60_000;
    const r = classifyPoints([P(phoneNow - 5_000)], now, undefined, phoneNow);
    expect(r.accepted).toHaveLength(1);
    expect(r.live).not.toBeNull();
  });
});
