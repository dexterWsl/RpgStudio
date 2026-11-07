'use strict';
// 通用剧情编辑器（rpgStudio）的接口。不认识任何具体游戏：给它一个 MV/MZ 工程就能用。
//   const studio = createStudio({ gameDir, dataDir, backupsDir, settingsFile, extraImgRoots })
//   if (await studio.handle(req, res, url)) return;      // 处理 /studio、/studio/* 静态文件和 /api/studio/*
// gameDir / dataDir 可以是函数（云端每个请求切换到当前用户的工作区）。
//
// 这里只负责组装：工程、工具、共用的上下文，然后把请求分给 routes/ 里各功能的模块：
//   core 工程总览 · events 事件 · maps 地图 · names 开关变量 · people 人物小人 · images 图片 · gallery 回想房
//   projects 工程列表 / 导入游戏 · assets 导入素材包 · progress 剧情进度（按天 / 按章节 / 开关链 + 支线）
// 另外 /play/<工程编号>/ 是试玩：把当前游戏的文件按网页发出去（core/playtest.js）
// opts.projects = { dir, builtinName, maxUpload }：开了就能放多个游戏（内置工程 = gameDir 指的那个），切换后整个编辑器换成那个游戏
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createProject } = require('./core/project.js');
const { createDescriber } = require('./core/commands.js');
const { createScript } = require('./core/script.js');
const { createMerger, pictureRules } = require('./core/merge.js');
const { createXref } = require('./core/xref.js');
const { createValidator } = require('./core/validate.js');
const { createStore } = require('./core/store.js');
const Profiles = require('./profiles/index.js');
const { createPeople } = require('./core/people.js');
const { createGallery } = require('./core/gallery.js');
const { createRegistry } = require('./core/projects.js');
const { createProgress } = require('./core/progress.js');
const { createScenes } = require('./core/scenes.js');
const { createPlayer } = require('./core/play.js');
const { createPlaytest } = require('./core/playtest.js');
const stagePlugin = require('./core/stage.js');
const { UserError, need } = require('./lib/util.js');

const WEB = path.join(__dirname, 'web');
const MODULES = ['core', 'events', 'maps', 'placing', 'tilesets', 'system', 'names', 'people', 'images', 'gallery', 'projects', 'assets', 'progress', 'scenes'].map(n => require('./routes/' + n + '.js'));
const val = v => (typeof v === 'function' ? v() : v);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

