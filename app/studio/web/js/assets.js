'use strict';
// 导入素材包：拖进 zip / 一堆图片和声音（可以连文件夹）→ 看分类、改名字 → 导入
const SUB_LABEL = {
  pictures: '图片（立绘 / CG）', characters: '行走图', faces: '头像', tilesets: '图块', parallaxes: '远景', battlebacks1: '战斗背景 1', battlebacks2: '战斗背景 2',
  enemies: '敌人', sv_actors: '横版角色', sv_enemies: '横版敌人', animations: '动画', system: '系统图', titles1: '标题图 1', titles2: '标题图 2',
  bgm: '背景音乐 BGM', bgs: '环境音 BGS', me: '音乐效果 ME', se: '音效 SE', movies: '视频',
};
const PROBLEM = { needPng: '会先转成 PNG', bad: '不是能用的图片', encryptedAudio: '加密的声音不能导入', audioFormat: 'RPG Maker 只认 ogg / m4a', cloudAudio: '云端暂时只能导入图片' };
let AS = null;   // { id, files, game, subs, pick: Map(path → {on, sub, name}) }

// 拖进来的东西：文件夹要一层层读出来，保留相对路径（分类会看目录名）
async function droppedFiles(dt) {
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files].map(f => ({ file: f, rel: f.name }));
  const out = [];
  const readAll = r => new Promise(res => { const all = []; const step = () => r.readEntries(es => { if (!es.length) return res(all); all.push(...es); step(); }, () => res(all)); step(); });
  const walk = async (en, pre) => {
    if (en.isFile) { const f = await new Promise((res, rej) => en.file(res, rej)); out.push({ file: f, rel: pre + f.name }); }
    else if (en.isDirectory) for (const c of await readAll(en.createReader())) await walk(c, pre + en.name + '/');
  };
  for (const en of items) await walk(en, '');
  return out;
}

async function viewAssets(main) {
  main.innerHTML = `<div class="page wide">
    <div class="titlebar"><h1>导入素材</h1><span class="dim">图片、行走图、头像、图块、声音……先看分到哪里，再导入</span></div>
    <div class="drop big" id="asDrop" tabindex="0" role="button" aria-label="选要导入的素材">
      <span>把<b>素材包 zip</b>、一堆图片 / 声音、或者整个文件夹拖到这里</span>
      <span class="faint">也可以 <button type="button" class="linkbtn" id="asPick">选文件</button> 或 <button type="button" class="linkbtn" id="asPickDir">选文件夹</button></span>
    </div>
    <input type="file" id="asFile" multiple hidden><input type="file" id="asDir" webkitdirectory hidden>
    <div class="upbar" id="asBar" hidden><div class="upfill"></div><span class="uptext"></span></div>
    <div id="asErr"></div>
    <div id="asBody"></div>
  </div>`;
  const err = m => { $('#asErr').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
  const send = async list => {
    err('');
    if (!list.length) return;
    const bar = $('#asBar'); bar.hidden = false;
    const total = list.reduce((n, x) => n + x.file.size, 0);
    let sent = 0, id = AS && AS.id ? AS.id : '';
    const set = t => { $('.upfill', bar).style.width = Math.round(sent / Math.max(1, total) * 100) + '%'; $('.uptext', bar).textContent = t; };
    try {
      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        set(`上传 ${i + 1} / ${list.length}：${x.rel}`);
        const r = await uploadFile('/api/studio/upload/assets?name=' + enc(x.rel) + (id ? '&id=' + id : ''), x.file, k => { set(`上传 ${i + 1} / ${list.length}：${x.rel} ${Math.round(k * 100)}%`); });
        id = r.id; sent += x.file.size;
      }
      set('正在分类…');
      await loadStaging(id);
      bar.hidden = true;
    } catch (e) { bar.hidden = true; err(e.message); if (id) await loadStaging(id).catch(() => { }); }
  };
  const drop = $('#asDrop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); send(await droppedFiles(e.dataTransfer)); };
  $('#asPick').onclick = e => { e.stopPropagation(); $('#asFile').click(); };
  $('#asPickDir').onclick = e => { e.stopPropagation(); $('#asDir').click(); };
  drop.onclick = e => { if (!e.target.closest('button')) $('#asFile').click(); };
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#asFile').click(); } };
  $('#asFile').onchange = e => send([...e.target.files].map(f => ({ file: f, rel: f.name })));
  $('#asDir').onchange = e => send([...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name })));
  if (AS && AS.id) loadStaging(AS.id).catch(() => { AS = null; });
}

