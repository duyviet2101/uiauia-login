import type { Browser } from 'playwright-core';
import type { LaunchOptions } from 'cloakbrowser';
import { launch } from 'cloakbrowser';
import { toProxyUrl } from './launch-args';
import type { ProxyConfig, ProxyTestResult } from './types';

type Launcher = (opts: LaunchOptions) => Promise<Browser>;

export class ProxyTester {
  constructor(private launcher: Launcher = launch) {}

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
      return { ok: true, ip, latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}
