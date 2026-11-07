'use strict';
// 打开一个 RPG Maker MV / MZ 工程（通用，不认识任何具体游戏）
//   - 认引擎（MZ / MV）和版本
//   - 找 data 目录：<游戏>/data，部署过的 MV 是 <游戏>/www/data；也可以指定一个工作副本
//   - 按文件读 JSON，按修改时间缓存
//   - 各种「编号 → 名字」、图片查找与解密（.png_ / .rpgmvp）
const fs = require('fs');
const path = require('path');

const val = v => (typeof v === 'function' ? v() : v);
const readText = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const mapFile = id => 'Map' + String(id).padStart(3, '0') + '.json';
const clone = o => JSON.parse(JSON.stringify(o));

function defaultDataDir(gameDir) {
  for (const d of ['data', 'www/data']) {
    const full = path.join(gameDir, d);
    if (fs.existsSync(path.join(full, 'System.json'))) return full;
  }
  return path.join(gameDir, 'data');
}

// MZ / MV：先看引擎脚本和工程文件，再看 System.json 里 MZ 才有的字段
function detectEngine(gameDir, sys) {
  const has = f => fs.existsSync(path.join(gameDir, f));
  const version = f => {
    try { const m = /v(\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(gameDir, f), 'utf8').slice(0, 400)); return m ? m[1] : ''; } catch { return ''; }
  };
  if (has('js/rmmz_core.js')) return { name: 'MZ', version: version('js/rmmz_core.js'), from: 'js/rmmz_core.js' };
  if (has('game.rmmzproject')) return { name: 'MZ', version: '', from: 'game.rmmzproject' };
  for (const f of ['js/rpg_core.js', 'www/js/rpg_core.js']) if (has(f)) return { name: 'MV', version: version(f), from: f };
  if (has('Game.rpgproject')) return { name: 'MV', version: '', from: 'Game.rpgproject' };
  if (sys && typeof sys === 'object') {
    if ('advanced' in sys || 'tileSize' in sys) return { name: 'MZ', version: '', from: 'System.json' };
    if ('versionId' in sys) return { name: 'MV', version: '', from: 'System.json' };
  }
  return { name: '?', version: '', from: '' };
}

// 加密图片：16 字节假文件头 + 数据（前 16 字节和 System.encryptionKey 异或）
const FAKE_HEADER = Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);
const IMG_EXT = ['.png', '.png_', '.rpgmvp', '.jpg', '.jpeg', '.webp'];

