'use strict';
// 导入素材包：先放进暂存区，看清楚分到哪里再导入
//   POST upload/assets?id=&name=相对路径      上传一个文件（zip 会解开），没有 id 就新开一个暂存区
//   GET  assets/staging?id=                   暂存区里每个文件：类型、尺寸、自动分到哪一类、目标名字、有没有同名
//   GET  assets/file?id=&path=                预览（加密的图解密后给）
//   POST assets/commit {id, files:[{path, sub, name, conflict}]}   导入；conflict = rename（默认）/ overwrite / skip
//   POST assets/discard {id}
// 分类：路径里有 RPG Maker 的目录名（img/characters、audio/bgm…）就照它；否则看名字和图片尺寸猜；猜不准的都放「图片」，可以在预览里改
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { need, UserError } = require('../lib/util.js');
const { listZip, extractEntry } = require('../core/zip.js');

const IMG_SUBS = ['pictures', 'characters', 'faces', 'tilesets', 'parallaxes', 'battlebacks1', 'battlebacks2', 'enemies', 'sv_actors', 'sv_enemies', 'animations', 'system', 'titles1', 'titles2'];
const AUDIO_SUBS = ['bgm', 'bgs', 'me', 'se'];
const SKIP = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
const PNG_HEAD = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const FAKE = Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);
const ROOT = path.join(os.tmpdir(), 'rpgstudio-assets-' + crypto.createHash('sha256').update(__dirname).digest('hex').slice(0, 16));

// 加密过的 PNG（.png_ / .rpgmvp，可能来自别的游戏）：PNG 文件开头 16 字节是固定的，拿它就能反推出密钥
function decryptPng(buf) {
  if (buf.length < 32 || !buf.subarray(0, 16).equals(FAKE)) return null;
  const body = Buffer.from(buf.subarray(16));
  for (let i = 0; i < 16; i++) body[i] = PNG_HEAD[i];
  return body;
}
function imageSize(buf) {
  if (buf.length > 24 && buf.subarray(0, 8).equals(PNG_HEAD.subarray(0, 8))) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: 'jpg' };
      i += 2 + len;
    }
    return { w: 0, h: 0, type: 'jpg' };
  }
  if (buf.length > 30 && buf.subarray(8, 12).toString() === 'WEBP') {
    const f = buf.subarray(12, 16).toString();
    if (f === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), type: 'webp' };
    if (f === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: 'webp' };
    if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, type: 'webp' }; }
    return { w: 0, h: 0, type: 'webp' };
  }
  return null;
}
const kindOf = ext => (['.png', '.png_', '.rpgmvp', '.jpg', '.jpeg', '.webp'].includes(ext) ? 'image'
  : ['.ogg', '.m4a', '.ogg_', '.m4a_', '.rpgmvo', '.rpgmvm', '.mp3', '.wav'].includes(ext) ? 'audio'
    : ['.webm', '.mp4'].includes(ext) ? 'video' : 'other');

