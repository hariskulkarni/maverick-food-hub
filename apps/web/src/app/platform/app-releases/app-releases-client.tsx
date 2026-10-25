'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, Link2, Rocket, Undo2, Power, CheckCircle2, Download, Loader2, FileArchive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Platform = 'ANDROID' | 'IOS';
type Channel = 'STABLE' | 'BETA';

export interface AdminRelease {
  id: string;
  platform: Platform;
  channel: Channel;
  versionName: string;
  versionCode: number;
  minSupportedVersionCode: number;
  fileSize: number | null;
  sha256: string | null;
  releaseNotes: string | null;
  publishedAt: string;
  downloadUrl: string;
  storeUrl: string | null;
  hostedFile: boolean;
  fileName: string | null;
  externalUrl: string | null;
  isActive: boolean;
  downloadCount: number;
}

const MAX_BYTES = 200 * 1024 * 1024;
const APK_MIME = 'application/vnd.android.package-archive';

function mb(n: number | null) {
  return n ? `${(n / (1024 * 1024)).toFixed(1)} MB` : '—';
}
function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}
async function errorOf(res: Response): Promise<string> {
  const t = await res.text().catch(() => '');
  try {
    const j = JSON.parse(t);
    return j.error || j.message || `Request failed (${res.status})`;
  } catch {
    return t && t.length < 200 ? t : `Request failed (${res.status})`;
  }
}

