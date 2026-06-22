import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { nativeImage } from 'electron';
import { profileIconForeground } from './profile-window-customization';

export interface IcoFrame {
  size: number;
  png: Buffer;
}

const ICON_SIZES = [16, 24, 32, 48, 64, 256] as const;

export function packPngIco(frames: IcoFrame[]): Buffer {
  if (!frames.length) throw new Error('ICO requires at least one frame.');
  const headerSize = 6 + frames.length * 16;
  const totalSize = headerSize + frames.reduce((sum, frame) => sum + frame.png.length, 0);
  const out = Buffer.alloc(totalSize);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(frames.length, 4);

  let offset = headerSize;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry);
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1);
    out.writeUInt8(0, entry + 2);
    out.writeUInt8(0, entry + 3);
    out.writeUInt16LE(1, entry + 4);
    out.writeUInt16LE(32, entry + 6);
    out.writeUInt32LE(frame.png.length, entry + 8);
    out.writeUInt32LE(offset, entry + 12);
    frame.png.copy(out, offset);
    offset += frame.png.length;
  });
  return out;
}

function iconSvg(number: number, color: string): string {
  const text = String(number);
  const fontSize = text.length <= 2 ? 134 : text.length === 3 ? 102 : 78;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect x="8" y="8" width="240" height="240" rx="55" fill="${color}" stroke="rgba(255,255,255,.32)" stroke-width="10"/>
    <text x="128" y="136" text-anchor="middle" dominant-baseline="middle" fill="${profileIconForeground(color)}"
      font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="800">${text}</text>
  </svg>`;
}

export function renderProfileIconIco(number: number, color: string): Buffer {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(number, color))}`;
  const source = nativeImage.createFromDataURL(dataUrl);
  if (source.isEmpty()) throw new Error('Electron could not render the profile icon SVG.');
  const frames = ICON_SIZES.map((size) => ({
    size,
    png: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  return packPngIco(frames);
}

export class ProfileIconCache {
  private dir: string;

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'window-icons');
    mkdirSync(this.dir, { recursive: true });
  }

  get(profileId: string, number: number, color: string): string {
    const hash = createHash('sha256').update(`${number}:${color}`).digest('hex').slice(0, 12);
    const path = join(this.dir, `${profileId}-${hash}.ico`);
    if (!existsSync(path)) writeFileSync(path, renderProfileIconIco(number, color));
    return path;
  }

  removeStale(activeProfileIds: Set<string>): void {
    for (const filename of readdirSync(this.dir)) {
      if (!filename.endsWith('.ico')) continue;
      const active = [...activeProfileIds].some((id) => filename.startsWith(`${id}-`));
      if (!active) {
        try { rmSync(join(this.dir, filename), { force: true }); } catch { /* best effort */ }
      }
    }
  }
}
