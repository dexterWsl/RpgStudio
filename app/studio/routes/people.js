'use strict';
// 人物和小人：人物列表 / 人物页、新建改人物、手动关联、给人物新建数值、存行走图 / 头像
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, UserError } = require('../lib/util.js');
const { writeLinks } = require('../core/people.js');
const { parsePassive, changeRule } = require('../core/variable-rules.js');
const fs = require('fs');
module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  function personView(T, key) {
    const p = T.people.get(key);
    need(p, '没有这个人物');
    const a = p.actorId ? (project.read('Actors.json') || [])[p.actorId] : null;
    const pages = [...p.pages.values()].sort((x, y) => (y.says - x.says) || (y.appears - x.appears)).map(e => ({ at: e.at, where: where(e.at), says: e.says, appears: e.appears }));
    return {
      key, actorId: p.actorId || 0, name: p.name, speakerOnly: !!p.speakerOnly,
      actor: a ? { name: a.name || '', nickname: a.nickname || '', profile: a.profile || '', characterName: a.characterName || '', characterIndex: a.characterIndex || 0, faceName: a.faceName || '', faceIndex: a.faceIndex || 0 } : null,
      lines: p.lines, pages, related: T.people.related(key, 40), links: p.links || [],
      hint: p.actorId ? hint('actor:' + p.actorId) : '',
    };
  }
  // 行走图 / 头像库：每张图被谁用（键 = 图名#第几个）
  function sheetList(T, sub) {
    const kind = sub === 'faces' ? 'face' : 'sprite';
    const uses = {};
    for (const [k, list] of T.xref.index().by) if (k.startsWith(kind + ':')) uses[k.slice(kind.length + 1)] = list.length;
    return project.listImages(sub).map(name => {
      const u = {};
      for (let i = 0; i < 8; i++) if (uses[name + '#' + i]) u[i] = uses[name + '#' + i];
      return { name, big: sub === 'characters' && /^[!]*\$/.test(name), object: /^[!$]*!/.test(name), uses: u };
    });
  }
  const pngSize = buf => (buf.length > 24 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : { w: 0, h: 0 });
  function spriteGuide(T) {
    const groups = new Map();
    for (const sheet of sheetList(T, 'characters')) {
      if (sheet.object) continue;
      const size = project.imageSize('characters', sheet.name);
      if (!size) continue;
      const width = size.w / (sheet.big ? 3 : 12), height = size.h / (sheet.big ? 4 : 8);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) continue;
      const key = width + 'x' + height;
      if (!groups.has(key)) groups.set(key, { width, height, sheets: 0, uses: 0, sample: null });
      const group = groups.get(key);
      const ranked = Object.entries(sheet.uses).sort((a, b) => b[1] - a[1]);
      const [index, uses] = ranked[0] || [0, 0];
      group.sheets++;
      group.uses += ranked.reduce((sum, [, count]) => sum + count, 0);
      if (!group.sample || uses > group.sample.uses) group.sample = { name: sheet.name, index: Number(index), uses, big: sheet.big };
    }
    const sizes = [...groups.values()].sort((a, b) => b.uses - a.uses || b.sheets - a.sheets);
    const system = project.sys();
    const tileSize = Number(system.tileSize) || 48;
    return { sizes: sizes.slice(0, 3), tileSize, recommended: sizes[0] || { width: tileSize, height: tileSize }, canWrite: !opts.readOnly,
      leader: Number(system.partyMembers?.[0]) || 0, actors: project.rows('actor'), sideView: !!system.optSideView, startMap: Number(system.startMapId) || 0 };
  }
  function newActor(id, b) {
    return {
      id, battlerName: '', characterIndex: 0, characterName: '', classId: 1, equips: [0, 0, 0, 0, 0], faceIndex: 0, faceName: '',
      traits: [], initialLevel: 1, maxLevel: 99, name: String(b.name || '').trim().slice(0, 40), nickname: '', note: '', profile: '',
    };
  }
  function applyActor(a, b) {
    if (b.name != null) { const n = String(b.name).trim().slice(0, 40); need(n, '名字不能为空'); a.name = n; }
    if (b.nickname != null) a.nickname = String(b.nickname).slice(0, 40);
    if (b.profile != null) a.profile = String(b.profile).slice(0, 400);
    if (b.characterName != null) {
      const n = String(b.characterName);
      if (n) need(project.findImage('characters', n), '行走图「' + n + '」不存在');
      a.characterName = n;
      a.characterIndex = n && !/^[!]*\$/.test(n) ? int(b.characterIndex || 0) : 0;
      need(a.characterIndex >= 0 && a.characterIndex <= 7, '第几个只能是 0~7');
    }
    if (b.faceName != null) {
      const n = String(b.faceName);
      if (n) need(project.findImage('faces', n), '头像「' + n + '」不存在');
      a.faceName = n;
      a.faceIndex = n ? int(b.faceIndex || 0) : 0;
      need(a.faceIndex >= 0 && a.faceIndex <= 7, '头像第几个只能是 0~7');
    }
    if (b.battlerName != null) {
      const n = String(b.battlerName);
      if (n) need(project.findImage('sv_actors', n), '侧视战斗图「' + n + '」不存在');
      a.battlerName = n;
    }
  }
  Object.assign(V, { personView });
  return {
    get: {
      people: T => ({ people: T.people.list() }),
      person: (T, q) => personView(T, String(q('key') || '')),
      sheets: (T, q) => ({ sub: q('sub') === 'faces' ? 'faces' : 'characters', sheets: sheetList(T, q('sub') === 'faces' ? 'faces' : 'characters'), canWrite: !opts.readOnly }),
      'sprite-guide': spriteGuide,
      'sheet-usage'(T, q) {
        const kind = q('sub') === 'faces' ? 'face' : 'sprite';
        const id = String(q('name') || '') + '#' + int(q('index') || 0);
        return { refs: T.xref.of(kind, id).map(r => ({ ...r, where: where(r.at) })) };
      },
    },
    post: {
    'actor/update'(T, b) {
      const id = int(b.id, '角色编号不对');
      T.store.edit(b.enableSideView ? ['Actors.json', 'System.json'] : ['Actors.json'], docs => {
        const a = docs['Actors.json'][id];
        need(a, '角色 ' + id + ' 不存在');
        applyActor(a, b);
        if (b.enableSideView) docs['System.json'].optSideView = true;
      });
      return { person: personView(tools(), 'a' + id) };
    },
    'actor/create'(T, b) {
      need(String(b.name || '').trim(), '给人物起个名字');
      let id = 0;
      T.store.edit(b.makeLeader || b.enableSideView ? ['Actors.json', 'System.json'] : ['Actors.json'], docs => {
        const arr = docs['Actors.json'];
        id = arr.findIndex((a, i) => i > 0 && (!a || (!String(a.name || '').trim() && !a.characterName && !a.faceName)));
        if (id < 0) { id = arr.length; arr.push(null); }
        need(id <= 9999, '角色太多了');
        arr[id] = newActor(id, b);
        applyActor(arr[id], b);
        if (b.makeLeader) {
          const system = docs['System.json'];
          system.partyMembers = [id, ...(system.partyMembers || []).filter(actor => actor !== id)].slice(0, 8);
        }
        if (b.enableSideView) docs['System.json'].optSideView = true;
      });
      return { id, person: personView(tools(), 'a' + id) };
    },
    'doll/save'(T, b) {
      const name = String(b.name || '').trim();
      need(/^[\w\u4e00-\u9fff][\w\u4e00-\u9fff .()\-]{0,56}$/.test(name), '素材名最多 57 字，可用中文、字母、数字、空格、括号、下划线和短横线');
      const assets = [
        { sub: 'characters', name: '$' + name, cols: 3, rows: 4, data: b.walk },
        { sub: 'sv_actors', name, cols: 9, rows: 6, data: b.battle },
        { sub: 'characters', name: '$' + name + '_攻击', cols: 3, rows: 4, data: b.attack },
      ];
      const root = ctx.uploadRoot(), encrypt = ctx.encryptUploads();
      let cell = null;
      for (const a of assets) {
        a.buf = Buffer.from(String(a.data || '').replace(/^data:image\/png;base64,/, ''), 'base64');
        const { w, h } = pngSize(a.buf);
        need(a.buf.length > 60 && a.buf.length < 12e6 && a.buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          a.buf.toString('ascii', 12, 16) === 'IHDR' && w > 0 && h > 0 && w % a.cols === 0 && h % a.rows === 0, '行走图、攻击图或战斗图的 PNG 格式不对');
        const size = (w / a.cols) + 'x' + (h / a.rows);
        need(!cell || cell === size, '三张素材的单帧像素尺寸必须一致');
        cell = size;
        need(!project.findImage(a.sub, a.name) && !project.assetExists('img', a.sub, a.name, root), '已有素材「' + a.name + '」，请另取名字');
      }
      const written = [];
      try {
        for (const a of assets) written.push(project.writeImage(a.sub, a.name, a.buf, { root, encrypt, overwrite: false }).file);
      } catch (e) {
        for (const file of written) {
          try { fs.unlinkSync(file); }
          catch (cleanup) { console.error('[studio] doll/save: ' + cleanup.message); }
        }
        throw new UserError(e.message);
      }
      if (opts.onWrite) { try { opts.onWrite(assets.map(a => 'img/' + a.sub + '/' + a.name)); } catch { } }
      return { walk: assets[0].name, battle: assets[1].name, attack: assets[2].name, encrypted: encrypt };
    },
    // 手动把一个开关 / 变量关联到角色（写在角色备注里：<RpgStudioLinks:var 12,switch 3>）
    'person/link'(T, b) {
      const id = int(b.actor, '只有数据库角色能手动关联');
      const kind = b.kind === 'switch' ? 'switch' : 'var';
      const vid = int(b.id);
      need(project.has(kind, vid), (kind === 'var' ? '变量 ' : '开关 ') + vid + ' 超出范围');
      T.store.edit(['Actors.json'], docs => {
        const a = docs['Actors.json'][id];
        need(a, '角色 ' + id + ' 不存在');
        const links = require('../core/people.js').parseLinks(a.note).filter(l => !(l.kind === kind && l.id === vid));
        if (b.on !== false) links.push({ kind, id: vid });
        a.note = writeLinks(a.note, links);
      });
      return { person: personView(tools(), 'a' + id) };
    },
    // 给人物新建一个数值：名字是「人物名·数值名」，数据库角色会顺便手动关联
    'person/newvar'(T, b) {
      const p = T.people.get(String(b.key || ''));
      need(p, '没有这个人物');
      const kind = b.kind === 'switch' ? 'switch' : 'var';
      const label = String(b.label || '').trim().slice(0, 30);
      need(label, '给数值起个名字');
      const name = (p.name + '·' + label).slice(0, 40);
      const passive = kind === 'var' ? parsePassive(b.passive) : undefined;
      // 新开关 / 变量和手动关联一次写完（分两次写要重建两遍索引，慢）
      const id = V.freeSlot(T, kind);
      need(id >= 1 && id <= 5000, '编号不对');
      T.store.edit(['System.json', ...(p.actorId ? ['Actors.json'] : [])], docs => {
        const system = docs['System.json'];
        const arr = system[kind === 'var' ? 'variables' : 'switches'];
        while (arr.length <= id) arr.push('');
        arr[id] = name;
        if (p.actorId) {
          const a = docs['Actors.json'][p.actorId];
          need(a, '角色 ' + p.actorId + ' 不存在');
          const links = require('../core/people.js').parseLinks(a.note).filter(l => !(l.kind === kind && l.id === id));
          links.push({ kind, id });
          a.note = writeLinks(a.note, links);
        }
        if (passive !== undefined) changeRule(ctx, system, 'passive', id, passive);
      });
      // 改条件弹窗里只要编号和名字；人物页才要整个人物视图
      return { id, kind, name, person: b.view === false ? undefined : personView(tools(), p.key) };
    },
    // 存一张图（行走图 / 头像）：base64 的 PNG
    'image/save'(T, b) {
      const sub = b.sub === 'faces' ? 'faces' : 'characters';
      const buf = Buffer.from(String(b.data || '').replace(/^data:image\/png;base64,/, ''), 'base64');
      need(buf.length > 60 && buf.length < 12e6, '图片太大或者是空的（最多 12MB）');
      const { w, h } = pngSize(buf);
      const name = String(b.name || '').trim();
      if (sub === 'characters') {
        if (/^[!]*\$/.test(name)) need(w % 3 === 0 && h % 4 === 0, `单人行走图要能切成 3 列 × 4 行（现在 ${w}×${h}）`);
        else need(w % 12 === 0 && h % 8 === 0, `8 人行走图要能切成 12 列 × 8 行（现在 ${w}×${h}）。只有一个人的图，名字前面加 $`);
      } else need(w % 4 === 0 && h % 2 === 0, `头像图要能切成 4 列 × 2 行（现在 ${w}×${h}）`);
      let r;
      try { r = project.writeImage(sub, name, buf, { root: ctx.uploadRoot(), encrypt: ctx.encryptUploads(), overwrite: !!b.overwrite, backupDir: ctx.assetBackupDir() }); }
      catch (e) { throw new UserError(e.message); }
      if (opts.onWrite) { try { opts.onWrite(['img/' + sub + '/' + name]); } catch { } }
      return { name, sub, width: w, height: h, encrypted: r.encrypted };
    },
    },
  };
};
