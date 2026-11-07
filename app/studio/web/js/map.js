'use strict';
// 地图：渲染（照 MZ 引擎）、事件层、图块 / 区域编辑、调色板、地图属性 / 新建 / 复制 / 删除
// ---------- 地图 ----------
// 三种模式：事件（看 / 拖动 / 新建事件）、图块（画地图）、区域（刷区域编号）
const TM = window.Tilemap;
const charCache = new Map();
function loadSheet(name) {
  if (!charCache.has(name)) charCache.set(name, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = img('characters', name); }));
  return charCache.get(name);
}
// 行走图里取一帧：普通图 4×2 个角色、每个 3×4 帧；$ 开头的是单个角色
async function paintSprite(el, image, cell) {
  if (!image || !image.characterName) return false;
  const sheet = await loadSheet(image.characterName);
  if (!sheet) return false;
  const single = /^[!]*\$/.test(image.characterName);
  const fw = sheet.naturalWidth / (single ? 3 : 12), fh = sheet.naturalHeight / (single ? 4 : 8);
  const ci = single ? 0 : image.characterIndex || 0;
  const col = (ci % 4) * 3 + (image.pattern == null ? 1 : image.pattern);
  const row = Math.floor(ci / 4) * 4 + Math.max(0, (image.direction || 2) / 2 - 1);
  const s = cell / Math.max(fw, fh);
  el.style.backgroundImage = `url("${sheet.src}")`;
  el.style.backgroundSize = `${sheet.naturalWidth * s}px ${sheet.naturalHeight * s}px`;
  el.style.backgroundPosition = `${-col * fw * s + (cell - fw * s) / 2}px ${-row * fh * s + (cell - fh * s)}px`;
  return true;
}
const tileImgCache = new Map();
const loadTileSheet = name => {
  if (!name) return Promise.resolve(null);
  if (!tileImgCache.has(name)) tileImgCache.set(name, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = img('tilesets', name); }));
  return tileImgCache.get(name);
};
const ZOOMS = [8, 12, 16, 20, 24, 32, 40, 48, 64, 96];
const regionColor = r => `hsla(${(r * 47) % 360},78%,56%,.45)`;
const SET_NAMES = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];
function tileLabel(id) {
  if (!id) return '空';
  if (TM.isAuto(id)) {
    const k = TM.kindOf(id);
    const [set, n] = k < 16 ? ['A1', k] : k < 48 ? ['A2', k - 16] : k < 80 ? ['A3', k - 48] : ['A4', k - 80];
    return `${set} 第 ${n + 1} 种（自动接边）`;
  }
  if (TM.isA5(id)) return `A5 #${id - TM.ID.A5}`;
  return `${'BCDE'[Math.floor(id / 256)]} #${id % 256}`;
}

let ME = null;   // 当前打开的地图编辑状态

