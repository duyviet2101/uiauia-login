import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Profile, CreateProfileInput, UpdateProfileInput, ResolvedIdentity, ProxyCheckSnapshot } from './types';
import { createWindowCustomization, normalizeProfileIconColor } from './profile-window-customization';

interface Data { profiles: Profile[]; version?: number; nextWindowNumber?: number }
interface Opts { seedGen?: () => number; idGen?: () => string }

const defaultSeed = () => Math.floor(Math.random() * 99_990_000) + 10_000;

/** Bump when the Profile shape changes; `migrate()` backfills older records. */
const SCHEMA_VERSION = 7;
const LOCKED_IDENTITY_FIELDS = ['proxy', 'geoip', 'timezone', 'locale', 'platform'] as const;

export class ProfileStore {
  private db!: Low<Data>;
  private seedGen: () => number;
  private idGen: () => string;

  constructor(private dataDir: string, opts: Opts = {}) {
    this.seedGen = opts.seedGen ?? defaultSeed;
    this.idGen = opts.idGen ?? randomUUID;
  }

  async init(): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    const adapter = new JSONFile<Data>(join(this.dataDir, 'cloak.json'));
    this.db = new Low<Data>(adapter, { profiles: [] });
    await this.db.read();
    if (this.migrate()) await this.db.write();
  }

  /** Backfill fields added in newer versions onto profiles saved by older
   *  builds, so existing data keeps working after an app update. */
  private migrate(): boolean {
    let changed = false;
    const profiles = this.db.data.profiles as (Profile & Record<string, unknown>)[];
    const usedWindowNumbers = new Set<number>();
    const needsWindowNumber: (Profile & Record<string, unknown>)[] = [];

    for (const p of profiles) {
      if (p.platform === undefined) { p.platform = 'windows'; changed = true; }
      if (p.startUrl === undefined) { p.startUrl = null; changed = true; }
      if (p.visitorId === undefined) { p.visitorId = null; changed = true; }
      if (p.diagnostics === undefined) { p.diagnostics = null; changed = true; }
      if (p.identityLocked === undefined) { p.identityLocked = false; changed = true; }
      if (p.resolvedIdentity === undefined) { p.resolvedIdentity = null; changed = true; }
      if (p.lastProxyCheck === undefined) { p.lastProxyCheck = null; changed = true; }
      if (p.blockGeolocation === undefined) { p.blockGeolocation = true; changed = true; }
      if (p.doNotTrack === undefined) { p.doNotTrack = false; changed = true; }
      // diagnostics gained nonStandardFonts in v0.4.0; backfill so the renderer
      // never reads .length off undefined (which blanked the fingerprint view).
      const diag = p.diagnostics as { nonStandardFonts?: string[] } | null;
      if (diag && diag.nonStandardFonts === undefined) {
        diag.nonStandardFonts = [];
        changed = true;
      }
      const raw = p.windowCustomization as unknown;
      const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      const number = value?.number;
      if (typeof number === 'number' && Number.isSafeInteger(number) && number > 0 && !usedWindowNumbers.has(number)) {
        usedWindowNumbers.add(number);
        const enabled = typeof value?.enabled === 'boolean' ? value.enabled : true;
        const color = normalizeProfileIconColor(value?.color, number);
        if (!value || value.enabled !== enabled || value.color !== color) changed = true;
        p.windowCustomization = { enabled, number, color };
      } else {
        needsWindowNumber.push(p);
      }
    }

    needsWindowNumber.sort((a, b) => {
      const time = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
      return time || profiles.indexOf(a) - profiles.indexOf(b);
    });
    let candidate = 1;
    for (const p of needsWindowNumber) {
      while (usedWindowNumbers.has(candidate)) candidate += 1;
      p.windowCustomization = createWindowCustomization(candidate);
      usedWindowNumbers.add(candidate);
      candidate += 1;
      changed = true;
    }
    const minimumNext = Math.max(0, ...usedWindowNumbers) + 1;
    const storedNext = this.db.data.nextWindowNumber;
    const nextWindowNumber = typeof storedNext === 'number' && Number.isSafeInteger(storedNext)
      ? Math.max(storedNext, minimumNext)
      : minimumNext;
    if (storedNext !== nextWindowNumber) { this.db.data.nextWindowNumber = nextWindowNumber; changed = true; }
    if (this.db.data.version !== SCHEMA_VERSION) { this.db.data.version = SCHEMA_VERSION; changed = true; }
    return changed;
  }

  list(): Profile[] { return this.db.data.profiles; }
  get(id: string): Profile | undefined { return this.db.data.profiles.find((p) => p.id === id); }

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.idGen();
    const userDataDir = join(this.dataDir, 'profiles', id);
    mkdirSync(userDataDir, { recursive: true });
    const windowNumber = this.db.data.nextWindowNumber ?? 1;
    this.db.data.nextWindowNumber = windowNumber + 1;
    const profile: Profile = {
      id,
      name: input.name,
      seed: this.seedGen(),
      platform: input.platform ?? 'windows',
      proxy: input.proxy ?? null,
      geoip: input.geoip ?? true,
      timezone: input.timezone ?? null,
      locale: input.locale ?? null,
      startUrl: input.startUrl ?? null,
      userDataDir,
      fingerprint: null,
      visitorId: null,
      diagnostics: null,
      identityLocked: false,
      resolvedIdentity: null,
      lastProxyCheck: null,
      blockGeolocation: input.blockGeolocation ?? true,
      doNotTrack: input.doNotTrack ?? false,
      windowCustomization: createWindowCustomization(windowNumber, input.windowCustomization),
      createdAt: new Date().toISOString(),
      lastOpenedAt: null,
    };
    this.db.data.profiles.push(profile);
    await this.db.write();
    return profile;
  }

  async update(id: string, patch: UpdateProfileInput): Promise<void> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    if (p.identityLocked) {
      const changed = LOCKED_IDENTITY_FIELDS.filter((field) => field in patch);
      if (changed.length) {
        throw new Error(`Profile identity is locked. Reset identity before changing: ${changed.join(', ')}`);
      }
    }
    const { windowCustomization, ...profilePatch } = patch;
    Object.assign(p, profilePatch);
    if (windowCustomization) {
      p.windowCustomization = createWindowCustomization(p.windowCustomization.number, {
        enabled: windowCustomization.enabled ?? p.windowCustomization.enabled,
        color: windowCustomization.color ?? p.windowCustomization.color,
      });
    }
    await this.db.write();
  }

  async duplicate(id: string): Promise<Profile> {
    const src = this.get(id);
    if (!src) throw new Error(`Profile not found: ${id}`);
    return this.create({
      name: `${src.name} (copy)`,
      platform: src.platform,
      proxy: src.proxy,
      geoip: src.geoip,
      timezone: src.timezone,
      locale: src.locale,
      startUrl: src.startUrl,
    });
  }

  async setLastProxyCheck(id: string, snapshot: ProxyCheckSnapshot): Promise<void> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    p.lastProxyCheck = snapshot;
    await this.db.write();
  }

  async lockIdentity(id: string, identity: ResolvedIdentity, proxySnapshot?: ProxyCheckSnapshot): Promise<Profile> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    p.identityLocked = true;
    p.resolvedIdentity = identity;
    p.lastProxyCheck = proxySnapshot ?? {
      checkedAt: identity.lockedAt,
      ok: true,
      exitIp: identity.exitIp,
      country: identity.exitCountry,
      timezone: identity.exitTimezone ?? undefined,
    };
    p.fingerprint = identity.fingerprint;
    p.visitorId = identity.visitorId;
    p.geoip = false;
    p.timezone = identity.timezone;
    p.locale = identity.locale;
    await this.db.write();
    return p;
  }

  /** Re-align a locked identity with the current environment (new exit IP /
   *  browser version) without wiping seed, fingerprint, or session data.
   *  Backs "open and accept new IP" — the safe alternative to a full reset. */
  async reconcileLockedIdentity(id: string, patch: Partial<ResolvedIdentity>): Promise<Profile> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    if (!p.identityLocked || !p.resolvedIdentity) throw new Error('Profile identity is not locked.');
    p.resolvedIdentity = { ...p.resolvedIdentity, ...patch };
    await this.db.write();
    return p;
  }

  async resetIdentity(id: string): Promise<Profile> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    p.identityLocked = false;
    p.resolvedIdentity = null;
    p.fingerprint = null;
    p.visitorId = null;
    p.diagnostics = null;
    await this.db.write();
    return p;
  }

  /** Assign a fresh seed (= a brand-new device identity) and drop the cached
   *  fingerprint/visitorId so they are re-probed on the next launch. */
  async regenerateSeed(id: string): Promise<Profile> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    if (p.identityLocked) throw new Error('Profile identity is locked. Reset identity before changing seed.');
    p.seed = this.seedGen();
    p.fingerprint = null;
    p.visitorId = null;
    p.diagnostics = null;
    p.resolvedIdentity = null;
    p.identityLocked = false;
    await this.db.write();
    return p;
  }

  async remove(id: string): Promise<void> {
    const p = this.get(id);
    if (p) { try { rmSync(p.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    this.db.data.profiles = this.db.data.profiles.filter((x) => x.id !== id);
    await this.db.write();
  }
}
