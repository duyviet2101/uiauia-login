import { describe, expect, it } from 'vitest';
import { packPngIco } from '../src/main/profile-icon';

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
});
