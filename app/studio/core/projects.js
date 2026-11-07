'use strict';
// 工程列表：系统里可以放好几个 RPG Maker 游戏，切换着改
//   内置工程（启动时指定的那个，独立启动时就是 --project）+ 导入的工程
//   导入方式：复制一份进系统（mode = copy，放在 dir/<id>/）或者直接改原文件夹（mode = inplace）
//   列表存在 dir/projects.json：{ current, list: [{ id, name, gameDir, mode, source, addedAt }] }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listZip, extractEntry } = require('./zip.js');

const val = v => (typeof v === 'function' ? v() : v);
const SKIP = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

// 找游戏根目录：里面有 data/System.json 或 www/data/System.json（最多往下找 3 层）
function findGameRoot(dir, depth = 0) {
  for (const d of ['data', 'www/data']) if (fs.existsSync(path.join(dir, d, 'System.json'))) return dir;
  if (depth >= 3) return null;
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !/^(node_modules|\.git|save|backups?)$/i.test(e.name)).map(e => e.name); } catch { }
  for (const n of names) { const r = findGameRoot(path.join(dir, n), depth + 1); if (r) return r; }
  return null;
}

// 看一眼这个游戏：标题、引擎、加密、地图数
function inspectGame(gameDir) {
  const dataDir = ['data', 'www/data'].map(d => path.join(gameDir, d)).find(d => fs.existsSync(path.join(d, 'System.json')));
  if (!dataDir) return { ok: false, error: '这里没有 RPG Maker 游戏（找不到 data/System.json）' };
  let sys = {};
  try { sys = JSON.parse(fs.readFileSync(path.join(dataDir, 'System.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { return { ok: false, error: 'System.json 读不出来：' + e.message }; }
  const has = f => fs.existsSync(path.join(gameDir, f));
  const engine = has('js/rmmz_core.js') || has('game.rmmzproject') || 'advanced' in sys ? 'MZ' : (has('js/rpg_core.js') || has('www/js/rpg_core.js') || has('Game.rpgproject') || 'versionId' in sys ? 'MV' : '?');
  let maps = 0;
  try { maps = fs.readdirSync(dataDir).filter(f => /^Map\d+\.json$/.test(f)).length; } catch { }
  return {
    ok: true, title: String(sys.gameTitle || path.basename(gameDir)), engine, dataDir, maps,
    encryptedImages: !!sys.hasEncryptedImages, encryptedAudio: !!sys.hasEncryptedAudio,
  };
}

function dirSize(dir, limit = 200000) {
  let bytes = 0, files = 0;
  const walk = d => {
    if (files > limit) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { try { bytes += fs.statSync(f).size; files++; } catch { } }
    }
  };
  walk(dir);
  return { bytes, files };
}

function createRegistry(o) {
  const dir = () => path.resolve(val(o.dir));
  const file = () => path.join(dir(), 'projects.json');
  // 内置工程。名字没给就用游戏标题——读 System.json 要时间，只在列工程的时候读（current() 每次读文件都会被调用，必须快）
  const builtin = (withName) => {
    const g = val(o.builtin && o.builtin.gameDir);
    if (!g) return null;
    let name = val(o.builtin.name);
    if (!name && withName) { const info = inspectGame(path.resolve(g)); name = info.ok ? info.title : ''; }
    return { id: 'main', name: name || path.basename(path.resolve(g)), gameDir: path.resolve(g), dataDir: val(o.builtin.dataDir) || '', mode: 'builtin', builtin: true };
  };
  let cache = null;
  function load() {
    let st = null;
    try { st = fs.statSync(file()); } catch { }
    const key = file() + ':' + (st ? st.mtimeMs + ':' + st.size : '-');
    if (cache && cache.key === key) return cache.data;
    let data = { current: '', list: [] };
    if (st) { try { data = { current: '', list: [], ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { } }
    cache = { key, data };
    return data;
  }
  function save(data) {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = file() + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file());
    cache = null;
  }
  function list(withName = true) {
    const b = builtin(withName);
    return [...(b ? [b] : []), ...load().list.map(p => ({ ...p, builtin: false }))];
  }
  function current() {
    const all = list(false);
    const id = load().current;
    return all.find(p => p.id === id) || all[0] || null;
  }
  function get(id) { return list().find(p => p.id === id) || null; }
  function use(id) {
    if (!get(id)) throw new Error('没有这个工程');
    const d = load();
    save({ ...d, current: id });
  }
  const newId = () => 'p' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  function add(p, makeCurrent = true) {
    const d = load();
    const entry = { id: p.id || newId(), name: String(p.name || '').trim().slice(0, 60) || '新工程', gameDir: path.resolve(p.gameDir), mode: p.mode, source: p.source || '', addedAt: p.addedAt || Date.now() };
    d.list = [...d.list.filter(x => x.id !== entry.id), entry];
    if (makeCurrent) d.current = entry.id;
    save(d);
    return entry;
  }
  function rename(id, name) {
    const d = load();
    const p = d.list.find(x => x.id === id);
    if (!p) throw new Error(id === 'main' ? '内置工程不能改名' : '没有这个工程');
    p.name = String(name || '').trim().slice(0, 60) || p.name;
    save(d);
  }
  // 移除：复制进来的可以连文件一起删（只删 dir 里面的）；直接改原文件夹的只从列表里拿掉
  function remove(id, deleteFiles) {
    const d = load();
    const p = d.list.find(x => x.id === id);
    if (!p) throw new Error(id === 'main' ? '内置工程不能移除' : '没有这个工程');
    d.list = d.list.filter(x => x.id !== id);
    if (d.current === id) d.current = '';
    save(d);
    if (deleteFiles && p.mode === 'copy') {
      const target = path.resolve(p.gameDir);
      if (target.startsWith(dir() + path.sep)) fs.rmSync(target, { recursive: true, force: true });
    }
    return p;
  }
  const backupsDir = p => path.join(dir(), '_backups', p.id);

  // 从 zip 导入：找到游戏根目录，把它下面的文件解到 dir/<id>/
  async function importZip(zipFile, o2 = {}) {
    const entries = listZip(zipFile);
    const sys = entries.filter(e => !e.dir && /(^|\/)(www\/)?data\/System\.json$/i.test(e.name) && !SKIP.test(e.name));
    if (!sys.length) {
      const exe = entries.some(e => /\.exe$/i.test(e.name));
      throw new Error('压缩包里找不到 RPG Maker 游戏（data/System.json）' + (exe ? '。只有 exe 的游戏是打包加密过的，需要先解包成文件夹' : ''));
    }
    sys.sort((a, b) => a.name.length - b.name.length);
    const root = sys[0].name.replace(/(www\/)?data\/System\.json$/i, '');
    const id = newId();
    const dest = path.join(dir(), id);
    fs.mkdirSync(dest, { recursive: true });
    let files = 0, bytes = 0;
    try {
      for (const e of entries) {
        if (!e.name.startsWith(root) || SKIP.test(e.name)) continue;
        const rel = e.name.slice(root.length);
        if (!rel) continue;
        const out = path.resolve(dest, rel);
        if (!out.startsWith(dest + path.sep)) continue;           // ../ 跑出去的不要
        if (e.dir) { fs.mkdirSync(out, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await extractEntry(zipFile, e, out);
        files++; bytes += e.size;
        if (o2.onProgress) o2.onProgress(files);
      }
    } catch (err) { fs.rmSync(dest, { recursive: true, force: true }); throw err; }
    const info = inspectGame(dest);
    if (!info.ok) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error(info.error); }
    const entry = add({ id, name: o2.name || info.title, gameDir: dest, mode: 'copy', source: o2.source || path.basename(zipFile) });
    return { project: entry, info, files, bytes };
  }

  // 从本机文件夹导入：copy = 复制一份；inplace = 直接改原文件夹
  async function importFolder(src, o2 = {}) {
    const abs = path.resolve(String(src || '').trim().replace(/^["']|["']$/g, ''));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('找不到这个文件夹：' + abs);
    const root = findGameRoot(abs);
    if (!root) throw new Error('这个文件夹里没有 RPG Maker 游戏（找不到 data/System.json，最多往下找 3 层）');
    const info = inspectGame(root);
    if (!info.ok) throw new Error(info.error);
    if (o2.mode === 'inplace') {
      const dup = list().find(p => path.resolve(p.gameDir) === root);
      if (dup) throw new Error('这个游戏已经在工程列表里了：' + dup.name);
      return { project: add({ name: o2.name || info.title, gameDir: root, mode: 'inplace', source: root }), info };
    }
    const id = newId();
    const dest = path.join(dir(), id);
    if (dest.startsWith(root + path.sep)) throw new Error('不能把游戏复制到它自己里面');
    await fs.promises.cp(root, dest, { recursive: true, filter: s => !SKIP.test(s.replace(/\\/g, '/')) });
    return { project: add({ id, name: o2.name || info.title, gameDir: dest, mode: 'copy', source: root }), info };
  }

  return { dir, list, current, get, use, add, rename, remove, backupsDir, importZip, importFolder, inspectGame, dirSize };
}

module.exports = { createRegistry, findGameRoot, inspectGame };