function createStudio(opts) {
  // ---------- 工程列表：当前是内置工程还是导入的 ----------
  const registry = opts.projects ? createRegistry({ dir: opts.projects.dir, builtin: { name: opts.projects.builtinName, gameDir: opts.gameDir, dataDir: opts.dataDir } }) : null;
  const curProject = () => (registry ? registry.current() : null);
  const isBuiltin = () => { const c = curProject(); return !c || c.builtin; };
  const project = createProject({
    gameDir: () => (isBuiltin() ? val(opts.gameDir) : curProject().gameDir) || '.',
    dataDir: () => (isBuiltin() ? val(opts.dataDir) : ''),
    extraImgRoots: () => (isBuiltin() ? val(opts.extraImgRoots) : []),
  });
  // 浏览器打开工程时记住它的身份；切换工程后的旧页面不能把保存写到新工程。
  const projectKey = () => crypto.createHash('sha256').update(JSON.stringify([project.gameDir(), project.dataDir()])).digest('hex');
  function checkProject(req, required = false) {
    const key = req.headers['x-studio-project'];
    if ((required && !key) || (key && key !== projectKey())) {
      throw new UserError('工程已在其他页面切换。请先保留未保存的内容，再刷新页面后继续。', { status: 409, projectChanged: true });
    }
  }
  // 内置工程才用启动时给的这些（启动时指定的工作副本、宿主给的图片目录、写盘后通知宿主）
  const backupsDir = () => (isBuiltin() ? val(opts.backupsDir) : registry.backupsDir(curProject()));
  const onWrite = files => { if (isBuiltin() && opts.onWrite) opts.onWrite(files); };
  const settingsFile = () => (typeof opts.settingsFile === 'function' ? opts.settingsFile() : opts.settingsFile);

  // ---------- 每个工程自己的设置（图片编号段、手动选的配置、剧情进度的分法） ----------
  //   游戏文件夹里有 rpgstudio.json（用编辑器新建的游戏都有）：设置存在游戏里，挪文件夹、打包给别人都跟着走；
  //   没有的（导入的别人的游戏）：存在编辑器自己的 settings.json，按游戏路径分开，不往别人的游戏里写东西
  const gameSettingsFile = () => path.join(project.gameDir(), 'rpgstudio.json');
  function readJson(f) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch { return null; }
    try { return JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new UserError(path.basename(f) + ' 不是合法的 JSON，先修好再改设置：' + e.message); }
  }
  const writeJson = (f, obj) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, f);
  };
  function allSettings() { try { return readJson(settingsFile()) || {}; } catch { return {}; } }
  function gameSettings() { try { const j = readJson(gameSettingsFile()); return j && typeof j === 'object' ? j : null; } catch { return null; } }
  const settings = () => { const g = gameSettings(); return g ? (g.settings || {}) : (allSettings()[project.gameDir()] || {}); };
  function saveSettings(patch) {
    const clean = o => { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };
    if (fs.existsSync(gameSettingsFile())) {
      const g = readJson(gameSettingsFile()) || {};
      g.settings = clean({ ...(g.settings || {}), ...patch });
      writeJson(gameSettingsFile(), g);
      return;
    }
    // 读坏了就报错，不能当成空的覆盖掉所有工程的设置
    const all = readJson(settingsFile()) || {};
    all[project.gameDir()] = clean({ ...(all[project.gameDir()] || {}), ...patch });
    writeJson(settingsFile(), all);
  }
  const profile = () => Profiles.pick(project, settings().profile || (isBuiltin() ? opts.profile : ''));
  const picOptions = () => ({ ...profile().pictures, ...(settings().pictures || {}) });

  // ---------- 工具（每次请求现组装：数据目录可能已经换成另一个用户的工作区） ----------
  function tools() {
    const prof = profile();
    const pics = pictureRules(picOptions());
    const nameBox = project.engine().name !== 'MV';
    const describer = createDescriber(project, { isClearAll: pics.isClearAll });
    const script = createScript(project, { pics, nameBox, engine: project.engine().name, picSize: n => project.imageSize('pictures', n) });
    const style = project.messageStyle();
    const anchorText = (c, cmds) => {
      const p = c.parameters || [];
      switch (c.code) {
        case 102: return '选项：' + (p[0] || []).join(' / ');
        case 402: return '选了「' + (p[1] ?? '') + '」';
        case 403: return '按取消时';
        case 404: return '选项结束';
        case 411: return '否则';
        case 412: return '条件结束';
        case 111: return '如果 ' + describer.condText(p);
        case 112: return '循环';
        case 413: return '循环结束';
        case 355: return '脚本：' + p[0] + (cmds.length > 1 ? ` …（共 ${cmds.length} 行）` : '');
        case 357: {
          const args = Object.values(p[3] || {}).filter(v => typeof v === 'string' && v).slice(0, 2).join('，');
          return '插件：' + (p[0] || '') + ' ' + (p[1] || '') + (args ? '（' + args + '）' : '');
        }
        case 108: return '注释：' + p[0];
      }
      return describer.describe(c);
    };
    const merger = createMerger({
      pics, nameBox,
      actorName: s => project.expandN(s),
      actorIdByName: project.actorIdByName,
      refText: script.refText,
      describe: describer.describe,
      anchorText,
      parseScript: script.parseScript,
      scriptCommands: script.scriptCommands,
      stagingLine: script.stagingLine, stagingCommand: script.stagingCommand,
      bustCommands: script.bustCommands, unbustCommands: script.unbustCommands,
      picExists: n => !!project.findImage('pictures', n),
      exists: script.exists,
      defaultStyle: ['', 0, style.background, style.position],
    });
    const xref = createXref(project, describer);
    let aliases = null;
    try { aliases = prof.actorAliases ? prof.actorAliases(project) : null; } catch { }
    const people = createPeople(project, xref, aliases);
    const gallery = createGallery(project, xref, { pictures: picOptions });
    const progress = createProgress(project, xref, { saved: () => settings().progress || null, profile, where: at => where(at) });
    const validator = createValidator(project);
    // 存的剧情里用到了 #飘字 / #动作：游戏里还没有演出插件就装上
    const afterWrite = files => {
      try {
        const lists = [];
        for (const f of files) {
          const d = project.read(f);
          if (/^Map\d+\.json$/.test(f) && d) for (const e of d.events || []) for (const pg of (e && e.pages) || []) lists.push(pg.list);
          if (f === 'CommonEvents.json' && Array.isArray(d)) for (const ce of d) if (ce) lists.push(ce.list);
          if (f === 'Troops.json' && Array.isArray(d)) for (const t of d) for (const pg of (t && t.pages) || []) lists.push(pg.list);
        }
        if (lists.some(stagePlugin.usesStage)) stagePlugin.ensure(project.gameRoot());
      } catch (e) { console.error('[studio] 演出插件：' + e.message); }
      onWrite(files);
    };
    const store = createStore(project, { backupsDir, onWrite: afterWrite });
    const scenes = createScenes(project, xref, { where: at => where(at), progress });
    const player = createPlayer(project, describer);
    return { prof, pics, nameBox, describer, script, merger, xref, validator, store, people, gallery, progress, scenes, player };
  }

  // ---------- 位置 → 文字 ----------
  function where(at) {
    if (!at) return '';
    if (at.type === 'map') {
      let ev = null;
      try { ev = at.ev != null ? (project.map(at.map).events || [])[at.ev] : null; } catch { }
      return project.label('map', at.map) + (at.ev != null ? ` · 事件 ${at.ev}${ev && ev.name ? '「' + ev.name + '」' : ''}` : '') + (at.page != null ? ` · 第 ${at.page + 1} 页` : '');
    }
    if (at.type === 'ce') return project.label('ce', at.ce);
    if (at.type === 'troop') return project.label('troop', at.troop) + ` · 第 ${at.page + 1} 页`;
    if (at.type === 'actor') return project.label('actor', at.actor);
    return '';
  }
  const hint = key => profile().hints[key] || '';
  function firstLine(list) {
    for (const c of list || []) if (c.code === 401 && String(c.parameters[0] || '').trim()) return project.expandN(c.parameters[0]).slice(0, 40);
    return '';
  }
  const lineCount = list => (list || []).filter(c => c.code === 401).length;

  let curReq = null;
  const canConfigure = () => (typeof opts.canConfigure === 'function' ? !!opts.canConfigure(curReq) : opts.canConfigure !== false);
  // 上传的图放哪、要不要加密：云端放用户工作区（导出时再加密）；本地放进游戏目录，按游戏的设置加密
  const uploadRoot = () => (isBuiltin() ? val(opts.uploadRoot) : null) || null;
  const encryptUploads = () => (isBuiltin() && opts.encryptUploads != null ? !!val(opts.encryptUploads) : !!project.sys().hasEncryptedImages);
  const assetBackupDir = (kind = 'images') => { const b = backupsDir(); const d = new Date(); const pad = n => String(n).padStart(2, '0'); return path.join(b || path.join(require('os').tmpdir(), 'studio-backups'), kind + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())); };
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

  // ---------- 试玩：/play/<工程编号>/ 直接在浏览器里跑当前游戏 ----------
  const playId = () => { const c = curProject(); return c ? c.id : 'main'; };
  const playtest = createPlaytest({ root: () => project.gameRoot(), id: playId });

  // ---------- 各功能模块 ----------
  const ctx = {
    opts, project, tools, where, hint, settings, saveSettings, profile, picOptions, canConfigure,
    firstLine, lineCount, uploadRoot, encryptUploads, assetBackupDir, backupsDir, saveUpload,
    registry, curProject, isBuiltin, projectKey, playId,
    views: {},      // 模块之间互相用的视图：eventView / mapView / personView / checkImage …
    actions: {},    // 全部 POST 动作（gallery/room 会调用 map/create 之类）
  };
  // get / post：要有能打开的游戏；free：不需要（工程列表、导入游戏）；upload：请求体是文件本身
  const GET = {}, POST = {}, FREE_GET = {}, FREE_POST = {}, UPLOAD = {};
  const put = (tab, k, fn, what) => { if (tab[k]) throw new Error('重复的接口 ' + what + ' ' + k); tab[k] = fn; };
  for (const mod of MODULES) {
    const r = mod(ctx);
    for (const [k, fn] of Object.entries(r.get || {})) put(GET, k, fn, 'GET');
    for (const [k, fn] of Object.entries(r.post || {})) put(POST, k, fn, 'POST');
    for (const [k, fn] of Object.entries((r.free && r.free.get) || {})) put(FREE_GET, k, fn, 'GET');
    for (const [k, fn] of Object.entries((r.free && r.free.post) || {})) put(FREE_POST, k, fn, 'POST');
    for (const [k, fn] of Object.entries(r.upload || {})) put(UPLOAD, k, fn, 'UPLOAD');
  }
  Object.assign(ctx.actions, POST);

  // ---------- 只给本机用（挡 DNS rebinding 和跨站写请求） ----------
  // 只监听 127.0.0.1 挡不住这一种：恶意域名解析到 127.0.0.1 以后，浏览器认为请求是同源的，
  // 于是能读 /api/studio/project 里的 projectKey、能带 x-studio-project 头发写请求。所以要核对 Host，
  // 跨站请求再核对 Origin。绑到局域网地址时用 opts.allowHosts 放行那几个名字；opts.checkHost = false 整段关掉。
  const extraHosts = (val(opts.allowHosts) || []).map(h => String(h).toLowerCase());
  const hostName = v => {
    const raw = String(v || '').trim().toLowerCase();
    const m = /^(\[[^\]]*\]|[^:]*)(?::\d*)?$/.exec(raw);
    return m ? m[1] : raw;
  };
  const hostOk = v => {
    const n = hostName(v);
    return !!n && (['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'].includes(n) || extraHosts.includes(n));
  };
  function sameOriginOnly(req) {
    if (!hostOk(req.headers.host)) return false;
    const o = req.headers.origin;
    if (o == null) return true;                 // 不是浏览器（curl / 本地脚本）：没有 Origin
    if (String(o) === 'null') return false;     // file:// 这类跨源页面
    try { const u = new URL(String(o)); return u.protocol === 'http:' && hostOk(u.host); } catch { return false; }
  }

  // ---------- HTTP ----------
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  // 请求体按 UTF-8 解码。必须先把 Buffer 收齐再整体解码：一段一段 toString() 会把跨块的多字节字符切成乱码
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0, done = false;
    const fail = e => { if (done) return; done = true; reject(e); req.destroy(); };
    req.on('data', c => {
      if (done) return;
      n += c.length;
      if (n > 16e6) return fail(new UserError('内容太大'));
      chunks.push(c);
    });
    req.on('end', () => { if (done) return; done = true; try { const s = Buffer.concat(chunks).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch { reject(new UserError('请求格式不对')); } });
    req.on('error', fail);
  });
  // /studio = 页面；/studio/<文件> = web/ 下面的样式、脚本（不许跑出 web/）
  function serveStatic(res, p) {
    let rel;
    try { rel = p === '/studio' || p === '/studio/' ? 'index.html' : decodeURIComponent(p.slice('/studio/'.length)); }
    catch { return false; }   // 畸形的 % 编码：当成「没有这个文件」，别让 URIError 冒出去
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (rel === 'index.html' && opts.transformHtml) body = opts.transformHtml(body.toString('utf8'));
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-store' : 'no-cache' });
    res.end(body);
    return true;
  }

  async function handle(req, res, u) {
    u = u || new URL(req.url, 'http://x');
    const p = u.pathname;
    if (opts.checkHost !== false && !sameOriginOnly(req)) {
      json(res, 403, { error: '只接受本机访问（Host / Origin 不对）' });
      return true;
    }
    if (p.startsWith('/play/')) return playtest.serve(req, res, u);
    if (p === '/studio' || p === '/studio/' || (p.startsWith('/studio/') && req.method === 'GET')) {
      if (serveStatic(res, p)) return true;
      json(res, 404, { error: '页面不存在' });
      return true;
    }
    if (!p.startsWith('/api/studio/')) return false;
    const route = p.slice('/api/studio/'.length);
    curReq = req;
    const q = k => u.searchParams.get(k);
    const send = (out) => {
      if (out && out.raw) {
        res.writeHead(out.raw.status || 200, { 'content-type': out.raw.type || 'application/octet-stream', ...(out.raw.headers || {}) });
        res.end(out.raw.body);
      } else json(res, 200, out);
      return true;
    };
    try {
      if (req.method === 'GET' && FREE_GET[route]) return send(await FREE_GET[route](q, req));
      if (req.method === 'POST' && UPLOAD[route]) {
        if (opts.readOnly) throw new UserError('现在是只读模式');
        if (route !== 'upload/game') checkProject(req, true);
        return send({ ok: true, ...(await UPLOAD[route](req, q)) });
      }
      if (req.method === 'POST' && FREE_POST[route]) {
        const b = await readBody(req);
        if (opts.readOnly) throw new UserError('现在是只读模式');
        return send({ ok: true, ...(await FREE_POST[route](b)) });
      }
      if (!fs.existsSync(path.join(project.dataDir(), 'System.json'))) throw new UserError('找不到游戏数据：' + project.dataDir() + '（需要 RPG Maker MV/MZ 工程的 data 目录）', { noGame: true });
      if (req.method === 'GET' && GET[route]) {
        checkProject(req);
        return send(await GET[route](tools(), q, req));
      }
      if (req.method === 'POST' && POST[route]) {
        const b = await readBody(req);
        if (opts.readOnly) throw new UserError('现在是只读模式');
        // 请求体可能上传了一段时间，必须在读完后、开始写盘前重新检查。
        checkProject(req, true);
        return json(res, 200, { ok: true, ...(await POST[route](tools(), b)) }), true;
      }
      json(res, 404, { error: '没有这个接口：' + req.method + ' ' + p });
      return true;
    } catch (e) {
      if (e instanceof UserError) json(res, e.status || 400, { error: e.message, problems: e.problems, noGame: e.noGame || undefined, projectChanged: e.projectChanged || undefined });
      else { console.error('[studio] ' + req.method + ' ' + req.url + '\n' + (e && e.stack || e)); json(res, 500, { error: '出错了：' + e.message }); }
      return true;
    }
  }

  return { handle, project, tools, registry };
}

module.exports = { createStudio };
