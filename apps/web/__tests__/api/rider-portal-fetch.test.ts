/** Rider portal client fetch helper: error copy + 401 → login redirect. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { riderApi, errorMessage, PortalApiError, SESSION_ENDED_URL } from '@/app/rider/_lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('errorMessage', () => {
  it('prefers machine code + message, then error, then calm 5xx copy', () => {
    expect(errorMessage(401, { error: 'session_expired', message: 'Please sign in again.' })).toBe('Please sign in again.');
    expect(errorMessage(400, { error: 'Amount too high' })).toBe('Amount too high');
    expect(errorMessage(502, '<html>bad gateway</html>')).toMatch(/briefly unavailable/);
    expect(errorMessage(415, 'Unsupported file type (jpg/png/webp/pdf only)')).toBe('Unsupported file type (jpg/png/webp/pdf only)');
  });
});

describe('riderApi', () => {
  it('sends same-origin credentials and JSON, returns parsed body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(riderApi('/api/rider/profile', { method: 'PATCH', body: { name: 'A' } })).resolves.toEqual({ ok: 1 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'A' }));
  });

  it('redirects to the login page on a 401 from a rider endpoint', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/rider/earnings', assign } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'session_expired' }), { status: 401 })));
    await expect(riderApi('/api/rider/earnings')).rejects.toBeInstanceOf(PortalApiError);
    expect(assign).toHaveBeenCalledWith(SESSION_ENDED_URL);
  });

  it('throws PortalApiError with server text on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Missing file', { status: 400 })));
    await expect(riderApi('/api/rider/kyc', { method: 'POST', form: new FormData() })).rejects.toMatchObject({ status: 400, message: 'Missing file' });
  });
});
