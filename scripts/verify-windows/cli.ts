import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir, release, arch } from 'os';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BrowserContext } from 'playwright-core';
import { launchPersistentContext, binaryInfo, ensureBinary, getDefaultStealthArgs } from 'cloakbrowser';
import { ProfileStore } from '../../src/main/store';
import { buildLaunchArgs, type Display } from '../../src/main/launch-args';
import { prepareBrowserPreferences } from '../../src/main/browser-preferences';
import { parseProxyString } from '../../src/main/proxy-parse';
import type { Profile, ProxyConfig } from '../../src/main/types';
import { captureObservation } from './probe';
import { runExternal } from './external';
import { startProbeServer } from './serve';
import { buildReport, writeReport, type RunMeta } from './report';
import { errorObservation, type LaunchMode, type ProfileObservation } from './types';
import type { Persona } from './persona';

interface Args {
  persona: Persona;
  launchMode: LaunchMode;
  profiles: number;
  opens: number;
  repeats: number;
  seeds: number[] | null;
  display: Display;
  screenLabel: string;
  external: boolean;
  proxiesFile: string | null;
  keep: boolean;
  group: string;
  label: string | null;
  extraArgs: string[];
  dropArgs: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    persona: process.platform === 'darwin' ? 'macos' : 'windows',
    launchMode: 'app',
    profiles: 3,
    opens: 1,
    repeats: 1,
    seeds: null,
    display: { width: 1920, height: 1080 },
    screenLabel: '1920x1080',
    external: false,
    proxiesFile: null,
    keep: false,
    group: 'A',
    label: null,
    extraArgs: [],
    dropArgs: [],
  };
  const positiveInt = (raw: string | undefined, flag: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer (got "${raw}")`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--persona') {
      const v = argv[++i];
      if (v !== 'macos' && v !== 'windows') throw new Error(`--persona must be macos|windows (got "${v}")`);
      args.persona = v;
    } else if (a === '--launch-mode') {
      const v = argv[++i];
      if (v !== 'app' && v !== 'minimal') throw new Error(`--launch-mode must be app|minimal (got "${v}")`);
      args.launchMode = v;
    } else if (a === '--profiles') {
      args.profiles = positiveInt(argv[++i], '--profiles');
    } else if (a === '--opens') {
      args.opens = positiveInt(argv[++i], '--opens');
    } else if (a === '--repeats') {
      args.repeats = positiveInt(argv[++i], '--repeats');
    } else if (a === '--seeds') {
      const v = argv[++i] ?? '';
      const seeds = v.split(',').map((s) => Number(s.trim()));
      if (!seeds.length || seeds.some((s) => !Number.isInteger(s) || s <= 0)) {
        throw new Error(`--seeds must be a comma-separated list of positive integers (got "${v}")`);
      }
      args.seeds = seeds;
    } else if (a === '--screen') {
      const v = argv[++i] ?? '';
      const m = v.match(/^(\d+)x(\d+)$/i);
      if (!m) throw new Error(`--screen must be WxH (got "${v}")`);
      args.display = { width: Number(m[1]), height: Number(m[2]) };
      args.screenLabel = `${m[1]}x${m[2]}`;
    } else if (a === '--group') {
      args.group = argv[++i] ?? 'A';
    } else if (a === '--label') {
      args.label = argv[++i] ?? null;
    } else if (a === '--extra-arg') {
      const v = argv[++i];
      if (!v) throw new Error('--extra-arg needs a value');
      args.extraArgs.push(v);
    } else if (a === '--drop-arg') {
      const v = argv[++i];
      if (!v) throw new Error('--drop-arg needs a flag prefix');
      args.dropArgs.push(v);
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

/**
 * Version reported by the binary that will actually launch — not the npm
 * package version and not the cache marker. These have disagreed before.
 */
function realBrowserVersion(binaryPath: string): string {
  try {
    return execFileSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`;
  }
}

function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '../../node_modules/cloakbrowser/package.json'), 'utf8'));
    return String(pkg.version);
  } catch {
    return 'unknown';
  }
}

interface LaunchPlan {
  options: Record<string, unknown>;
  args: string[];
}

/**
 * Group A/B use the app's own launch configuration. Group C ("minimal") uses the
 * engine defaults only — the control that shows what the app's overrides change.
 * `--drop-arg` / `--extra-arg` support single-variable ablation on top of A.
 */
function planLaunch(profile: Profile, args: Args): LaunchPlan {
  if (args.launchMode === 'minimal') {
    // Engine defaults only, with the seed pinned so the control differs from the
    // app group by CONFIGURATION alone. Without the pin the engine picks a fresh
    // random seed per launch and nothing would be comparable across opens.
    const seedArg = `--fingerprint=${profile.seed}`;
    return {
      options: { userDataDir: profile.userDataDir, headless: false, args: [seedArg] },
      args: [seedArg, '<engine defaults>', ...getDefaultStealthArgs().filter((a) => !a.startsWith('--fingerprint='))],
    };
  }
  const options = buildLaunchArgs(profile, args.display) as unknown as Record<string, unknown> & { args: string[] };
  let chromeArgs = options.args;
  if (args.dropArgs.length) {
    chromeArgs = chromeArgs.filter((flag) => !args.dropArgs.some((prefix) => flag.startsWith(prefix)));
  }
  if (args.extraArgs.length) chromeArgs = [...chromeArgs, ...args.extraArgs];
  return { options: { ...options, args: chromeArgs }, args: chromeArgs };
}

