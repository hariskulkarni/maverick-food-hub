'use client';
import * as React from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';

/**
 * Mobile hamburger that opens a right-side sheet using Radix Dialog.
 *
 * Kept as a small client island so the rest of the customer layout (and home
 * page) can stay server-rendered.
 */
export function MobileNav({ isAuthed }: { isAuthed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);

  const linkClass =
    'block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open menu"
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
      >
        <Menu className="size-5" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 h-dvh w-[85vw] max-w-sm border-l bg-background p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex items-center justify-between">
            <span className="display text-lg font-bold">
              <span className="text-gradient-saffron">Menu</span>
            </span>
            <DialogPrimitive.Close
              aria-label="Close menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <nav className="mt-6 flex flex-col gap-1">
            <Link href="#how-it-works" className={linkClass} onClick={close}>How it works</Link>
            <Link href="/signup/restaurant" className={linkClass} onClick={close}>For restaurants</Link>
            <Link href="/signup/rider" className={linkClass} onClick={close}>Become a rider</Link>
            <Link href="/restaurants" className={linkClass} onClick={close}>Restaurants</Link>
            <Link href="/track" className={linkClass} onClick={close}>Track order</Link>
          </nav>

          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/restaurants"
              className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
              onClick={close}
            >
              Order now
            </Link>
            {!isAuthed && (
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                onClick={close}
              >
                Sign in
              </Link>
            )}
            {isAuthed && (
              <Link
                href="/profile"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                onClick={close}
              >
                My account
              </Link>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
