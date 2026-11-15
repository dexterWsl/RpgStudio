'use strict';
// 插入用的选择器（编辑框、新建场景、剧情进度里的「插入 …」按钮）：
//   选图（mountPicturePicker / pickDialog）、在地图上点格子（mountMapPicker）、
//   传送到哪里（transferDialog → transferLine）、场景里换谁来演（asDialog）、谁（whoDialog）
// 通用的弹窗（openDialog / chooseDialog / promptDialog）、lookup 在 base.js
function pictureFolders(names) {
  const folders = new Set();
  for (const name of names) {
    let folder = '';
    for (const part of name.split('/').slice(0, -1)) {
      folder = folder ? folder + '/' + part : part;
      folders.add(folder);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// 新建场景和改台词共用一套选图，插入时保留图片的完整相对路径。
function mountPicturePicker(box, names, onPick) {
  const rank = n => n.startsWith('导入/') ? 0 : n.includes('/') ? 2 : 1;
  const ordered = [...names].sort((a, b) => rank(a) - rank(b));
  const pageSize = 120;
  let page = 0;
  box.innerHTML = `<div class="picture-filters">
    <select aria-label="按文件夹筛选"><option value="">全部文件夹</option><option value="/">根目录</option>${pictureFolders(names).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
    <input type="search" aria-label="搜索图片" placeholder="搜索图片名称">
  </div><div class="picture-grid"></div>
  <div class="picture-pages" hidden>
    <button type="button" class="small" data-prev>上一页</button><span class="dim" aria-live="polite"></span><button type="button" class="small" data-next>下一页</button>
  </div>`;
  const folder = $('select', box), query = $('input', box);
  const grid = $('.picture-grid', box), pages = $('.picture-pages', box);
  const prev = $('[data-prev]', box), next = $('[data-next]', box);
  function draw() {
    const q = query.value.trim().toLowerCase();
    const dir = folder.value;
    const matches = ordered.filter(n => {
      const inFolder = !dir || (dir === '/' ? !n.includes('/') : n.startsWith(dir + '/'));
      return inFolder && n.toLowerCase().includes(q);
    });
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    const current = matches.slice(page * pageSize, (page + 1) * pageSize);
    grid.innerHTML = current.map(n => `<button type="button" data-picture="${esc(n)}" title="${esc(n)}"><img loading="lazy" src="${img('pictures', n)}" alt=""><span>${esc(n)}</span></button>`).join('') || '<div class="dim">没有符合的图片</div>';
    grid.scrollTop = 0;
    pages.hidden = totalPages === 1;
    $('span', pages).textContent = `第 ${page + 1} / ${totalPages} 页 · ${matches.length} 张`;
    prev.disabled = page === 0;
    next.disabled = page + 1 === totalPages;
  }
  folder.onchange = query.oninput = () => { page = 0; draw(); };
  prev.onclick = () => { page--; draw(); };
  next.onclick = () => { page++; draw(); };
  grid.onclick = e => {
    const button = e.target.closest('[data-picture]');
    if (button) onPick(button.dataset.picture);
  };
  draw();
  query.focus();
}

// 从列表里挑一个（图片名 / 角色名）
async function pickDialog(title, path, isImage = false) {
  let names;
  try { const r = await api(path); names = r.names || (r.rows || []).filter(x => x.name).map(x => x.name); } catch (e) { toast(e.message, true); return null; }
  if (isImage) {
    return openDialog(`<header><h3>${esc(title)}</h3><button class="quiet small" data-x>关闭</button></header><div class="dbody"><div class="picture-picker"></div></div>`,
      (d, done) => {
        $('[data-x]', d).onclick = () => done(null);
        mountPicturePicker($('.picture-picker', d), names, done);
      });
  }
  return chooseDialog(title, names);
}

// 把一张地图画进指定的框里：点一下拿格子坐标（传送选目的地用）
//   和地图页同一套画法（TM.drawSpot + 图块集），事件画成小方框，鼠标跟着走
// initial = { x, y }：一打开就标出这一格（看「#传送」传到哪里），并滚到它那里
async function mountMapPicker(box, mapId, onPick, initial) {
  box.innerHTML = '<div class="loading">正在读取地图…</div>';
  const [m, tiles] = await Promise.all([api('map?id=' + mapId), api('maptiles?id=' + mapId)]);
  const names = (tiles.tileset && tiles.tileset.names) || [];
  const sheets = await Promise.all(names.map(loadTileSheet));
  const w = m.width, h = m.height;
  const data = tiles.data.slice(0, w * h * 6);
  while (data.length < w * h * 6) data.push(0);
  const flags = (tiles.tileset && tiles.tileset.flags) || [];
  const C = Math.max(8, Math.min(28, Math.floor(720 / Math.max(w, h))));
  const W = w * C, H = h * C;
  box.innerHTML = `<div class="mpkwrap"><div class="mpkstack" style="width:${W}px;height:${H}px">
      <canvas class="mpk" width="${W}" height="${H}"></canvas><canvas class="mpkover" width="${W}" height="${H}"></canvas>
    </div></div>`;
  const cv = $('.mpk', box), ov = $('.mpkover', box);
  const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x * C, dy = y * C;
    ctx.fillStyle = '#080b10'; ctx.fillRect(dx, dy, C, C);
    TM.drawSpot(ctx, sheets, flags, data, w, h, x, y, dx, dy, C);
  }
  let cur = initial && initial.x >= 0 && initial.y >= 0 && initial.x < w && initial.y < h ? { x: initial.x, y: initial.y } : null, hov = null;
  const paint = () => {
    octx.clearRect(0, 0, W, H);
    for (const e of (m.events || [])) {
      if (!e) continue;
      octx.strokeStyle = 'rgba(255,190,90,.55)'; octx.lineWidth = 1;
      octx.strokeRect(e.x * C + 1.5, e.y * C + 1.5, Math.max(1, C - 3), Math.max(1, C - 3));
    }
    if (hov) { octx.fillStyle = 'rgba(141,156,245,.16)'; octx.fillRect(hov.x * C, hov.y * C, C, C); }
    if (cur) {
      // 十字线：大地图上也一眼看到是哪一格
      octx.strokeStyle = 'rgba(141,156,245,.35)'; octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(0, cur.y * C + C / 2 + .5); octx.lineTo(W, cur.y * C + C / 2 + .5); octx.moveTo(cur.x * C + C / 2 + .5, 0); octx.lineTo(cur.x * C + C / 2 + .5, H); octx.stroke();
      octx.fillStyle = 'rgba(141,156,245,.34)'; octx.fillRect(cur.x * C, cur.y * C, C, C);
      octx.strokeStyle = '#8d9cf5'; octx.lineWidth = 2; octx.strokeRect(cur.x * C + 1, cur.y * C + 1, C - 2, C - 2);
    }
  };
  paint();
  if (cur) {
    const wrap = $('.mpkwrap', box);
    wrap.scrollLeft = Math.max(0, cur.x * C - wrap.clientWidth / 2);
    wrap.scrollTop = Math.max(0, cur.y * C - wrap.clientHeight / 2);
  }
  const at = e => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / w)), y = Math.floor((e.clientY - r.top) / (r.height / h));
    return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
  };
  cv.onmousemove = e => { hov = at(e); paint(); };
  cv.onmouseleave = () => { hov = null; paint(); };
  cv.onclick = e => { const c = at(e); if (!c) return; cur = c; paint(); onPick(c, false); };
  cv.ondblclick = e => { const c = at(e); if (!c) return; cur = c; paint(); onPick(c, true); };
}

