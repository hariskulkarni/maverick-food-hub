import { describe, it, expect } from 'vitest';
import { Prisma, IntegrationProvider, ReviewReplyState, ReviewReplySource } from '@prisma/client';

describe('reviews schema', () => {
  it('exposes the new models and enum values on the Prisma client', () => {
    expect(Prisma.ModelName.GoogleReview).toBe('GoogleReview');
    expect(Prisma.ModelName.ReviewReply).toBe('ReviewReply');
    expect(Prisma.ModelName.ReviewAutoReplyConfig).toBe('ReviewAutoReplyConfig');
    expect(ReviewReplyState.PENDING_APPROVAL).toBe('PENDING_APPROVAL');
    expect(ReviewReplySource.AUTO).toBe('AUTO');
    expect(IntegrationProvider.GOOGLE_BUSINESS).toBe('GOOGLE_BUSINESS');
    expect(IntegrationProvider.LLM_REVIEWS).toBe('LLM_REVIEWS');
  });
});
