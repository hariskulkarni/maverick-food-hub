'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ISSUE_CATEGORIES, submitIssue, type IssueCategory } from '@/lib/help-issue';

export function IssueForm({ orderId: initialOrderId }: { orderId: string }) {
  const [category, setCategory] = useState<IssueCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState(initialOrderId);
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const r = await submitIssue({ category, description, orderId });
    setState(r.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return (
      <div role="status" className="mt-8 rounded-xl border bg-card p-6 text-center">
        <h2 className="display text-xl font-semibold">Thanks, we have your report</h2>
        <p className="mt-2 text-sm text-muted-foreground">Our support team will follow up shortly.</p>
        <Link href="/orders" className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
          Back to my orders
        </Link>
      </div>
    );
  }

  const field = 'mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-base';
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <label className="block text-sm font-medium">
        What went wrong?
        <select value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)} className={field}>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Describe the problem
        <textarea
          required
          minLength={3}
          maxLength={2000}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={field}
        />
      </label>
      <label className="block text-sm font-medium">
        Order ID (optional)
        <input value={orderId} onChange={(e) => setOrderId(e.target.value)} className={field} />
      </label>
      {state === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          We could not send your report. Please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="h-11 w-full rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending...' : 'Submit report'}
      </button>
    </form>
  );
}
