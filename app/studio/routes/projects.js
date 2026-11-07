'use strict';
// 工程列表 / 导入游戏（不需要当前有能打开的游戏，所以都是 free / upload）
//   GET  projects                  工程列表（标题、引擎、地图数、当前是哪个）
//   POST projects/use {id}         切换
//   POST projects/folder {path, mode: copy|inplace, name}   导入本机文件夹
//   POST upload/game?name=x.zip    上传 zip 导入（请求体就是文件）
//   POST projects/rename {id, name}、projects/remove {id, deleteFiles}
//   GET  projects/export?id=       导出导入以后改过的文件（zip）
//   GET  projects/engines          新建游戏时引擎能从哪拷：找到的 RPG Maker MZ、列表里的 MZ 游戏
//   POST projects/new {title, engine: {project} | {path}, copyAssets, hero}   新建空白游戏（放进系统，切换过去）
const fs = require('fs');
const path = require('path');
const { need, UserError } = require('../lib/util.js');
const { writeZip } = require('../core/zip.js');
const Blank = require('../core/blank.js');

module.exports = function (ctx) {
  const reg = ctx.registry;
  const off = () => need(reg, '这个服务没有打开工程列表（只有本机版 / 编辑器里有）');
  const maxUpload = () => { const m = ctx.opts.projects && ctx.opts.projects.maxUpload; return Number(typeof m === 'function' ? m() : m) || 4 * 1024 * 1024 * 1024; };
  const view = () => {
    off();
    const cur = reg.current();
    return {
      current: cur ? cur.id : '',
      dir: reg.dir(),
      canImportFolder: ctx.canConfigure(),
      list: reg.list().map(p => {
        const info = reg.inspectGame(p.gameDir);
        return { id: p.id, name: p.name, mode: p.mode, builtin: !!p.builtin, gameDir: p.gameDir, source: p.source || '', addedAt: p.addedAt || 0, ok: info.ok, error: info.error || '', title: info.title || '', engine: info.engine || '', maps: info.maps || 0, encryptedImages: !!info.encryptedImages };
      }),
    };
  };
  // 导入以后改过的文件（data / img / audio / js/plugins.js），按修改时间
  function changedFiles(p) {
    const since = p.addedAt || 0;   // 解压 / 复制都在登记之前做完，之后改的才算
    const out = [];
    const walk = (d, rel) => {
      let list = [];
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const f = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(f, r);
        else { try { if (fs.statSync(f).mtimeMs > since) out.push({ file: f, name: r }); } catch { } }
      }
    };
    for (const sub of ['data', 'www/data', 'img', 'www/img', 'audio', 'www/audio', 'movies', 'www/movies']) walk(path.join(p.gameDir, sub), sub);
    for (const f of ['js/plugins.js', 'www/js/plugins.js']) { const full = path.join(p.gameDir, f); try { if (fs.statSync(full).mtimeMs > since) out.push({ file: full, name: f }); } catch { } }
    return out;
  }
  return {
    free: {
      get: {
        projects: () => view(),
        'projects/engines'() {
          off();
          const installs = ctx.canConfigure() ? Blank.findRpgMakerMZ().map(p => ({ path: p, label: 'RPG Maker MZ 自带的空白工程', version: Blank.engineInfo(p).version || '', newdata: true })) : [];
          const games = reg.list().map(p => ({ p, e: Blank.engineInfo(p.gameDir) })).filter(x => x.e.ok)
            .map(x => ({ project: x.p.id, label: x.p.name, version: x.e.version || '', path: x.p.gameDir }));
          return { installs, games, canBrowse: ctx.canConfigure() };
        },
        'projects/folders'(q) {
          off();
          need(ctx.canConfigure(), '只有管理员能浏览这台电脑上的文件夹；普通账号请上传游戏 zip');
          const selected = String(q('path') || '').trim();
          if (!selected) {
            const roots = process.platform === 'win32'
              ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => c + ':\\').filter(p => fs.existsSync(p))
              : ['/'];
            return { path: '', parent: '', folders: roots.map(p => ({ name: p, path: p, game: false })), game: false };
          }
          const dir = path.resolve(selected);
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
          catch { throw new UserError('打不开这个文件夹，请检查路径或选择其他文件夹'); }
          const isGame = p => ['data/System.json', 'www/data/System.json'].some(f => fs.existsSync(path.join(p, f)));
          const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
            .map(e => { const p = path.join(dir, e.name); return { name: e.name, path: p, game: isGame(p) }; });
          const parent = path.dirname(dir);
          return { path: dir, parent: parent === dir ? '' : parent, folders, game: isGame(dir) };
        },
        'projects/export'(q) {
          off();
          const p = reg.get(String(q('id') || ''));
          need(p, '没有这个工程');
          need(!p.builtin, '内置工程请用它自己的导出');
          const files = changedFiles(p);
          need(files.length, '导入以后还没有改过任何文件');
          need(files.reduce((n, f) => n + fs.statSync(f.file).size, 0) < 512 * 1048576, '改过的文件太多太大（超过 512MB），直接复制工程文件夹吧：' + p.gameDir);
          const buf = writeZip(files.map(f => ({ name: f.name, data: fs.readFileSync(f.file) })));
          const fname = `${p.name}-改动-${new Date().toISOString().slice(0, 10)}.zip`;
          return { raw: { status: 200, type: 'application/zip', headers: { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`, 'content-length': buf.length }, body: buf } };
        },
      },
      post: {
        'projects/new'(b) {
          off();
          const e = b.engine || {};
          let engineDir = '';
          if (e.project) {
            const p = reg.get(String(e.project));
            need(p, '没有这个工程');
            engineDir = p.gameDir;
          } else {
            need(ctx.canConfigure(), '只有管理员能从这台电脑上的文件夹拷引擎');
            engineDir = String(e.path || '').trim().replace(/^["']|["']$/g, '');
            need(engineDir, '选一个引擎来源：RPG Maker MZ 的 newdata 文件夹，或者一个 MZ 游戏');
          }
          const info = Blank.engineInfo(engineDir);
          need(info.ok, info.error);
          const id = 'p' + Date.now().toString(36) + require('crypto').randomBytes(2).toString('hex');
          let r;
          try { r = Blank.createGame(path.join(reg.dir(), id), { title: b.title, engineDir: info.dir, copyAssets: !!b.copyAssets, hero: String(b.hero || '').trim().slice(0, 20) || '主角' }); }
          catch (err) { throw new UserError(err.message); }
          const project = reg.add({ id, name: String(b.name || '').trim() || r.title, gameDir: r.dir, mode: 'copy', source: '新建（引擎：' + info.dir + '）' });
          return { project, info: reg.inspectGame(r.dir), engine: { version: info.version, assets: r.assets }, view: view() };
        },
        'projects/use'(b) { off(); try { reg.use(String(b.id || '')); } catch (e) { throw new UserError(e.message); } return view(); },
        'projects/rename'(b) { off(); try { reg.rename(String(b.id || ''), b.name); } catch (e) { throw new UserError(e.message); } return view(); },
        'projects/remove'(b) {
          off();
          try { reg.remove(String(b.id || ''), !!b.deleteFiles); } catch (e) { throw new UserError(e.message); }
          return view();
        },
        async 'projects/folder'(b) {
          off();
          // 云端：服务器上的文件夹（包括别人的工作区）只有管理员能导入；普通用户用上传 zip
          need(ctx.canConfigure(), '只有管理员能导入服务器上的文件夹，请用「上传压缩包」');
          need(String(b.path || '').trim(), '填游戏文件夹的路径');
          let r;
          try { r = await reg.importFolder(b.path, { mode: b.mode === 'inplace' ? 'inplace' : 'copy', name: b.name }); }
          catch (e) { throw new UserError(e.message); }
          return { project: r.project, info: r.info, view: view() };
        },
      },
    },
    upload: {
      async 'upload/game'(req, q) {
        off();
        const name = String(q('name') || 'game.zip');
        need(/\.zip$/i.test(name), '只支持 zip 压缩包（rar / 7z 请先转成 zip，或者用「本机文件夹」导入）');
        const tmp = path.join(reg.dir(), '_uploads', Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.zip');
        await ctx.saveUpload(req, tmp, maxUpload());
        try {
          const r = await reg.importZip(tmp, { name: q('title') || '', source: name });
          return { project: r.project, info: r.info, files: r.files, view: view() };
        } catch (e) { throw new UserError(e.message); }
        finally { fs.rm(tmp, { force: true }, () => { }); }
      },
    },
  };
};
