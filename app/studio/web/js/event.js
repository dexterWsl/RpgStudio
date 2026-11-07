'use strict';
// 事件：事件页（出现条件、阅读视图的折叠、改台词）、改条件弹窗
// ---------- 事件 ----------
async function viewEvent(main, mapId, evId, pageIndex) {
  revealMap(mapId);
  main.innerHTML = '<div class="loading">正在读取事件…</div>';
  const ev = await api(`event?map=${mapId}&ev=${evId}`);
  if (!(pageIndex >= 0 && pageIndex < ev.pages.length)) pageIndex = 0;
  const pg = ev.pages[pageIndex];
  const selfTxt = Object.entries(ev.selfSwitches).map(([ch, list]) => `独立开关 ${ch}：${list.map(x => (x.use === 'set' ? '第 ' + (x.page + 1) + ' 页改' : '第 ' + (x.page + 1) + ' 页判断')).join('，')}`).join('；');
  const conds = pg.conditionText;
  // 出现条件：一条直接写；多条只写第一条，其余点开看（连同优先级、独立开关这些细节）
  const condLine = !conds.length ? '<span class="wv none">一直出现</span>'
    : `<span class="wv">${linkify(conds[0])}</span>${conds.length > 1 ? `<button type="button" class="linkbtn" id="moreCond" aria-expanded="false">还有 ${conds.length - 1} 个条件</button>` : ''}`;
  main.innerHTML = `<div class="page">
    <div class="crumbs"><a href="#/map/${mapId}">地图 ${mapId}「${esc(ev.mapName)}」</a><span>›</span><span>事件 ${ev.id}</span></div>
    <div class="titlebar">
      <h1><span class="id num">事件 ${ev.id}</span><span id="evName">${esc(ev.name)}</span></h1>
      <button class="quiet small" id="renameEv" title="改名">改名</button>
      ${ev.hint ? `<span class="hint">${esc(ev.hint)}</span>` : ''}
      <span class="sp"></span>
      ${moreMenu([{ id: 'toRecall', label: '把第 ' + (pageIndex + 1) + ' 页加进回想房' }, { id: 'copyPage', label: '复制第 ' + (pageIndex + 1) + ' 页' }, ev.pages.length > 1 ? { id: 'delPage', label: '删除第 ' + (pageIndex + 1) + ' 页', danger: true } : null, { id: 'delEv', label: '删除整个事件', danger: true }])}
    </div>
    <div class="meta"><span class="num">位置 (${ev.x}, ${ev.y})</span>${ev.note ? `<span>备注：${esc(ev.note)}</span>` : ''}</div>
    <div class="pagetabs" role="tablist">
      ${ev.pages.map((p, i) => `<button class="${i === pageIndex ? 'on' : ''}" data-pg="${i}" role="tab" ${ev.stages && ev.stages[i] ? `title="${esc(ev.stages[i].text)}"` : ''}>第 ${i + 1} 页<small>${p.trigger >= 3 ? '自动' : ''}</small></button>`).join('')}
      <button class="quiet small addpg" id="addPage" title="新建一页">＋ 新建一页</button>
    </div>
    <div class="card when2">
      <span class="pimg" id="pgImg"></span>
      <div class="wl"><span class="wk">出现</span>${condLine}</div>
      <div class="wl"><span class="wk">触发</span><span class="wv">${esc(pg.triggerText)}</span></div>
      ${ev.stages && ev.stages[pageIndex] ? `<div class="wl"><span class="wk">进度</span><span class="wv ${ev.stages[pageIndex].never ? 'warnt' : ''}">${esc(ev.stages[pageIndex].text)}${ev.stages[pageIndex].sure === false ? '<span class="faint">（还要看别的条件）</span>' : ''}</span></div>` : ''}
      <span class="sp"></span>
      <button type="button" class="linkbtn" id="condToggle" aria-expanded="false">细节</button>
      <button class="small" id="editCond">改条件</button>
      <div class="wmore" id="condMore" hidden>
        ${conds.length > 1 ? `<div class="wrow"><span class="wk">条件</span><div class="v">${conds.map(t => `<span class="cchip">${linkify(t)}</span>`).join('<span class="faint">并且</span>')}</div></div>` : ''}
        <div class="wrow"><span class="wk">优先级</span><span>${esc(pg.priorityText)}</span></div>
        ${pageIndex < ev.pages.length - 1 ? '<div class="wrow"><span class="wk"></span><span class="faint">后面的页条件满足时，会优先显示后面的页</span></div>' : ''}
        ${selfTxt ? `<div class="wrow"><span class="wk">独立开关</span><span class="faint">${esc(selfTxt)}</span></div>` : ''}
      </div>
    </div>
    <div id="pageBody"></div>
  </div>`;
  {
    const im = pg.image || {};
    if (im.characterName) mountSprite($('#pgImg'), im.characterName, im.characterIndex, im.direction || 2, 40, false);
    else $('#pgImg').remove();
    const tog = open => { $('#condMore').hidden = !open; $('#condToggle').setAttribute('aria-expanded', String(open)); $('#condToggle').textContent = open ? '收起' : '细节'; if ($('#moreCond')) $('#moreCond').hidden = open; };
    $('#condToggle').onclick = () => tog($('#condMore').hidden);
    if ($('#moreCond')) $('#moreCond').onclick = () => tog(true);
  }
  $$('[data-pg]').forEach(b => b.onclick = () => go(`#/event/${mapId}/${evId}/${b.dataset.pg}`));
  $('#renameEv').onclick = async () => {
    const name = await promptDialog('事件改名', '新名字', ev.name);
    if (name == null) return;
    try { await api('event/update', { map: mapId, ev: evId, name }); toast('已改名'); await refreshMaps(); render(); } catch (e) { toast(e.message, true); }
  };
  $('#delEv').onclick = async () => {
    const lines = ev.pages.reduce((s, p) => s + p.outline.filter(r => r.kind === 'say').length, 0);
    if (!await confirmDialog('删除事件', `删除事件 ${ev.id}「${ev.name}」？它有 ${ev.pages.length} 页、${lines} 个对话框。删除前会自动备份。`, '删除事件')) return;
    try { await api('event/delete', { map: mapId, ev: evId }); toast('已删除事件 ' + ev.id); await refreshMaps(); location.hash = '#/map/' + mapId; } catch (e) { toast(e.message, true); }
  };
  $('#addPage').onclick = () => pageAction('page/add', { map: mapId, ev: evId }, r => `#/event/${mapId}/${evId}/${r.page}`, '已新建第 %d 页');
  bindMenu(main);
  $('#toRecall').onclick = () => recallAddDialog([{ type: 'map', map: mapId, ev: evId, page: pageIndex }]);
  $('#copyPage').onclick = () => pageAction('page/add', { map: mapId, ev: evId, copyFrom: pageIndex }, r => `#/event/${mapId}/${evId}/${r.page}`, '已复制成第 %d 页');
  if ($('#delPage')) $('#delPage').onclick = async () => {
    if (!await confirmDialog('删除这一页', `删除第 ${pageIndex + 1} 页？这一页的台词和设置都会去掉（删除前自动备份）。`, '删除这一页')) return;
    pageAction('page/delete', { map: mapId, ev: evId, page: pageIndex }, () => `#/event/${mapId}/${evId}/${Math.max(0, pageIndex - 1)}`, '已删除');
  };
  $('#editCond').onclick = () => conditionDialog(mapId, evId, pageIndex, pg, ev.people || []);
  // 顶栏选了进度：标出那时显示的是哪一页
  if (S.stage && ev.stages) api('progress/map?id=' + mapId).then(c => {
    const cell = stageCellOf(c, evId);
    if (route().name !== 'event' || cell === undefined) return;
    if (cell) { const b = $(`.pagetabs [data-pg="${cell.p}"]`); if (b) { b.classList.add('here'); b.title = `${stageText()} 显示这一页${cell.s ? '' : '（不一定）'}`; } }
    else $('.pagetabs').insertAdjacentHTML('beforeend', `<span class="faint pgnone">${esc(stageText())} 这个事件不出现</span>`);
  }).catch(() => { });
  pageBody($('#pageBody'), pg, { type: 'map', map: mapId, ev: evId, page: pageIndex });
}
async function pageAction(path, body, next, msg) {
  if (S.dirty && !confirm('改的台词还没保存，确定继续？')) return;
  try {
    const r = await api(path, body);
    S.dirty = false;
    toast(msg.replace('%d', (r.page ?? 0) + 1));
    await refreshMaps();
    const h = next(r);
    if (location.hash === h) render(); else location.hash = h;
  } catch (e) { toast(e.message, true); }
}
function go(h) { if (location.hash === h) render(); else location.hash = h; }

