'use client';

import { useState } from 'react';
import { Download, ShieldCheck, Smartphone, Check, ArrowRight } from 'lucide-react';

/**
 * 3-step install guide. Riders can step through manually by tapping the dots;
 * the inactive steps stay visible at the side so a first-timer sees the whole
 * journey at a glance.
 *
 * Step 1: Download the APK — illustrated with a shimmering progress bar.
 * Step 2: Allow installs from Chrome — illustrated with a faux Android dialog.
 * Step 3: Open the app — illustrated with the Flavrly icon zooming in.
 */

const STEPS = [
  {
    n: 1,
    icon: Download,
    title: 'Tap "Download the Rider app"',
    body: 'The APK starts downloading immediately — about 85 MB. On a 4G connection it finishes in 30 seconds.',
    note: 'When the download notification appears, tap it to open.',
  },
  {
    n: 2,
    icon: ShieldCheck,
    title: 'Allow install from Chrome',
    body: 'Android will ask once: "Allow installs from this source?" — tap Settings → Allow → back. This is normal and Google\'s standard way of installing apps outside the Play Store.',
    note: 'You only have to do this once.',
  },
  {
    n: 3,
    icon: Smartphone,
    title: 'Open the app + sign in',
    body: 'Tap "Install" → "Open". Sign in with your phone number, enter the OTP we send, and you\'re in. KYC takes 24h.',
    note: 'Your earnings start the moment you take your first delivery.',
  },
] as const;

export function InstallGuide({ apkUrl, sizeMb }: { apkUrl: string; sizeMb: number }) {
  const [active, setActive] = useState(0);

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
              href={apkUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Download className="size-3.5" /> Download · {sizeMb} MB
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
              {active === 0 && <DownloadMockup sizeMb={sizeMb} />}
              {active === 1 && <AllowMockup />}
              {active === 2 && <OpenMockup />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadMockup({ sizeMb }: { sizeMb: number }) {
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downloads</div>
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-3 mt-4 pop-in">
        <Download className="size-8" />
      </div>
      <div className="font-bold">flavrly-rider.apk</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sizeMb} MB · Android app</div>
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
        <div className="font-bold text-sm">Allow installs from this source?</div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Chrome wants to install an app. You can allow only this app to install,
          or allow all installs from Chrome.
        </p>
        <div className="mt-4 flex gap-2 justify-end">
          <span className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">Cancel</span>
          <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Settings</span>
        </div>
      </div>
      <div className="mt-4 text-[11px] text-muted-foreground">Tap Settings → Allow → back.</div>
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
