/**
 * QA-D1: the item-mapping card stays mounted while no branch is linked, so a branch
 * id captured at mount ('') must not survive the first link — Import would send
 * branchId '' (400) until a page reload. The selected branch is derived on every
 * render from the current linked-branch list.
 */
import { describe, it, expect } from 'vitest';
import { effectiveBranchId } from '@/app/admin/integrations/novaryq-panel';

const b = (id: string) => ({ id });

describe('effectiveBranchId (Novaryq item mapping)', () => {
  it('no linked branch → nothing selected', () => {
    expect(effectiveBranchId([], '')).toBe('');
  });

  it('first branch linked in the same page session → it is selected (no reload needed)', () => {
    // State captured when the card mounted with an empty list.
    const chosen = '';
    expect(effectiveBranchId([b('br_1')], chosen)).toBe('br_1');
  });

  it('keeps the owner\'s choice while that branch is still linked', () => {
    expect(effectiveBranchId([b('br_1'), b('br_2')], 'br_2')).toBe('br_2');
  });

  it('a chosen branch that was unlinked falls back to the first linked one', () => {
    expect(effectiveBranchId([b('br_1'), b('br_3')], 'br_2')).toBe('br_1');
    expect(effectiveBranchId([], 'br_2')).toBe('');
  });
});
