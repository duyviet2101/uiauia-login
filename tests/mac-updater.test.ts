import { describe, it, expect } from 'vitest';
import { pickDmgAsset } from '../src/main/mac-updater';
import type { GithubAsset } from '../src/main/types';
import { MacUpdater } from '../src/main/mac-updater';

const a = (name: string): GithubAsset => ({ name, browser_download_url: `https://x/${name}` });

describe('pickDmgAsset', () => {
  const dmgs = [a('App-1.0.0-arm64.dmg'), a('App-1.0.0-x64.dmg'), a('App-1.0.0.exe')];
  it('chọn arm64 trên máy arm64', () => {
    expect(pickDmgAsset(dmgs, 'arm64')?.name).toBe('App-1.0.0-arm64.dmg');
  });
  it('chọn x64 trên máy x64', () => {
    expect(pickDmgAsset(dmgs, 'x64')?.name).toBe('App-1.0.0-x64.dmg');
  });
  it('null khi không có dmg', () => {
    expect(pickDmgAsset([a('App.exe'), a('latest.yml')], 'arm64')).toBeNull();
  });
  it('fallback dmg không có hậu tố arch', () => {
    expect(pickDmgAsset([a('App-1.0.0.dmg')], 'x64')?.name).toBe('App-1.0.0.dmg');
  });
});

describe('MacUpdater.check', () => {
  const release = JSON.stringify({
    tag_name: 'v9.9.9', html_url: 'https://h',
    assets: [{ name: 'App-9.9.9-arm64.dmg', browser_download_url: 'https://x/arm.dmg' }],
  });
  it('available + lưu url dmg khi có bản mới', async () => {
    const fetcher = async () => new Response(release, { status: 200 });
    const u = new MacUpdater('o/r', { arch: 'arm64', fetcher: fetcher as typeof fetch });
    const r = await u.check('0.2.2');
    expect(r.available).toBe(true);
    expect(r.latest).toBe('v9.9.9');
    expect(u.downloadUrl).toBe('https://x/arm.dmg');
  });
  it('không available khi đang là bản mới nhất', async () => {
    const fetcher = async () => new Response(JSON.stringify({ tag_name: 'v0.2.2', assets: [] }), { status: 200 });
    const u = new MacUpdater('o/r', { fetcher: fetcher as typeof fetch });
    expect((await u.check('0.2.2')).available).toBe(false);
  });
});

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('MacUpdater.start + apply', () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);
  const fetcher = (async (url: string | URL) => {
    if (String(url).includes('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: 'v9.9.9',
        assets: [{ name: 'App-9.9.9-arm64.dmg', browser_download_url: 'https://x/arm.dmg' }],
      }), { status: 200 });
    }
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  }) as typeof fetch;

  it('tải dmg ra đĩa + báo % rồi apply mở đúng file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mu-'));
    const opened: string[] = [];
    const u = new MacUpdater('o/r', {
      arch: 'arm64', fetcher, tmpDir: () => dir,
      openPath: async (p) => { opened.push(p); return ''; },
    });
    const pct: number[] = [];
    await u.check('0.0.1');
    const r = await u.start((p) => pct.push(p));
    expect(r.ready).toBe(true);
    expect(readFileSync(r.artifactPath!)).toEqual(Buffer.from(bytes));
    expect(pct.at(-1)).toBe(100);
    await u.apply();
    expect(opened).toEqual([r.artifactPath]);
  });

  it('start: không có dmg -> mở trang release, ready=false', async () => {
    const opened: string[] = [];
    const fetcher = (async () => new Response(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://rel', assets: [] }), { status: 200 })) as typeof fetch;
    const u = new MacUpdater('o/r', { arch: 'arm64', fetcher, openExternal: async (url) => { opened.push(url); } });
    await u.check('0.0.1');
    const r = await u.start(() => {});
    expect(r.ready).toBe(false);
    expect(opened).toEqual(['https://rel']);
  });

  it('check: ném lỗi khi GitHub trả lỗi', async () => {
    const fetcher = (async () => new Response('nope', { status: 503 })) as typeof fetch;
    const u = new MacUpdater('o/r', { fetcher });
    await expect(u.check('0.2.2')).rejects.toThrow('GitHub API 503');
  });
});
