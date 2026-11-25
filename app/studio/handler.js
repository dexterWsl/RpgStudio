'use strict';
// 通用剧情编辑器（rpgStudio）的接口。不认识任何具体游戏：给它一个 MV/MZ 工程就能用。
//   const studio = createStudio({ gameDir, dataDir, backupsDir, settingsFile, extraImgRoots })
//   if (await studio.handle(req, res, url)) return;      // 处理 /studio、/studio/* 静态文件和 /api/studio/*
// gameDir / dataDir 可以是函数（云端每个请求切换到当前用户的工作区）。
//
// 这里只负责组装和分发：
//   工程（core/project.js）· 工程列表（core/projects.js）· 设置（core/settings.js）
//   一次请求的工具（core/tools.js）· HTTP 小工具（lib/http.js）· 位置（lib/at.js）
//   然后把 /api/studio/<路由> 分给 routes/ 里各功能的模块：
//   core 工程总览 · events 事件 · maps 地图 · placing 出口和路人 · tilesets 图块集 · system 游戏设置 · names 开关变量
//   people 人物小人 · images 图片 · gallery 回想房 · projects 工程列表 / 导入游戏 · assets 导入素材 · progress 剧情进度 · scenes 场景库
// 另外 /play/<工程编号>/ 是试玩：把当前游戏的文件按网页发出去（core/playtest.js）
// opts.projects = { dir, builtinName, maxUpload }：开了就能放多个游戏（内置工程 = gameDir 指的那个），切换后整个编辑器换成那个游戏
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { createProject, defaultDataDir } = require('./core/project.js');
const { createRegistry } = require('./core/projects.js');
const { createSettings } = require('./core/settings.js');
const { createTools } = require('./core/tools.js');
const { createPlaytest } = require('./core/playtest.js');
const { questOf } = require('./core/quests.js');
const Profiles = require('./profiles/index.js');
const { createAt } = require('./lib/at.js');
const { json, readBody, saveUpload, createHostGuard, createStatic } = require('./lib/http.js');
const { UserError } = require('./lib/util.js');

const WEB = path.join(__dirname, 'web');
const MODULES = ['core', 'events', 'maps', 'placing', 'tilesets', 'system', 'names', 'people', 'images', 'gallery', 'projects', 'assets', 'progress', 'scenes', 'settlements', 'inventory', 'map-templates', 'quests', 'world-time', 'relationships', 'enemies', 'map-enemies', 'plugins', 'layered-portrait'].map(n => require('./routes/' + n + '.js'));
const DEFAULT_MAX_UPLOAD = 4 * 1024 ** 3;   // 上传游戏 / 素材包的上限（opts.projects.maxUpload 可以改）
const val = v => (typeof v === 'function' ? v() : v);

function createStudio(opts) {
  // ---------- 工程：当前是内置工程还是导入的 ----------
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

  // ---------- 设置、配置、工具 ----------
  const S = createSettings({ project, file: () => val(opts.settingsFile) });
  const settings = S.get, saveSettings = S.save;
  const profile = () => Profiles.pick(project, settings().profile || (isBuiltin() ? opts.profile : ''));
  const picOptions = () => ({ ...profile().pictures, ...(settings().pictures || {}) });
  const tools = () => createTools({ project, profile, picOptions, settings, backupsDir, onWrite, where, workDataDir });

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
    if (at.type === 'quest') return '任务 · ' + (questOf(project.sys(), String(at.quest))?.name || at.quest);
    if (at.type === 'world-time') return '人物 · 世界时间';
    if (at.type === 'system') return '游戏设置';
    if (at.type === 'var-rule') return at.rule === 'group' ? '变量组 · ' + project.label('switch', at.id) : '自动累计 · ' + project.label('var', at.id);
    return '';
  }
  const hint = key => profile().hints[key] || '';
  function firstLine(list) {
    for (const c of list || []) if (c.code === 401 && String(c.parameters[0] || '').trim()) return project.expandN(c.parameters[0]).slice(0, 40);
    return '';
  }
  const lineCount = list => (list || []).filter(c => c.code === 401).length;

  // 当前请求（「能不能改工程设置」要看是谁在问）：每个请求自己一份，并发请求不会互相串
  const reqStore = new AsyncLocalStorage();
  const canConfigure = () => (typeof opts.canConfigure === 'function' ? !!opts.canConfigure(reqStore.getStore() || null) : opts.canConfigure !== false);
  // 上传的图放哪、要不要加密：云端放用户工作区（导出时再加密）；本地放进游戏目录，按游戏的设置加密
  const uploadRoot = () => (isBuiltin() ? val(opts.uploadRoot) : null) || null;
  const encryptUploads = () => (isBuiltin() && opts.encryptUploads != null ? !!val(opts.encryptUploads) : !!project.sys().hasEncryptedImages);
  const assetBackupDir = (kind = 'images') => { const b = backupsDir(); const d = new Date(); const pad = n => String(n).padStart(2, '0'); return path.join(b || path.join(os.tmpdir(), 'studio-backups'), kind + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())); };
  const maxUpload = () => Number(val(opts.projects && opts.projects.maxUpload)) || DEFAULT_MAX_UPLOAD;

  // ---------- 试玩：/play/<工程编号>/ 直接在浏览器里跑当前游戏 ----------
  const playId = () => { const c = curProject(); return c ? c.id : 'main'; };
  const workDataDir = () => {
    const dir = project.dataDir();
    return path.relative(defaultDataDir(project.gameDir()), dir) ? dir : '';
  };
  const playtest = createPlaytest({ root: () => project.gameRoot(), id: playId, workDataDir, system: project.sys, uploadRoot });

  // ---------- 各功能模块 ----------
  const ctx = {
    opts, project, tools, where, hint, settings, saveSettings, profile, picOptions, canConfigure,
    firstLine, lineCount, uploadRoot, encryptUploads, assetBackupDir, backupsDir, saveUpload, maxUpload,
    registry, curProject, isBuiltin, projectKey, playId, workDataDir,
    at: createAt(project),
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

  // ---------- HTTP ----------
  const sameOriginOnly = createHostGuard(val(opts.allowHosts));
  const serveStatic = createStatic(WEB, opts.transformHtml);

  async function dispatch(req, res, route, u) {
    const q = k => u.searchParams.get(k);
    const send = out => {
      if (out && out.raw) {
        res.writeHead(out.raw.status || 200, { 'content-type': out.raw.type || 'application/octet-stream', ...(out.raw.headers || {}) });
        res.end(out.raw.body);
      } else json(res, 200, out);
      return true;
    };
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
      json(res, 200, { ok: true, ...(await POST[route](tools(), b)) });
      return true;
    }
    json(res, 404, { error: '没有这个接口：' + req.method + ' ' + u.pathname });
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
    try {
      return await reqStore.run(req, () => dispatch(req, res, p.slice('/api/studio/'.length), u));
    } catch (e) {
      if (e instanceof UserError) json(res, e.status || 400, { error: e.message, problems: e.problems, noGame: e.noGame || undefined, projectChanged: e.projectChanged || undefined });
      else { console.error('[studio] ' + req.method + ' ' + req.url + '\n' + (e && e.stack || e)); json(res, 500, { error: '出错了：' + e.message }); }
      return true;
    }
  }

  return { handle, project, tools, registry };
}

module.exports = { createStudio };
