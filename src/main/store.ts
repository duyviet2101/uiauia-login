import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Profile, CreateProfileInput, UpdateProfileInput, ResolvedIdentity, ProxyCheckSnapshot } from './types';

interface Data { profiles: Profile[]; version?: number }
interface Opts { seedGen?: () => number; idGen?: () => string }

const defaultSeed = () => Math.floor(Math.random() * 99_990_000) + 10_000;

/** Bump when the Profile shape changes; `migrate()` backfills older records. */
const SCHEMA_VERSION = 3;
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
    for (const p of this.db.data.profiles as (Profile & Record<string, unknown>)[]) {
      if (p.platform === undefined) { p.platform = 'windows'; changed = true; }
      if (p.startUrl === undefined) { p.startUrl = null; changed = true; }
      if (p.visitorId === undefined) { p.visitorId = null; changed = true; }
      if (p.identityLocked === undefined) { p.identityLocked = false; changed = true; }
      if (p.resolvedIdentity === undefined) { p.resolvedIdentity = null; changed = true; }
      if (p.lastProxyCheck === undefined) { p.lastProxyCheck = null; changed = true; }
    }
    if (this.db.data.version !== SCHEMA_VERSION) { this.db.data.version = SCHEMA_VERSION; changed = true; }
    return changed;
  }

  list(): Profile[] { return this.db.data.profiles; }
  get(id: string): Profile | undefined { return this.db.data.profiles.find((p) => p.id === id); }

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.idGen();
    const userDataDir = join(this.dataDir, 'profiles', id);
    mkdirSync(userDataDir, { recursive: true });
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
      identityLocked: false,
      resolvedIdentity: null,
      lastProxyCheck: null,
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
    Object.assign(p, patch);
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
