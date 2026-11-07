'use strict';
// 外壳：路由、顶栏和左栏（地图树 / 公共事件）、右栏的引用列表
// ---------- 路由 ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: parts[0] || 'home', a: parts[1], b: parts[2], c: parts[3] };
}
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (S.dirty && !confirm('改的台词还没保存，确定离开？')) { history.replaceState(null, '', lastHash || '#/'); return; }
  S.dirty = false;
  lastHash = location.hash;
  render();
});
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

async function render() {
  const r = route();
  document.body.classList.toggle('project-picker', r.name === 'projects');
  document.title = r.name === 'projects' ? '选择游戏 · rpgStudio' : ((S.project && S.project.title) ? S.project.title + ' · rpgStudio' : 'rpgStudio');
  // 没有能打开的游戏时只有「工程」页能用
  if (!S.project && r.name !== 'projects') { if (PROJ) { location.hash = '#/projects'; return; } }
  document.body.classList.remove('navopen');
  $$('#navlinks a').forEach(a => a.classList.toggle('on', a.dataset.k === (r.name === 'names' ? r.a : r.name)));
  markNav(r);
  // 小人的侧栏只在小人库里有用，离开就关掉（引用侧栏照旧跟着走）
  if (S.side && (S.side.kind === 'characters' || S.side.kind === 'faces') && r.name !== 'sprites') closeSide();
  const main = $('#main');
  main.scrollTop = 0;
  try {
    if (r.name === 'home') await viewHome(main);
    else if (r.name === 'map') await viewMap(main, Number(r.a), r.b);
    else if (r.name === 'event') await viewEvent(main, Number(r.a), Number(r.b), Number(r.c || 0));
    else if (r.name === 'ce') await viewCe(main, Number(r.a));
    else if (r.name === 'names') await viewNames(main, r.a === 'var' ? 'var' : 'switch', r.b);
    else if (r.name === 'search') await viewSearch(main, r.a || '');
    else if (r.name === 'check') await viewCheck(main);
    else if (r.name === 'people') await (r.a ? viewPerson(main, r.a) : viewPeople(main));
    else if (r.name === 'sprites') await viewSprites(main, r.a);
    else if (r.name === 'gallery') await viewGallery(main);
    else if (r.name === 'progress') await viewProgress(main, r.a);
    else if (r.name === 'scenes') await viewScenes(main);
    else if (r.name === 'projects') await viewProjects(main, r.a);
    else if (r.name === 'assets') await viewAssets(main);
    else if (r.name === 'tilesets') await viewTilesets(main, r.a);
    else if (r.name === 'system') await viewSystem(main);
    else main.innerHTML = '<div class="page"><div class="empty">没有这个页面。<a href="#/">回到概览</a></div></div>';
  } catch (e) {
    main.innerHTML = `<div class="page"><div class="err">${esc(e.message)}</div><a href="#/">回到概览</a></div>`;
  }
}

