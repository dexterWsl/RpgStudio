'use strict';
// 事件 / 事件页 / 公共事件：阅读视图、改台词、出现条件、新建删除挪页
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const { TRIGGERS, PRIORITIES, CE_TRIGGERS } = require('../core/commands.js');
module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  // ---------- 读 ----------
  function pageView(T, list, extra = {}) {
    const al = T.merger.analyzeList(list, { baseIndent: 0 });
    return {
      ...extra,
      outline: T.describer.outline(list),
      script: { editable: al.editable, reason: al.reason || '', text: al.text },
      commands: list.length,
    };
  }

  function eventView(T, mapId, evId) {
    const m = project.map(mapId);
    need(m, '地图 ' + mapId + ' 不存在');
    const e = (m.events || [])[evId];
    need(e, `地图 ${mapId} 里没有事件 ${evId}`);
    // 这个事件自己的独立开关：哪里开、哪里判断
    const self = {};
    e.pages.forEach((pg, pi) => {
      if (pg.conditions.selfSwitchValid) (self[pg.conditions.selfSwitchCh] = self[pg.conditions.selfSwitchCh] || []).push({ page: pi, use: 'check', text: '出现条件' });
      (pg.list || []).forEach((c, i) => {
        if (c.code === 123) (self[c.parameters[0]] = self[c.parameters[0]] || []).push({ page: pi, line: i, use: 'set', text: T.describer.describe(c) });
        if (c.code === 111 && c.parameters[0] === 2) (self[c.parameters[1]] = self[c.parameters[1]] || []).push({ page: pi, line: i, use: 'check', text: T.describer.describe(c) });
      });
    });
    return {
      map: mapId, mapName: project.name('map', mapId), id: e.id, name: e.name, note: e.note || '', x: e.x, y: e.y,
      hint: hint(`map:${mapId}/ev:${e.id}`),
      selfSwitches: self,
      people: peopleInEvent(T, mapId, e.id),
      stages: stagesOf(T, mapId, e.id),
      pages: e.pages.map((pg, pi) => pageView(T, pg.list || [], {
        index: pi,
        conditions: pg.conditions,
        conditionText: T.describer.pageConditions(pg.conditions),
        trigger: pg.trigger, triggerText: TRIGGERS[pg.trigger] || '',
        priorityType: pg.priorityType, priorityText: PRIORITIES[pg.priorityType] || '',
        image: pg.image,
        moveType: pg.moveType, through: pg.through,
      })),
    };
  }

  function ceList(T) {
    const calls = T.xref.counts('ce');
    return (project.read('CommonEvents.json') || []).filter(c => c && c.id > 0 && (String(c.name || '').trim() || (c.list || []).length > 1)).map(c => ({
      id: c.id, name: String(c.name || ''), trigger: c.trigger || 0, switchId: c.switchId || 0,
      triggerText: c.trigger ? `${CE_TRIGGERS[c.trigger]}（${project.label('switch', c.switchId)}）` : '',
      lines: ctx.lineCount(c.list), commands: Math.max(0, (c.list || []).length - 1),
      calls: (calls[c.id] || {}).total || 0, hint: hint('ce:' + c.id),
    }));
  }

  // ---------- 写 ----------
  function locate(docs, at) {
    if (at.type === 'map') {
      const doc = docs[project.mapFile(at.map)];
      need(doc, '地图 ' + at.map + ' 不存在');
      const e = (doc.events || [])[at.ev];
      need(e, `地图 ${at.map} 里没有事件 ${at.ev}`);
      const pg = e.pages[at.page];
      need(pg, `事件 ${at.ev} 没有第 ${at.page + 1} 页`);
      return { holder: pg, doc, event: e };
    }
    if (at.type === 'ce') {
      const c = (docs['CommonEvents.json'] || [])[at.ce];
      need(c, '公共事件 ' + at.ce + ' 不存在');
      return { holder: c };
    }
    throw new UserError('不认识的位置');
  }
  const fileOf = at => (at.type === 'map' ? project.mapFile(at.map) : 'CommonEvents.json');
  const target = b => {
    const at = b.at || {};
    if (at.type === 'map') return { type: 'map', map: int(at.map, '地图编号不对'), ev: int(at.ev, '事件编号不对'), page: int(at.page || 0, '页码不对') };
    if (at.type === 'ce') return { type: 'ce', ce: int(at.ce, '公共事件编号不对') };
    throw new UserError('缺少位置');
  };
  const problemText = list => list.slice(0, 6).map(e => `第 ${e.line + 1} 条：${e.msg}`).join('；');

  function saveText(T, b) {
    const at = target(b);
    const r = T.store.edit([fileOf(at)], docs => {
      const { holder } = locate(docs, at);
      const list = holder.list || [END()];
      const al = T.merger.analyzeList(list, { baseIndent: 0 });
      if (!al.editable) throw new UserError('这一页不能用编辑框改：' + (al.reason || '结构复杂'));
      let merged;
      try { merged = T.merger.mergeList(list, String(b.text || ''), { analysis: al }); }
      catch (e) { throw new UserError(e.message); }
      if (merged.unchanged) return { unchanged: true };
      const v = T.validator.newProblems(list, merged.list);
      if (v.fresh.length) throw new UserError('保存后会出现新的问题，没有保存：' + problemText(v.fresh), { problems: v.fresh });
      holder.list = merged.list;
      return { unchanged: false, warnings: v.warnings.map(w => w.msg) };
    });
    return { ...r.result, changed: r.changed, view: at.type === 'map' ? eventView(T, at.map, at.ev) : ceView(T, at.ce) };
  }

  function ceView(T, id) {
    const c = (project.read('CommonEvents.json') || [])[id];
    need(c, '公共事件 ' + id + ' 不存在');
    return pageView(T, c.list || [END()], {
      id, name: c.name, trigger: c.trigger || 0, switchId: c.switchId || 1,
      triggerText: c.trigger ? `${CE_TRIGGERS[c.trigger]}（${project.label('switch', c.switchId)} 为开时）` : CE_TRIGGERS[0],
      hint: hint('ce:' + id),
      isScene: T.scenes.isMarked(c.list),
      calledFrom: T.xref.of('ce', id).map(r => ({ ...r, where: where(r.at) })),
    });
  }

  function checkConditions(cd) {
    const out = blankPage().conditions;
    const b = v => !!v;
    out.switch1Valid = b(cd.switch1Valid); out.switch1Id = int(cd.switch1Id || 1);
    out.switch2Valid = b(cd.switch2Valid); out.switch2Id = int(cd.switch2Id || 1);
    out.variableValid = b(cd.variableValid); out.variableId = int(cd.variableId || 1); out.variableValue = int(cd.variableValue || 0, '变量值要是整数');
    out.selfSwitchValid = b(cd.selfSwitchValid); out.selfSwitchCh = String(cd.selfSwitchCh || 'A');
    out.itemValid = b(cd.itemValid); out.itemId = int(cd.itemId || 1);
    out.actorValid = b(cd.actorValid); out.actorId = int(cd.actorId || 1);
    if (out.switch1Valid) need(project.has('switch', out.switch1Id), '开关 ' + out.switch1Id + ' 超出范围');
    if (out.switch2Valid) need(project.has('switch', out.switch2Id), '开关 ' + out.switch2Id + ' 超出范围');
    if (out.variableValid) need(project.has('var', out.variableId), '变量 ' + out.variableId + ' 超出范围');
    need(['A', 'B', 'C', 'D'].includes(out.selfSwitchCh), '独立开关只能是 A/B/C/D');
    if (out.itemValid) need(project.has('item', out.itemId), '物品 ' + out.itemId + ' 不存在');
    if (out.actorValid) need(project.has('actor', out.actorId), '角色 ' + out.actorId + ' 不存在');
    return out;
  }

  // ---------- 人物 / 小人 ----------
  // 事件页图像：行走图（名字 + 第几个 + 朝向 + 姿势）或者没有图像
  function checkImage(im, old) {
    const out = { tileId: 0, characterName: '', characterIndex: 0, direction: 2, pattern: 1, ...(old || {}) };
    const name = String(im.characterName || '');
    if (name) need(project.findImage('characters', name), '行走图「' + name + '」不存在');
    out.characterName = name;
    out.tileId = 0;
    out.characterIndex = name && !/^[!]*\$/.test(name) ? int(im.characterIndex || 0, '第几个不对') : 0;
    need(out.characterIndex >= 0 && out.characterIndex <= 7, '一张图最多 8 个人（0~7）');
    out.direction = int(im.direction || 2);
    need([2, 4, 6, 8].includes(out.direction), '朝向只能是 下 / 左 / 右 / 上');
    out.pattern = int(im.pattern == null ? 1 : im.pattern);
    need(out.pattern >= 0 && out.pattern <= 2, '姿势只能是 0~2');
    return out;
  }
  // 剧情进度：每页在哪几段出现（「第 3~5 天 · 夜晚」）；跟进度没关系的事件是 null
  function stagesOf(T, mapId, evId) {
    try { return T.progress.eventStages(mapId, evId); } catch (e) { console.error('[studio] progress: ' + e.message); return null; }
  }
  function peopleInEvent(T, mapId, evId) {
    try {
      return T.people.inEvent(mapId, evId).slice(0, 4).map(p => {
        const r = T.people.related(p.key, 8);
        return { ...p, vars: r.vars, switches: r.switches };
      });
    } catch (e) { console.error('[studio] people: ' + e.message); return []; }
  }
  // 怎么动：不动 / 随便走 / 跟着主角；速度 1~6、频率 1~5；走路 / 原地踏步、朝向固定、穿透
  function applyMove(pg, b) {
    if (b.moveType != null) { const t = int(b.moveType); need([0, 1, 2].includes(t), '移动方式只能是 不动 / 随机 / 靠近'); pg.moveType = t; }
    if (b.moveSpeed != null) { const v = int(b.moveSpeed); need(v >= 1 && v <= 6, '移动速度是 1~6'); pg.moveSpeed = v; }
    if (b.moveFrequency != null) { const v = int(b.moveFrequency); need(v >= 1 && v <= 5, '移动频率是 1~5'); pg.moveFrequency = v; }
    for (const k of ['walkAnime', 'stepAnime', 'directionFix', 'through']) if (b[k] != null) pg[k] = !!b[k];
  }
  Object.assign(V, { pageView, eventView, ceView, checkImage, checkConditions, applyMove });
  return {
    get: {
      event: (T, q) => eventView(T, int(q('map')), int(q('ev'))),
      ces: T => ({ ces: ceList(T) }),
      ce: (T, q) => ceView(T, int(q('id'))),
    },
    post: {
      text: (T, b) => ({ ok: true, ...saveText(T, b) }),
      // 不保存，只看合并结果（给「保存前看看会改什么」用）
      preview(T, b) {
        const at = target(b);
        const docs = { [fileOf(at)]: project.readFresh(fileOf(at)) };
        const { holder } = locate(docs, at);
        const list = holder.list || [END()];
        let merged;
        try { merged = T.merger.mergeList(list, String(b.text || ''), { baseIndent: 0 }); }
        catch (e) { throw new UserError(e.message); }
        const v = T.validator.newProblems(list, merged.list);
        return { ok: true, unchanged: merged.unchanged, outline: T.describer.outline(merged.list), problems: v.fresh, warnings: v.warnings.map(w => w.msg) };
      },
    'event/create'(T, b) {
      const mapId = int(b.map, '地图编号不对');
      const x = int(b.x, '坐标不对'), y = int(b.y, '坐标不对');
      const r = T.store.edit([project.mapFile(mapId)], docs => {
        const m = docs[project.mapFile(mapId)];
        need(m, '地图 ' + mapId + ' 不存在');
        need(x >= 0 && y >= 0 && x < m.width && y < m.height, `坐标 (${x}, ${y}) 在地图外面（地图 ${m.width}×${m.height}）`);
        need(!(m.events || []).some(e => e && e.x === x && e.y === y), `(${x}, ${y}) 已经有事件了`);
        let id = m.events.findIndex((e, i) => i > 0 && !e);
        if (id < 0) id = Math.max(1, m.events.length);
        const name = String(b.name || '').trim().slice(0, 40) || 'EV' + String(id).padStart(3, '0');
        m.events[id] = { id, name, note: '', pages: [blankPage()], x, y };
        return id;
      });
      return { id: r.result, view: eventView(tools(), mapId, r.result) };
    },
    'event/update'(T, b) {
      const mapId = int(b.map), evId = int(b.ev);
      T.store.edit([project.mapFile(mapId)], docs => {
        const m = docs[project.mapFile(mapId)];
        const e = m && m.events[evId];
        need(e, '事件不存在');
        if (b.name != null) { const n = String(b.name).trim().slice(0, 40); need(n, '名字不能为空'); e.name = n; }
        if (b.note != null) e.note = String(b.note).slice(0, 2000);
        if (b.x != null || b.y != null) {
          const x = int(b.x != null ? b.x : e.x), y = int(b.y != null ? b.y : e.y);
          need(x >= 0 && y >= 0 && x < m.width && y < m.height, '坐标在地图外面');
          need(!m.events.some(o => o && o !== e && o.x === x && o.y === y), `(${x}, ${y}) 已经有事件了`);
          e.x = x; e.y = y;
        }
      });
      return { view: eventView(tools(), mapId, evId) };
    },
    'event/delete'(T, b) {
      const mapId = int(b.map), evId = int(b.ev);
      T.store.edit([project.mapFile(mapId)], docs => {
        const m = docs[project.mapFile(mapId)];
        need(m && m.events[evId], '事件不存在');
        m.events[evId] = null;
      });
      return {};
    },
    'page/add'(T, b) {
      const mapId = int(b.map), evId = int(b.ev);
      let index = 0;
      T.store.edit([project.mapFile(mapId)], docs => {
        const e = (docs[project.mapFile(mapId)] || {}).events[evId];
        need(e, '事件不存在');
        need(e.pages.length < 20, '一个事件最多 20 页');
        let pg = blankPage();
        if (b.copyFrom != null) { const src = e.pages[int(b.copyFrom)]; need(src, '要复制的页不存在'); pg = clone(src); }
        else if (e.pages.length) pg.image = clone(e.pages[e.pages.length - 1].image);
        e.pages.push(pg);
        index = e.pages.length - 1;
      });
      return { page: index, view: eventView(tools(), mapId, evId) };
    },
    'page/delete'(T, b) {
      const mapId = int(b.map), evId = int(b.ev), page = int(b.page);
      T.store.edit([project.mapFile(mapId)], docs => {
        const e = (docs[project.mapFile(mapId)] || {}).events[evId];
        need(e && e.pages[page], '这一页不存在');
        need(e.pages.length > 1, '至少要留一页（想去掉整个事件就删除事件）');
        e.pages.splice(page, 1);
      });
      return { view: eventView(tools(), mapId, evId) };
    },
    'page/move'(T, b) {
      const mapId = int(b.map), evId = int(b.ev), page = int(b.page), to = int(b.to);
      T.store.edit([project.mapFile(mapId)], docs => {
        const e = (docs[project.mapFile(mapId)] || {}).events[evId];
        need(e && e.pages[page] && to >= 0 && to < e.pages.length, '页码不对');
        const [pg] = e.pages.splice(page, 1);
        e.pages.splice(to, 0, pg);
      });
      return { view: eventView(tools(), mapId, evId) };
    },
    'page/settings'(T, b) {
      const mapId = int(b.map), evId = int(b.ev), page = int(b.page);
      T.store.edit([project.mapFile(mapId)], docs => {
        const e = (docs[project.mapFile(mapId)] || {}).events[evId];
        need(e && e.pages[page], '这一页不存在');
        const pg = e.pages[page];
        if (b.conditions) pg.conditions = checkConditions(b.conditions);
        if (b.trigger != null) { const t = int(b.trigger); need(t >= 0 && t <= 4, '触发方式不对'); pg.trigger = t; }
        if (b.priorityType != null) { const t = int(b.priorityType); need(t >= 0 && t <= 2, '优先级不对'); pg.priorityType = t; }
        if (b.image) pg.image = checkImage(b.image, pg.image);
        applyMove(pg, b);
      });
      return { view: eventView(tools(), mapId, evId) };
    },
    'ce/create'(T, b) {
      let id = 0;
      T.store.edit(['CommonEvents.json'], docs => {
        const arr = docs['CommonEvents.json'];
        const name = String(b.name || '').trim().slice(0, 40);
        need(name, '给公共事件起个名字');
        id = arr.findIndex((c, i) => i > 0 && c && !String(c.name || '').trim() && (c.list || []).length <= 1 && !c.trigger);
        if (id < 0) { id = arr.length; arr.push(null); }
        arr[id] = { id, list: [END()], name, switchId: 1, trigger: 0 };
      });
      return { id, view: ceView(tools(), id) };
    },
    'ce/update'(T, b) {
      const id = int(b.id);
      T.store.edit(['CommonEvents.json'], docs => {
        const c = docs['CommonEvents.json'][id];
        need(c, '公共事件不存在');
        if (b.name != null) { const n = String(b.name).trim().slice(0, 40); need(n, '名字不能为空'); c.name = n; }
        if (b.trigger != null) { const t = int(b.trigger); need(t >= 0 && t <= 2, '触发方式不对'); c.trigger = t; }
        if (b.switchId != null) { const s = int(b.switchId); need(project.has('switch', s), '开关 ' + s + ' 超出范围'); c.switchId = s; }
      });
      return { view: ceView(tools(), id) };
    },
    },
  };
};
