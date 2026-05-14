'use client';
/**
 * Slide-from-right detail drawer. Mounted via Radix Dialog so it gets focus
 * trap + escape-to-close for free. Used to inspect any row across admin pages.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DetailDrawer({
  open, onOpenChange, title, subtitle, badge, side = 'right', width = '560px', children, footer
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  side?: 'right' | 'left';
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 z-50 flex flex-col bg-card shadow-2xl border-l outline-none',
            side === 'right' ? 'right-0 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right' : 'left-0 border-l-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left'
          )}
          style={{ width: '100%', maxWidth: width }}
        >
          <div className="border-b bg-gradient-to-br from-primary/5 via-card to-card px-5 py-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogPrimitive.Title className="display text-lg font-semibold truncate">{title}</DialogPrimitive.Title>
                {badge}
              </div>
              {subtitle && <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">{subtitle}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">{children}</div>
          {footer && <div className="border-t bg-muted/20 px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DrawerSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</div>
        {action}
      </div>
      <div className="rounded-lg border bg-card">{children}</div>
    </section>
  );
}
