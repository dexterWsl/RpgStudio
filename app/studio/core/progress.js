'use strict';
// 剧情进度：这个游戏靠什么推进剧情。只是「怎么看」，不改游戏数据
//   主线（一次一种）：day 按天（一个天数变量 + 可选的时段开关）· chapter 按章节（一个进度变量切成几段）
//                     · switches 按开关链（第一章完成、第二章完成……）· map 按地图（不按进度看）
//   支线（几条都行）：每条一个进度变量，按值分步
// 配置：{ main: { type, var, segs: [{ from, label }], slots: [{ switch, label }], chain: [{ switch, label }] },
//         tracks: [{ var, label, steps: [{ value, label }] }] }
//   segs 是从小到大的切点：from = 3 表示「变量 ≥ 3 起是这一段」，到下一段的 from 为止。按天就是每天一段
// 算法：每个事件按页的出现条件，算出每一段（× 每个时段）会显示哪一页——从最后一页往前找，
//   条件全在进度轴上而且满足 = 一定显示；有轴以外的条件（别的开关、独立开关……）= 可能显示，接着往前找
//   页里的「如果 变量 = N」分支也算进对应的段（按天派发的公共事件就是这样）
const CMP = ['=', '≥', '≤', '>', '<', '≠'];
const NAME_DAY = /day|天|日(?!志)/i;
const NAME_PROGRESS = /chapter|章|progress|进度|stage|story|主线|scenario|plot|route|quest|任务/i;
const NAME_SKIP = /^(player|cursor|rng|random|temp|tmp|mouse|map ?id|region|item ?id|x|y)\b|坐标|临时|随机|弹窗|计时|距离|region/i;
const NAME_SLOT = /早上|早晨|上午|中午|下午|傍晚|晚上|夜晚|夜间|深夜|白天|白日|自由时|工作时|放学|morning|noon|afternoon|evening|night|daytime|freetime|work ?time/i;
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const chapterNo = s => {
  const m = /第\s*([一二三四五六七八九十\d]+)\s*章|chapter\s*(\d+)|\bch\.?\s*(\d+)/i.exec(s || '');
  if (!m) return 0;
  if (m[1]) return /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].split('').reduce((n, c) => (c === '十' ? (n || 1) * 10 : n + (CN_NUM[c] || 0)), 0);
  return Number(m[2] || m[3]) || 0;
};

