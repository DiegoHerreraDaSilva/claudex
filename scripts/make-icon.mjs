import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "build");
const outFile = resolve(outDir, "icon.png");

const SIZE = 1024;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function roundedRectDistance(x, y, halfW, halfH, radius) {
  const dx = Math.max(Math.abs(x) - (halfW - radius), 0);
  const dy = Math.max(Math.abs(y) - (halfH - radius), 0);
  return Math.hypot(dx, dy) - radius;
}

const bg = [20, 22, 28, 255];
const ring = [180, 142, 237, 255];
const dot = [122, 162, 247, 255];

const half = SIZE / 2;
const data = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const px = x - half + 0.5;
    const py = y - half + 0.5;
    const i = (y * SIZE + x) * 4;

    const rectDist = roundedRectDistance(px, py, half - 70, half - 70, 190);
    const bgCov = clamp01(0.5 - rectDist * 1.6);

    const d = Math.hypot(px, py);
    const angle = Math.abs((Math.atan2(py, px) * 180) / Math.PI);
    const inGap = angle < 42;
    const outerCov = clamp01(0.5 - (d - 340) * 1.6);
    const innerCov = clamp01(0.5 - (215 - d) * 1.6);
    let ringCov = Math.min(outerCov, innerCov);
    if (inGap) ringCov = 0;

    const dotDist = Math.hypot(px - 330, py - 0);
    const dotCov = clamp01(0.5 - (dotDist - 58) * 1.6);

    let R = 0;
    let G = 0;
    let B = 0;
    let A = 0;
    const over = (color, cov) => {
      R = color[0] * cov + R * (1 - cov);
      G = color[1] * cov + G * (1 - cov);
      B = color[2] * cov + B * (1 - cov);
      A = cov + A * (1 - cov);
    };
    over(bg, bgCov);
    over(ring, ringCov);
    over(dot, dotCov);

    data[i] = Math.round(R);
    data[i + 1] = Math.round(G);
    data[i + 2] = Math.round(B);
    data[i + 3] = Math.round(A * 255);
  }
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(body.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([lenBuf, typeBuf, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  data.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${png.length} bytes)`);
