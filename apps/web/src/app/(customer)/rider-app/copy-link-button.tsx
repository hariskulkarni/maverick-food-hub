'use client';

import { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';

/**
 * Tap-to-copy the install URL (or, on phones that support the Web Share API,
 * triggers the native share sheet so riders can send the link directly to a
 * friend on WhatsApp/SMS without leaving the page).
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    // Prefer native share on mobile — much friendlier than copy-paste.
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({
          title: 'Flavrly Rider — Android app',
          text: 'Deliver on your own time with Flavrly. Download the rider app:',
          url,
        });
        return;
      } catch { /* user cancelled — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-primary/40 px-5 py-4 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors"
    >
      {copied ? <><Check className="size-4" /> Copied!</> : <><Share2 className="size-4" /> Share link</>}
    </button>
  );
}
