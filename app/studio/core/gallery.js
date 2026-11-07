'use strict';
// 回想房（通用）
//   认出回想房地图：地图备注里有 <RpgStudioRecallRoom> 的（在回想房页面里指定 / 新建时写上），其次是名字带 回想 / 图鉴 / 画廊 / Gallery… 的
//   每个入口事件：播的是哪几段（选项分支 / 调用的公共事件 / 直接写在页里的）、用到的图、怎么解锁
//     解锁 = 这一页的出现条件（开关、变量…），或者选项文字前面的 <<条件>>（WD_ConditionalChoice 这类插件，条件成立时锁住）
//     每个解锁开关在哪里被打开；回想房以外没有地方打开 = 永远看不到
//   缺口：带剧情 CG 的事件页 / 公共事件，图片大多没在回想房里出现过
//   加回想：挑已有的事件，在回想房里完整播放
//     地图事件和公共事件都复制，递归复制调用链并过滤传送等指令；原剧情不受影响
//     入口：播放 / 只看图 / 算了；播放 = 记下开关 / 变量 / 物品 → 调用 → 恢复 → 淡入、清图、恢复 BGM
//     只看图：按原顺序只放图片和画面效果，原来每段台词的位置换成「点一下继续」（中间没换图的合并），另存一个公共事件
//     复制时只去掉在回想房里会出问题的：传送、存档 / 回标题 / 游戏结束、暂时消除事件、指向原地图其它事件的移动 / 动画 / 气泡
const ROOM_TAG = '<RpgStudioRecallRoom>';
const GALLERY_NAME = /回想|图鉴|圖鑑|画廊|鑑賞|鉴赏|gallery|recollection|memories|memory ?room|replay ?room/i;
const CANCEL = /^(算了|取消|退出|返回|关闭|不看了|没事|不要|下次再说|nevermind|never mind|cancel|no|back|exit|quit|return|leave)[。.!！]?$/i;
const CHOICE_COND = /^\s*<<(.*?)>>/;
// 复制到回想房时去掉的：传送、打开存档 / 游戏结束 / 回标题、暂时消除事件（会把入口消掉）
const DROP = new Set([201, 352, 353, 354, 214]);
// 指向某个事件的指令：原地图上的第 N 号事件在回想房里不存在（或者是别的东西），这几条去掉；玩家（-1）和「本事件」（0）留着
const TARGETS = new Set([203, 205, 212, 213]);
const TAG_RE = /<RpgStudioRecall:([^>]*)>/i;
const SNAP = [
  '// 回想：记下现在的开关、变量、物品，播完恢复（不影响存档进度）',
  '$gameTemp._rpgStudioRecall = [JSON.stringify($gameSwitches._data), JSON.stringify($gameVariables._data), JSON.stringify($gameSelfSwitches._data), JSON.stringify([$gameParty._items, $gameParty._weapons, $gameParty._armors, $gameParty._gold])];',
];
const RESTORE = [
  '// 回想：恢复播之前的开关、变量、物品',
  'var r = $gameTemp._rpgStudioRecall;',
  'if (r) { $gameSwitches._data = JSON.parse(r[0]); $gameVariables._data = JSON.parse(r[1]); $gameSelfSwitches._data = JSON.parse(r[2]);',
  '  var p = JSON.parse(r[3]); $gameParty._items = p[0]; $gameParty._weapons = p[1]; $gameParty._armors = p[2]; $gameParty._gold = p[3];',
  '  $gameTemp._rpgStudioRecall = null; $gameMap.requestRefresh(); }',
];
const script = (lines, indent) => lines.map((t, i) => ({ code: i ? 655 : 355, indent, parameters: [t] }));
const parseTag = note => {
  const m = TAG_RE.exec(String(note || ''));
  if (!m) return null;
  const o = {};
  for (const kv of m[1].split(';')) { const [k, v] = kv.split('='); if (k && v != null) o[k.trim()] = v.trim(); }
  const src = String(o.src || '').split('/');
  const at = src[0] === 'map' ? { type: 'map', map: Number(src[1]), ev: Number(src[2]), page: Number(src[3]) } : src[0] === 'ce' ? { type: 'ce', ce: Number(src[1]) } : null;
  return { at, ce: Number(o.ce) || 0, copy: o.copy === '1', pic: Number(o.pic) || 0, deps: String(o.deps || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0) };
};
const makeTag = (at, ce, copy, pic, deps = []) => `<RpgStudioRecall:src=${at.type === 'map' ? `map/${at.map}/${at.ev}/${at.page}` : `ce/${at.ce}`};ce=${ce};copy=${copy ? 1 : 0}${pic ? ';pic=' + pic : ''}${deps.length ? ';deps=' + deps.join(',') : ''}>`;
const clone = o => JSON.parse(JSON.stringify(o));

