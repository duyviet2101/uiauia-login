import type { ProfileObservation, RuleResult, UaBrand } from './types';
import type { Persona } from './persona';
import { foreignTells, nativeTells } from './persona';

/**
 * Per-profile plausibility checks, evaluated against the persona the profile
 * CLAIMS to be. Each rule asks: does this profile look like ONE coherent real
 * machine of that OS, with no contradiction a fingerprinter's lie-detection
 * would flag? pass / warn / fail + a human message.
 *
 * Persona matters: a Mac-run profile presenting a macOS persona must be judged
 * by macOS expectations. The old harness applied Windows rules to every run,
 * which is why a macOS run could not be assessed at all.
 *
 * Pure function — unit-tested with clean and deliberately-broken fixtures.
 */
export function consistency(o: ProfileObservation, persona: Persona = o.persona ?? 'windows'): RuleResult[] {
  return [
    platformCoherence(o, persona),
    webglRenderer(o, persona),
    renderStackCoherence(o),
    fontStackCoherence(o, persona),
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

const label = (persona: Persona): string => (persona === 'macos' ? 'macOS' : 'Windows');

// --- 1. UA token <-> navigator.platform <-> UA-CH platform all one OS --------

function platformCoherence(o: ProfileObservation, persona: Persona): RuleResult {
  const rule = 'platform-coherence';
  const matches = (uaOk: boolean, platformOk: boolean, chOk: boolean) => ({ uaOk, platformOk, chOk });
  const m =
    persona === 'macos'
      ? matches(
          /Mac OS X|Macintosh/i.test(o.userAgent),
          /^Mac/i.test(o.platform),
          (o.uaClientHints?.platform ?? 'macOS') === 'macOS',
        )
      : matches(
          /Windows NT/i.test(o.userAgent),
          /^Win/i.test(o.platform),
          (o.uaClientHints?.platform ?? 'Windows') === 'Windows',
        );

  const signals: { name: string; okay: boolean }[] = [
    { name: `UA "${shortUa(o.userAgent)}"`, okay: m.uaOk },
    { name: `navigator.platform "${o.platform}"`, okay: m.platformOk },
  ];
  if (o.uaClientHints?.platform) {
    signals.push({ name: `UA-CH platform "${o.uaClientHints.platform}"`, okay: m.chOk });
  }

  const offenders = signals.filter((s) => !s.okay).map((s) => s.name);
  if (offenders.length === signals.length) {
    return fail(rule, `No signal reports ${label(persona)} (${offenders.join('; ')}).`);
  }
  if (offenders.length > 0) {
    return fail(rule, `Platform signals disagree — not ${label(persona)}: ${offenders.join('; ')}.`);
  }
  return pass(rule, `UA, navigator.platform and UA-CH all report ${label(persona)}.`);
}

// --- 2. WebGL renderer is plausible for the claimed OS -----------------------

const SOFTWARE_RENDERERS = ['swiftshader', 'llvmpipe', 'software', 'microsoft basic render', 'mesa'];
/** Strings that betray a non-Windows GPU when the persona claims Windows. */
const NON_WINDOWS_RENDERERS = ['apple'];
/** Strings that betray a non-Mac GPU when the persona claims macOS. */
const NON_MACOS_RENDERERS = ['direct3d', 'd3d11', 'nvidia', 'radeon', 'intel(r)'];

function webglRenderer(o: ProfileObservation, persona: Persona): RuleResult {
  const rule = 'webgl-renderer';
  const r = (o.webglRenderer ?? '').trim();
  if (!r) return fail(rule, 'WebGL renderer is blank/unavailable (a tell on a real GPU machine).');
  const lower = r.toLowerCase();

  const software = SOFTWARE_RENDERERS.find((bad) => lower.includes(bad));
  if (software) return fail(rule, `WebGL renderer "${r}" is software rendering (matched "${software}").`);

  const foreign = (persona === 'macos' ? NON_MACOS_RENDERERS : NON_WINDOWS_RENDERERS)
    .find((bad) => lower.includes(bad));
  if (foreign) {
    return fail(rule, `WebGL renderer "${r}" contradicts the ${label(persona)} persona (matched "${foreign}").`);
  }
  return pass(rule, `WebGL renderer "${r}" is plausible for ${label(persona)}.`);
}

// --- 3. Renderer STRING vs the real rendering backend ------------------------

/** Compressed-texture formats only mobile/Apple GPUs expose. A desktop
 *  Direct3D11 adapter does not support PVRTC or ASTC. */
const APPLE_GPU_EXTENSIONS = [
  'webgl_compressed_texture_pvrtc',
  'webkit_webgl_compressed_texture_pvrtc',
  'webgl_compressed_texture_astc',
  'webgl_compressed_texture_etc',
];
/** Desktop-only formats an Apple GPU does not expose. */
const DESKTOP_GPU_EXTENSIONS = ['ext_texture_compression_bptc', 'ext_texture_compression_rgtc'];

/**
 * A spoofed renderer string can claim any GPU; the WebGL extension list comes
 * from the driver that is actually running. When the two disagree, a detector
 * that reads both sees the lie. This mirrors that check.
 */
function renderStackCoherence(o: ProfileObservation): RuleResult {
  const rule = 'render-stack-coherence';
  const extensions = o.webglExtensions;
  if (!extensions || extensions.length === 0) {
    return warn(rule, 'WebGL extension list not captured; cannot cross-check the renderer string.');
  }
  const renderer = (o.webglRenderer ?? '').toLowerCase();
  if (!renderer) return warn(rule, 'No renderer string to cross-check.');

  const lower = extensions.map((e) => e.toLowerCase());
  const appleHits = APPLE_GPU_EXTENSIONS.filter((e) => lower.includes(e));
  const desktopHits = DESKTOP_GPU_EXTENSIONS.filter((e) => lower.includes(e));
  const claimsDirect3D = /direct3d|d3d11/.test(renderer);
  const claimsApple = /apple/.test(renderer);

  if (claimsDirect3D && appleHits.length > 0) {
    return fail(
      rule,
      `Renderer claims Direct3D11 but the driver exposes Apple/mobile GPU extensions (${appleHits.join(', ')}) — the real backend is not D3D11.`,
    );
  }
  if (claimsApple && desktopHits.length > 0 && appleHits.length === 0) {
    return fail(
      rule,
      `Renderer claims an Apple GPU but exposes desktop-only extensions (${desktopHits.join(', ')}).`,
    );
  }
  return pass(rule, `Renderer string and WebGL extension set agree (${extensions.length} extensions).`);
}

// --- 4. Font stack vs claimed OS ---------------------------------------------

/**
 * Fonts are supplied by the host OS. If a "Windows" browser cannot see a single
 * Windows-only family but does see Mac-only ones, its text rendering betrays the
 * real host — the same signal a font-metrics fingerprinter reads.
 */
function fontStackCoherence(o: ProfileObservation, persona: Persona): RuleResult {
  const rule = 'font-stack-coherence';
  if (!o.fonts || o.fonts.length === 0) return warn(rule, 'No font probe results to evaluate.');
  const available = new Set(o.fonts.filter((f) => f.available).map((f) => f.family.toLowerCase()));
  const probed = new Set(o.fonts.map((f) => f.family.toLowerCase()));

  const native = nativeTells(persona).filter((f) => probed.has(f.toLowerCase()));
  const foreign = foreignTells(persona).filter((f) => probed.has(f.toLowerCase()));
  if (native.length === 0 && foreign.length === 0) {
    return warn(rule, 'Dictionary contains no OS-specific tells; cannot evaluate the font stack.');
  }

  const nativeSeen = native.filter((f) => available.has(f.toLowerCase()));
  const foreignSeen = foreign.filter((f) => available.has(f.toLowerCase()));

  if (foreignSeen.length > 0 && nativeSeen.length === 0) {
    return fail(
      rule,
      `Font stack contradicts the ${label(persona)} persona: none of its own fonts are present, but foreign-OS fonts are (${foreignSeen.join(', ')}).`,
    );
  }
  if (foreignSeen.length > nativeSeen.length) {
    return fail(
      rule,
      `Font stack leans to the wrong OS for a ${label(persona)} persona: ${foreignSeen.length} foreign vs ${nativeSeen.length} native tells (foreign: ${foreignSeen.join(', ')}).`,
    );
  }
  if (nativeSeen.length === 0) {
    return warn(rule, `No ${label(persona)} font tells detected; the font stack could not be confirmed.`);
  }
  return pass(
    rule,
    `Font stack matches the ${label(persona)} persona (${nativeSeen.length} native tell(s), ${foreignSeen.length} foreign).`,
  );
}

// --- 5. screen >= viewport ---------------------------------------------------

function screenGeViewport(o: ProfileObservation): RuleResult {
  const rule = 'screen-ge-viewport';
  if (o.innerWidth <= 0 || o.innerHeight <= 0) {
    return warn(rule, 'Viewport not measured (inner size 0); cannot compare to screen.');
  }
  if (o.screen.width < o.innerWidth || o.screen.height < o.innerHeight) {
    return fail(rule, `screen ${o.screen.width}x${o.screen.height} is smaller than viewport ${o.innerWidth}x${o.innerHeight}.`);
  }
  return pass(rule, `screen ${o.screen.width}x${o.screen.height} >= viewport ${o.innerWidth}x${o.innerHeight}.`);
}

// --- 6. navigator.webdriver === false ----------------------------------------

function webdriverFalse(o: ProfileObservation): RuleResult {
  const rule = 'webdriver-false';
  return o.webdriver
    ? fail(rule, 'navigator.webdriver is true (automation tell).')
    : pass(rule, 'navigator.webdriver is false.');
}

// --- 7. canvas digest is a real value ----------------------------------------

function canvasReal(o: ProfileObservation): RuleResult {
  const rule = 'canvas-real';
  const measured = o.measurements?.canvasText;
  if (measured && measured.status !== 'ok') {
    return fail(rule, `canvas measurement did not succeed (${measured.status}: ${measured.reason}).`);
  }
  if (!o.canvasHash || ['no-canvas', 'canvas-error'].includes(o.canvasHash)) {
    return fail(rule, `canvas hash is not a real value ("${o.canvasHash}").`);
  }
  return pass(rule, `canvas hash is a real value (${o.canvasHash}).`);
}

// --- 8. audio digest present --------------------------------------------------

function audioPresent(o: ProfileObservation): RuleResult {
  const rule = 'audio-present';
  const measured = o.measurements?.audio;
  if (measured && measured.status === 'unsupported') {
    return warn(rule, `audio API unavailable in this context (${measured.reason}).`);
  }
  if (measured && measured.status === 'error') {
    return fail(rule, `audio measurement failed (${measured.reason}).`);
  }
  return o.audioHash
    ? pass(rule, `audio hash present (${o.audioHash}).`)
    : fail(rule, 'audio hash is null — a missing audio fingerprint is itself a tell.');
}

// --- 9a. hardwareConcurrency in [2, 32] --------------------------------------

function coresRange(o: ProfileObservation): RuleResult {
  const rule = 'cores-range';
  const n = o.hardwareConcurrency;
  return n >= 2 && n <= 32
    ? pass(rule, `hardwareConcurrency ${n} in [2, 32].`)
    : fail(rule, `hardwareConcurrency ${n} is outside the plausible [2, 32] range.`);
}

// --- 9b. deviceMemory in {2, 4, 8} -------------------------------------------

function deviceMemory(o: ProfileObservation): RuleResult {
  const rule = 'device-memory';
  if (o.deviceMemory == null) return warn(rule, 'deviceMemory not exposed by navigator.');
  return [2, 4, 8].includes(o.deviceMemory)
    ? pass(rule, `deviceMemory ${o.deviceMemory} in {2, 4, 8}.`)
    : fail(rule, `deviceMemory ${o.deviceMemory} is not a realistic capped value (expected 2, 4 or 8).`);
}

// --- 10. UA-CH Chromium brand version matches the UA Chrome major ------------

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

// --- 11. Date.getTimezoneOffset() consistent with the Intl timezone ----------

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