// 传送：挑地图（默认就是这张图），直接在地图上点要去的格子 → { id, name, x, y }
// 传送到哪里：选地图、在地图上点格子；返回 { id, name, x, y, dir, who, steps }，用 transferLine() 变成一行
//   o.scene = 在场景里：还能选「谁来演」和「到了以后」（场景播完自动回到原来的地方、换回主角）；场景外只有主角自己
//   o.initial = { x, y, who, dir（上下左右）, steps }：已经写好的一行（规范模式里点传送按钮），打开就标出那一格
async function transferDialog(defaultMapId, o = {}) {
  const [maps, actors] = await Promise.all([lookup('map').catch(() => []), o.scene ? lookup('actor').catch(() => []) : Promise.resolve([])]);
  if (!maps.length) { toast('这个工程里还没有地图', true); return null; }
  let mapId = Number(defaultMapId) || 0;
  if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
  const ini = o.initial || null;
  let picked = null, name = '';
  // 编辑框里写地图名：名字唯一才写名字，不然写编号（跟服务端的 refText 一个规矩）
  const ref = id => {
    const m = maps.find(x => x.id === id), n = String((m && m.name) || '').trim();
    return n && !/^\d+$/.test(n) && maps.filter(x => String(x.name || '').trim() === n).length === 1 ? n : String(id);
  };
  const names = actors.map(a => String(a.name || '').trim()).filter(Boolean);
  return openDialog(`<header><h3>${ini ? '传送到这里' : o.scene ? '场景里传送到哪里' : '传送到哪里'}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="fgrid">
        <label for="tpmap">地图</label><select id="tpmap">${maps.map(m => `<option value="${m.id}" ${m.id === mapId ? 'selected' : ''}>${m.id} ${esc(m.name || '（没名字）')}</option>`).join('')}</select>
        ${o.scene ? `<label for="tpwho">谁来演</label><select id="tpwho"><option value="">主角（不换人）</option>${[...new Set([...names, ...(ini && ini.who ? [ini.who] : [])])].map(n => `<option ${ini && ini.who === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
        <label for="tpdir">到了朝</label><select id="tpdir"><option value="">不变</option>${['上', '下', '左', '右'].map(d => `<option ${ini && ini.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        ${o.scene || (ini && ini.steps) ? `<label for="tpsteps">到了以后</label><input id="tpsteps" placeholder="可以不写；比如 前进3 或 下2 转身" value="${esc((ini && ini.steps) || '')}">` : ''}
      </div>
      <div class="fnote">${o.scene ? '场景里的传送只在这个场景里算数：场景播完，主角自动回到进场景前的地方、换回原来的样子。' : '主角传送过去（场景外的传送就是主角自己）。'}</div>
      <div class="tpbox" id="tpbox"></div>
    </div>
    <footer><span class="sp"></span><span class="dim" id="tphint">在地图上点一下要去的格子</span><button data-x>取消</button><button class="primary" data-ok disabled>${ini ? '确定' : '就是这一格'}</button></footer>`,
    (d, done) => {
      d.classList.add('dlg-wide');
      d.addEventListener('close', () => d.classList.remove('dlg-wide'), { once: true });
      const sel = $('#tpmap', d), box = $('#tpbox', d), ok = $('[data-ok]', d), hint = $('#tphint', d);
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const val = id => { const el = $(id, d); return el ? el.value.trim() : ''; };
      const fire = () => { if (picked) done({ id: mapId, name: ref(mapId), x: picked.x, y: picked.y, dir: val('#tpdir'), who: val('#tpwho'), steps: val('#tpsteps') }); };
      ok.onclick = fire;
      let first = true;
      const load = async () => {
        mapId = Number(sel.value);
        name = (maps.find(m => m.id === mapId) || {}).name || '';
        picked = null; ok.disabled = true; hint.textContent = '在地图上点一下要去的格子';
        // 第一次打开、而且是原来那张图：标出原来那一格
        const start = first && ini && Number(defaultMapId) === mapId ? { x: ini.x, y: ini.y } : null;
        first = false;
        const show = c => { picked = c; ok.disabled = false; hint.textContent = (name || '地图 ' + mapId) + ' (' + c.x + ', ' + c.y + ')' + (start && c.x === start.x && c.y === start.y ? ' —— 现在传到这里' : ''); };
        if (start) show(start);
        try {
          await mountMapPicker(box, mapId, (c, dbl) => { show(c); if (dbl) fire(); }, start);
        } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      sel.onchange = load;
      load();
    }).then(v => v || null);
}
// 新的一组选项：写几个选项的字 → 「#选项 A | B」加每个选项一行「#1」「#2」（下面用 #1 #2 开头写各自的内容）
async function choiceBuilder() {
  const r = await openDialog(`<header><h3>插入选项</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="fnote">每个选项一行，2~6 个。要满足条件才能选的，保存以后在「选了 …」那里点「条件」设置。</div>
      <div class="cbrows" id="cbRows"></div>
      <button type="button" class="small" id="cbAdd">＋ 再加一个选项</button>
      <div id="cbErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>插入</button></footer>`,
    (d, done) => {
      const box = $('#cbRows', d);
      const row = (v = '') => `<div class="cbrow"><span class="cbn"></span><input value="${esc(v)}" placeholder="选项的字" maxlength="60"><button type="button" class="quiet small" data-del title="去掉">×</button></div>`;
      const renum = () => { $$('.cbrow', box).forEach((r, i) => { $('.cbn', r).textContent = i + 1; }); $('#cbAdd', d).disabled = $$('.cbrow', box).length >= 6; };
      const add = v => { box.insertAdjacentHTML('beforeend', row(v)); const r = box.lastElementChild; $('[data-del]', r).onclick = () => { if ($$('.cbrow', box).length > 2) { r.remove(); renum(); } }; renum(); return r; };
      add(); add();
      $('input', box).focus();
      $('#cbAdd', d).onclick = () => { if ($$('.cbrow', box).length < 6) $('input', add()).focus(); };
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      $('[data-ok]', d).onclick = () => {
        const labels = $$('.cbrow input', box).map(i => i.value.replace(/[|｜\n]/g, ' ').trim()).filter(Boolean);
        if (labels.length < 2) { $('#cbErr', d).innerHTML = '<div class="err">至少要两个选项</div>'; return; }
        done(labels);
      };
      box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if ($$('.cbrow', box).length < 6 && e.target === $$('.cbrow input', box).pop()) $('input', add()).focus(); else $('[data-ok]', d).click(); } });
    });
  if (!r) return null;
  return ['#选项 ' + r.join(' | '), ...r.map((_, i) => '#' + (i + 1))].join('\n');
}

