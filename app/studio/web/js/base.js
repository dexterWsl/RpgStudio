'use strict';
// 基础：小工具、全局状态、接口、提示、文字里的引用、长列表 / 可收起的节 / 「⋯」菜单、弹窗、下拉框
// ====================================================================
// rpgStudio：通用 RPG Maker MV/MZ 剧情编辑器（前端）
//   地图 → 事件 → 事件页（出现条件 + 阅读 / 改台词）；公共事件；开关 / 变量及其引用
// ====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;

const S = {
  project: null, maps: [], ces: null, tab: 'maps', open: new Set(),
  lookups: {}, dirty: false, side: null, labels: false,
};
try { S.tab = localStorage.getItem('studio.tab') || 'maps'; S.open = new Set(JSON.parse(localStorage.getItem('studio.open') || '[]')); S.labels = localStorage.getItem('studio.labels') === '1'; } catch { }
const remember = () => { try { localStorage.setItem('studio.tab', S.tab); localStorage.setItem('studio.open', JSON.stringify([...S.open])); localStorage.setItem('studio.labels', S.labels ? '1' : '0'); } catch { } };

async function api(path, body) {
  const headers = {};
  if (S.project && S.project.projectKey) headers['x-studio-project'] = S.project.projectKey;
  const r = await fetch('/api/studio/' + path, body === undefined ? { cache: 'no-store', headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('需要登录'); }
  let j = null;
  try { j = await r.json(); } catch { throw new Error('服务器没有返回数据（' + r.status + '）'); }
  if (!r.ok) { const e = new Error(j.error || ('出错了（' + r.status + '）')); e.problems = j.problems; e.noGame = !!j.noGame; throw e; }
  return j;
}
function toast(msg, bad) {
  const d = document.createElement('div');
  d.textContent = msg; if (bad) d.className = 'bad';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), bad ? 5200 : 2600);
}
const IMGV = {};   // 上传 / 改过的图：加个版本号，免得浏览器用旧的缓存
const img = (sub, name) => '/api/studio/img?sub=' + enc(sub) + '&name=' + enc(name) + (IMGV[sub + '/' + name] ? '&v=' + IMGV[sub + '/' + name] : '');

// 文字里的「开关 3「xx」」「变量 5」「公共事件 2「xx」」「地图 3「xx」」「物品 1」变成可点的引用
const REF_KIND = { '开关': 'switch', '变量': 'var', '公共事件': 'ce', '地图': 'map', '物品': 'item', '角色': 'actor' };
function linkify(text) {
  return esc(text).replace(/(开关|变量|公共事件|地图|物品|角色) (\d+)(?:~\d+)?((?:「[^」]*」)?)/g, (m, k, id) => `<span class="ref" data-kind="${REF_KIND[k]}" data-id="${id}" tabindex="0">${m}</span>`);
}


// 可以收起的一节：标题行点一下展开 / 收起，记住上次的状态
function foldSec(key, title, hint, body, open = false) {
  try { const v = localStorage.getItem('studio.sec.' + key); if (v != null) open = v === '1'; } catch { }
  return `<details class="foldsec" data-sec="${key}" ${open ? 'open' : ''}><summary><span class="chev" aria-hidden="true"></span><h2>${esc(title)}</h2><span class="dim">${hint}</span></summary>${body}</details>`;
}
function bindFoldSec(root) {
  $$('.foldsec', root).forEach(d => d.addEventListener('toggle', () => { try { localStorage.setItem('studio.sec.' + d.dataset.sec, d.open ? '1' : '0'); } catch { } }));
}

