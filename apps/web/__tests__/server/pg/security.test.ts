import { describe, it, expect } from 'vitest';
import { classifyAddress, validateGatewayBaseUrl, type GatewayUrlEnv } from '@/server/pg/security';

const PROD: GatewayUrlEnv = { NODE_ENV: 'production' };
const PROD_LOOPBACK: GatewayUrlEnv = { NODE_ENV: 'production', FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY: 'true' };
const DEV_PRIVATE: GatewayUrlEnv = { NODE_ENV: 'development', FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY: 'true' };
const publicDns = async () => ['93.184.215.14'];
const noDns = async () => {
  throw new Error('resolver must not be called');
};

describe('classifyAddress', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['169.254.169.254', 'forbidden'],
    ['0.0.0.0', 'forbidden'],
    ['224.0.0.1', 'forbidden'],
    ['::1', 'loopback'],
    ['::', 'forbidden'],
    ['fe80::1', 'forbidden'],
    ['fd00::1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'forbidden'],
    ['::ffff:10.0.0.1', 'private'],
    ['64:ff9b::a9fe:a9fe', 'forbidden'],
    ['64:ff9b:1::1', 'private'],
    ['2606:4700::1111', 'public'],
    ['not-an-ip', 'forbidden'],
  ])('%s -> %s', (ip, cls) => {
    expect(classifyAddress(ip)).toBe(cls);
  });
});

describe('validateGatewayBaseUrl', () => {
  it('accepts a public https host and normalises trailing slashes', async () => {
    const r = await validateGatewayBaseUrl('https://pg.example.com/base///', PROD, publicDns);
    expect(r).toEqual({ ok: true, url: 'https://pg.example.com/base' });
  });

  it('rejects http to a public host in production', async () => {
    const r = await validateGatewayBaseUrl('http://pg.example.com', PROD, publicDns);
    expect(r.ok).toBe(false);
  });

  it('allows http to a public host outside production', async () => {
    const r = await validateGatewayBaseUrl('http://pg.example.com', { NODE_ENV: 'development' }, publicDns);
    expect(r.ok).toBe(true);
  });

  it.each(['ftp://pg.example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])('rejects %s', async (u) => {
    expect((await validateGatewayBaseUrl(u, PROD, publicDns)).ok).toBe(false);
  });

  it('rejects credentials in the URL and never echoes them', async () => {
    const r = await validateGatewayBaseUrl('https://admin:hunter2pass@pg.example.com', PROD, publicDns);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('hunter2pass');
  });

  it('rejects query strings and fragments', async () => {
    expect((await validateGatewayBaseUrl('https://pg.example.com/?next=x', PROD, publicDns)).ok).toBe(false);
    expect((await validateGatewayBaseUrl('https://pg.example.com/#x', PROD, publicDns)).ok).toBe(false);
  });

  it('documented loopback deploy (http://127.0.0.1:6100) needs the explicit loopback flag', async () => {
    expect((await validateGatewayBaseUrl('http://127.0.0.1:6100', PROD, noDns)).ok).toBe(false);
    expect(await validateGatewayBaseUrl('http://127.0.0.1:6100/', PROD_LOOPBACK, noDns)).toEqual({ ok: true, url: 'http://127.0.0.1:6100' });
    expect((await validateGatewayBaseUrl('http://localhost:6100', PROD_LOOPBACK, noDns)).ok).toBe(true);
    expect((await validateGatewayBaseUrl('http://[::1]:6100', PROD_LOOPBACK, noDns)).ok).toBe(true);
  });

  it('loopback flag does not open private or link-local ranges', async () => {
    for (const u of ['http://10.0.0.5', 'http://192.168.0.10', 'http://169.254.169.254/latest/meta-data', 'https://[fe80::1]']) {
      expect((await validateGatewayBaseUrl(u, PROD_LOOPBACK, noDns)).ok, u).toBe(false);
    }
  });

  it('URL-parser numeric tricks still resolve to loopback and are blocked', async () => {
    for (const u of ['http://2130706433', 'http://127.1', 'http://0x7f.0.0.1', 'http://[::ffff:127.0.0.1]']) {
      expect((await validateGatewayBaseUrl(u, PROD, noDns)).ok, u).toBe(false);
    }
  });

  it('private ranges only with the dev flag and never in production', async () => {
    expect((await validateGatewayBaseUrl('http://10.0.0.5:6100', DEV_PRIVATE, noDns)).ok).toBe(true);
    expect((await validateGatewayBaseUrl('http://10.0.0.5:6100', { NODE_ENV: 'development' }, noDns)).ok).toBe(false);
    expect(
      (await validateGatewayBaseUrl('https://10.0.0.5', { NODE_ENV: 'production', FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY: 'true' }, noDns)).ok,
    ).toBe(false);
  });

  it('link-local / metadata is rejected even with every flag set', async () => {
    const all: GatewayUrlEnv = { NODE_ENV: 'development', FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY: 'true', FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY: 'true' };
    expect((await validateGatewayBaseUrl('http://169.254.169.254', all, noDns)).ok).toBe(false);
  });

  it('DNS names: every resolved address must pass', async () => {
    expect((await validateGatewayBaseUrl('https://pg.example.com', PROD, async () => ['93.184.215.14', '10.0.0.1'])).ok).toBe(false);
    expect((await validateGatewayBaseUrl('https://rebind.example', PROD, async () => ['169.254.169.254'])).ok).toBe(false);
    expect((await validateGatewayBaseUrl('https://pg.example.com', PROD, async () => [])).ok).toBe(false);
    const nx = async () => {
      throw new Error('ENOTFOUND');
    };
    expect((await validateGatewayBaseUrl('https://nx.example', PROD, nx)).ok).toBe(false);
  });
});