// 条件分支：写条件 → 「#如果 条件」「#否则」「#结束」（中间写成立 / 不成立时的内容）
async function ifBuilder(cur = '') {
  const v = await promptDialog('插入条件分支（如果…）', '条件：变量 DayCount >= 3 ／ 开关 自由时间 开 ／ 两个条件用「并且」「或者」连', cur);
  return v && v.trim() ? v.trim() : null;
}

const transferLine = t => '#传送 ' + (t.who ? t.who + ' ' : '') + t.name + ' ' + t.x + ' ' + t.y + (t.dir ? ' 朝' + t.dir : '') + (t.steps ? ' ' + t.steps.replace(/\s+/g, ' ') : '');

// 场景里换谁来演（#扮演）：主角（换回来）/ 数据库里的角色 / 不是角色的人（要写行走图）
async function asDialog() {
  const actors = await lookup('actor').then(rows => rows.map(a => String(a.name || '').trim()).filter(Boolean)).catch(() => []);
  const BACK = '主角（换回来）', OTHER = '不是角色的人…';
  const pick = await chooseDialog('扮演：场景里主角的小人换成谁（场景播完自动换回）', [BACK, ...actors, OTHER]);
  if (!pick) return null;
  if (pick === BACK) return '#扮演 主角';
  if (pick !== OTHER) return '#扮演 ' + pick;
  const v = await promptDialog('扮演不是角色的人', '名字 行走图名 编号（比如：路人 People1 3）', '');
  return v ? '#扮演 ' + v.trim().replace(/\s+/g, ' ') : null;
}

