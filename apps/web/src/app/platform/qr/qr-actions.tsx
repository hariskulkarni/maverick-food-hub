'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Eye, EyeOff } from 'lucide-react';

/**
 * Client-side action buttons for /platform/qr. Each posts to a
 * super-admin-guarded API and calls router.refresh() to re-render the page
 * with the new server state.
 */

export function BulkEnsureButton() {
  const router = useRouter();
  const [busy, start] = useTransition();

  function run() {
    start(async () => {
      try {
        const r = await fetch('/api/platform/qr/ensure-all', { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        toast.success(
          d.created > 0
            ? `Minted ${d.created} new QR${d.created === 1 ? '' : 's'} (${d.skipped} already had one).`
            : 'All restaurants already have a QR.',
        );
        router.refresh();
      } catch (e: any) {
        toast.error('Sweep failed', { description: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      Generate missing
    </button>
  );
}

export function EnsureRestaurantButton({ restaurantId, label = 'Generate restaurant QR' }: { restaurantId: string; label?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function run() {
    start(async () => {
      try {
        const r = await fetch(`/api/platform/qr/ensure/${restaurantId}`, { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        toast.success(d.created ? `New QR code: ${d.qr.code}` : 'Already had a QR — nothing to do.');
        router.refresh();
      } catch (e: any) {
        toast.error('Generation failed', { description: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/50 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      {label}
    </button>
  );
}

export function MintBranchQrButton({ restaurantId, branchId, branchName }: { restaurantId: string; branchId: string; branchName: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function run() {
    start(async () => {
      try {
        const r = await fetch(`/api/platform/restaurants/${restaurantId}/qr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'BRANCH', branchId }),
        });
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();
        toast.success(`Branch QR minted: ${d.qr.code}`);
        router.refresh();
      } catch (e: any) {
        toast.error('Generation failed', { description: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-60"
      title={`Generate a BRANCH QR for ${branchName}`}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
      Branch QR
    </button>
  );
}

export function QrRowActions({ qrId, isActive }: { qrId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function toggle() {
    start(async () => {
      try {
        const r = await fetch(`/api/platform/qr/${qrId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !isActive }),
        });
        if (!r.ok) throw new Error(await r.text());
        toast.success(isActive ? 'QR disabled.' : 'QR re-enabled.');
        router.refresh();
      } catch (e: any) {
        toast.error('Update failed', { description: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  function remove() {
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
    start(async () => {
      try {
        const r = await fetch(`/api/platform/qr/${qrId}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        toast.success('QR deleted.');
        router.refresh();
      } catch (e: any) {
        toast.error('Delete failed', { description: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="grid size-7 place-items-center rounded border hover:bg-accent disabled:opacity-50"
        title={isActive ? 'Disable QR' : 'Enable QR'}
      >
        {isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className={`grid size-7 place-items-center rounded border disabled:opacity-50 ${confirming ? 'border-destructive bg-destructive text-destructive-foreground' : 'text-destructive hover:bg-destructive/10'}`}
        title={confirming ? 'Click again to confirm delete' : 'Delete QR'}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
