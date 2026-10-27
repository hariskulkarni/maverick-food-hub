/**
 * Rider device-context payload validation (server/rider-insights/device.ts)
 * and how the heartbeat / location bodies carry it.
 */
import { describe, it, expect } from 'vitest';
import { parseDevice, shouldWriteSample, toSnapshotFields, SAMPLE_INTERVAL_MS } from '@/server/rider-insights/device';
import { LocationBody, bodyPoints } from '@/server/rider-location-points';

const good = {
  model: 'samsung SM-A515F',
  osName: 'Android',
  osVersion: '13',
  appVersion: '1.4.0',
  appBuild: '42',
  network: 'CELLULAR',
  cellGen: '4g',
  battery: 63,
  charging: false,
};

describe('parseDevice', () => {
  it('accepts the documented fields', () => {
    expect(parseDevice(good)).toEqual(good);
    expect(parseDevice({ network: 'WIFI', battery: 100, charging: true })).toEqual({ network: 'WIFI', battery: 100, charging: true });
  });

  it.each([
    ['IMEI', { ...good, imei: '356938035643809' }],
    ['installed apps', { ...good, installedApps: ['com.whatsapp'] }],
    ['running apps', { ...good, runningApps: ['x'] }],
    ['call state', { ...good, callState: 'OFFHOOK' }],
    ['call log', { ...good, calls: [] }],
  ])('rejects the whole object when it carries %s', (_label, body) => {
    expect(parseDevice(body)).toBeNull();
  });

  it.each([
    ['battery > 100', { battery: 101 }],
    ['battery < 0', { battery: -1 }],
    ['fractional battery', { battery: 50.5 }],
    ['unknown network', { network: 'SATELLITE' }],
    ['unknown generation', { cellGen: '6g' }],
    ['over-long model', { model: 'x'.repeat(81) }],
    ['wrong type', { charging: 'yes' }],
    ['not an object', 'device'],
  ])('rejects %s', (_label, body) => {
    expect(parseDevice(body)).toBeNull();
  });

  it('treats absent / empty as no context', () => {
    expect(parseDevice(undefined)).toBeNull();
    expect(parseDevice(null)).toBeNull();
    expect(parseDevice({})).toBeNull();
  });
});

describe('snapshot fields + history thinning', () => {
  it('keeps previous static values when a post omits them and clears 4G on Wi-Fi', () => {
    const prev = toSnapshotFields(good as any);
    const next = toSnapshotFields({ network: 'WIFI', battery: 60 }, prev);
    expect(next.deviceModel).toBe('samsung SM-A515F');
    expect(next.appVersion).toBe('1.4.0');
    expect(next.networkType).toBe('WIFI');
    expect(next.cellularGeneration).toBeNull();
    expect(next.batteryLevel).toBe(60);
  });

  it('writes a sample at most every 5 min unless network / charging / app version changed', () => {
    const now = Date.now();
    const base = toSnapshotFields(good as any);
    const prev = { ...base, historyAt: new Date(now - 60_000) };
    expect(shouldWriteSample(null, base, now)).toBe(true);
    expect(shouldWriteSample(prev, { ...base, batteryLevel: 61 }, now)).toBe(false);
    expect(shouldWriteSample({ ...prev, historyAt: new Date(now - SAMPLE_INTERVAL_MS) }, base, now)).toBe(true);
    expect(shouldWriteSample(prev, { ...base, networkType: 'WIFI', cellularGeneration: null }, now)).toBe(true);
    expect(shouldWriteSample(prev, { ...base, charging: true }, now)).toBe(true);
    expect(shouldWriteSample(prev, { ...base, appVersion: '1.5.0' }, now)).toBe(true);
  });
});

describe('location body carries device context without affecting points', () => {
  it('batch and single bodies expose the raw device value', () => {
    const batch = LocationBody.parse({ points: [{ lat: 1, lng: 2, recordedAt: 5 }], sentAt: 9, device: good });
    expect(bodyPoints(batch)).toEqual({ points: [{ lat: 1, lng: 2, recordedAt: 5 }], sentAt: 9, device: good });
    const single = LocationBody.parse({ lat: 1, lng: 2, device: { imei: 'x' } });
    const out = bodyPoints(single);
    expect(out.points).toEqual([{ lat: 1, lng: 2 }]);
    // An invalid device never rejects the location body; it is dropped later.
    expect(parseDevice(out.device)).toBeNull();
  });
});
