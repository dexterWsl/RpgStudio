'use strict';
// 工程：顶栏切换、工程列表、导入游戏（上传 zip / 本机文件夹）
let PROJ = null;   // 工程列表（没开工程列表的服务里是 null）
async function loadProjects() {
  try { PROJ = await api('projects'); } catch { PROJ = null; }
  drawProjSwitch();
  return PROJ;
}
function drawProjSwitch() {
  const P = S.project;
  const box = $('#proj');
  const title = P ? `<strong>${esc(P.title)}</strong><span class="tag">${esc(P.engine)}${P.engineVersion ? ' ' + esc(P.engineVersion) : ''}</span>` : '<strong>还没有工程</strong>';
  if (!PROJ) { box.innerHTML = title; return; }
  box.innerHTML = `<details class="pswitch"><summary title="${esc(P ? P.gameDir : '')}">${title}<span class="pchev" aria-hidden="true"></span></summary>
    <div class="pmenu" role="menu">
      ${PROJ.list.map(p => `<button type="button" role="menuitem" data-proj="${esc(p.id)}" class="${p.id === PROJ.current ? 'on' : ''}" ${p.ok ? '' : 'disabled'}>
        <span class="pm-name">${esc(p.name)}</span><span class="pm-meta">${p.ok ? `${esc(p.engine)} · ${p.maps} 张地图${p.builtin ? ' · 内置' : p.mode === 'inplace' ? ' · 原文件夹' : ''}` : '打不开'}</span></button>`).join('')}
      <div class="pm-sep"></div>
      <a href="#/projects/import" role="menuitem">导入游戏…</a>
      <a href="#/projects" role="menuitem">管理工程</a>
      ${P ? '<button type="button" role="menuitem" id="pmSettings"><span class="pm-name">工程设置</span><span class="pm-meta">游戏配置、剧情图片编号段</span></button>' : ''}
    </div></details>`;
  const d = $('.pswitch', box);
  $$('[data-proj]', box).forEach(b => b.onclick = () => { d.open = false; if (b.dataset.proj !== PROJ.current) switchProject(b.dataset.proj); });
  $$('a', box).forEach(a => a.onclick = () => { d.open = false; });
  if ($('#pmSettings', box)) $('#pmSettings', box).onclick = () => { d.open = false; settingsDialog(); };
}
document.addEventListener('click', e => { const d = $('.pswitch[open]'); if (d && !d.contains(e.target)) d.open = false; });
async function switchProject(id) {
  if (S.dirty && !confirm('改的台词还没保存，确定切换工程？')) return;
  try { await api('projects/use', { id }); S.dirty = false; location.hash = '#/'; location.reload(); }
  catch (e) { toast(e.message, true); }
}
const fmtBytes = n => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
// 上传一个文件（带进度）：XMLHttpRequest 才拿得到上传进度
function uploadFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('content-type', 'application/octet-stream');
    if (S.project && S.project.projectKey) x.setRequestHeader('x-studio-project', S.project.projectKey);
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status === 401) { location.href = '/login'; return reject(new Error('需要登录')); }
      let j = null; try { j = JSON.parse(x.responseText); } catch { }
      if (x.status >= 200 && x.status < 300 && j) resolve(j); else reject(new Error((j && j.error) || '上传失败（' + x.status + '）'));
    };
    x.onerror = () => reject(new Error('网络断了，上传没完成'));
    x.send(file);
  });
}

