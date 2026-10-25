'use client';

import { useState } from 'react';
import { Download, ShieldCheck, Smartphone, Check, ArrowRight, Fingerprint } from 'lucide-react';

/**
 * 4-step install guide (Android, APK outside the Play Store). Riders can step
 * through manually; the inactive steps stay visible so a first-timer sees the
 * whole journey at a glance.
 *
 * Step 1: Download the APK — size/version come from the active AppRelease.
 * Step 2: Allow installs from unknown sources (Chrome → Settings → Allow).
 * Step 3: (Optional) verify the SHA-256 shown on the download card.
 * Step 4: Install, open and sign in; later updates are announced in the app.
 */

function steps(sizeLabel: string | null, versionName: string | null) {
  return [
    {
      n: 1,
      icon: Download,
      title: 'Tap "Download the Rider app"',
      body: `The APK${versionName ? ` (version ${versionName})` : ''} starts downloading straight away${sizeLabel ? ` — ${sizeLabel}` : ''}. Use Chrome on your Android phone. If it asks "Download anyway?", tap Download.`,
      note: 'When the download finishes, tap the notification (or open Files → Downloads).',
    },
    {
      n: 2,
      icon: ShieldCheck,
      title: 'Allow installs from Chrome (unknown sources)',
      body: 'Android asks once: "For your security, your phone is not allowed to install unknown apps from this source." Tap Settings → turn on "Allow from this source" → press back. On older phones: Settings → Security → Unknown sources → on.',
      note: 'You only do this once. You can switch it off again after installing.',
    },
    {
      n: 3,
      icon: Fingerprint,
      title: 'Optional: check it is the genuine app',
      body: 'The download card on this page shows the file\'s SHA-256 checksum. A file-manager or checksum app on your phone (or `shasum -a 256` on a computer) should show exactly the same 64 characters. If it doesn\'t match, delete the file and download again from flavrly.in only.',
      note: 'Only ever install the rider app from flavrly.in — never from a forwarded file.',
    },
    {
      n: 4,
      icon: Smartphone,
      title: 'Install, open and sign in',
      body: 'Tap Install → Open. Sign in with your registered rider phone number and the OTP we send. When a new version is published, the app shows an "Update available" banner — tap it to download the update the same way.',
      note: 'Earnings, payouts, documents and shifts are also on the web at flavrly.in/rider.',
    },
  ] as const;
}

export function InstallGuide({
  apkUrl,
  sizeLabel,
  sha256,
  versionName,
}: {
  apkUrl: string | null;
  sizeLabel: string | null;
  sha256: string | null;
  versionName: string | null;
}) {
  const [active, setActive] = useState(0);
  const STEPS = steps(sizeLabel, versionName);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_440px] items-start">
      {/* Steps list */}
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const isActive = i === active;
          const isDone = i < active;
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => setActive(i)}
                className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-md shadow-primary/10'
                    : 'border-border hover:border-primary/40 bg-card'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`grid size-12 place-items-center rounded-xl shrink-0 transition-all ${
                    isDone ? 'bg-success text-white pop-in' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {isDone ? <Check className="size-6" /> : <s.icon className="size-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {s.n}</div>
                    <h3 className="display text-lg md:text-xl font-bold mt-0.5">{s.title}</h3>
                    {isActive && (
                      <>
                        <p className="mt-2 text-sm text-muted-foreground leading-relaxed slide-in-r">{s.body}</p>
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs text-warning font-medium slide-in-r">
                          💡 {s.note}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-3 mt-2">
          <button
            type="button"
            onClick={() => setActive((a) => Math.max(0, a - 1))}
            disabled={active === 0}
            className="rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-30"
          >
            Back
          </button>
          {active < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setActive((a) => Math.min(STEPS.length - 1, a + 1))}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              Next step <ArrowRight className="size-3.5" />
            </button>
          ) : (
            <a
              href={apkUrl ?? '#download'}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Download className="size-3.5" /> Download{sizeLabel ? ` · ${sizeLabel}` : ''}
            </a>
          )}
        </li>
      </ol>

      {/* Live mockup */}
      <div className="lg:sticky lg:top-24">
        <div className="relative mx-auto max-w-[360px]">
          <div className="relative aspect-[9/19.5] rounded-[2.5rem] border-[8px] border-foreground/80 bg-card shadow-2xl overflow-hidden">
            <div className="absolute top-2 left-1/2 -translate-x-1/2 h-5 w-24 rounded-full bg-foreground/80 z-10" />
            <div key={active} className="absolute inset-0 p-6 pt-12 flex flex-col items-center justify-center text-center slide-in-r">
              {active === 0 && <DownloadMockup sizeLabel={sizeLabel} versionName={versionName} />}
              {active === 1 && <AllowMockup />}
              {active === 2 && <VerifyMockup sha256={sha256} />}
              {active === 3 && <OpenMockup />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadMockup({ sizeLabel, versionName }: { sizeLabel: string | null; versionName: string | null }) {
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downloads</div>
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-3 mt-4 pop-in">
        <Download className="size-8" />
      </div>
      <div className="font-bold break-all">flavrly-rider{versionName ? `-${versionName}` : ''}.apk</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sizeLabel ? `${sizeLabel} · ` : ''}Android app</div>
      <div className="w-full mt-6 h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full shimmer" style={{ width: '72%' }} />
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">Downloading… 72%</div>
    </>
  );
}

function AllowMockup() {
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chrome</div>
      <div className="w-full mt-3 rounded-2xl border bg-background p-4 text-left pop-in shadow-md">
        <div className="grid size-10 place-items-center rounded-full bg-warning/10 text-warning mb-3">
          <ShieldCheck className="size-5" />
        </div>
        <div className="font-bold text-sm">Install unknown apps</div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          For your security, your phone is not allowed to install unknown apps
          from this source. You can change this in Settings.
        </p>
        <div className="mt-4 flex gap-2 justify-end">
          <span className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">Cancel</span>
          <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Settings</span>
        </div>
      </div>
      <div className="mt-4 text-[11px] text-muted-foreground">Tap Settings → &quot;Allow from this source&quot; → back.</div>
    </>
  );
}

function VerifyMockup({ sha256 }: { sha256: string | null }) {
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SHA-256</div>
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-3 mt-4 pop-in">
        <Fingerprint className="size-8" />
      </div>
      <div className="w-full rounded-xl border bg-background p-3 text-left">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Published checksum</div>
        <div className="mt-1 break-all font-mono text-[10px] leading-relaxed">{sha256 ?? 'Shown on the download card once published'}</div>
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground">Same 64 characters on your file? It&apos;s genuine.</div>
    </>
  );
}

function OpenMockup() {
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Installed</div>
      <div className="grid size-24 place-items-center rounded-3xl bg-gradient-to-br from-primary to-berry text-white mt-3 pop-in shadow-xl shadow-primary/30">
        <span className="display text-3xl font-extrabold">F</span>
      </div>
      <div className="display font-bold text-lg mt-3">Flavrly Rider</div>
      <div className="text-[11px] text-muted-foreground">Tap to open</div>
      <div className="mt-6 w-full rounded-xl bg-success/10 border border-success/30 p-3 text-success text-xs font-semibold pop-in">
        ✓ Installed successfully
      </div>
    </>
  );
}
