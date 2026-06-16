import { describe, it, expect, vi } from 'vitest';
import { ProxyTester } from '../src/main/proxy-tester';
import type { ProxyConfig } from '../src/main/types';

const proxy: ProxyConfig = { type: 'http', host: 'h', port: 80 };

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

describe('ProxyTester', () => {
  it('returns ok with ip parsed from response', async () => {
    const tester = new ProxyTester(fakeBrowser('{"ip":"9.9.9.9"}') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('9.9.9.9');
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
});
