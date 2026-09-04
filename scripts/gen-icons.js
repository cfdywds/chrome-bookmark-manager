// ===== 书签管家 · 扩展图标生成（零依赖，仅用 Node 内置 zlib）=====
// 「蓝色极光」设计系统同源：圆角方徽 + 蓝→青对角渐变 + 白色书签缎带。
// 用法：node scripts/gen-icons.js
'use strict';

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIZES = [16, 32, 48, 128];
// 与 css/popup.css --grad 保持一致（DRY：改色时两处需同步）
const GRAD_FROM = [37, 99, 235];   // #2563eb
const GRAD_TO = [14, 165, 233];    // #0ea5e9

// ---- PNG 编码（RGBA8，filter 0）----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- 形状覆盖判定（4x 超采样抗锯齿）----
const SS = 4;

function insideRoundedRect(x, y, s, radius) {
  if (x < 0 || y < 0 || x > s || y > s) return false;
  const r = radius;
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  // 角部区域用圆角判定；内部直接命中
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ||
    (x >= r && x <= s - r) || (y >= r && y <= s - r);
}

// 书签缎带：竖向矩形 + 底部中央上凹的三角缺口（比例坐标）
const RIBBON = {
  left: 0.29, right: 0.71,     // 宽 0.42s
  top: 0.185, bottom: 0.815,   // 高 0.63s
  corner: 0.05,                // 顶角圆角
  notchDepth: 0.16             // 底部缺口深度
};

function insideRibbon(x, y, s) {
  const r = RIBBON;
  const x0 = r.left * s, x1 = r.right * s;
  const y0 = r.top * s, y1 = r.bottom * s;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  // 顶部两角圆角
  const cr = r.corner * s;
  if (y < y0 + cr) {
    const cx = Math.min(Math.max(x, x0 + cr), x1 - cr);
    if ((x - cx) ** 2 + (y - (y0 + cr)) ** 2 > cr * cr) return false;
  }
  // 底部三角缺口：顶点在 (中点, y1 - notchDepth)，开口向下
  const notchApex = y1 - r.notchDepth * s;
  if (y > notchApex) {
    const t = (y - notchApex) / (y1 - notchApex);         // 0→1 由顶点向下
    const halfSpan = ((x1 - x0) / 2) * t;
    if (Math.abs(x - s / 2) <= halfSpan) return false;
  }
  return true;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cornerRadius = size * 0.225;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let glyphHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (!insideRoundedRect(x, y, size, cornerRadius)) continue;
          bgHits++;
          if (insideRibbon(x, y, size)) glyphHits++;
        }
      }
      const bgCoverage = bgHits / (SS * SS);
      const glyphCoverage = glyphHits / (SS * SS);
      const offset = (py * size + px) * 4;
      if (bgCoverage === 0) { rgba[offset + 3] = 0; continue; }
      // 对角渐变：左上 #2563eb → 右下 #0ea5e9
      const t = Math.min(1, Math.max(0, ((px + 0.5) / size + (py + 0.5) / size) / 2));
      const r = GRAD_FROM[0] + (GRAD_TO[0] - GRAD_FROM[0]) * t;
      const g = GRAD_FROM[1] + (GRAD_TO[1] - GRAD_FROM[1]) * t;
      const b = GRAD_FROM[2] + (GRAD_TO[2] - GRAD_FROM[2]) * t;
      // 白色缎带按覆盖率与底色混合
      rgba[offset] = Math.round(r + (255 - r) * glyphCoverage);
      rgba[offset + 1] = Math.round(g + (255 - g) * glyphCoverage);
      rgba[offset + 2] = Math.round(b + (255 - b) * glyphCoverage);
      rgba[offset + 3] = Math.round(bgCoverage * 255);
    }
  }
  return rgba;
}

const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, renderIcon(size));
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`已生成 ${file} (${png.length} bytes)`);
}
