'use strict';
/* 生成卡通应用图标: 圆眼镜小书虫趴在打开的书上, 纯 JS 绘制 PNG 并打包为 ICO */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256, H = 256;
const px = new Uint8Array(W * H * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  if (a > 1) a = a / 255;   // 兼容 0-255 写法
  const i = (y * W + x) * 4;
  const na = a + px[i + 3] / 255 * (1 - a);
  if (na <= 0) return;
  px[i] = Math.round((r * a + px[i] * (px[i + 3] / 255) * (1 - a)) / na);
  px[i + 1] = Math.round((g * a + px[i + 1] * (px[i + 3] / 255) * (1 - a)) / na);
  px[i + 2] = Math.round((b * a + px[i + 2] * (px[i + 3] / 255) * (1 - a)) / na);
  px[i + 3] = Math.round(na * 255);
}

function fillCircle(cx, cy, rad, col) {
  const [r, g, b, a] = col;
  for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++)
    for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      const cov = Math.min(1, Math.max(0, rad - d + 0.5));
      if (cov > 0) blend(x, y, r, g, b, a * cov);
    }
}
function ring(cx, cy, rad, thick, col, a0 = 0, a1 = Math.PI * 2) {
  const [r, g, b, a] = col;
  for (let y = Math.floor(cy - rad - thick); y <= Math.ceil(cy + rad + thick); y++)
    for (let x = Math.floor(cx - rad - thick); x <= Math.ceil(cx + rad + thick); x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      let ang = Math.atan2(dy, dx);
      // 归一化到 [a0, a0+2π)
      while (ang < a0 - Math.PI) ang += Math.PI * 2;
      while (ang > a0 + Math.PI * 2) ang -= Math.PI * 2;
      if (ang < a0 || ang > a1) continue;
      const cov = Math.min(1, Math.max(0, (thick / 2) - Math.abs(d - rad) + 0.5));
      if (cov > 0) blend(x, y, r, g, b, a * cov);
    }
}
function fillRoundRect(x0, y0, x1, y1, rad, col) {
  const [r, g, b, a] = col;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const dx = Math.max(x0 + rad - x, x - (x1 - rad), 0);
      const dy = Math.max(y0 + rad - y, y - (y1 - rad), 0);
      const d = Math.hypot(dx, dy);
      const cov = Math.min(1, Math.max(0, rad - d + 0.5));
      if (cov > 0) blend(x, y, r, g, b, a * cov);
    }
}
function fillQuad(p1, p2, p3, p4, col) {
  const pts = [p1, p2, p3, p4];
  const [r, g, b, a] = col;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const sign = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      let inside = true, allPos = true, allNeg = true;
      for (let i = 0; i < 4; i++) {
        const A = pts[i], B = pts[(i + 1) % 4];
        const cr = sign(A[0], A[1], B[0], B[1], x + 0.5, y + 0.5);
        if (cr < 0) allPos = false;
        if (cr > 0) allNeg = false;
      }
      inside = allPos || allNeg;
      if (inside) blend(x, y, r, g, b, a);
    }
}
function line(x0, y0, x1, y1, width, col) {
  const [r, g, b, a] = col;
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let y = Math.floor(cy - width); y <= Math.ceil(cy + width); y++)
      for (let x = Math.floor(cx - width); x <= Math.ceil(cx + width); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = Math.min(1, Math.max(0, width - d + 0.4));
        if (cov > 0) blend(x, y, r, g, b, a * cov);
      }
  }
}
function sparkle(cx, cy, size, col) {
  fillQuad([cx, cy - size], [cx + size * 0.28, cy - size * 0.28], [cx + size, cy], [cx + size * 0.28, cy + size * 0.28], col);
  fillQuad([cx, cy - size], [cx - size * 0.28, cy - size * 0.28], [cx - size, cy], [cx - size * 0.28, cy + size * 0.28], col);
  fillQuad([cx, cy + size], [cx + size * 0.28, cy + size * 0.28], [cx + size, cy], [cx + size * 0.28, cy - size * 0.28], col);
  fillQuad([cx, cy + size], [cx - size * 0.28, cy + size * 0.28], [cx - size, cy], [cx - size * 0.28, cy - size * 0.28], col);
}

/* ============ 1. 背景: 暖黄圆角方 + 渐变 ============ */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = Math.max(14 + 50 - x, x - (242 - 50), 0);
    const dy = Math.max(14 + 50 - y, y - (242 - 50), 0);
    if (Math.hypot(dx, dy) > 50.5) continue;
    const t = Math.min(1, Math.max(0, (y - 14) / 228));
    blend(x, y, 255 - 18 * t, 232 - 68 * t, 178 - 82 * t, 1);  // #ffe8b2 → #e7b456
  }
}
ring(128, 128, 115, 5, [214, 142, 52, 160]);   // 外圈描边

