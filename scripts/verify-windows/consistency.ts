import type { ProfileObservation, RuleResult, UaBrand } from './types';

/**
 * Per-profile plausibility checks. Each rule asks: does this profile look like
 * ONE coherent real Windows PC, with no contradiction a fingerprinter's
 * lie-detection would flag? pass / warn / fail + a human message.
 *
 * Pure function — unit-tested with a clean fixture (all pass) and a
 * deliberately-broken one (forced SwiftShader / Windows UA + MacIntel platform).
 */
export function consistency(o: ProfileObservation): RuleResult[] {
  return [
    platformCoherence(o),
    webglRenderer(o),
    screenGeViewport(o),
    webdriverFalse(o),
    canvasReal(o),
    audioPresent(o),
    coresRange(o),
    deviceMemory(o),
    uaChVersionMatch(o),
    timezoneOffset(o),
  ];
}

const pass = (rule: string, message: string): RuleResult => ({ rule, status: 'pass', message });
const warn = (rule: string, message: string): RuleResult => ({ rule, status: 'warn', message });
const fail = (rule: string, message: string): RuleResult => ({ rule, status: 'fail', message });

// --- 1. UA token ↔ navigator.platform ↔ UA-CH platform all "Windows" ----------

function platformCoherence(o: ProfileObservation): RuleResult {
  const rule = 'platform-coherence';
  const signals: { name: string; isWindows: boolean }[] = [
    { name: `UA "${shortUa(o.userAgent)}"`, isWindows: /Windows NT/i.test(o.userAgent) },
    { name: `navigator.platform "${o.platform}"`, isWindows: /^Win/i.test(o.platform) },
  ];
  const chPlatform = o.uaClientHints?.platform;
  if (chPlatform) signals.push({ name: `UA-CH platform "${chPlatform}"`, isWindows: chPlatform === 'Windows' });

  const offenders = signals.filter((s) => !s.isWindows).map((s) => s.name);
  if (offenders.length === signals.length) {
    return fail(rule, `No signal reports Windows (${offenders.join('; ')}).`);
  }
  if (offenders.length > 0) {
    return fail(rule, `Platform signals disagree — non-Windows: ${offenders.join('; ')}.`);
  }
  return pass(rule, 'UA, navigator.platform and UA-CH all report Windows.');
}

// --- 2. WebGL renderer is a plausible Windows GPU -----------------------------

const BAD_RENDERER = ['swiftshader', 'llvmpipe', 'apple', 'software', 'microsoft basic render', 'mesa'];

function webglRenderer(o: ProfileObservation): RuleResult {
  const rule = 'webgl-renderer';
  const r = (o.webglRenderer ?? '').trim();
  if (!r) return fail(rule, 'WebGL renderer is blank/unavailable (a tell on a real GPU machine).');
  const lower = r.toLowerCase();
  const hit = BAD_RENDERER.find((bad) => lower.includes(bad));
  if (hit) return fail(rule, `WebGL renderer "${r}" looks non-Windows / software (matched "${hit}").`);
  return pass(rule, `WebGL renderer "${r}" is a plausible Windows GPU.`);
}

// --- 3. screen >= viewport ----------------------------------------------------

function screenGeViewport(o: ProfileObservation): RuleResult {
  const rule = 'screen-ge-viewport';
  if (o.innerWidth <= 0 || o.innerHeight <= 0) {
    return warn(rule, 'Viewport not measured (inner size 0); cannot compare to screen.');
  }
  if (o.screen.width < o.innerWidth || o.screen.height < o.innerHeight) {
    return fail(rule, `screen ${o.screen.width}x${o.screen.height} is smaller than viewport ${o.innerWidth}x${o.innerHeight}.`);
  }
  return pass(rule, `screen ${o.screen.width}x${o.screen.height} ≥ viewport ${o.innerWidth}x${o.innerHeight}.`);
}

// --- 4. navigator.webdriver === false -----------------------------------------

function webdriverFalse(o: ProfileObservation): RuleResult {
  const rule = 'webdriver-false';
  return o.webdriver
    ? fail(rule, 'navigator.webdriver is true (automation tell).')
    : pass(rule, 'navigator.webdriver is false.');
}

// --- 5. canvas hash is a real value -------------------------------------------

function canvasReal(o: ProfileObservation): RuleResult {
  const rule = 'canvas-real';
  if (!o.canvasHash || ['no-canvas', 'canvas-error'].includes(o.canvasHash)) {
    return fail(rule, `canvas hash is not a real value ("${o.canvasHash}").`);
  }
  return pass(rule, `canvas hash is a real value (${o.canvasHash}).`);
}

