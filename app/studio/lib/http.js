'use strict';
// HTTP 这一层的小工具（不认识游戏，也不认识编辑器的功能）：
//   json(res, code, obj)            回 JSON
//   readBody(req)                   读 JSON 请求体（最多 16 MB）
//   saveUpload(req, file, max)      上传的文件流式写到磁盘
//   createHostGuard(allowHosts)     只给本机用：核对 Host / Origin
//   createStatic(webDir, transform) /studio、/studio/<文件> 的静态文件
const fs = require('fs');
const path = require('path');
const { UserError } = require('./util.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const MAX_BODY = 16e6;

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

// 请求体按 UTF-8 解码。必须先把 Buffer 收齐再整体解码：一段一段 toString() 会把跨块的多字节字符切成乱码
const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let n = 0, done = false;
  const fail = e => { if (done) return; done = true; reject(e); req.destroy(); };
  req.on('data', c => {
    if (done) return;
    n += c.length;
    if (n > MAX_BODY) return fail(new UserError('内容太大'));
    chunks.push(c);
  });
  req.on('end', () => { if (done) return; done = true; try { const s = Buffer.concat(chunks).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch { reject(new UserError('请求格式不对')); } });
  req.on('error', fail);
});

// 上传的文件（游戏 / 素材压缩包）：流式写到磁盘，不进内存
//   先写 <file>.part，全部收完再改名：中途断开 / 超限都不会留下看起来完整的半截文件，也不会误删同名的旧文件
const saveUpload = (req, file, max) => new Promise((resolve, reject) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.part-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  const out = fs.createWriteStream(tmp);
  let n = 0, settled = false;
  const drop = () => fs.rm(tmp, { force: true }, () => { });
  const fail = e => { if (settled) return; settled = true; out.destroy(); drop(); reject(e); };
  req.on('data', c => { n += c.length; if (n > max) { req.pause(); fail(new UserError(`文件太大（最多 ${Math.round(max / 1048576)} MB）`)); } });
  req.on('error', fail);
  req.on('close', () => { if (!req.complete) fail(new UserError('上传中断了，请重试')); });
  out.on('error', fail);
  out.on('finish', () => {
    if (settled) return;
    settled = true;
    fs.rename(tmp, file, err => (err ? (drop(), reject(err)) : resolve(n)));
  });
  req.pipe(out);
});

// 只给本机用（挡 DNS rebinding 和跨站写请求）
//   只监听 127.0.0.1 挡不住这一种：恶意域名解析到 127.0.0.1 以后，浏览器认为请求是同源的，
//   于是能读 /api/studio/project 里的 projectKey、能带 x-studio-project 头发写请求。所以要核对 Host，
//   跨站请求再核对 Origin。绑到局域网地址时用 allowHosts 放行那几个名字。
function createHostGuard(allowHosts) {
  const extra = (allowHosts || []).map(h => String(h).toLowerCase());
  const hostName = v => {
    const raw = String(v || '').trim().toLowerCase();
    const m = /^(\[[^\]]*\]|[^:]*)(?::\d*)?$/.exec(raw);
    return m ? m[1] : raw;
  };
  const hostOk = v => {
    const n = hostName(v);
    return !!n && (['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'].includes(n) || extra.includes(n));
  };
  return function sameOriginOnly(req) {
    if (!hostOk(req.headers.host)) return false;
    const o = req.headers.origin;
    if (o == null) return true;                 // 不是浏览器（curl / 本地脚本）：没有 Origin
    if (String(o) === 'null') return false;     // file:// 这类跨源页面
    try { const u = new URL(String(o)); return u.protocol === 'http:' && hostOk(u.host); } catch { return false; }
  };
}

// /studio = 页面；/studio/<文件> = web/ 下面的样式、脚本（不许跑出 web/）
function createStatic(webDir, transformHtml) {
  return function serveStatic(res, p) {
    let rel;
    try { rel = p === '/studio' || p === '/studio/' ? 'index.html' : decodeURIComponent(p.slice('/studio/'.length)); }
    catch { return false; }   // 畸形的 % 编码：当成「没有这个文件」，别让 URIError 冒出去
    const file = path.resolve(webDir, rel);
    if (!file.startsWith(webDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (rel === 'index.html' && transformHtml) body = transformHtml(body.toString('utf8'));
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-store' : 'no-cache' });
    res.end(body);
    return true;
  };
}

module.exports = { json, readBody, saveUpload, createHostGuard, createStatic, MIME };
