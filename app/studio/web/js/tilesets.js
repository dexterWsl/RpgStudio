'use strict';
// 图块集：每页用哪张图、每一格能不能走（○ 能走 / × 挡住 / ☆ 盖在人物上面），柜台、草丛、梯子
//   #/tilesets       列表 + 新建
//   #/tilesets/3     改图块集 3：点格子切换，自动元件（A1~A4）一种一起改
const TS_MODES = [['pass', '通行', '点一下：○ 能走 → × 挡住 → ☆ 盖在人物上面'], ['counter', '柜台', '隔着柜台也能对话（店员站在柜台后面）'], ['bush', '草丛', '人走进去下半身半透明'], ['ladder', '梯子', '人在上面一直朝上']];
const TS_BIT = { counter: 0x80, bush: 0x40, ladder: 0x20 };
let TSE = null;

async function viewTilesets(main, sub) {
  main.innerHTML = '<div class="loading">正在读取图块集…</div>';
  const { tilesets } = await api('tilesets');
  if (sub) return editTileset(main, Number(sub), tilesets);
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>图块集</h1><span class="dim">地图用哪几张图块图、每一格能不能走。自己画的或者导入的图块，在这里设好通行再画地图</span></div>
    <div class="card rows">${tilesets.map(t => `<a class="rowlink" href="#/tilesets/${t.id}"><span><b class="num">${t.id}</b> ${esc(t.name || '（未命名）')}</span><span class="r">${t.names} 张图</span></a>`).join('') || '<div class="empty" style="border:0">还没有图块集</div>'}</div>
    <div class="edbar"><button class="primary" id="tsNew">＋ 新建图块集</button></div>
  </div>`;
  $('#tsNew').onclick = async () => {
    const n = await promptDialog('新建图块集', '名字', '');
    if (!n) return;
    try { const r = await api('tileset/save', { name: n }); location.hash = '#/tilesets/' + r.id; } catch (e) { toast(e.message, true); }
  };
}

async function editTileset(main, id, list) {
  const v = await api('tileset?id=' + id);
  const sheets = await Promise.all(v.names.map(n => (n && !v.missing.includes(n) ? loadTileSheet(n) : Promise.resolve(null))));
  TSE = { id, v, sheets, flags: v.flags.slice(), mode: 'pass', tab: (TSE && TSE.id === id && TSE.tab) || null, dirty: false };
  const imgOpts = sel => `<option value="">（不用）</option>` + v.images.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>图块集 ${id}</h1><a class="tag" href="#/tilesets">全部图块集</a>
      <span class="dim">${v.usedBy.length ? '用在 ' + v.usedBy.slice(0, 4).map(m => esc(m.name)).join('、') + (v.usedBy.length > 4 ? ` 等 ${v.usedBy.length} 张地图` : '') : '还没有地图用它'}</span></div>
    <div class="card"><div class="fgrid">
      <label for="tsName">名字</label><input id="tsName" maxlength="40" value="${esc(v.name)}">
      <label for="tsKind">类型</label><select id="tsKind"><option value="0" ${v.mode === 0 ? 'selected' : ''}>世界（大地图）</option><option value="1" ${v.mode === 1 ? 'selected' : ''}>区域（城镇、室内、迷宫）</option><option value="2" ${v.mode === 2 ? 'selected' : ''}>VX 兼容</option></select>
      <span>用哪几张图</span><div class="tsslots">${v.slots.map((s, i) => `<label><span>${s}</span><select data-slot="${i}">${imgOpts(v.names[i])}</select></label>`).join('')}</div>
    </div>
    ${v.missing.length ? `<div class="warnline">这些图在 img/tilesets 里找不到：${v.missing.map(esc).join('、')}</div>` : ''}
    <div class="fnote">A1~A4 是自动元件（水、草地、墙会自动接边），A5 和 B~E 是一格一格的普通图块。图放进 img/tilesets 以后（「导入素材」会按名字自动分好），在这里选上。</div></div>
    <div class="section"><h2>每一格</h2><span class="dim" id="tsHint"></span></div>
    <div class="seg" id="tsModes">${TS_MODES.map(([k, l, h]) => `<button data-mode="${k}" title="${esc(h)}" class="${k === 'pass' ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="tsgrid card" id="tsGrid"></div>
    <div class="edbar"><button class="primary" id="tsSave">保存</button><span class="dim" id="tsState"></span></div>
  </div>`;
  const dirty = on => { TSE.dirty = on; S.dirty = on; $('#tsState').textContent = on ? '有改动还没保存' : ''; };
  $$('[data-slot]', main).forEach(sel => sel.onchange = async () => {
    const i = Number(sel.dataset.slot);
    TSE.v.names[i] = sel.value;
    TSE.sheets[i] = sel.value ? await loadTileSheet(sel.value) : null;
    dirty(true); drawTsGrid();
  });
  $('#tsName').oninput = $('#tsKind').onchange = () => dirty(true);
  $$('[data-mode]', main).forEach(b => b.onclick = () => { TSE.mode = b.dataset.mode; $$('[data-mode]', main).forEach(x => x.classList.toggle('on', x === b)); drawTsGrid(); });
  $('#tsSave').onclick = async () => {
    const b = $('#tsSave'); b.disabled = true;
    try {
      // 只发改过的格子
      const patch = {};
      TSE.flags.forEach((f, i) => { if (f !== TSE.v.flags[i]) patch[i] = f; });
      await api('tileset/save', { id, name: $('#tsName').value, mode: Number($('#tsKind').value), names: TSE.v.names, flags: patch });
      dirty(false); toast('图块集已保存（打开着的地图要重新打开才看得到新的通行）');
      editTileset(main, id, list);
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  };
  drawTsGrid();
}

function drawTsGrid() {
  const box = $('#tsGrid');
  if (!box) return;
  const P = 48;
  const tabs = TM.paletteTabs(TSE.v.names.map((n, i) => (TSE.sheets[i] ? n : '')));
  if (!tabs.length) { box.innerHTML = '<div class="empty" style="border:0">先在上面选几张图</div>'; return; }
  if (!TSE.tab || !tabs.some(t => t.key === TSE.tab)) TSE.tab = tabs[0].key;
  const tab = tabs.find(t => t.key === TSE.tab);
  const rows = Math.ceil(tab.cells.length / 8);
  box.innerHTML = `<div class="ptabs">${tabs.map(t => `<button data-tab="${t.key}" class="${t.key === TSE.tab ? 'on' : ''}">${t.key}</button>`).join('')}</div>
    <div class="tsscroll"><canvas id="tsCv" width="${8 * P}" height="${rows * P}"></canvas></div>`;
  $$('[data-tab]', box).forEach(b => b.onclick = () => { TSE.tab = b.dataset.tab; drawTsGrid(); });
  const cv = $('#tsCv'), c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  $('#tsHint').textContent = (TS_MODES.find(m => m[0] === TSE.mode) || [])[2] || '';
  const paint = () => {
    c.clearRect(0, 0, cv.width, cv.height);
    tab.cells.forEach((id, k) => {
      const x = (k % 8) * P, y = Math.floor(k / 8) * P;
      c.fillStyle = (k + Math.floor(k / 8)) % 2 ? '#1b212b' : '#202733'; c.fillRect(x, y, P, P);
      if (id) TM.drawTile(c, TSE.sheets, TM.previewId(id), x, y, P, TSE.flags);
      const f = TSE.flags[id] || 0;
      let mark = '', col = '';
      if (TSE.mode === 'pass') {
        if (id === 0) return;
        if (f & 0x10) { mark = '☆'; col = '#f0d77a'; } else if ((f & 0x0f) === 0x0f) { mark = '×'; col = '#ff6b6b'; } else { mark = '○'; col = '#7ee08a'; }
      } else if (f & TS_BIT[TSE.mode]) { mark = '●'; col = '#7cc4ff'; }
      if (!mark) return;
      c.font = '700 20px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(mark, x + P / 2, y + P / 2 + 1);
      c.fillStyle = col; c.fillText(mark, x + P / 2, y + P / 2 + 1);
    });
  };
  paint();
  cv.onclick = ev => {
    const r = cv.getBoundingClientRect();
    const col = Math.floor((ev.clientX - r.left) / (r.width / 8)), row = Math.floor((ev.clientY - r.top) / (r.height / rows));
    const id = tab.cells[row * 8 + col];
    if (id == null || id === 0) return;
    // 自动元件一种 48 个编号，一起改
    const ids = TM.isAuto(id) ? Array.from({ length: 48 }, (_, i) => TM.kindBase(TM.kindOf(id)) + i) : [id];
    const f0 = TSE.flags[ids[0]] || 0;
    let f;
    if (TSE.mode === 'pass') {
      const state = f0 & 0x10 ? 2 : (f0 & 0x0f) === 0x0f ? 1 : 0;
      const next = (state + 1) % 3;
      f = (f0 & ~0x1f) | [0, 0x0f, 0x10][next];
    } else f = f0 ^ TS_BIT[TSE.mode];
    for (const i of ids) TSE.flags[i] = (TSE.flags[i] & ~0x1ff) | (f & 0x1ff);
    TSE.dirty = true; S.dirty = true; $('#tsState').textContent = '有改动还没保存';
    paint();
  };
}