// opts.embed：嵌在别的页面里（剧情进度的「选天 → 选地图」）：只有地图和缩放，点事件 / 空格子交给 opts.onEvent(e, page) / opts.onEmpty(p)
async function viewMap(main, id, mode, opts = {}) {
  const embed = opts.embed ? opts : null;
  if (!embed) revealMap(id);
  main.innerHTML = '<div class="loading">正在读取地图…</div>';
  const [m, tiles] = await Promise.all([api('map?id=' + id), api('maptiles?id=' + id)]);
  const names = (tiles.tileset && tiles.tileset.names) || [];
  const [sheets, plx] = await Promise.all([
    Promise.all(names.map(loadTileSheet)),
    tiles.parallax && tiles.parallax.show && tiles.parallax.name ? new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = img('parallaxes', tiles.parallax.name); }) : null,
  ]);
  const w = m.width, h = m.height;
  const data = tiles.data.slice(0, w * h * 6);
  while (data.length < w * h * 6) data.push(0);
  ME = {
    id, m, w, h, data, sheets, hash: tiles.hash, missing: tiles.missing || [], tileset: tiles.tileset,
    flags: (tiles.tileset && tiles.tileset.flags) || [],
    hasTiles: sheets.some(Boolean),
    mode: ['tiles', 'regions'].includes(mode) ? mode : 'events',
    tool: 'pen', layer: -1, region: 1, tab: null,
    sel: { w: 1, h: 1, ids: [[0]] }, selRect: null,
    undo: [], redo: [], seq: 0, savedTop: 0,
    C: Math.max(8, Math.min(48, Math.floor(4096 / Math.max(w, h)))),
    D: 0, grid: false, embed,
  };
  if (embed) ME.mode = 'events';
  try { ME.grid = localStorage.getItem('studio.grid') === '1'; } catch { }
  if (embed) {
    main.innerHTML = `<div class="mapembed">
      <div class="tools" id="tools"></div>
      <div class="mapedit" id="mapedit"><div>
        <div class="board ${S.labels ? 'labels' : ''} ${ME.hasTiles ? 'tiled' : ''}" id="board"><div class="stage" id="stage">
          <canvas id="cvBase"></canvas><canvas id="cvOver"></canvas><div class="hit" id="hit"></div><div class="evlayer" id="evlayer"></div><div class="cursorbox hidden" id="cbox"></div>
        </div></div>
        <div class="status" id="status"></div>
      </div><aside class="palette hidden" id="palette" aria-label="图块"></aside></div>
    </div>`;
    return mountBoard(plx, w, h);
  }
  const parentChain = []; { const byId = new Map(S.maps.map(x => [x.id, x])); let x = byId.get(m.props.parentId); while (x) { parentChain.unshift(x); x = byId.get(x.parentId); } }
  main.innerHTML = `<div class="page wide">
    <div class="crumbs">${parentChain.map(x => `<a href="#/map/${x.id}">${esc(x.name)}</a><span>›</span>`).join('')}</div>
    <div class="titlebar"><h1><span class="id num">地图 ${m.id}</span>${esc(m.name)}</h1>${m.displayName ? `<span class="tag">显示名：${esc(m.displayName)}</span>` : ''}
      <span class="sp"></span>
      <button class="small" id="mapPlay" title="跳过标题，直接从这张地图开始（开始地图就站在开始位置，别的地图找一格能站的）">▶ 在这里试玩</button>
      <button class="small" id="mapProps">地图属性</button>
      ${moreMenu([{ id: 'mapChild', label: '新建子地图' }, { id: 'mapCopy', label: '复制这张地图' }, { id: 'mapDel', label: '删除这张地图', danger: true }])}
    </div>
    <div class="meta"><span class="num">${w} × ${h}</span><span>${esc(m.tileset)}</span>${m.bgm ? `<span>BGM：${esc(m.bgm)}</span>` : ''}${m.parallax ? `<span>远景：${esc(m.parallax)}</span>` : ''}<span>${m.events.length} 个事件</span></div>
    ${ME.missing.length ? `<div class="warnline">图块集里有 ${ME.missing.length} 张图在 img/tilesets 里找不到：${ME.missing.map(esc).join('、')}。用到它们的格子会是空的。</div>` : ''}
    ${!ME.hasTiles ? `<div class="warnline">这张地图的图块集没有可用的图片，只能编辑事件和区域。</div>` : ''}
    <div class="maptop">
      <div class="seg" id="mmode" role="tablist">
        <button data-mode="events">事件</button><button data-mode="tiles" ${ME.hasTiles ? '' : 'disabled'}>图块</button><button data-mode="regions">区域</button>
      </div>
      <span class="dim" id="modeHint"></span>
      <span class="stagenote" id="stageNote" hidden></span>
      <span class="sp"></span>
      <label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;font-size:12.5px"><input type="checkbox" id="gridToggle" ${ME.grid ? 'checked' : ''}> 网格</label>
      <label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;font-size:12.5px"><input type="checkbox" id="lblToggle" ${S.labels ? 'checked' : ''}> 事件名</label>
    </div>
    <div class="tools" id="tools"></div>
    <div class="mapedit" id="mapedit">
      <div>
        <div class="board ${S.labels ? 'labels' : ''} ${ME.hasTiles ? 'tiled' : ''}" id="board">
          <div class="stage" id="stage">
            <canvas id="cvBase"></canvas><canvas id="cvOver"></canvas>
            <div class="hit" id="hit"></div>
            <div class="evlayer" id="evlayer"></div>
            <div class="cursorbox hidden" id="cbox"></div>
          </div>
        </div>
        <div class="status" id="status"></div>
      </div>
      <aside class="palette hidden" id="palette" aria-label="图块"></aside>
    </div>
    <div id="evTableBox" style="margin-top:14px"></div>
  </div>`;
  $('#gridToggle').onchange = e => { ME.grid = e.target.checked; try { localStorage.setItem('studio.grid', ME.grid ? '1' : '0'); } catch { } drawOverlay(); };
  $('#lblToggle').onchange = e => { S.labels = e.target.checked; remember(); $('#board').classList.toggle('labels', S.labels); };
  $('#mapProps').onclick = () => mapPropsDialog();
  bindMenu(main);
  $('#mapChild').onclick = () => newMapDialog(id);
  $('#mapPlay').onclick = () => { const st = S.project.start || {}; playGame(st.map === id ? { map: id, x: st.x, y: st.y } : { map: id, x: -1, y: -1 }); };
  $('#mapCopy').onclick = () => copyMap();
  $('#mapDel').onclick = () => deleteMap();
  $$('#mmode button').forEach(b => b.onclick = () => setMapMode(b.dataset.mode));
  await mountBoard(plx, w, h);
}
// 画布、事件层、缩放：独立页面和嵌入用同一套
async function mountBoard(plx, w, h) {
  const cv = $('#cvBase'), ov = $('#cvOver');
  cv.width = ov.width = w * ME.C; cv.height = ov.height = h * ME.C;
  ME.ctx = cv.getContext('2d'); ME.octx = ov.getContext('2d');
  ME.ctx.imageSmoothingEnabled = false;
  if (plx) {
    // 远景（地图属性里勾了「在编辑器里显示」）：从地图左上角开始平铺，和 RPG Maker 编辑器一样
    ME.plxPattern = ME.ctx.createPattern(plx, 'repeat');
    const k = ME.C / 48;
    if (k !== 1 && ME.plxPattern.setTransform) ME.plxPattern.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
  }
  drawAllCells();
  bindStage();
  setMapMode(ME.mode, true);
  if (S.stage) await applyMapStage();
  // 初始缩放：宽高都尽量放得下（先摆好调色板，再量地图区域的大小）
  const board = $('#board');
  if (!board) return;   // 等进度的时候已经换到别的页面了
  const fit = Math.floor(Math.min((board.clientWidth - 4) / w, (board.clientHeight - 4) / h));
  setZoom(Math.max(8, Math.min(48, fit)));
}

// ---------- 画 ----------
const idx = (z, x, y) => (z * ME.h + y) * ME.w + x;
// 一格的画法和游戏一样（TM.drawSpot = 引擎的 Tilemap._addSpot）：远景在最底下，☆ 图块在最上面，桌子下面一格有桌沿
function drawCell(x, y) {
  const { ctx, C } = ME;
  const dx = x * C, dy = y * C;
  ctx.fillStyle = '#000'; ctx.fillRect(dx, dy, C, C);
  if (ME.plxPattern) { ctx.fillStyle = ME.plxPattern; ctx.fillRect(dx, dy, C, C); }
  if (!ME.hasTiles) { if (!ME.plxPattern) { ctx.fillStyle = '#10151c'; ctx.fillRect(dx + 1, dy + 1, C - 2, C - 2); } return; }
  TM.drawSpot(ctx, ME.sheets, ME.flags, ME.data, ME.w, ME.h, x, y, dx, dy, C);
}
function drawOverCell(x, y) {
  const { octx: o, C } = ME;
  const dx = x * C, dy = y * C;
  o.clearRect(dx, dy, C, C);
  if (ME.mode === 'regions') {
    const r = ME.data[idx(5, x, y)];
    if (r) {
      o.fillStyle = regionColor(r); o.fillRect(dx, dy, C, C);
      if (C >= 24) { o.fillStyle = '#fff'; o.font = `600 ${Math.round(C * 0.38)}px sans-serif`; o.textAlign = 'center'; o.textBaseline = 'middle'; o.fillText(String(r), dx + C / 2, dy + C / 2 + 1); }
    }
  }
  if (ME.grid || ME.mode === 'regions' || !ME.hasTiles) { o.strokeStyle = 'rgba(255,255,255,.12)'; o.lineWidth = 1; o.strokeRect(dx + 0.5, dy + 0.5, C - 1, C - 1); }
}
function drawAllCells() { for (let y = 0; y < ME.h; y++) for (let x = 0; x < ME.w; x++) drawCell(x, y); drawOverlay(); }
function drawOverlay() { ME.octx.clearRect(0, 0, ME.w * ME.C, ME.h * ME.C); for (let y = 0; y < ME.h; y++) for (let x = 0; x < ME.w; x++) drawOverCell(x, y); }
function redrawIdx(list) {
  const n = ME.w * ME.h, done = new Set();
  const one = c => { if (done.has(c)) return; done.add(c); const x = c % ME.w, y = Math.floor(c / ME.w); drawCell(x, y); drawOverCell(x, y); };
  for (const i of list) { const c = i % n; one(c); if (c + ME.w < n) one(c + ME.w); }
}

