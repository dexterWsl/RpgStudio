'use strict';
// 场景库：新建场景、放到地图上的某一天、关联到选项、加进 / 移出场景库、删除
//   GET  scenes                      场景列表（每个场景被哪里用到：哪天哪张图、哪个选项）
//   POST scene/create  { name, text, place? }        新建（text 是编辑框写法：名字：台词、#图 …）；带 place 就顺便放到地图
//   POST scene/place   { id, map, x, y, seg, slot, trigger, once, exact, image }   在空格子上新建事件播这个场景
//   POST scene/link    { at, line, id }    在「选了 xxx」（at 里第 line 条是 402）下面插一条调用
//   POST scene/unlink  { at, line, id }    拿掉那个选项下面对这个场景的调用
//   POST scene/mark    { id, on }          把已有的公共事件加进 / 移出场景库
//   POST scene/delete  { id }              没人用的场景才能删（清空那个公共事件槽）
//   GET  play?map=&ev=&page= / play?ce=    预览播放：这一页（这个公共事件）翻成能播的步骤
//   POST play { text, at? }                还没保存的台词（新建场景时边写边看；at = 正在改的那一页）
const { need, int, clone, END, UserError } = require('../lib/util.js');
const { MARK_CMD, isMarked } = require('../core/scenes.js');