// #场景：播一个公共事件。场景库里有名字的排前面，其它公共事件（比如「擦除一楼遮挡层」）也在列表里
async function scenePicker() {
  const [sc, ce] = await Promise.all([
    api('scenes').catch(() => ({ scenes: [] })),
    api('ces').catch(() => ({ ces: [] })),
  ]);
  const scenes = (sc.scenes || []).map(s => s.name).filter(Boolean);
  const all = (ce.ces || []).filter(c => String(c.name || '').trim()).map(c => c.name);
  const names = [...scenes, ...all.filter(n => !scenes.includes(n))];
  if (!names.length) { toast('还没有能调用的公共事件', true); return null; }
  return (await chooseDialog('插入场景：播哪个公共事件（场景库里的排前面）', names)) || null;
}

// 气泡：选形状 + 冒在谁头上。
//   主角 / 本事件 → 原生的「显示气泡」(213)；别人头上 → 移动路线里的气泡步骤（#动作 名字 气泡 ♥）
const BALLOON_SHAPES = ['！', '？', '♪', '♥', '怒', '汗', '乱', '…', '灯', 'Zzz'];
function balloonTextFor(who, sym) {
  if (who === '主角') return '#气泡 ' + sym;
  if (who === '本事件') return '#气泡 ' + sym + ' 本事件';
  return '#动作 ' + who + ' ' + sym;   // 移动路线里的气泡步骤就是那个符号本身
}
async function balloonLine(defaultWho = '本事件') {
  const actors = await lookup('actor').then(rows => rows.map(a => String(a.name || '').trim()).filter(Boolean)).catch(() => []);
  const whos = ['本事件', '主角', ...actors.slice(0, 10)];
  let who = whos.includes(defaultWho) ? defaultWho : '本事件';
  return openDialog(`<header><h3>冒个气泡</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="csec"><span class="csec-t">冒在谁头上</span><span class="faint">本事件 = 正在跑的这一页；别的人物走移动路线（要先有演出插件，编辑器会自动装）</span></div>
      <div class="balwho">${whos.map(w => `<button type="button" class="small${w === who ? ' on' : ''}" data-bw="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      <div class="csec"><span class="csec-t">哪个气泡</span><span class="faint">点一下就插到光标处（RPG Maker 自带 Balloon.png 的第 1~10 行）</span></div>
      <div class="balgrid">${BALLOON_SHAPES.map(s => `<button type="button" data-bs="${esc(s)}" title="插入「${esc(s)}」">${esc(s)}</button>`).join('')}</div>
      <div class="fnote" id="bprev"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button></footer>`,
    (d, done) => {
      const prev = $('#bprev', d);
      const show = () => { prev.textContent = '会插入：' + balloonTextFor(who, '♥'); };
      show();
      $$('[data-bw]', d).forEach(b => b.onclick = () => {
        who = b.dataset.bw;
        $$('[data-bw]', d).forEach(x => x.classList.toggle('on', x === b));
        show();
      });
      $$('[data-bs]', d).forEach(b => b.onclick = () => done(balloonTextFor(who, b.dataset.bs)));
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
    }).then(v => v || null);
}

// 事件标识：这一页生效时，游戏里事件头顶一直显示（气泡符号 → 每隔 2.5 秒冒一次；别的短文字 → 常驻小字）
//   存在页最前面的注释里（core/marks.js），RPG Maker 编辑器改地图不会丢
async function markDialog(cur = '') {
  const presets = ['！', '？', '♪', '♥', '怒', '汗', '乱', '…', '灯', 'Zzz'];
  return openDialog(`<header><h3>事件标识</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="csec"><span class="csec-t">这一页生效时，事件头顶一直显示</span><span class="faint">编辑器地图上也会标出来</span></div>
      <div class="balgrid">${presets.map(s => `<button type="button" data-mk="${esc(s)}"${s === cur ? ' class="on"' : ''}>${esc(s)}</button>`).join('')}</div>
      <div class="cnew"><input id="mkText" maxlength="6" placeholder="也可以写短文字：ev、序章…" value="${esc(presets.includes(cur) ? '' : cur)}"><button type="button" class="small primary" id="mkOk">用这个</button></div>
      <label class="switch"><input type="checkbox" id="mkAll" checked><span>这个事件的所有页都用（同一事件的不同页是互斥的，选中就每一页都写）</span></label>
      <div class="fnote">气泡符号 = 每隔 2.5 秒冒一次气泡；文字 = 一直挂在头顶。</div>
    </div>
    <footer><span class="sp"></span><button id="mkNone">不要标识</button><button data-x>取消</button></footer>`,
    (d, done) => {
      const allBox = $('#mkAll', d);
      const out = mark => ({ mark, all: !!(allBox && allBox.checked) });
      $$('[data-mk]', d).forEach(b => b.onclick = () => done(out(b.dataset.mk)));
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      $('#mkNone', d).onclick = () => done(out(''));
      const inp = $('#mkText', d);
      const ok = () => { const v = inp.value.trim(); if (v) done(out(v)); else inp.focus(); };
      $('#mkOk', d).onclick = ok;
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
    }).then(v => (v === undefined ? null : v));
}

// 谁：主角 / 本事件 /（飘字还有画面）/ 人物 / 手动输入
async function whoDialog(title, extra = []) {
  const actors = await lookup('actor').then(rows => rows.map(a => a.name).filter(Boolean)).catch(() => []);
  const MANUAL = '（手动输入…）';
  const pick = await chooseDialog(title, [...extra, '主角', '本事件', ...actors, MANUAL]);
  if (!pick) return null;
  if (pick !== MANUAL) return pick;
  return promptDialog(title, '名字（角色名 / 地图上事件的名字）', '');
}
