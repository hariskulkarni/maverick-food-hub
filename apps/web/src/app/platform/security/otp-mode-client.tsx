'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type OtpMode = 'demo' | 'production';

export function OtpModeClient({ initial }: { initial: { mode: OtpMode } }) {
  const router = useRouter();
  const [mode, setMode] = useState<OtpMode>(initial.mode);
  const [saving, setSaving] = useState(false);

  async function save(next: OtpMode) {
    if (next === mode || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/security', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otpMode: next })
      });
      if (!res.ok) throw new Error(await res.text());
      setMode(next);
      toast.success(
        next === 'production'
          ? 'OTP set to Production — real SMS via MSG91.'
          : 'OTP set to Demo — codes shown on-screen.'
      );
      router.refresh();
    } catch (e) {
      toast.error('Failed to update: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            Customer OTP delivery mode
            <Badge variant={mode === 'production' ? 'muted' : 'destructive'}>
              {mode === 'production' ? 'Production' : 'Demo'}
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground max-w-xl">
            How customer login codes are delivered. Takes effect immediately — no redeploy.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={() => save('demo')} disabled={saving || mode === 'demo'}>
            {mode === 'demo' ? 'Demo (current)' : 'Switch to Demo'}
          </Button>
          <Button onClick={() => save('production')} disabled={saving || mode === 'production'}>
            {mode === 'production' ? 'Production (current)' : 'Switch to Production'}
          </Button>
        </div>
        {mode === 'demo' ? (
          <p className="text-xs text-amber-600">
            Demo shows every login code on screen — do NOT use with real customers (anyone could read another number&apos;s code). Switch to Production before launch.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Production sends the OTP by SMS via MSG91 and never shows it on screen. Ensure the MSG91 account has SMS balance.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
