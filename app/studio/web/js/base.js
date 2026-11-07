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
  d.innerHTML = html;
  return new Promise(resolve => {
    const done = v => { if (d.open) d.close(); resolve(v); };
    d.onclose = () => resolve(undefined);
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
  return openDialog(`<header><h3>${esc(title)}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><input id="pq" placeholder="筛选（共 ${names.length} 个）"><div id="pl" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:50vh;overflow:auto"></div></div>`,
    (d, done) => {
      const draw = q => {
        const list = names.filter(n => !q || n.toLowerCase().includes(q)).slice(0, 240);
        $('#pl', d).innerHTML = list.map(n => `<button data-n="${esc(n)}" style="text-align:left;white-space:normal;overflow-wrap:anywhere">${esc(n)}</button>`).join('') || '<div class="dim">没有符合的</div>';
        $$('[data-n]', d).forEach(b => b.onclick = () => done(b.dataset.n));
      };
      $('#pq', d).oninput = e => draw(e.target.value.trim().toLowerCase());
      $('[data-x]', d).onclick = () => done(null);
      draw(''); $('#pq', d).focus();
    }).then(v => v || null);
}
async function lookup(kind) {
  if (!S.lookups[kind]) S.lookups[kind] = api('lookup?kind=' + kind).then(r => r.rows);
  return S.lookups[kind];
}
const options = (rows, sel) => rows.map(r => `<option value="${r.id}" ${Number(sel) === r.id ? 'selected' : ''}>${r.id} ${esc(r.name || '')}</option>`).join('');