async function loadStaging(id) {
  const [st, pictures] = await Promise.all([
    api('assets/staging?id=' + enc(id)),
    api('images?sub=pictures').catch(() => ({ names: [] })),
  ]);
  const previous = AS && AS.id === id ? AS : null;
  const old = previous ? previous.pick : new Map();
  AS = {
    ...st, pick: new Map(), pictureNames: pictures.names,
    filter: previous?.filter || 'all', conflict: previous?.conflict || 'rename',
    folder: previous?.folder || '导入', customFolder: previous?.customFolder || '',
  };
  for (const f of st.files) {
    const o = old.get(f.path);
    const usable = f.kind !== 'other' && (!f.problem || f.problem === 'needPng');
    AS.pick.set(f.path, o || { on: usable, sub: f.sub, name: f.name });
  }
  drawStaging();
}

function drawStaging() {
  const box = $('#asBody');
  if (!box || !AS) return;
  const usable = f => f.kind !== 'other' && (!f.problem || f.problem === 'needPng');
  const files = AS.files;
  const fileByPath = new Map(files.map(file => [file.path, file]));
  const subsOf = f => (f.kind === 'image' ? AS.subs.image : f.kind === 'audio' ? AS.subs.audio : f.kind === 'video' ? ['movies'] : []);
  const pictureNames = new Set(AS.pictureNames);
  const folders = pictureFolders(AS.pictureNames).filter(folder => folder !== '导入');
  const hasConflict = f => {
    const p = AS.pick.get(f.path);
    return (p.sub === 'pictures' && pictureNames.has(p.name.trim().replace(/\\/g, '/')))
      || (f.exists && p.sub === f.sub && p.name === f.name);
  };
  const cgRows = () => files.filter(f => {
    const p = AS.pick.get(f.path);
    return usable(f) && p.on && p.sub === 'pictures';
  });
  const counts = {};
  for (const f of files) { const p = AS.pick.get(f.path); if (usable(f)) counts[p.sub] = (counts[p.sub] || 0) + 1; }
  const groups = Object.keys(counts);
  const shown = files.filter(f => AS.filter === 'all' || (AS.filter === 'problem' ? !usable(f) || hasConflict(f) : usable(f) && AS.pick.get(f.path).sub === AS.filter));
  const on = files.filter(f => usable(f) && AS.pick.get(f.path).on);
  const problems = files.filter(f => !usable(f) || hasConflict(f)).length;
  box.innerHTML = `
    <div class="asbar">
      <span id="asCount"></span>
      <span class="sp"></span>
      <label class="switch">同名时 <select id="asConflict"><option value="rename">改名（加 _2）</option><option value="overwrite">覆盖（先备份）</option><option value="skip">跳过</option></select></label>
      <button class="quiet small" id="asClear">清空</button>
      <button class="primary" id="asGo" ${on.length ? '' : 'disabled'}>导入 ${on.length} 个</button>
    </div>
    ${files.some(f => f.kind === 'image' && usable(f)) ? `<div class="asbar as-cg-folder">
      <label for="asFolder">CG 目标文件夹</label>
      <select id="asFolder"><option value="导入">导入（自动创建）</option><option value="/">图片根目录</option>${folders.map(folder => `<option value="${esc(folder)}">${esc(folder)}</option>`).join('')}<option value="*">新建文件夹…</option></select>
      <input id="asFolderName" class="hidden" aria-label="新文件夹名称" placeholder="例如 第一章/夜晚" value="${esc(AS.customFolder)}">
      <button type="button" class="small" id="asApplyFolder">应用到勾选的 CG</button>
      <span class="dim">适用于分类为「图片（立绘 / CG）」的素材</span>
    </div>` : ''}
    <div class="asnote">${AS.game.encryptedImages || AS.game.encryptedAudio ? `这个游戏的${AS.game.encryptedImages ? '图片' : ''}${AS.game.encryptedImages && AS.game.encryptedAudio ? '和' : ''}${AS.game.encryptedAudio ? '声音' : ''}是加密的，导入时会用游戏的密钥加密。` : ''}别的游戏加密过的图（.png_ / .rpgmvp）会先解开。</div>
    <div class="seg asfilter" id="asF"><button data-f="all">全部 ${files.length}</button>${groups.map(g => `<button data-f="${g}">${esc((SUB_LABEL[g] || g).replace(/（.*）/, ''))} ${counts[g]}</button>`).join('')}${problems ? `<button data-f="problem">要看一下 ${problems}</button>` : ''}</div>
    <div class="aslist">${shown.map(f => {
      const p = AS.pick.get(f.path);
      const ok = usable(f);
      const thumb = f.kind === 'image' && f.problem !== 'bad' ? `<img loading="lazy" src="/api/studio/assets/file?id=${enc(AS.id)}&path=${enc(f.path)}" alt="">` : f.kind === 'audio' && ok ? '<button type="button" class="small asplay" title="试听">▶</button>' : `<span class="asext">${esc(f.type || '?')}</span>`;
      return `<div class="asrow ${ok ? '' : 'off'} ${p.on && ok ? 'on' : ''}" data-p="${esc(f.path)}">
        <input type="checkbox" ${p.on && ok ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="导入这个">
        <span class="asthumb">${thumb}</span>
        <span class="asinfo"><span class="aspath" title="${esc(f.path)}">${esc(f.path)}</span><span class="faint">${f.w ? f.w + '×' + f.h + ' · ' : ''}${fmtBytes(f.size)}${f.encrypted ? ' · 加密的' : ''}${ok && f.why ? ' · ' + esc(f.why) : ''}</span></span>
        ${ok ? `<select aria-label="分到">${subsOf(f).map(s => `<option value="${s}" ${s === p.sub ? 'selected' : ''}>${esc(SUB_LABEL[s] || s)}</option>`).join('')}</select>
        <input class="asname" value="${esc(p.name)}" aria-label="导入后的名字">` : `<span class="asprob">${esc(f.kind === 'other' ? '不是素材，不导入' : PROBLEM[f.problem] || '')}</span><span></span>`}
        <span class="asstat">${ok && f.problem === 'needPng' ? '<span class="tag">转 PNG</span>' : ''}<span class="tag warn as-duplicate ${ok && hasConflict(f) ? '' : 'hidden'}">同名</span></span>
      </div>`;
    }).join('') || '<div class="empty" style="border:0">没有</div>'}</div>
    <div id="asResult"></div>`;
  $('#asConflict').value = AS.conflict;
  $('#asConflict').onchange = e => { AS.conflict = e.target.value; };
  const folderSelect = $('#asFolder');
  if (folderSelect) {
    const custom = $('#asFolderName');
    folderSelect.value = AS.folder;
    const showCustom = () => custom.classList.toggle('hidden', folderSelect.value !== '*');
    folderSelect.onchange = () => { AS.folder = folderSelect.value; showCustom(); };
    custom.oninput = () => { AS.customFolder = custom.value; };
    showCustom();
    $('#asApplyFolder').onclick = () => {
      const rows = cgRows();
      const folder = AS.folder === '*' ? AS.customFolder.trim().replace(/\\/g, '/') : AS.folder;
      const root = AS.folder === '/';
      const parts = folder.split('/');
      const invalid = parts.some(part => !part || /[<>:"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part));
      if (!root && (invalid || parts.length > 4)) {
        toast('请填写有效的文件夹名称，最多四层', true);
        return;
      }
      const names = rows.map(f => AS.pick.get(f.path).name.trim().replace(/\\/g, '/').split('/').pop());
      if (names.some(name => !name)) { toast('请先填写勾选图片的名称', true); return; }
      rows.forEach((f, i) => { AS.pick.get(f.path).name = root ? names[i] : folder + '/' + names[i]; });
      drawStaging();
      toast(`已设置 ${rows.length} 张 CG 的保存位置`);
    };
  }
  $$('#asF button').forEach(b => { b.classList.toggle('on', b.dataset.f === AS.filter); b.onclick = () => { AS.filter = b.dataset.f; drawStaging(); }; });
  $$('.asrow', box).forEach(row => {
    const f = fileByPath.get(row.dataset.p);
    const p = AS.pick.get(row.dataset.p);
    const updateConflict = () => {
      $('.as-duplicate', row).classList.toggle('hidden', !usable(f) || !hasConflict(f));
      updateGo();
    };
    const cb = $('input[type=checkbox]', row);
    if (cb) cb.onchange = () => { p.on = cb.checked; row.classList.toggle('on', cb.checked); updateGo(); };
    const sel = $('select', row);
    if (sel) sel.onchange = () => {
      p.sub = sel.value;
      // 单人行走图名字要以 $ 开头
      if (p.sub === 'characters' && !/^[!$]/.test(p.name) && f.w && f.w % 12 && f.w % 3 === 0) {
        p.name = '$' + p.name;
        $('.asname', row).value = p.name;
      }
      updateConflict();
    };
    const nm = $('.asname', row);
    if (nm) nm.oninput = () => { p.name = nm.value; updateConflict(); };
    const play = $('.asplay', row);
    if (play) play.onclick = () => { const a = new Audio('/api/studio/assets/file?id=' + enc(AS.id) + '&path=' + enc(row.dataset.p)); a.play().catch(e => toast('放不了：' + e.message, true)); setTimeout(() => a.pause(), 8000); };
  });
  const updateGo = () => {
    const selected = files.filter(f => usable(f) && AS.pick.get(f.path).on);
    const dup = selected.filter(hasConflict).length;
    $('#asCount').textContent = `${files.length} 个文件，要导入 ${selected.length} 个${dup ? `，其中 ${dup} 个和游戏里的同名` : ''}`;
    $('#asGo').textContent = '导入 ' + selected.length + ' 个';
    $('#asGo').disabled = !selected.length;
    if (folderSelect) $('#asApplyFolder').disabled = !cgRows().length;
  };
  updateGo();
  $('#asClear').onclick = async () => { try { await api('assets/discard', { id: AS.id }); } catch { } AS = null; $('#asBody').innerHTML = ''; };
  $('#asGo').onclick = commitAssets;
}

// jpg / webp：浏览器里画到画布上转成 PNG，再放回暂存区
async function toPng(path) {
  const blob = await (await fetch('/api/studio/assets/file?id=' + enc(AS.id) + '&path=' + enc(path))).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext('2d').drawImage(bmp, 0, 0);
  const png = await new Promise(res => cv.toBlob(res, 'image/png'));
  const rel = path.replace(/\.[^./]+$/, '') + '.png';
  await uploadFile('/api/studio/upload/assets?id=' + AS.id + '&name=' + enc(rel), png);
  return rel;
}

async function commitAssets() {
  const btn = $('#asGo');
  btn.disabled = true; btn.textContent = '正在导入…';
  const usable = f => f.kind !== 'other' && (!f.problem || f.problem === 'needPng');
  const todo = AS.files.filter(f => usable(f) && AS.pick.get(f.path).on);
  try {
    const items = [];
    for (const f of todo) {
      const p = AS.pick.get(f.path);
      let path = f.path;
      if (f.problem === 'needPng') { btn.textContent = '转 PNG：' + f.path; path = await toPng(f.path); }
      items.push({ path, sub: p.sub, name: p.name.trim(), conflict: AS.conflict });
    }
    btn.textContent = '正在导入…';
    const r = await api('assets/commit', { id: AS.id, files: items });
    const by = {};
    for (const d of r.done) by[d.sub] = (by[d.sub] || 0) + 1;
    const links = { characters: '#/sprites/characters', faces: '#/sprites/faces' };
    const cg = r.done.filter(d => d.sub === 'pictures');
    toast(`已导入 ${r.done.length} 个${r.skipped.length ? `，跳过 ${r.skipped.length} 个同名的` : ''}${r.failed.length ? `，${r.failed.length} 个失败` : ''}`, !!r.failed.length);
    if (!r.failed.length) AS = null;
    const html = `<div class="card asdone"><h3>导入好了</h3>
      <p>${Object.entries(by).map(([s, n]) => `${links[s] ? `<a href="${links[s]}">${esc(SUB_LABEL[s] || s)}</a>` : esc(SUB_LABEL[s] || s)} ${n} 个`).join('，') || '没有导入任何文件'}${r.done.some(d => d.renamed) ? `；改了名的：${r.done.filter(d => d.renamed).map(d => esc(d.name)).join('、')}` : ''}${r.done.some(d => d.encrypted) ? '；已按游戏加密' : ''}</p>
      ${r.backupDir ? `<p class="faint">覆盖前的文件备份在 ${esc(r.backupDir)}</p>` : ''}
      ${cg.length ? `<details ${cg.length <= 6 ? 'open' : ''}><summary>查看 CG 保存位置（${cg.length} 张）</summary><ul class="as-cg-paths">${cg.map(d => `<li>${esc(d.name)}</li>`).join('')}</ul></details>` : ''}
      ${r.failed.length ? `<div class="err">${r.failed.map(x => esc(x.path + '：' + x.error)).join('\n')}</div>` : ''}</div>`;
    if (AS) { await loadStaging(AS.id); $('#asResult').innerHTML = html; }
    else { $('#asBody').innerHTML = html; }
    for (const d of r.done) if (d.sub === 'characters' || d.sub === 'faces') { IMGV[d.sub + '/' + d.name] = Date.now(); charCache.delete(d.name); }
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '导入'; }
}