// 猜分类：先看路径里的目录名，再看名字，最后看尺寸
function classify(rel, kind, size, w, h) {
  const segs = rel.split('/');
  const lower = segs.map(s => s.toLowerCase());
  const base = segs[segs.length - 1].replace(/\.[^.]+$/, '');
  const pathL = rel.toLowerCase();
  const tail = i => segs.slice(i + 1).join('/').replace(/\.[^.]+$/, '');
  if (kind === 'image') {
    for (let i = lower.length - 2; i >= 0; i--) if (IMG_SUBS.includes(lower[i])) return { sub: lower[i], name: tail(i), why: '目录 ' + segs[i] };
    if (/^[!$]/.test(base)) return { sub: 'characters', name: base, why: '名字以 ' + base[0] + ' 开头' };
    if (/(^|[\/_\-\s])(faces?|头像|顔)([\/_\-\s.]|$)/i.test(pathL)) return { sub: 'faces', name: base, why: '名字里有 face' };
    if (/_(a[1-5]|[b-e])$/i.test(base) || /tileset|图块/.test(pathL)) return { sub: 'tilesets', name: base, why: '图块的名字' };
    if (/parallax|远景/.test(pathL)) return { sub: 'parallaxes', name: base, why: '名字里有 parallax' };
    if (/battleback|战斗背景/.test(pathL)) return { sub: 'battlebacks1', name: base, why: '名字里有 battleback' };
    if (/sv_?actor/.test(pathL)) return { sub: 'sv_actors', name: base, why: '名字里有 sv_actor' };
    if (/(^|[\/_\-\s])(enem(y|ies)|敌人|怪物)/.test(pathL)) return { sub: 'enemies', name: base, why: '名字里有 enemy' };
    if (/title|标题/.test(pathL) && w >= 800) return { sub: 'titles1', name: base, why: '名字里有 title' };
    if (w && h) {
      if (w % 144 === 0 && h % 144 === 0 && w <= 576 && h <= 288 && (w / 144) * (h / 144) >= 2) return { sub: 'faces', name: base, why: `${w}×${h} 是头像图（144 一格）` };
      // 屏幕大小的图（816×624 之类）刚好也能被 12×8 整除，所以宽度 800 以上的不当行走图
      if (w < 800 && w % 12 === 0 && h % 8 === 0) { const fw = w / 12, fh = h / 8; if (fw >= 32 && fw <= 64 && fh >= 32 && fh <= 128) return { sub: 'characters', name: base, why: `${w}×${h} 能切成 12×8 格行走图` }; }
      if (w % 3 === 0 && h % 4 === 0 && w <= 288 && h <= 512) { const fw = w / 3, fh = h / 4; if (fw >= 32 && fw <= 96 && fh >= 32 && fh <= 128 && fh >= fw * 0.8) return { sub: 'characters', name: '$' + base, why: `${w}×${h} 像单人行走图（3×4 格，名字前加 $）` }; }
    }
    return { sub: 'pictures', name: base, why: '其它图都当图片（立绘 / CG）' };
  }
  if (kind === 'audio') {
    for (let i = lower.length - 2; i >= 0; i--) if (AUDIO_SUBS.includes(lower[i])) return { sub: lower[i], name: tail(i), why: '目录 ' + segs[i] };
    const m = /(^|[\/_\-\s])(bgm|bgs|me|se)([\/_\-\s\d]|$)/i.exec(pathL);
    if (m) return { sub: m[2].toLowerCase(), name: base, why: '名字里有 ' + m[2] };
    return size > 600 * 1024 ? { sub: 'bgm', name: base, why: '比较大，当背景音乐' } : { sub: 'se', name: base, why: '比较小，当音效' };
  }
  if (kind === 'video') return { sub: 'movies', name: base, why: '视频' };
  return { sub: '', name: base, why: '' };
}

