'use strict';
// 剧情进度：时间线页（主线 + 每条支线）、顶栏的「进度」选择、进度设置弹窗、改条件时「放在第几天」
//   主线一次一种：按天（天数变量 + 时段开关）/ 按章节（进度变量切段）/ 按开关链（第 N 章完成……）/ 按地图（不分进度）
//   只是看法：不改游戏数据。顶栏选了进度后，地图上那时不出现的事件变暗，事件页标出那时显示哪一页
let PROG = null;   // GET progress：{ config, source, canConfigure, candidates, slotCandidates, chainCandidates, switches }
const PTYPE = { day: '按天', chapter: '按章节', switches: '按开关链', map: '按地图' };
const PSOURCE = { saved: '自己设的', profile: '游戏配置给的', detected: '自动认出来的' };

async function loadProgress(force) {
  if (!PROG || force) { try { PROG = await api('progress'); } catch { PROG = null; } }
  if (PROG) loadStage();
  drawStagePick();
  return PROG;
}
// 主线的分段 / 时段（按地图时是 null）
// 从选中的这一段开始试玩：进度变量（或开关链上的开关）先设好，人放在工作台正在看的那张地图上（找一格能站的）
function playFromStage() {
  const m = PROG && PROG.config.main;
  if (!m || !S.stage) return playGame({ skipTitle: true });
  const o = { vars: {}, switches: {}, map: PW.map || (S.project.start || {}).map, x: -1, y: -1 };
  if (m.type === 'day' || m.type === 'chapter') {
    const seg = m.segs[S.stage.seg];
    if (seg) o.vars[m.var] = seg.from;
    if (m.type === 'day' && S.stage.slot >= 0 && m.slots[S.stage.slot]) m.slots.forEach((sl, i) => { o.switches[sl.switch] = i === S.stage.slot; });
  } else if (m.type === 'switches') m.chain.forEach((c, i) => { o.switches[c.switch] = i < S.stage.seg; });
  const st = S.project.start || {};
  if (o.map === st.map) { o.x = st.x; o.y = st.y; }
  playGame(o);
}
function progAxis() {
  const m = PROG && PROG.config.main;
  if (!m || m.type === 'map') return null;
  if (m.type === 'switches') return { type: m.type, segs: ['开始', ...m.chain.map(c => c.label)], slots: [] };
  return { type: m.type, segs: m.segs.map(s => s.label), slots: (m.slots || []).map(s => s.label) };
}
// 一段的条件写成字：DayCount = 3 / 主线进度 ≥ 2 / 第一章完成 为开
function segCond(m, i, varName) {
  if (m.type === 'switches') return i ? `${m.chain[i - 1].label}：开关 ${m.chain[i - 1].switch} 为开` : '链上的开关都还没开';
  const s = m.segs[i], next = m.segs[i + 1];
  const v = varName || '变量 ' + m.var;
  if (next && next.from === s.from + 1) return `${v} = ${s.from}`;
  return next ? `${v} ${s.from}~${next.from - 1}` : `${v} ≥ ${s.from}`;
}

