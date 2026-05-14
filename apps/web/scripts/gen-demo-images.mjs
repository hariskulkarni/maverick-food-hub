/**
 * One-off generator for demo imagery used by the rider app:
 *   - 5 mock KYC document cards (Aadhaar / Driving Licence / Vehicle RC /
 *     Vehicle Insurance / PAN) — clearly watermarked SPECIMEN, no real data.
 *   - 8 rider avatar tiles — flat person silhouette on a brand-ish palette.
 *
 * Renders SVG → PNG with `sharp` and writes into apps/web/public/demo/.
 * These are demo assets, committed to the repo so the seed can point at them.
 * Run from apps/web:  node scripts/gen-demo-images.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_PUBLIC = join(__dirname, '..', 'public', 'demo');
const KYC_DIR = join(WEB_PUBLIC, 'kyc');
const AVATAR_DIR = join(WEB_PUBLIC, 'avatars');
mkdirSync(KYC_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── KYC document card ───────────────────────────────────────────────────────
function kycCard({ band, accent, org, title, fields, number, numberLabel }) {
  const W = 1000, H = 640;
  const fieldRows = fields
    .map(
      (f, i) => `
        <text x="430" y="${250 + i * 64}" font-family="Arial, sans-serif" font-size="20" fill="#6b6b6b" letter-spacing="0.5">${esc(f.label)}</text>
        <text x="430" y="${280 + i * 64}" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#1f1b16">${esc(f.value)}</text>`
    )
    .join('');
  let marks = '';
  for (let y = 80; y < H; y += 150) {
    for (let x = -100; x < W; x += 360) {
      marks += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="${accent}" fill-opacity="0.07" transform="rotate(-22 ${x} ${y})">DEMO &#8226; SPECIMEN</text>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" rx="28" fill="#ffffff"/>
    <rect width="${W}" height="${H}" rx="28" fill="none" stroke="#e4ddcd" stroke-width="2"/>
    <rect width="${W}" height="96" rx="28" fill="${band}"/>
    <rect y="60" width="${W}" height="40" fill="${band}"/>
    <text x="40" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="2">${esc(org)}</text>
    <text x="40" y="78" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="#ffffff" letter-spacing="1">${esc(title)}</text>
    ${marks}
    <rect x="40" y="150" width="330" height="400" rx="16" fill="#f5f1e8" stroke="#e4ddcd" stroke-width="2"/>
    <circle cx="205" cy="300" r="78" fill="#d9cfb8"/>
    <path d="M205 250 a40 40 0 1 1 -0.1 0 z" fill="#b8a988"/>
    <path d="M120 460 q85 -120 170 0 z" fill="#b8a988"/>
    <text x="205" y="525" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#9a8f76">PHOTOGRAPH</text>
    ${fieldRows}
    <rect x="40" y="568" width="920" height="48" rx="10" fill="${accent}" fill-opacity="0.10"/>
    <text x="58" y="599" font-family="Arial, sans-serif" font-size="20" fill="#6b6b6b">${esc(numberLabel)}</text>
    <text x="${W - 58}" y="600" text-anchor="end" font-family="Courier New, monospace" font-size="30" font-weight="700" fill="${accent}" letter-spacing="3">${esc(number)}</text>
  </svg>`;
  return Buffer.from(svg);
}

const KYC = [
  {
    file: 'aadhaar.png', band: '#1f4e8c', accent: '#1f4e8c',
    org: 'GOVERNMENT OF INDIA', title: 'AADHAAR',
    fields: [
      { label: 'Name', value: 'Oak & Sizzler Rider' },
      { label: 'Date of Birth', value: '14 / 08 / 1996' },
      { label: 'Gender', value: 'MALE' },
      { label: 'Address', value: 'Bengaluru, Karnataka' },
    ],
    number: 'XXXX XXXX 4729', numberLabel: 'Aadhaar Number',
  },
  {
    file: 'driving-license.png', band: '#0d6b53', accent: '#0d6b53',
    org: 'UNION OF INDIA', title: 'DRIVING LICENCE',
    fields: [
      { label: 'Holder Name', value: 'Oak & Sizzler Rider' },
      { label: 'Date of Birth', value: '14 / 08 / 1996' },
      { label: 'Valid Till', value: '13 / 08 / 2039' },
      { label: 'Vehicle Class', value: 'MCWG / LMV' },
    ],
    number: 'KA01 2019 0036271', numberLabel: 'DL Number',
  },
  {
    file: 'vehicle-rc.png', band: '#8c5a1f', accent: '#8c5a1f',
    org: 'TRANSPORT DEPARTMENT / KARNATAKA', title: 'CERTIFICATE OF REGISTRATION',
    fields: [
      { label: 'Registered Owner', value: 'Oak & Sizzler Rider' },
      { label: 'Vehicle Class', value: 'Motorcycle (2WN)' },
      { label: 'Maker / Model', value: 'Honda / Activa 6G' },
      { label: 'Fuel Type', value: 'PETROL' },
    ],
    number: 'KA-01-AB-1234', numberLabel: 'Registration No.',
  },
  {
    file: 'vehicle-insurance.png', band: '#6b2f8c', accent: '#6b2f8c',
    org: 'CERTIFICATE OF INSURANCE', title: 'TWO-WHEELER POLICY',
    fields: [
      { label: 'Insured Name', value: 'Oak & Sizzler Rider' },
      { label: 'Vehicle No.', value: 'KA-01-AB-1234' },
      { label: 'Valid Till', value: '31 / 03 / 2027' },
      { label: 'IDV', value: 'Rs. 62,400' },
    ],
    number: 'POL/2026/KA/0098431', numberLabel: 'Policy Number',
  },
  {
    file: 'pan-card.png', band: '#b23b2e', accent: '#b23b2e',
    org: 'INCOME TAX DEPARTMENT / GOVT OF INDIA', title: 'PERMANENT ACCOUNT NUMBER',
    fields: [
      { label: 'Name', value: 'Oak & Sizzler Rider' },
      { label: "Father's Name", value: 'Rider Senior' },
      { label: 'Date of Birth', value: '14 / 08 / 1996' },
      { label: 'Issued', value: '2021' },
    ],
    number: 'ABCPR4729K', numberLabel: 'PAN',
  },
];

// ─── Avatar tile ─────────────────────────────────────────────────────────────
function avatar({ bg, ring, fig }) {
  const S = 480;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${bg}"/>
        <stop offset="1" stop-color="${ring}"/>
      </linearGradient>
    </defs>
    <rect width="${S}" height="${S}" fill="url(#g)"/>
    <circle cx="240" cy="200" r="92" fill="${fig}"/>
    <path d="M88 460 q152 -210 304 0 z" fill="${fig}"/>
  </svg>`;
  return Buffer.from(svg);
}

const AV_PALETTES = [
  { bg: '#fdede4', ring: '#f6cdb4', fig: '#ea5b1f' },
  { bg: '#e8f1e8', ring: '#bcd9bc', fig: '#3f7d3f' },
  { bg: '#e6eef7', ring: '#b9cfe6', fig: '#1f4e8c' },
  { bg: '#f3e8f1', ring: '#d8bcd2', fig: '#6b2f8c' },
  { bg: '#fdf4e3', ring: '#f0d9a8', fig: '#d98a1f' },
  { bg: '#fbeae8', ring: '#f0c0ba', fig: '#b23b2e' },
  { bg: '#e6f1f1', ring: '#b6d6d6', fig: '#137a73' },
  { bg: '#eceaf6', ring: '#c8c2e4', fig: '#4b3f9e' },
];

const main = async () => {
  for (const k of KYC) {
    await sharp(kycCard(k)).png().toFile(join(KYC_DIR, k.file));
    console.log('  kyc/' + k.file);
  }
  for (let i = 0; i < AV_PALETTES.length; i++) {
    await sharp(avatar(AV_PALETTES[i])).png().toFile(join(AVATAR_DIR, `avatar-${i + 1}.png`));
    console.log('  avatars/avatar-' + (i + 1) + '.png');
  }
  console.log('Done.');
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
