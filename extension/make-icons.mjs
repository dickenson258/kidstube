// 生成扩展图标（PNG）：与网站图标 public/icon.svg 同一造型——浅橙圆角底 + 蓝色圆角等边三角朵米、两只小眼睛、细线手脚。
// 纯 Node，无依赖：逐像素 4×4 超采样后写 PNG。用法：node extension/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'icons');
mkdirSync(OUT, { recursive: true });

// 64×64 设计坐标（与 icon.svg 一致）
const BG = [0xff, 0xe4, 0xd9], BLUE = [0x0a, 0x5c, 0xff], INK = [0x11, 0x11, 0x11], LIMB = [0x1c, 0x1b, 0x20];
const A = [32, 11.1], B = [51, 44], C = [13, 44], R = 3.2; // 三角形顶点与圆角半径（与 icon.svg 一致）
const insideRoundRect = (x, y) => {
  const r = 16, cx = Math.min(Math.max(x, r), 64 - r), cy = Math.min(Math.max(y, r), 64 - r);
  return x >= 0 && y >= 0 && x <= 64 && y <= 64 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// 圆角三角形 = 向内收缩 R 的三角形，再向外扩 R（到收缩三角形的距离 ≤ R）
const inc = (() => {
  const [a, b, c] = [A, B, C].map((p, i, P) => Math.hypot(P[(i + 1) % 3][0] - P[(i + 2) % 3][0], P[(i + 1) % 3][1] - P[(i + 2) % 3][1]));
  const s = a + b + c;
  return [(a * A[0] + b * B[0] + c * C[0]) / s, (a * A[1] + b * B[1] + c * C[1]) / s];
})();
const inr = (() => {
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
  const per = Math.hypot(B[0] - A[0], B[1] - A[1]) + Math.hypot(C[0] - B[0], C[1] - B[1]) + Math.hypot(A[0] - C[0], A[1] - C[1]);
  return (2 * area) / per;
})();
const k = (inr - R) / inr;
const T = [A, B, C].map(([x, y]) => [inc[0] + (x - inc[0]) * k, inc[1] + (y - inc[1]) * k]);
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const inTri = (p, [a, b, c]) => {
  const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (w[0] - u[0]) * (v[1] - u[1]);
  const d1 = s(a, b, p), d2 = s(b, c, p), d3 = s(c, a, p);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
};
const inBody = (x, y) => inTri([x, y], T) || Math.min(segDist([x, y], T[0], T[1]), segDist([x, y], T[1], T[2]), segDist([x, y], T[2], T[0])) <= R;
const inEye = (x, y) => [28.9, 35.1].some((cx) => ((x - cx) / 1.4) ** 2 + ((y - 26) / 2.3) ** 2 <= 1);
// 手脚：线宽 1.4（参照朵米原图：细线手脚、小圆点手） 的折线 / 二次曲线（采样成折线），手是小圆点
const quad = (p0, c, p1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });
// 打招呼：右手举起，左手自然下垂
const LIMBS = [quad([21, 32], [16.5, 34.5], [13, 38.5]), quad([42.5, 30.5], [49.5, 28.5], [50.5, 19.5]), [[27.5, 43], [27.5, 51], [24, 51]], [[36.5, 43], [36.5, 51], [40, 51]]];
const HANDS = [[13, 38.5], [50.5, 19.5]];
const inLimb = (x, y) => HANDS.some(([hx, hy]) => (x - hx) ** 2 + (y - hy) ** 2 <= 1.1 ** 2)
  || LIMBS.some((pl) => pl.slice(1).some((q, i) => segDist([x, y], pl[i], q) <= 0.7));

function render(size) {
  const ss = 4, px = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) {
    px[j * (size * 4 + 1)] = 0; // PNG 行过滤类型：无
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
        const x = ((i + (si + 0.5) / ss) / size) * 64, y = ((j + (sj + 0.5) / ss) / size) * 64;
        if (!insideRoundRect(x, y)) continue;
        const c = inEye(x, y) ? INK : inBody(x, y) ? BLUE : inLimb(x, y) ? LIMB : BG;
        r += c[0]; g += c[1]; b += c[2]; a += 255;
      }
      const n = ss * ss, o = j * (size * 4 + 1) + 1 + i * 4, cov = a / 255 || 1;
      px[o] = r / cov; px[o + 1] = g / cov; px[o + 2] = b / cov; px[o + 3] = a / n;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 位 RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff); }

for (const s of [16, 32, 48, 128]) writeFileSync(join(OUT, `icon${s}.png`), render(s));
console.log('icons written to', OUT);
