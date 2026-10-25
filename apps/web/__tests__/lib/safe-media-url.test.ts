import { describe, it, expect } from 'vitest';
import { safeBlobUrl, safeMediaUrl } from '@/lib/safe-media-url';

describe('safeMediaUrl', () => {
  it('accepts relative, https, blob and data:image URLs unchanged', () => {
    for (const u of [
      '/uploads/menu/abc.webp',
      'https://images.unsplash.com/photo-1?w=500&auto=format&fit=crop&q=80',
      'blob:https://flavrly.in/4f1c2a8e-1111-2222-3333-444455556666',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(safeMediaUrl(u)).toBe(u);
    }
  });

  it('rejects script-capable, protocol-relative, plain-http and malformed values', () => {
    for (const u of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg onload=alert(1)>',
      '//evil.example/x.png',
      '/\\evil.example/x.png',
      'http://cdn.example/x.png',
      'https://x.example/a"onerror="alert(1)',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(safeMediaUrl(u as string | null | undefined)).toBeNull();
    }
  });
});

describe('safeBlobUrl', () => {
  it('accepts only object URLs', () => {
    const u = 'blob:http://localhost:3000/4f1c2a8e-1111-2222-3333-444455556666';
    expect(safeBlobUrl(u)).toBe(u);
    expect(safeBlobUrl('https://flavrly.in/x.png')).toBeNull();
    expect(safeBlobUrl('javascript:alert(1)')).toBeNull();
    expect(safeBlobUrl('blob:x"<img>')).toBeNull();
    expect(safeBlobUrl(null)).toBeNull();
  });
});