module.exports = function (ctx) {
  const { project, tools } = ctx;
  const V = ctx.views;
  const listOut = T => ({ scenes: T.scenes.list(), axis: progressAxis(T) });
  function progressAxis(T) {
    const m = T.progress.config().main;
    if (m.type === 'map') return null;
    return { type: m.type, segs: m.type === 'switches' ? ['开始', ...m.chain.map(c => c.label)] : m.segs.map(s => s.label), slots: (m.slots || []).map(s => s.label) };
  }
  const fileOf = at => (at.type === 'map' ? project.mapFile(at.map) : 'CommonEvents.json');
  const target = at => {
    at = at || {};
    if (at.type === 'map') return { type: 'map', map: int(at.map, '地图编号不对'), ev: int(at.ev, '事件编号不对'), page: int(at.page || 0, '页码不对') };
    if (at.type === 'ce') return { type: 'ce', ce: int(at.ce, '公共事件编号不对') };
    throw new UserError('缺少位置');
  };
  function holderOf(docs, at) {
    if (at.type === 'map') {
      const e = ((docs[project.mapFile(at.map)] || {}).events || [])[at.ev];
      need(e && e.pages[at.page], '这一页不存在');
      return e.pages[at.page];
    }
    const c = (docs['CommonEvents.json'] || [])[at.ce];
    need(c, '公共事件 ' + at.ce + ' 不存在');
    return c;
  }
  const sceneOf = (docs, id) => {
    const c = (docs['CommonEvents.json'] || [])[id];
    need(c && isMarked(c.list), '场景 ' + id + ' 不存在');
    return c;
  };
  // 选项分支的范围：402 那一行之后、同缩进的下一个 402 / 403 / 404 之前
  function branchRange(list, line) {
    const head = list[line];
    need(head && head.code === 402, '第 ' + (line + 1) + ' 条不是「选了 …」');
    const ind = head.indent || 0;
    let end = line + 1;
    while (end < list.length && !(list[end] && (list[end].indent || 0) === ind && [402, 403, 404].includes(list[end].code))) end++;
    return { ind, start: line + 1, end };
  }

  function place(T, b, id) {
    const mapId = int(b.map, '地图编号不对'), x = int(b.x, '坐标不对'), y = int(b.y, '坐标不对');
    const trigger = int(b.trigger == null ? 0 : b.trigger);
    need([0, 1, 2, 3].includes(trigger), '触发方式不对');
    const once = trigger === 3 ? true : b.once !== false;          // 自动执行不关掉自己会一直重复播，强制只播一次
    let image = null;
    if (b.image && b.image.characterName) image = V.checkImage({ ...b.image, tileId: 0 }, null);
    const seg = b.seg == null || b.seg === '' ? null : int(b.seg), slot = b.slot == null || b.slot === '' ? -1 : int(b.slot);
    const advanceTo = b.advanceTo == null || b.advanceTo === '' ? null : int(b.advanceTo, '推进到哪一段不对');
    if (advanceTo != null) need(seg == null || advanceTo > seg, '只能往后推进');
    const { pages, until, advance } = T.scenes.placementPages({ scene: id, seg, slot, trigger, once, exact: b.exact !== false, image, advanceTo });
    if (advanceTo != null) need(advance, '推进到哪一段不对');
    let evId = 0;
    T.store.edit([project.mapFile(mapId), 'CommonEvents.json'], docs => {
      const sc = sceneOf(docs, id);
      const m = docs[project.mapFile(mapId)];
      need(m, '地图 ' + mapId + ' 不存在');
      need(x >= 0 && y >= 0 && x < m.width && y < m.height, `坐标 (${x}, ${y}) 在地图外面（地图 ${m.width}×${m.height}）`);
      need(!(m.events || []).some(e => e && e.x === x && e.y === y), `(${x}, ${y}) 已经有事件了：换一个空格子，或者在那个事件的选项里关联这个场景`);
      evId = m.events.findIndex((e, i) => i > 0 && !e);
      if (evId < 0) evId = Math.max(1, m.events.length);
      const name = String(b.name || sc.name || '场景').trim().slice(0, 40);
      m.events[evId] = { id: evId, name, note: '', pages: clone(pages), x, y };
    });
    return { map: mapId, ev: evId, until, once, advance };
  }

  // 编辑框里的字先合并成指令（不写盘），再翻成步骤
  function playText(T, b) {
    let base = [MARK_CMD(), END()];
    if (b.at) {
      const at = target(b.at);
      const docs = { [fileOf(at)]: project.readFresh(fileOf(at)) };
      base = clone(holderOf(docs, at).list || [END()]);
    }
    const al = T.merger.analyzeList(base, { baseIndent: 0 });
    const text = b.at ? String(b.text || '') : al.text + '\n' + String(b.text || '');
    let merged;
    try { merged = T.merger.mergeList(base, text, { analysis: al }); }
    catch (e) { throw new UserError(e.message); }
    return T.player.timeline(merged.list);
  }
  return {
    get: {
      scenes: T => listOut(T),
      play(T, q) {
        if (q('ce') != null) {
          const id = int(q('ce'), '公共事件编号不对');
          const c = (project.read('CommonEvents.json') || [])[id];
          need(c, '公共事件 ' + id + ' 不存在');
          return { title: c.name || '公共事件 ' + id, ...T.player.timeline(c.list, { self: id }) };
        }
        const mapId = int(q('map'), '地图编号不对'), evId = int(q('ev'), '事件编号不对'), page = int(q('page') || 0, '页码不对');
        const e = ((project.map(mapId) || {}).events || [])[evId];
        need(e && e.pages[page], '这一页不存在');
        return { title: `${e.name} · 第 ${page + 1} 页`, ...T.player.timeline(e.pages[page].list) };
      },
    },
    post: {
      play: (T, b) => playText(T, b),
      'scene/create'(T, b) {
        const name = String(b.name || '').trim().slice(0, 40);
        need(name, '给场景起个名字');
        const text = String(b.text || '').replace(/\r/g, '');
        need(text.trim(), '写几句台词（一行一句：名字：台词）');
        // 先在内存里合并好，出错就不写盘
        const base = [MARK_CMD(), END()];
        const al = T.merger.analyzeList(base, { baseIndent: 0 });
        let merged;
        try { merged = T.merger.mergeList(base, al.text + '\n' + text, { analysis: al }); }
        catch (e) { throw new UserError(e.message); }
        const v = T.validator.newProblems(base, merged.list);
        if (v.fresh.length) throw new UserError('台词里有写法问题：' + v.fresh.slice(0, 4).map(e => e.msg).join('；'), { problems: v.fresh });
        let id = 0;
        T.store.edit(['CommonEvents.json'], docs => {
          const arr = docs['CommonEvents.json'];
          id = arr.findIndex((c, i) => i > 0 && c && !String(c.name || '').trim() && (c.list || []).length <= 1 && !c.trigger);
          if (id < 0) { id = arr.length; arr.push(null); }
          arr[id] = { id, list: merged.list, name, switchId: 1, trigger: 0 };
        });
        let placed = null;
        if (b.place) placed = place(tools(), b.place, id);
        return { id, placed, ...listOut(tools()) };
      },
      'scene/place'(T, b) {
        const id = int(b.id, '场景编号不对');
        const placed = place(T, b, id);
        return { placed, ...listOut(tools()) };
      },
      'scene/link'(T, b) {
        const id = int(b.id, '场景编号不对'), at = target(b.at), line = int(b.line, '行号不对');
        T.store.edit([...new Set([fileOf(at), 'CommonEvents.json'])], docs => {
          sceneOf(docs, id);
          need(!(at.type === 'ce' && at.ce === id), '场景不能调用它自己');
          const h = holderOf(docs, at);
          const list = h.list || [END()];
          const r = branchRange(list, line);
          need(!list.slice(r.start, r.end).some(c => c && c.code === 117 && c.parameters[0] === id && (c.indent || 0) === r.ind + 1), '这个选项已经关联了这个场景');
          // 插在分支最后（分支的结束标记前），选项原来的台词照常先播
          const endMark = list[r.end - 1] && list[r.end - 1].code === 0 && (list[r.end - 1].indent || 0) === r.ind + 1;
          list.splice(endMark ? r.end - 1 : r.end, 0, { code: 117, indent: r.ind + 1, parameters: [id] });
          if (!endMark) list.splice(r.end + 1, 0, { code: 0, indent: r.ind + 1, parameters: [] });
          h.list = list;
        });
        return { ok: true, view: at.type === 'map' ? V.eventView(tools(), at.map, at.ev) : V.ceView(tools(), at.ce) };
      },
      'scene/unlink'(T, b) {
        const id = int(b.id, '场景编号不对'), at = target(b.at), line = int(b.line, '行号不对');
        T.store.edit([fileOf(at)], docs => {
          const h = holderOf(docs, at);
          const list = h.list || [END()];
          const r = branchRange(list, line);
          const k = list.findIndex((c, i) => i >= r.start && i < r.end && c && c.code === 117 && c.parameters[0] === id && (c.indent || 0) === r.ind + 1);
          need(k >= 0, '这个选项下面没有关联这个场景');
          list.splice(k, 1);
          h.list = list;
        });
        return { ok: true, view: at.type === 'map' ? V.eventView(tools(), at.map, at.ev) : V.ceView(tools(), at.ce) };
      },
      'scene/mark'(T, b) {
        const id = int(b.id, '公共事件编号不对');
        T.store.edit(['CommonEvents.json'], docs => {
          const c = docs['CommonEvents.json'][id];
          need(c, '公共事件 ' + id + ' 不存在');
          const list = c.list || [END()];
          if (b.on === false) c.list = list.filter((x, i) => !(i < 3 && x && x.code === 108 && isMarked([x])));
          else {
            need(String(c.name || '').trim(), '先给这个公共事件起个名字');
            if (!isMarked(list)) c.list = [MARK_CMD(), ...list];
          }
        });
        return { ...listOut(tools()) };
      },
      'scene/delete'(T, b) {
        const id = int(b.id, '场景编号不对');
        const uses = T.scenes.usesOf(id);
        need(!uses.length, `还有 ${uses.length} 个地方在用这个场景（${uses.slice(0, 3).map(u => u.where).join('、')}），先把它们去掉`);
        T.store.edit(['CommonEvents.json'], docs => {
          sceneOf(docs, id);
          docs['CommonEvents.json'][id] = { id, list: [END()], name: '', switchId: 1, trigger: 0 };
        });
        return { ...listOut(tools()) };
      },
    },
  };
};
