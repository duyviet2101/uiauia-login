import { describe, it, expect, vi } from 'vitest';
import { ProxyTester } from '../src/main/proxy-tester';
import type { ProxyConfig } from '../src/main/types';

const proxy: ProxyConfig = { type: 'http', host: 'h', port: 80 };
const fakeFetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({
    success: true,
    country: 'United States',
    city: 'New York',
    timezone: { id: 'America/New_York' },
    connection: { asn: 123, isp: 'ISP' },
  }),
})) as any;

function fakeBrowser(body: string, throwOn?: 'launch' | 'goto') {
  const page = {
    goto: vi.fn(async () => { if (throwOn === 'goto') throw new Error('timeout'); }),
    evaluate: vi.fn(async () => body),
  };
  const ctx = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  const browser = { newContext: vi.fn(async () => ctx), close: vi.fn(async () => {}) };
  return vi.fn(async () => {
    if (throwOn === 'launch') throw new Error('bad proxy');
    return browser;
  });
}

/** Page that answers the IPv4 echo for api.ipify.org and the IPv6 echo for
 *  api6.ipify.org, so the best-effort IPv6 probe can be exercised. */
function fakeBrowserWithIpv6(v4: string, v6: { body?: string; fail?: boolean }) {
  let lastUrl = '';
  const page = {
    goto: vi.fn(async (url: string) => {
      lastUrl = url;
      if (url.includes('api6.ipify.org') && v6.fail) throw new Error('no ipv6 route');
    }),
    evaluate: vi.fn(async () => (lastUrl.includes('api6.ipify.org') ? (v6.body ?? '') : v4)),
  };
  const ctx = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  const browser = { newContext: vi.fn(async () => ctx), close: vi.fn(async () => {}) };
  return vi.fn(async () => browser);
}

describe('ProxyTester', () => {
  it('returns ok with ip parsed from response', async () => {
    const tester = new ProxyTester(fakeBrowser('{"ip":"9.9.9.9"}') as any, fakeFetch);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('9.9.9.9');
    expect(r.exitIp).toBe('9.9.9.9');
    expect(r.timezone).toBe('America/New_York');
    expect(r.asn).toBe('123');
    expect(typeof r.latencyMs).toBe('number');
  });

  it('returns error when launch fails', async () => {
    const tester = new ProxyTester(fakeBrowser('', 'launch') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bad proxy');
  });

  it('returns error when goto fails', async () => {
    const tester = new ProxyTester(fakeBrowser('', 'goto') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('timeout');
  });

  it('reports ipv6 when an IPv6 echo is reachable through the proxy', async () => {
    const tester = new ProxyTester(
      fakeBrowserWithIpv6('{"ip":"9.9.9.9"}', { body: '{"ip":"2001:db8::1"}' }) as any,
      fakeFetch,
    );
    const r = await tester.test(proxy);
    expect(r.ok).toBe(true);
    expect(r.exitIp).toBe('9.9.9.9');
    expect(r.ipv6).toBe('2001:db8::1');
  });

  it('leaves ipv6 undefined when the IPv6 echo is not reachable', async () => {
    const tester = new ProxyTester(
      fakeBrowserWithIpv6('{"ip":"9.9.9.9"}', { fail: true }) as any,
      fakeFetch,
    );
    const r = await tester.test(proxy);
    expect(r.ok).toBe(true);
    expect(r.exitIp).toBe('9.9.9.9');
    expect(r.ipv6).toBeUndefined();
  });
});