// 长列表只显示前几个，其余点「显示全部」
function capped(rows, n = 8, label) {
  if (rows.length <= n + 2) return rows.join('');
  return rows.slice(0, n).join('') + `<div class="capped" hidden>${rows.slice(n).join('')}</div><button type="button" class="showall">${label || '显示全部 ' + rows.length + ' 个'}</button>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('.showall');
  if (!b) return;
  const c = b.previousElementSibling;
  if (c && c.classList.contains('capped')) { c.hidden = false; b.remove(); }
});

// ---------- 「⋯」更多操作菜单：不常用、会删东西的按钮收在这里 ----------
function moreMenu(items, label = '更多操作') {
  items = items.filter(Boolean);
  return `<details class="mmenu"><summary class="mbtn" aria-label="${esc(label)}" title="${esc(label)}"><span aria-hidden="true">⋯</span></summary>
    <div class="mlist" role="menu">${items.map(i => `<button type="button" role="menuitem" class="${i.danger ? 'mdanger' : ''}" id="${i.id}">${esc(i.label)}</button>`).join('')}</div></details>`;
}
function bindMenu(root) {
  $$('.mmenu', root).forEach(m => m.addEventListener('click', e => { if (e.target.closest('.mlist button')) m.open = false; }));
}
document.addEventListener('click', e => { $$('.mmenu[open]').forEach(m => { if (!m.contains(e.target)) m.open = false; }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.mmenu[open]').forEach(m => { m.open = false; $('summary', m).focus(); }); });

// ---------- 弹窗 ----------
function openDialog(html, onReady) {
  const d = $('#dlg');
  // 一个接一个地开（先选地图、再填坐标）：上一个的 close 事件是异步来的，
  // 开新的时它可能才刚到，所以按「第几次开」认领，别把新的那个当成关掉了
  const gen = d._gen = (d._gen || 0) + 1;
  d.innerHTML = html;
  d.onkeydown = null;
  return new Promise(resolve => {
    const done = v => { if (d._gen !== gen) return; if (d.open) d.close(); resolve(v); };
    d.addEventListener('close', () => { if (d._gen === gen) resolve(undefined); }, { once: true });
    d.onclick = e => { if (e.target === d) done(undefined); };
    d.showModal();
    onReady(d, done);
  });
}
function confirmDialog(title, text, okText) {
  return openDialog(`<header><h3>${esc(title)}</h3></header><div class="dbody"><p>${esc(text)}</p></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="danger" data-ok>${esc(okText)}</button></footer>`,
    (d, done) => { $('[data-x]', d).onclick = () => done(false); $('[data-ok]', d).onclick = () => done(true); $('[data-x]', d).focus(); }).then(v => !!v);
}
function promptDialog(title, label, value) {
  return openDialog(`<header><h3>${esc(title)}</h3></header><div class="dbody"><label class="fnote">${esc(label)}</label><input id="pv" maxlength="40" value="${esc(value)}"></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>确定</button></footer>`,
    (d, done) => {
      const inp = $('#pv', d); inp.focus(); inp.select();
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = () => done(inp.value.trim() || null);
      inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); };
    }).then(v => (v === undefined ? null : v));
}
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

// 从一串名字里挑一个（角色名、事件名、固定的几个选项都行）：和 pickDialog 一样的选择界面，只是不问服务器
function chooseDialog(title, names) {
  const all = (names || []).filter(Boolean).map(String);
  return openDialog(`<header><h3>${esc(title)}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><input id="cq" placeholder="筛选（共 ${all.length} 个）"><div id="cl" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:50vh;overflow:auto"></div></div>`,
    (d, done) => {
      const draw = q => {
        const list = all.filter(n => !q || n.toLowerCase().includes(q)).slice(0, 240);
        $('#cl', d).innerHTML = list.map(n => `<button data-c="${esc(n)}" style="text-align:left;white-space:normal;overflow-wrap:anywhere">${esc(n)}</button>`).join('') || '<div class="dim">没有符合的</div>';
        $$('[data-c]', d).forEach(b => b.onclick = () => done(b.dataset.c));
      };
      $('#cq', d).oninput = e => draw(e.target.value.trim().toLowerCase());
      $('[data-x]', d).onclick = () => done(null);
      draw(''); $('#cq', d).focus();
    }).then(v => v || null);
}