// ---------- 顶栏 + 左栏 ----------
async function boot() {
  if (!location.hash) history.replaceState(null, '', '#/projects');
  try {
    S.project = await api('project');
  } catch (e) {
    // 当前工程打不开（文件夹被挪走了、还没导入过游戏）：有工程列表就去那里换一个 / 导入
    S.noGame = e.message;
    await loadProjects();
    document.body.classList.add('nogame');
    if (PROJ) { if (!/^#\/projects/.test(location.hash)) location.hash = '#/projects'; render(); }
    else $('#main').innerHTML = `<div class="page"><div class="err">${esc(e.message)}</div></div>`;
    return;
  }
  const P = S.project;
  document.title = P.title + ' · rpgStudio';
  await loadProjects();
  $('#nSw').textContent = P.switches; $('#nVar').textContent = P.variables;
  // 挂在别的工具里时（别的编辑器 / 云端），顶栏放回去的链接
  $('#hostLinks').innerHTML = (P.links || []).map(l => `<a class="tag" href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
  $('#newSceneBtn').onclick = () => sceneDialog({});
  $('#playTitle').onclick = () => { $('#playMenu').open = false; playGame({}); };
  $('#playNew').onclick = () => { $('#playMenu').open = false; playGame({ skipTitle: true }); };
  await Promise.all([loadMaps(), loadProgress()]);
  render();
}
async function loadMaps() {
  const [m, c] = await Promise.all([api('maps'), api('ces')]);
  S.maps = m.maps; S.ces = c.ces;
  drawNav();
}
function setTab(t) {
  S.tab = t; remember();
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  drawNav();
}
function drawNav() {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const q = $('#navq').value.trim().toLowerCase();
  const box = $('#navlist');
  if (S.tab === 'ces') {
    const rows = (S.ces || []).filter(c => !q || (c.id + ' ' + c.name).toLowerCase().includes(q));
    box.innerHTML = `<div class="celist">${rows.map(c => `<a href="#/ce/${c.id}" data-ce="${c.id}" title="${esc(c.hint || c.triggerText || '')}">
      <span class="id num">${c.id}</span>${c.trigger ? `<span class="dot ${c.trigger === 1 ? 'auto' : 'par'}" title="${esc(c.triggerText)}"></span>` : ''}
      <span class="nm">${esc(c.name || '（未命名）')}</span><span class="ct faint num">${c.lines ? c.lines + ' 句' : ''}</span></a>`).join('')}</div>
      <div style="padding:10px 4px"><button class="small" id="newCe">新建公共事件</button></div>`;
    $('#newCe').onclick = newCeDialog;
  } else {
    const kids = new Map();
    for (const m of S.maps) { const k = m.parentId || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(m); }
    for (const arr of kids.values()) arr.sort((a, b) => a.order - b.order);
    const match = m => !q || (m.id + ' ' + m.name).toLowerCase().includes(q);
    const visible = new Set();
    if (q) { const byId = new Map(S.maps.map(m => [m.id, m])); for (const m of S.maps) if (match(m)) { let x = m; while (x) { visible.add(x.id); x = byId.get(x.parentId); } } }
    const node = m => {
      if (q && !visible.has(m.id)) return '';
      const ch = kids.get(m.id) || [];
      const open = q || S.open.has(m.id);
      return `<div><a href="#/map/${m.id}" data-map="${m.id}" title="${m.events} 个事件 · ${m.lines} 句台词">
        ${ch.length ? `<button class="tw" data-tw="${m.id}" aria-label="${open ? '收起' : '展开'}">${open ? '▾' : '▸'}</button>` : '<span class="tw"></span>'}
        <span class="id num">${m.id}</span><span class="nm">${esc(m.name)}</span>
        ${m.auto ? '<span class="dot auto" title="有自动执行/并行处理的事件页"></span>' : ''}
        <span class="ct num">${m.lines ? `<i>${m.lines}</i> 句` : m.events ? m.events + ' 事件' : ''}</span></a>
        ${ch.length && open ? `<div class="kid">${ch.map(node).join('')}</div>` : ''}</div>`;
    };
    box.innerHTML = `<div class="tree">${(kids.get(0) || []).map(node).join('') || '<div class="faint" style="padding:10px">没有地图</div>'}</div>
      <div style="padding:10px 4px"><button class="small" id="newMapTop">新建地图</button></div>`;
    $('#newMapTop').onclick = () => newMapDialog(0);
    $$('[data-tw]', box).forEach(b => b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const id = Number(b.dataset.tw);
      S.open.has(id) ? S.open.delete(id) : S.open.add(id);
      remember(); drawNav();
    });
  }
  markNav(route());
}
function markNav(r) {
  $$('#navlist a').forEach(a => a.classList.toggle('on', !!(
    (a.dataset.map && (r.name === 'map' || r.name === 'event') && Number(a.dataset.map) === Number(r.a)) ||
    (a.dataset.ce && r.name === 'ce' && Number(a.dataset.ce) === Number(r.a)))));
}
// 打开某张地图时，把它的上级都展开
function revealMap(id) {
  const byId = new Map(S.maps.map(m => [m.id, m]));
  let x = byId.get(id), changed = false;
  while (x && x.parentId) { if (!S.open.has(x.parentId)) { S.open.add(x.parentId); changed = true; } x = byId.get(x.parentId); }
  if (S.tab !== 'maps') { S.tab = 'maps'; changed = true; }
  if (changed) { remember(); drawNav(); }
}

// ---------- 右栏：引用 ----------
function closeSide() { S.side = null; $('#shell').classList.add('noside'); $('#side').innerHTML = ''; $$('.ntable tr.on').forEach(t => t.classList.remove('on')); }
async function showRefs(kind, id) {
  if (kind === 'map') { location.hash = '#/map/' + id; return; }
  if (kind === 'actor') { location.hash = '#/people/a' + id; return; }
  if (kind === 'ce') { location.hash = '#/ce/' + id; return; }
  const side = $('#side');
  $('#shell').classList.remove('noside');
  side.innerHTML = '<div class="side-in loading">正在查找…</div>';
  S.side = { kind, id };
  try {
    const r = await api('refs?kind=' + enc(kind) + '&id=' + enc(id));
    const groups = { set: [], check: [], script: [], other: [] };
    for (const x of r.refs) (groups[x.use] || groups.other).push(x);
    const USE = { set: '改它的地方', check: '判断它的地方', script: '脚本里用到', other: '其它' };
    const TAG = { set: '设置', check: '判断', script: '脚本', call: '调用', go: '传送', show: '显示', say: '台词' };
    side.innerHTML = `<div class="side-in">
      <button class="quiet small sideclose" id="sideX" aria-label="关闭">关闭</button>
      <h2>${esc(r.label)}</h2>
      ${r.hint ? `<div style="margin:6px 0"><span class="hint">${esc(r.hint)}</span></div>` : ''}
      <div class="dim">${r.refs.length ? `用到 ${r.refs.length} 处` : '没有任何地方用到它'}</div>
      ${kind === 'picture' ? `<img class="sidepic" src="${img('pictures', id)}" alt="${esc(id)}">` : ''}
      ${Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `<div class="refgroup"><h3>${USE[k]}（${v.length}）</h3>
        ${v.map(x => `<a class="refitem" href="${hrefOf(x.at)}"><div class="w">${esc(x.where)}</div><div class="t"><span class="usetag ${x.use}">${TAG[x.use] || x.use}</span>${esc(x.text)}</div></a>`).join('')}</div>`).join('')}
    </div>`;
    $('#sideX').onclick = closeSide;
  } catch (e) { side.innerHTML = `<div class="side-in"><div class="err">${esc(e.message)}</div></div>`; }
}
const hrefOf = at => !at ? '#/' : at.type === 'map' ? (at.ev != null ? `#/event/${at.map}/${at.ev}/${at.page || 0}` : `#/map/${at.map}`) : at.type === 'ce' ? `#/ce/${at.ce}` : at.type === 'actor' ? `#/people/a${at.actor}` : '#/';

document.addEventListener('click', e => {
  const r = e.target.closest('.ref');
  if (r) { e.preventDefault(); showRefs(r.dataset.kind, r.dataset.id); }
});
document.addEventListener('keydown', e => {
  const r = e.target.closest && e.target.closest('.ref');
  if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showRefs(r.dataset.kind, r.dataset.id); }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'Escape' && S.side && !$('#dlg').open) closeSide();
});