// 一页的内容：阅读 / 改台词
function pageBody(box, pg, at) {
  let mode = 'read';
  try { mode = localStorage.getItem('studio.mode') === 'edit' && pg.script.editable ? 'edit' : 'read'; } catch { }
  const draw = () => {
    box.innerHTML = `<div class="modebar">
        <div class="seg" role="tablist"><button data-m="read" class="${mode === 'read' ? 'on' : ''}">阅读</button><button data-m="edit" class="${mode === 'edit' ? 'on' : ''}">改台词</button></div>
        <span class="dim" style="font-size:12.5px">${pg.outline.filter(r => r.kind === 'say').length} 个对话框 · ${pg.commands - 1} 条指令</span>
        <span class="sp"></span>
        <button type="button" class="small" id="pbPlay" title="不开游戏，在这里把这一段演一遍">▶ 预览</button>
        ${mode === 'read' && pg.outline.some(r => BRANCH_HEADS.has(r.code)) ? '<button type="button" class="quiet small" id="brAll">收起所有分支</button>' : ''}
        ${mode === 'read' ? `<label class="switch"><input type="checkbox" id="foldAll" ${FOLD_ALL ? '' : 'checked'}><span>显示全部指令</span></label>` : ''}
      </div><div id="modeBody"></div>`;
    if ($('#brAll', box)) $('#brAll', box).onclick = e => {
      const b = e.currentTarget;
      if (b.dataset.shut) { draw(); return; }
      const heads = $$('#modeBody .cue > .row.br', box);
      const top = Math.min(...heads.map(x => Number(x.dataset.ind)));
      heads.filter(x => Number(x.dataset.ind) === top && !x.classList.contains('shut')).forEach(x => x.click());
      b.dataset.shut = '1'; b.textContent = '展开所有分支';
    };
    $('#pbPlay', box).onclick = () => {
      const ta = $('#modeBody textarea', box);
      if (mode === 'edit' && ta) playText(ta.value, at, '还没保存的台词');
      else playAt(at);
    };
    if ($('#foldAll', box)) $('#foldAll', box).onchange = e => { FOLD_ALL = !e.target.checked; try { localStorage.setItem('studio.fold', FOLD_ALL ? '1' : '0'); } catch { } draw(); };
    $$('[data-m]', box).forEach(b => b.onclick = () => {
      if (mode === 'edit' && S.dirty && !confirm('改的台词还没保存，确定切回阅读？')) return;
      S.dirty = false; mode = b.dataset.m;
      try { localStorage.setItem('studio.mode', mode); } catch { }
      draw();
    });
    if (mode === 'read') $('#modeBody', box).innerHTML = cueSheet(pg.outline, { at });
    else editBox($('#modeBody', box), pg, at);
  };
  draw();
}

