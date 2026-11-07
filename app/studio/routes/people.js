'use strict';
// 人物和小人：人物列表 / 人物页、新建改人物、手动关联、给人物新建数值、存行走图 / 头像
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const { writeLinks } = require('../core/people.js');
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
  }
  Object.assign(V, { personView });
  return {
    get: {
      people: T => ({ people: T.people.list() }),
      person: (T, q) => personView(T, String(q('key') || '')),
      sheets: (T, q) => ({ sub: q('sub') === 'faces' ? 'faces' : 'characters', sheets: sheetList(T, q('sub') === 'faces' ? 'faces' : 'characters'), canWrite: !opts.readOnly }),
      'sheet-usage'(T, q) {
        const kind = q('sub') === 'faces' ? 'face' : 'sprite';
        const id = String(q('name') || '') + '#' + int(q('index') || 0);
        return { refs: T.xref.of(kind, id).map(r => ({ ...r, where: where(r.at) })) };
      },
    },
    post: {
    'actor/update'(T, b) {
      const id = int(b.id, '角色编号不对');
      T.store.edit(['Actors.json'], docs => {
        const a = docs['Actors.json'][id];
        need(a, '角色 ' + id + ' 不存在');
        applyActor(a, b);
      });
      return { person: personView(tools(), 'a' + id) };
    },
    'actor/create'(T, b) {
      need(String(b.name || '').trim(), '给人物起个名字');
      let id = 0;
      T.store.edit(['Actors.json'], docs => {
        const arr = docs['Actors.json'];
        id = arr.findIndex((a, i) => i > 0 && (!a || (!String(a.name || '').trim() && !a.characterName && !a.faceName)));
        if (id < 0) { id = arr.length; arr.push(null); }
        need(id <= 9999, '角色太多了');
        arr[id] = newActor(id, b);
        applyActor(arr[id], b);
      });
      return { id, person: personView(tools(), 'a' + id) };
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
      // 新开关 / 变量和手动关联一次写完（分两次写要重建两遍索引，慢）
      const id = V.freeSlot(T, kind);
      need(id >= 1 && id <= 5000, '编号不对');
      T.store.edit(['System.json', ...(p.actorId ? ['Actors.json'] : [])], docs => {
        const arr = docs['System.json'][kind === 'var' ? 'variables' : 'switches'];
        while (arr.length <= id) arr.push('');
        arr[id] = name;
        if (p.actorId) {
          const a = docs['Actors.json'][p.actorId];
          need(a, '角色 ' + p.actorId + ' 不存在');
          const links = require('../core/people.js').parseLinks(a.note).filter(l => !(l.kind === kind && l.id === id));
          links.push({ kind, id });
          a.note = writeLinks(a.note, links);
        }
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
