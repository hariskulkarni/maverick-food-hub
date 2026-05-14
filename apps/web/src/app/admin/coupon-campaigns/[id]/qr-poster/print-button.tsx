'use client';
/**
 * Tiny client island — fires window.print() so the parent A4 poster page can
 * stay a server component. The `print:hidden` toolbar that wraps this button
 * is stripped from the print output by the page's Tailwind classes.
 */
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

export function PrintButtonClient() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="size-4" /> Print poster
    </Button>
  );
}
