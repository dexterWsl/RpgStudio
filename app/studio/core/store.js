'use strict';
// 写盘（通用）：读最新 → 改 → 检查 → 备份 → 原子写入
//   edit(['Map003.json', 'System.json'], docs => { ...改 docs[文件名]... })
//   - 改的是磁盘上最新内容的副本，不是缓存里的对象；改坏了（抛错）什么都不写
//   - 写之前把原文件备份到 backupsDir/<时间>/，每个工程最多留 50 份
//   - 保持原文件的排版风格：原来是 RPG Maker 编辑器那种「一条一行」，写回去也是；原来是一整行就写一整行
const fs = require('fs');
const path = require('path');

const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
};

// RPG Maker MZ 编辑器的写法：数据库数组每条一行；对象每个键一行，地图的 events 每个事件一行
function rmStringify(obj) {
  const S = v => JSON.stringify(v);
  if (Array.isArray(obj)) return '[\n' + obj.map(S).join(',\n') + '\n]';
  if (obj && typeof obj === 'object') {
    return '{\n' + Object.entries(obj).map(([k, v]) => S(k) + ':' + (k === 'events' && Array.isArray(v) ? '[\n' + v.map(S).join(',\n') + '\n]' : S(v))).join(',\n') + '\n}';
  }
  return S(obj);
}

function createStore(project, opts = {}) {
  const P = project;
  const backupsDir = () => path.resolve(typeof opts.backupsDir === 'function' ? opts.backupsDir() : opts.backupsDir);
  const KEEP = opts.keep || 50;

  function backup(files) {
    const root = backupsDir();
    const dir = path.join(root, stamp());
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const src = P.file(f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
    }
    // 只留最近 KEEP 份
    try {
      const all = fs.readdirSync(root).filter(n => /^\d{8}-\d{6}/.test(n)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch { }
    return dir;
  }

  // 原文件是不是 RPG Maker 编辑器那种「一条一行」的排版；新文件照 styleOf 那个文件
  //   先按整份内容核对（照两种写法重写一遍，跟原文一样就是那一种）；都对不上（别的工具写的）再看开头
  function isPretty(name) {
    let raw;
    try { raw = fs.readFileSync(P.file(name), 'utf8').replace(/^\uFEFF/, ''); } catch { return null; }
    try {
      const d = JSON.parse(raw);
      if (rmStringify(d) === raw) return true;
      if (JSON.stringify(d) === raw) return false;
    } catch { }
    return /^[[{]\r?\n/.test(raw.slice(0, 64));
  }
  const tmpName = f => f + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  // 写到临时文件（还没替换原文件）
  function stage(name, data, styleOf) {
    const f = P.file(name);
    let pretty = isPretty(name);
    if (pretty == null) pretty = styleOf ? !!isPretty(styleOf) : opts.prettyNew !== false;
    const text = pretty ? rmStringify(data) : JSON.stringify(data);
    JSON.parse(text);   // 写之前确认能读回来
    const tmp = tmpName(f);
    fs.writeFileSync(tmp, text, 'utf8');
    return { name, f, tmp };
  }
  function write(name, data, styleOf) {
    const s = stage(name, data, styleOf);
    fs.renameSync(s.tmp, s.f);
    P.invalidate(name);
  }

  // mutate(docs) 可以返回任意值，会原样返回给调用方；抛错 = 不写
  //   eo.create：允许不存在的文件（新建）；eo.styleOf：新文件照哪个文件的排版
  //   mutate 里把 docs[文件] 设成 undefined = 删掉这个文件（先备份）
  // 几个文件一起改要么全成、要么全不动：先全部写成临时文件，都写好了再一个个换上去；
  // 换到一半出错（被占用、磁盘满），已经换上去的从备份里拿回来
  function edit(files, mutate, eo = {}) {
    files = [...new Set(files)];
    const creatable = new Set(eo.create || []);
    const docs = {};
    function read(f) {
      if (!/^[A-Za-z0-9_]+\.json$/.test(f)) throw new Error('文件名不合法：' + f);
      docs[f] = P.readFresh(f);
      if (docs[f] == null && !creatable.has(f) && !opts.allowCreate) throw new Error('找不到 ' + f);
    }
    for (const f of files) read(f);
    const result = mutate(docs);
    const changed = files.filter(f => JSON.stringify(docs[f]) !== JSON.stringify(P.read(f)));
    if (changed.length && opts.prepare) {
      const included = new Set();
      opts.prepare(changed, docs, f => {
        if (!files.includes(f) && !included.has(f)) read(f);
        included.add(f);
        return docs[f];
      });
      for (const f of included) {
        if (!changed.includes(f) && JSON.stringify(docs[f]) !== JSON.stringify(P.read(f))) changed.push(f);
      }
    }
    if (!changed.length) return { changed: [], result };
    const backupDir = backup(changed);
    const staged = [];
    try {
      for (const f of changed) if (docs[f] !== undefined) staged.push(stage(f, docs[f], eo.styleOf));
    } catch (e) {
      for (const s of staged) fs.rmSync(s.tmp, { force: true });
      throw e;
    }
    const done = [];
    try {
      for (const s of staged) { fs.renameSync(s.tmp, s.f); done.push(s.name); }
    } catch (e) {
      for (const s of staged) fs.rmSync(s.tmp, { force: true });
      for (const name of done) {
        const saved = path.join(backupDir, name);
        try { if (fs.existsSync(saved)) fs.copyFileSync(saved, P.file(name)); else fs.rmSync(P.file(name), { force: true }); } catch { }
      }
      for (const f of changed) P.invalidate(f);
      throw e;
    }
    for (const f of changed) {
      if (docs[f] === undefined) { try { fs.unlinkSync(P.file(f)); } catch { } }
      P.invalidate(f);
    }
    if (opts.onWrite) { try { opts.onWrite(changed); } catch (e) { console.error('[studio] onWrite: ' + e.message); } }
    return { changed, backupDir, result };
  }

  return { edit, write, backup };
}

module.exports = { createStore, rmStringify };