function setZoom(D) {
  ME.D = D;
  const st = $('#stage');
  st.style.width = ME.w * D + 'px'; st.style.height = ME.h * D + 'px';
  st.classList.toggle('smooth', D < ME.C);        // 缩小显示时平滑，放大时保持像素
  st.classList.toggle('smoothspr', D < 48);
  $('#board').classList.toggle('short', ME.h * D + 4 < $('#board').clientHeight);
  if ($('#zoomV')) $('#zoomV').textContent = Math.round(D / 48 * 100) + '%';
  layoutEvents();
}
function zoomStep(dir) {
  let i = ZOOMS.findIndex(z => z >= ME.D);
  if (i < 0) i = ZOOMS.length - 1;
  if (dir > 0) i = ZOOMS[i] > ME.D ? i : Math.min(ZOOMS.length - 1, i + 1); else i = Math.max(0, ZOOMS[i] < ME.D ? i : i - 1);
  setZoom(ZOOMS[i]);
}

// ---------- 事件层 ----------
function layoutEvents() {
  const layer = $('#evlayer');
  if (!layer) return;
  const D = ME.D;
  layer.innerHTML = '';
  for (const e of ME.m.events) {
    const b = document.createElement('button');
    b.className = 'evbtn';
    b.dataset.ev = e.id;
    b.style.left = e.x * D + 'px'; b.style.top = e.y * D + 'px';
    b.style.width = b.style.height = Math.max(6, D) + 'px';
    b.style.zIndex = 10 + e.y;
    // 顶栏选了进度：这时不出现的变暗；图像和点开的那一页都换成那时显示的那一页
    const cell = stageCellOf(ME.stageCells, e.id);
    // 嵌在剧情进度里：这一天有专门的剧情页就画那一页（不一定的页后面藏着的也算）
    const special = ME.embed && cell ? stageSpecific(ME.stageCells, e.id) : -1;
    const mark = ME.embed && S.stage && ME.embed.marks ? ME.embed.marks.get(e.id) : null;
    if (cell && mark) cell.p = mark.page; else if (special >= 0) cell.p = special;
    const pg = e.pages[cell ? cell.p : 0] || e.pages[0] || {};
    b.dataset.page = cell ? cell.p : 0;
    if (cell === null) b.classList.add('off'); else if (cell && !cell.s) b.classList.add('maybe');
    // 嵌在剧情进度里：这一段不出现的事件不画（可以切换），有剧情的描边，跟进度无关的淡一点
    if (ME.embed && S.stage && ME.stageCells && ME.stageCells.axis) {
      if (cell === null && !ME.embed.showOff && !mark) continue;
      if (mark) { b.classList.add(mark.cls); b.dataset.page = mark.page; b.title += mark.cls === 'req' ? '\n必要：自动播 / 推进剧情' : '\n支线：自己去找的'; }
      else if (cell === undefined) b.classList.add('bg');
      else if (special >= 0) b.classList.add('story');
      if (ME.embed.selected === e.id) b.classList.add('on');
    }
    const stg = cell === null ? '\n这个进度不出现' : cell ? `\n这个进度显示第 ${cell.p + 1} 页${cell.s ? '' : '（不一定，还要看别的条件）'}` : '';
    const trig = e.pages.some(p => p.trigger === 3) ? 'auto' : e.pages.some(p => p.trigger === 4) ? 'par' : '';
    b.title = `${e.id} ${e.name}\n${pg.first || (e.pages.find(p => p.first) || {}).first || ''}${stg}\n拖动可以换位置`;
    b.setAttribute('aria-label', `事件 ${e.id} ${e.name}`);
    b.innerHTML = `<span class="spr"></span>${trig ? `<span class="mk ${trig}"></span>` : ''}<span class="lb">${esc(e.name)}</span>`;
    eventGraphic($('.spr', b), pg.image, D).then(ok => { if (!ok) { b.classList.add('noimg'); if (D >= 14) b.insertAdjacentHTML('afterbegin', `<span class="glyph">${esc((e.name || '?').slice(0, 1))}</span>`); } });
    bindEventDrag(b, e);
    layer.appendChild(b);
  }
}
// 事件图像，和游戏里 Sprite_Character 的摆法一样：原大，水平居中、底边贴着格子底边；
// 人物往上抬 6 像素（名字带 ! 的物件、图块事件不抬）
async function eventGraphic(el, image, D) {
  if (!image) return false;
  const k = D / 48;
  if (image.tileId > 0) {
    if (!ME.hasTiles) return false;
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    if (!TM.drawTile(x, ME.sheets, image.tileId, 0, 0, 48, ME.flags)) return false;
    Object.assign(el.style, { width: D + 'px', height: D + 'px', left: '0px', bottom: '0px' });
    c.style.width = c.style.height = '100%';
    el.appendChild(c);
    return true;
  }
  if (!image.characterName) return false;
  const sheet = await loadSheet(image.characterName);
  if (!sheet) return false;
  const big = /^[!]*\$/.test(image.characterName);
  const pw = sheet.naturalWidth / (big ? 3 : 12), ph = sheet.naturalHeight / (big ? 4 : 8);
  const ci = big ? 0 : image.characterIndex || 0;
  const col = (ci % 4) * 3 + (image.pattern == null ? 1 : image.pattern);
  const row = Math.floor(ci / 4) * 4 + Math.max(0, (image.direction || 2) / 2 - 1);
  const shift = /^[!$]*!/.test(image.characterName) ? 0 : 6;
  Object.assign(el.style, {
    width: pw * k + 'px', height: ph * k + 'px',
    left: (D - pw * k) / 2 + 'px', bottom: shift * k + 'px',
    backgroundImage: `url("${sheet.src}")`,
    backgroundSize: `${sheet.naturalWidth * k}px ${sheet.naturalHeight * k}px`,
    backgroundPosition: `${-col * pw * k}px ${-row * ph * k}px`,
  });
  return true;
}
function cellFromPoint(ev) {
  const r = $('#stage').getBoundingClientRect();
  return { x: Math.floor((ev.clientX - r.left) / ME.D), y: Math.floor((ev.clientY - r.top) / ME.D) };
}
const inMap = p => p.x >= 0 && p.y >= 0 && p.x < ME.w && p.y < ME.h;
const eventAt = p => ME.m.events.find(e => e.x === p.x && e.y === p.y);
function showBox(x, y, w, h, cls) {
  const b = $('#cbox');
  if (x == null) { b.classList.add('hidden'); return; }
  b.className = 'cursorbox ' + (cls || '');
  b.style.left = x * ME.D + 'px'; b.style.top = y * ME.D + 'px';
  b.style.width = w * ME.D + 'px'; b.style.height = h * ME.D + 'px';
}
// 拖事件换位置；不拖就是打开
function bindEventDrag(b, e) {
  if (ME.embed) {
    b.onclick = ev => { ev.preventDefault(); if (ME.embed.onEvent) ME.embed.onEvent(e, Number(b.dataset.page || 0), b); };
    return;
  }
  let start = null, dragging = false;
  b.onpointerdown = ev => { if (ev.button !== 0) return; start = { x: ev.clientX, y: ev.clientY }; dragging = false; b.setPointerCapture(ev.pointerId); };
  b.onpointermove = ev => {
    if (!start) return;
    if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 5) { dragging = true; b.classList.add('dragging'); }
    if (dragging) { const p = cellFromPoint(ev); const free = inMap(p) && (!eventAt(p) || eventAt(p) === e); showBox(p.x, p.y, 1, 1, free ? 'drop' : 'erase'); }
  };
  b.onpointerup = async ev => {
    if (!start) return;
    start = null; b.classList.remove('dragging'); showBox(null);
    if (!dragging) { location.hash = `#/event/${ME.id}/${e.id}/${b.dataset.page || 0}`; return; }
    const p = cellFromPoint(ev);
    if (!inMap(p) || (p.x === e.x && p.y === e.y)) return;
    if (eventAt(p)) { toast(`(${p.x}, ${p.y}) 已经有事件了`, true); return; }
    try { await api('event/update', { map: ME.id, ev: e.id, x: p.x, y: p.y }); e.x = p.x; e.y = p.y; layoutEvents(); toast(`已把事件 ${e.id} 挪到 (${p.x}, ${p.y})`); }
    catch (err) { toast(err.message, true); }
  };
  b.onclick = ev => ev.preventDefault();
}