// --- 6. audio hash is non-null ------------------------------------------------

function audioPresent(o: ProfileObservation): RuleResult {
  const rule = 'audio-present';
  return o.audioHash
    ? pass(rule, `audio hash present (${o.audioHash}).`)
    : fail(rule, 'audio hash is null — a missing audio fingerprint on Windows is itself a tell.');
}

// --- 7a. hardwareConcurrency in [2, 32] ---------------------------------------

function coresRange(o: ProfileObservation): RuleResult {
  const rule = 'cores-range';
  const n = o.hardwareConcurrency;
  return n >= 2 && n <= 32
    ? pass(rule, `hardwareConcurrency ${n} ∈ [2, 32].`)
    : fail(rule, `hardwareConcurrency ${n} is outside the plausible [2, 32] range.`);
}

// --- 7b. deviceMemory in {2, 4, 8} --------------------------------------------

function deviceMemory(o: ProfileObservation): RuleResult {
  const rule = 'device-memory';
  if (o.deviceMemory == null) return warn(rule, 'deviceMemory not exposed by navigator.');
  return [2, 4, 8].includes(o.deviceMemory)
    ? pass(rule, `deviceMemory ${o.deviceMemory} ∈ {2, 4, 8}.`)
    : fail(rule, `deviceMemory ${o.deviceMemory} is not a realistic capped value (expected 2, 4 or 8).`);
}

// --- 8. UA-CH Chromium brand version matches the UA Chrome major --------------

function isRealChromiumBrand(b: UaBrand): boolean {
  const brand = b.brand.toLowerCase();
  if (brand.includes('not')) return false; // GREASE "Not(A:Brand"
  return brand.includes('chromium') || brand.includes('google chrome');
}

function majorOf(version: string): number | null {
  const m = version.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function uaChVersionMatch(o: ProfileObservation): RuleResult {
  const rule = 'ua-ch-version-match';
  const ua = o.userAgent.match(/Chrome\/(\d+)/);
  const uaMajor = ua ? Number(ua[1]) : null;
  if (!o.uaClientHints) return warn(rule, 'UA-CH unavailable; cannot cross-check the Chrome version.');
  if (uaMajor == null) return warn(rule, 'No Chrome/<version> token in the UA to cross-check.');

  const list = o.uaClientHints.fullVersionList.length ? o.uaClientHints.fullVersionList : o.uaClientHints.brands;
  const brand = list.find(isRealChromiumBrand);
  if (!brand) return warn(rule, 'No Chromium brand in UA-CH to cross-check.');

  const brandMajor = majorOf(brand.version);
  if (brandMajor == null) return warn(rule, `Could not parse a major version from UA-CH brand "${brand.brand} ${brand.version}".`);

  return brandMajor === uaMajor
    ? pass(rule, `UA Chrome ${uaMajor} matches UA-CH ${brand.brand} ${brandMajor}.`)
    : fail(rule, `UA Chrome ${uaMajor} disagrees with UA-CH ${brand.brand} ${brandMajor}.`);
}

// --- 9. Date.getTimezoneOffset() consistent with the Intl timezone ------------

/**
 * Offset of an IANA zone at a given instant, in Date.getTimezoneOffset() sign
 * convention (minutes, positive = behind UTC). Derived from the same instant the
 * probe captured so DST is handled correctly.
 */
export function ianaOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return -Math.round((asUTC - at.getTime()) / 60000);
}

function timezoneOffset(o: ProfileObservation): RuleResult {
  const rule = 'timezone-offset';
  if (!o.timezone) return warn(rule, 'No Intl timezone reported.');
  let expected: number;
  try {
    expected = ianaOffsetMinutes(o.timezone, new Date(o.capturedAt));
  } catch {
    return warn(rule, `Could not resolve offset for timezone "${o.timezone}".`);
  }
  if (Math.abs(expected - o.timezoneOffset) <= 1) {
    return pass(rule, `getTimezoneOffset ${o.timezoneOffset} matches ${o.timezone} (${expected}).`);
  }
  return fail(rule, `getTimezoneOffset ${o.timezoneOffset} contradicts ${o.timezone} (expected ${expected}).`);
}

function shortUa(ua: string): string {
  return ua.length > 48 ? `${ua.slice(0, 45)}...` : ua;
}

/** True when no rule failed — the per-profile pass gate. */
export function isConsistent(results: RuleResult[]): boolean {
  return !results.some((r) => r.status === 'fail');
}
