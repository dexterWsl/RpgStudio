'use strict';
// 场景库：一个场景 = 一个公共事件（第一条是注释 <RpgStudioScene>），地图上的事件、选项、回想房都去调用它，改一处各处一起变
//   放到地图：在空格子上新建一个事件，按剧情进度配好出现条件（只在那一天 / 那一段、那个时段，可选只播一次）
//   关联到选项：在「选了 xxx」下面插一条「调用公共事件」
// 这里只算（列表、谁在用、新事件的页长什么样）；写盘在 routes/scenes.js
const { END, blankPage, clone } = require('../lib/util.js');
const MARK = '<RpgStudioScene>';
const MARK_CMD = () => ({ code: 108, indent: 0, parameters: [MARK + ' 场景库：删掉这一行它就不算场景了'] });
const isMarked = list => (list || []).slice(0, 3).some(c => c && c.code === 108 && String(c.parameters[0] || '').startsWith(MARK));

function createScenes(project, xref, opts = {}) {
  const P = project;
  const where = opts.where || (() => '');
  const progress = opts.progress;

  // 场景的内容摘要：几句台词、用到哪些图、第一句
  function summary(list) {
    let lines = 0, first = '', speaker = '';
    const pics = [];
    for (let i = 0; i < (list || []).length; i++) {
      const c = list[i];
      if (!c) continue;
      if (c.code === 101) { lines++; if (!first) speaker = P.expandN(c.parameters[4] || ''); }
      else if (c.code === 401 && !first && String(c.parameters[0] || '').trim()) first = P.expandN(c.parameters[0]).slice(0, 60);
      else if (c.code === 231 && c.parameters[1] && !pics.includes(c.parameters[1])) pics.push(c.parameters[1]);
    }
    return { lines, first, speaker, pics };
  }

  // 一处调用是在哪种地方：选项下面（选了 xxx）/ 条件分支里 / 一整页就是播这个场景（放到地图上的）/ 别的
  function contextOf(list, line) {
    const call = list[line];
    if (!call) return { kind: 'other' };
    const ind = call.indent || 0;
    for (let j = line - 1; j >= 0; j--) {
      const c = list[j];
      if (!c || (c.indent || 0) >= ind) continue;
      if (c.code === 402) {
        let k = j - 1;
        while (k >= 0 && !(list[k] && list[k].code === 102 && (list[k].indent || 0) === (c.indent || 0))) k--;
        return { kind: 'choice', label: String(c.parameters[1] || ''), choiceLine: j, options: k >= 0 ? (list[k].parameters[0] || []).map(String) : [] };
      }
      if (c.code === 403) return { kind: 'choice', label: '按取消时', choiceLine: j };
      if (c.code === 111 || c.code === 411) return { kind: 'branch', branchLine: j };
      break;
    }
    const real = list.filter(c => c && c.code !== 0 && c.code !== 123 && c.code !== 108);
    return real.length === 1 && real[0] === call ? { kind: 'page' } : { kind: 'inline' };
  }

  function usesOf(id) {
    return xref.of('ce', id).filter(r => r.at.type !== 'troop').map(r => {
      let list = [], e = null;
      if (r.at.type === 'map') { const m = P.map(r.at.map) || {}; e = (m.events || [])[r.at.ev]; list = e && e.pages[r.at.page] ? e.pages[r.at.page].list : []; }
      else if (r.at.type === 'ce') list = ((P.read('CommonEvents.json') || [])[r.at.ce] || {}).list || [];
      const cx = contextOf(list || [], r.line);
      let stage = '';
      if (r.at.type === 'map' && progress) { try { const st = progress.eventStages(r.at.map, r.at.ev); if (st && st[r.at.page]) stage = st[r.at.page].text; } catch { } }
      return { at: r.at, line: r.line, where: where(r.at), ...cx, stage, pos: e ? { x: e.x, y: e.y } : null };
    });
  }

  function listNow() {
    const out = [];
    for (const c of P.read('CommonEvents.json') || []) {
      if (!c || !isMarked(c.list)) continue;
      const uses = usesOf(c.id);
      out.push({ id: c.id, name: String(c.name || ''), ...summary(c.list), uses });
    }
    return out;
  }
  const list = () => P.memoize('scenes', listNow);

  // ---------- 放到地图：新事件的几页 ----------
  // 第 1 页：在这一段（和时段）出现，播场景（只播一次就顺手打开独立开关 A）
  // 第 2 页：只在这一段的话，下一段起换成空白页（看不见、碰不到）
  // 第 3 页：只播一次 → 独立开关 A 开了以后是空白页
  function placementPages(o) {
    const cfg = progress ? progress.config() : { main: { type: 'map' } };
    const m = cfg.main;
    const cond = blankPage().conditions;
    const a = blankPage(), pages = [a];
    a.conditions = clone(cond);
    a.trigger = o.trigger;
    a.priorityType = o.image && o.image.characterName ? 1 : 0;
    if (o.image && o.image.characterName) a.image = { tileId: 0, characterName: o.image.characterName, characterIndex: o.image.characterIndex || 0, direction: o.image.direction || 2, pattern: o.image.pattern == null ? 1 : o.image.pattern };
    a.list = [{ code: 117, indent: 0, parameters: [o.scene] }];
    // 播完推进到第 to 段：改进度变量 / 打开链上的开关（玩家这样才进得了下一天 / 下一章）
    let advance = '';
    if (o.advanceTo != null && o.advanceTo >= 0) {
      if ((m.type === 'day' || m.type === 'chapter') && m.segs[o.advanceTo]) { a.list.push({ code: 122, indent: 0, parameters: [m.var, m.var, 0, 0, m.segs[o.advanceTo].from] }); advance = m.segs[o.advanceTo].label; }
      else if (m.type === 'switches' && o.advanceTo > 0 && m.chain[o.advanceTo - 1]) { const sw = m.chain[o.advanceTo - 1].switch; a.list.push({ code: 121, indent: 0, parameters: [sw, sw, 0] }); advance = m.chain[o.advanceTo - 1].label; }
    }
    if (o.once) a.list.push({ code: 123, indent: 0, parameters: ['A', 0] });
    a.list.push(END());
    let until = '';
    const seg = o.seg;
    if (m.type === 'day' || m.type === 'chapter') {
      if (seg != null && seg >= 0 && seg < m.segs.length) {
        a.conditions.variableValid = true; a.conditions.variableId = m.var; a.conditions.variableValue = m.segs[seg].from;
        const next = m.segs[seg + 1];
        if (o.exact && next) {
          const b = blankPage(); b.priorityType = 0;
          b.conditions.variableValid = true; b.conditions.variableId = m.var; b.conditions.variableValue = next.from;
          pages.push(b); until = next.label;
        }
      }
      if (m.type === 'day' && o.slot != null && o.slot >= 0 && m.slots[o.slot]) { a.conditions.switch1Valid = true; a.conditions.switch1Id = m.slots[o.slot].switch; }
    } else if (m.type === 'switches' && seg != null && seg >= 0) {
      if (seg > 0 && m.chain[seg - 1]) { a.conditions.switch1Valid = true; a.conditions.switch1Id = m.chain[seg - 1].switch; }
      const next = m.chain[seg];
      if (o.exact && next) {
        const b = blankPage(); b.priorityType = 0;
        b.conditions.switch1Valid = true; b.conditions.switch1Id = next.switch;
        pages.push(b); until = next.label;
      }
    }
    if (o.once) { const c = blankPage(); c.priorityType = 0; c.conditions.selfSwitchValid = true; c.conditions.selfSwitchCh = 'A'; pages.push(c); }
    return { pages, until, advance };
  }

  return { list, usesOf, summary, contextOf, placementPages, isMarked };
}

module.exports = { createScenes, isMarked, MARK, MARK_CMD };
