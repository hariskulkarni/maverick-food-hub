'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Responsive dialog content.
 *
 * Mobile (< md): renders as a bottom sheet — pinned to the viewport bottom,
 * full-width, rounded top corners only, with a drag-affordance "grabber". The
 * shadcn slide-in animation reads as a familiar iOS bottom-sheet enter.
 *
 * md+: classic centered modal (the original behaviour).
 *
 * `safe-bottom` honours the iOS home-indicator inset so the close button and
 * primary action don't sit underneath the rounded chin.
 */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Shared
        'fixed z-50 grid gap-4 border bg-background shadow-lg',
        // Mobile bottom-sheet (default)
        'inset-x-0 bottom-0 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl p-5 pb-7 safe-bottom',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-200',
        'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-150',
        // md+ centered modal
        'md:inset-x-auto md:bottom-auto md:left-[50%] md:top-[50%] md:w-full md:max-w-lg md:-translate-x-[50%] md:-translate-y-[50%]',
        'md:max-h-none md:overflow-visible md:rounded-xl md:p-6 md:pb-6',
        'md:data-[state=open]:slide-in-from-bottom-0 md:animate-slide-up',
        className
      )}
      {...props}
    >
      {/* Drag-down grabber — visual affordance only; Radix doesn't ship gesture
          dismiss out of the box and we don't want to pull in a new dep. The
          overlay still closes on backdrop-tap, which is the dominant pattern. */}
      <div
        aria-hidden
        className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30 md:hidden"
      />
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
);
export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2', className)} {...props} />
);
export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;
export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
