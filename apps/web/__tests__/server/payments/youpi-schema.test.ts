import { describe, it, expect } from 'vitest';
import { IntegrationProvider, Prisma, YoupiRequestStatus } from '@prisma/client';

describe('Flavrly PG schema', () => {
  it('adds YOUPI to IntegrationProvider', () => {
    expect(IntegrationProvider.YOUPI).toBe('YOUPI');
  });

  it('registers YoupiDailyUsage model', () => {
    expect(Prisma.ModelName.YoupiDailyUsage).toBe('YoupiDailyUsage');
  });

  it('registers YoupiFeatureRequest model', () => {
    expect(Prisma.ModelName.YoupiFeatureRequest).toBe('YoupiFeatureRequest');
  });

  it('defines YoupiRequestStatus enum', () => {
    expect(YoupiRequestStatus.APPROVED).toBe('APPROVED');
  });
});
