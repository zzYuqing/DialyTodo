// 职责：生成 Tauri 打包所需的图标文件（圆角蓝底 + 白色对勾）。
// 仅使用 Node 内置模块（zlib / fs / path / url），不引入任何第三方依赖。
// 用法（在项目根目录执行）：
//   node scripts/make-icons.mjs
// 生成到 src-tauri/icons/：32x32.png、128x128.png、128x128@2x.png、icon.png、icon.ico

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- 配色：与 styles/theme.css 的强调色保持一致 ----
const BG = [0x3b, 0x7d, 0xdd];
const FG = [0xff, 0xff, 0xff];

// ---- CRC32（PNG chunk 校验）----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** 将 RGBA 像素数组编码为 PNG */
function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型：RGBA
  ihdr[10] = 0; // 压缩方式
  ihdr[11] = 0; // 滤波方式
  ihdr[12] = 0; // 隔行扫描

  // 每行前置一个滤波类型字节（0 = None）
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let i = 0; i < size * 4; i++) {
      raw[y * stride + 1 + i] = pixels[y * size * 4 + i];
    }
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 图形定义（归一化到单位正方形）----

/** 点 (px,py) 到线段 ab 的最短距离 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 对勾：两段线段组成 */
function inCheckMark(x, y) {
  const width = 0.095;
  return (
    distanceToSegment(x, y, 0.28, 0.52, 0.44, 0.68) <= width ||
    distanceToSegment(x, y, 0.44, 0.68, 0.74, 0.34) <= width
  );
}

/** 圆角矩形 */
function inRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** 4x4 超采样渲染，得到抗锯齿边缘 */
function renderPixels(size) {
  const out = new Uint8Array(size * size * 4);
  const SS = 4;
  const total = SS * SS;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      let marked = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (inRoundedRect(u, v, 0.22)) {
            cover += 1;
            if (inCheckMark(u, v)) marked += 1;
          }
        }
      }

      const i = (y * size + x) * 4;
      const markRatio = cover === 0 ? 0 : marked / cover;
      const alpha = cover / total;
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round(BG[c] * (1 - markRatio) + FG[c] * markRatio);
      }
      out[i + 3] = Math.round(255 * alpha);
    }
  }

  return out;
}

/** 打包 ICO：目录头 + 目录项 + 内嵌 PNG（Vista 及以上支持 PNG 压缩的 ICO） */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + 16 * entries.length;
  const dirs = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0; // 调色板色数
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // 位深
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += entry.png.length;
    dirs.push(dir);
  }

  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

// ---- 主流程 ----
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const iconDir = join(projectRoot, "src-tauri", "icons");
mkdirSync(iconDir, { recursive: true });

const pngBySize = new Map();
for (const size of [16, 32, 48, 128, 256, 512]) {
  pngBySize.set(size, encodePng(size, renderPixels(size)));
}

writeFileSync(join(iconDir, "32x32.png"), pngBySize.get(32));
writeFileSync(join(iconDir, "128x128.png"), pngBySize.get(128));
writeFileSync(join(iconDir, "128x128@2x.png"), pngBySize.get(256));
writeFileSync(join(iconDir, "icon.png"), pngBySize.get(512));

const icoEntries = [16, 32, 48, 256].map((size) => ({
  size,
  png: pngBySize.get(size),
}));
writeFileSync(join(iconDir, "icon.ico"), encodeIco(icoEntries));

console.log("图标已生成：src-tauri/icons/");
console.log("  32x32.png、128x128.png、128x128@2x.png、icon.png、icon.ico");