// ---------- 模式 / 工具栏 ----------
function setMapMode(mode, first) {
  if (mode === 'tiles' && !ME.hasTiles) mode = 'events';
  ME.mode = mode;
  const h = `#/map/${ME.id}` + (mode === 'events' ? '' : '/' + mode);
  if (!ME.embed && location.hash !== h) { history.replaceState(null, '', h); lastHash = location.hash; }
  $$('#mmode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  const ed = $('#mapedit');
  ed.className = 'mapedit mode-' + mode + (mode === 'events' ? '' : ' withpal');
  $('#board').className = 'board mode-' + mode + (S.labels ? ' labels' : '') + (ME.hasTiles ? ' tiled' : '');
  if ($('#modeHint')) $('#modeHint').textContent = mode === 'events' ? '点事件打开，拖动换位置，点空格子新建事件'
    : mode === 'tiles' ? '左键画，右键吸取；B 铅笔 R 矩形 G 油漆桶 E 橡皮 I 吸管；Ctrl+Z 撤销，Ctrl+S 保存'
    : '区域编号给插件和遇敌用；左键刷，右键吸取';
  $('#palette').classList.toggle('hidden', mode === 'events');
  if (ME.tool === 'eraser' && mode === 'events') ME.tool = 'pen';
  drawTools(); drawPalette(); drawOverlay(); showBox(null);
  drawEventTable();
  if (ME.D) setZoom(ME.D);
}
function drawTools() {
  const box = $('#tools');
  if (ME.embed) { box.innerHTML = zoomTools() + (ME.embed.tools || ''); bindZoom(); if (ME.embed.onTools) ME.embed.onTools(box); return; }
  if (ME.mode === 'events') { box.innerHTML = zoomTools() + saveTools(); bindTools(); return; }
  const T = [['pen', '铅笔'], ['rect', '矩形'], ['fill', '油漆桶'], ['eraser', '橡皮'], ['pick', '吸管']];
  const layers = [[-1, '自动'], [0, '1'], [1, '2'], [2, '3'], [3, '4']];
  box.innerHTML = `<div class="grp">${T.map(([k, t]) => `<button data-tool="${k}" class="${ME.tool === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${ME.mode === 'tiles' ? `<span class="lbl">图层</span><div class="grp" title="自动：A 页画地面，B~E 叠在上面">${layers.map(([k, t]) => `<button data-layer="${k}" class="${ME.layer === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
    <div class="grp"><button id="undoB" ${ME.undo.length ? '' : 'disabled'}>撤销</button><button id="redoB" ${ME.redo.length ? '' : 'disabled'}>重做</button></div>
    ${zoomTools()}${saveTools()}`;
  $$('[data-tool]', box).forEach(b => b.onclick = () => { ME.tool = b.dataset.tool; drawTools(); });
  $$('[data-layer]', box).forEach(b => b.onclick = () => { ME.layer = Number(b.dataset.layer); drawTools(); });
  $('#undoB').onclick = undo; $('#redoB').onclick = redo;
  bindTools();
}
const zoomTools = () => `<span class="lbl">缩放</span><div class="grp"><button id="zOut" aria-label="缩小">−</button><span class="zoomv" id="zoomV" style="padding:5px 4px">${Math.round(ME.D / 48 * 100)}%</span><button id="zIn" aria-label="放大">+</button><button id="z100" title="一格 48 像素，和游戏里一样大">原大</button><button id="zFit">适合</button></div>`;
const saveTools = () => `<span class="sp" style="flex:1"></span><span class="dim" id="dirtyNote" style="font-size:12.5px"></span><button class="quiet small" id="discardB">放弃修改</button><button class="primary small" id="saveB">保存地图</button>`;
function bindZoom() {
  $('#zOut').onclick = () => zoomStep(-1); $('#zIn').onclick = () => zoomStep(1); $('#z100').onclick = () => setZoom(48);
  $('#zFit').onclick = () => { const b = $('#board'); setZoom(Math.max(8, Math.min(96, Math.floor(Math.min((b.clientWidth - 4) / ME.w, (b.clientHeight - 4) / ME.h))))); };
}
function bindTools() {
  bindZoom();
  $('#saveB').onclick = saveTiles;
  $('#discardB').onclick = async () => { if (!await confirmDialog('放弃修改', '把这张地图恢复到上次保存的样子？', '放弃修改')) return; S.dirty = false; render(); };
  updateDirty();
}
const topId = () => (ME.undo.length ? ME.undo[ME.undo.length - 1].id : 0);
function updateDirty() {
  S.dirty = topId() !== ME.savedTop;
  if ($('#saveB')) { $('#saveB').disabled = !S.dirty; $('#discardB').disabled = !S.dirty; }
  if ($('#dirtyNote')) $('#dirtyNote').textContent = S.dirty ? `有 ${ME.undo.length} 步没保存` : '';
  if ($('#undoB')) { $('#undoB').disabled = !ME.undo.length; $('#redoB').disabled = !ME.redo.length; }
}

// ---------- 调色板 ----------
function drawPalette() {
  const pal = $('#palette');
  if (ME.mode === 'events') { pal.innerHTML = ''; return; }
  const P = 48;
  if (ME.mode === 'regions') {
    pal.innerHTML = `<div class="pscroll"><div class="pwrap"><canvas id="pcv"></canvas><div class="psel" id="psel"></div></div></div><div class="pinfo" id="pinfo"></div>`;
    const cv = $('#pcv'); cv.width = 8 * P; cv.height = 32 * P;
    const c = cv.getContext('2d');
    for (let r = 0; r < 256; r++) {
      const x = (r % 8) * P, y = Math.floor(r / 8) * P;
      c.fillStyle = r ? regionColor(r) : '#151a22'; c.fillRect(x + 2, y + 2, P - 4, P - 4);
      c.fillStyle = r ? '#fff' : '#6b7587'; c.font = '600 17px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(r ? String(r) : '无', x + P / 2, y + P / 2 + 1);
    }
    const mark = () => { const s = $('#psel'); s.style.left = (ME.region % 8) / 8 * 100 + '%'; s.style.top = Math.floor(ME.region / 8) / 32 * 100 + '%'; s.style.width = 100 / 8 + '%'; s.style.height = 100 / 32 + '%'; $('#pinfo').textContent = ME.region ? `区域 ${ME.region}` : '无区域（等于橡皮）'; };
    cv.onpointerdown = ev => { const r = cv.getBoundingClientRect(); const col = Math.floor((ev.clientX - r.left) / (r.width / 8)), row = Math.floor((ev.clientY - r.top) / (r.height / 32)); ME.region = Math.max(0, Math.min(255, row * 8 + col)); if (ME.tool === 'eraser' || ME.tool === 'pick') { ME.tool = 'pen'; drawTools(); } mark(); };
    mark();
    return;
  }
  const tabs = TM.paletteTabs(ME.tileset ? ME.tileset.names.map((n, i) => (ME.sheets[i] ? n : '')) : []);
  if (!tabs.length) { pal.innerHTML = '<div class="pempty">这个图块集没有可用的图片</div>'; return; }
  if (!ME.tab || !tabs.some(t => t.key === ME.tab)) ME.tab = tabs[0].key;
  const tab = tabs.find(t => t.key === ME.tab);
  const rows = Math.ceil(tab.cells.length / 8);
  pal.innerHTML = `<div class="ptabs">${tabs.map(t => `<button data-tab="${t.key}" class="${t.key === ME.tab ? 'on' : ''}">${t.key}</button>`).join('')}</div>
    <div class="pscroll"><div class="pwrap"><canvas id="pcv"></canvas><div class="psel hidden" id="psel"></div></div></div><div class="pinfo" id="pinfo"></div>`;
  $$('[data-tab]', pal).forEach(b => b.onclick = () => { ME.tab = b.dataset.tab; drawPalette(); });
  const cv = $('#pcv'); cv.width = 8 * P; cv.height = rows * P;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  tab.cells.forEach((id, k) => {
    const x = (k % 8) * P, y = Math.floor(k / 8) * P;
    if (id === 0) { c.strokeStyle = '#5a6475'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 12, y + 12); c.lineTo(x + P - 12, y + P - 12); c.moveTo(x + P - 12, y + 12); c.lineTo(x + 12, y + P - 12); c.stroke(); return; }
    TM.drawTile(c, ME.sheets, TM.previewId(id), x, y, P, ME.flags);
  });
  // 选中框：如果当前选的就在这一页，标出来
  const mark = () => {
    const s = $('#psel'), r = ME.selRect;
    if (!r || r.tab !== ME.tab) { s.classList.add('hidden'); } else {
      s.classList.remove('hidden');
      s.style.left = r.c / 8 * 100 + '%'; s.style.top = r.r / rows * 100 + '%';
      s.style.width = r.w / 8 * 100 + '%'; s.style.height = r.h / rows * 100 + '%';
    }
    const one = ME.sel.w * ME.sel.h === 1;
    $('#pinfo').textContent = one ? '已选：' + tileLabel(ME.sel.ids[0][0]) : `已选 ${ME.sel.w} × ${ME.sel.h} 格`;
  };
  let a = null;
  const cellOf = ev => { const r = cv.getBoundingClientRect(); return { c: Math.max(0, Math.min(7, Math.floor((ev.clientX - r.left) / (r.width / 8)))), r: Math.max(0, Math.min(rows - 1, Math.floor((ev.clientY - r.top) / (r.height / rows)))) }; };
  const setSel = (p, q) => {
    const c0 = Math.min(p.c, q.c), r0 = Math.min(p.r, q.r), w = Math.abs(p.c - q.c) + 1, h = Math.abs(p.r - q.r) + 1;
    const ids = [];
    for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push(tab.cells[(r0 + y) * 8 + c0 + x] || 0); ids.push(row); }
    ME.sel = { w, h, ids }; ME.selRect = { tab: ME.tab, c: c0, r: r0, w, h };
    mark();
  };
  cv.onpointerdown = ev => { a = cellOf(ev); cv.setPointerCapture(ev.pointerId); setSel(a, a); if (ME.tool === 'eraser' || ME.tool === 'pick') { ME.tool = 'pen'; drawTools(); } };
  cv.onpointermove = ev => { if (a) setSel(a, cellOf(ev)); };
  cv.onpointerup = () => { a = null; };
  mark();
}
// 吸管选中的图块：在调色板里找到它所在的位置
function selectTile(id) {
  const base = TM.isAuto(id) ? TM.kindBase(TM.kindOf(id)) : id;
  ME.sel = { w: 1, h: 1, ids: [[base]] };
  ME.selRect = null;
  const tabs = TM.paletteTabs(ME.tileset ? ME.tileset.names.map((n, i) => (ME.sheets[i] ? n : '')) : []);
  for (const t of tabs) { const k = t.cells.indexOf(base); if (k >= 0) { ME.tab = t.key; ME.selRect = { tab: t.key, c: k % 8, r: Math.floor(k / 8), w: 1, h: 1 }; break; } }
  drawPalette();
}

// ---------- 画图块 / 区域 ----------
function commit(changes) {
  if (!changes.length) return;
  ME.undo.push({ id: ++ME.seq, ch: changes });
  if (ME.undo.length > 300) ME.undo.shift();
  ME.redo = [];
  updateDirty();
}
// 在 (x, y) 盖一个「章」：选中的图块块（橡皮 = 空），返回改动
function stampAt(x, y, out, cells, pattern) {
  const sel = ME.sel;
  if (ME.mode === 'regions') {
    if (!inMap({ x, y })) return;
    const i = idx(5, x, y), v = ME.tool === 'eraser' ? 0 : ME.region;
    if (ME.data[i] !== v) { out.push([i, ME.data[i], v]); ME.data[i] = v; cells.push([x, y]); }
    return;
  }
  const w = pattern ? 1 : sel.w, h = pattern ? 1 : sel.h;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    const cx = x + dx, cy = y + dy;
    if (!inMap({ x: cx, y: cy })) continue;
    const id = ME.tool === 'eraser' ? 0 : pattern ? pattern(cx, cy) : sel.ids[dy][dx];
    const ch = TM.place(ME.data, ME.w, ME.h, cx, cy, id, ME.layer);
    if (ch.length) { out.push(...ch); cells.push([cx, cy]); }
  }
}
function finishStamp(out, cells) {
  if (ME.mode === 'tiles' && cells.length) out.push(...TM.refreshAuto(ME.data, ME.w, ME.h, cells));
  redrawIdx(out.map(c => c[0]));
}
// 油漆桶：和起点「一样」的相连格子（四个方向）
function floodCells(x0, y0) {
  const key = (x, y) => {
    if (ME.mode === 'regions') return ME.data[idx(5, x, y)];
    const k = v => (TM.isAuto(v) ? 'k' + TM.kindOf(v) : String(v));
    if (ME.layer >= 0) return k(ME.data[idx(ME.layer, x, y)]);
    const first = ME.sel.ids[0][0];
    if (ME.tool !== 'eraser' && TM.isATile(first)) return k(ME.data[idx(0, x, y)]);
    return k(ME.data[idx(0, x, y)]) + '|' + ME.data[idx(2, x, y)] + '|' + ME.data[idx(3, x, y)];
  };
  const want = key(x0, y0), seen = new Uint8Array(ME.w * ME.h), out = [], q = [[x0, y0]];
  seen[y0 * ME.w + x0] = 1;
  while (q.length && out.length < 65536) {
    const [x, y] = q.pop();
    out.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ME.w || ny >= ME.h || seen[ny * ME.w + nx]) continue;
      seen[ny * ME.w + nx] = 1;
      if (key(nx, ny) === want) q.push([nx, ny]);
    }
  }
  return out;
}
function pickAt(p) {
  if (ME.mode === 'regions') { ME.region = ME.data[idx(5, p.x, p.y)]; drawPalette(); toast(ME.region ? '已吸取区域 ' + ME.region : '这一格没有区域'); return; }
  const id = ME.layer >= 0 ? ME.data[idx(ME.layer, p.x, p.y)] : TM.topTile(ME.data, ME.w, ME.h, p.x, p.y);
  selectTile(id);
  if (ME.tool === 'pick' || ME.tool === 'eraser') { ME.tool = 'pen'; drawTools(); }
}
function bindStage() {
  const hit = $('#hit');
  let drag = null;
  hit.oncontextmenu = ev => ev.preventDefault();
  hit.onpointerdown = ev => {
    const p = cellFromPoint(ev);
    if (!inMap(p)) return;
    if (ev.button === 1) {   // 中键拖动画面
      const b = $('#board'); drag = { pan: true, x: ev.clientX, y: ev.clientY, sl: b.scrollLeft, st: b.scrollTop };
      hit.setPointerCapture(ev.pointerId); ev.preventDefault(); return;
    }
    if (ME.mode === 'events') {
      if (ev.button !== 0 || eventAt(p)) return;
      if (ME.embed) { if (ME.embed.onEmpty) ME.embed.onEmpty(p); } else newEventPopover(p);
      return;
    }
    if (ev.button === 2 || ME.tool === 'pick') { pickAt(p); return; }
    if (ev.button !== 0) return;
    hit.setPointerCapture(ev.pointerId);
    if (ME.tool === 'fill') {
      const out = [], cells = [];
      const sel = ME.sel;
      const pattern = (x, y) => sel.ids[((y - p.y) % sel.h + sel.h) % sel.h][((x - p.x) % sel.w + sel.w) % sel.w];
      for (const [x, y] of floodCells(p.x, p.y)) stampAt(x, y, out, cells, pattern);
      finishStamp(out, cells); commit(out);
      return;
    }
    if (ME.tool === 'rect') { drag = { rect: true, a: p, b: p }; showRectBox(drag); return; }
    drag = { pen: true, out: [], last: null };
    penTo(drag, p);
  };
  hit.onpointermove = ev => {
    const p = cellFromPoint(ev);
    if (drag && drag.pan) { const b = $('#board'); b.scrollLeft = drag.sl - (ev.clientX - drag.x); b.scrollTop = drag.st - (ev.clientY - drag.y); return; }
    status(p);
    if (!inMap(p)) { if (!drag) showBox(null); return; }
    if (drag && drag.rect) { drag.b = p; showRectBox(drag); return; }
    if (drag && drag.pen) { penTo(drag, p); return; }
    if (ME.mode === 'events') { showBox(eventAt(p) ? null : p.x, p.y, 1, 1, 'drop'); return; }
    const one = ME.mode === 'regions' || ME.tool === 'fill' || ME.tool === 'pick';
    showBox(p.x, p.y, one ? 1 : ME.sel.w, one ? 1 : ME.sel.h, ME.tool === 'eraser' ? 'erase' : '');
  };
  hit.onpointerup = ev => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.pen) { commit(d.out); return; }
    if (d.rect) {
      const x0 = Math.min(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), x1 = Math.max(d.a.x, d.b.x), y1 = Math.max(d.a.y, d.b.y);
      const out = [], cells = [], sel = ME.sel;
      const pattern = (x, y) => sel.ids[(y - y0) % sel.h][(x - x0) % sel.w];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) stampAt(x, y, out, cells, pattern);
      finishStamp(out, cells); commit(out);
      showBox(null);
    }
  };
  hit.onpointerleave = () => { if (!drag) showBox(null); };
  $('#board').onwheel = ev => { if (!(ev.ctrlKey || ev.metaKey)) return; ev.preventDefault(); zoomStep(ev.deltaY < 0 ? 1 : -1); };
}
function penTo(d, p) {
  if (d.last && d.last.x === p.x && d.last.y === p.y) return;
  // 鼠标移得快时把中间的格子补上
  const pts = [];
  if (d.last) { const n = Math.max(Math.abs(p.x - d.last.x), Math.abs(p.y - d.last.y)); for (let k = 1; k <= n; k++) pts.push({ x: Math.round(d.last.x + (p.x - d.last.x) * k / n), y: Math.round(d.last.y + (p.y - d.last.y) * k / n) }); }
  else pts.push(p);
  const out = [], cells = [];
  for (const q of pts) stampAt(q.x, q.y, out, cells);
  finishStamp(out, cells);
  d.out.push(...out);
  d.last = p;
}
function showRectBox(d) { showBox(Math.min(d.a.x, d.b.x), Math.min(d.a.y, d.b.y), Math.abs(d.a.x - d.b.x) + 1, Math.abs(d.a.y - d.b.y) + 1, ME.tool === 'eraser' ? 'erase' : ''); }
function status(p) {
  const s = $('#status');
  if (!s) return;
  if (!inMap(p)) { s.innerHTML = ''; return; }
  const e = eventAt(p);
  const layers = [0, 1, 2, 3].map(z => ME.data[idx(z, p.x, p.y)]);
  s.innerHTML = `<span><b class="num">(${p.x}, ${p.y})</b></span>` +
    (ME.mode === 'tiles' ? layers.map((v, z) => v ? `<span>第 ${z + 1} 层：${esc(tileLabel(v))}</span>` : '').join('') : '') +
    `<span>区域 ${ME.data[idx(5, p.x, p.y)] || '无'}</span>` + (e ? `<span>事件 ${e.id}「${esc(e.name)}」</span>` : '');
}
function undo() {
  const u = ME.undo.pop(); if (!u) return;
  for (let k = u.ch.length - 1; k >= 0; k--) ME.data[u.ch[k][0]] = u.ch[k][1];
  ME.redo.push(u); redrawIdx(u.ch.map(c => c[0])); updateDirty();
}
function redo() {
  const u = ME.redo.pop(); if (!u) return;
  for (const c of u.ch) ME.data[c[0]] = c[2];
  ME.undo.push(u); redrawIdx(u.ch.map(c => c[0])); updateDirty();
}
async function saveTiles() {
  if (!S.dirty) return;
  $('#saveB').disabled = true;
  try {
    const r = await api('map/tiles', { map: ME.id, data: ME.data, hash: ME.hash });
    ME.hash = r.hash; ME.savedTop = topId(); updateDirty();
    toast('已保存地图');
  } catch (e) { toast(e.message, true); updateDirty(); }
}
document.addEventListener('keydown', e => {
  if (!ME || route().name !== 'map' || !$('#stage') || $('#dlg').open) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 's') { e.preventDefault(); saveTiles(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod || ME.mode === 'events') return;
  const tool = { b: 'pen', p: 'pen', r: 'rect', g: 'fill', e: 'eraser', i: 'pick' }[k];
  if (tool) { ME.tool = tool; drawTools(); }
  if (k === '=' || k === '+') zoomStep(1);
  if (k === '-') zoomStep(-1);
});

// 点空格子新建事件
function newEventPopover(p) {
  $$('.newpop').forEach(x => x.remove());
  const pop = document.createElement('div');
  pop.className = 'newpop';
  pop.style.left = Math.max(0, Math.min(p.x * ME.D + ME.D + 6, ME.w * ME.D - 236)) + 'px';
  pop.style.top = Math.max(0, p.y * ME.D - 8) + 'px';
  pop.innerHTML = `<div class="dim" style="font-size:12.5px">在 (${p.x}, ${p.y}) 新建事件</div>
    <div class="row"><input placeholder="事件名（可以不填）" maxlength="40"><button class="primary small">新建</button></div>
    <button class="quiet small" style="align-self:flex-start">取消</button>`;
  $('#stage').appendChild(pop);
  const inp = $('input', pop); inp.focus();
  const go = async () => {
    try {
      const r = await api('event/create', { map: ME.id, x: p.x, y: p.y, name: inp.value });
      toast('已新建事件 ' + r.id);
      await refreshMaps();
      location.hash = `#/event/${ME.id}/${r.id}/0`;
    } catch (e) { toast(e.message, true); }
  };
  $('button.primary', pop).onclick = go;
  $('button.quiet', pop).onclick = () => pop.remove();
  inp.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') pop.remove(); };
  pop.onpointerdown = e => e.stopPropagation();
}