async function viewProjects(main, sub) {
  main.innerHTML = '<div class="loading">正在读取工程…</div>';
  const v = await loadProjects();
  if (!v) { main.innerHTML = '<div class="page"><div class="empty">这个服务没有打开工程列表。</div></div>'; return; }
  const cur = v.list.find(p => p.id === v.current);
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>选择游戏</h1><span class="dim">打开已有游戏，或导入你自己的 RPG Maker MZ / MV 文件夹</span></div>
    ${S.noGame ? `<div class="warnline">${esc(S.noGame)}。换一个工程，或者导入一个游戏。</div>` : ''}
    <div class="projlist">${v.list.map(p => `<div class="card projcard ${p.id === v.current ? 'cur' : ''} ${p.ok ? '' : 'bad'}">
      <div class="pc-main">
        <div class="pc-title"><b>${esc(p.name)}</b>${p.ok ? `<span class="tag">${esc(p.engine)}</span>` : ''}${p.id === v.current ? '<span class="tag acc">当前</span>' : ''}</div>
        <div class="pc-meta">${p.ok ? `${p.title && p.title !== p.name ? esc(p.title) + ' · ' : ''}${p.maps} 张地图${p.encryptedImages ? ' · 图片加密' : ''}` : `<span class="warnt">${esc(p.error)}</span>`}</div>
        <div class="pc-path" title="${esc(p.gameDir)}">${p.builtin ? '内置工程 · ' : p.mode === 'inplace' ? '直接改原文件夹 · ' : '复制进系统 · '}${esc(p.gameDir)}</div>
      </div>
      <div class="pc-acts">
        ${p.id === v.current ? (p.ok ? '<a class="tag" href="#/">打开编辑器</a>' : '') : `<button class="small ${p.ok ? 'primary' : ''}" data-use="${esc(p.id)}" ${p.ok ? '' : 'disabled'}>切换并打开</button>`}
        ${p.builtin ? '' : moreMenu([{ id: 'pr-' + p.id, label: '改名' }, { id: 'pe-' + p.id, label: '导出改过的文件（zip）' }, { id: 'pd-' + p.id, label: p.mode === 'copy' ? '移除（连复制的文件一起删）' : '从列表里移除（原文件夹不动）', danger: true }])}
      </div>
    </div>`).join('')}</div>
    <div class="section" id="newSec"><h2>新建游戏</h2><span class="dim">从零开始做一个 MZ 游戏：引擎从 RPG Maker MZ 自带的空白工程或者你已有的 MZ 游戏里拷</span></div>
    <div class="card importbox" id="newBox"><div class="loading">正在找引擎…</div></div>
    <div class="section" id="importSec"><h2>导入游戏</h2><span class="dim">RPG Maker MZ / MV 的工程或者部署好的游戏都行（要有 data 文件夹；只有 exe 的要先解包）</span></div>
    <div class="card importbox">
      <div class="seg" id="imTabs">${v.canImportFolder ? '<button data-im="folder" class="on">本机文件夹</button>' : ''}<button data-im="zip" ${v.canImportFolder ? '' : 'class="on"'}>上传压缩包</button></div>
      <div id="imZip" ${v.canImportFolder ? 'hidden' : ''}>
        <label class="drop" id="gameDrop"><input type="file" accept=".zip" id="gameFile" hidden><span>把游戏的 <b>zip</b> 拖到这里，或者点这里选文件</span><span class="faint">会复制一份进系统再改，原来的压缩包不动</span></label>
        <div class="upbar" id="gameBar" hidden><div class="upfill"></div><span class="uptext"></span></div>
      </div>
      <div id="imFolder" ${v.canImportFolder ? '' : 'hidden'}>
        <div class="fgrid">
          <label for="fdPath">游戏文件夹</label><div class="folder-input"><input id="fdPath" placeholder="选择游戏所在文件夹，或直接粘贴路径"><button id="fdBrowse" type="button">浏览文件夹…</button></div>
          <label for="fdName">名字</label><input id="fdName" placeholder="不填就用游戏标题" maxlength="60">
          <span>方式</span><div class="imodes">
            <label class="switch"><input type="radio" name="fdMode" value="copy" checked><span>复制一份进系统（推荐，原游戏不动）</span></label>
            <label class="switch"><input type="radio" name="fdMode" value="inplace"><span>直接改原文件夹（每次保存前自动备份）</span></label>
          </div>
        </div>
        <div class="fnote">文件夹指的是运行这个服务的那台电脑上的路径。可以填游戏的上一层，会往下找 3 层。</div>
        <div class="edbar"><button class="primary" id="fdGo">导入</button></div>
      </div>
      <div id="imErr"></div>
    </div>
    <p class="dim" style="margin-top:8px;font-size:12.5px">复制进来的游戏放在 ${esc(v.dir)}</p>
  </div>`;
  bindMenu(main);
  $$('[data-use]', main).forEach(b => b.onclick = () => switchProject(b.dataset.use));
  for (const p of v.list.filter(x => !x.builtin)) {
    $('#pr-' + p.id).onclick = async () => {
      const n = await promptDialog('改名', '工程名字', p.name);
      if (!n) return;
      try { await api('projects/rename', { id: p.id, name: n }); toast('已改名'); render(); } catch (e) { toast(e.message, true); }
    };
    $('#pe-' + p.id).onclick = () => { location.href = '/api/studio/projects/export?id=' + enc(p.id); };
    $('#pd-' + p.id).onclick = async () => {
      const del = p.mode === 'copy';
      if (!await confirmDialog('移除工程', del ? `移除「${p.name}」并删掉复制进来的文件（${p.gameDir}）？改过的东西没导出的话会丢。` : `把「${p.name}」从列表里拿掉？原文件夹 ${p.gameDir} 不会动。`, del ? '移除并删除文件' : '移除')) return;
      try { await api('projects/remove', { id: p.id, deleteFiles: del }); toast('已移除'); if (p.id === v.current) location.reload(); else render(); } catch (e) { toast(e.message, true); }
    };
  }
  const showTab = t => { $$('#imTabs button').forEach(b => b.classList.toggle('on', b.dataset.im === t)); $('#imZip').hidden = t !== 'zip'; $('#imFolder').hidden = t !== 'folder'; };
  $$('#imTabs button').forEach(b => b.onclick = () => showTab(b.dataset.im));
  $('#fdBrowse').onclick = async () => {
    const chosen = await browseGameFolder($('#fdPath').value.trim());
    if (chosen && $('#fdPath')) $('#fdPath').value = chosen;
  };
  const err = m => { $('#imErr').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
  const done = r => { toast(`已导入「${r.project.name}」（${r.info.engine}，${r.info.maps} 张地图），已切换过去`); location.hash = '#/'; location.reload(); };
  const sendZip = async file => {
    err('');
    if (!/\.zip$/i.test(file.name)) return err('只支持 zip（rar / 7z 先转成 zip，或者用「本机文件夹」导入）');
    const bar = $('#gameBar');
    bar.hidden = false;
    const set = (k, t) => { $('.upfill', bar).style.width = Math.round(k * 100) + '%'; $('.uptext', bar).textContent = t; };
    set(0, `上传 ${file.name}（${fmtBytes(file.size)}）…`);
    try {
      const r = await uploadFile('/api/studio/upload/game?name=' + enc(file.name), file, k => set(k * 0.9, k < 1 ? `上传中 ${Math.round(k * 100)}%` : '上传完了，正在解压…'));
      set(1, '导入完成');
      done(r);
    } catch (e) { bar.hidden = true; err(e.message); }
  };
  $('#gameFile').onchange = e => { if (e.target.files[0]) sendZip(e.target.files[0]); };
  const drop = $('#gameDrop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) sendZip(f); };
  $('#fdGo').onclick = async () => {
    err('');
    const b = $('#fdGo'); b.disabled = true; b.textContent = '正在导入…';
    try { done(await api('projects/folder', { path: $('#fdPath').value, name: $('#fdName').value, mode: $('input[name=fdMode]:checked').value })); }
    catch (e) { err(e.message); b.disabled = false; b.textContent = '导入'; }
  };
  mountNewGame($('#newBox'), v);
  if (sub === 'import') { $('#importSec').scrollIntoView({ block: 'start' }); }
  if (sub === 'new') { $('#newSec').scrollIntoView({ block: 'start' }); }
}

// 新建游戏：选引擎来源（找到的 RPG Maker MZ / 列表里的 MZ 游戏 / 别的文件夹），要不要连素材一起拷
async function mountNewGame(box, v) {
  let eng;
  try { eng = await api('projects/engines'); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  const srcs = [
    ...eng.installs.map((x, i) => ({ key: 'i' + i, label: x.label, meta: (x.version ? 'v' + x.version + ' · ' : '') + x.path, engine: { path: x.path }, assets: true, newdata: true })),
    ...eng.games.map(x => ({ key: 'g' + x.project, label: x.label, meta: (x.version ? 'MZ ' + x.version + ' · ' : '') + '只拷引擎，素材是那个游戏的', engine: { project: x.project }, assets: false })),
  ];
  box.innerHTML = `<div class="fgrid">
      <label for="ngTitle">游戏名</label><input id="ngTitle" maxlength="60" placeholder="比如：孤独之旅">
      <label for="ngHero">主角叫什么</label><input id="ngHero" maxlength="20" placeholder="不填就叫「主角」，以后在「人物」里改">
      <span>引擎从哪拷</span><div class="imodes" id="ngSrcs">
        ${srcs.map((s, i) => `<label class="switch"><input type="radio" name="ngSrc" value="${esc(s.key)}" ${i === 0 ? 'checked' : ''}><span><b>${esc(s.label)}</b> <span class="faint">${esc(s.meta)}</span></span></label>`).join('')}
        ${eng.canBrowse ? `<label class="switch"><input type="radio" name="ngSrc" value="path" ${srcs.length ? '' : 'checked'}><span>别的文件夹（RPG Maker MZ 的 newdata，或者任何 MZ 游戏）</span></label>
          <div class="folder-input" id="ngPathRow" ${srcs.length ? 'hidden' : ''}><input id="ngPath" placeholder="比如 D:\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata"><button id="ngBrowse" type="button">浏览文件夹…</button></div>` : ''}
      </div>
      <span>素材</span><label class="switch"><input type="checkbox" id="ngAssets"><span>连图块、行走图、声音一起拷（RPG Maker 自带的空白工程推荐；别人的游戏别拷）</span></label>
    </div>
    <div class="fnote">不拷素材也能直接跑：窗口、按钮会画几张朴素的占位图，地图是空的。之后在「导入素材」里放你自己的图，「图块集」里设通行。</div>
    ${!srcs.length && !eng.canBrowse ? '<div class="warnline">没找到能用的引擎：先导入一个 MZ 游戏。</div>' : ''}
    <div class="edbar"><button class="primary" id="ngGo">新建并打开</button></div><div id="ngErr"></div>`;
  const pick = () => { const r = $('input[name=ngSrc]:checked', box); return r ? r.value : ''; };
  const sync = () => {
    const k = pick(), s = srcs.find(x => x.key === k);
    if ($('#ngPathRow', box)) $('#ngPathRow', box).hidden = k !== 'path';
    $('#ngAssets', box).checked = s ? !!s.assets : /newdata/i.test(($('#ngPath', box) || {}).value || '');
  };
  $$('input[name=ngSrc]', box).forEach(r => r.onchange = sync);
  sync();
  if ($('#ngBrowse', box)) $('#ngBrowse', box).onclick = async () => { const c = await browseGameFolder($('#ngPath', box).value.trim()); if (c) { $('#ngPath', box).value = c; sync(); } };
  $('#ngGo', box).onclick = async () => {
    const k = pick(), s = srcs.find(x => x.key === k);
    const engine = s ? s.engine : { path: ($('#ngPath', box) || {}).value || '' };
    const b = $('#ngGo', box);
    $('#ngErr', box).innerHTML = '';
    b.disabled = true; b.textContent = '正在新建…';
    try {
      const r = await api('projects/new', { title: $('#ngTitle', box).value, hero: $('#ngHero', box).value, engine, copyAssets: $('#ngAssets', box).checked });
      toast(`已新建「${r.project.name}」（MZ ${r.engine.version || ''}），已切换过去`);
      location.hash = '#/'; location.reload();
    } catch (e) { $('#ngErr', box).innerHTML = `<div class="err">${esc(e.message)}</div>`; b.disabled = false; b.textContent = '新建并打开'; }
  };
}

// ---------- 试玩：在新标签页里跑游戏（?new=1 跳过标题；map/x/y 从某个格子开始；v<变量>=值 先设好进度） ----------
function playUrl(o = {}) {
  const P = S.project;
  if (!P || !P.play) return '';
  const q = new URLSearchParams();
  if (o.map) { q.set('map', o.map); q.set('x', o.x == null ? -1 : o.x); q.set('y', o.y == null ? -1 : o.y); if (o.d) q.set('d', o.d); }
  else if (o.skipTitle) q.set('new', '1');
  for (const [k, val] of Object.entries(o.vars || {})) q.set('v' + k, val);
  for (const [k, val] of Object.entries(o.switches || {})) q.set('s' + k, val ? 1 : 0);
  const s = q.toString();
  return P.play + (s ? '?' + s : '');
}
function playGame(o) {
  if (S.dirty && !confirm('改的台词还没保存，试玩的是保存过的版本。继续？')) return;
  const u = playUrl(o);
  if (u) window.open(u, 'rpgstudio-play');
}

async function browseGameFolder(initialPath) {
  return openDialog(`<header><h3>选择游戏文件夹</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="folder-input"><input id="fbPath" aria-label="当前文件夹路径" placeholder="选择磁盘，或粘贴文件夹路径"><button id="fbGo" type="button">前往</button></div>
      <div class="folder-toolbar"><button id="fbRoots" type="button">磁盘列表</button><button id="fbUp" type="button">上一级</button><span id="fbHint" class="dim"></span></div>
      <div id="fbList" class="folder-list"></div><div id="fbError" class="err" hidden></div>
    </div><footer><button data-cancel>取消</button><span class="sp"></span><button class="primary" id="fbChoose" disabled>选择这个文件夹</button></footer>`,
    (d, done) => {
      let current = null, sequence = 0;
      const load = async folder => {
        const request = ++sequence;
        $('#fbChoose', d).disabled = true;
        $('#fbError', d).hidden = true;
        $('#fbList', d).innerHTML = '<div class="loading">正在读取文件夹…</div>';
        try {
          const result = await api('projects/folders?path=' + enc(folder || ''));
          if (!d.open || request !== sequence || !$('#fbList', d)) return;
          current = result;
          $('#fbPath', d).value = result.path;
          $('#fbUp', d).disabled = !result.path;
          $('#fbChoose', d).disabled = !result.path;
          $('#fbHint', d).textContent = result.game ? '已识别 RPG Maker 游戏' : result.path ? '打开子文件夹，或选择当前文件夹' : '选择游戏所在的磁盘';
          $('#fbList', d).innerHTML = result.folders.map(f => `<button type="button" class="folder-row" data-path="${esc(f.path)}"><span>${esc(f.name)}</span><span class="dim">${f.game ? 'RPG Maker 游戏' : '打开 ›'}</span></button>`).join('') || '<div class="empty">没有子文件夹，可以选择当前文件夹</div>';
          $$('[data-path]', d).forEach(b => b.onclick = () => load(b.dataset.path));
        } catch (e) {
          if (!d.open || request !== sequence || !$('#fbList', d)) return;
          $('#fbList', d).innerHTML = '';
          $('#fbError', d).textContent = e.message;
          $('#fbError', d).hidden = false;
        }
      };
      $('[data-x]', d).onclick = $('[data-cancel]', d).onclick = () => done(null);
      $('#fbRoots', d).onclick = () => load('');
      $('#fbUp', d).onclick = () => load(current ? current.parent : '');
      $('#fbGo', d).onclick = () => load($('#fbPath', d).value.trim());
      $('#fbPath', d).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); load(e.target.value.trim()); } };
      $('#fbChoose', d).onclick = () => { if (current && current.path) done(current.path); };
      load(initialPath || '');
    }).then(v => v || null);
}
