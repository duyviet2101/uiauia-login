import { describe, it, expect } from 'vitest';
import { pickDmgAsset } from '../src/main/mac-updater';
import type { GithubAsset } from '../src/main/types';

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
