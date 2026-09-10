/**
 * Measures WHEN Chromium's session restore actually contacts the network.
 *
 * The preflight design (docs/macos-isolation/implementation-plan.md §15) rests
 * on one claim: `--restore-last-session` replays the profile's previous tabs by
 * itself, the moment the context opens, with no point at which the app can
 * intervene. That claim decides whether gating before `launchPersistentContext`
 * is sufficient — so it is measured here rather than assumed.
 *
 * Method: a local HTTP server stands in for "the website". A throwaway profile
 * visits it, is closed cleanly, then reopened with the real launch args and NO
 * navigation of our own. Every hit is timestamped relative to the moment
 * `launchPersistentContext` resolves.
 *
 * Only 127.0.0.1 is contacted; no real site, no real profile, no proxy.
 *
 *   npx tsx scripts/verify-windows/session-restore-probe.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launchPersistentContext } from 'cloakbrowser';
import { buildLaunchArgs } from '../../src/main/launch-args';
import { prepareBrowserPreferences } from '../../src/main/browser-preferences';
import type { Profile } from '../../src/main/types';

interface Hit { path: string; atMs: number }

function fakeProfile(userDataDir: string): Profile {
  return {
    id: 'restore-probe', name: 'restore-probe', seed: 4242042, platform: 'macos',
    geoip: false, timezone: null, locale: null, startUrl: null, proxy: null,
    userDataDir, baseline: null, lastObservation: null, lastObservationError: null, visitorId: null, diagnostics: null,
    identityLocked: false, resolvedIdentity: null, lastProxyCheck: null,
    blockGeolocation: true, doNotTrack: false,
    windowCustomization: { enabled: false, number: 1, color: '#2563EB' },
    createdAt: new Date().toISOString(), lastOpenedAt: null,
  };
}

async function main(): Promise<void> {
  const hits: Hit[] = [];
  let originMs = Date.now();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push({ path: req.url ?? '/', atMs: Date.now() - originMs });
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end('<title>restore-probe</title><h1>restore-probe</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const target = `http://127.0.0.1:${port}/session-page`;
  console.log(`local stand-in site: ${target}`);

  const userDataDir = mkdtempSync(join(tmpdir(), 'restore-probe-'));
  const profile = fakeProfile(userDataDir);

  try {
    // --- Pass 1: create a session to restore ------------------------------
    prepareBrowserPreferences(userDataDir, { blockGeolocation: true, doNotTrack: false });
    const first = await launchPersistentContext(buildLaunchArgs(profile));
    const page = first.pages()[0] ?? (await first.newPage());
    await page.goto(target, { waitUntil: 'load' });
    // A clean close is what makes Chromium mark the session as restorable.
    await first.close();
    console.log(`pass 1: visited the page, ${hits.length} hit(s), closed cleanly`);

    // --- Pass 2: reopen and touch nothing ---------------------------------
    hits.length = 0;
    const returning: Profile = { ...profile, lastOpenedAt: new Date().toISOString() };
    prepareBrowserPreferences(userDataDir, { blockGeolocation: true, doNotTrack: false });
    originMs = Date.now();
    const second = await launchPersistentContext(buildLaunchArgs(returning));
    const launchResolvedMs = Date.now() - originMs;
    console.log(`pass 2: launchPersistentContext resolved at +${launchResolvedMs}ms`);

    // Watch for 8s. We navigate nothing; anything that arrives is the restore.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const urls = second.pages().map((p) => p.url());
    await second.close();

    console.log('\n--- result ---');
    console.log(`pages after reopen: ${JSON.stringify(urls)}`);
    if (hits.length === 0) {
      console.log('NO request arrived: this build did not replay the session over the network.');
    } else {
      for (const h of hits) {
        const delta = h.atMs - launchResolvedMs;
        const rel = delta >= 0 ? `+${delta}ms AFTER` : `${-delta}ms BEFORE`;
        console.log(`hit ${h.path} at +${h.atMs}ms (${rel} launchPersistentContext resolved)`);
      }
      console.log(
        '\nThe request was issued by Chromium itself, without the app navigating.\n'
        + 'Therefore the only place a check can stop it is BEFORE launchPersistentContext\n'
        + '(BrowserManager.preflight) — a check after the launch cannot prevent it.',
      );
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