async function probeOpen(
  profile: Profile,
  args: Args,
  probeUrl: string,
  openIndex: number,
  versions: { browserVersion: string; packageVersion: string },
): Promise<ProfileObservation[]> {
  const out: ProfileObservation[] = [];
  const plan = planLaunch(profile, args);
  let ctx: BrowserContext | undefined;
  try {
    if (args.launchMode === 'app') {
      // Real launch path, minus identity-lock side effects.
      prepareBrowserPreferences(profile.userDataDir, {
        blockGeolocation: profile.blockGeolocation,
        doNotTrack: profile.doNotTrack,
      });
    }
    ctx = await launchPersistentContext(plan.options as never);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.bringToFront().catch(() => {});
    // Probe on a loopback secure context so UA-CH + deviceMemory are exposed
    // (about:blank is not a secure context under CloakBrowser).
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

    for (let measureIndex = 1; measureIndex <= args.repeats; measureIndex++) {
      const observation = await captureObservation(page, {
        profileId: profile.id,
        profileName: profile.name,
        seed: profile.seed,
        persona: args.persona,
        launchMode: args.launchMode,
        openIndex,
        measureIndex,
        group: args.group,
        browserVersion: versions.browserVersion,
        packageVersion: versions.packageVersion,
        launchArgs: plan.args,
      });
      if (args.external && openIndex === 1 && measureIndex === 1) {
        observation.external = await runExternal(ctx);
      }
      out.push(observation);
    }
    return out;
  } catch (error) {
    return [
      errorObservation(
        profile.id,
        profile.name,
        profile.seed,
        error instanceof Error ? error.stack ?? error.message : String(error),
        {
          persona: args.persona,
          launchMode: args.launchMode,
          openIndex,
          measureIndex: 1,
          group: args.group,
          launchArgs: plan.args,
          browserVersion: versions.browserVersion,
          packageVersion: versions.packageVersion,
        },
      ),
    ];
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const reportsRoot = join(here, 'reports');

  console.log('Ensuring CloakBrowser binary is present (first run may download ~200MB)…');
  await ensureBinary();
  const info = binaryInfo();
  const browserVersion = realBrowserVersion(info.binaryPath);
  const versions = { browserVersion, packageVersion: packageVersion() };
  console.log(`CloakBrowser cache version : ${info.version} (tier ${info.tier})`);
  console.log(`Browser --version          : ${browserVersion}`);
  console.log(`cloakbrowser npm package   : ${versions.packageVersion}`);
  console.log(`Host                       : ${process.platform} ${release()} (${arch()})`);
  console.log(`Persona / launch / group   : ${args.persona} / ${args.launchMode} / ${args.group}`);
  if (args.dropArgs.length) console.log(`Dropping args              : ${args.dropArgs.join(' ')}`);
  if (args.extraArgs.length) console.log(`Extra args                 : ${args.extraArgs.join(' ')}`);

  const proxies = args.proxiesFile ? loadProxies(args.proxiesFile) : [];
  if (args.proxiesFile) console.log(`Loaded ${proxies.length} prox(ies) from ${args.proxiesFile}`);

  // Separate throwaway store per run: no group ever shares a userDataDir, and
  // the user's real profile data is never touched.
  const dataDir = mkdtempSync(join(tmpdir(), `verify-${args.persona}-${args.group}-`));
  console.log(`Throwaway profile store    : ${dataDir}`);

  const seeds = args.seeds ? [...args.seeds] : null;
  let seedCursor = 0;
  const store = new ProfileStore(dataDir, seeds ? { seedGen: () => seeds[seedCursor++ % seeds.length] } : {});
  await store.init();

  const probeServer = await startProbeServer();
  console.log(`Loopback probe page        : ${probeServer.url}`);

  const startedAt = new Date().toISOString();
  const observations: ProfileObservation[] = [];

  try {
    const profiles: Profile[] = [];
    for (let i = 0; i < args.profiles; i++) {
      profiles.push(
        await store.create({
          name: `verify-${args.group}${i + 1}`,
          platform: args.persona,
          proxy: proxies[i] ?? null,
        }),
      );
    }

    for (const profile of profiles) {
      for (let openIndex = 1; openIndex <= args.opens; openIndex++) {
        process.stdout.write(
          `\n[${profile.name} seed ${profile.seed}] open ${openIndex}/${args.opens} × ${args.repeats} measure(s)… `,
        );
        const rows = await probeOpen(profile, args, probeServer.url, openIndex, versions);
        observations.push(...rows);
        const first = rows[0];
        console.log(
          first.ok
            ? `ok — canvas ${first.canvasHash.slice(0, 12)} · webgl "${(first.webglRenderer ?? '').slice(0, 44)}"`
            : `FAILED — ${first.error?.split('\n')[0]}`,
        );
      }
    }

    const meta: RunMeta = {
      startedAt,
      cloakBrowserVersion: info.version,
      browserVersion,
      packageVersion: versions.packageVersion,
      binaryTier: info.tier,
      hostOS: `${process.platform} ${release()} (${arch()})`,
      persona: args.persona,
      launchMode: args.launchMode,
      group: args.group,
      label: args.label ?? undefined,
      profileCount: args.profiles,
      opens: args.opens,
      repeats: args.repeats,
      screen: args.screenLabel,
      withProxies: proxies.length > 0,
      external: args.external,
      droppedArgs: args.dropArgs,
      extraArgs: args.extraArgs,
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
  console.error('verify failed:', error);
  process.exit(1);
});
