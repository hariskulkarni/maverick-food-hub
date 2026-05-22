import { ImageResponse } from 'next/og';
import { brand } from '@/lib/brand';

// Default branded Open Graph image for the whole site (1200x630).
export const runtime = 'edge';
export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          // Coral → magenta gradient.
          background: 'linear-gradient(135deg, #f23e5c 0%, #b81d6e 100%)',
          fontFamily: 'sans-serif',
          color: '#ffffff'
        }}
      >
        <div
          style={{
            fontSize: 140,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex'
          }}
        >
          {brand.name}
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 44,
            fontWeight: 500,
            color: '#ffe4ea',
            display: 'flex'
          }}
        >
          {brand.tagline}
        </div>
        <div
          style={{
            marginTop: 48,
            fontSize: 28,
            fontWeight: 600,
            color: '#c7f250',
            display: 'flex'
          }}
        >
          flavrly.in · Guntur, Andhra Pradesh
        </div>
      </div>
    ),
    { ...size }
  );
}
