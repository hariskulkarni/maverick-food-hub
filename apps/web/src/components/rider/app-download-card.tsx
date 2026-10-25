/**
 * Rider app download card (server component).
 *
 * Shows the ACTIVE stable release published at /platform/app-releases:
 * version, size, date, notes, SHA-256, a QR code to the counted download URL
 * (rendered server-side by the local qr-image helper — no external service),
 * a Play Store button when a store URL is set, and an iOS button only when an
 * iOS release exists (iOS is hidden entirely otherwise).
 *
 * Used on /rider-app, the /rider portal login + dashboard, and the "install the
 * rider app" help article.
 */
import { Download, ShieldCheck, Calendar, HardDrive, Store, Smartphone, AlertCircle } from 'lucide-react';
import { qrPngDataUrl } from '@/server/qr-image';
import { formatBytes, getRiderAppDownloadInfo, type RiderAppDownloadInfo } from '@/server/app-releases';
import { CopyTextButton } from './copy-text-button';
import { cn } from '@/lib/utils';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function absolute(p: string): string {
  return `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/+$/, '')}${p}`;
}

export async function AppDownloadCard({
  variant = 'full',
  className,
  info: given,
  id,
}: {
  variant?: 'full' | 'compact';
  className?: string;
  /** Pass pre-fetched info to avoid a second query on pages that already have it. */
  info?: RiderAppDownloadInfo;
  id?: string;
}) {
  const info = given ?? (await getRiderAppDownloadInfo());
  const a = info.android;
  const href = a ? a.downloadUrl : info.legacy?.url ?? null;
  const size = formatBytes(a ? a.fileSize : info.legacy?.fileSize);
  const qrTarget = a ? a.downloadUrl : info.legacy ? absolute(info.legacy.url) : null;
  const qr = qrTarget && variant === 'full' ? await qrPngDataUrl(qrTarget, 240) : null;
  const titleId = id ? `${id}-title` : undefined;

  return (
    <section id={id} aria-labelledby={titleId} className={cn('rounded-3xl border bg-card p-5 shadow-sm sm:p-6', className)}>
      <div className={cn('grid gap-6', qr && 'md:grid-cols-[1fr_auto] md:items-start')}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Download className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="display text-lg font-bold leading-tight sm:text-xl">
                Flavrly Rider app
              </h2>
              <p className="text-xs text-muted-foreground">{a ? <>Android · version {a.versionName}</> : 'Android app'}</p>
            </div>
          </div>

          {href ? (
            <>
              {(size || a) && (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  {size && <Meta icon={HardDrive} label="Size" value={size} />}
                  {a && <Meta icon={Calendar} label="Released" value={fmtDate(a.publishedAt)} />}
                  {a && <Meta icon={ShieldCheck} label="Build" value={`#${a.versionCode}`} />}
                </dl>
              )}

              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <a
                  href={href}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25 transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Download className="size-4" /> Download for Android{size ? ` · ${size}` : ''}
                </a>
                {a?.storeUrl && (
                  <a
                    href={a.storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 px-6 text-sm font-semibold transition-colors hover:bg-muted"
                  >
                    <Store className="size-4" /> Get it on Google Play
                  </a>
                )}
                {info.ios && (
                  <a
                    href={info.ios.storeUrl || info.ios.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 px-6 text-sm font-semibold transition-colors hover:bg-muted"
                  >
                    <Smartphone className="size-4" /> iPhone · v{info.ios.versionName}
                  </a>
                )}
              </div>

              {variant === 'full' && a?.releaseNotes && (
                <div className="mt-5 rounded-2xl bg-muted/50 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What&apos;s new</div>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{a.releaseNotes}</p>
                </div>
              )}

              {variant === 'full' && a?.sha256 && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SHA-256 checksum</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 max-w-full break-all rounded-lg bg-muted px-2 py-1 font-mono text-[11px] leading-relaxed">
                      {a.sha256}
                    </code>
                    <CopyTextButton text={a.sha256} label="Copy checksum" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional: compare this with the checksum of the downloaded file to be sure it&apos;s the genuine app.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                The app download is being updated right now. Please check back shortly, or ask Flavrly rider support on WhatsApp for the
                latest link.
              </p>
            </div>
          )}
        </div>

        {qr && (
          <div className="hidden text-center md:block">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scan to download</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code linking to the Flavrly Rider app download" width={176} height={176} className="mx-auto rounded-2xl border bg-white p-2" />
            <p className="mx-auto mt-2 max-w-[176px] text-[11px] text-muted-foreground">Point your Android phone&apos;s camera here.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof Download; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2">
      <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" /> {label}
      </dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}