const CAT_VAR = { say: '--c-say', flow: '--c-flow', state: '--c-state', stage: '--c-stage', move: '--c-move', code: '--c-code', note: '--c-note', system: '--c-system' };
// 阅读视图默认只看剧情：台词、选项、分支、传送、调用公共事件照常显示；
// 中间连续的「后台操作」（改开关变量、画面、图片、声音、等待、脚本、插件、注释…）折成一行摘要，点开再看
const STORY_EXTRA = new Set([201]);            // 移动类里只有「传送」算剧情
const QUIET_FLOW = new Set([404, 412, 0]);     // 选项结束 / 条件结束：缩进已经表达了，剧情模式里不显示
const isStory = r => r.kind === 'say' || r.cat === 'say' || r.cat === 'flow' || STORY_EXTRA.has(r.code);
const FOLD_KIND = code =>
  (code >= 121 && code <= 129) || (code >= 311 && code <= 326) ? '数值' :
  code >= 231 && code <= 235 ? '图片' :
  (code >= 241 && code <= 251) ? '声音' :
  code === 230 ? '等待' :
  [211, 212, 213, 221, 222, 223, 224, 225, 236, 261].includes(code) ? '画面' :
  [202, 203, 204, 205, 206, 214, 216, 217].includes(code) ? '移动' :
  [355, 356, 357].includes(code) ? '脚本' :
  code === 108 ? '注释' : '其他';