function createProject(opts) {
  const gameDir = () => path.resolve(val(opts.gameDir));
  const dataDir = () => path.resolve(val(opts.dataDir) || defaultDataDir(gameDir()));
  const extraImgRoots = () => (val(opts.extraImgRoots) || []).filter(Boolean);

  // ---------- 读文件（按 路径 + 修改时间 + 大小 缓存） ----------
  const cache = new Map();
  const file = name => path.join(dataDir(), name);
  const exists = name => fs.existsSync(file(name));
  function read(name) {
    const f = file(name);
    let st;
    try { st = fs.statSync(f); } catch { return null; }
    const key = st.mtimeMs + ':' + st.size;
    const hit = cache.get(f);
    if (hit && hit.key === key) return hit.data;
    let data;
    try { data = JSON.parse(readText(f)); }
    catch (e) { throw new Error(name + ' 不是合法的 JSON：' + e.message); }
    cache.set(f, { key, data });
    return data;
  }
  const readFresh = name => { const d = read(name); return d == null ? null : clone(d); };
  const invalidate = name => { if (name) cache.delete(file(name)); else cache.clear(); sigCache = null; };

  // 所有 data 文件的修改时间拼在一起：任何文件变了，索引类缓存就重算
  // 每次 memoize 都会要一次 signature。大工程里一次请求内 memoize 会被调上千次
  // （718 张地图 = 718 次），每次都 stat 一遍全部 data 文件会拖到分钟级，所以按 1 秒缓存。
  // 编辑器自己的写盘都走 invalidate()，那里会把缓存清掉，写完立刻能读到新数据。
  let sigCache = null;   // { at, value }
  function signature() {
    const now = Date.now();
    if (sigCache && now - sigCache.at < 1000) return sigCache.value;
    const dir = dataDir();
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort(); } catch { }
    const value = dir + '|' + names.map(n => { try { const s = fs.statSync(path.join(dir, n)); return n + ':' + s.mtimeMs + ':' + s.size; } catch { return n; } }).join('|');
    sigCache = { at: now, value };
    return value;
  }
  const memo = new Map();   // 按 signature 缓存的计算结果
  function memoize(key, fn) {
    const sig = signature();
    key = dataDir() + '|' + key;   // 云端每个用户一个工作区，各算各的
    const hit = memo.get(key);
    if (hit && hit.sig === sig) return hit.value;
    const value = fn();
    if (memo.size > 2000) memo.clear();   // 大工程 718 张地图：不到 2000 就清，否则会一直重算
    memo.set(key, { sig, value });
    return value;
  }

  const sys = () => read('System.json') || {};
  let engineCache = null;
  function engine() {
    const g = gameDir();
    if (!engineCache || engineCache.dir !== g) engineCache = { dir: g, value: detectEngine(g, sys()) };
    return engineCache.value;
  }

  // ---------- 名字 ----------
  const db = name => read(name) || [];
  const LISTS = {
    switch: () => (sys().switches || []).map((n, i) => ({ id: i, name: n || '' })),
    var: () => (sys().variables || []).map((n, i) => ({ id: i, name: n || '' })),
    actor: () => db('Actors.json'),
    item: () => db('Items.json'),
    weapon: () => db('Weapons.json'),
    armor: () => db('Armors.json'),
    skill: () => db('Skills.json'),
    state: () => db('States.json'),
    enemy: () => db('Enemies.json'),
    troop: () => db('Troops.json'),
    class: () => db('Classes.json'),
    animation: () => db('Animations.json'),
    tileset: () => db('Tilesets.json'),
    ce: () => db('CommonEvents.json'),
    map: () => db('MapInfos.json'),
  };
  const KIND_LABEL = { switch: '开关', var: '变量', actor: '角色', item: '物品', weapon: '武器', armor: '防具', skill: '技能', state: '状态', enemy: '敌人', troop: '敌群', class: '职业', animation: '动画', tileset: '图块', ce: '公共事件', map: '地图' };
  function rows(kind) {
    const f = LISTS[kind];
    if (!f) throw new Error('不认识的类型：' + kind);
    return (f() || []).map((x, i) => (x ? { id: x.id != null ? x.id : i, name: String(x.name || '') } : null)).filter(x => x && x.id > 0);
  }
  function name(kind, id) {
    id = Number(id);
    const f = LISTS[kind];
    if (!f) return '';
    if (kind === 'switch' || kind === 'var') return String((f()[id] || {}).name || '');
    const arr = f() || [];
    const hit = arr[id] && arr[id].id === id ? arr[id] : arr.find(x => x && x.id === id);
    return hit ? String(hit.name || '') : '';
  }
  const count = kind => Math.max(0, ((LISTS[kind] && LISTS[kind]()) || []).length - 1);
  // 编号是否存在（开关/变量只要在数组长度内；其它要有那一条）
  function has(kind, id) {
    id = Number(id);
    if (!(id > 0)) return false;
    if (kind === 'switch' || kind === 'var') return id < ((LISTS[kind]() || []).length);
    if (kind === 'map') return !!(LISTS.map()[id]) && exists(mapFile(id));
    const arr = (LISTS[kind] && LISTS[kind]()) || [];
    return !!(arr[id] || arr.find(x => x && x.id === id));
  }
  const label = (kind, id) => { const n = name(kind, id).trim(); return `${KIND_LABEL[kind] || kind} ${id}` + (n ? `「${n}」` : ''); };
  function actorIdByName(n) {
    const want = String(n || '').trim();
    if (!want) return 0;
    const a = (LISTS.actor() || []).find(x => x && String(x.name || '').trim() === want);
    return a ? a.id : 0;
  }
  // \N[n] → 角色名（没有这个角色的保持原样）
  const expandN = s => String(s == null ? '' : s).replace(/\\N\[(\d+)\]/gi, (m, n) => name('actor', n) || m);

  // ---------- 地图 ----------
  function mapList() {
    const infos = LISTS.map() || [];
    return infos.filter(Boolean).filter(m => m.id > 0).map(m => ({ id: m.id, name: String(m.name || ''), parentId: m.parentId || 0, order: m.order || 0, expanded: !!m.expanded, hasFile: exists(mapFile(m.id)) }));
  }
  const map = id => read(mapFile(id));

  // ---------- 图片 ----------
  function imgRoots() {
    const g = gameDir();
    const base = fs.existsSync(path.join(g, 'img')) ? path.join(g, 'img') : path.join(g, 'www', 'img');
    // 用户自己上传 / 改过的图放在前面：同名时用它，不用游戏原图
    return [...extraImgRoots(), base];
  }
  const gameImgRoot = () => { const g = gameDir(); return fs.existsSync(path.join(g, 'img')) || !fs.existsSync(path.join(g, 'www')) ? path.join(g, 'img') : path.join(g, 'www', 'img'); };

  // 写一张图（PNG）：encrypt = 按游戏的密钥加密成 .png_（MV 是 .rpgmvp），和游戏原图一样
  //   同一目录里同名的其它格式（.png / .png_）先备份再删掉，免得旧图挡住新图
  function writeImage(sub, nm, png, o = {}) {
    sub = safeSub(sub);
    const rel = String(nm || '');
    if (!sub || !/^[!$]*[\w\u4e00-\u9fff][\w\u4e00-\u9fff .()\-]{0,59}$/.test(rel)) throw new Error('文件名不合法：' + rel + '（字母、数字、中文、下划线，开头可以有 ! 或 $）');
    if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('只支持 PNG 图片');
    const root = o.root || gameImgRoot();
    const dir = path.join(root, sub);
    fs.mkdirSync(dir, { recursive: true });
    const encrypt = !!o.encrypt;
    const ext = encrypt ? (engine().name === 'MV' ? '.rpgmvp' : '.png_') : '.png';
    const others = IMG_EXT.map(e => path.join(dir, rel + e)).filter(f => fs.existsSync(f));
    if (others.length && !o.overwrite) throw new Error('已经有一张叫「' + rel + '」的图了');
    if (others.length && o.backupDir) {
      fs.mkdirSync(o.backupDir, { recursive: true });
      for (const f of others) fs.copyFileSync(f, path.join(o.backupDir, sub + '__' + path.basename(f)));
    }
    let buf = png;
    if (encrypt) {
      const k = Buffer.from(String(sys().encryptionKey || ''), 'hex');
      if (k.length !== 16) throw new Error('游戏的加密密钥读不出来（System.json 的 encryptionKey）');
      const body = Buffer.from(png);
      for (let i = 0; i < 16; i++) body[i] ^= k[i];
      buf = Buffer.concat([FAKE_HEADER, body]);
    }
    const dest = path.join(dir, rel + ext);
    const tmp = dest + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, buf);
    // 先把新文件放好再删旧的：反过来一旦 rename 失败，新图只剩 .tmp、旧图已经没了
    fs.renameSync(tmp, dest);
    for (const f of others) if (f !== dest) { try { fs.unlinkSync(f); } catch { } }
    imgCache.clear();
    return { file: dest, encrypted: encrypt };
  }
  const safeSub = sub => (/^[A-Za-z0-9_]+$/.test(String(sub || '')) ? String(sub) : null);

  // ---------- 素材（导入素材包用）：图片放 img/<分类>/，声音放 audio/<bgm|bgs|me|se>/，视频放 movies/ ----------
  //   名字可以带子文件夹（pictures/CG/xxx）；加密照游戏设置：图 .png_（MV .rpgmvp），声音 .ogg_ / .m4a_（MV .rpgmvo / .rpgmvm）
  const gameRoot = () => { const g = gameDir(); return fs.existsSync(path.join(g, 'www')) && !fs.existsSync(path.join(g, 'img')) && !fs.existsSync(path.join(g, 'audio')) ? path.join(g, 'www') : g; };
  const AUDIO_EXT = { '.ogg': ['.ogg_', '.rpgmvo'], '.m4a': ['.m4a_', '.rpgmvm'] };
  const assetDir = (kind, sub, root) => kind === 'img' ? path.join(root || gameImgRoot(), sub) : kind === 'audio' ? path.join(gameRoot(), 'audio', sub) : path.join(gameRoot(), 'movies');
  // ogg / m4a（webm / mp4）是不同平台使用的配对文件，不互相占用名字。
  const variants = (kind, ext) => kind === 'img' ? IMG_EXT : kind === 'audio'
    ? (AUDIO_EXT[ext] ? [ext, ...AUDIO_EXT[ext]] : ['.ogg', '.m4a', '.ogg_', '.m4a_', '.rpgmvo', '.rpgmvm'])
    : (ext ? [ext] : ['.webm', '.mp4']);
  function assetExists(kind, sub, nm, root, ext) {
    const dir = assetDir(kind, sub, root);
    return variants(kind, ext).some(e => { const f = safeJoin(dir, nm + e); return f && fs.existsSync(f); });
  }
  function writeAsset(kind, sub, nm, buf, ext, o = {}) {
    if (kind !== 'movie' && !safeSub(sub)) throw new Error('分类不对：' + sub);
    const dir = assetDir(kind, sub, o.root);
    const segs = String(nm || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!segs.length || segs.some(s => s === '..' || s === '.' || /[<>:"|?*\x00-\x1f]/.test(s))) throw new Error('文件名不合法：' + nm);
    const rel = segs.join('/');
    let outExt = ext;
    let data = buf;
    const key = () => { const k = Buffer.from(String(sys().encryptionKey || ''), 'hex'); if (k.length !== 16) throw new Error('游戏的加密密钥读不出来（System.json 的 encryptionKey）'); return k; };
    const mv = engine().name === 'MV';
    if (o.encrypt && (kind === 'img' || (kind === 'audio' && AUDIO_EXT[ext]))) {
      const k = key();
      const body = Buffer.from(buf);
      for (let i = 0; i < 16 && i < body.length; i++) body[i] ^= k[i];
      data = Buffer.concat([FAKE_HEADER, body]);
      outExt = kind === 'img' ? (mv ? '.rpgmvp' : '.png_') : AUDIO_EXT[ext][mv ? 1 : 0];
    }
    const dest = safeJoin(dir, rel + outExt);
    if (!dest) throw new Error('文件名不合法：' + nm);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 同名的其它格式（.png / .png_ / .ogg / .ogg_ …）：覆盖时先备份再删掉，免得旧文件挡住新文件
    const same = variants(kind, ext);
    const others = same.map(e => safeJoin(dir, rel + e)).filter(f => f && fs.existsSync(f));
    if (others.length && !o.overwrite) throw new Error('已经有「' + rel + '」了');
    if (others.length && o.backupDir) {
      // 备份路径不能直接用请求里的 sub（视频没有分类，sub 可能是空的或者带 ..）：夹一层再拼
      const zone = safeSub(sub) || 'movie';
      for (const f of others) {
        const b = safeJoin(path.join(o.backupDir, zone, kind), rel.replace(/\//g, '__') + path.extname(f));
        if (!b) continue;
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(f, b);
      }
    }
    const tmp = dest + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, data);
    // 先把新文件放好再删旧的：反过来一旦 rename 失败，新图只剩 .tmp、旧图已经没了
    fs.renameSync(tmp, dest);
    for (const f of others) if (f !== dest) { try { fs.unlinkSync(f); } catch { } }
    imgCache.clear(); listCache.clear();
    return { file: dest, encrypted: data !== buf };
  }
  function safeJoin(root, rel) {
    const r = path.resolve(root);
    const full = path.resolve(r, String(rel == null ? '' : rel).replace(/\\/g, '/'));
    return full === r || full.startsWith(r + path.sep) ? full : null;
  }
  function findImage(sub, nm) {
    sub = safeSub(sub);
    const rel = String(nm || '').replace(/\\/g, '/');
    if (!sub || !rel || rel.includes('..')) return null;
    for (const root of imgRoots()) {
      for (const ext of IMG_EXT) {
        const f = safeJoin(path.join(root, sub), rel + ext);
        if (f && fs.existsSync(f)) return f;
      }
    }
    return null;
  }
  const imgCache = new Map();
  function loadImage(sub, nm) {
    const f = findImage(sub, nm);
    if (!f) return null;
    const st = fs.statSync(f);
    const key = f + ':' + st.mtimeMs;
    if (imgCache.has(key)) return imgCache.get(key);
    let buf = fs.readFileSync(f);
    if (buf.length > 16 && buf.subarray(0, 16).equals(FAKE_HEADER)) {
      const body = Buffer.from(buf.subarray(16));
      const k = Buffer.from(String(sys().encryptionKey || ''), 'hex');
      if (k.length === 16) for (let i = 0; i < 16; i++) body[i] ^= k[i];
      buf = body;
    }
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
    const out = { buf, mime, stamp: String(Math.round(st.mtimeMs)) };
    if (imgCache.size > 120) imgCache.clear();
    imgCache.set(key, out);
    return out;
  }
  // 图片尺寸（只认 PNG，读不出来返回 null）：立绘要按图的高度贴着画面下沿放
  function imageSize(sub, nm) {
    const im = loadImage(sub, nm);
    if (!im || im.mime !== 'image/png' || im.buf.length < 24) return null;
    return { w: im.buf.readUInt32BE(16), h: im.buf.readUInt32BE(20) };
  }
  const listCache = new Map();
  function listImages(sub) {
    sub = safeSub(sub);
    if (!sub) return [];
    const out = new Set();
    for (const root of imgRoots()) {
      const dir = path.join(root, sub);
      let st; try { st = fs.statSync(dir); } catch { continue; }
      const key = dir + ':' + st.mtimeMs;
      let names = listCache.get(key);
      if (!names) {
        names = [];
        const walk = (d, pre, depth) => {
          let entries = []; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (e.isDirectory()) { if (depth < 4) walk(path.join(d, e.name), pre + e.name + '/', depth + 1); continue; }
            const ext = IMG_EXT.find(x => e.name.toLowerCase().endsWith(x));
            if (ext) names.push(pre + e.name.slice(0, -ext.length));
          }
        };
        walk(dir, '', 0);
        listCache.set(key, names);
      }
      names.forEach(n => out.add(n));
    }
    return [...out].sort();
  }

  // ---------- 对话框样式：跟原作保持一致（统计最常见的 窗口背景 / 位置） ----------
  function messageStyle() {
    return memoize('messageStyle', () => {
      const count = {};
      const scan = list => (list || []).forEach(c => {
        if (c && c.code === 101) { const k = (c.parameters[2] ?? 0) + ',' + (c.parameters[3] ?? 2); count[k] = (count[k] || 0) + 1; }
      });
      for (const m of mapList()) { try { ((map(m.id) || {}).events || []).forEach(e => e && (e.pages || []).forEach(p => scan(p.list))); } catch { } }
      try { (read('CommonEvents.json') || []).forEach(c => c && scan(c.list)); } catch { }
      const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      const [background, position] = best ? best[0].split(',').map(Number) : [0, 2];
      return { background, position };
    });
  }

  // ---------- 插件（js/plugins.js）：预览要知道立绘插件的位置设置这些；按修改时间缓存 ----------
  let pluginCache = null;
  function plugins() {
    const f = path.join(gameRoot(), 'js', 'plugins.js');
    let st;
    try { st = fs.statSync(f); } catch { return []; }
    const key = f + ':' + st.mtimeMs + ':' + st.size;
    if (pluginCache && pluginCache.key === key) return pluginCache.list;
    let list = [];
    try { const s = readText(f); list = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)); } catch { list = []; }
    list = (Array.isArray(list) ? list : []).filter(x => x && typeof x.name === 'string');
    pluginCache = { key, list };
    return list;
  }
  const plugin = nm => plugins().find(x => x.name === nm && x.status !== false) || null;
  // 视频：movies/<名字>.webm（没有就 .mp4），名字可以带子文件夹
  function findMovie(nm) {
    const rel = String(nm || '').replace(/\\/g, '/');
    if (!rel || rel.includes('..')) return null;
    for (const ext of ['.webm', '.mp4']) { const f = safeJoin(path.join(gameRoot(), 'movies'), rel + ext); if (f && fs.existsSync(f)) return f; }
    return null;
  }

  function info() {
    const s = sys();
    const e = engine();
    return {
      title: String(s.gameTitle || path.basename(gameDir())),
      engine: e.name, engineVersion: e.version, engineFrom: e.from,
      gameDir: gameDir(), dataDir: dataDir(),
      maps: mapList().length,
      commonEvents: rows('ce').length,
      switches: count('switch'), variables: count('var'),
      actors: rows('actor').length, items: rows('item').length,
      encrypted: !!s.hasEncryptedImages,
      locale: s.locale || '',
    };
  }

  return {
    gameDir, dataDir, file, exists, read, readFresh, invalidate, signature, memoize,
    sys, engine, info, rows, name, label, has, count, actorIdByName, expandN,
    mapList, map, mapFile,
    imgRoots, gameImgRoot, findImage, loadImage, imageSize, listImages, writeImage, messageStyle,
    gameRoot, assetDir, assetExists, writeAsset, plugins, plugin, findMovie,
    KIND_LABEL,
  };
}

module.exports = { createProject, detectEngine, defaultDataDir, mapFile };