// 把一张地图画进指定的框里：点一下拿格子坐标（传送选目的地用）
//   和地图页同一套画法（TM.drawSpot + 图块集），事件画成小方框，鼠标跟着走
async function mountMapPicker(box, mapId, onPick) {
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
  let cur = null, hov = null;
  const paint = () => {
    octx.clearRect(0, 0, W, H);
    for (const e of (m.events || [])) {
      if (!e) continue;
      octx.strokeStyle = 'rgba(255,190,90,.55)'; octx.lineWidth = 1;
      octx.strokeRect(e.x * C + 1.5, e.y * C + 1.5, Math.max(1, C - 3), Math.max(1, C - 3));
    }
    if (hov) { octx.fillStyle = 'rgba(141,156,245,.16)'; octx.fillRect(hov.x * C, hov.y * C, C, C); }
    if (cur) {
      octx.fillStyle = 'rgba(141,156,245,.34)'; octx.fillRect(cur.x * C, cur.y * C, C, C);
      octx.strokeStyle = '#8d9cf5'; octx.lineWidth = 2; octx.strokeRect(cur.x * C + 1, cur.y * C + 1, C - 2, C - 2);
    }
  };
  paint();
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
async function transferDialog(defaultMapId, o = {}) {
  const [maps, actors] = await Promise.all([lookup('map').catch(() => []), o.scene ? lookup('actor').catch(() => []) : Promise.resolve([])]);
  if (!maps.length) { toast('这个工程里还没有地图', true); return null; }
  let mapId = Number(defaultMapId) || 0;
  if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
  let picked = null, name = '';
  // 编辑框里写地图名：名字唯一才写名字，不然写编号（跟服务端的 refText 一个规矩）
  const ref = id => {
    const m = maps.find(x => x.id === id), n = String((m && m.name) || '').trim();
    return n && !/^\d+$/.test(n) && maps.filter(x => String(x.name || '').trim() === n).length === 1 ? n : String(id);
  };
  const names = actors.map(a => String(a.name || '').trim()).filter(Boolean);
  return openDialog(`<header><h3>${o.scene ? '场景里传送到哪里' : '传送到哪里'}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="fgrid">
        <label for="tpmap">地图</label><select id="tpmap">${maps.map(m => `<option value="${m.id}" ${m.id === mapId ? 'selected' : ''}>${m.id} ${esc(m.name || '（没名字）')}</option>`).join('')}</select>
        ${o.scene ? `<label for="tpwho">谁来演</label><select id="tpwho"><option value="">主角（不换人）</option>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select>` : ''}
        <label for="tpdir">到了朝</label><select id="tpdir"><option value="">不变</option>${['上', '下', '左', '右'].map(d => `<option>${d}</option>`).join('')}</select>
        ${o.scene ? '<label for="tpsteps">到了以后</label><input id="tpsteps" placeholder="可以不写；比如 前进3 或 下2 转身">' : ''}
      </div>
      <div class="fnote">${o.scene ? '场景里的传送只在这个场景里算数：场景播完，主角自动回到进场景前的地方、换回原来的样子。' : '主角传送过去（场景外的传送就是主角自己）。'}</div>
      <div class="tpbox" id="tpbox"></div>
    </div>
    <footer><span class="sp"></span><span class="dim" id="tphint">在地图上点一下要去的格子</span><button data-x>取消</button><button class="primary" data-ok disabled>就是这一格</button></footer>`,
    (d, done) => {
      d.classList.add('dlg-wide');
      d.addEventListener('close', () => d.classList.remove('dlg-wide'), { once: true });
      const sel = $('#tpmap', d), box = $('#tpbox', d), ok = $('[data-ok]', d), hint = $('#tphint', d);
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const val = id => { const el = $(id, d); return el ? el.value.trim() : ''; };
      const fire = () => { if (picked) done({ id: mapId, name: ref(mapId), x: picked.x, y: picked.y, dir: val('#tpdir'), who: val('#tpwho'), steps: val('#tpsteps') }); };
      ok.onclick = fire;
      const load = async () => {
        mapId = Number(sel.value);
        name = (maps.find(m => m.id === mapId) || {}).name || '';
        picked = null; ok.disabled = true; hint.textContent = '在地图上点一下要去的格子';
        try {
          await mountMapPicker(box, mapId, (c, dbl) => {
            picked = c; ok.disabled = false;
            hint.textContent = (name || '地图 ' + mapId) + ' (' + c.x + ', ' + c.y + ')';
            if (dbl) fire();
          });
        } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      sel.onchange = load;
      load();
    }).then(v => v || null);
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

// 谁：主角 / 本事件 /（飘字还有画面）/ 人物 / 手动输入
async function whoDialog(title, extra = []) {
  const actors = await lookup('actor').then(rows => rows.map(a => a.name).filter(Boolean)).catch(() => []);
  const MANUAL = '（手动输入…）';
  const pick = await chooseDialog(title, [...extra, '主角', '本事件', ...actors, MANUAL]);
  if (!pick) return null;
  if (pick !== MANUAL) return pick;
  return promptDialog(title, '名字（角色名 / 地图上事件的名字）', '');
}
async function lookup(kind) {
  if (!S.lookups[kind]) S.lookups[kind] = api('lookup?kind=' + kind).then(r => r.rows);
  return S.lookups[kind];
}
const options = (rows, sel) => rows.map(r => `<option value="${r.id}" ${Number(sel) === r.id ? 'selected' : ''}>${r.id} ${esc(r.name || '')}</option>`).join('');
