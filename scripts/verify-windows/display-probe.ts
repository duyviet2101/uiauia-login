/**
 * Window/display behaviour on the real machine (plan §14, "Hiển thị").
 *
 * launch-args.ts carries two claims that only real hardware can settle:
 *
 *  1. `--fingerprint-screen-*` MUST equal the real monitor, otherwise the
 *     binary's window-position patch fights fullscreen and FingerprintJS reads
 *     screen != viewport as "Virtual machine".
 *  2. `viewport: null` avoids Playwright's CDP device-metrics override, which
 *     re-applies on every new tab and can unmaximize/reposition a headed window.
 *
 * This measures both instead of trusting them: geometry is read before and
 * after opening a tab, entering and leaving fullscreen, and closing/reopening
 * the profile. Nothing is spoofed for the test — the same buildLaunchArgs() the
 * app uses is what launches here.
 *
 * Throwaway profile in $TMPDIR, no proxy, no network beyond about:blank.
 *
 *   npx tsx scripts/verify-windows/display-probe.ts [--width W --height H]
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { launchPersistentContext } from 'cloakbrowser';
import { buildLaunchArgs, type Display } from '../../src/main/launch-args';
import { prepareBrowserPreferences } from '../../src/main/browser-preferences';
import type { Profile } from '../../src/main/types';

interface Geometry {
  screenW: number; screenH: number; availW: number; availH: number;
  innerW: number; innerH: number; outerW: number; outerH: number;
  screenX: number; screenY: number; dpr: number; colorDepth: number;
  fullscreen: boolean;
}

const READ = `(() => ({
  screenW: screen.width, screenH: screen.height,
  availW: screen.availWidth, availH: screen.availHeight,
  innerW: innerWidth, innerH: innerHeight,
  outerW: outerWidth, outerH: outerHeight,
  screenX: screenX, screenY: screenY,
  dpr: devicePixelRatio, colorDepth: screen.colorDepth,
  fullscreen: !!document.fullscreenElement,
}))()`;

const read = (page: Page): Promise<Geometry> => page.evaluate(READ) as Promise<Geometry>;

/**
 * The size of what was ACTUALLY rendered, read from the PNG header of a
 * screenshot.
 *
 * This exists because JS-reported geometry and real geometry can disagree: the
 * patched binary may report frozen numbers. A screenshot is produced by the
 * compositor, not by `window.innerHeight`, so it settles which of the two moved.
 */
async function renderedSize(page: Page): Promise<{ w: number; h: number }> {
  const png = await page.screenshot({ type: 'png' });
  // PNG: 8-byte signature, then the IHDR chunk — width/height at bytes 16..24.
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

/** The main screen in logical points — the same units Electron's
 *  screen.getPrimaryDisplay().size reports, which is what the app passes in. */
function realDisplay(): Display {
  const out = execFileSync('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop'])
    .toString().trim();
  const [, , w, h] = out.split(',').map((n) => parseInt(n.trim(), 10));
  return { width: w, height: h };
}

function fakeProfile(userDataDir: string): Profile {
  return {
    id: 'display-probe', name: 'display-probe', seed: 4242042, platform: 'macos',
    geoip: false, timezone: null, locale: null, startUrl: null, proxy: null,
    userDataDir, baseline: null, lastObservation: null, lastObservationError: null,
    visitorId: null, diagnostics: null, identityLocked: false, resolvedIdentity: null,
    lastProxyCheck: null, blockGeolocation: true, doNotTrack: false,
    windowCustomization: { enabled: false, number: 1, color: '#2563EB' },
    createdAt: new Date().toISOString(), lastOpenedAt: null,
  };
}

function show(label: string, g: Geometry): void {
  console.log(
    `${label.padEnd(28)} screen ${g.screenW}x${g.screenH} avail ${g.availW}x${g.availH} `
    + `| inner ${g.innerW}x${g.innerH} outer ${g.outerW}x${g.outerH} @(${g.screenX},${g.screenY}) `
    + `| dpr ${g.dpr}${g.fullscreen ? ' | FULLSCREEN' : ''}`,
  );
}

function same(a: Geometry, b: Geometry, keys: (keyof Geometry)[]): boolean {
  return keys.every((k) => a[k] === b[k]);
}

const STOCK_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Same fullscreen sequence on an unpatched Chrome, so a behaviour can be
 * attributed to the automation context rather than to CloakBrowser. Returns
 * null when no stock Chrome is installed — in which case nothing is attributed.
 */