let FOLD_ALL = (() => { try { return localStorage.getItem('studio.fold') !== '0'; } catch { return true; } })();
let CUE_AT = null;   // 正在画的是哪一页（选项旁边的「关联场景」要知道位置）
function cueRow(r) {
  const d = `--d:${r.indent};--cat:var(${CAT_VAR[r.cat] || '--c-system'})`;
  let body;
  if (r.kind === 'say') {
    // 台词里的文字代码（<center>、\LastGainObj……）服务器已经换成游戏里显示的样子；鼠标停上去看原文
    const lines = r.align ? r.lines.map((l, k) => `<span class="ln ${r.align[k] || 'left'}">${esc(l) || ' '}</span>`).join('') : r.lines.map(esc).join('\n');
    body = `<div class="say"${r.raw ? ` title="${esc('原文（游戏里会换成左边的样子）：\n' + r.raw.join('\n'))}"` : ''}><span class="spk ${r.speaker ? '' : 'narr'}">${esc(r.speaker || '旁白')}</span><span class="lines">${lines}</span></div>`;
  } else if (r.picture) {
    body = `<span class="act pic"><img loading="lazy" src="${img('pictures', r.picture)}" alt="" onerror="this.remove()"><span>${linkify(r.text)}</span> <span class="ref" data-kind="picture" data-id="${esc(r.picture)}" tabindex="0">看图</span></span>`;
  } else {
    body = `<span class="act cat-${r.cat}">${linkify(r.text)}</span>${r.more && r.more.some(Boolean) ? `<span class="more">${r.more.filter(Boolean).map(esc).join('\n')}</span>` : ''}`;
  }
  const br = BRANCH_HEADS.has(r.code) ? ' br' : '';
  const link = r.code === 402 && CUE_AT ? `<button type="button" class="sclink" data-sline="${r.i}" data-slabel="${esc((/「(.*)」/.exec(r.text || '') || [])[1] || '')}" data-sat="${esc(JSON.stringify(CUE_AT))}" title="选这个选项时播一个场景">关联场景</button>` : '';
  return `<div class="row${br}" data-ind="${r.indent}" style="${d}"><span class="rails"></span><div class="body">${br ? '<span class="brchev" aria-hidden="true"></span>' : ''}${body}${link}${br ? '<span class="brn"></span>' : ''}</div><span class="lnum num">${r.i + 1}</span></div>`;
}
// 分支开头（如果 / 选了 / 否则 / 按取消时 / 循环…）：点一下收起它下面缩进进去的内容
const BRANCH_HEADS = new Set([111, 411, 402, 403, 112, 601, 602, 603]);
document.addEventListener('click', e => {
  const head = e.target.closest('.cue .row.br');
  if (!head || e.target.closest('.ref, a, button, img')) return;
  const ind = Number(head.dataset.ind), closing = !head.classList.contains('shut');
  head.classList.toggle('shut', closing);
  let n = 0;
  for (let el = head.nextElementSibling; el && Number(el.dataset.ind) > ind; el = el.nextElementSibling) {
    const c = Math.max(0, (Number(el.dataset.h) || 0) + (closing ? 1 : -1));
    el.dataset.h = c; el.classList.toggle('brhide', c > 0); n++;
  }
  $('.brn', head).textContent = closing && n ? `收起了 ${n} 行` : '';
});
function foldRow(run) {
  const counts = new Map();
  for (const r of run) { const k = FOLD_KIND(r.code); counts.set(k, (counts.get(k) || 0) + 1); }
  const sum = [...counts].map(([k, n]) => (n > 1 ? `${k} ${n}` : k)).join(' · ');
  const pics = run.filter(r => r.picture).slice(0, 4);
  const d = `--d:${run[0].indent};--cat:var(--c-system)`;
  return `<div class="fold" data-ind="${run[0].indent}" style="--d:${run[0].indent}">
    <div class="row foldhead" style="${d}"><span class="rails"></span><div class="body"><button type="button" class="foldbtn" aria-expanded="false"><span class="chev" aria-hidden="true"></span>${run.length} 条后台操作<span class="foldsum">${esc(sum)}</span>${pics.map(r => `<img loading="lazy" src="${img('pictures', r.picture)}" alt="" onerror="this.remove()">`).join('')}</button></div></div>
    <div class="foldbody" hidden>${run.map(cueRow).join('')}</div>
  </div>`;
}
function cueSheet(rows, opt = {}) {
  const prev = CUE_AT;
  CUE_AT = opt.at || null;
  try { return cueSheetNow(rows, opt); } finally { CUE_AT = prev; }
}
function cueSheetNow(rows, opt) {
  rows = rows.filter(r => !(r.code === 108 && /<RpgStudioScene>/.test(r.text || '')));   // 场景库标记不用给人看
  if (!rows.length) return '<div class="empty">这一页是空的。切到「改台词」就能开始写。</div>';
  const all = opt.all != null ? opt.all : !FOLD_ALL;
  if (all) return `<div class="card cue">${rows.map(cueRow).join('')}</div>`;
  const out = [];
  let run = [];
  const flush = () => { if (!run.length) return; out.push(run.length === 1 ? cueRow(run[0]).replace('class="row"', 'class="row quietrow"') : foldRow(run)); run = []; };
  for (const r of rows) {
    if (isStory(r)) { flush(); if (!QUIET_FLOW.has(r.code)) out.push(cueRow(r)); continue; }
    if (run.length && run[0].indent !== r.indent) flush();
    run.push(r);
  }
  flush();
  return `<div class="card cue">${out.join('')}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('.foldbtn');
  if (!b) return;
  const body = b.closest('.fold').querySelector('.foldbody');
  body.hidden = !body.hidden;
  b.setAttribute('aria-expanded', String(!body.hidden));
  b.closest('.fold').classList.toggle('open', !body.hidden);
});

// 编辑框：着色层 + textarea
// 文字代码（\N[1]、\C[2]、\LastGainObj、<center>……）标成灰色：游戏里会换成名字 / 颜色 / 刚得到的东西 / 居中
const CODE_RE = /\\[A-Za-z]+(?:\[[^\]\n]*\]|<[^>\n]*>)?|\\[{}$.|!><^\\]|<\/?(?:b|i|left|center|right|br|line break|ColorLock|WordWrap|Caps|Upper|Lower|Alt|Chaos|Next Page)>/gi;
const codes = s => { let out = '', last = 0; String(s).replace(CODE_RE, (m, at) => { out += esc(s.slice(last, at)) + `<span class="t-code">${esc(m)}</span>`; last = at + m.length; return m; }); return out + esc(s.slice(last)); };
function paint(text) {
  return text.split('\n').map(line => {
    const m = /^((?:│ ?)*)(.*)$/.exec(line);
    const bar = m[1] ? `<span class="t-bar">${esc(m[1])}</span>` : '';
    const s = m[2];
    let body;
    if (/^■\s*选了「/.test(s)) body = `<span class="t-anchor t-opt">${esc(s)}</span>`;
    else if (/^■/.test(s)) body = `<span class="t-anchor">${esc(s)}</span>`;
    else if (/^[#＃]\s*原样/.test(s)) body = `<span class="t-keep">${esc(s)}</span>`;
    else if (/^[#＃]\s*(图|CG|cg|显示图片|清图|清除图片|关闭图片|关图|立绘|退场)/.test(s)) body = `<span class="t-pic">${esc(s)}</span>`;
    else if (/^[#＃]\s*(飘字|动作)/.test(s)) body = `<span class="t-act">${esc(s)}</span>`;
    else if (/^[#＃]\s*选项|^[#＃]\d/.test(s)) body = `<span class="t-choice">${esc(s)}</span>`;
    else if (/^[#＃]/.test(s)) body = `<span class="t-mark">${esc(s)}</span>`;
    else if (/^[＋+]/.test(s)) body = `<span class="t-cont">${esc(s.slice(0, 1))}</span>${codes(s.slice(1))}`;
    else { const k = /^([^：:]{1,12})([：:])(.*)$/.exec(s); body = k && S.project.nameBox ? `<span class="t-spk">${esc(k[1])}${esc(k[2])}</span>${codes(k[3])}` : codes(s); }
    return bar + body;
  }).join('\n') + '\n';
}

function editBox(box, pg, at) {
  const sc = pg.script;
  if (!sc.editable) {
    box.innerHTML = `<div class="locked">这一页不能用编辑框改：${esc(sc.reason || '结构太复杂')}。下面是它现在的内容（只读）。</div>${cueSheet(pg.outline)}`;
    return;
  }
  const P = S.project;
  const clearHint = P.pictures.clearAll === 'script' ? `关闭全部剧情图片（${P.pictures.min}~${P.pictures.max} 号）` : '关闭这一页里还在显示的图';
  box.innerHTML = `
    <div class="editor"><pre aria-hidden="true"></pre><textarea spellcheck="false" aria-label="台词"></textarea></div>
    <div class="edbar">
      <button class="primary" id="saveTxt" disabled>保存台词</button>
      <button id="previewTxt" disabled>先看看会改什么</button>
      <button class="quiet" id="resetTxt" disabled>放弃修改</button>
      <span class="sp"></span>
      <button class="small" id="insPic">插入图片</button>
      <button class="small" id="insSay">插入人物</button>
    </div>
    <div id="edMsg"></div>
    <details class="helpbox"><summary>写法</summary><table>
      <tr><td>名字：台词</td><td>一个对话框；不写名字就是旁白${P.nameBox ? '' : '（MV 没有名字框，「名字：」会原样留在台词里）'}</td></tr>
      <tr><td>＋第二行</td><td>接在上一句的同一个对话框里</td></tr>
      <tr><td>：台词</td><td>明确是旁白（台词本身带冒号时用）</td></tr>
      <tr><td>#图 图片名</td><td>显示图片，叠在最上面（新图用 ${P.pictures.min}~${P.pictures.max} 号）</td></tr>
      <tr><td>#清图</td><td>${clearHint}；#清图 图片2 = 关掉第 2 个 #图；#清图 图片名 = 按名字关</td></tr>
      <tr><td>#等待 1.5</td><td>停 1.5 秒</td></tr>
      <tr><td>#开关 名字 开</td><td>也可以写编号；关 = 关闭</td></tr>
      <tr><td>#变量 名字 + 1</td><td>支持 = + - * / %</td></tr>
      <tr><td>#物品 名字 +1</td><td>获得 / 失去物品</td></tr>
      <tr><td>#传送 地图名 x y</td><td>传送到某张地图</td></tr>
      <tr><td>#选项 去 | 不去</td><td>下面用「#1 …」「#2 …」写各自的内容</td></tr>
      <tr><td>#字幕 大一 · 九月</td><td>画面中间一条暗底的字（章节、时间、地点）；几行用 ｜ 隔开</td></tr>
      <tr><td>#立绘 林屿 笑 左</td><td>显示立绘 img/pictures/立绘/林屿_笑，底边贴着画面下沿；位置 左 / 中 / 右 可以不写（先左后右）；同一个人再写一次 = 换表情</td></tr>
      <tr><td>#退场 林屿</td><td>收起这个人的立绘；只写 #退场 = 收起所有立绘</td></tr>
      <tr><td>#淡出 / #淡入</td><td>画面变黑 / 恢复</td></tr>
      <tr><td>#音乐 名字 80</td><td>放背景音乐（音量可以不写）；#停音乐 2 = 两秒内渐渐停掉；#环境音 / #停环境音 同理；#音效 名字</td></tr>
      <tr><td>#色调 夜晚 2</td><td>正常 / 夜晚 / 深夜 / 黄昏 / 回忆 / 灰暗 / 红，2 秒变过去（不写 = 1 秒）</td></tr>
      <tr><td>#场景 名字</td><td>在这里播另一个场景（公共事件），播完接着往下</td></tr>
      <tr><td>#行走图 角色 图名 编号</td><td>换角色的样子（比如现实里一套、游戏里一套）</td></tr>
      <tr><td>#透明 开 / 关</td><td>主角隐身 / 现身</td></tr>
      <tr><td>#消失 / #独立开关 A 开</td><td>这个事件先不见（打倒的怪）/ 这个事件自己的开关（只播一次）</td></tr>
      <tr><td>#回到标题</td><td>结局放完回到标题画面</td></tr>
      <tr><td>#震动 / #气泡 ！</td><td>画面震一下（可写强度 1~9）；主角头上冒气泡 ！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz（后面写「本事件」= 这个事件头上）</td></tr>
      <tr><td>#飘字 林屿：真的是我的问题吗</td><td>字从这个人头上飘起来再淡掉，不挡剧情（连着写几句，前面的会被顶上去，像念头一个一个冒出来）；不写名字 = 主角；「画面：」= 画面中间随便一处。名字可以是主角、本事件、地图上事件的名字</td></tr>
      <tr><td>#动作 赵磊 转身 ！ 下2 等0.5</td><td>让人物动：上 下 左 右（上3）、前进、后退、靠近主角、远离主角、转上 转下 转左 转右、转身、面向主角、背对主角、跳、等0.5、速度1~6、慢、快、隐身、现身、气泡 ！ ？ …；最后写「不等」= 不等他做完（两个人一起动）。走不过去的那步会跳过</td></tr>
      <tr><td>#镜头 上 4 / #天气 雨 / #闪光</td><td>镜头往上平移 4 格（可写速度 1~6）；天气 雨 / 暴雨 / 雪 / 无（可写强度、秒）；画面闪一下（白 / 红）</td></tr>
      <tr><td>■ 选项（N 个）：…</td><td>列出这里有哪些选项，一眼看全；只是看的，不用改，改字在下面的「■ 选了」行</td></tr>
      <tr><td>■ 选了「…」</td><td>选项：改「」里的字 = 改这个选项；照着写一行 = 加一个选项（放在「■ 选项结束」或「■ 按取消时」前面，最多 6 个），下面写它的台词；删掉这一行和它下面的内容 = 删掉这个选项</td></tr>
      <tr><td>■ …</td><td>其它原来的结构（条件、插件、音效…），不能改、删、挪；在它们中间可以加台词</td></tr>
      <tr><td>#原样 …</td><td>编辑框表达不了的指令，可以删、可以挪，不能改内容</td></tr>
      <tr><td><span class="t-code">\\LastGainObj</span>、<span class="t-code">&lt;center&gt;</span> …</td><td>灰色的是游戏里的文字代码（插件的也算）：游戏里会换成名字、颜色、刚得到的东西，或者居中显示。照原样留着就行；阅读视图和预览里显示的是换好的样子</td></tr>
    </table></details>`;
  const ta = $('textarea', box), pre = $('pre', box);
  const orig = sc.text;
  ta.value = orig;
  // 着色层（pre）要和输入框一模一样地折行：输入框出了滚动条（Windows 上占十几像素）内容就变窄，
  // 着色层也得让出同样的宽度，不然长行折得不一样，下面的字整体错位——看着在改这一行，其实改的是别的行
  const padR = parseFloat(getComputedStyle(ta).paddingRight) || 16;
  const align = () => { pre.style.paddingRight = (padR + Math.max(0, ta.offsetWidth - ta.clientWidth)) + 'px'; pre.scrollTop = ta.scrollTop; };
  const sync = () => { pre.innerHTML = paint(ta.value); align(); };
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(340, Math.min(ta.scrollHeight + 4, window.innerHeight * 0.72)) + 'px'; };
  const dirty = () => {
    S.dirty = ta.value !== orig;
    ['#saveTxt', '#previewTxt', '#resetTxt'].forEach(s => $(s, box).disabled = !S.dirty);
  };
  ta.addEventListener('input', () => { fit(); sync(); dirty(); $('#edMsg', box).innerHTML = ''; });
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (S.dirty) save(); } });
  sync(); setTimeout(() => { fit(); align(); }, 0);
  // 窗口 / 侧栏宽度变了、拖动改了高度、滚动条出现或消失：重新对齐
  if (window.ResizeObserver) new ResizeObserver(align).observe(ta);
  const insert = s => {
    const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    const before = v.slice(0, a), after = v.slice(b);
    const pre1 = before && !before.endsWith('\n') ? '\n' : '';
    const post = after && !after.startsWith('\n') ? '\n' : '';
    ta.value = before + pre1 + s + post + after;
    const pos = (before + pre1 + s).length;
    ta.focus(); ta.setSelectionRange(pos, pos);
    sync(); fit(); dirty();
  };
  const showMsg = html => { $('#edMsg', box).innerHTML = html; };
  async function save() {
    $('#saveTxt', box).disabled = true;
    try {
      const r = await api('text', { at, text: ta.value });
      S.dirty = false;
      toast(r.unchanged ? '没有改动' : '已保存台词');
      if (r.warnings && r.warnings.length) toast('提醒：' + r.warnings.slice(0, 2).join('；'));
      await refreshMaps();
      render();
    } catch (e) {
      showMsg(`<div class="err">${esc(e.message)}</div>`);
      dirty();
    }
  }
  $('#saveTxt', box).onclick = save;
  $('#resetTxt', box).onclick = () => { ta.value = orig; sync(); fit(); dirty(); showMsg(''); };
  $('#previewTxt', box).onclick = async () => {
    try {
      const r = await api('preview', { at, text: ta.value });
      showMsg(`<div class="card previewbox"><h3>${r.unchanged ? '和原来一模一样，保存不会改任何数据' : '保存后这一页会变成这样'}${r.problems.length ? '' : ''}</h3>
        ${r.problems.length ? `<div class="err" style="margin:0 14px 8px">${r.problems.map(p => esc(`第 ${p.line + 1} 条：${p.msg}`)).join('\n')}</div>` : ''}
        ${r.unchanged ? '' : cueSheet(r.outline, { all: true }).replace('class="card cue"', 'class="cue"')}</div>`);
    } catch (e) { showMsg(`<div class="err">${esc(e.message)}</div>`); }
  };
  $('#insPic', box).onclick = async () => { const n = await pickDialog('插入图片', 'images?sub=pictures', true); if (n) insert('#图 ' + n); };
  $('#insSay', box).onclick = async () => { const n = await pickDialog('插入人物', 'lookup?kind=actor'); if (n) insert(n + '：'); };
}


async function conditionDialog(mapId, evId, pageIndex, pg, people) {
  const [sw, vr, it, ac] = await Promise.all([lookup('switch'), lookup('var'), lookup('item'), lookup('actor')]);
  const c = pg.conditions;
  // 没勾的条件先藏起来，用「加条件」把要的那一种拿出来；勾上的照常显示
  const row = (key, label, inner) => `<div class="frow" data-row="${key}" ${c[key + 'Valid'] ? '' : 'hidden'}><input type="checkbox" id="c_${key}" ${c[key + 'Valid'] ? 'checked' : ''}><label for="c_${key}">${label}</label><div class="ins">${inner}</div></div>`;
  const ADD = [['switch', '开关'], ['variable', '变量'], ['selfSwitch', '独立开关'], ['item', '持有物品'], ['actor', '角色在队伍']];
  const TR = ['按确定键', '玩家接触', '事件接触', '自动执行', '并行处理'], PR = ['在角色下方', '与角色同层', '在角色上方'];
  const r = await openDialog(`<header><h3>第 ${pageIndex + 1} 页：什么时候出现、怎么触发</h3></header>
    <div class="dbody">
      <div class="csec"><span class="csec-t">出现条件</span><span class="faint" id="cNone">没有条件，一直出现</span><span class="faint" id="cAnd" hidden>勾上的要同时满足</span></div>
      ${row('switch1', '开关', `<select id="v_switch1">${options(sw, c.switch1Id)}</select><span class="dim">为开</span>`)}
      ${row('switch2', '开关', `<select id="v_switch2">${options(sw, c.switch2Id)}</select><span class="dim">为开</span>`)}
      ${row('variable', '变量', `<select id="v_variable">${options(vr, c.variableId)}</select><span class="dim">≥</span><input class="n num" id="v_value" type="number" value="${c.variableValue}">`)}
      ${row('selfSwitch', '独立开关', `<select id="v_self">${['A', 'B', 'C', 'D'].map(x => `<option ${c.selfSwitchCh === x ? 'selected' : ''}>${x}</option>`).join('')}</select><span class="dim">为开</span>`)}
      ${row('item', '持有物品', `<select id="v_item">${options(it, c.itemId)}</select>`)}
      ${row('actor', '角色在队伍', `<select id="v_actor">${options(ac, c.actorId)}</select>`)}
      <div class="addcond" id="addCond"><span class="dim">＋ 加条件</span>${ADD.map(([k, l]) => `<button type="button" class="small" data-add="${k}">${l}</button>`).join('')}</div>
      ${stagePlaceHtml()}
      ${(() => {
        const ps = (people || []).filter(p => p.vars.length || p.switches.length);
        if (!ps.length) return '';
        return `<div class="cpeople">
          <div class="who">这个事件里的人常用的数值，点一下填进条件：${ps.length > 1 ? ps.map((p, i) => `<button type="button" class="cwho${i ? '' : ' on'}" data-cwho="${i}">${esc(p.name)}</button>`).join('') : `<a href="#/people/${enc(ps[0].key)}">${esc(ps[0].name)}</a>`}</div>
          ${ps.map((p, i) => `<div class="cset" data-cset="${i}" ${i ? 'hidden' : ''}>
            ${p.vars.length ? `<div class="chips"><span class="dim">变量</span>${p.vars.slice(0, 6).map(x => `<button type="button" data-cvar="${x.id}" title="${esc(x.why.join(' · '))}">${x.id} ${esc(x.name || '未命名')}</button>`).join('')}</div>` : ''}
            ${p.switches.length ? `<div class="chips"><span class="dim">开关</span>${p.switches.slice(0, 6).map(x => `<button type="button" data-csw="${x.id}" title="${esc(x.why.join(' · '))}">${x.id} ${esc(x.name || '未命名')}</button>`).join('')}</div>` : ''}
            <div class="cmeta">${p.says ? '在这个事件里说 ' + p.says + ' 句' : ''}${p.appears ? (p.says ? '，' : '') + '是这个事件的小人' : ''}。<a href="#/people/${enc(p.key)}">看${esc(p.name)}的全部数值</a></div>
          </div>`).join('')}
        </div>`;
      })()}
      <div class="cnew"><button type="button" class="small quiet" id="cNewBtn">＋ 没有合适的？新建开关 / 变量</button>
        <div id="cNewForm" class="cnewform" hidden>
          <select id="cnKind" aria-label="类型"><option value="var">变量</option><option value="switch">开关</option></select>
          <select id="cnWho" aria-label="属于谁"><option value="">不属于谁</option>${(people || []).map(p => `<option value="${esc(p.key)}">属于${esc(p.name)}</option>`).join('')}</select>
          <input id="cnName" placeholder="名字，比如 好感度" maxlength="30">
          <button type="button" class="small primary" id="cnOk">新建并填进条件</button>
        </div></div>
      <div class="csec"><span class="csec-t">触发和图像</span></div>
      <div class="fgrid">
        <label for="v_trigger">触发方式</label><select id="v_trigger">${TR.map((t, i) => `<option value="${i}" ${pg.trigger === i ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <span>图像</span><div class="imgrow"><span class="pspr" id="cImg"></span><span class="dim" id="cImgName" style="font-size:12.5px"></span><button type="button" class="small" id="cImgPick">换图像</button></div>
      </div>
      <div class="fnote" id="autoNote" hidden>自动执行会挡住玩家操作，直到这一页把条件改掉（比如打开独立开关）；不想挡就用并行处理。</div>
      <details class="cmore"><summary>更多设置</summary>
        <div class="fgrid"><label for="v_prio">优先级</label><select id="v_prio">${PR.map((t, i) => `<option value="${i}" ${pg.priorityType === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="fnote">在角色下方 / 上方 = 玩家能从它身上走过去；与角色同层 = 挡路，碰到才触发。</div>
      </details>
      <div id="cErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>保存条件</button></footer>`,
    (d, done) => {
      $$('.frow select, .frow input:not([type=checkbox])', d).forEach(x => x.addEventListener('change', () => { const cb = $('input[type=checkbox]', x.closest('.frow')); if (cb) cb.checked = true; syncRows(); }));
      // 条件行：勾上 / 加条件时显示；「加条件」只列还藏着的
      const showRow = key => { const r = $(`[data-row="${key}"]`, d); r.hidden = false; $('#c_' + key, d).checked = true; syncRows(); };
      const syncRows = () => {
        const shown = k => !$(`[data-row="${k}"]`, d).hidden;
        $$('[data-add]', d).forEach(b => { const k = b.dataset.add; b.hidden = k === 'switch' ? shown('switch1') && shown('switch2') : shown(k); });
        $('#addCond', d).hidden = !$$('[data-add]', d).some(b => !b.hidden);
        const n = $$('.frow input[type=checkbox]', d).filter(x => x.checked).length;
        $('#cNone', d).hidden = n > 0; $('#cAnd', d).hidden = n < 2;
      };
      $$('[data-add]', d).forEach(b => b.onclick = () => {
        const k = b.dataset.add;
        const key = k === 'switch' ? ($(`[data-row="switch1"]`, d).hidden ? 'switch1' : 'switch2') : k;
        showRow(key);
        const f = $(`[data-row="${key}"] select`, d); if (f) f.focus();
      });
      $$('.frow input[type=checkbox]', d).forEach(x => x.addEventListener('change', syncRows));
      $('#v_trigger', d).onchange = () => { $('#autoNote', d).hidden = Number($('#v_trigger', d).value) !== 3; };
      $('#autoNote', d).hidden = pg.trigger !== 3;
      syncRows();
      bindStagePlace(d, showRow, syncRows);
      $$('[data-cwho]', d).forEach(b => b.onclick = () => {
        $$('[data-cwho]', d).forEach(x => x.classList.toggle('on', x === b));
        $$('[data-cset]', d).forEach(x => { x.hidden = x.dataset.cset !== b.dataset.cwho; });
      });
      // 人物常用数值：点了直接填进条件
      $$('[data-cvar]', d).forEach(b => b.onclick = () => { $('#v_variable', d).value = b.dataset.cvar; showRow('variable'); $('#v_value', d).focus(); $('#v_value', d).select(); });
      $$('[data-csw]', d).forEach(b => b.onclick = () => {
        const slot = !$('#c_switch1', d).checked || $('#v_switch1', d).value === b.dataset.csw ? 'switch1' : 'switch2';
        $('#v_' + slot, d).value = b.dataset.csw; showRow(slot);
      });
      // 就地新建开关 / 变量（属于某人时名字存成「人名·名字」并手动关联），建好直接选上
      $('#cNewBtn', d).onclick = () => { const f = $('#cNewForm', d); f.hidden = !f.hidden; if (!f.hidden) $('#cnName', d).focus(); };
      if ((people || []).length) $('#cnWho', d).value = people[0].key;
      const cnSubmit = async () => {
        const kind = $('#cnKind', d).value, who = $('#cnWho', d).value, nm = $('#cnName', d).value.trim();
        if (!nm) { $('#cnName', d).focus(); return; }
        try {
          const x = who ? await api('person/newvar', { key: who, kind, label: nm, view: false }) : await api('name', { kind, id: 'new', name: nm });
          S.lookups = {};
          // 新编号可能是列表里本来就有的空槽（没名字），改它的文字；超出原来数量的往后加
          const putOpt = sel => { const o = [...sel.options].find(o => o.value === String(x.id)); if (o) o.textContent = x.id + ' ' + x.name; else sel.insertAdjacentHTML('beforeend', `<option value="${x.id}">${x.id} ${esc(x.name)}</option>`); };
          if (kind === 'var') {
            putOpt($('#v_variable', d)); $('#v_variable', d).value = String(x.id); showRow('variable');
          } else {
            for (const s of ['v_switch1', 'v_switch2']) putOpt($('#' + s, d));
            const slot = !$('#c_switch1', d).checked ? 'switch1' : 'switch2';
            $('#v_' + slot, d).value = String(x.id); showRow(slot);
          }
          $('#cnName', d).value = ''; $('#cNewForm', d).hidden = true;
          toast(`已新建${kind === 'var' ? '变量' : '开关'} ${x.id}「${x.name}」，已填进条件`);
        } catch (e) { $('#cErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      $('#cnOk', d).onclick = cnSubmit;
      $('#cnName', d).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cnSubmit(); } };
      // 图像
      let image = null;
      const im0 = pg.image || {};
      const showImg = im => {
        const box = $('#cImg', d);
        box.innerHTML = '';
        if (im.characterName) {
          loadSheet(im.characterName).then(sh => { if (!sh) return; const f = frameOf(sh, im.characterName, im.characterIndex, im.direction, im.pattern); const cv = document.createElement('canvas'); cv.width = f.pw; cv.height = f.ph; cv.className = 'sprcv'; cv.style.height = '48px'; cv.style.width = 48 * f.pw / f.ph + 'px'; cv.getContext('2d').drawImage(sh, f.sx, f.sy, f.pw, f.ph, 0, 0, f.pw, f.ph); box.appendChild(cv); });
          $('#cImgName', d).textContent = im.characterName + (isBigSheet(im.characterName) ? '' : ' 第 ' + ((im.characterIndex || 0) + 1) + ' 个') + ' · ' + ({ 2: '朝下', 4: '朝左', 6: '朝右', 8: '朝上' })[im.direction || 2];
        } else { box.innerHTML = '<span class="pnone">无</span>'; $('#cImgName', d).textContent = im.tileId ? '图块' : '没有图像'; }
      };
      showImg(im0);
      // 选小人要用同一个弹窗：先记下现在填的条件，关掉这个弹窗去选，选完再打开回来
      $('#cImgPick', d).onclick = () => done({ pick: snapshot(), image });
      const snapshot = () => {
        const v = id => $('#' + id, d).value, ck = id => $('#' + id, d).checked;
        return {
          trigger: Number(v('v_trigger')), priorityType: Number(v('v_prio')),
          conditions: {
            switch1Valid: ck('c_switch1'), switch1Id: Number(v('v_switch1')), switch2Valid: ck('c_switch2'), switch2Id: Number(v('v_switch2')),
            variableValid: ck('c_variable'), variableId: Number(v('v_variable')), variableValue: Number(v('v_value')),
            selfSwitchValid: ck('c_selfSwitch'), selfSwitchCh: v('v_self'), itemValid: ck('c_item'), itemId: Number(v('v_item')),
            actorValid: ck('c_actor'), actorId: Number(v('v_actor')),
          },
        };
      };
      if (pg._image) image = pg._image;
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        const v = id => $('#' + id, d).value, ck = id => $('#' + id, d).checked;
        const body = {
          map: mapId, ev: evId, page: pageIndex, trigger: Number(v('v_trigger')), priorityType: Number(v('v_prio')),
          conditions: {
            switch1Valid: ck('c_switch1'), switch1Id: Number(v('v_switch1')), switch2Valid: ck('c_switch2'), switch2Id: Number(v('v_switch2')),
            variableValid: ck('c_variable'), variableId: Number(v('v_variable')), variableValue: Number(v('v_value')),
            selfSwitchValid: ck('c_selfSwitch'), selfSwitchCh: v('v_self'), itemValid: ck('c_item'), itemId: Number(v('v_item')),
            actorValid: ck('c_actor'), actorId: Number(v('v_actor')),
          },
        };
        if (image) body.image = image;
        try { await api('page/settings', body); done(true); }
        catch (e) { $('#cErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (r && r.pick) {
    const cur = r.image || pg.image || {};
    const s = await spritePicker({ name: cur.characterName, index: cur.characterIndex, dir: cur.direction, pattern: cur.pattern }, { title: '这一页的图像' });
    const image = s ? { characterName: s.name, characterIndex: s.index, direction: s.dir, pattern: s.pattern } : r.image;
    return conditionDialog(mapId, evId, pageIndex, { ...pg, ...r.pick, image: image || pg.image, _image: image }, people);
  }
  if (r) { toast('已保存条件'); await refreshMaps(); render(); }
}
