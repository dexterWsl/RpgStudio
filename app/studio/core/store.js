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
  function isPretty(name) {
    try { return /^\uFEFF?[[{]\r?\n/.test(fs.readFileSync(P.file(name), 'utf8').slice(0, 64)); } catch { return null; }
  }
  function write(name, data, styleOf) {
    const f = P.file(name);
    let pretty = isPretty(name);
    if (pretty == null) pretty = styleOf ? !!isPretty(styleOf) : opts.prettyNew !== false;
    const text = pretty ? rmStringify(data) : JSON.stringify(data);
    JSON.parse(text);   // 写之前确认能读回来
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, f);
    P.invalidate(name);
  }

  // mutate(docs) 可以返回任意值，会原样返回给调用方；抛错 = 不写
  //   eo.create：允许不存在的文件（新建）；eo.styleOf：新文件照哪个文件的排版
  //   mutate 里把 docs[文件] 设成 undefined = 删掉这个文件（先备份）
  function edit(files, mutate, eo = {}) {
    files = [...new Set(files)];
    const creatable = new Set(eo.create || []);
    const docs = {};
    for (const f of files) {
      if (!/^[A-Za-z0-9_]+\.json$/.test(f)) throw new Error('文件名不合法：' + f);
      docs[f] = P.readFresh(f);
      if (docs[f] == null && !creatable.has(f) && !opts.allowCreate) throw new Error('找不到 ' + f);
    }
    const result = mutate(docs);
    const changed = files.filter(f => JSON.stringify(docs[f]) !== JSON.stringify(P.read(f)));
    if (!changed.length) return { changed: [], result };
    const backupDir = backup(changed);
    for (const f of changed) {
      if (docs[f] === undefined) { try { fs.unlinkSync(P.file(f)); } catch { } P.invalidate(f); }
      else write(f, docs[f], eo.styleOf);
    }
    if (opts.onWrite) { try { opts.onWrite(changed); } catch (e) { console.error('[studio] onWrite: ' + e.message); } }
    return { changed, backupDir, result };
  }

  return { edit, write, backup };
}

module.exports = { createStore, rmStringify };