module.exports = function (ctx) {
  const { project } = ctx;
  const maxUpload = () => { const m = ctx.opts.projects && ctx.opts.projects.maxUpload; return Number(typeof m === 'function' ? m() : m) || 2 * 1024 * 1024 * 1024; };
  // 不同服务、用户工作区和工程各自暂存，不能互相读、覆盖或清理。
  const stageRoot = () => path.join(ctx.opts.assetsDir || ROOT, ctx.projectKey());
  const stageDir = id => { need(/^[a-z0-9]{6,32}$/.test(String(id || '')), '暂存区不对'); return path.join(stageRoot(), id); };
  const inStage = (id, rel) => {
    const d = stageDir(id);
    const f = path.resolve(d, String(rel || '').replace(/\\/g, '/'));
    need(f.startsWith(d + path.sep), '路径不对');
    return f;
  };
  // 一天以前的暂存区清掉
  const sweep = () => { try { for (const n of fs.readdirSync(stageRoot())) { const f = path.join(stageRoot(), n); if (Date.now() - fs.statSync(f).mtimeMs > 86400000) fs.rmSync(f, { recursive: true, force: true }); } } catch { } };
  const cloud = () => !!ctx.uploadRoot();   // 云端：图片放用户工作区，声音 / 视频暂时不支持
  const walk = (d, rel, out) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
    for (const e of list) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (SKIP.test(r) || e.name.startsWith('.upload-')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r, out); else out.push(r);
    }
    return out;
  };

  function staging(id) {
    const d = stageDir(id);
    need(fs.existsSync(d), '暂存区不见了（超过一天会自动清掉），重新上传吧');
    const sys = project.sys();
    const files = walk(d, '', []).sort().map(rel => {
      const full = path.join(d, rel);
      const size = fs.statSync(full).size;
      const ext = path.extname(rel).toLowerCase();
      const kind = kindOf(ext);
      let w = 0, h = 0, encrypted = false, problem = '', type = ext.slice(1);
      if (kind === 'image') {
        let head = Buffer.alloc(0);
        try { const fd = fs.openSync(full, 'r'); head = Buffer.alloc(Math.min(size, 65536)); fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd); } catch { }
        if (head.subarray(0, 16).equals(FAKE)) { encrypted = true; const dec = decryptPng(head); const s = dec && imageSize(dec); if (s) { w = s.w; h = s.h; type = 'png'; } }
        else { const s = imageSize(head); if (s) { w = s.w; h = s.h; type = s.type; } }
        if (type !== 'png') problem = type === 'jpg' || type === 'jpeg' || type === 'webp' ? 'needPng' : 'bad';
      } else if (kind === 'audio') {
        if (['.ogg_', '.m4a_', '.rpgmvo', '.rpgmvm'].includes(ext)) problem = 'encryptedAudio';
        else if (!['.ogg', '.m4a'].includes(ext)) problem = 'audioFormat';
        else if (cloud()) problem = 'cloudAudio';
      } else if (kind === 'video') { if (cloud()) problem = 'cloudAudio'; }
      const c = classify(rel, kind, size, w, h);
      const assetKind = kind === 'image' ? 'img' : kind === 'audio' ? 'audio' : 'movie';
      const exists = kind !== 'other' && c.sub ? project.assetExists(assetKind, c.sub, c.name, kind === 'image' ? ctx.uploadRoot() : null, ext) : false;
      return { path: rel, size, kind, type, w, h, encrypted, problem, sub: c.sub, name: c.name, why: c.why, exists };
    });
    return {
      id, files,
      game: { encryptedImages: !!sys.hasEncryptedImages, encryptedAudio: !!sys.hasEncryptedAudio, engine: project.engine().name, cloud: cloud() },
      subs: { image: IMG_SUBS, audio: AUDIO_SUBS },
    };
  }

  return {
    get: {
      'assets/staging': (T, q) => staging(String(q('id') || '')),
      'assets/file'(T, q) {
        const f = inStage(q('id'), q('path'));
        need(fs.existsSync(f), '文件不存在');
        let buf = fs.readFileSync(f);
        const ext = path.extname(f).toLowerCase();
        const dec = decryptPng(buf);
        if (dec) buf = dec;
        const s = imageSize(buf);
        const type = s ? 'image/' + (s.type === 'jpg' ? 'jpeg' : s.type) : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : ext === '.webm' ? 'video/webm' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
        return { raw: { status: 200, type, headers: { 'cache-control': 'no-store' }, body: buf } };
      },
    },
    post: {
      // 导入：每个文件按选好的分类 / 名字写进游戏；同名的按 conflict 处理
      'assets/commit'(T, b) {
        const id = String(b.id || '');
        stageDir(id);
        const list = Array.isArray(b.files) ? b.files : [];
        need(list.length, '没有要导入的文件');
        const sys = project.sys();
        const backupDir = ctx.assetBackupDir('assets');
        const done = [], skipped = [], failed = [];
        for (const it of list) {
          const f = inStage(id, it.path);
          const ext = path.extname(f).toLowerCase();
          const kind = kindOf(ext);
          const sub = String(it.sub || '');
          let name = String(it.name || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          try {
            need(fs.existsSync(f), '文件不存在');
            need(name, '名字是空的');
            let buf = fs.readFileSync(f), assetKind, outExt, encrypt;
            if (kind === 'image') {
              need(IMG_SUBS.includes(sub), '图片的分类不对：' + sub);
              buf = decryptPng(buf) || buf;
              const s = imageSize(buf);
              need(s && s.type === 'png', 'RPG Maker 只认 PNG，这张不是（jpg / webp 在页面里会先转好）');
              assetKind = 'img'; outExt = '.png'; encrypt = ctx.uploadRoot() ? false : !!sys.hasEncryptedImages;
            } else if (kind === 'audio') {
              need(AUDIO_SUBS.includes(sub), '声音的分类不对：' + sub);
              need(['.ogg', '.m4a'].includes(ext), 'RPG Maker 只认 ogg / m4a 的声音');
              need(!cloud(), '云端暂时只能导入图片');
              assetKind = 'audio'; outExt = ext; encrypt = !!sys.hasEncryptedAudio;
            } else if (kind === 'video') {
              need(!cloud(), '云端暂时只能导入图片');
              assetKind = 'movie'; outExt = ext; encrypt = false;
            } else throw new UserError('不是图片 / 声音 / 视频');
            const root = assetKind === 'img' ? ctx.uploadRoot() : null;
            let finalName = name;
            if (project.assetExists(assetKind, sub, name, root, outExt)) {
              if (it.conflict === 'skip') { skipped.push({ path: it.path, name }); continue; }
              if (it.conflict !== 'overwrite') { let n = 2; while (project.assetExists(assetKind, sub, name + '_' + n, root, outExt)) n++; finalName = name + '_' + n; }
            }
            const r = project.writeAsset(assetKind, sub, finalName, buf, outExt, { root, encrypt, overwrite: it.conflict === 'overwrite', backupDir });
            done.push({ path: it.path, sub, name: finalName, renamed: finalName !== name, encrypted: r.encrypted });
          } catch (e) { failed.push({ path: it.path, error: e.message }); }
        }
        if (done.length && ctx.opts.onWrite && ctx.isBuiltin()) { try { ctx.opts.onWrite(done.map(d => d.sub + '/' + d.name)); } catch { } }
        // 全部导完就清掉暂存区
        if (!failed.length && b.keep !== true) fs.rmSync(stageDir(id), { recursive: true, force: true });
        return { done, skipped, failed, backupDir: done.some(d => !d.renamed) ? backupDir : '' };
      },
      'assets/discard'(T, b) { fs.rmSync(stageDir(String(b.id || '')), { recursive: true, force: true }); return {}; },
    },
    upload: {
      // 上传一个文件进暂存区；zip 会解开（保留里面的目录结构，分类时要看）
      async 'upload/assets'(req, q) {
        sweep();
        let id = String(q('id') || '');
        if (!id) id = crypto.randomBytes(6).toString('hex');
        const d = stageDir(id);
        fs.mkdirSync(d, { recursive: true });
        const rel = String(q('name') || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
        need(!rel.split('/').some(s => s === '..'), '文件名不对');
        if (/\.zip$/i.test(rel)) {
          const tmp = path.join(d, '.upload-' + Date.now() + '.zip');
          await ctx.saveUpload(req, tmp, maxUpload());
          let n = 0;
          try {
            const base = rel.replace(/\.zip$/i, '').split('/').pop();
            for (const e of listZip(tmp)) {
              if (e.dir || SKIP.test(e.name)) continue;
              const out = path.resolve(d, base, e.name);
              if (!out.startsWith(d + path.sep)) continue;
              fs.mkdirSync(path.dirname(out), { recursive: true });
              await extractEntry(tmp, e, out);
              n++;
            }
          } catch (e) { throw new UserError(e.message); }
          finally { fs.rm(tmp, { force: true }, () => { }); }
          return { id, added: n };
        }
        const out = inStage(id, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await ctx.saveUpload(req, out, maxUpload());
        return { id, added: 1 };
      },
    },
  };
};

module.exports.classify = classify;
module.exports.decryptPng = decryptPng;
module.exports.imageSize = imageSize;
