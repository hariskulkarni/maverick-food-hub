/**
 * Server-side QR image generation.
 *
 * `qrcode` is a Node library, so we render QR codes on the server and hand the
 * client a ready-to-use PNG data URL (rendered in an <img> and reused as the
 * href of a download link). This keeps `qrcode` out of the client bundle.
 */
import 'server-only';
import QRCode from 'qrcode';

/**
 * Render `text` as a scannable QR code and return a base64 PNG data URL
 * (`data:image/png;base64,...`) suitable for <img src> and download links.
 */
export async function qrPngDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M'
  });
}

/** Canonical public base URL used to build scannable QR deep links. */
export const QR_PUBLIC_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in';

/** Build the customer-facing scan URL for a QR `code` (resolved by /qr/[code]). */
export function qrScanUrl(code: string): string {
  return `${QR_PUBLIC_BASE.replace(/\/$/, '')}/qr/${encodeURIComponent(code)}`;
}
