import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import { profileIconForeground } from './profile-window-customization';

export interface IcoFrame {
  size: number;
  png: Buffer;
}

const ICON_SIZES = [16, 24, 32, 48, 64, 256] as const;

const DIGITS = [
  ['11111', '10001', '10011', '10101', '11001', '10001', '11111'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00001', '11110'],
] as const;

let crcTable: Uint32Array | null = null;

function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const outputOffset = y * (1 + width * 4);
    scanlines[outputOffset] = 0;
    rgba.copy(scanlines, outputOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function insideRoundedRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): boolean {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
}

function downsample(source: Buffer, sourceSize: number, size: number, factor: number): Buffer {
  const output = Buffer.alloc(size * size * 4);
  const samples = factor * factor;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const sourceOffset = ((y * factor + sy) * sourceSize + x * factor + sx) * 4;
          const a = source[sourceOffset + 3];
          alpha += a;
          red += source[sourceOffset] * a;
          green += source[sourceOffset + 1] * a;
          blue += source[sourceOffset + 2] * a;
        }
      }
      const outputOffset = (y * size + x) * 4;
      output[outputOffset + 3] = Math.round(alpha / samples);
      if (alpha) {
        output[outputOffset] = Math.round(red / alpha);
        output[outputOffset + 1] = Math.round(green / alpha);
        output[outputOffset + 2] = Math.round(blue / alpha);
      }
    }
  }
  return output;
}

/** Render without SVG/nativeImage; SVG decoding is not available in Electron on every Windows build. */
export function renderProfileIconPng(size: number, number: number, color: string): Buffer {
  const factor = 4;
  const canvasSize = size * factor;
  const pixels = Buffer.alloc(canvasSize * canvasSize * 4);
  const background = rgb(color);
  const foreground = rgb(profileIconForeground(color));
  const border = background.map((channel) => Math.round(channel * 0.68 + 255 * 0.32)) as [number, number, number];
  const outerInset = canvasSize * (8 / 256);
  const innerInset = canvasSize * (18 / 256);

  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const outer = insideRoundedRect(
        px, py, outerInset, outerInset, canvasSize - outerInset, canvasSize - outerInset, canvasSize * (55 / 256),
      );
      if (!outer) continue;
      const inner = insideRoundedRect(
        px, py, innerInset, innerInset, canvasSize - innerInset, canvasSize - innerInset, canvasSize * (45 / 256),
      );
      const fill = inner ? background : border;
      const offset = (y * canvasSize + x) * 4;
      pixels[offset] = fill[0];
      pixels[offset + 1] = fill[1];
      pixels[offset + 2] = fill[2];
      pixels[offset + 3] = 255;
    }
  }

  const text = String(Math.max(0, Math.trunc(number)));
  const gridWidth = text.length * 5 + Math.max(0, text.length - 1);
  const cell = Math.max(1, Math.floor(Math.min(canvasSize * 0.76 / gridWidth, canvasSize * 0.52 / 7)));
  const textWidth = gridWidth * cell;
  const textHeight = 7 * cell;
  const startX = Math.floor((canvasSize - textWidth) / 2);
  const startY = Math.floor((canvasSize - textHeight) / 2 + canvasSize * 0.015);
  for (let digitIndex = 0; digitIndex < text.length; digitIndex++) {
    const pattern = DIGITS[Number(text[digitIndex])] ?? DIGITS[0];
    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 5; column++) {
        if (pattern[row][column] !== '1') continue;
        const left = startX + (digitIndex * 6 + column) * cell;
        const top = startY + row * cell;
        for (let y = top; y < top + cell; y++) {
          for (let x = left; x < left + cell; x++) {
            const offset = (y * canvasSize + x) * 4;
            pixels[offset] = foreground[0];
            pixels[offset + 1] = foreground[1];
            pixels[offset + 2] = foreground[2];
            pixels[offset + 3] = 255;
          }
        }
      }
    }
  }

  return encodeRgbaPng(size, size, downsample(pixels, canvasSize, size, factor));
}

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

export function renderProfileIconIco(number: number, color: string): Buffer {
  const frames = ICON_SIZES.map((size) => ({
    size,
    png: renderProfileIconPng(size, number, color),
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
