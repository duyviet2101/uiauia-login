import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir, release, arch } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { BrowserContext } from 'playwright-core';
import { launchPersistentContext, binaryInfo, ensureBinary } from 'cloakbrowser';
import { ProfileStore } from '../../src/main/store';
import { buildLaunchArgs, type Display } from '../../src/main/launch-args';
import { prepareBrowserPreferences } from '../../src/main/browser-preferences';
import { parseProxyString } from '../../src/main/proxy-parse';
import type { Profile, ProxyConfig } from '../../src/main/types';
import { captureObservation } from './probe';
import { runExternal } from './external';
import { startProbeServer } from './serve';
import { buildReport, writeReport, type RunMeta } from './report';
import { errorObservation, type ProfileObservation } from './types';

interface Args {
  profiles: number;
  display: Display;
  screenLabel: string;
  external: boolean;
  proxiesFile: string | null;
  keep: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    profiles: 3,
    display: { width: 1920, height: 1080 },
    screenLabel: '1920x1080',
    external: false,
    proxiesFile: null,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profiles') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--profiles must be a positive integer (got "${argv[i]}")`);
      args.profiles = n;
    } else if (a === '--screen') {
      const v = argv[++i] ?? '';
      const m = v.match(/^(\d+)x(\d+)$/i);
      if (!m) throw new Error(`--screen must be WxH (got "${v}")`);
      args.display = { width: Number(m[1]), height: Number(m[2]) };
      args.screenLabel = `${m[1]}x${m[2]}`;
    } else if (a === '--external') {
      args.external = true;
    } else if (a === '--proxies') {
      args.proxiesFile = argv[++i] ?? null;
      if (!args.proxiesFile) throw new Error('--proxies needs a file path');
    } else if (a === '--keep') {
      args.keep = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function loadProxies(file: string): ProxyConfig[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const proxies: ProxyConfig[] = [];
  for (const line of lines) {
    const parsed = parseProxyString(line);
    if (!parsed) throw new Error(`Could not parse proxy line: "${line}"`);
    proxies.push({
      type: parsed.type ?? 'http',
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
    });
  }
  return proxies;
}

async function probeProfile(
  profile: Profile,
  display: Display,
  external: boolean,
  probeUrl: string,
): Promise<ProfileObservation> {
  let ctx: BrowserContext | undefined;
  try {
    // Real launch path, minus identity-lock side effects.
    prepareBrowserPreferences(profile.userDataDir, {
      blockGeolocation: profile.blockGeolocation,
      doNotTrack: profile.doNotTrack,
    });
    ctx = await launchPersistentContext(buildLaunchArgs(profile, display));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.bringToFront().catch(() => {});
    // Probe on a loopback secure context so UA-CH + deviceMemory are exposed
    // (about:blank is not a secure context under CloakBrowser).
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const observation = await captureObservation(page, { profileId: profile.id, profileName: profile.name, seed: profile.seed });
    if (external) observation.external = await runExternal(ctx);
    return observation;
  } catch (error) {
    return errorObservation(profile.id, profile.name, profile.seed, error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const reportsRoot = join(here, 'reports');

  if (process.platform !== 'win32') {
    console.warn('⚠️  Not running on Windows — buildLaunchArgs still forces --fingerprint-platform=windows, but results only reflect the real Windows binary on a Windows host.');
  }

  console.log('Ensuring CloakBrowser binary is present (first run may download ~200MB)…');
  await ensureBinary();
  const version = binaryInfo().version;
  console.log(`CloakBrowser binary: ${version}`);

  const proxies = args.proxiesFile ? loadProxies(args.proxiesFile) : [];
  if (args.proxiesFile) console.log(`Loaded ${proxies.length} prox(ies) from ${args.proxiesFile}`);

  const dataDir = mkdtempSync(join(tmpdir(), 'verify-windows-'));
  console.log(`Throwaway profile store: ${dataDir}`);

  const store = new ProfileStore(dataDir);
  await store.init();

  const probeServer = await startProbeServer();
  console.log(`Loopback probe page (secure context): ${probeServer.url}`);

  const startedAt = new Date().toISOString();
  const observations: ProfileObservation[] = [];

  try {
    for (let i = 0; i < args.profiles; i++) {
      const proxy = proxies[i] ?? null;
      const profile = await store.create({ name: `verify-${i + 1}`, platform: 'windows', proxy });
      console.log(`\n[${i + 1}/${args.profiles}] launching ${profile.name} (seed ${profile.seed})${proxy ? ` via ${proxy.host}:${proxy.port}` : ''}…`);
      const observation = await probeProfile(profile, args.display, args.external, probeServer.url);
      observations.push(observation);
      console.log(observation.ok
        ? `  ok — canvas ${observation.canvasHash} · webgl "${observation.webglRenderer}" · audio ${observation.audioHash ?? 'null'}`
        : `  FAILED — ${observation.error?.split('\n')[0]}`);
    }

    const meta: RunMeta = {
      startedAt,
      cloakBrowserVersion: version,
      hostOS: `${process.platform} ${release()} (${arch()})`,
      profileCount: args.profiles,
      screen: args.screenLabel,
      withProxies: proxies.length > 0,
      external: args.external,
    };
    const report = buildReport(meta, observations);
    const outDir = writeReport(reportsRoot, report);

    console.log(`\n${'='.repeat(72)}`);
    console.log(report.verdict);
    console.log(`Report: ${join(outDir, 'report.md')}`);
    console.log('='.repeat(72));
  } finally {
    await probeServer.close().catch(() => {});
    if (args.keep) {
      console.log(`Keeping throwaway store (--keep): ${dataDir}`);
    } else {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error('verify:windows failed:', error);
  process.exit(1);
});
