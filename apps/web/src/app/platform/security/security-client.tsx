'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ShieldCheck, ShieldOff } from 'lucide-react';

interface InitialState {
  totpEnabled: boolean;
  allowlist: string[];
  lockoutMinutes: number;
}

interface EnrolResponse {
  otpauthUrl: string;
  secret: string;
  qrDataUrl: string;
}

export function SecurityClient({ initial }: { initial: InitialState }) {
  const router = useRouter();
  const [allowlistText, setAllowlistText] = useState(initial.allowlist.join('\n'));
  const [lockoutMinutes, setLockoutMinutes] = useState(initial.lockoutMinutes);
  const [savingSettings, setSavingSettings] = useState(false);

  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrol, setEnrol] = useState<EnrolResponse | null>(null);
  const [enrolToken, setEnrolToken] = useState('');
  const [enroling, setEnroling] = useState(false);

  async function startEnrol() {
    setEnroling(true);
    try {
      const res = await fetch('/api/platform/security/totp/setup', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as EnrolResponse;
      setEnrol(data);
      setEnrolOpen(true);
    } catch (e) {
      toast.error('Failed to start 2FA setup: ' + (e as Error).message);
    } finally {
      setEnroling(false);
    }
  }

  async function verifyEnrol() {
    if (!enrolToken.trim()) return;
    setEnroling(true);
    try {
      const res = await fetch('/api/platform/security/totp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: enrolToken.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Invalid code');
      toast.success('2FA enabled.');
      setEnrolOpen(false);
      setEnrol(null);
      setEnrolToken('');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnroling(false);
    }
  }

  async function disable2FA() {
    if (!confirm('Disable two-factor authentication for the super-admin account?')) return;
    try {
      const res = await fetch('/api/platform/security/totp/verify', { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      toast.success('2FA disabled.');
      router.refresh();
    } catch (e) {
      toast.error('Failed to disable 2FA: ' + (e as Error).message);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const allowlist = allowlistText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/platform/security', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowlist, lockoutMinutes })
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Settings saved.');
      router.refresh();
    } catch (e) {
      toast.error('Failed to save: ' + (e as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold">Two-factor authentication</h3>
              {initial.totpEnabled
                ? <Badge variant="success">Enabled</Badge>
                : <Badge variant="muted">Disabled</Badge>}
            </div>
            <p className="text-sm text-muted-foreground max-w-xl">
              Require a Google Authenticator (or compatible) code at sign-in. Applies to the super-admin
              account only.
            </p>
          </div>
          <div className="flex gap-2">
            {initial.totpEnabled ? (
              <Button variant="outline" onClick={disable2FA}>
                <ShieldOff className="size-4" /> Disable
              </Button>
            ) : (
              <Button onClick={startEnrol} disabled={enroling}>
                <ShieldCheck className="size-4" /> Enable 2FA
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div>
            <h3 className="font-semibold">IP allowlist</h3>
            <p className="text-sm text-muted-foreground">
              One IP or CIDR per line. When non-empty, super-admin sign-in is rejected from any other IP.
              Leave blank to allow any IP.
            </p>
          </div>
          <Textarea
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            placeholder={'203.0.113.4\n10.0.0.0/8'}
            rows={6}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div>
            <h3 className="font-semibold">Login lockout</h3>
            <p className="text-sm text-muted-foreground">
              After 5 failed attempts in 10 minutes, lock the account for this many minutes.
            </p>
          </div>
          <div className="max-w-[200px]">
            <Label htmlFor="lockoutMinutes">Minutes</Label>
            <Input
              id="lockoutMinutes"
              type="number"
              min={1}
              max={1440}
              value={lockoutMinutes}
              onChange={(e) => setLockoutMinutes(Number(e.target.value) || 0)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={savingSettings}>
          {savingSettings ? 'Saving…' : 'Save settings'}
        </Button>
      </div>

      <Dialog open={enrolOpen} onOpenChange={(o) => { if (!o) { setEnrolOpen(false); setEnrol(null); setEnrolToken(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up two-factor authentication</DialogTitle>
            <DialogDescription>
              Scan the QR with Google Authenticator (or any TOTP app), then enter the 6-digit code to confirm.
            </DialogDescription>
          </DialogHeader>
          {enrol && (
            <div className="space-y-3">
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrol.qrDataUrl} alt="TOTP QR code" width={240} height={240} className="rounded-md border" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Or enter manually</Label>
                <div className="font-mono text-xs break-all bg-muted/40 rounded p-2 select-all">{enrol.secret}</div>
              </div>
              <div>
                <Label htmlFor="enrolToken">6-digit code</Label>
                <Input
                  id="enrolToken"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={enrolToken}
                  onChange={(e) => setEnrolToken(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrolOpen(false)}>Cancel</Button>
            <Button onClick={verifyEnrol} disabled={enroling || enrolToken.length < 6}>
              {enroling ? 'Verifying…' : 'Verify & enable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
