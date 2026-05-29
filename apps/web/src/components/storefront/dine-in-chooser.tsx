'use client';

/**
 * DineInChooser — the sheet that opens when a customer taps the "Dine-In" tab
 * on the bottom nav of a restaurant ordering page.
 *
 * Two big choices:
 *   1. "Reserve a table"             → /r/<slug>/reserve
 *   2. "I'm here — scan the table QR" → opens the device camera (PWA scanner)
 *
 * The scanner uses `BarcodeDetector` when the browser supports it (modern
 * Android Chrome) and falls back to a hint asking the customer to open their
 * camera app and scan the QR — that QR points at /r/<slug>?table=<code>,
 * which we already handle server-side, so the dumbest fallback still works.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CalendarCheck, QrCode, X, Camera, ArrowRight } from 'lucide-react';

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | ImageBitmap | HTMLImageElement): Promise<{ rawValue: string }[]>;
}
declare global {
  // eslint-disable-next-line no-var
  var BarcodeDetector: { new (opts?: { formats?: string[] }): BarcodeDetectorLike } | undefined;
}

export function DineInChooser({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
}) {
  const [view, setView] = useState<'choose' | 'scan' | 'manual'>('choose');
  const [scanError, setScanError] = useState<string | null>(null);

  // Reset to the chooser every time the sheet opens.
  useEffect(() => {
    if (open) {
      setView('choose');
      setScanError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-3xl border-t border-x bg-card p-0 shadow-2xl outline-none data-[state=open]:animate-slide-up sm:bottom-1/2 sm:translate-y-1/2 sm:rounded-3xl"
        >
          <DialogTitle className="sr-only">Dine-in</DialogTitle>
          {/* Grab handle */}
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Dine-in</div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>

          {view === 'choose' && <ChooseView slug={slug} onScan={() => setView('scan')} />}
          {view === 'scan' && (
            <ScanView
              slug={slug}
              onClose={() => onOpenChange(false)}
              onFallback={(msg) => { setScanError(msg); setView('manual'); }}
            />
          )}
          {view === 'manual' && <ManualView slug={slug} note={scanError} onBack={() => setView('choose')} />}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function ChooseView({ slug, onScan }: { slug: string; onScan: () => void }) {
  return (
    <div className="px-5 pb-6 pt-1 space-y-3">
      <h2 className="display text-xl font-bold">How would you like to dine in?</h2>
      <p className="text-sm text-muted-foreground">
        Reserve a table ahead of time, or scan the QR on your table to start ordering.
      </p>

      <div className="mt-4 space-y-2.5">
        {/* Reserve */}
        <Link
          href={`/r/${slug}/reserve`}
          className="group flex items-center gap-3 rounded-2xl border-2 border-primary/20 bg-primary/5 p-4 transition-all hover:border-primary hover:bg-primary/10 active:scale-[0.99]"
        >
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <CalendarCheck className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-foreground">Reserve a table</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a date, time and party size. You'll get a confirmation.
            </p>
          </div>
          <ArrowRight className="size-5 text-primary transition-transform group-hover:translate-x-0.5" />
        </Link>

        {/* Scan table QR */}
        <button
          type="button"
          onClick={onScan}
          className="group flex w-full items-center gap-3 rounded-2xl border-2 border-secondary/20 bg-secondary/5 p-4 text-left transition-all hover:border-secondary hover:bg-secondary/10 active:scale-[0.99]"
        >
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground shadow-lg shadow-secondary/20">
            <QrCode className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-foreground">I&apos;m here — scan the table QR</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Point your camera at the QR on the table to start a dine-in order.
            </p>
          </div>
          <ArrowRight className="size-5 text-secondary transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function ScanView({
  slug,
  onClose,
  onFallback,
}: {
  slug: string;
  onClose: () => void;
  onFallback: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [running, setRunning] = useState(false);

  // Try to decode QRs from the camera using the browser BarcodeDetector API.
  // Browsers that don't support it (Safari pre-17) get sent to the manual
  // fallback with a helpful message.
  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onFallback('Your browser does not allow camera access.');
      return;
    }
    if (typeof window.BarcodeDetector !== 'function') {
      onFallback("Your browser can't decode QR codes in-app. Use your phone's camera app and tap the link.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          requestAnimationFrame(tick);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes[0]?.rawValue) {
            stream.getTracks().forEach((t) => t.stop());
            // Trust only same-origin/relative URLs — anything else is suspicious.
            const value = codes[0].rawValue;
            try {
              const u = new URL(value, window.location.origin);
              if (u.origin === window.location.origin) {
                window.location.href = u.toString();
                return;
              }
            } catch { /* fall through */ }
            // Unknown payload — treat as a table code, append to current URL.
            window.location.href = `/r/${slug}?table=${encodeURIComponent(value)}`;
            return;
          }
        } catch {
          // Ignore frame errors and keep scanning.
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (e: any) {
      onFallback(e?.message ? `Camera blocked: ${e.message}` : 'Camera access was denied.');
    }
  }, [slug, onFallback]);

  useEffect(() => {
    start();
    return () => {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-5 pb-6 pt-1 space-y-3">
      <h2 className="display text-xl font-bold">Scan the table QR</h2>
      <p className="text-sm text-muted-foreground">Hold the camera over the QR code on your table.</p>
      <div className="relative mt-2 aspect-square w-full overflow-hidden rounded-2xl bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-44 rounded-2xl border-4 border-white/80 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]" />
        </div>
        {!running && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Camera className="size-10 animate-pulse" />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full rounded-full border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}

function ManualView({ slug, note, onBack }: { slug: string; note: string | null; onBack: () => void }) {
  return (
    <div className="px-5 pb-6 pt-1 space-y-3">
      <h2 className="display text-xl font-bold">Use your phone's camera</h2>
      <p className="text-sm text-muted-foreground">
        {note || "We couldn't open the in-app scanner."} Open the camera app on your phone and point it at the
        QR sticker on your table — it'll bring you here automatically.
      </p>
      <div className="rounded-xl border bg-muted/30 p-4 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or, if you have the table code:</div>
        <ManualTableEntry slug={slug} />
      </div>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 w-full rounded-full border bg-card py-2.5 text-sm font-semibold hover:bg-muted"
      >
        Back
      </button>
    </div>
  );
}

function ManualTableEntry({ slug }: { slug: string }) {
  const [code, setCode] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim()) return;
        window.location.href = `/r/${slug}?table=${encodeURIComponent(code.trim())}`;
      }}
      className="mt-2 flex gap-2"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. T-12"
        className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:border-primary"
        autoFocus
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        Go
      </button>
    </form>
  );
}