function createProgress(project, xref, opts = {}) {
  const P = project;
  const where = opts.where || (() => '');

  // ---------- 统计：每个变量被比较过哪些值、怎么被改 ----------
  function statsNow() {
    const vars = new Map(), sws = new Map();
    const V = id => { if (!vars.has(id)) vars.set(id, { id, cmp: new Map(), pageGe: new Map(), set: new Set(), add: 0, pages: 0 }); return vars.get(id); };
    const W = id => { if (!sws.has(id)) sws.set(id, { id, pages: 0, branches: 0, on: 0 }); return sws.get(id); };
    xref.each((at, list, cond) => {
      if (at.type === 'troop') return;
      if (cond) {
        if (cond.variableValid) { const v = V(cond.variableId); v.pageGe.set(cond.variableValue, (v.pageGe.get(cond.variableValue) || 0) + 1); v.pages++; }
        for (const k of ['switch1', 'switch2']) if (cond[k + 'Valid']) W(cond[k + 'Id']).pages++;
      }
      for (const c of list || []) {
        if (!c) continue;
        const p = c.parameters || [];
        if (c.code === 111 && p[0] === 1 && p[2] === 0) { const v = V(p[1]); v.cmp.set(p[3], (v.cmp.get(p[3]) || 0) + 1); }
        else if (c.code === 111 && p[0] === 0) W(p[1]).branches++;
        else if (c.code === 122 && p[3] === 0) {
          for (let id = p[0]; id <= p[1] && id - p[0] < 50; id++) { const v = V(id); if (p[2] === 0) v.set.add(p[4]); else if (p[2] === 1 && p[4] > 0) v.add++; }
        } else if (c.code === 121 && p[2] === 0) for (let id = p[0]; id <= p[1] && id - p[0] < 50; id++) W(id).on++;
      }
    });
    return { vars, sws };
  }
  const stats = () => P.memoize('progress-stats', statsNow);

  const valuesOf = v => [...new Set([...v.cmp.keys(), ...v.pageGe.keys(), ...v.set])].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  function scoreVar(v) {
    const name = P.name('var', v.id);
    if (NAME_SKIP.test(name)) return 0;
    const vals = valuesOf(v);
    if (vals.length < 3 || vals[vals.length - 1] > 1000) return 0;
    let s = vals.length * 2 + v.pageGe.size * 3 + Math.min(v.add, 10) + Math.min(v.pages, 20) * 0.5;
    if (NAME_DAY.test(name)) s += 15;
    if (NAME_PROGRESS.test(name)) s += 8;
    return s;
  }

  // ---------- 猜：主线用哪个变量 / 开关链，支线有哪些 ----------
  function detectNow() {
    const { vars, sws } = stats();
    const cands = [...vars.values()].map(v => ({ v, score: scoreVar(v) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const candidates = cands.slice(0, 30).map(({ v, score }) => {
      const vals = valuesOf(v);
      return { var: v.id, name: P.name('var', v.id), values: vals.length, min: vals[0], max: vals[vals.length - 1], pages: v.pages, add: v.add, score: Math.round(score) };
    });
    // 时段开关：名字像时段、又被拿来当出现条件的
    const slotCandidates = [...sws.values()].filter(w => NAME_SLOT.test(P.name('switch', w.id)) && w.pages + w.branches >= 2)
      .sort((a, b) => a.id - b.id).map(w => ({ switch: w.id, name: P.name('switch', w.id), pages: w.pages }));
    // 开关链：名字里有「第 N 章 / Chapter N」的
    const chain = [...sws.values()].map(w => ({ w, n: chapterNo(P.name('switch', w.id)) })).filter(x => x.n > 0).sort((a, b) => a.n - b.n);
    const chainCandidates = chain.map(x => ({ switch: x.w.id, name: P.name('switch', x.w.id), n: x.n }));
    let main;
    const top = cands[0];
    if (top) {
      const name = P.name('var', top.v.id);
      const vals = valuesOf(top.v);
      const day = NAME_DAY.test(name) || (top.v.add > 0 && vals[0] >= 0 && vals[vals.length - 1] <= 60 && !NAME_PROGRESS.test(name));
      main = day ? daySetup(top.v.id, slotCandidates.slice(0, 4).map(s => ({ switch: s.switch, label: s.name }))) : chapterSetup(top.v.id);
    } else if (chainCandidates.length >= 2) main = { type: 'switches', chain: chainCandidates.map(c => ({ switch: c.switch, label: c.name })) };
    else main = { type: 'map' };
    // 支线：被拿来分段（页条件 / 好几个「如果」）、又会被改的变量。光是「设成几就判断几」的（手上拿着什么、选了哪个）不算，
    //   除非它当过页条件、会一点点加上去、或者名字像进度
    const tracks = cands.filter(x => !main.var || x.v.id !== main.var).filter(x => (x.v.pageGe.size >= 2 || x.v.cmp.size >= 3) && (x.v.set.size || x.v.add))
      .filter(x => x.v.pages > 0 || x.v.add > 0 || NAME_PROGRESS.test(P.name('var', x.v.id)))
      .slice(0, 6).map(x => trackSetup(x.v.id));
    return { main, tracks, candidates, slotCandidates, chainCandidates };
  }
  const detect = () => P.memoize('progress-detect', detectNow);

  // ---------- 默认分段 ----------
  function daySetup(varId, slots) {
    const v = stats().vars.get(varId);
    const vals = v ? valuesOf(v) : [];
    const lo = Math.max(0, Math.min(1, vals[0] == null ? 1 : vals[0])), hi = Math.min(Math.max(lo, vals[vals.length - 1] || 1), lo + 99);
    const segs = [];
    for (let d = lo; d <= hi; d++) segs.push({ from: d, label: d <= 0 ? '开场' : `第 ${d} 天` });
    return { type: 'day', var: varId, segs, slots: slots || [] };
  }
  function chapterSetup(varId) {
    const v = stats().vars.get(varId);
    let vals = v ? valuesOf(v) : [];
    if (vals.length > 30) {   // 值太多：留被用得最多的 30 个切点
      const use = new Map(vals.map(x => [x, (v.pageGe.get(x) || 0) * 3 + (v.cmp.get(x) || 0) + (v.set.has(x) ? 1 : 0)]));
      vals = vals.sort((a, b) => use.get(b) - use.get(a)).slice(0, 30).sort((a, b) => a - b);
    }
    const segs = [];
    if (!vals.length || vals[0] > 0) segs.push({ from: Math.min(0, vals[0] || 0), label: '开始' });
    vals.forEach(x => segs.push({ from: x, label: `阶段 ${segs.length}` }));
    return { type: 'chapter', var: varId, segs };
  }
  function trackSetup(varId) {
    const v = stats().vars.get(varId);
    const vals = v ? valuesOf(v).slice(0, 40) : [];
    const steps = vals.map(x => ({ value: x, label: String(x) }));
    if (!vals.length || vals[0] > 0) steps.unshift({ value: Math.min(0, vals[0] || 0), label: '没开始' });   // 变量默认是 0
    return { var: varId, label: P.name('var', varId) || '变量 ' + varId, steps };
  }

  // ---------- 配置：存的 > 游戏配置（profile）给的 > 猜的 ----------
  function normalize(c) {
    const out = { main: { type: 'map' }, tracks: [] };
    const m = (c && c.main) || {};
    if ((m.type === 'day' || m.type === 'chapter') && P.has('var', m.var)) {
      const base = m.type === 'day' ? daySetup(m.var, m.slots) : chapterSetup(m.var);
      const segs = Array.isArray(m.segs) && m.segs.length ? m.segs.map(s => ({ from: Number(s.from) || 0, label: String(s.label || '') })).sort((a, b) => a.from - b.from) : base.segs;
      out.main = { type: m.type, var: Number(m.var), segs, slots: m.type === 'day' ? (m.slots || base.slots || []).filter(s => P.has('switch', s.switch)).map(s => ({ switch: Number(s.switch), label: String(s.label || P.name('switch', s.switch)) })) : [] };
    } else if (m.type === 'switches' && Array.isArray(m.chain) && m.chain.length) {
      out.main = { type: 'switches', chain: m.chain.filter(s => P.has('switch', s.switch)).map(s => ({ switch: Number(s.switch), label: String(s.label || P.name('switch', s.switch)) })) };
    }
    for (const t of (c && c.tracks) || []) {
      if (!P.has('var', t.var) || (out.main.var && Number(t.var) === out.main.var)) continue;
      const base = trackSetup(Number(t.var));
      out.tracks.push({ var: Number(t.var), label: String(t.label || base.label), steps: Array.isArray(t.steps) && t.steps.length ? t.steps.map(s => ({ value: Number(s.value) || 0, label: String(s.label || s.value) })).sort((a, b) => a.value - b.value) : base.steps });
    }
    return out;
  }
  function config() {
    const saved = opts.saved && opts.saved();
    if (saved) return { ...normalize(saved), source: 'saved' };
    const prof = opts.profile && opts.profile();
    if (prof && prof.progress) {
      const d = detect();
      return { ...normalize({ main: prof.progress.main, tracks: prof.progress.tracks || d.tracks }), source: 'profile' };
    }
    return { ...normalize(detect()), source: 'detected' };
  }

  // ---------- 轴：主线 / 某条支线 → 统一成「分段 + 时段 + 判断条件」 ----------
  function axisOf(cfg, key) {
    if (!key || key === 'main') {
      const m = cfg.main;
      if (m.type === 'day' || m.type === 'chapter') return { key: 'main', kind: 'var', type: m.type, var: m.var, segs: m.segs, slots: m.slots || [], label: m.type === 'day' ? '按天' : '按章节' };
      if (m.type === 'switches') return { key: 'main', kind: 'chain', type: 'switches', chain: m.chain, segs: [{ label: '开始' }, ...m.chain.map(c => ({ label: c.label }))], slots: [], label: '按开关链' };
      return null;
    }
    const t = cfg.tracks.find(x => 't' + x.var === key);
    return t ? { key, kind: 'var', type: 'track', var: t.var, segs: t.steps.map(s => ({ from: s.value, label: s.label })), slots: [], label: t.label } : null;
  }
  // 一段的取值范围 [lo, hi]
  const range = (ax, i) => [ax.segs[i].from, i + 1 < ax.segs.length ? ax.segs[i + 1].from - 1 : Infinity];
  const segOfValue = (ax, v) => { let k = -1; ax.segs.forEach((s, i) => { if (s.from <= v) k = i; }); return k; };
  // 变量比较在这一段是否成立：'yes' 整段都成立 / 'maybe' 段里有的值成立 / 'no'
  function cmpIn(ax, i, op, c) {
    const [lo, hi] = range(ax, i);
    const test = x => [x === c, x >= c, x <= c, x > c, x < c, x !== c][op];
    if (op === 5) return lo === hi ? (lo !== c ? 'yes' : 'no') : (lo <= c && c <= hi ? 'maybe' : 'yes');
    const a = test(lo), b = hi === Infinity ? [false, true, false, true, false][op] : test(hi);
    if (op === 0) return lo === c && hi === c ? 'yes' : lo <= c && c <= hi ? 'maybe' : 'no';
    return a && b ? 'yes' : a || b ? 'maybe' : 'no';
  }
  const slotIdx = (ax, sw) => ax.slots.findIndex(s => s.switch === sw);
  const chainIdx = (ax, sw) => ax.kind === 'chain' ? ax.chain.findIndex(s => s.switch === sw) : -1;
  // 一页的出现条件在 (段, 时段) 里：yes / maybe / no；另外返回这页跟轴有没有关系
  function pageIn(ax, cond, seg, slot) {
    let res = 'yes', related = false;
    const and = r => { if (r === 'no') res = 'no'; else if (r === 'maybe' && res === 'yes') res = 'maybe'; };
    if (!cond) return { res, related };
    for (const k of ['switch1', 'switch2']) if (cond[k + 'Valid']) {
      const sw = cond[k + 'Id'];
      const si = slotIdx(ax, sw), ci = chainIdx(ax, sw);
      if (si >= 0) { related = true; and(slot < 0 ? 'maybe' : si === slot ? 'yes' : 'no'); }
      else if (ci >= 0) { related = true; and(ci < seg ? 'yes' : 'no'); }
      else and('maybe');
    }
    if (cond.variableValid) {
      if (ax.kind === 'var' && cond.variableId === ax.var) { related = true; and(cmpIn(ax, seg, 1, cond.variableValue)); }
      else and('maybe');
    }
    if (cond.selfSwitchValid || cond.itemValid || cond.actorValid) and('maybe');
    return { res, related };
  }
  const nCells = ax => ax.segs.length * Math.max(1, ax.slots.length);
  const cellOf = (ax, k) => ({ seg: Math.floor(k / Math.max(1, ax.slots.length)), slot: ax.slots.length ? k % ax.slots.length : -1 });

  // 一个事件每个格子显示哪一页：[[{page, sure}], …]；跟轴没关系的事件返回 null
  function eventCells(ax, e) {
    const pages = e.pages || [];
    if (!pages.some(pg => pageIn(ax, pg.conditions, 0, 0).related)) return null;
    const out = [];
    for (let k = 0; k < nCells(ax); k++) {
      const { seg, slot } = cellOf(ax, k);
      const hits = [];
      for (let i = pages.length - 1; i >= 0; i--) {
        const r = pageIn(ax, pages[i].conditions, seg, slot).res;
        if (r === 'no') continue;
        hits.push({ page: i, sure: r === 'yes' });
        if (r === 'yes') break;
      }
      out.push(hits);
    }
    return out;
  }

  const content = list => {
    let lines = 0, pics = 0, calls = 0, first = '';
    for (const c of list || []) {
      if (!c) continue;
      if (c.code === 101) lines++;
      else if (c.code === 231) pics++;
      else if (c.code === 117) calls++;
      else if (c.code === 401 && !first && String(c.parameters[0] || '').trim()) first = P.expandN(c.parameters[0]).slice(0, 40);
    }
    return { lines, pics, calls, first };
  };
  // 分支「如果 …」在哪几段成立：只认轴上的变量 / 开关链 / 时段开关
  function branchCells(ax, p) {
    const cells = [];
    for (let k = 0; k < nCells(ax); k++) {
      const { seg, slot } = cellOf(ax, k);
      let r = 'no';
      if (p[0] === 1 && p[2] === 0 && ax.kind === 'var' && p[1] === ax.var) r = cmpIn(ax, seg, p[4], p[3]);
      else if (p[0] === 0) {
        const want = p[2] === 0;
        const si = slotIdx(ax, p[1]), ci = chainIdx(ax, p[1]);
        if (si >= 0) r = (si === slot) === want ? 'yes' : 'no';
        else if (ci >= 0) r = (ci < seg) === want ? 'yes' : 'no';
        else continue;
      } else continue;
      if (r !== 'no') cells.push({ k, sure: r === 'yes' });
    }
    return cells;
  }
  const branchText = (ax, p) => p[0] === 1 ? `${P.name('var', p[1]) || '变量 ' + p[1]} ${CMP[p[4]] || '?'} ${p[3]}` : `${P.name('switch', p[1]) || '开关 ' + p[1]} 为${p[2] === 0 ? '开' : '关'}`;
  // 分支体：从「如果」到同缩进的「否则 / 条件结束」
  function branchBody(list, i) {
    const ind = list[i].indent || 0;
    const body = [];
    for (let j = i + 1; j < list.length; j++) {
      const c = list[j];
      if (!c) continue;
      if ((c.indent || 0) === ind && (c.code === 411 || c.code === 412)) break;
      body.push(c);
    }
    return body;
  }

  // ---------- 时间线：每一段有哪些剧情、在哪里推进 ----------
  function timelineNow(key) {
    const cfg = config();
    const ax = axisOf(cfg, key);
    if (!ax) return { axis: null, config: cfg };
    const S = Math.max(1, ax.slots.length);
    const segs = ax.segs.map((s, i) => ({ i, label: s.label, from: s.from, entries: [], advances: [], lines: 0 }));
    const add = (k, entry) => { const { seg, slot } = cellOf(ax, k); return { seg, slot, entry }; };
    // 1. 事件页
    for (const m of P.mapList()) {
      let data = null;
      try { data = P.map(m.id); } catch { continue; }
      for (const e of (data && data.events) || []) {
        if (!e) continue;
        const cells = eventCells(ax, e);
        if (!cells) continue;
        // 每页 → 出现在哪些格子
        const byPage = new Map();
        cells.forEach((hits, k) => hits.forEach(h => { if (!byPage.has(h.page)) byPage.set(h.page, []); byPage.get(h.page).push({ k, sure: h.sure }); }));
        for (const [pi, ks] of byPage) {
          const pg = e.pages[pi];
          const c = content(pg.list);
          if (!c.lines && !c.pics && !c.calls && pg.trigger < 3) continue;
          const at = { type: 'map', map: m.id, ev: e.id, page: pi };
          const bySeg = new Map();
          for (const x of ks) { const { seg, slot } = cellOf(ax, x.k); if (!bySeg.has(seg)) bySeg.set(seg, { slots: new Set(), sure: true }); const b = bySeg.get(seg); if (slot >= 0) b.slots.add(slot); b.sure = b.sure && x.sure; }
          for (const [seg, b] of bySeg) segs[seg].entries.push({ kind: 'page', at, where: where(at), trigger: pg.trigger, sure: b.sure, slots: b.slots.size === S || !ax.slots.length ? null : [...b.slots].sort(), ...c, image: pg.image && pg.image.characterName ? { characterName: pg.image.characterName, characterIndex: pg.image.characterIndex || 0 } : null });
        }
      }
    }
    // 2. 分支 + 3. 推进点（所有事件页和公共事件）
    const globalAdv = [];
    xref.each((at, list, cond) => {
      if (at.type === 'troop') return;
      list = list || [];
      // 页本身的时段（页条件里的时段开关）
      let pageSlot = -1;
      if (cond) for (const k of ['switch1', 'switch2']) if (cond[k + 'Valid'] && slotIdx(ax, cond[k + 'Id']) >= 0) pageSlot = slotIdx(ax, cond[k + 'Id']);
      list.forEach((c, i) => {
        if (!c) return;
        const p = c.parameters || [];
        if (c.code === 111) {
          const cells = branchCells(ax, p);
          if (!cells.length || cells.length === nCells(ax)) return;
          const body = branchBody(list, i);
          const ct = content(body);
          if (!ct.lines && !ct.pics && !ct.calls) return;
          const bySeg = new Map();
          for (const x of cells) { const { seg, slot } = cellOf(ax, x.k); if (!bySeg.has(seg)) bySeg.set(seg, { slots: new Set(), sure: true }); const b = bySeg.get(seg); if (slot >= 0) b.slots.add(slot); b.sure = b.sure && x.sure; }
          for (const [seg, b] of bySeg) {
            let slots = b.slots.size === S || !ax.slots.length ? null : [...b.slots].sort();
            if (!slots && pageSlot >= 0) slots = [pageSlot];
            segs[seg].entries.push({ kind: 'branch', at, line: i, where: where(at), cond: branchText(ax, p), sure: b.sure, slots, ...ct });
          }
        } else if (c.code === 122 && ax.kind === 'var' && p[0] <= ax.var && ax.var <= p[1]) {
          const text = p[3] !== 0 ? '改成别的值（' + ['变量', '随机数', '游戏数据', '脚本'][p[3] - 1] + '）' : ['设成', '加', '减', '乘', '除以', '取余'][p[2]] + ' ' + p[4];
          const adv = { at, line: i, where: where(at), text };
          if (p[3] === 0 && p[2] === 0) { const s = segOfValue(ax, p[4]); if (s >= 0) segs[s].advances.push(adv); else globalAdv.push(adv); }
          else globalAdv.push(adv);
        } else if (c.code === 121 && p[2] === 0 && ax.kind === 'chain') {
          for (let id = p[0]; id <= p[1]; id++) { const ci = chainIdx(ax, id); if (ci >= 0) segs[ci + 1].advances.push({ at, line: i, where: where(at), text: '打开 ' + (P.name('switch', id) || '开关 ' + id) }); }
        }
      });
    });
    // 同一条（同一页 / 同一个分支）出现在连续的几段里：只在开始那段列一次，写上「到第几段」；每段都有的单独放「一直都有」
    const groups = new Map();
    segs.forEach((s, i) => s.entries.forEach(e => {
      const k = JSON.stringify(e.at) + ':' + (e.line == null ? '' : e.line);
      if (!groups.has(k)) groups.set(k, { e, segs: [], sure: true, slots: new Set(), allSlots: false });
      const g = groups.get(k);
      g.segs.push(i); g.sure = g.sure && e.sure;
      if (e.slots) e.slots.forEach(x => g.slots.add(x)); else g.allSlots = true;
    }));
    for (const s of segs) s.entries = [];
    const always = [];
    for (const g of groups.values()) {
      const e = { ...g.e, sure: g.sure, slots: g.allSlots || !ax.slots.length ? null : [...g.slots].sort() };
      if (g.segs.length === segs.length) { always.push(e); continue; }
      // 拆成连续的几段
      const runs = [];
      for (const i of g.segs) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); }
      for (const [a, b] of runs) segs[a].entries.push({ ...e, to: b === a ? a : b === segs.length - 1 ? -1 : b });
    }
    const order = (a, b) => (b.trigger >= 3) - (a.trigger >= 3) || (b.sure - a.sure) || b.lines - a.lines;
    for (const s of segs) { s.entries.sort(order); s.lines = s.entries.reduce((n, e) => n + e.lines, 0); }
    always.sort(order);
    const varName = ax.var ? P.name('var', ax.var) : '';
    return { axis: { key: ax.key, kind: ax.kind, type: ax.type, var: ax.var || 0, varName, label: ax.label, slots: ax.slots.map(s => s.label) }, segs, always, advances: globalAdv, config: cfg };
  }
  const timeline = key => P.memoize('progress-timeline-' + (key || 'main') + '-' + JSON.stringify(config()), () => timelineNow(key));

  // ---------- 一个事件每页在哪几段出现（文字）：给事件页标注 ----------
  function rangesText(ax, idxs) {
    if (!idxs.length) return '';
    if (idxs.length === ax.segs.length) return '';
    const runs = [];
    for (const i of idxs) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); }
    const name = i => ax.segs[i].label;
    return runs.map(([a, b]) => {
      if (a === b) return name(a);
      if (b === ax.segs.length - 1) return name(a) + ' 起';
      if (ax.type === 'day' && /^第 \d+ 天$/.test(name(a)) && /^第 \d+ 天$/.test(name(b))) return `第 ${ax.segs[a].from}~${ax.segs[b].from} 天`;
      return name(a) + ' ~ ' + name(b);
    }).join('、');
  }
  function eventStages(mapId, evId) {
    const ax = axisOf(config(), 'main');
    if (!ax) return null;
    const e = ((P.map(mapId) || {}).events || [])[evId];
    if (!e) return null;
    const cells = eventCells(ax, e);
    if (!cells) return null;
    return (e.pages || []).map((pg, pi) => {
      const segSet = new Set(), slotSet = new Set();
      let sure = true;
      cells.forEach((hits, k) => { const h = hits.find(x => x.page === pi); if (h) { const { seg, slot } = cellOf(ax, k); segSet.add(seg); if (slot >= 0) slotSet.add(slot); sure = sure && h.sure; } });
      if (!segSet.size) return { text: '这一页在任何进度都被后面的页挡住', never: true };
      const segText = rangesText(ax, [...segSet].sort((a, b) => a - b));
      const slotText = ax.slots.length && slotSet.size < ax.slots.length ? [...slotSet].sort().map(s => ax.slots[s].label).join(' / ') : '';
      return { text: [segText || '所有进度', slotText].filter(Boolean).join(' · '), sure };
    });
  }
  // 一张地图：每个格子（段 × 时段）每个事件显示哪一页（给地图按进度亮暗）
  function mapCellsNow(mapId) {
    const ax = axisOf(config(), 'main');
    if (!ax) return { axis: null };
    const data = P.map(mapId) || {};
    const events = {}, story = {};
    // 空白页（没有小人、没有内容）：看不见也碰不到。「不一定」的空白页（比如播过以后的那页）不挡后面的页；一定是空白页 = 这时不在
    const blank = pg => !(pg.image && (pg.image.characterName || pg.image.tileId)) && (pg.list || []).filter(c => c && c.code !== 0).length === 0;
    for (const e of data.events || []) {
      if (!e) continue;
      const cells = eventCells(ax, e);
      if (!cells) continue;
      const bl = (e.pages || []).map(blank);
      events[e.id] = cells.map(h0 => {
        const h = h0.filter(x => !(bl[x.page] && !x.sure));
        if (!h[0] || bl[h[0].page]) return null;
        return { p: h[0].page, s: h[0].sure ? 1 : 0, n: h.length, c: h.map(x => x.page) };
      });
      // 每页有没有剧情（台词 / 图 / 调用公共事件），给「这一天这张图有几个剧情」用
      story[e.id] = (e.pages || []).map(pg => { const c = content(pg.list); return c.lines + c.pics + c.calls > 0 ? 1 : 0; });
    }
    return { axis: { type: ax.type, label: ax.label, segs: ax.segs.map(s => s.label), slots: ax.slots.map(s => s.label) }, events, story };
  }
  const mapCells = mapId => P.memoize('progress-map-' + mapId + '-' + JSON.stringify(config()), () => mapCellsNow(Number(mapId)));
  // 「这一天的剧情」：这一页只在少数几段出现（超过一半的段都是这一页的，算平时就有的，比如只看时段、每天都一样的）
  const segSpecific = (cand, p) => cand.filter(list => list.includes(p)).length * 2 <= cand.length;
  // 某一段（和时段）每张地图上有几个跟进度有关、这时会出现、而且有剧情的事件；segs = 每一段一共几个（左边天数列表旁边的数字）
  function stageMaps(seg, slot) {
    const ax = axisOf(config(), 'main');
    if (!ax) return { axis: null, maps: [], segs: [] };
    const nS = Math.max(1, ax.slots.length);
    // 全天 = 哪个时段算上都行（只在夜晚出现的也算这一天的）
    const slotList = ax.slots.length && !(slot >= 0) ? Array.from({ length: nS }, (_, i) => i) : [Math.max(0, slot)];
    const maps = [], segs = ax.segs.map(() => 0);
    for (const m of P.mapList()) {
      let mc;
      try { mc = mapCells(m.id); } catch { continue; }
      let n = 0;
      for (const [id, cells] of Object.entries(mc.events || {})) {
        const st = mc.story[id] || [];
        const hits = ax.segs.map(() => false);
        for (const sl of slotList) {
          // 每段的候选页；某一页只在少数几段是候选、而且有剧情 → 那几段算这一天的剧情
          const cand = ax.segs.map((_, s) => { const c = cells[s * nS + sl]; return c ? c.c : []; });
          cand.forEach((list, s) => { if (list.some(p => st[p] && segSpecific(cand, p))) hits[s] = true; });
        }
        hits.forEach((h, s) => { if (h) { segs[s]++; if (s === seg) n++; } });
      }
      maps.push({ id: m.id, n });
    }
    return { axis: { type: ax.type, segs: ax.segs.map(s => s.label), slots: ax.slots.map(s => s.label) }, maps, segs };
  }

  // ---------- 这一天（这一段）的事件顺序 ----------
  // 必要（红）：一进地图自动播 / 并行处理的，或者会把剧情推进下去的（改天数、开下一章的开关、切时段，调用的公共事件里这么做也算）
  // 支线（绿）：要玩家自己去找、按确定键 / 碰到才有的
  // 顺序：按时段，时段里 自动播的 → 支线 → 推进的（推进了这一段就过去了）
  //   返回 { text, to（推进到第几段）, inc（加上去）, slot（切到哪个时段）} 或 null
  function advanceOf(ax, list, depth = 0) {
    for (const c of list || []) {
      if (!c) continue;
      const p = c.parameters || [];
      if (c.code === 122 && ax.kind === 'var' && p[0] <= ax.var && ax.var <= p[1]) {
        if (p[3] === 0 && p[2] === 0) { const s = segOfValue(ax, p[4]); return { text: '推进到' + (s >= 0 ? ax.segs[s].label : String(p[4])), to: s }; }
        if (p[2] === 1 && p[3] === 0 && p[4] > 0) return { text: ax.type === 'day' ? '过一天' : '推进 +' + p[4], inc: true };
        return { text: '改了' + (ax.type === 'day' ? '天数' : '进度'), inc: true };
      }
      if (c.code === 121 && p[2] === 0) {
        for (let id = p[0]; id <= p[1]; id++) {
          const ci = chainIdx(ax, id); if (ci >= 0) return { text: '推进到' + ax.chain[ci].label, to: ci + 1 };
          const si = slotIdx(ax, id); if (si >= 0) return { text: '切到' + ax.slots[si].label, slot: si };
        }
      }
      if (c.code === 117 && depth < 1) {
        const ce = (P.read('CommonEvents.json') || [])[p[0]];
        const t = ce && advanceOf(ax, ce.list, depth + 1);
        if (t) return t;
      }
    }
    return null;
  }
  // 在第 seg 段做这件事，剧情是不是真的往前走了（已经在第 3 段了再「推进到第 3 段」不算）
  const forward = (a, seg) => !!a && (a.inc || a.slot != null || (a.to != null && a.to > seg));
  // 这个公共事件会不会自己播：自己是自动执行 / 并行，或者被自动播的事件页 / 公共事件调用
  function autoCE(id) {
    return P.memoize('progress-autoce', () => {
      const out = new Map();
      const ces = P.read('CommonEvents.json') || [];
      const auto = cid => {
        if (out.has(cid)) return out.get(cid);
        out.set(cid, false);
        const c = ces[cid];
        let yes = !!(c && c.trigger);
        if (!yes) for (const r of xref.of('ce', cid)) {
          if (r.at.type === 'map') { const e = ((P.map(r.at.map) || {}).events || [])[r.at.ev]; const pg = e && e.pages[r.at.page]; if (pg && pg.trigger >= 3) { yes = true; break; } }
          else if (r.at.type === 'ce' && auto(r.at.ce)) { yes = true; break; }
        }
        out.set(cid, yes);
        return yes;
      };
      return { auto };
    }).auto(id);
  }
  // 一次算出每一段的事件顺序（换天只是取另一段，不用重算）
  function dayOrderAllNow(slot) {
    const ax = axisOf(config(), 'main');
    if (!ax) return null;
    const nS = Math.max(1, ax.slots.length), N = ax.segs.length;
    const slotList = ax.slots.length && !(slot >= 0) ? Array.from({ length: nS }, (_, i) => i) : [Math.max(0, slot)];
    const outs = ax.segs.map(() => []);
    for (const m of P.mapList()) {
      let mc, data;
      try { mc = mapCells(m.id); data = P.map(m.id); } catch { continue; }
      for (const [id, cells] of Object.entries(mc.events || {})) {
        const e = data.events[id], st = mc.story[id] || [];
        const adv = (e.pages || []).map(pg => advanceOf(ax, pg.list));
        // 每一段要列的页：只在少数几段有的剧情页，或者在这一段会把剧情推进下去的页（每天都在的床「过一天」、切时段的也算）
        const found = ax.segs.map(() => new Map());
        for (const sl of slotList) {
          const cand = ax.segs.map((_, s) => { const c = cells[s * nS + sl]; return c ? c.c : []; });
          const cnt = new Map();
          for (const list of cand) for (const q of list) cnt.set(q, (cnt.get(q) || 0) + 1);
          cand.forEach((list, s) => {
            const q = list.find(x => (st[x] && cnt.get(x) * 2 <= N) || forward(adv[x], s));
            if (q == null) return;
            if (!found[s].has(q)) found[s].set(q, []);
            found[s].get(q).push(sl);
          });
        }
        found.forEach((f, s) => {
          for (const [p, sls] of f) {
            const pg = e.pages[p];
            const at = { type: 'map', map: m.id, ev: e.id, page: p };
            const a = forward(adv[p], s) ? adv[p].text : '';
            const auto = pg.trigger >= 3;
            outs[s].push({ kind: 'page', at, where: where(at), map: m.id, x: e.x, y: e.y, name: e.name, slots: ax.slots.length && sls.length < nS ? sls : null,
              trigger: pg.trigger, required: auto || !!a, auto, adv: a, pageCond: pg.conditions, ...content(pg.list) });
          }
        });
      }
    }
    // 事件页 / 公共事件里「如果 天数 = 3」这种分支
    const tl = timeline('main');
    tl.segs.forEach((sg, s) => {
      for (const e of sg.entries) {
        if (e.kind !== 'branch') continue;
        if (ax.slots.length && slot >= 0 && e.slots && !e.slots.includes(slot)) continue;
        let auto = false, list = [], extra = {};
        if (e.at.type === 'ce') { auto = autoCE(e.at.ce); list = ((P.read('CommonEvents.json') || [])[e.at.ce] || {}).list || []; }
        else if (e.at.type === 'map') { const ev = ((P.map(e.at.map) || {}).events || [])[e.at.ev]; const pg = ev && ev.pages[e.at.page]; auto = !!(pg && pg.trigger >= 3); list = pg ? pg.list : []; extra = { map: e.at.map, x: ev ? ev.x : 0, y: ev ? ev.y : 0, name: ev ? ev.name : '' }; }
        const a = advanceOf(ax, branchBody(list, e.line));
        const adv = forward(a, s) ? a.text : '';
        outs[s].push({ ...e, ...extra, required: auto || !!adv, auto, adv });
      }
    });
    const group = x => (x.auto ? 0 : x.required ? 2 : 1);
    for (const out of outs) out.sort((a, b) => ((a.slots ? a.slots[0] : -1) - (b.slots ? b.slots[0] : -1)) || group(a) - group(b) || (a.map || 0) - (b.map || 0) || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
    return { axis: { type: ax.type, kind: ax.kind, var: ax.var || 0, segs: ax.segs.map(s => s.label), slots: ax.slots.map(s => s.label), slotSwitches: ax.slots.map(s => s.switch), chain: (ax.chain || []).map(c => c.switch) }, outs };
  }
  const dayOrderAll = slot => P.memoize(`progress-days-${slot}-` + JSON.stringify(config()), () => dayOrderAllNow(slot));
  function dayOrder(seg, slot) {
    const all = dayOrderAll(slot);
    if (!all || !all.outs[seg]) return { axis: null, entries: [] };
    return { axis: all.axis, entries: all.outs[seg] };
  }

  return { stats, detect, config, normalize, axisOf, timeline, eventStages, mapCells, stageMaps, dayOrder, daySetup, chapterSetup, trackSetup };
}

module.exports = { createProgress, chapterNo };
