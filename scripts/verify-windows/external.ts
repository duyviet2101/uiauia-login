import type { BrowserContext, Page } from 'playwright-core';
import type { ExternalSiteResult } from './types';
import { defineNameShim } from './probe';

type Headline = Record<string, string | number | null>;

interface SiteSpec {
  site: string;
  url: string;
  /** Seconds to let the detector finish computing before scraping its text. */
  settleSec: number;
  scrape: (text: string) => Headline;
}

const firstMatch = (text: string, re: RegExp): string | null => {
  const m = text.match(re);
  return m ? (m[1] ?? m[0]).trim() : null;
};

// Patterns are deliberately strict/anchored so they cannot match a site's legend
// or FAQ text (e.g. iphey lists "Suspicious" as a label, pixelscan has a "Does
// Pixelscan work…" FAQ). A null headline is reported honestly as n/a; the open
// window is the source of truth for a human on the box.
const SITES: SiteSpec[] = [
  {
    site: 'creepjs',
    url: 'https://abrahamjuliot.github.io/creepjs/',
    settleSec: 16,
    scrape: (t) => ({
      // The 64-hex FP id is the reliable signal: it MUST differ across profiles.
      fingerprint: firstMatch(t, /\b[0-9a-f]{64}\b/i),
      trustScore: firstMatch(t, /trust score[^0-9]*([\d.]+\s*%)/i),
      lies: firstMatch(t, /(\d+)\s+lies\b/i),
    }),
  },
  {
    site: 'iphey',
    url: 'https://iphey.com/',
    settleSec: 9,
    // Only the actual verdict sentence ("You're trustworthy/suspicious"), never
    // the standalone legend labels.
    scrape: (t) => ({
      verdict: firstMatch(t, /you['’`]?re\s+(trustworthy|suspicious|not reliable)/i),
    }),
  },
  {
    site: 'pixelscan',
    url: 'https://pixelscan.net/',
    settleSec: 14,
    scrape: (t) => ({
      consistency: firstMatch(t, /your\s+consistency[^0-9]*([\d]+\s*%)/i),
      automation: firstMatch(t, /automation\s+framework\s+(not\s+detected|detected)/i),
    }),
  },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Open each external detector in its own tab in the profile window for human
 * reading on the real box, and scrape the easy headline numbers where the DOM
 * allows. Strictly best-effort: any failure is recorded as `unavailable` and
 * never throws, so it can never abort a verification run. Tabs are left open.
 */
export async function runExternal(ctx: BrowserContext): Promise<ExternalSiteResult[]> {
  const results: ExternalSiteResult[] = [];
  for (const spec of SITES) {
    let page: Page | undefined;
    try {
      page = await ctx.newPage();
      await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(spec.settleSec * 1000);
      await defineNameShim(page);
      const text = await page.evaluate(() => document.body?.innerText ?? '');
      results.push({ site: spec.site, url: spec.url, status: 'ok', headline: spec.scrape(text) });
    } catch (error) {
      results.push({
        site: spec.site,
        url: spec.url,
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
