'use strict';
// 读写 zip（不依赖第三方包）
//   listZip(file)                    → [{ name, dir, method, csize, size, offset, encrypted }]
//   extractEntry(file, entry, dest)  → Promise（流式解压，大文件不进内存）
//   writeZip(entries)                → Buffer（entries = [{ name, data }]，给「导出改动」用，deflate 压缩）
// 支持 ZIP64（超过 4GB / 65535 个文件）；文件名不是 UTF-8 时按 GBK 解（Windows 上压的中文名）
const fs = require('fs');
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50, SIG_EOCD64 = 0x06064b50, SIG_LOC64 = 0x07064b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (!n) break;
    off += n;
  }
  return off === len ? buf : buf.subarray(0, off);
}
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

let gbk = null;
try { gbk = new TextDecoder('gbk'); } catch { }
const utf8strict = new TextDecoder('utf-8', { fatal: true });
function decodeName(bytes, flags) {
  if (flags & 0x800) return bytes.toString('utf8');
  try { return utf8strict.decode(bytes); } catch { }
  if (gbk) { try { return gbk.decode(bytes); } catch { } }
  return bytes.toString('latin1');
}

function listZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw new Error('不是 zip 文件（太小）');
    const tailLen = Math.min(size, 65557 + 22);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { e = i; break; }
    if (e < 0) throw new Error('不是 zip 文件（找不到目录）。rar / 7z 请先转成 zip');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const lp = e - 20;
      if (lp >= 0 && tail.readUInt32LE(lp) === SIG_LOC64) {
        const z64 = u64(tail, lp + 8);
        const h = readAt(fd, z64, 56);
        if (h.readUInt32LE(0) !== SIG_EOCD64) throw new Error('zip64 目录坏了');
        count = u64(h, 32); cdSize = u64(h, 40); cdOff = u64(h, 48);
      }
    }
    // 目录大小 / 条目数都来自文件本身，不能直接拿去分配内存：夹到文件实际大小以内，坏包只报错不 OOM
    if (cdOff > size) throw new Error('zip 目录坏了（偏移超出文件）');
    const cdLen = Math.min(cdSize, size - cdOff);
    count = Math.min(count, Math.floor(cdLen / 46));
    const cd = readAt(fd, cdOff, cdLen);
    const out = [];
    let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== SIG_CEN) throw new Error('zip 目录坏了');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const nameBytes = cd.subarray(p + 46, p + 46 + nl);
      const extra = cd.subarray(p + 46 + nl, p + 46 + nl + xl);
      let name = decodeName(nameBytes, flags);
      for (let x = 0; x + 4 <= extra.length;) {
        const id = extra.readUInt16LE(x), len = extra.readUInt16LE(x + 2), d = extra.subarray(x + 4, x + 4 + len);
        if (id === 0x0001) {   // zip64：大小 / 偏移
          let q = 0;
          if (usize === 0xffffffff && q + 8 <= d.length) { usize = u64(d, q); q += 8; }
          if (csize === 0xffffffff && q + 8 <= d.length) { csize = u64(d, q); q += 8; }
          if (offset === 0xffffffff && q + 8 <= d.length) { offset = u64(d, q); q += 8; }
        } else if (id === 0x7075 && d.length > 5) name = d.subarray(5).toString('utf8');   // Info-ZIP 的 UTF-8 文件名
        x += 4 + len;
      }
      name = name.replace(/\\/g, '/');
      out.push({ name, dir: name.endsWith('/'), method, csize, size: usize, offset, encrypted: !!(flags & 1) });
      p += 46 + nl + xl + cl;
    }
    return out;
  } finally { fs.closeSync(fd); }
}

// 解出一个文件。dest 由调用方保证在目标目录里面
function extractEntry(file, entry, dest) {
  return new Promise((resolve, reject) => {
    if (entry.encrypted) return reject(new Error('压缩包有密码：' + entry.name));
    if (entry.method !== 0 && entry.method !== 8) return reject(new Error('不支持的压缩方式（' + entry.method + '）：' + entry.name + '，请用普通 zip 重新压缩'));
    let start;
    const fd = fs.openSync(file, 'r');
    try {
      const h = readAt(fd, entry.offset, 30);
      if (h.readUInt32LE(0) !== SIG_LOC) throw new Error('zip 文件坏了：' + entry.name);
      start = entry.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    } catch (e) { fs.closeSync(fd); return reject(e); }
    fs.closeSync(fd);
    const out = fs.createWriteStream(dest);
    out.on('error', reject);
    out.on('finish', resolve);
    if (!entry.csize) return out.end();
    const src = fs.createReadStream(file, { start, end: start + entry.csize - 1 });
    src.on('error', reject);
    if (entry.method === 0) src.pipe(out);
    else { const inf = zlib.createInflateRaw(); inf.on('error', e => reject(new Error('解压失败：' + entry.name + '（' + e.message + '）'))); src.pipe(inf).pipe(out); }
  });
}

// ---------- 写 ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function writeZip(entries) {
  const parts = [], cen = [];
  let off = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const def = zlib.deflateRawSync(raw);
    const useDef = def.length < raw.length;
    const body = useDef ? def : raw;
    const crc = crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(SIG_LOC, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(useDef ? 8 : 0, 8);
    loc.writeUInt16LE(dosTime, 10); loc.writeUInt16LE(dosDate, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(body.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(name.length, 26); loc.writeUInt16LE(0, 28);
    parts.push(loc, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(SIG_CEN, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(useDef ? 8 : 0, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    cen.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cenBuf = Buffer.concat(cen);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

module.exports = { listZip, extractEntry, writeZip, crc32 };
