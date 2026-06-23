import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { packPngIco, renderProfileIconIco, renderProfileIconPng } from '../src/main/profile-icon';

describe('packPngIco', () => {
  it('writes a valid multi-frame ICO directory with PNG payload offsets', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([4, 5, 6, 7]);
    const ico = packPngIco([{ size: 16, png: a }, { size: 256, png: b }]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(22)).toBe(0);
    expect(ico.readUInt32LE(14)).toBe(a.length);
    expect(ico.readUInt32LE(18)).toBe(38);
    expect(ico.subarray(38, 41)).toEqual(a);
    expect(ico.subarray(41)).toEqual(b);
  });

  it('renders a standalone RGBA PNG without relying on Electron SVG support', () => {
    const png = renderProfileIconPng(32, 12, '#2563EB');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it('packs every generated icon size as a PNG frame', () => {
    const ico = renderProfileIconIco(12, '#2563EB');
    expect(ico.readUInt16LE(4)).toBe(6);
    const firstFrameOffset = ico.readUInt32LE(18);
    expect(ico.subarray(firstFrameOffset, firstFrameOffset + 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it.runIf(process.platform === 'win32')('loads the generated ICO through the real Windows API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'profile-icon-'));
    const path = join(dir, 'profile.ico');
    writeFileSync(path, renderProfileIconIco(12, '#2563EB'));
    const { createKoffiWindowsAdapter } = await import('../src/main/windows-native-adapter');
    const adapter = await createKoffiWindowsAdapter();
    try {
      const icons = adapter.loadIcons(path);
      expect(icons.small).toBeTruthy();
      expect(icons.big).toBeTruthy();
      adapter.destroyIcon(icons.small);
      adapter.destroyIcon(icons.big);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
