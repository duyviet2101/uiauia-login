import type { Browser } from 'playwright-core';
import type { LaunchOptions } from 'cloakbrowser';
import { launch } from 'cloakbrowser';
import { toProxyUrl } from './launch-args';
import type { ProxyConfig, ProxyTestResult } from './types';

type Launcher = (opts: LaunchOptions) => Promise<Browser>;
type Fetcher = typeof fetch;

interface IpWhoResponse {
  success?: boolean;
  country?: string;
  city?: string;
  timezone?: { id?: string };
  connection?: { asn?: number; org?: string; isp?: string };
}

export class ProxyTester {
  constructor(
    private launcher: Launcher = launch,
    private fetcher: Fetcher = fetch,
  ) {}

  async test(proxy: ProxyConfig): Promise<ProxyTestResult> {
    const start = Date.now();
    let browser: Browser | undefined;
    try {
      browser = await this.launcher({ headless: true, proxy: toProxyUrl(proxy) });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('https://api.ipify.org?format=json', { timeout: 20000 });
      const body = await page.evaluate(() => document.body.innerText);
      await ctx.close();
      const ip = JSON.parse(body).ip as string;
      const meta = await this.lookupIp(ip);
      return {
        ok: true,
        ip,
        exitIp: ip,
        latencyMs: Date.now() - start,
        ...meta,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  private async lookupIp(ip: string): Promise<Partial<ProxyTestResult>> {
    try {
      const res = await this.fetcher(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return {};
      const data = (await res.json()) as IpWhoResponse;
      if (data.success === false) return {};
      return {
        country: data.country,
        city: data.city,
        timezone: data.timezone?.id,
        asn: data.connection?.asn != null ? String(data.connection.asn) : undefined,
        isp: data.connection?.isp ?? data.connection?.org,
      };
    } catch {
      return {};
    }
  }
}
