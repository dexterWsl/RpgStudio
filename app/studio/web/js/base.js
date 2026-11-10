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

async function lookup(kind) {
  if (!S.lookups[kind]) S.lookups[kind] = api('lookup?kind=' + kind).then(r => r.rows);
  return S.lookups[kind];
}
const options = (rows, sel) => rows.map(r => `<option value="${r.id}" ${Number(sel) === r.id ? 'selected' : ''}>${r.id} ${esc(r.name || '')}</option>`).join('');
