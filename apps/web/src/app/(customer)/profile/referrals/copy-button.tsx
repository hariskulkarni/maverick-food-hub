'use client';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="outline"
      onClick={async () => { await navigator.clipboard.writeText(text); toast.success('Copied'); }}
    >
      <Copy className="size-4" /> {label}
    </Button>
  );
}
