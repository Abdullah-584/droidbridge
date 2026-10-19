/**
 * Generates build/icon.png — a 256×256 app icon with zero dependencies
 * (hand-rolled PNG encoder over node:zlib).
 *
 * The icon: a rounded cyan-to-indigo tile with a stylized "bridge" of two
 * device glyphs connected by a link, readable at small sizes.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

// --- CRC32 (PNG requirement) -------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// --- Drawing -----------------------------------------------------------------
const px = Buffer.alloc(SIZE * SIZE * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const alpha = a / 255;
  px[i] = Math.round(r * alpha + px[i] * (1 - alpha));
  px[i + 1] = Math.round(g * alpha + px[i + 1] * (1 - alpha));
  px[i + 2] = Math.round(b * alpha + px[i + 2] * (1 - alpha));
  px[i + 3] = Math.max(px[i + 3], Math.round(a));
}

function roundedRect(x0, y0, w, h, radius, colorAt) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const edge = Math.min(1, radius - dist); // 1px antialias
      const [r, g, b, a] = colorAt(x, y);
      blend(x, y, r, g, b, Math.round(a * edge));
    }
  }
}

// Background tile: diagonal cyan → indigo gradient.
roundedRect(0, 0, SIZE, SIZE, 56, (x, y) => {
  const t = (x + y) / (2 * SIZE);
  return [Math.round(34 + (99 - 34) * t), Math.round(211 + (102 - 211) * t), Math.round(238 + (247 - 238) * t), 255];
});

// Two device glyphs (phone outlines) joined by a bridge bar.
const dark = [11, 17, 32];
roundedRect(52, 66, 52, 124, 12, () => [...dark, 255]);
roundedRect(152, 66, 52, 124, 12, () => [...dark, 255]);
roundedRect(100, 118, 56, 20, 8, () => [...dark, 255]); // the "bridge"

// Screens (light inner panels) with a small pulse dot on each.
roundedRect(60, 78, 36, 88, 7, () => [230, 237, 247, 255]);
roundedRect(160, 78, 36, 88, 7, () => [230, 237, 247, 255]);
roundedRect(70, 96, 16, 16, 8, () => [34, 211, 238, 255]);
roundedRect(170, 96, 16, 16, 8, () => [129, 140, 248, 255]);

// --- Encode ------------------------------------------------------------------
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, png);
console.log(`[make-icon] wrote ${out} (${png.length} bytes)`);
