'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * StorefrontAnnouncementBar — a slim, dismissible promo/notice bar pinned to the
 * very top of a restaurant storefront, driven by the Storefront CMS. Colours are
 * admin-configurable; an optional CTA link sits inline. Dismissal is per-render
 * (client state) so it stays out of the way once the visitor closes it.
 */
export function StorefrontAnnouncementBar({
  text,
  linkLabel,
  linkHref,
  bgColor,
  textColor,
}: {
  text: string;
  linkLabel?: string;
  linkHref?: string;
  bgColor: string;
  textColor: string;
}) {
  const [open, setOpen] = useState(true);
  if (!open || !text) return null;
  return (
    <div style={{ backgroundColor: bgColor, color: textColor }} className="relative">
      <div className="container flex items-center justify-center gap-3 py-2 text-center text-xs md:text-sm font-medium">
        <span>{text}</span>
        {linkLabel && linkHref && (
          <a href={linkHref} className="underline underline-offset-2 font-semibold whitespace-nowrap hover:opacity-80">
            {linkLabel}
          </a>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss announcement"
          className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
          style={{ color: textColor }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
