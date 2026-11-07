'use strict';
// 最小的 PNG 编码（RGBA，不依赖任何库）：新建游戏时画几张占位的系统图（窗口、按钮）
//   const c = canvas(w, h); c.rect(x, y, w, h, [r, g, b, a]); c.px(x, y, rgba); encodePng(c)
const zlib = require('zlib');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function canvas(w, h) {
  const data = Buffer.alloc(w * h * 4);
  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4, a = c[3] == null ? 255 : c[3];
    if (a >= 255 || !data[i + 3]) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a; return; }
    // 半透明叠在已有颜色上
    const k = a / 255, ob = data[i + 3] / 255, oa = k + ob * (1 - k);
    for (let j = 0; j < 3; j++) data[i + j] = Math.round((c[j] * k + data[i + j] * ob * (1 - k)) / oa);
    data[i + 3] = Math.round(oa * 255);
  };
  const rect = (x, y, rw, rh, c) => { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) px(xx, yy, c); };
  const frame = (x, y, rw, rh, c, t = 1) => { rect(x, y, rw, t, c); rect(x, y + rh - t, rw, t, c); rect(x, y, t, rh, c); rect(x + rw - t, y, t, rh, c); };
  return { w, h, data, px, rect, frame };
}

function encodePng(c) {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    c.data.copy(raw, y * (c.w * 4 + 1) + 1, y * c.w * 4, (y + 1) * c.w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { canvas, encodePng, crc32 };