/* ============ 2. 打开的书 (卡通厚页) ============ */
const BC = [201, 78, 58];       // 封面红
const PG = [255, 251, 238];     // 页面米白
// 封面底层(略大)
fillQuad([36, 192], [127, 176], [127, 232], [36, 248], [BC[0], BC[1], BC[2], 255]);
fillQuad([128, 176], [220, 192], [220, 248], [128, 232], [BC[0], BC[1], BC[2], 255]);
fillCircle(128, 178, 4, [BC[0], BC[1], BC[2], 255]);
// 页面
fillQuad([42, 194], [124, 180], [124, 224], [42, 238], [PG[0], PG[1], PG[2], 255]);
fillQuad([132, 180], [214, 194], [214, 238], [132, 224], [PG[0], PG[1], PG[2], 255]);
// 页面底边阴影
fillQuad([42, 230], [124, 216], [124, 224], [42, 238], [226, 210, 176, 255]);
fillQuad([132, 216], [214, 230], [214, 238], [132, 224], [226, 210, 176, 255]);
// 中缝
line(128, 178, 128, 230, 1.6, [214, 196, 160, 255]);
// 页面上的字线
line(54, 202, 112, 194, 1.1, [205, 188, 152, 255]);
line(54, 210, 112, 202, 1.1, [205, 188, 152, 255]);
line(54, 218, 106, 211, 1.1, [205, 188, 152, 255]);
line(144, 194, 202, 202, 1.1, [205, 188, 152, 255]);
line(144, 202, 202, 210, 1.1, [205, 188, 152, 255]);
line(144, 211, 192, 218, 1.1, [205, 188, 152, 255]);

/* ============ 3. 卡通书虫 (绿色毛毛虫, 从书里拱起) ============ */
const OUT = [88, 152, 52];      // 深绿描边
const BODY = [146, 216, 84];    // 主体绿
const BODY_HI = [188, 235, 130];// 高光绿
// 身体节(尾→头), 描边圈 + 填充 + 顶部高光
const segs = [
  [82, 178, 14], [95, 154, 15], [111, 130, 16], [130, 110, 17]
];
for (const [sx, sy, sr] of segs) {
  fillCircle(sx, sy, sr + 3, [OUT[0], OUT[1], OUT[2], 255]);
  fillCircle(sx, sy, sr, [BODY[0], BODY[1], BODY[2], 255]);
  fillCircle(sx - sr * 0.25, sy - sr * 0.35, sr * 0.55, [BODY_HI[0], BODY_HI[1], BODY_HI[2], 120]);
}
// 头
const hx = 162, hy = 84, hr = 31;
fillCircle(hx, hy, hr + 3, [OUT[0], OUT[1], OUT[2], 255]);
fillCircle(hx, hy, hr, [BODY[0], BODY[1], BODY[2], 255]);
fillCircle(hx - 9, hy - 11, 13, [BODY_HI[0], BODY_HI[1], BODY_HI[2], 130]);

/* ============ 4. 圆眼镜 + 大眼睛 + 笑脸 ============ */
const LENS = [58, 42, 26];
const ex1 = hx - 13, ey1 = hy - 4, ex2 = hx + 13, ey2 = hy - 6;
fillCircle(ex1, ey1, 10.5, [255, 255, 255, 255]);
fillCircle(ex2, ey2, 10.5, [255, 255, 255, 255]);
fillCircle(ex1 + 1.5, ey1 + 1, 4.6, [42, 28, 14, 255]);
fillCircle(ex2 + 1.5, ey2 + 1, 4.6, [42, 28, 14, 255]);
fillCircle(ex1 - 1.5, ey1 - 2.5, 1.8, [255, 255, 255, 240]);
fillCircle(ex2 - 1.5, ey2 - 2.5, 1.8, [255, 255, 255, 240]);
// 镜框
ring(ex1, ey1, 11.5, 3, [LENS[0], LENS[1], LENS[2], 255]);
ring(ex2, ey2, 11.5, 3, [LENS[0], LENS[1], LENS[2], 255]);
line(ex1 + 11.5, ey1 - 3, ex2 - 11.5, ey2 - 3, 1.8, [LENS[0], LENS[1], LENS[2], 255]);
line(ex1 - 11.5, ey1 - 1, hx - hr + 4, hy - 2, 1.8, [LENS[0], LENS[1], LENS[2], 255]);
line(ex2 + 11.5, ey2 - 1, hx + hr - 4, hy - 3, 1.8, [LENS[0], LENS[1], LENS[2], 255]);
// 微笑
ring(hx + 1, hy + 12, 7, 2.6, [LENS[0], LENS[1], LENS[2], 255], Math.PI * 0.15, Math.PI * 0.85);
// 腮红
fillCircle(hx - 22, hy + 10, 4.5, [255, 130, 130, 110]);
fillCircle(hx + 24, hy + 8, 4.5, [255, 130, 130, 110]);
// 触角
line(hx - 12, hy - 28, hx - 18, hy - 40, 2.2, [OUT[0], OUT[1], OUT[2], 255]);
fillCircle(hx - 19, hy - 42, 3.5, [255, 196, 84, 255]);
line(hx + 12, hy - 28, hx + 18, hy - 40, 2.2, [OUT[0], OUT[1], OUT[2], 255]);
fillCircle(hx + 19, hy - 42, 3.5, [255, 196, 84, 255]);

/* ============ 5. 星星点缀 ============ */
sparkle(48, 66, 9, [255, 255, 255, 200]);
sparkle(210, 52, 11, [255, 255, 255, 220]);
sparkle(226, 128, 7, [255, 224, 130, 230]);
sparkle(36, 128, 6, [255, 224, 130, 210]);

/* ---------- PNG 编码 ---------- */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

/* ---------- ICO 封装 ---------- */
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;             // 256px
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([header, entry, png]);

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), png);
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log('cartoon icon written:', png.length, 'bytes png,', ico.length, 'bytes ico');
