// Gera build/icon.png (1024 px) e build/icon.ico (16–256 px) em Node puro.
// Não abre o Electron nem navegador: roda com `node scripts/make-icon.mjs`.
// Desenho: quadrado arredondado grafite, um "C" com degradê teal → índigo e um ponto teal.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build");
const VIEW = 1024;

const BG_A = [0x1b, 0x1d, 0x2b];
const BG_B = [0x07, 0x07, 0x0c];
const MARK_A = [0x2d, 0xd4, 0xbf];
const MARK_B = [0x81, 0x8c, 0xf8];
const DOT = [0x2d, 0xd4, 0xbf];

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function roundedRect(x, y) {
  const half = 480,
    radius = 220;
  const dx = Math.max(Math.abs(x - 512) - (half - radius), 0);
  const dy = Math.max(Math.abs(y - 512) - (half - radius), 0);
  const outside = Math.hypot(dx, dy) - radius;
  const inside = Math.min(Math.max(Math.abs(x - 512), Math.abs(y - 512)) - half, 0);
  return dx > 0 || dy > 0 ? outside : inside;
}

// Arco do "C": centro (512,512), raio 268, traço 118, aberto à direita (±41°), pontas redondas.
const ARC_R = 268,
  ARC_HALF = 59,
  GAP = Math.atan2(194, 223);
const CAP_X = 512 + ARC_R * Math.cos(GAP),
  CAP_Y = ARC_R * Math.sin(GAP);
function arc(x, y) {
  const px = x - 512,
    py = y - 512;
  if (Math.abs(Math.atan2(py, px)) >= GAP) return Math.abs(Math.hypot(px, py) - ARC_R) - ARC_HALF;
  return Math.hypot(x - CAP_X, Math.abs(py) - CAP_Y) - ARC_HALF;
}
const dot = (x, y) => Math.hypot(x - 720, y - 512) - 46;

function over(dst, color, alpha) {
  const a = alpha + dst[3] * (1 - alpha);
  if (a <= 0) return [0, 0, 0, 0];
  const mix = (i) => (color[i] * alpha + dst[i] * dst[3] * (1 - alpha)) / a;
  return [mix(0), mix(1), mix(2), a];
}

function render(size) {
  const scale = size / VIEW;
  const samples = size <= 64 ? 4 : size <= 256 ? 2 : 1;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;
          const cover = (d) => clamp01(0.5 - d * scale * samples);
          const t = clamp01((x + y) / (2 * VIEW));
          let c = [0, 0, 0, 0];
          const rect = roundedRect(x, y);
          c = over(c, lerp(BG_A, BG_B, t), cover(rect));
          c = over(c, [255, 255, 255], 0.1 * cover(Math.abs(rect + 3) - 3));
          c = over(c, lerp(MARK_A, MARK_B, t), cover(arc(x, y)) * cover(rect));
          c = over(c, DOT, cover(dot(x, y)));
          // Pré-multiplica para a média das subamostras.
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      const n = samples * samples,
        o = (py * size + px) * 4,
        a = acc[3] / n;
      rgba[o] = a ? Math.round(acc[0] / acc[3]) : 0;
      rgba[o + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      rgba[o + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      rgba[o + 3] = Math.round(a * 255);
    }
  return rgba;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = new Map([...icoSizes, 1024].map((s) => [s, png(s)]));
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "icon.png"), images.get(1024));

const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const o = 6 + i * 16,
    data = images.get(s);
  header[o] = s === 256 ? 0 : s;
  header[o + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, o + 4);
  header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(data.length, o + 8);
  header.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
writeFileSync(
  resolve(outDir, "icon.ico"),
  Buffer.concat([header, ...icoSizes.map((s) => images.get(s))]),
);
console.log(`[make-icon] ${resolve(outDir, "icon.png")} e icon.ico (${icoSizes.join(", ")} px)`);