function drawEventTable() {
  const box = $('#evTableBox');
  if (!box) return;
  if (ME.mode !== 'events') { box.innerHTML = ''; return; }
  const m = ME.m;
  const evRows = m.events.map(e => {
    const auto = e.pages.some(p => p.trigger === 3), par = e.pages.some(p => p.trigger === 4);
    const first = (e.pages.find(p => p.first) || {}).first || '';
    return `<tr data-ev="${e.id}"><td class="num faint">${e.id}</td>
      <td><div style="white-space:nowrap">${esc(e.name)} ${auto ? '<span class="dot auto" style="display:inline-block" title="自动执行"></span>' : ''}${par ? '<span class="dot par" style="display:inline-block" title="并行处理"></span>' : ''}</div>${e.hint ? `<span class="hint">${esc(e.hint)}</span>` : ''}</td>
      <td class="num dim hide-narrow">${e.x}, ${e.y}</td>
      <td><div class="pgpills">${e.pages.map((p, i) => `<span class="pgpill ${p.conditionText.length ? 'cond' : ''}" title="${esc(p.conditionText.join('，') || '没有条件')}">${i + 1}${p.lines ? ' · ' + p.lines + '句' : ''}</span>`).join('')}</div></td>
      <td class="first">${esc(first)}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="card" style="overflow:auto">${m.events.length ? `<table class="evtable"><thead><tr><th>#</th><th>事件</th><th class="hide-narrow">位置</th><th>页</th><th>第一句台词</th></tr></thead><tbody>${evRows}</tbody></table>` : '<div class="empty" style="border:0">这张地图还没有事件，在上面的地图里点一个空格子就能新建</div>'}</div>`;
  $$('tr[data-ev]', box).forEach(tr => tr.onclick = () => { location.hash = `#/event/${ME.id}/${tr.dataset.ev}/0`; });
}

// ---------- 地图属性 / 新建 / 复制 / 删除 ----------
async function tilesetOptions(sel) {
  const r = await api('tilesets');
  return r.tilesets.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.id} ${esc(t.name)}${t.names ? '' : '（没有图）'}</option>`).join('');
}
async function mapPropsDialog() {
  if (S.dirty) { toast('先保存或放弃图块的修改，再改地图属性', true); return; }
  const p = ME.m.props;
  const opts = await tilesetOptions(p.tilesetId);
  const r = await openDialog(`<header><h3>地图 ${ME.id} 的属性</h3></header>
    <div class="dbody"><div class="fgrid">
      <label for="mp_n">名字</label><input id="mp_n" maxlength="40" value="${esc(p.name)}">
      <label for="mp_d">显示名</label><input id="mp_d" maxlength="40" value="${esc(p.displayName)}" placeholder="进地图时左上角显示的名字">
      <label>大小</label><span style="display:flex;gap:6px;align-items:center"><input id="mp_w" type="number" class="num" min="1" max="256" style="width:90px" value="${p.width}"><span>×</span><input id="mp_h" type="number" class="num" min="1" max="256" style="width:90px" value="${p.height}"></span>
      <label for="mp_t">图块集</label><select id="mp_t">${opts}</select>
      <label for="mp_b">BGM</label><input id="mp_b" maxlength="200" value="${esc(p.autoplayBgm ? p.bgmName : '')}" placeholder="audio/bgm 里的文件名，不填 = 不自动播放">
      <label for="mp_p">远景图</label><input id="mp_p" maxlength="200" value="${esc(p.parallaxName)}" placeholder="img/parallaxes 里的文件名">
      <label for="mp_note">备注</label><textarea id="mp_note" rows="3">${esc(p.note)}</textarea>
    </div>
    <div class="fnote">改大小时左上角不动，右边和下边加宽或裁掉。裁掉的地方如果有事件，会先提示你挪进来。</div><div id="mpErr"></div></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>保存属性</button></footer>`,
    (d, done) => {
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        const v = id => $('#' + id, d).value;
        try {
          await api('map/update', { map: ME.id, name: v('mp_n'), displayName: v('mp_d'), width: Number(v('mp_w')), height: Number(v('mp_h')), tilesetId: Number(v('mp_t')), bgmName: v('mp_b'), parallaxName: v('mp_p'), note: v('mp_note') });
          done(true);
        } catch (e) { $('#mpErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (r) { toast('已保存地图属性'); await refreshMaps(); render(); }
}
async function newMapDialog(parentId) {
  if (S.dirty && !confirm('图块的修改还没保存，确定继续？')) return;
  const parent = S.maps.find(m => m.id === parentId);
  let tsId = 1;
  if (parentId && ME && ME.id === parentId) tsId = ME.m.props.tilesetId;
  const opts = await tilesetOptions(tsId);
  const r = await openDialog(`<header><h3>新建地图${parent ? `（放在「${esc(parent.name)}」下面）` : ''}</h3></header>
    <div class="dbody"><div class="fgrid">
      <label for="nm_n">名字</label><input id="nm_n" maxlength="40" placeholder="例：灯塔地下室">
      <label>大小</label><span style="display:flex;gap:6px;align-items:center"><input id="nm_w" type="number" class="num" min="1" max="256" style="width:90px" value="17"><span>×</span><input id="nm_h" type="number" class="num" min="1" max="256" style="width:90px" value="13"></span>
      <label for="nm_t">图块集</label><select id="nm_t">${opts}</select>
    </div><div class="fnote">17 × 13 正好是一屏。新地图是空的，建好后切到「图块」开始画。</div><div id="nmErr"></div></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>新建地图</button></footer>`,
    (d, done) => {
      $('#nm_n', d).focus();
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        try { const x = await api('map/create', { name: $('#nm_n', d).value, parentId, width: Number($('#nm_w', d).value), height: Number($('#nm_h', d).value), tilesetId: Number($('#nm_t', d).value) }); done(x.id); }
        catch (e) { $('#nmErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (r) { S.dirty = false; toast('已新建地图 ' + r); if (parentId) S.open.add(parentId); remember(); await refreshMaps(); location.hash = `#/map/${r}/tiles`; }
}
async function copyMap() {
  if (S.dirty) { toast('先保存或放弃图块的修改', true); return; }
  const name = await promptDialog('复制地图', '新地图的名字（图块、事件都会复制过去）', ME.m.name + ' 副本');
  if (!name) return;
  try { const r = await api('map/create', { name, parentId: ME.m.props.parentId, copyFrom: ME.id }); toast('已复制成地图 ' + r.id); await refreshMaps(); location.hash = '#/map/' + r.id; }
  catch (e) { toast(e.message, true); }
}
async function deleteMap() {
  if (ME.m.children) { toast('这张地图下面还有子地图，先删掉或挪走它们', true); return; }
  if (ME.m.isStart) { toast('这是游戏开始时所在的地图，不能删', true); return; }
  let refs = [];
  try { refs = (await api('refs?kind=map&id=' + ME.id)).refs; } catch { }
  const text = `删除地图 ${ME.id}「${ME.m.name}」？它有 ${ME.m.events.length} 个事件。` + (refs.length ? `\n另外有 ${refs.length} 处传送到这张地图（${refs.slice(0, 3).map(x => x.where).join('；')}${refs.length > 3 ? '…' : ''}），删了以后这些传送会失效。` : '') + '\n删除前会自动备份。';
  if (!await confirmDialog('删除地图', text, '删除地图')) return;
  try { S.dirty = false; await api('map/delete', { map: ME.id }); toast('已删除地图 ' + ME.id); const parent = ME.m.props.parentId; await refreshMaps(); location.hash = parent ? '#/map/' + parent : '#/'; }
  catch (e) { toast(e.message, true); }
}
async function refreshMaps() { try { await loadMaps(); } catch { } }