/** XHR (not fetch) so we can show upload progress for a ~100 MB APK. */
function uploadApk(file: File, onProgress: (pct: number) => void): Promise<{ uploadToken: string; sha256: string; fileSize: number; fileName: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/platform/app-releases/upload');
    xhr.setRequestHeader('Content-Type', APK_MIME);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON (e.g. proxy 413 page) */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.uploadToken) resolve(body);
      else reject(new Error(body?.error || (xhr.status === 413 ? 'The APK is too large for the server (max 200 MB).' : `Upload failed (${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(file);
  });
}

export function AppReleasesClient({ initial }: { initial: AdminRelease[] }) {
  const router = useRouter();
  const [releases, setReleases] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch('/api/platform/app-releases', { cache: 'no-store' });
    if (r.ok) setReleases((await r.json()).releases);
    router.refresh();
  }

  async function act(url: string, body: unknown, ok: string, id: string) {
    setBusyId(id);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      if (!r.ok) throw new Error(await errorOf(r));
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo(() => {
    const keys: { platform: Platform; channel: Channel }[] = [];
    for (const r of releases) if (!keys.some((k) => k.platform === r.platform && k.channel === r.channel)) keys.push({ platform: r.platform, channel: r.channel });
    return keys.map((k) => ({ ...k, rows: releases.filter((r) => r.platform === k.platform && r.channel === k.channel) }));
  }, [releases]);

  return (
    <div className="space-y-6">
      <PublishForm onPublished={refresh} existing={releases} />

      {groups.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No releases yet. Publish the first build above — until then the download card tells riders the app is being updated.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => {
          const active = g.rows.find((r) => r.isActive);
          const canRollback = !!active && g.rows.some((r) => r.versionCode < active.versionCode);
          const key = `${g.platform}-${g.channel}`;
          return (
            <Card key={key}>
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {g.platform === 'ANDROID' ? 'Android' : 'iOS'} · {g.channel === 'STABLE' ? 'Stable' : 'Beta'}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {active ? <>Live: v{active.versionName} (#{active.versionCode})</> : 'No active release — downloads are unavailable on this channel.'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRollback || busyId !== null}
                    onClick={() => {
                      if (confirm(`Roll back ${g.platform} ${g.channel} to the previous release? Riders will download the older build.`))
                        act('/api/platform/app-releases/rollback', { platform: g.platform, channel: g.channel }, 'Rolled back', key);
                    }}
                  >
                    {busyId === key ? <Loader2 className="animate-spin" /> : <Undo2 />} Roll back
                  </Button>
                </div>
                <ul className="divide-y rounded-xl border">
                  {g.rows.map((r) => (
                    <li key={r.id} className={cn('flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between', r.isActive && 'bg-success/5')}>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">v{r.versionName}</span>
                          <span className="text-xs text-muted-foreground">#{r.versionCode}</span>
                          {r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>}
                          <Badge variant="outline">{r.hostedFile ? 'Hosted APK' : 'External link'}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {when(r.publishedAt)} · {mb(r.fileSize)} · min supported #{r.minSupportedVersionCode} ·{' '}
                          <span className="inline-flex items-center gap-1"><Download className="size-3" /> {r.downloadCount}</span>
                        </div>
                        {r.sha256 && <div className="break-all font-mono text-[11px] text-muted-foreground">sha256 {r.sha256}</div>}
                        {r.externalUrl && <div className="break-all text-xs text-muted-foreground">→ {r.externalUrl}</div>}
                        {r.storeUrl && <div className="break-all text-xs text-muted-foreground">Store: {r.storeUrl}</div>}
                        {r.releaseNotes && <p className="whitespace-pre-line text-sm">{r.releaseNotes}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {r.isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() => {
                              if (confirm(`Deactivate v${r.versionName}? Riders will not be able to download any ${g.platform} ${g.channel} build until another is activated.`))
                                act(`/api/platform/app-releases/${r.id}/deactivate`, null, 'Release deactivated', r.id);
                            }}
                          >
                            {busyId === r.id ? <Loader2 className="animate-spin" /> : <Power />} Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() => {
                              if (confirm(`Make v${r.versionName} the live ${g.platform} ${g.channel} release?`))
                                act(`/api/platform/app-releases/${r.id}/activate`, null, `v${r.versionName} is now live`, r.id);
                            }}
                          >
                            {busyId === r.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Activate
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function PublishForm({ onPublished, existing }: { onPublished: () => Promise<void>; existing: AdminRelease[] }) {
  const [platform, setPlatform] = useState<Platform>('ANDROID');
  const [channel, setChannel] = useState<Channel>('STABLE');
  const [source, setSource] = useState<'upload' | 'link'>('upload');
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [minSupported, setMinSupported] = useState('0');
  const [notes, setNotes] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [activate, setActivate] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const latestCode = Math.max(0, ...existing.filter((r) => r.platform === platform && r.channel === channel).map((r) => r.versionCode));
  const effectiveSource = platform === 'IOS' ? 'link' : source;

  function pickFile(f: File | null) {
    if (!f) return setFile(null);
    if (!f.name.toLowerCase().endsWith('.apk')) {
      toast.error('Choose an .apk file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('The APK is larger than 200 MB.');
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = Number(versionCode);
    if (!Number.isInteger(code) || code < 1) return toast.error('Version code must be a whole number (the Android versionCode).');
    if (effectiveSource === 'upload' && !file) return toast.error('Choose the APK to upload.');
    if (effectiveSource === 'link' && !downloadUrl.trim() && !storeUrl.trim()) return toast.error('Enter a download link or a store link.');
    setBusy(true);
    try {
      let uploadToken: string | undefined;
      if (effectiveSource === 'upload' && file) {
        setProgress(0);
        const up = await uploadApk(file, setProgress);
        uploadToken = up.uploadToken;
        toast.success(`Uploaded · SHA-256 ${up.sha256.slice(0, 12)}…`);
      }
      const r = await fetch('/api/platform/app-releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          channel,
          versionName: versionName.trim(),
          versionCode: code,
          minSupportedVersionCode: Number(minSupported) || 0,
          releaseNotes: notes.trim() || null,
          uploadToken: uploadToken ?? null,
          downloadUrl: effectiveSource === 'link' && downloadUrl.trim() ? downloadUrl.trim() : null,
          storeUrl: storeUrl.trim() || null,
          sha256: effectiveSource === 'link' && sha256.trim() ? sha256.trim() : null,
          activate,
        }),
      });
      if (!r.ok) throw new Error(await errorOf(r));
      toast.success(activate ? `v${versionName} published and live` : `v${versionName} published (inactive)`);
      setVersionName('');
      setVersionCode('');
      setNotes('');
      setDownloadUrl('');
      setSha256('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await onPublished();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2">
            <Rocket className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Publish a release</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Seg label="Platform" value={platform} onChange={(v) => setPlatform(v as Platform)} options={[['ANDROID', 'Android'], ['IOS', 'iOS']]} />
            <Seg label="Channel" value={channel} onChange={(v) => setChannel(v as Channel)} options={[['STABLE', 'Stable'], ['BETA', 'Beta']]} />
            <div>
              <Label htmlFor="rel-vname">Version name</Label>
              <Input id="rel-vname" className="mt-1" placeholder="1.3.0" value={versionName} onChange={(e) => setVersionName(e.target.value)} required maxLength={40} />
            </div>
            <div>
              <Label htmlFor="rel-vcode">Version code</Label>
              <Input id="rel-vcode" className="mt-1" inputMode="numeric" placeholder={String(latestCode + 1)} value={versionCode} onChange={(e) => setVersionCode(e.target.value.replace(/\D/g, ''))} required />
              <p className="mt-1 text-[11px] text-muted-foreground">Android versionCode from the EAS build{latestCode ? ` · latest here #${latestCode}` : ''}.</p>
            </div>
          </div>

          {platform === 'ANDROID' && (
            <Seg label="Build source" value={source} onChange={(v) => setSource(v as 'upload' | 'link')} options={[['upload', 'Upload APK'], ['link', 'External link']]} />
          )}

          {effectiveSource === 'upload' ? (
            <div>
              <Label htmlFor="rel-file">APK file (≤ 200 MB)</Label>
              <label
                htmlFor="rel-file"
                className="mt-1 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-sm hover:bg-muted/40"
              >
                {file ? (
                  <>
                    <FileArchive className="size-5 text-primary" />
                    <span className="font-medium break-all">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{mb(file.size)}</span>
                  </>
                ) : (
                  <>
                    <Upload className="size-5 text-muted-foreground" />
                    <span>Choose the .apk from the EAS build</span>
                    <span className="text-xs text-muted-foreground">Stored privately; SHA-256 is computed on the server.</span>
                  </>
                )}
              </label>
              <input id="rel-file" ref={fileRef} type="file" accept=".apk,application/vnd.android.package-archive" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              {progress !== null && (
                <div className="mt-2" aria-live="polite">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Uploading… {progress}%</div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rel-url">Download link (https)</Label>
                <Input id="rel-url" className="mt-1" type="url" placeholder="https://expo.dev/artifacts/eas/….apk" value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rel-sha">SHA-256 (optional)</Label>
                <Input id="rel-sha" className="mt-1 font-mono" placeholder="64 hex characters" value={sha256} onChange={(e) => setSha256(e.target.value.trim())} />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rel-store">
                <span className="inline-flex items-center gap-1"><Link2 className="size-3.5" /> Store listing (optional)</span>
              </Label>
              <Input id="rel-store" className="mt-1" type="url" placeholder={platform === 'IOS' ? 'https://apps.apple.com/…' : 'https://play.google.com/store/apps/details?id=com.flavrly.rider'} value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rel-min">Minimum supported version code</Label>
              <Input id="rel-min" className="mt-1" inputMode="numeric" value={minSupported} onChange={(e) => setMinSupported(e.target.value.replace(/\D/g, ''))} />
              <p className="mt-1 text-[11px] text-muted-foreground">Installed builds below this see a blocking “Update required” screen (SOS stays available). 0 = never force.</p>
            </div>
          </div>

          <div>
            <Label htmlFor="rel-notes">Release notes (shown to riders)</Label>
            <Textarea id="rel-notes" className="mt-1" rows={3} maxLength={4000} placeholder="What changed in this build" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={activate} onCheckedChange={setActivate} aria-label="Make this the live release" />
              Make this the live release now
            </label>
            <Button type="submit" disabled={busy} className="min-h-11">
              {busy ? <Loader2 className="animate-spin" /> : <Rocket />} {busy ? 'Publishing…' : 'Publish release'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Seg({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div role="radiogroup" aria-label={label} className="mt-1 inline-flex rounded-lg border p-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn('min-h-9 rounded-md px-3 text-sm font-medium transition-colors', value === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