// 选项文字：去掉 <<条件>>，拿出要求的开关（!s[N] = 开关 N 要是开的）
function choiceInfo(text) {
  const raw = String(text == null ? '' : text);
  const m = CHOICE_COND.exec(raw);
  const label = (m ? raw.slice(m[0].length) : raw).trim();
  const needs = [];
  if (m) for (const x of m[1].matchAll(/(!?)\s*s\[(\d+)\]/g)) needs.push({ id: Number(x[2]), on: x[1] === '!' });
  return { label, needs, cond: m ? m[0].trim() : '' };
}

function createGallery(project, xref, opts = {}) {
  const P = project;
  const storyRange = () => { const r = (opts.pictures && opts.pictures()) || {}; return { min: Number(r.min) || 1, max: Number(r.max) || 100 }; };
  const ceList = () => P.read('CommonEvents.json') || [];

  function candidates() {
    const out = [];
    for (const m of P.mapList()) {
      let data = null;
      try { data = P.map(m.id); } catch { }
      const name = String(m.name || ''), shown = String((data && data.displayName) || '');
      const tagged = !!(data && String(data.note || '').includes(ROOM_TAG));
      if (tagged || GALLERY_NAME.test(name) || GALLERY_NAME.test(shown)) out.push({ id: m.id, name, displayName: shown, tagged, events: data ? (data.events || []).filter(Boolean).length : 0 });
    }
    return out.sort((a, b) => (b.tagged - a.tagged) || (b.events - a.events));
  }
  function current() {
    const c = candidates()[0];
    return c ? { id: c.id, forced: c.tagged } : null;
  }

  // 一段指令（连同它调用的公共事件）里：显示了哪些图、几个对话框、调用了哪些公共事件
  function walk(list, acc, seen, cesArg) {
    acc = acc || { pics: new Map(), lines: 0, calls: [], picIds: new Set(), bgm: false, bgs: false };
    seen = seen || new Set();
    const ces = cesArg || ceList();
    const { min, max } = storyRange();
    for (const c of list || []) {
      if (!c) continue;
      const p = c.parameters || [];
      if (c.code === 101 || c.code === 105) acc.lines++;
      else if (c.code === 231) {
        acc.picIds.add(Number(p[0]));
        const name = String(p[1] || '');
        if (name && Number(p[0]) >= min && Number(p[0]) <= max) acc.pics.set(name, (acc.pics.get(name) || 0) + 1);
      } else if (c.code === 241) acc.bgm = true;
      else if (c.code === 245) acc.bgs = true;
      else if (c.code === 117) {
        const id = Number(p[0]);
        if (!acc.calls.includes(id)) acc.calls.push(id);
        if (!seen.has('no-recurse') && !seen.has(id) && ces[id]) { seen.add(id); walk(ces[id].list, acc, seen, ces); }
      }
    }
    return acc;
  }

  // 第一个选项（最外层的那个）的每个分支
  function branches(list) {
    let at = -1;
    let minIndent = Infinity;
    list.forEach((c, i) => { if (c && c.code === 102 && (c.indent || 0) < minIndent) { minIndent = c.indent || 0; at = i; } });
    if (at < 0) return null;
    const ind = list[at].indent || 0;
    const out = [];
    let cur = null;
    for (let i = at + 1; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      if ((c.indent || 0) === ind && (c.code === 402 || c.code === 403)) { cur = { i, code: c.code, text: c.code === 402 ? (c.parameters || [])[1] : '（按取消时）', body: [] }; out.push(cur); continue; }
      if ((c.indent || 0) === ind && c.code === 404) break;
      if (cur && (c.indent || 0) > ind) cur.body.push(c);
    }
    return { line: at, choices: (list[at].parameters || [])[0] || [], branches: out };
  }

  // 这一页播的是哪几段
  function scenesOf(list, fallbackLabel) {
    const ces = ceList();
    const pack = (label, body, extra) => {
      const w = walk(body);
      return {
        label, ...extra,
        pics: [...w.pics.keys()].slice(0, 6), picCount: w.pics.size, shown: w.picIds.size, lines: w.lines,
        calls: w.calls.filter(id => ces[id]).map(id => ({ ce: id, name: String(ces[id].name || '') })),
      };
    };
    const br = branches(list);
    if (br && br.branches.length) {
      const out = [];
      for (const b of br.branches) {
        const info = choiceInfo(b.text);
        const s = pack(info.label, b.body, { needs: info.needs, cond: info.cond, line: b.i });
        if ((!s.label || CANCEL.test(s.label) || b.code === 403) && !s.shown && s.lines < 2 && !s.calls.length) continue;
        out.push(s);
      }
      // 选项前面的内容（标题之类）不算一段
      return out;
    }
    return [pack(fallbackLabel, list, { needs: [], cond: '', line: 0 })];
  }

  const isContent = pg => pg && (pg.list || []).filter(c => c && c.code !== 0).length > 0;
  const condSwitches = c => [c.switch1Valid ? c.switch1Id : 0, c.switch2Valid ? c.switch2Id : 0].filter(Boolean);
  const hasCond = c => !!(c && (c.switch1Valid || c.switch2Valid || c.variableValid || c.selfSwitchValid || c.itemValid || c.actorValid));

  // 开关在回想房以外哪里被打开
  //   脚本里提到这个开关的也算（可能是 setValue）；回想房自己里面打开的（「全解锁」之类）单独数
  function setters(id, galleryId) {
    const refs = xref.of('switch', id).filter(r => r.use === 'set' || r.use === 'script');
    const inRoom = r => r.at.type === 'map' && r.at.map === galleryId;
    return { outside: refs.filter(r => !inRoom(r)).map(r => r.at), room: refs.filter(inRoom).length };
  }

  function entry(galleryId, e) {
    const pages = e.pages || [];
    // 看得到内容的那一页：最后一个有内容、按键 / 接触触发的页
    let ci = -1;
    for (let i = pages.length - 1; i >= 0; i--) if (isContent(pages[i]) && pages[i].trigger <= 2) { ci = i; break; }
    if (ci < 0) return null;
    const pg = pages[ci];
    const c = pg.conditions || {};
    const tag0 = parseTag(e.note);
    // 在这里加的回想：入口是「播放 / 只看图 / 算了」，内容就是那个公共事件
    const scenes = tag0 && tag0.ce ? scenesOf([{ code: 117, indent: 0, parameters: [tag0.ce] }], '完整播放') : scenesOf(pg.list || [], e.name);
    const firstText = (() => { const i = (pg.list || []).findIndex(x => x && x.code === 401); return i >= 0 ? String(pg.list[i].parameters[0] || '') : ''; })();
    const sw = new Map();
    const addSw = (id, on, from) => { if (!sw.has(id)) { const s = setters(id, galleryId); sw.set(id, { id, name: P.name('switch', id), on, from, setBy: s.outside, roomSet: s.room }); } };
    for (const id of condSwitches(c)) addSw(id, true, 'page');
    for (const s of scenes) for (const n of s.needs || []) addSw(n.id, n.on, 'choice');
    const unlock = {
      switches: [...sw.values()],
      variable: c.variableValid ? { id: c.variableId, name: P.name('var', c.variableId), value: c.variableValue } : null,
      other: [c.selfSwitchValid ? '独立开关 ' + c.selfSwitchCh : '', c.itemValid ? P.label('item', c.itemId) : '', c.actorValid ? P.label('actor', c.actorId) + ' 在队伍' : ''].filter(Boolean),
      lockedPage: ci > 0 && hasCond(c) && !hasCond((pages[0] || {}).conditions) ? 0 : -1,
    };
    const neverOn = unlock.switches.filter(s => s.on && !s.setBy.length).map(s => s.id);
    const real = scenes.some(s => s.shown > 0 || s.lines >= 5 || s.calls.length);
    const tag = tag0;
    return {
      ev: e.id, name: e.name || '', x: e.x, y: e.y, page: ci, pages: pages.length, source: tag,
      image: pg.image || {}, title: firstText, scenes, unlock, neverOn,
      open: !unlock.switches.length && !unlock.variable && !unlock.other.length,
      kind: real ? 'scene' : 'other',
    };
  }

  // 总览、缺口、可挑的剧情都要扫一遍整个游戏：按数据签名缓存，没改数据就不重算
  const view = () => P.memoize('gallery-view', viewNow);
  function viewNow() {
    const cur = current();
    if (!cur) return { map: null, candidates: candidates(), entries: [], system: [] };
    const data = P.map(cur.id) || {};
    const entries = [], system = [];
    for (const e of data.events || []) {
      if (!e) continue;
      const x = entry(cur.id, e);
      if (x) entries.push(x); else system.push({ ev: e.id, name: e.name || '', x: e.x, y: e.y });
    }
    entries.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return { map: { id: cur.id, name: P.name('map', cur.id) || (P.mapList().find(m => m.id === cur.id) || {}).name || '', forced: cur.forced, width: data.width, height: data.height }, candidates: candidates(), entries, system };
  }

  // 回想房里出现过的图、调用到的公共事件
  function covered(galleryId) {
    const pics = new Set(), ces = new Set();
    const data = P.map(galleryId) || {};
    for (const e of data.events || []) if (e) for (const pg of e.pages || []) {
      const w = walk(pg.list || []);
      for (const n of w.pics.keys()) pics.add(n);
      for (const id of w.calls) ces.add(id);
    }
    // 调用到的公共事件里再调用的
    let grew = true;
    const all = ceList();
    while (grew) {
      grew = false;
      for (const id of [...ces]) for (const c of ((all[id] || {}).list || [])) if (c && c.code === 117 && !ces.has(Number(c.parameters[0]))) { ces.add(Number(c.parameters[0])); grew = true; }
    }
    return { pics, ces };
  }

  // 还没进回想的 CG 剧情：一页里有 2 张以上剧情图，而且大多没在回想房出现过
  const gaps = (limit = 80) => P.memoize('gallery-gaps-' + limit, () => gapsNow(limit));
  function gapsNow(limit) {
    const cur = current();
    if (!cur) return [];
    const cov = covered(cur.id);
    const out = [];
    xref.each((at, list) => {
      if (at.type === 'troop') return;
      if (at.type === 'map' && at.map === cur.id) return;
      if (at.type === 'ce' && cov.ces.has(at.ce)) return;
      const w = walk(list, null, new Set(['no-recurse']));
      const names = [...new Map([...(list || [])].filter(c => c && c.code === 231).map(c => [String(c.parameters[1] || ''), Number(c.parameters[0])])).entries()]
        .filter(([n, id]) => n && id >= storyRange().min && id <= storyRange().max).map(([n]) => n);
      if (names.length < 2) return;
      const hit = names.filter(n => cov.pics.has(n)).length;
      if (hit / names.length >= 0.5) return;
      const first = (() => { const i = list.findIndex(c => c && c.code === 401); return i >= 0 ? P.expandN(String(list[i].parameters[0] || '')) : ''; })();
      out.push({ at, pics: names.length, covered: hit, lines: list.filter(c => c && c.code === 101).length, sample: names.slice(0, 4), first, calls: w.calls.length });
    });
    return out.sort((a, b) => (b.pics - a.pics) || (b.lines - a.lines)).slice(0, limit);
  }

  // 地图事件页 → 回想用的公共事件内容：照原样，只去掉在回想房里会出问题的几条
  function copyScene(src) {
    const out = [], removed = {};
    const list = clone(src || []).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const c = list[i], p = c.parameters || [];
      let drop = DROP.has(c.code) || (TARGETS.has(c.code) && Number(p[0]) > 0);
      if (drop) {
        removed[c.code] = (removed[c.code] || 0) + 1;
        if (c.code === 205) while (i + 1 < list.length && list[i + 1].code === 505) i++;   // 移动路线的续行一起去掉
        continue;
      }
      out.push(c);
    }
    if (!out.length || out[out.length - 1].code !== 0) out.push({ code: 0, indent: 0, parameters: [] });
    return { list: out, removed };
  }

  // 克隆整个公共事件调用图。先登记编号再递归，保留共享调用和循环引用。
  function copyGraph(src, ces, allocate, options = {}) {
    const root = options.rootId || allocate();
    const copies = new Map();
    if (options.sourceCe) copies.set(options.sourceCe, root);
    const deps = [], removed = {};
    const record = (id, name) => ({ id, name: String(name || '回想').slice(0, 40), trigger: 0, switchId: 1, list: [] });
    const copyList = list => {
      const cp = copyScene(list);
      for (const [code, count] of Object.entries(cp.removed)) removed[code] = (removed[code] || 0) + count;
      for (const c of cp.list) if (c.code === 117) {
        const source = Number(c.parameters[0]);
        if (!copies.has(source)) {
          const original = ces[source];
          if (!original) throw new Error('公共事件 ' + source + ' 不存在，不能创建回想');
          const id = allocate();
          copies.set(source, id);
          deps.push(id);
          ces[id] = record(id, '回想·' + original.name);
          ces[id].list = copyList(original.list);
        }
        c.parameters[0] = copies.get(source);
      }
      return cp.list;
    };
    ces[root] = record(root, '回想·' + (options.title || ''));
    ces[root].list = copyList(src);
    return { ce: root, deps, removed };
  }

  // 只看图：把剧情（连同调用的公共事件、所有分支）摊平，只留图片和画面效果；台词处换成透明的「点一下继续」
  const PIC_KEEP = new Set([221, 222, 223, 224, 225, 230, 231, 232, 233, 234, 235, 236]);
  const PIC_CHANGE = new Set([231, 232, 233, 234, 235]);
  function imageOnly(src, head, ceListNow) {
    const ces = ceListNow || ceList();
    const out = [];
    let dirty = false, shown = 0;
    const pause = () => { out.push({ ...head(''), indent: 0, parameters: head('').parameters.map((v, i) => (i === 2 ? 2 : v)) }); out.push({ code: 401, indent: 0, parameters: [' '] }); dirty = false; };
    const flat = (list, seen) => {
      for (const c of list || []) {
        if (!c) continue;
        if (c.code === 117) { const id = Number(c.parameters[0]); if (!seen.has(id) && ces[id]) { seen.add(id); flat(ces[id].list, seen); } continue; }
        if (c.code === 101 || c.code === 105) { if (dirty) pause(); continue; }
        if (!PIC_KEEP.has(c.code)) continue;
        if (c.code === 230 && Number(c.parameters[0]) > 120) { out.push({ code: 230, indent: 0, parameters: [120] }); continue; }
        out.push({ ...clone(c), indent: 0 });
        if (PIC_CHANGE.has(c.code)) dirty = true;
        if (c.code === 231) shown++;
      }
    };
    flat(src, new Set());
    if (dirty) pause();
    return { list: out, shown };
  }

  // 入口事件的内容：播放 / 只看图 / 算了
  function entryCommands(title, ceId, ceListNow, head, picCe) {
    const w = walk([{ code: 117, indent: 0, parameters: [ceId] }], null, new Set(), ceListNow);
    const ce = (ceListNow || ceList())[ceId] || { list: [] };
    const codes = (ce.list || []).map(c => c && c.code);
    const needFadeIn = codes.lastIndexOf(221) > codes.lastIndexOf(222);
    const L = [];
    L.push({ ...head(''), indent: 0 });
    L.push({ code: 401, indent: 0, parameters: ['回想：' + title] });
    const labels = picCe ? ['播放', '只看图', '算了'] : ['播放', '算了'];
    L.push({ code: 102, indent: 0, parameters: [labels, labels.length - 1, 0, 2, 0] });
    L.push({ code: 402, indent: 0, parameters: [0, '播放'] });
    L.push(...script(SNAP, 1));
    if (w.bgm) L.push({ code: 243, indent: 1, parameters: [] });
    L.push({ code: 117, indent: 1, parameters: [ceId] });
    L.push(...script(RESTORE, 1));
    if (needFadeIn) L.push({ code: 222, indent: 1, parameters: [] });
    for (const id of [...w.picIds].filter(n => n > 0).sort((a, b) => a - b)) L.push({ code: 235, indent: 1, parameters: [id] });
    if (w.bgs) L.push({ code: 246, indent: 1, parameters: [1] });
    if (w.bgm) L.push({ code: 244, indent: 1, parameters: [] });
    L.push({ code: 0, indent: 1, parameters: [] });
    if (picCe) {
      // 只看图：不改任何状态，不用记下 / 恢复
      const pc = (ceListNow || ceList())[picCe] || { list: [] };
      const pcodes = (pc.list || []).map(c => c && c.code);
      L.push({ code: 402, indent: 0, parameters: [1, '只看图'] });
      L.push({ code: 117, indent: 1, parameters: [picCe] });
      if (pcodes.lastIndexOf(221) > pcodes.lastIndexOf(222)) L.push({ code: 222, indent: 1, parameters: [] });
      for (const id of [...new Set((pc.list || []).filter(c => c && c.code === 231).map(c => Number(c.parameters[0])))].filter(n => n > 0).sort((a, b) => a - b)) L.push({ code: 235, indent: 1, parameters: [id] });
      L.push({ code: 0, indent: 1, parameters: [] });
    }
    L.push({ code: 402, indent: 0, parameters: [labels.length - 1, '算了'] });
    L.push({ code: 0, indent: 1, parameters: [] });
    L.push({ code: 404, indent: 0, parameters: [] });
    L.push({ code: 0, indent: 0, parameters: [] });
    return { list: L, pics: w.pics.size, lines: w.lines, erase: w.picIds.size, bgm: w.bgm, fadeIn: needFadeIn, picOnly: !!picCe };
  }

  // 能挑来加进回想的剧情：有台词或者剧情图的事件页 / 公共事件
  const sources = () => P.memoize('gallery-sources', sourcesNow);
  function sourcesNow() {
    const cur = current();
    const cov = cur ? covered(cur.id) : { pics: new Set(), ces: new Set() };
    const inRoom = new Set();
    if (cur) for (const e of (P.map(cur.id) || {}).events || []) { const t = e && parseTag(e.note); if (t && t.at) inRoom.add(JSON.stringify(t.at)); }
    const out = [];
    xref.each((at, list, cond, owner) => {
      if (at.type === 'troop') return;
      if (cur && at.type === 'map' && at.map === cur.id) return;
      const w = walk(list, null, new Set(['no-recurse']));
      const own = (list || []).filter(c => c && c.code === 231 && Number(c.parameters[0]) >= storyRange().min && Number(c.parameters[0]) <= storyRange().max).map(c => String(c.parameters[1] || '')).filter(Boolean);
      const lines = (list || []).filter(c => c && c.code === 101).length;
      if (!lines && !own.length) return;
      const uniq = [...new Set(own)];
      const first = (() => { const i = (list || []).findIndex(c => c && c.code === 401); return i >= 0 ? P.expandN(String(list[i].parameters[0] || '')) : ''; })();
      const pg = at.type === 'map' ? (owner.pages || [])[at.page] : null;
      out.push({
        at, name: String(owner.name || ''), lines, pics: uniq.length, sample: uniq.slice(0, 3), first,
        image: pg && pg.image && pg.image.characterName ? pg.image : null,
        calls: w.calls.length,
        inRoom: inRoom.has(JSON.stringify(at)) || (at.type === 'ce' && cov.ces.has(at.ce)),
        covered: uniq.length ? uniq.filter(n => cov.pics.has(n)).length / uniq.length : 0,
      });
    });
    return out;
  }

  // 地图上能站人的空格子：挨着现有的回想入口找
  function freeSpot(data, tilesetFlags, near) {
    const W = data.width, H = data.height;
    const taken = new Set((data.events || []).filter(Boolean).map(e => e.x + ',' + e.y));
    const pass = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H || taken.has(x + ',' + y)) return false;
      if (!tilesetFlags) return true;
      for (let z = 3; z >= 0; z--) {
        const t = data.data[(z * H + y) * W + x] || 0;
        if (!t) continue;
        const f = tilesetFlags[t] || 0;
        if (f & 0x10) continue;
        return (f & 0x0f) !== 0x0f;
      }
      return false;
    };
    for (const p of near || []) for (const [dx, dy] of [[1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [0, -1], [0, 2]]) if (pass(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
    for (let r = 0; r < Math.max(W, H); r++) for (let y = Math.floor(H / 2) - r; y <= Math.floor(H / 2) + r; y++) for (let x = Math.floor(W / 2) - r; x <= Math.floor(W / 2) + r; x++) if (pass(x, y)) return { x, y };
    return null;
  }

  return { candidates, current, view, entry, gaps, covered, copyScene, copyGraph, entryCommands, imageOnly, sources, freeSpot, walk, choiceInfo, parseTag, makeTag, CANCEL };
}

module.exports = { createGallery, choiceInfo, parseTag, makeTag, GALLERY_NAME, ROOM_TAG, DROP, TARGETS };