async function stockChromeFullscreen(): Promise<
  { before: number; after: number; beforePx: number; afterPx: number; grew: boolean } | null
> {
  if (!existsSync(STOCK_CHROME)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'fs-control-'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await chromium.launchPersistentContext(dir, {
      headless: false, viewport: null, executablePath: STOCK_CHROME, args: ['--start-maximized'],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('about:blank');
    await page.waitForTimeout(1500);
    const before = await page.evaluate('innerHeight') as number;
    const beforePx = (await page.screenshot({ type: 'png' })).readUInt32BE(20);
    await page.evaluate(`document.body.innerHTML='<button id="fs" style="position:fixed;inset:0;width:100%;height:100%">fs</button>';document.body.style.margin='0';`);
    await page.click('#fs');
    await page.evaluate('document.documentElement.requestFullscreen()');
    await page.waitForTimeout(2500);
    const after = await page.evaluate('innerHeight') as number;
    const afterPx = (await page.screenshot({ type: 'png' })).readUInt32BE(20);
    return { before, after, beforePx, afterPx, grew: after > before };
  } catch {
    return null;
  } finally {
    await ctx?.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

const problems: string[] = [];
function check(ok: boolean, label: string, detail: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) problems.push(`${label}: ${detail}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string): number | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : Number(argv[i + 1]);
  };
  const display: Display = arg('width') && arg('height')
    ? { width: arg('width')!, height: arg('height')! }
    : realDisplay();
  console.log(`real display (logical points): ${display.width}x${display.height}\n`);

  const userDataDir = mkdtempSync(join(tmpdir(), 'display-probe-'));
  const profile = fakeProfile(userDataDir);
  let ctx: BrowserContext | undefined;

  try {
    prepareBrowserPreferences(userDataDir, { blockGeolocation: true, doNotTrack: false });
    ctx = await launchPersistentContext(buildLaunchArgs(profile, display));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('about:blank');
    // Let the window settle after --start-maximized.
    await page.waitForTimeout(1500);

    const start = await read(page);
    const startPx = await renderedSize(page);
    show('1. after launch', start);
    console.log(`${''.padEnd(28)} rendered ${startPx.w}x${startPx.h} (from a screenshot)`);
    console.log('\n--- claim 1: spoofed screen equals the real monitor ---');
    check(start.screenW === display.width && start.screenH === display.height,
      'screen == real display',
      `browser says ${start.screenW}x${start.screenH}, macOS says ${display.width}x${display.height}`);
    check(start.availH <= start.screenH && start.availW <= start.screenW,
      'availSize fits inside screen', `avail ${start.availW}x${start.availH} vs screen ${start.screenW}x${start.screenH}`);
    check(start.innerW <= start.outerW && start.outerW <= start.screenW,
      'inner <= outer <= screen', `inner ${start.innerW}, outer ${start.outerW}, screen ${start.screenW}`);
    check(start.screenX >= 0 && start.screenY >= 0
      && start.screenX + start.outerW <= start.screenW + 1,
      'window sits on-screen', `at (${start.screenX},${start.screenY}) size ${start.outerW}x${start.outerH}`);
    // On this Retina Mac a devicePixelRatio of exactly 1 would contradict the
    // hardware; the exact value is hardware-dependent so it is reported, not asserted.
    check(start.dpr > 1, 'devicePixelRatio reflects a Retina panel', `dpr = ${start.dpr}`);

    console.log('\n--- claim 2: opening a tab does not move or resize the window ---');
    const tab = await ctx.newPage();
    await tab.goto('about:blank');
    await page.waitForTimeout(1200);
    const afterTab = await read(page);
    show('2. after opening a tab', afterTab);
    check(same(start, afterTab, ['outerW', 'outerH', 'screenX', 'screenY']),
      'window geometry unchanged by a new tab',
      `${start.outerW}x${start.outerH}@(${start.screenX},${start.screenY}) -> ${afterTab.outerW}x${afterTab.outerH}@(${afterTab.screenX},${afterTab.screenY})`);
    check(same(start, afterTab, ['screenW', 'screenH', 'dpr']),
      'screen/dpr unchanged by a new tab', 'a spoofed screen must not move when tabs change');
    await tab.close();
    await page.waitForTimeout(800);

    console.log('\n--- fullscreen enter / exit ---');
    // requestFullscreen needs user activation; a real click provides it.
    // The button is injected rather than set via setContent: on about:blank the
    // latter waits for a "load" that never fires again.
    await page.evaluate(`document.body.innerHTML =
      '<button id="fs" style="position:fixed;inset:0;width:100%;height:100%;font-size:24px">fullscreen</button>';
      document.body.style.margin = '0';`);
    await page.click('#fs');
    await page.evaluate('document.documentElement.requestFullscreen()');
    await page.waitForTimeout(2000);
    const full = await read(page);
    const fullPx = await renderedSize(page);
    show('3. fullscreen', full);
    console.log(`${''.padEnd(28)} rendered ${fullPx.w}x${fullPx.h} (from a screenshot)`);
    check(full.fullscreen, 'fullscreen actually engaged', 'document.fullscreenElement is null');
    check(same(start, full, ['screenW', 'screenH']),
      'screen constant in fullscreen', `${start.screenW}x${start.screenH} -> ${full.screenW}x${full.screenH}`);

    // Neither the reported viewport nor the rendered bitmap changes here. That
    // could mean the binary freezes geometry, or that the window simply never
    // entered OS fullscreen — so it is settled against a stock Chrome control
    // rather than attributed to CloakBrowser by assumption.
    const reportedGrew = full.innerH > start.innerH;
    const renderedGrew = fullPx.h > startPx.h;
    console.log(`  reported inner height ${start.innerH} -> ${full.innerH}`
      + ` | rendered ${startPx.h} -> ${fullPx.h}`);
    if (renderedGrew && !reportedGrew) {
      // Would mean the window really resized while JS was told otherwise: a
      // detectable contradiction. Not what was measured on 2026-09-11.
      check(false, 'reported geometry matches rendered geometry',
        `rendered grew to ${fullPx.h} while innerHeight stayed ${full.innerH}`);
    } else if (!reportedGrew) {
      const control = await stockChromeFullscreen();
      if (!control) {
        console.log('  SKIP  no stock Chrome to compare against; cannot attribute this.');
      } else if (!control.grew) {
        console.log(`  CONTROL  stock Chrome under the same automation does the same `
          + `(inner ${control.before} -> ${control.after}, rendered ${control.beforePx} -> ${control.afterPx}).`);
        console.log('  NOTE  not a CloakBrowser behaviour: a headed Chromium driven over CDP');
        console.log('        does not take the macOS fullscreen transition, so the viewport');
        console.log('        never grows. Hand-driven fullscreen is NOT covered by this run.');
      } else {
        check(false, 'fullscreen resizes the viewport as stock Chrome does',
          `stock Chrome grew ${control.before} -> ${control.after}, this build stayed at ${full.innerH}`);
      }
    }

    await page.evaluate('document.exitFullscreen()');
    await page.waitForTimeout(2000);
    const restored = await read(page);
    show('4. after exiting fullscreen', restored);
    check(!restored.fullscreen, 'fullscreen released', 'still fullscreen');
    check(same(start, restored, ['outerW', 'outerH']),
      'window size returns after fullscreen',
      `${start.outerW}x${start.outerH} -> ${restored.outerW}x${restored.outerH}`);

    console.log('\n--- close and reopen ---');
    await ctx.close();
    ctx = undefined;
    const returning: Profile = { ...profile, lastOpenedAt: new Date().toISOString() };
    prepareBrowserPreferences(userDataDir, { blockGeolocation: true, doNotTrack: false });
    ctx = await launchPersistentContext(buildLaunchArgs(returning, display));
    const page2 = ctx.pages()[0] ?? (await ctx.newPage());
    await page2.waitForTimeout(2000);
    const reopened = await read(page2);
    show('5. after reopen', reopened);
    check(same(start, reopened, ['screenW', 'screenH', 'dpr', 'colorDepth']),
      'screen/dpr identical across a restart',
      'a screen that moves between sessions is itself a fingerprint change');
    check(reopened.screenX >= 0 && reopened.screenY >= 0,
      'reopened window is on-screen', `at (${reopened.screenX},${reopened.screenY})`);

    console.log(`\n=== ${problems.length === 0 ? 'ALL CHECKS PASSED' : `${problems.length} PROBLEM(S)`} ===`);
    for (const p of problems) console.log(`  - ${p}`);
  } finally {
    await ctx?.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