// ---------- 顶栏：现在看哪个进度 ----------
const stageKey = () => 'studio.stage.' + ((PROJ && PROJ.current) || (S.project && S.project.title) || '');
function loadStage() {
  S.stage = null;
  const ax = progAxis();
  if (!ax) return;
  try {
    const v = JSON.parse(localStorage.getItem(stageKey()) || 'null');
    if (v && v.seg >= 0 && v.seg < ax.segs.length) S.stage = { seg: v.seg, slot: v.slot >= 0 && v.slot < ax.slots.length ? v.slot : -1 };
  } catch { }
}
function setStage(v) {
  S.stage = v;
  try { localStorage.setItem(stageKey(), JSON.stringify(v)); } catch { }
  drawStagePick();
  const r = route();
  if (r.name === 'map' && typeof ME !== 'undefined' && ME && ME.id === Number(r.a)) applyMapStage();
  else if (r.name === 'event') render();
  else if (r.name === 'progress') {
    if ($('#pwMaps')) { if (!v) { render(); return; } if (PW.sel) PW.sel.page = null; refreshWorkspace(false, true); }
    $$('.tlseg').forEach(x => x.classList.toggle('here', !!v && Number(x.dataset.seg) === v.seg));
  }
}
const stageText = () => {
  const ax = progAxis();
  if (!ax || !S.stage) return '全部';
  return ax.segs[S.stage.seg] + (S.stage.slot >= 0 ? ' · ' + ax.slots[S.stage.slot] : '');
};
function drawStagePick() {
  const box = $('#stagePick');
  if (!box) return;
  const ax = progAxis();
  box.hidden = !ax;
  if (!ax) { box.innerHTML = ''; return; }
  const st = S.stage;
  box.innerHTML = `<details class="stg ${st ? 'set' : ''}"><summary title="选一个进度，地图上那时不出现的事件会变暗"><span class="faint">进度</span><b>${esc(stageText())}</b><span class="pchev" aria-hidden="true"></span></summary>
    <div class="stgmenu" role="menu">
      <div class="stg-note">选一个进度：地图上那时不出现的事件变暗，点事件直接打开那时显示的那一页。</div>
      <button type="button" class="stg-all ${st ? '' : 'on'}" data-sseg="-1">不按进度，全部照常显示</button>
      ${ax.slots.length ? `<div class="seg stg-slots">${[['-1', '任何时段'], ...ax.slots.map((s, i) => [String(i), s])].map(([i, l]) => `<button type="button" data-sslot="${i}" class="${(st ? st.slot : -1) === Number(i) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="stg-list">${ax.segs.map((l, i) => `<button type="button" data-sseg="${i}" class="${st && st.seg === i ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <a href="#/progress" class="stg-link">看剧情进度时间线</a>
    </div></details>
    ${st ? `<span class="stg-step"><button type="button" class="quiet small" data-sstep="-1" aria-label="上一段" ${st.seg ? '' : 'disabled'}>‹</button><button type="button" class="quiet small" data-sstep="1" aria-label="下一段" ${st.seg < ax.segs.length - 1 ? '' : 'disabled'}>›</button></span>` : ''}`;
  const d = $('.stg', box);
  let slot = st ? st.slot : -1;
  $$('[data-sslot]', box).forEach(b => b.onclick = () => {
    slot = Number(b.dataset.sslot);
    $$('[data-sslot]', box).forEach(x => x.classList.toggle('on', x === b));
    if (S.stage) setStage({ seg: S.stage.seg, slot });
  });
  $$('[data-sseg]', box).forEach(b => b.onclick = () => { d.open = false; const i = Number(b.dataset.sseg); setStage(i < 0 ? null : { seg: i, slot }); });
  $$('[data-sstep]', box).forEach(b => b.onclick = () => setStage({ seg: S.stage.seg + Number(b.dataset.sstep), slot: S.stage.slot }));
  $('.stg-link', box).onclick = () => { d.open = false; };
}
document.addEventListener('click', e => { const d = $('.stg[open]'); if (d && !d.contains(e.target)) d.open = false; });

// 某个事件在选中的进度显示哪一页：{ p, s(1 一定 / 0 可能) }；不出现 = null；跟进度无关 = undefined
function stageCellOf(cells, evId) {
  if (!S.stage || !cells || !cells.axis || !cells.events) return undefined;
  const list = cells.events[evId];
  if (!list) return undefined;
  const n = Math.max(1, cells.axis.slots.length);
  const ks = cells.axis.slots.length && S.stage.slot < 0 ? Array.from({ length: n }, (_, i) => S.stage.seg * n + i) : [S.stage.seg * n + Math.max(0, S.stage.slot)];
  const hits = ks.map(k => list[k]).filter(Boolean);
  if (!hits.length) return null;
  const same = hits.every(h => h.p === hits[0].p);
  return { p: hits[0].p, s: same && hits.length === ks.length && hits.every(h => h.s) ? 1 : 0 };
}
// 这个事件在选中的进度有没有「这一天的剧情」：某一页只在少数几段出现、而且有台词 / 图 / 调用（跟后端 stageMaps 一样的算法）
//   有就返回那一页（地图上画它、点开也是它），没有返回 -1
function stageSpecific(cells, evId) {
  const list = cells && cells.events && cells.events[evId];
  if (!list || !S.stage) return -1;
  const nS = Math.max(1, cells.axis.slots.length);
  const story = cells.story[evId] || [];
  const slotList = cells.axis.slots.length && S.stage.slot < 0 ? Array.from({ length: nS }, (_, i) => i) : [Math.max(0, S.stage.slot)];
  for (const sl of slotList) {
    const cand = cells.axis.segs.map((_, s) => { const c = list[s * nS + sl]; return c ? c.c || [c.p] : []; });
    const p = cand[S.stage.seg].find(q => story[q] && cand.filter(l => l.includes(q)).length * 2 <= cand.length);
    if (p != null) return p;
  }
  return -1;
}
// 地图：拿这张图每个事件在每一段显示哪一页，再按选中的进度亮 / 暗
async function applyMapStage() {
  if (!ME) return;
  if (S.stage && progAxis() && !ME.stageCells) {
    const id = ME.id;
    try { const c = await api('progress/map?id=' + id); if (ME && ME.id === id) ME.stageCells = c; } catch { }
  }
  layoutEvents();
  const box = $('#stageNote');
  if (box) {
    const n = S.stage && ME.stageCells ? ME.m.events.filter(e => stageCellOf(ME.stageCells, e.id) === null).length : 0;
    box.innerHTML = S.stage ? `<span class="tag acc">进度：${esc(stageText())}</span>${n ? `<span class="dim">${n} 个事件这时不出现（变暗）</span>` : ''}<button type="button" class="linkbtn" id="stageOff">全部显示</button>` : '';
    box.hidden = !S.stage;
    if ($('#stageOff')) $('#stageOff').onclick = () => setStage(null);
  }
}

// ---------- 剧情进度页 ----------
//   #/progress          选天 → 选地图：地图上只画这一天（这一段）会出现的事件，点事件右边看 / 改，点空格子新建场景
//   #/progress/list     主线时间线（一长串，按段列新出现的剧情）
//   #/progress/t<变量>  某条支线的时间线
const PW = { map: null, sel: null, showOff: false, placing: null, order: null, orderOpen: (() => { try { return localStorage.getItem('studio.pworder') !== '0'; } catch { return true; } })() };
// 这一天的事件里，某张地图上的事件该标红（必要）还是标绿（支线），以及点开哪一页
function marksFor(mapId) {
  const out = new Map();
  for (const e of (PW.order && PW.order.entries) || []) {
    if (!e.at || e.at.type !== 'map' || e.at.map !== mapId) continue;
    const cur = out.get(e.at.ev);
    if (!cur || (e.required && cur.cls !== 'req')) out.set(e.at.ev, { cls: e.required ? 'req' : 'opt', page: e.at.page });
  }
  return out;
}
async function viewProgress(main, key) {
  main.innerHTML = '<div class="loading">正在整理剧情进度…</div>';
  await loadProgress(true);
  if (!PROG) throw new Error('读不到剧情进度');
  const m = PROG.config.main, tracks = PROG.config.tracks;
  const listMode = key === 'list' || /^t\d+$/.test(key || '');
  const tabs = [{ key: 'main', label: '主线' }, ...tracks.map(t => ({ key: 't' + t.var, label: t.label }))];
  const tkey = key && tabs.some(t => t.key === key) ? key : 'main';   // 支线被删掉了就回到主线
  const can = PROG.canConfigure;
  const noAxis = m.type === 'map';
  const tl = listMode && !(tkey === 'main' && noAxis) ? await api('progress/timeline?axis=' + enc(tkey)) : null;
  const varName = PROG.config.main.var ? (await lookup('var')).find(r => r.id === m.var) : null;
  const desc = (() => {
    if (listMode && tkey !== 'main') { const t = tracks.find(x => 't' + x.var === tkey); return t ? `支线：变量 ${t.var}「${esc(t.label)}」，按值分 ${t.steps.length} 步` : ''; }
    const vn = varName ? esc(varName.name || '') : '';
    if (m.type === 'day') return `按天：变量 ${m.var}「${vn}」是第几天${m.slots.length ? `，每天分 ${m.slots.map(s => esc(s.label)).join(' / ')}` : ''}`;
    if (m.type === 'chapter') return `按章节：变量 ${m.var}「${vn}」切成 ${m.segs.length} 段`;
    if (m.type === 'switches') return `按开关链：${m.chain.map(c => esc(c.label)).join(' → ')}`;
    return '按地图看，不分进度';
  })();
  main.innerHTML = `<div class="page progpage ${listMode ? '' : 'wsmode'}">
    <div class="titlebar"><h1>剧情进度</h1><span class="tag" title="这套分法是怎么来的">${PSOURCE[PROG.source] || ''}</span><span class="sp"></span>
      <button class="primary small" id="progNew">＋ 新建场景</button>
      ${noAxis ? '' : `<div class="seg" id="progView"><button data-pv="map" class="${listMode ? '' : 'on'}">地图</button><button data-pv="list" class="${listMode ? 'on' : ''}">列表</button></div>`}
      <button class="small" id="progSet">${can ? '设置' : '看设置'}</button></div>
    <div class="meta"><span>${desc}</span>${tl && tl.advances.length ? `<span>${tl.advances.length} 处用加减推进</span>` : ''}</div>
    ${listMode && tabs.length > 1 ? `<div class="pagetabs" role="tablist">${tabs.map(t => `<button role="tab" data-tk="${esc(t.key)}" class="${t.key === tkey ? 'on' : ''}">${esc(t.label)}${t.key === 'main' ? `<small>${PTYPE[m.type]}</small>` : ''}</button>`).join('')}</div>` : ''}
    <div id="tlBody"></div>
  </div>`;
  $$('[data-tk]', main).forEach(b => b.onclick = () => { location.hash = '#/progress/' + (b.dataset.tk === 'main' ? 'list' : b.dataset.tk); });
  $$('[data-pv]', main).forEach(b => b.onclick = () => { location.hash = b.dataset.pv === 'list' ? '#/progress/list' : '#/progress'; });
  $('#progSet').onclick = () => progressSettings();
  $('#progNew').onclick = () => sceneDialog({});
  const body = $('#tlBody');
  if (noAxis && listMode) {
    body.innerHTML = startCardHtml() || `<div class="empty">这个游戏没认出按天或者按章节推进的变量，现在按地图看。管理员可以在「设置」里选一个天数 / 进度变量。</div>`;
    bindStartCard(body);
    return;
  }
  if (listMode) {
    if (!tl || !tl.axis) { body.innerHTML = '<div class="empty">没有这条支线。</div>'; return; }
    body.innerHTML = timelineHtml(tl, tkey === 'main' ? m : null);
    bindFoldSec(body);
    return;
  }
  await drawWorkspace(body, noAxis);
}

// 地图工作台：左边选天（和时段），中间选地图、看地图，右边是点中的事件
async function drawWorkspace(body, noAxis) {
  const ax = progAxis();
  if (ax && !S.stage) { S.stage = { seg: 0, slot: -1 }; try { localStorage.setItem(stageKey(), JSON.stringify(S.stage)); } catch { } drawStagePick(); }
  body.innerHTML = `<div class="pw ${noAxis ? 'noaxis' : ''}">
    ${noAxis ? '' : `<aside class="pw-days" aria-label="选一天">
      ${ax.slots.length ? `<div class="pw-slots">${[[-1, '全天'], ...ax.slots.map((l, i) => [i, l])].map(([i, l]) => `<button data-pslot="${i}" class="${S.stage.slot === i ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="pw-daylist" id="pwDays"></div>
      <button type="button" class="small pw-addseg" id="pwAddSeg" ${PROG.canConfigure ? '' : 'disabled title="只有管理员能加"'}>＋ 新建${PROG.config.main.type === 'day' ? '一天' : '一章'}</button>
      <button type="button" class="small pw-addseg" id="pwPlay" title="跳过标题，进度直接设成选中的这一段，从右边这张地图开始">▶ 从这一段试玩</button>
    </aside>`}
    <section class="pw-main">
      ${noAxis ? startCardHtml() : ''}
      <div class="pw-maps" id="pwMaps"></div>
      <div class="pw-stage"><div class="pw-mapbox" id="pwMap"><div class="loading">正在读取地图…</div></div><aside class="pw-side" id="pwSide" hidden></aside></div>
      <div id="pwOff"></div>
    </section>
  </div>`;
  $$('[data-pslot]', body).forEach(b => b.onclick = () => setStage({ seg: S.stage.seg, slot: Number(b.dataset.pslot) }));
  if ($('#pwAddSeg', body)) $('#pwAddSeg', body).onclick = () => addSegDialog();
  if ($('#pwPlay', body)) $('#pwPlay', body).onclick = () => playFromStage();
  bindStartCard(body);
  await refreshWorkspace(true);
}
// ---------- 从零开始分阶段（还没有按天 / 按章节推进的游戏） ----------
function startCardHtml() {
  if (!PROG || !PROG.canConfigure) return '';
  return `<div class="pw-start">
    <div><b>这个游戏还没分阶段</b><span class="faint">现在按地图看。分好阶段以后，就能选「第几天 / 第几章」放剧情、看每一天的事件顺序。</span></div>
    <div class="pw-start-acts"><button type="button" class="primary small" data-pstart="day">按天分</button><button type="button" class="small" data-pstart="chapter">按章节分</button></div>
  </div>`;
}
function bindStartCard(root) { $$('[data-pstart]', root).forEach(b => b.onclick = () => startDialog(b.dataset.pstart)); }
// 一步建好：变量、第 1~N 天（章）、开局设成 1、时段开关、「过一天」场景
async function startDialog(type = 'day') {
  const vars = (await lookup('var')).filter(r => r.name);
  const st = { type, count: 3, useVar: 'new', varName: '', slots: false, opening: true, sleep: true };
  const r = await openDialog(`<header><h3>给游戏分阶段</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody startdlg">
      <div class="seg" id="sdType"><button type="button" data-st="day">按天</button><button type="button" data-st="chapter">按章节</button></div>
      <div class="fnote" id="sdTypeNote"></div>
      <div class="fgrid">
        <span id="sdVarLbl">记天数的变量</span>
        <div class="sdvar">
          <label class="radio"><input type="radio" name="sdv" value="new" checked> 新建一个，叫 <input id="sdVarName" maxlength="40" style="width:9em"></label>
          ${vars.length ? `<label class="radio"><input type="radio" name="sdv" value="old"> 用已有的 <select id="sdVarOld">${vars.map(v => `<option value="${v.id}">${v.id} ${esc(v.name)}</option>`).join('')}</select></label>` : ''}
        </div>
        <label for="sdCount" id="sdCountLbl">先建几天</label>
        <span class="ins" style="display:flex;gap:8px;align-items:center"><input id="sdCount" type="number" class="num" min="1" max="99" value="3" style="width:80px"><span class="faint" id="sdCountNote">以后在左边「＋ 新建一天」还能加</span></span>
      </div>
      <div class="sdopts">
        <label class="switch" id="sdSlotsRow"><input type="checkbox" id="sdSlots"><span>每天分白天 / 夜晚 <span class="faint">（新建「白天」「夜晚」两个开关，放剧情时可以选放在白天还是夜晚）</span></span></label>
        <label class="switch"><input type="checkbox" id="sdOpening" checked><span id="sdOpeningTxt"></span></label>
        <label class="switch" id="sdSleepRow"><input type="checkbox" id="sdSleep" checked><span>加一个「过一天」场景 <span class="faint">（淡出 → 天数 +1 → 淡入；建好后点地图上的一个格子把它放上去，比如床边）</span></span></label>
      </div>
      <div class="fnote" id="sdAfter"></div>
      ${PROG.config.main.type !== 'map' ? '<div class="warnline">现在已经有一套分法了，会被替换成新的（游戏里已有的事件不会动）。</div>' : ''}
      <div id="sdErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>建好</button></footer>`,
    (d, done) => {
      const draw = () => {
        const day = st.type === 'day';
        $$('[data-st]', d).forEach(b => b.classList.toggle('on', b.dataset.st === st.type));
        $('#sdTypeNote', d).textContent = day ? '一个变量记第几天：天数 = 1 是第 1 天，过一天加 1。' : '一个变量记第几章：主线进度 = 1 是第 1 章；每一章最后的剧情播完，把它设成下一章。';
        $('#sdVarLbl', d).textContent = day ? '记天数的变量' : '记章节的变量';
        const nm = $('#sdVarName', d);
        if (!st.varName || st.varName === '天数' || st.varName === '主线进度') nm.value = st.varName = day ? '天数' : '主线进度';
        $('#sdCountLbl', d).textContent = day ? '先建几天' : '先建几章';
        $('#sdCountNote', d).textContent = `以后在左边「＋ 新建${day ? '一天' : '一章'}」还能加`;
        $('#sdSlotsRow', d).hidden = !day; $('#sdSleepRow', d).hidden = !day;
        $('#sdOpeningTxt', d).innerHTML = `开局就是${day ? '第 1 天' : '第 1 章'} <span class="faint">（在开始地图放一个看不见的自动事件，新游戏开始时把变量设成 1，只跑一次）</span>`;
        $('#sdAfter', d).textContent = day
          ? '建好以后：左边选哪一天，点地图上的空格子就是在那一天放剧情。'
          : '建好以后：左边选哪一章，点地图上的空格子放剧情；每一章最后那段放的时候，「播完以后」选「推进到」下一章。';
      };
      $$('[data-st]', d).forEach(b => b.onclick = () => { st.type = b.dataset.st; draw(); });
      $('#sdVarName', d).oninput = e => { st.varName = e.target.value; $('[name=sdv][value=new]', d).checked = true; };
      if ($('#sdVarOld', d)) $('#sdVarOld', d).onchange = () => { $('[name=sdv][value=old]', d).checked = true; };
      draw();
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      $('[data-ok]', d).onclick = async () => {
        const day = st.type === 'day';
        const old = $('[name=sdv][value=old]', d) && $('[name=sdv][value=old]', d).checked;
        const body = { type: st.type, count: Number($('#sdCount', d).value), var: old ? Number($('#sdVarOld', d).value) : 'new', varName: $('#sdVarName', d).value.trim(),
          slots: day && $('#sdSlots', d).checked, opening: $('#sdOpening', d).checked, sleep: day && $('#sdSleep', d).checked };
        try { done(await api('progress/start', body)); } catch (e) { $('#sdErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (!r) return;
  S.lookups = {};
  await loadProgress(true);
  // 页面还是「没分阶段」的样子（没有左边的天数列）：直接记下第 1 天，下面整页重画
  S.stage = { seg: 0, slot: -1 };
  try { localStorage.setItem(stageKey(), JSON.stringify(S.stage)); } catch { }
  drawStagePick();
  await refreshMaps();
  const day = r.config.main.type === 'day';
  toast(`已经分好：${r.config.main.segs.length} ${day ? '天' : '章'}${r.opening ? '，开局就是第 1 ' + (day ? '天' : '章') : ''}`);
  // 「过一天」：接着放到地图上（每天都在、可以反复用）
  if (r.sleep) PW.placing = { id: r.sleep.id, name: r.sleep.name, st: { once: false, exact: false }, hint: '最后一步：在上面选好地图，点一个空格子放「过一天」（比如床边）。它每天都在，玩家去调查就过一天。' };
  if (route().name === 'progress') render(); else location.hash = '#/progress';
}

// 新建一天 / 一章：在主线最后加一段；玩家要怎么进来写在说明里（上一段放个场景「播完推进到」这一段）
async function addSegDialog() {
  const m = PROG.config.main, ax = progAxis();
  const day = m.type === 'day', chain = m.type === 'switches';
  const last = !chain ? m.segs[m.segs.length - 1] : null;
  const next = last ? last.from + 1 : 0;
  const sw = chain ? await lookup('switch') : [];
  const r = await openDialog(`<header><h3>新建${day ? '一天' : '一章'}</h3></header>
    <div class="dbody">
      <div class="fgrid">
        <label for="asLabel">名字</label><input id="asLabel" maxlength="30" placeholder="${day ? `第 ${next} 天` : chain ? `第 ${m.chain.length + 1} 章` : `第 ${m.segs.length} 章`}">
        ${day ? `<span>天数</span><span class="dim">${esc(ax.segs[ax.segs.length - 1])}的下一天：天数变量 = ${next}</span>`
          : chain ? `<label for="asSw">开关</label><select id="asSw"><option value="">新建一个开关「进入 …」</option>${options(sw, 0)}</select>`
          : `<label for="asFrom">进度变量</label><span class="ins" style="display:flex;gap:6px;align-items:center"><span class="dim">≥</span><input id="asFrom" type="number" class="num" style="width:100px" value="${next}"><span class="faint">（${esc(last.label)}从 ${last.from} 起）</span></span>`}
      </div>
      <div class="fnote">${day ? '玩家要能走到这一天：游戏里天数要能加到 ' + next + '（比如前一天晚上睡觉过一天）。也可以在前一天放一个场景，选「播完推进到」这一天。'
        : '玩家要能进这一章：在上一章放一个场景，选「播完推进到」这一章；或者在已有的事件里' + (chain ? '打开这个开关。' : '把进度变量设成这个值。')}</div>
      <div id="asErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>新建</button></footer>`,
    (d, done) => {
      $('#asLabel', d).focus();
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        const body = { label: $('#asLabel', d).value.trim() };
        if ($('#asFrom', d)) body.from = $('#asFrom', d).value;
        if ($('#asSw', d)) body.switch = $('#asSw', d).value;
        try { done(await api('progress/addseg', body)); } catch (e) { $('#asErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      $('#asLabel', d).onkeydown = e => { if (e.key === 'Enter') $('[data-ok]', d).click(); };
    });
  if (!r) return;
  S.lookups = {};
  await loadProgress(true);
  toast('已新建「' + progAxis().segs[r.seg] + '」');
  setStage({ seg: r.seg, slot: S.stage ? S.stage.slot : -1 });
  render();
}
// 换了天 / 时段 / 数据：重画天数列表、地图列表、地图上的事件、右边
async function refreshWorkspace(remount, dayChanged) {
  const ax = progAxis();
  const [st, order] = ax ? await Promise.all([api(`progress/stage?seg=${S.stage.seg}&slot=${S.stage.slot}`), api(`progress/day?seg=${S.stage.seg}&slot=${S.stage.slot}`)]) : [{ maps: [], segs: [] }, null];
  if (route().name !== 'progress' || !$('#pwMaps')) return;
  PW.order = order;
  const counts = new Map(st.maps.map(x => [x.id, x.n]));
  if (ax) {
    $('#pwDays').innerHTML = ax.segs.map((l, i) => `<button type="button" data-pseg="${i}" class="${S.stage.seg === i ? 'on' : ''}"><span>${esc(l)}</span>${st.segs[i] ? `<span class="pw-n">${st.segs[i]}</span>` : ''}</button>`).join('');
    $$('[data-pseg]').forEach(b => b.onclick = () => setStage({ seg: Number(b.dataset.pseg), slot: S.stage.slot }));
    $$('[data-pslot]').forEach(b => b.classList.toggle('on', Number(b.dataset.pslot) === S.stage.slot));
    const on = $(`[data-pseg="${S.stage.seg}"]`); if (on && remount) on.scrollIntoView({ block: 'nearest' });
  }
  // 地图：这一天有剧情的排前面；没选过就选剧情最多的那张
  const byId = new Map(S.maps.map(x => [x.id, x]));
  const withStory = st.maps.filter(x => x.n > 0 && byId.has(x.id)).sort((a, b) => b.n - a.n);
  try { if (PW.map == null) PW.map = Number(localStorage.getItem('studio.pwmap.' + stageKey())) || null; } catch { }
  if (!PW.map || !byId.has(PW.map)) PW.map = (withStory[0] || S.maps[0] || {}).id;
  // 换了一天：现在这张图这天没剧情、别的图有，就跳到剧情最多的那张
  if (dayChanged && !counts.get(PW.map) && withStory.length) { PW.map = withStory[0].id; PW.sel = null; remount = true; }
  const chip = (id, n) => `<button type="button" data-pmap="${id}" class="${id === PW.map ? 'on' : ''}">${esc((byId.get(id) || {}).name || '地图 ' + id)}${n ? `<span class="pw-n">${n}</span>` : ''}</button>`;
  const shown = withStory.slice(0, 10).map(x => x.id);
  if (PW.map && !shown.includes(PW.map)) shown.push(PW.map);
  $('#pwMaps').innerHTML = `${ax ? `<span class="dim pw-k">${esc(stageText())}有剧情的地图</span>` : ''}
    ${shown.map(id => chip(id, counts.get(id))).join('') || (ax ? '<span class="faint">这一天地图上没有新的剧情</span>' : '')}
    <select id="pwAll" aria-label="换一张地图"><option value="">其它地图…</option>${S.maps.map(x => `<option value="${x.id}">${x.id} ${esc(x.name)}${counts.get(x.id) ? '（' + counts.get(x.id) + '）' : ''}</option>`).join('')}</select>
    ${ax ? `<button type="button" id="pwOrderBtn" class="small pw-orderbtn ${PW.orderOpen ? 'on' : ''}">${esc(stageText())}的事件顺序${order && order.entries.length ? `<span class="pw-n">${order.entries.length}</span>` : ''}</button>` : ''}`;
  if ($('#pwOrderBtn')) $('#pwOrderBtn').onclick = () => { PW.orderOpen = !PW.orderOpen; try { localStorage.setItem('studio.pworder', PW.orderOpen ? '1' : '0'); } catch { } PW.sel = null; if (ME && ME.embed) { ME.embed.selected = null; layoutEvents(); } $('#pwOrderBtn').classList.toggle('on', PW.orderOpen); drawSide(); drawOffMap(); };
  $$('[data-pmap]').forEach(b => b.onclick = () => pickWorkspaceMap(Number(b.dataset.pmap)));
  $('#pwAll').onchange = e => { if (e.target.value) pickWorkspaceMap(Number(e.target.value)); };
  const mounted = typeof ME !== 'undefined' && ME && ME.embed && ME.id === PW.map && $('#pwMap .mapembed');
  if (remount || !mounted) await mountWorkspaceMap();
  else { ME.embed.selected = PW.sel && PW.sel.map === ME.id ? PW.sel.ev : null; ME.embed.marks = marksFor(ME.id); layoutEvents(); }
  if (PW.sel && PW.sel.map != null && PW.sel.map !== PW.map) PW.sel = null;
  drawSide();
  drawOffMap();
}
async function pickWorkspaceMap(id) {
  PW.map = id; PW.sel = null;
  try { localStorage.setItem('studio.pwmap.' + stageKey(), String(id)); } catch { }
  await refreshWorkspace(true);
}
async function mountWorkspaceMap() {
  const box = $('#pwMap');
  if (!box || !PW.map) return;
  await viewMap(box, PW.map, 'events', {
    embed: true, showOff: PW.showOff, selected: PW.sel ? PW.sel.ev : null, marks: marksFor(PW.map),
    tools: `<span class="sp" style="flex:1"></span>${progAxis() ? `<label class="pw-tog"><input type="checkbox" id="pwShowOff" ${PW.showOff ? 'checked' : ''}> 也画这时不在的事件</label>` : ''}<label class="pw-tog"><input type="checkbox" id="pwLbl" ${S.labels ? 'checked' : ''}> 事件名</label><a class="small" href="#/map/${PW.map}">去地图页</a>`,
    onTools: box2 => {
      if ($('#pwShowOff', box2)) $('#pwShowOff', box2).onchange = e => { PW.showOff = e.target.checked; ME.embed.showOff = PW.showOff; layoutEvents(); };
      $('#pwLbl', box2).onchange = e => { S.labels = e.target.checked; remember(); $('#board').classList.toggle('labels', S.labels); };
    },
    onEvent: (e, page) => { PW.sel = { map: PW.map, ev: e.id, page }; ME.embed.selected = e.id; layoutEvents(); showWorkspaceEvent(e.id, page); },
    onEmpty: p => {
      const place = { map: PW.map, x: p.x, y: p.y, seg: S.stage ? S.stage.seg : null, slot: S.stage ? S.stage.slot : -1 };
      if (PW.placing) sceneDialog({ sceneId: PW.placing.id, sceneName: PW.placing.name, place }, PW.placing.st ? { name: '', text: '', trigger: 0, once: true, exact: true, image: null, advanceTo: '', ...PW.placing.st } : null);
      else sceneDialog({ place });
    },
  });
  if (PW.placing) $('#pwMaps').insertAdjacentHTML('afterbegin', `<div class="warnline pw-placing">${PW.placing.hint ? esc(PW.placing.hint) : `点地图上的空格子，把场景「${esc(PW.placing.name)}」放在${esc(stageText())}。`}<button type="button" class="linkbtn" id="pwStopPlace">不放了</button></div>`);
  if ($('#pwStopPlace')) $('#pwStopPlace').onclick = () => { PW.placing = null; refreshWorkspace(false); };
}
function hideWorkspaceSide() { const s = $('#pwSide'); if (s) { s.hidden = true; s.innerHTML = ''; s.parentElement.classList.remove('withside'); } }
// 右边：点中了事件就显示事件；没点中、开着「事件顺序」就显示这一天的事件顺序
function drawSide() {
  if (PW.sel && PW.sel.ce) return showWorkspaceCe(PW.sel.ce, PW.sel.label || '');
  if (PW.sel && PW.sel.map === PW.map) return showWorkspaceEvent(PW.sel.ev, null);
  if (PW.orderOpen && PW.order) return showOrder();
  hideWorkspaceSide();
}
const backToOrder = () => (PW.orderOpen && PW.order ? '<button type="button" class="quiet small" id="pwBack">← 事件顺序</button>' : '');
function bindBack(side) {
  if ($('#pwBack', side)) $('#pwBack', side).onclick = () => { PW.sel = null; if (ME && ME.embed) { ME.embed.selected = null; layoutEvents(); } drawSide(); };
}
// 这一天（这一段）的事件顺序：按时段分组，必要的标红、支线标绿，条件只留进度以外的
function showOrder() {
  const side = $('#pwSide');
  if (!side) return;
  side.hidden = false;
  side.parentElement.classList.add('withside');
  const o = PW.order, ax = progAxis();
  const groups = new Map();
  for (const e of o.entries) { const k = e.slots ? e.slots[0] : -1; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const short = w => w.replace(/^地图 \d+「([^」]*)」 · /, '$1 · ').replace(/^公共事件 (\d+)「([^」]*)」/, '公共事件 $1「$2」');
  const item = (e, i) => `<div class="po-item ${e.required ? 'req' : 'opt'}" data-poi="${i}">
      <span class="po-dot" aria-hidden="true"></span>
      <div class="po-m">
        <div class="po-w">${e.kind === 'branch' ? `<span class="tle-if">如果 ${esc(e.cond)}</span> ` : ''}${esc(short(e.where))}</div>
        ${e.first ? `<div class="po-t">${esc(e.first)}</div>` : ''}
        <div class="po-c">${e.required ? `<span class="po-why">${esc(e.adv || (e.trigger === 4 ? '并行处理' : '一进地图自动播'))}</span>` : '<span class="po-why opt">自己去找</span>'}${e.conds && e.conds.length ? `<span>需要：${e.conds.map(linkify).join('，')}</span>` : ''}</div>
      </div>
      <button type="button" class="small" data-pod="${i}">查看详情</button></div>`;
  const all = o.entries;
  side.innerHTML = `<div class="pw-sh"><b>${esc(stageText())}的事件顺序</b><span class="sp"></span><button type="button" class="quiet small" id="pwOrderX" aria-label="收起">收起</button></div>
    <div class="po-legend"><span><span class="po-dot req"></span>必要：一进地图自动播，或者会推进剧情</span><span><span class="po-dot opt"></span>支线：要自己去找、可以不看</span></div>
    ${all.length ? [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([k, list]) => `<div class="po-group"><div class="po-gh">${k < 0 ? (ax && ax.slots.length ? '全天' : '') : esc(ax.slots[k])}</div>${list.map(e => item(e, all.indexOf(e))).join('')}</div>`).join('')
      : `<div class="empty">${esc(stageText())}没有专门的剧情。点地图上的空格子可以新建一个场景。</div>`}`;
  $('#pwOrderX').onclick = () => { PW.orderOpen = false; try { localStorage.setItem('studio.pworder', '0'); } catch { } if ($('#pwOrderBtn')) $('#pwOrderBtn').classList.remove('on'); hideWorkspaceSide(); drawOffMap(); };
  $$('[data-pod]', side).forEach(b => b.onclick = () => openOrderItem(all[Number(b.dataset.pod)]));
  $$('.po-item', side).forEach(el => el.ondblclick = () => openOrderItem(all[Number(el.dataset.poi)]));
}
// 查看详情：在地图上显示（换到那张地图、选中那个事件），右边看这一页
async function openOrderItem(e) {
  if (e.at.type === 'ce') { PW.sel = { ce: e.at.ce, label: e.kind === 'branch' ? '如果 ' + e.cond : '' }; drawSide(); return; }
  PW.sel = { map: e.at.map, ev: e.at.ev, page: e.at.page };
  if (e.at.map !== PW.map) { PW.map = e.at.map; try { localStorage.setItem('studio.pwmap.' + stageKey(), String(PW.map)); } catch { } await refreshWorkspace(true); }
  else { if (ME && ME.embed) { ME.embed.selected = e.at.ev; layoutEvents(); } drawSide(); }
  const b = $(`.evbtn[data-ev="${e.at.ev}"]`);
  if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// 公共事件里的剧情（按天派发的分支等）：右边直接看 / 改
async function showWorkspaceCe(id, label) {
  const side = $('#pwSide');
  if (!side) return;
  side.hidden = false;
  side.parentElement.classList.add('withside');
  side.innerHTML = '<div class="loading">正在读取公共事件…</div>';
  let c;
  try { c = await api('ce?id=' + id); } catch (err) { side.innerHTML = `<div class="err">${esc(err.message)}</div>`; return; }
  if (!PW.sel || PW.sel.ce !== id) return;
  side.innerHTML = `<div class="pw-sh">${backToOrder()}<b><span class="faint num">公共事件 ${c.id}</span> ${esc(c.name)}</b><span class="sp"></span><a class="small" href="#/ce/${id}">打开</a></div>
    ${label ? `<div class="pw-when"><span class="wk">这段</span><span class="tle-if">${esc(label)}</span><span class="wk">开始</span><span>${linkify(c.triggerText)}</span></div>` : ''}
    <div id="pwBody"></div>`;
  bindBack(side);
  pageBody($('#pwBody'), c, { type: 'ce', ce: id });
}
// 右边：点中的事件这时显示的那一页（看 / 改台词 / 在选项里关联场景），可以切到别的页
async function showWorkspaceEvent(evId, page) {
  const side = $('#pwSide');
  if (!side) return;
  side.hidden = false;
  side.parentElement.classList.add('withside');
  side.innerHTML = '<div class="loading">正在读取事件…</div>';
  let ev;
  try { ev = await api(`event?map=${PW.map}&ev=${evId}`); } catch (e) { side.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!$('#pwSide') || !PW.sel || PW.sel.ev !== evId) return;
  if (page == null || !(page >= 0 && page < ev.pages.length)) {
    const has = typeof ME !== 'undefined' && ME && ME.stageCells;
    const cell = has ? stageCellOf(ME.stageCells, evId) : null, sp = has ? stageSpecific(ME.stageCells, evId) : -1;
    const mk = marksFor(PW.map).get(evId);
    page = PW.sel.page != null && PW.sel.page < ev.pages.length ? PW.sel.page : mk ? mk.page : sp >= 0 ? sp : cell ? cell.p : 0;
  }
  PW.sel.page = page;
  const pg = ev.pages[page];
  const at = { type: 'map', map: PW.map, ev: evId, page };
  side.innerHTML = `<div class="pw-sh">${backToOrder()}<b><span class="faint num">事件 ${ev.id}</span> ${esc(ev.name)}</b><span class="sp"></span>
      <a class="small" href="#/event/${PW.map}/${evId}/${page}">打开事件页</a><button type="button" class="quiet small" id="pwClose" aria-label="关闭">关闭</button></div>
    ${ev.pages.length > 1 ? `<div class="pw-pages">${ev.pages.map((p, i) => `<button type="button" data-ppg="${i}" class="${i === page ? 'on' : ''}" title="${esc(ev.stages && ev.stages[i] ? ev.stages[i].text : '')}">第 ${i + 1} 页</button>`).join('')}</div>` : ''}
    <div class="pw-when"><span class="wk">出现</span><span>${pg.conditionText.length ? pg.conditionText.map(linkify).join('，') : '一直出现'}</span>
      ${ev.stages && ev.stages[page] ? `<span class="wk">进度</span><span>${esc(ev.stages[page].text)}${ev.stages[page].sure === false ? '<span class="faint">（还要看别的条件）</span>' : ''}</span>` : ''}
      <span class="wk">触发</span><span>${esc(pg.triggerText)}</span></div>
    <div id="pwBody"></div>`;
  $('#pwClose').onclick = () => { PW.sel = null; if (ME && ME.embed) { ME.embed.selected = null; layoutEvents(); } drawSide(); };
  bindBack(side);
  $$('[data-ppg]', side).forEach(b => b.onclick = () => { PW.sel.page = Number(b.dataset.ppg); showWorkspaceEvent(evId, PW.sel.page); });
  // 这一页只是播一个场景（放到地图上的）：直接显示场景的台词，在这里就能改
  const calls = pg.outline.filter(o => o.code === 117), rest = pg.outline.filter(o => ![117, 123, 0, 108].includes(o.code));
  const sid = calls.length === 1 && !rest.length ? Number((/公共事件 (\d+)/.exec(calls[0].text || '') || [])[1]) : 0;
  if (sid) {
    try {
      const c = await api('ce?id=' + sid);
      if (c.isScene && $('#pwBody')) {
        $('#pwBody').insertAdjacentHTML('beforebegin', `<div class="pw-scene"><span class="tag acc">场景</span><b>${esc(c.name)}</b><span class="faint">这一页播这个场景，改台词就是改场景本身</span><a class="small" href="#/ce/${sid}">场景页</a></div>`);
        pageBody($('#pwBody'), c, { type: 'ce', ce: sid });
        return;
      }
    } catch { }
  }
  pageBody($('#pwBody'), pg, at);
}
// 这一天不在地图上的剧情：公共事件里「如果 天数 = 3」这种按天派发的分支
async function drawOffMap() {
  const box = $('#pwOff');
  if (!box) return;
  if (!progAxis() || PW.orderOpen) { box.innerHTML = ''; return; }   // 开着「事件顺序」时那里已经列了
  let tl;
  try { tl = await api('progress/timeline?axis=main'); } catch { box.innerHTML = ''; return; }
  if (route().name !== 'progress' || !$('#pwOff')) return;
  const seg = tl.segs[S.stage.seg];
  const list = seg ? seg.entries.filter(e => e.at.type !== 'map' && (S.stage.slot < 0 || !e.slots || e.slots.includes(S.stage.slot))) : [];
  box.innerHTML = list.length ? `<div class="section"><h2>这时还会播的（不在地图上）</h2><span class="dim">公共事件里按${PROG.config.main.type === 'day' ? '天' : '段'}分的剧情</span></div>
    <div class="tlents">${list.map(e => tlEntry(e, tl, S.stage.seg, false)).join('')}</div>` : '';
}

// ---------- 时间线（列表） ----------
function shortWhere(w) {
  const parts = String(w || '').split(' · ');
  if (parts.length < 2) return esc(w);
  return `<span class="faint">${esc(parts[0].replace(/^地图 \d+「(.*)」$/, '$1'))}</span> ${esc(parts.slice(1).join(' · '))}`;
}
function tlEntry(e, tl, i, grid) {
  const segs = tl.segs, nS = tl.axis.slots.length;
  const until = e.to === -1 ? '一直到最后' : e.to != null && e.to !== i ? '到' + (/^[\d-]/.test(segs[e.to].label) ? ' ' : '') + segs[e.to].label : '';
  // 支线里「如果 某变量 ≠ 0」的变量就是这条支线，写成「值」短一点
  const cond = e.cond && tl.axis.type === 'track' && tl.axis.varName && e.cond.startsWith(tl.axis.varName + ' ') ? '值' + e.cond.slice(tl.axis.varName.length) : e.cond;
  const slotTag = e.slots ? e.slots.map(s => tl.axis.slots[s]).join(' / ') : '';
  // 在格子里摆：全天的占满一行，只在一个时段的放那一列，连着几个时段的横跨过去
  let style = '', narrow = false;
  if (grid) {
    if (!e.slots) style = 'grid-column:1/-1';
    else { const a = e.slots[0], b = e.slots[e.slots.length - 1], end = (b - a + 1 === e.slots.length ? b : a) + 2; style = `grid-column:${a + 1}/${end}`; narrow = end - a - 1 < nS - 1 || nS > 2 && end - a - 1 < 2; }
  }
  const meta = [until, e.lines ? e.lines + ' 句' : '', e.pics ? e.pics + ' 张图' : '', e.calls && !e.lines ? '调用 ' + e.calls + ' 个公共事件' : ''].filter(Boolean).join(' · ');
  return `<a class="tle ${e.sure ? '' : 'maybe'} ${narrow ? 'narrow' : ''}" href="${hrefOf(e.at)}" style="${style}" title="${esc(e.where)}${e.sure ? '' : '\n还要看别的条件（独立开关、别的开关……），不一定出现'}">
    <span class="tle-w">${e.trigger >= 3 ? '<span class="dot auto" title="自动执行"></span>' : ''}${e.kind === 'branch' ? `<span class="tle-if">如果 ${esc(cond)}</span>` : ''}<span class="tle-p">${shortWhere(e.where)}</span></span>
    ${e.first ? `<span class="tle-t">${esc(e.first)}</span>` : ''}
    <span class="tle-m">${slotTag && nS ? `<span class="tle-slot">${esc(slotTag)}</span>` : ''}${esc(meta)}${e.sure ? '' : '<span class="tle-q">不一定</span>'}</span></a>`;
}
function timelineHtml(tl, m) {
  const nS = tl.axis.slots.length, grid = nS > 1;
  // 支线的段名一般就是值：只在段名不是值、或者一段包含好几个值时写出范围
  const cond = i => {
    if (m) return segCond(m, i, tl.axis.varName);
    const s = tl.segs[i], next = tl.segs[i + 1];
    const r = !next ? `≥ ${s.from}` : next.from === s.from + 1 ? `= ${s.from}` : `${s.from}~${next.from - 1}`;
    return r === '= ' + s.label ? '' : '值 ' + r;
  };
  const out = [];
  if (grid) out.push(`<div class="tlcols" aria-hidden="true"><span></span><div style="grid-template-columns:repeat(${nS},minmax(0,1fr))">${tl.axis.slots.map(s => `<span>${esc(s)}</span>`).join('')}</div></div>`);
  let gap = [];
  const flushGap = () => {
    if (!gap.length) return;
    const a = tl.segs[gap[0]].label, b = tl.segs[gap[gap.length - 1]].label;
    out.push(`<div class="tlgap"><span class="tlgap-l">${esc(gap.length > 1 ? a + ' ~ ' + b : a)}</span><span class="faint">没有新的剧情</span></div>`);
    gap = [];
  };
  tl.segs.forEach((s, i) => {
    if (!s.entries.length && !s.advances.length) { gap.push(i); return; }
    flushGap();
    const order = (a, b) => (a.slots ? a.slots[0] + 1 : 0) - (b.slots ? b.slots[0] + 1 : 0);
    const list = grid ? [...s.entries].sort(order) : s.entries;
    out.push(`<section class="tlseg ${S.stage && S.stage.seg === i ? 'here' : ''}" data-seg="${i}">
      <div class="tlhead"><h3>${esc(s.label)}</h3><span class="faint">${esc(cond(i))}</span>${s.entries.length ? `<span class="dim">${s.entries.length} 条新的${s.lines ? ' · ' + s.lines + ' 句' : ''}</span>` : ''}</div>
      <div class="tlbody">
        ${s.advances.length ? `<div class="tladv"><span class="k">从这里进来</span>${s.advances.slice(0, 4).map(a => `<a href="${hrefOf(a.at)}">${esc(a.text)}<span class="faint"> · </span>${shortWhere(a.where)}</a>`).join('')}${s.advances.length > 4 ? `<span class="faint">还有 ${s.advances.length - 4} 处</span>` : ''}</div>` : ''}
        ${list.length ? `<div class="tlents ${grid ? 'grid' : ''}" ${grid ? `style="grid-template-columns:repeat(${nS},minmax(0,1fr))"` : ''}>${list.map(e => tlEntry(e, tl, i, grid)).join('')}</div>` : ''}
      </div></section>`);
  });
  flushGap();
  const day = tl.axis.type === 'day';
  let html = `<div class="tl ${grid ? 'withcols' : ''}">${out.join('')}</div>`;
  if (tl.always.length) html += foldSec('tl-always', day ? '每天都有的' : '每一段都有的', `${tl.always.length} 条：跟进度无关、或者在每一段都会出现（比如只看时段的）`, `<div class="tlents plain">${capped(tl.always.map(e => tlEntry(e, tl, -1, false)), 30)}</div>`);
  if (tl.advances.length) html += foldSec('tl-adv', '用加减推进的地方', `${tl.advances.length} 处，推进到哪一段要看运行时的值`, `<div class="card rows">${tl.advances.map(a => `<a class="rowlink" href="${hrefOf(a.at)}"><span>${shortWhere(a.where)}</span><span class="r">${esc(a.text)}</span></a>`).join('')}</div>`);
  html += `<p class="fnote" style="margin-top:18px">每一条只在它第一次出现的那一段列出来，后面写着到哪一段为止。「不一定」= 除了进度还要看别的条件。点一条打开那一页。</p>`;
  return html;
}

// ---------- 设置弹窗 ----------
async function progressSettings() {
  const P = await loadProgress(true);
  if (!P) return;
  const can = P.canConfigure;
  const [vr, sw] = await Promise.all([lookup('var'), lookup('switch')]);
  const cur = JSON.parse(JSON.stringify(P.config));
  const st = { type: cur.main.type, var: cur.main.var || (P.candidates[0] && P.candidates[0].var) || 0, segs: cur.main.segs || [], slots: cur.main.slots || [], chain: cur.main.chain || [], tracks: cur.tracks };
  if (st.type !== 'day' && !st.slots.length) st.slots = P.slotCandidates.slice(0, 4).map(s => ({ switch: s.switch, label: s.name }));
  if (!st.chain.length) st.chain = P.chainCandidates.map(c => ({ switch: c.switch, label: c.name }));
  const candIds = new Set(P.candidates.map(c => c.var));
  const varOpts = sel => `${P.candidates.length ? `<optgroup label="看起来像进度的">${P.candidates.map(c => `<option value="${c.var}" ${Number(sel) === c.var ? 'selected' : ''}>${c.var} ${esc(c.name)}（${c.min}~${c.max}）</option>`).join('')}</optgroup>` : ''}
    <optgroup label="全部变量">${vr.filter(r => !candIds.has(r.id)).map(r => `<option value="${r.id}" ${Number(sel) === r.id ? 'selected' : ''}>${r.id} ${esc(r.name || '')}</option>`).join('')}</optgroup>`;
  const swOpts = sel => options(sw, sel);
  const dis = can ? '' : 'disabled';
  const r = await openDialog(`<header><h3>剧情进度怎么分</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody progset">
      <div class="fnote">只影响「剧情进度」页、顶栏的进度和地图亮暗，不改游戏数据。</div>
      <div class="csec"><span class="csec-t">主线</span><span class="faint">一次选一种</span></div>
      <div class="seg" id="psType">${Object.entries(PTYPE).map(([k, l]) => `<button type="button" data-pt="${k}" ${dis}>${l}</button>`).join('')}</div>
      <div class="fnote" id="psTypeNote"></div>
      <div id="psMain"></div>
      <div class="csec"><span class="csec-t">支线</span><span class="faint">每条一个进度变量，几条都行</span></div>
      <div id="psTracks"></div>
      ${can ? '' : '<div class="locked">只有管理员能改进度设置。</div>'}
      <div id="psErr"></div>
    </div>
    <footer>${can && P.source === 'saved' ? '<button class="quiet" data-reset>回到自动识别</button>' : ''}${can ? '<button class="quiet" data-restart>从零开始…</button>' : ''}<span class="sp"></span><button data-x>取消</button>${can ? '<button class="primary" data-ok>保存</button>' : ''}</footer>`,
    (d, done) => {
      const NOTE = { day: '一个变量记第几天（每过一天加 1），可以再用几个开关分时段（白天 / 夜晚……）。', chapter: '一个进度变量，剧情推进时设成更大的值；按它的值切成几段。', switches: '一串开关，开一个算进下一章（第一章完成、第二章完成……）。', map: '不分进度，按地图一张张看。' };
      const err = msg => { $('#psErr', d).innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : ''; };
      // 从界面上读回 st（换类型 / 加行之前先收一遍，免得改的字丢了）
      const collect = () => {
        const v = $('#psVar', d); if (v) st.var = Number(v.value);
        if ($('#psSlots', d)) st.slots = $$('#psSlots .psrow', d).map(r => ({ switch: Number($('select', r).value), label: $('input', r).value.trim() }));
        if ($('#psSegs', d)) st.segs = $$('#psSegs .psrow', d).map(r => ({ from: Number($('input[type=number]', r).value), label: $('input:not([type=number])', r).value.trim() }));
        if ($('#psChain', d)) st.chain = $$('#psChain .psrow', d).map(r => ({ switch: Number($('select', r).value), label: $('input', r).value.trim() }));
        st.tracks = $$('#psTracks .psrow', d).map(r => {
          const id = Number($('select', r).value), old = st.tracks.find(t => t.var === id);
          return { var: id, label: $('input', r).value.trim(), ...(old && old.steps ? { steps: old.steps } : {}) };
        });
      };
      const rowDel = `<button type="button" class="quiet small psdel" aria-label="去掉这一行" ${dis}>去掉</button>`;
      const drawMain = () => {
        $$('[data-pt]', d).forEach(b => b.classList.toggle('on', b.dataset.pt === st.type));
        $('#psTypeNote', d).textContent = NOTE[st.type];
        const box = $('#psMain', d);
        if (st.type === 'map') { box.innerHTML = ''; return; }
        if (st.type === 'switches') {
          box.innerHTML = `<div class="pslist" id="psChain">${st.chain.map(c => `<div class="psrow"><select aria-label="开关" ${dis}>${swOpts(c.switch)}</select><input value="${esc(c.label)}" placeholder="这一段叫什么" maxlength="30" ${dis}>${rowDel}</div>`).join('')}</div>
            <button type="button" class="small" id="psAddChain" ${dis}>＋ 加一个开关</button>${P.chainCandidates.length ? '' : '<div class="fnote">没找到名字像「第 N 章」的开关，自己选几个。</div>'}`;
          $('#psAddChain', d).onclick = () => { collect(); st.chain.push({ switch: 1, label: '' }); drawMain(); };
        } else {
          const day = st.type === 'day';
          box.innerHTML = `<div class="fgrid"><label for="psVar">${day ? '天数变量' : '进度变量'}</label><select id="psVar" ${dis}>${varOpts(st.var)}</select></div>
            ${day ? `<div class="pssub">每天的时段 <span class="faint">（页条件里用来分白天 / 夜晚的开关，不分就空着）</span></div>
              <div class="pslist" id="psSlots">${st.slots.map(s => `<div class="psrow"><select aria-label="开关" ${dis}>${swOpts(s.switch)}</select><input value="${esc(s.label)}" placeholder="时段名字" maxlength="20" ${dis}>${rowDel}</div>`).join('')}</div>
              <button type="button" class="small" id="psAddSlot" ${dis}>＋ 加一个时段</button>` : ''}
            <details class="cmore" ${day ? '' : 'open'}><summary>${day ? '每一天的名字' : '怎么切段'}（${st.segs.length} 段）</summary>
              <div class="fnote">从这个值起算这一段，到下一段的值为止。</div>
              <div class="pslist" id="psSegs">${st.segs.map(s => `<div class="psrow seg2"><span class="faint">≥</span><input type="number" class="num" value="${s.from}" aria-label="从这个值起" ${dis}><input value="${esc(s.label)}" placeholder="这一段叫什么" maxlength="30" ${dis}>${rowDel}</div>`).join('')}</div>
              <button type="button" class="small" id="psAddSeg" ${dis}>＋ 加一段</button>
            </details>`;
          $('#psVar', d).onchange = async () => { collect(); await resetSegs(); drawMain(); };
          if ($('#psAddSlot', d)) $('#psAddSlot', d).onclick = () => { collect(); st.slots.push({ switch: 1, label: '' }); drawMain(); };
          $('#psAddSeg', d).onclick = () => { collect(); const last = st.segs[st.segs.length - 1]; st.segs.push({ from: last ? last.from + 1 : 0, label: '' }); drawMain(); $('#psSegs .psrow:last-child input:not([type=number])', d).focus(); };
        }
        bindDel(box);
      };
      const resetSegs = async () => {
        if (st.type !== 'day' && st.type !== 'chapter') return;
        try { const x = await api(`progress/setup?type=${st.type}&var=${st.var}`); st.segs = x.main.segs; } catch (e) { err(e.message); }
      };
      const drawTracks = () => {
        $('#psTracks', d).innerHTML = `<div class="pslist">${st.tracks.map(t => `<div class="psrow"><select aria-label="变量" ${dis}>${varOpts(t.var)}</select><input value="${esc(t.label)}" placeholder="支线名字" maxlength="30" ${dis}>${rowDel}</div>`).join('')}</div>
          <button type="button" class="small" id="psAddTrack" ${dis}>＋ 加一条支线</button>`;
        $('#psAddTrack', d).onclick = () => {
          collect();
          const used = new Set([st.var, ...st.tracks.map(t => t.var)]);
          const c = P.candidates.find(x => !used.has(x.var));
          const free = vr.find(x => !used.has(x.id) && x.name) || { id: 1, name: '' };
          st.tracks.push(c ? { var: c.var, label: c.name } : { var: free.id, label: free.name });
          drawTracks();
        };
        bindDel($('#psTracks', d));
      };
      // 每一行：「去掉」；换了开关 / 变量时，名字还是空的或者是原来那个的名字，就跟着换
      const optName = sel => (sel.selectedOptions[0] ? sel.selectedOptions[0].text : '').replace(/^\d+\s*/, '').replace(/（[^）]*）$/, '');
      const bindDel = box => {
        $$('.psdel', box).forEach(b => b.onclick = () => { b.closest('.psrow').remove(); });
        $$('.psrow', box).forEach(r => {
          const sel = $('select', r), inp = $('input:not([type=number])', r);
          if (!sel || !inp || sel.id === 'psVar') return;
          let prev = optName(sel);
          sel.addEventListener('change', () => { if (!inp.value.trim() || inp.value.trim() === prev) inp.value = optName(sel); prev = optName(sel); });
        });
      };
      $$('[data-pt]', d).forEach(b => b.onclick = async () => {
        collect();
        const t = b.dataset.pt;
        if (t === st.type) return;
        st.type = t;
        if ((t === 'day' || t === 'chapter') && !st.var) st.var = (P.candidates[0] && P.candidates[0].var) || 1;
        await resetSegs();
        drawMain();
      });
      drawMain(); drawTracks();
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const send = async body => { try { await api('progress/config', body); done(true); } catch (e) { err(e.message); } };
      if ($('[data-reset]', d)) $('[data-reset]', d).onclick = () => send({ reset: true });
      if ($('[data-restart]', d)) $('[data-restart]', d).onclick = () => { done(null); setTimeout(() => startDialog(st.type === 'chapter' ? 'chapter' : 'day'), 0); };
      if ($('[data-ok]', d)) $('[data-ok]', d).onclick = () => {
        collect(); err('');
        const main = { type: st.type };
        if (st.type === 'day' || st.type === 'chapter') {
          if (!st.segs.length) return err('至少要有一段');
          Object.assign(main, { var: st.var, segs: st.segs.map(s => ({ from: s.from, label: s.label || '≥ ' + s.from })), slots: st.type === 'day' ? st.slots.filter(s => s.switch) : [] });
        } else if (st.type === 'switches') {
          if (!st.chain.length) return err('开关链至少要一个开关');
          main.chain = st.chain.map(c => ({ switch: c.switch, label: c.label }));
        }
        send({ main, tracks: st.tracks.filter(t => t.var && t.var !== main.var) });
      };
    });
  if (r) { toast('已保存进度设置'); await loadProgress(true); if (route().name === 'progress') render(); }
}

// ---------- 改条件弹窗里：放在第几天 / 第几章 ----------
// 页条件只能写「变量 ≥ 值」：放在第 3 天 = 第 3 天起都出现，直到后面的页盖过它
function stagePlaceHtml() {
  const m = PROG && PROG.config.main;
  if (!m || m.type === 'map') return '';
  const ax = progAxis();
  return `<div class="cstage"><span class="dim">按进度放</span>
    <select id="cpSeg" aria-label="放在哪一段">${ax.segs.map((l, i) => `<option value="${i}" ${S.stage && S.stage.seg === i ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${ax.slots.length ? `<select id="cpSlot" aria-label="时段"><option value="-1">任何时段</option>${ax.slots.map((l, i) => `<option value="${i}" ${S.stage && S.stage.slot === i ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
    <button type="button" class="small" id="cpGo">填进条件</button>
    <span class="faint cpnote">${m.type === 'switches' ? '用链上的开关' : '页条件只能写「≥」：放在某一段 = 从那段起都出现，直到后面的页盖过它'}</span></div>`;
}
// d = 弹窗，showRow / syncRows 是条件弹窗里的
function bindStagePlace(d, showRow, syncRows) {
  const go = $('#cpGo', d);
  if (!go) return;
  const m = PROG.config.main;
  go.onclick = () => {
    const seg = Number($('#cpSeg', d).value), slot = $('#cpSlot', d) ? Number($('#cpSlot', d).value) : -1;
    const keySw = new Set(m.type === 'switches' ? m.chain.map(c => c.switch) : (m.slots || []).map(s => s.switch));
    const want = m.type === 'switches' ? (seg > 0 ? m.chain[seg - 1].switch : 0) : slot >= 0 ? m.slots[slot].switch : 0;
    // 开关：先拿掉原来的时段 / 链上的开关，再把要的放进空着的那一格
    const slots = ['switch1', 'switch2'];
    for (const k of slots) if ($('#c_' + k, d).checked && keySw.has(Number($('#v_' + k, d).value))) { $('#c_' + k, d).checked = false; $(`[data-row="${k}"]`, d).hidden = true; }
    if (want) {
      const k = slots.find(x => !$('#c_' + x, d).checked) || 'switch2';
      $('#v_' + k, d).value = String(want); showRow(k);
    }
    if (m.type !== 'switches') { $('#v_variable', d).value = String(m.var); $('#v_value', d).value = String(m.segs[seg].from); showRow('variable'); }
    syncRows();
    toast('已按「' + progAxis().segs[seg] + (slot >= 0 ? ' · ' + m.slots[slot].label : '') + '」填好条件，保存后生效');
  };
}
