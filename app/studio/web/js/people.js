'use strict';
// 人物：行走图帧、动画、人物列表、人物页、新建 / 改人物、选小人 / 选头像
// ---------- 人物 / 小人 ----------
// 行走图一格：普通图 4×2 个人、每人 3 列（姿势）× 4 行（朝向 下左右上）；名字带 $ 的图只有一个人
const isBigSheet = name => /^[!]*\$/.test(name || '');
function frameOf(img, name, index, dir, pattern) {
  const big = isBigSheet(name);
  const pw = img.naturalWidth / (big ? 3 : 12), ph = img.naturalHeight / (big ? 4 : 8);
  const ci = big ? 0 : index || 0;
  const row = Math.floor(ci / 4) * 4 + Math.max(0, (dir || 2) / 2 - 1);
  const col = (ci % 4) * 3 + (pattern == null ? 1 : pattern);
  return { sx: col * pw, sy: row * ph, pw, ph };
}
// 会走路的小预览：所有画布共用一个计时器；画布从页面上拿掉就自动停
const ANIM = new Set();
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let animStep = 0;
setInterval(() => {
  animStep++;
  for (const a of ANIM) {
    if (!a.cv.isConnected) { ANIM.delete(a); continue; }
    a.draw([0, 1, 2, 1][animStep % 4]);
  }
}, 190);
async function spriteCanvas(name, index, dir, size, animate, sub) {
  const cv = document.createElement('canvas');
  cv.className = 'sprcv';
  const im = await (sub === 'faces' ? loadFace(name) : loadSheet(name));
  if (!im) { cv.width = cv.height = 8; return cv; }
  if (sub === 'faces') {
    const fw = im.naturalWidth / 4, fh = im.naturalHeight / 2;
    cv.width = fw; cv.height = fh;
    cv.getContext('2d').drawImage(im, (index % 4) * fw, Math.floor(index / 4) * fh, fw, fh, 0, 0, fw, fh);
    cv.style.width = size + 'px'; cv.style.height = size * fh / fw + 'px';
    return cv;
  }
  const f0 = frameOf(im, name, index, dir, 1);
  cv.width = f0.pw; cv.height = f0.ph;
  const k = size / Math.max(f0.pw, f0.ph);
  cv.style.width = f0.pw * k + 'px'; cv.style.height = f0.ph * k + 'px';
  const ctx = cv.getContext('2d');
  const draw = pat => { const f = frameOf(im, name, index, dir, pat); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(im, f.sx, f.sy, f.pw, f.ph, 0, 0, f.pw, f.ph); };
  draw(1);
  if (animate && !reduceMotion) ANIM.add({ cv, draw });
  return cv;
}
const faceCache = new Map();
function loadFace(name) {
  if (!faceCache.has(name)) faceCache.set(name, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = img('faces', name); }));
  return faceCache.get(name);
}
// 上传 / 改过之后要重新拉图
function forgetImage(sub, name) { IMGV[sub + '/' + name] = Date.now(); (sub === 'faces' ? faceCache : charCache).delete(name); }
async function mountSprite(el, name, index, dir, size, animate, sub) {
  if (!el || !name) return;
  el.innerHTML = '';
  el.appendChild(await spriteCanvas(name, index, dir, size, animate, sub));
}

// ---------- 人物列表 ----------
async function viewPeople(main) {
  main.innerHTML = '<div class="loading">正在统计人物…</div>';
  const r = await api('people');
  const actors = r.people.filter(p => !p.speakerOnly), speakers = r.people.filter(p => p.speakerOnly);
  const card = p => `<a class="pcard card" href="#/people/${enc(p.key)}">
      <span class="pspr" data-spr="${esc(p.sprite ? p.sprite.name : '')}" data-idx="${p.sprite ? p.sprite.index : 0}">${p.sprite ? '' : '<span class="pnone">无</span>'}</span>
      <span class="pmeta"><b>${esc(p.name)}</b>${p.nickname ? `<small>${esc(p.nickname)}</small>` : ''}
        <small class="faint">${p.actorId ? '角色 ' + p.actorId + ' · ' : ''}${p.lines} 句台词 · ${p.pages} 页</small></span></a>`;
  main.innerHTML = `<div class="page wide">
    <div class="titlebar"><h1>人物</h1><span class="dim">数据库角色 ${actors.length} 个，另有 ${speakers.length} 个只在台词里出现的说话人</span><span class="sp"></span>
      <a class="tag" href="#/sprites">小人库</a><button class="primary small" id="newActor">新增人物</button></div>
    <div class="pgrid">${actors.map(card).join('') || '<div class="empty">还没有角色</div>'}</div>
    ${speakers.length ? `<div class="section"><h2>只在台词里出现的说话人</h2><span class="dim">对话框名字直接写的，不是数据库角色。想给 TA 配小人和头像，可以「新增人物」用同一个名字</span></div>
      <div class="pgrid">${speakers.map(card).join('')}</div>` : ''}
  </div>`;
  $$('.pspr[data-spr]', main).forEach(el => { if (el.dataset.spr) mountSprite(el, el.dataset.spr, Number(el.dataset.idx), 2, 44, false); });
  $('#newActor').onclick = () => actorDialog(null);
}

// ---------- 一个人物 ----------
async function viewPerson(main, key) {
  main.innerHTML = '<div class="loading">正在读取人物…</div>';
  const p = await api('person?key=' + enc(key));
  const a = p.actor;
  const relRow = x => `<div class="relrow">
      <span class="ref" data-kind="${x.kind}" data-id="${x.id}" tabindex="0">${x.kind === 'var' ? '变量' : '开关'} ${x.id}「${esc(x.name || '未命名')}」</span>
      <span class="faint relwhy">${x.why.map(esc).join(' · ')}${x.check ? ` · 判断 ${x.check}` : ''}${x.set ? ` · 设置 ${x.set}` : ''}</span>
      ${p.actorId ? `<button class="quiet small pin ${x.linked ? 'on' : ''}" data-pin="${x.kind}:${x.id}" title="${x.linked ? '取消手动关联' : '手动关联到这个人物'}">${x.linked ? '已关联' : '关联'}</button>` : ''}
    </div>`;
  main.innerHTML = `<div class="page">
    <div class="crumbs"><a href="#/people">人物</a><span>›</span><span>${esc(p.name)}</span></div>
    <div class="phead">
      <div class="pbig">${['2', '4', '6', '8'].map(d => `<span class="pdir" data-dir="${d}"></span>`).join('')}</div>
      <div class="pface" id="pface"></div>
      <div style="min-width:0;flex:1">
        <div class="titlebar" style="margin:0"><h1>${p.actorId ? `<span class="id num">角色 ${p.actorId}</span>` : ''}${esc(p.name)}</h1>${p.hint ? `<span class="hint">${esc(p.hint)}</span>` : ''}</div>
        <div class="meta" style="margin:4px 0 0">${a && a.nickname ? `<span>称号：${esc(a.nickname)}</span>` : ''}<span>${p.lines} 句台词</span><span>出现在 ${p.pages.length} 页</span></div>
        ${a && a.profile ? `<p class="dim" style="margin-top:6px;white-space:pre-wrap">${esc(a.profile)}</p>` : ''}
        <div class="edbar">${p.actorId ? '<button class="small" id="editActor">改名字和资料</button><button class="small" id="pickSpr">换小人</button><button class="small" id="pickFace">换头像</button>' : `<span class="dim">TA 不是数据库角色（对话框里直接写的名字）。</span><button class="small primary" id="makeActor">建成数据库角色</button>`}</div>
      </div>
    </div>
    <div class="section"><h2>相关数值</h2><span class="dim">TA 说话、出场的那些事件页里用到的开关和变量，越是只和 TA 有关的排得越前</span></div>
    <div class="relcols">
      <div class="card relcard"><h3>变量</h3>${capped(p.related.vars.map(relRow), 8) || '<div class="faint" style="padding:8px 12px">没有</div>'}</div>
      <div class="card relcard"><h3>开关</h3>${capped(p.related.switches.map(relRow), 8) || '<div class="faint" style="padding:8px 12px">没有</div>'}</div>
    </div>
    <div class="relacts"><button class="small" id="showNv">＋ 给${esc(p.name)}新建数值</button>${p.actorId ? '<button class="small quiet" id="showLk">关联已有的</button>' : ''}</div>
    <div class="card newvar" id="nvCard" hidden>
      <span>给 ${esc(p.name)} 新建</span>
      <select id="nvKind"><option value="var">变量</option><option value="switch">开关</option></select>
      <input id="nvLabel" placeholder="例：好感度、第二章进度" maxlength="30">
      <button class="primary small" id="nvGo">新建数值</button>
      <span class="faint" style="font-size:12px">名字会是「${esc(p.name)}·…」${p.actorId ? '，并自动关联到 TA' : ''}</span>
    </div>
    ${p.actorId ? `<div class="card newvar" id="lkCard" hidden><span>关联已有的</span><select id="lkKind"><option value="var">变量</option><option value="switch">开关</option></select><select id="lkId" style="flex:1;min-width:0"></select><button class="small" id="lkGo">关联</button><span class="faint" style="font-size:12px">关联记在角色备注里（&lt;RpgStudioLinks:…&gt;），游戏不受影响</span></div>` : ''}
    <div class="section"><h2>出现的地方</h2></div>
    <div class="card rows">${capped(p.pages.slice(0, 300).map(e => `<a class="rowlink" href="${hrefOf(e.at)}"><span>${esc(e.where)}</span><span class="r">${e.says ? e.says + ' 句' : ''}${e.appears ? (e.says ? ' · ' : '') + '出场' : ''}</span></a>`), 10) || '<div class="empty" style="border:0">没有找到</div>'}</div>
  </div>`;
  $('#showNv').onclick = () => { $('#nvCard').hidden = false; $('#showNv').hidden = true; $('#nvLabel').focus(); };
  if ($('#showLk')) $('#showLk').onclick = () => { $('#lkCard').hidden = false; $('#showLk').hidden = true; };
  if (a && a.characterName) $$('.pdir', main).forEach(el => mountSprite(el, a.characterName, a.characterIndex, Number(el.dataset.dir), 64, true));
  else $('.pbig', main).innerHTML = '<span class="pnone" style="width:64px;height:64px">无小人</span>';
  if (a && a.faceName) mountSprite($('#pface'), a.faceName, a.faceIndex, 2, 96, false, 'faces');
  else $('#pface').remove();
  $$('[data-pin]', main).forEach(b => b.onclick = async () => {
    const [kind, id] = b.dataset.pin.split(':');
    try { await api('person/link', { actor: p.actorId, kind, id: Number(id), on: !b.classList.contains('on') }); toast(b.classList.contains('on') ? '已取消关联' : '已关联'); render(); } catch (e) { toast(e.message, true); }
  });
  $('#nvGo').onclick = async () => {
    try { const r = await api('person/newvar', { key: p.key, kind: $('#nvKind').value, label: $('#nvLabel').value }); toast(`已新建${r.kind === 'var' ? '变量' : '开关'} ${r.id}「${r.name}」`); S.lookups = {}; S.project = await api('project'); render(); }
    catch (e) { toast(e.message, true); }
  };
  if ($('#lkGo')) {
    const fill = async () => { const kind = $('#lkKind').value; const rows = await lookup(kind); $('#lkId').innerHTML = rows.filter(r => r.name).map(r => `<option value="${r.id}">${r.id} ${esc(r.name)}</option>`).join(''); };
    $('#lkKind').onchange = fill; fill();
    $('#lkGo').onclick = async () => { try { await api('person/link', { actor: p.actorId, kind: $('#lkKind').value, id: Number($('#lkId').value), on: true }); toast('已关联'); render(); } catch (e) { toast(e.message, true); } };
  }
  if ($('#editActor')) $('#editActor').onclick = () => actorDialog(p);
  if ($('#pickSpr')) $('#pickSpr').onclick = async () => {
    const r = await spritePicker({ name: a.characterName, index: a.characterIndex, dir: 2, pattern: 1 }, { title: `${p.name} 的小人`, noDir: true });
    if (!r) return;
    try { await api('actor/update', { id: p.actorId, characterName: r.name, characterIndex: r.index }); toast('已换小人'); render(); } catch (e) { toast(e.message, true); }
  };
  if ($('#pickFace')) $('#pickFace').onclick = async () => {
    const r = await facePicker({ name: a.faceName, index: a.faceIndex }, `${p.name} 的头像`);
    if (!r) return;
    try { await api('actor/update', { id: p.actorId, faceName: r.name, faceIndex: r.index }); toast('已换头像'); render(); } catch (e) { toast(e.message, true); }
  };
  if ($('#makeActor')) $('#makeActor').onclick = () => actorDialog(null, p.name);
}

async function actorDialog(p, presetName) {
  const a = p && p.actor;
  const r = await openDialog(`<header><h3>${p ? `改 ${esc(p.name)} 的资料` : '新增人物'}</h3></header>
    <div class="dbody"><div class="fgrid">
      <label for="ac_n">名字</label><input id="ac_n" maxlength="40" value="${esc(a ? a.name : presetName || '')}" placeholder="对话框里 \\N[编号] 显示的就是它">
      <label for="ac_k">称号</label><input id="ac_k" maxlength="40" value="${esc(a ? a.nickname : '')}">
      <label for="ac_p">简介</label><textarea id="ac_p" rows="3" maxlength="400">${esc(a ? a.profile : '')}</textarea>
    </div>
    ${p ? '' : '<div class="fnote">建好以后可以在人物页给 TA 选小人和头像，也可以到「小人库」上传新的。</div>'}
    <div id="acErr"></div></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>${p ? '保存资料' : '新增人物'}</button></footer>`,
    (d, done) => {
      $('#ac_n', d).focus();
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        const body = { name: $('#ac_n', d).value, nickname: $('#ac_k', d).value, profile: $('#ac_p', d).value };
        try { const x = p ? await api('actor/update', { id: p.actorId, ...body }) : await api('actor/create', body); done(x); }
        catch (e) { $('#acErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (!r) return;
  S.lookups = {};
  if (p) { toast('已保存资料'); render(); }
  else { toast('已新增人物：角色 ' + r.id); location.hash = '#/people/a' + r.id; }
}

// ---------- 选小人 / 选头像 ----------
// 返回 { name, index, dir, pattern }；name 为空 = 不要图像
async function spritePicker(cur, opt = {}) {
  const r0 = await api('sheets?sub=characters');
  let sel = { name: cur.name || '', index: cur.index || 0, dir: cur.dir || 2, pattern: cur.pattern == null ? 1 : cur.pattern };
  return openDialog(`<header><h3>${esc(opt.title || '选小人')}</h3><button class="quiet small" data-x>取消</button></header>
    <div class="dbody" style="max-height:74vh">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="spq" placeholder="筛选图名（共 ${r0.sheets.length} 张）" style="flex:1;min-width:140px">
        ${opt.allowNone !== false ? '<button class="small" data-none>不要图像</button>' : ''}</div>
      <div id="spl" class="sheetgrid"></div>
      <div class="spsel" id="spsel"></div>
    </div>
    <footer><span class="dim" id="spinfo" style="font-size:12.5px"></span><span class="sp"></span><button class="primary" data-ok>用这个</button></footer>`,
    (d, done) => {
      const info = () => { $('#spinfo', d).textContent = sel.name ? `${sel.name}${isBigSheet(sel.name) ? '' : ' 第 ' + (sel.index + 1) + ' 个'}` : '不要图像'; };
      const drawSel = async () => {
        const box = $('#spsel', d);
        info();
        if (!sel.name || opt.noDir) { box.innerHTML = ''; return; }
        const im = await loadSheet(sel.name);
        if (!im) { box.innerHTML = ''; return; }
        box.innerHTML = '<span class="dim">朝向和姿势：</span>';
        for (const dir of [2, 4, 6, 8]) for (const pt of [0, 1, 2]) {
          const b = document.createElement('button');
          b.className = 'spdir' + (sel.dir === dir && sel.pattern === pt ? ' on' : '');
          b.title = `${({ 2: '朝下', 4: '朝左', 6: '朝右', 8: '朝上' })[dir]} · 姿势 ${pt}`;
          const f = frameOf(im, sel.name, sel.index, dir, pt);
          const cv = document.createElement('canvas'); cv.width = f.pw; cv.height = f.ph; cv.className = 'sprcv';
          cv.style.height = '36px'; cv.style.width = 36 * f.pw / f.ph + 'px';
          cv.getContext('2d').drawImage(im, f.sx, f.sy, f.pw, f.ph, 0, 0, f.pw, f.ph);
          b.appendChild(cv);
          b.onclick = () => { sel.dir = dir; sel.pattern = pt; drawSel(); };
          box.appendChild(b);
        }
      };
      const draw = q => {
        const list = r0.sheets.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 80);
        $('#spl', d).innerHTML = list.map(s => `<div class="sheet"><div class="sheetname">${esc(s.name)}</div><div class="sheetchars">${(s.big ? [0] : [0, 1, 2, 3, 4, 5, 6, 7]).map(i => `<button class="schar ${sel.name === s.name && sel.index === i ? 'on' : ''}" data-n="${esc(s.name)}" data-i="${i}" title="${s.uses[i] ? '用在 ' + s.uses[i] + ' 处' : '没被用到'}"></button>`).join('')}</div></div>`).join('') || '<div class="dim">没有符合的</div>';
        $$('.schar', d).forEach(b => {
          mountSprite(b, b.dataset.n, Number(b.dataset.i), 2, 40, false);
          b.onclick = () => { sel.name = b.dataset.n; sel.index = Number(b.dataset.i); $$('.schar.on', d).forEach(x => x.classList.remove('on')); b.classList.add('on'); drawSel(); };
        });
      };
      $('#spq', d).oninput = e => draw(e.target.value.trim().toLowerCase());
      if ($('[data-none]', d)) $('[data-none]', d).onclick = () => done({ name: '', index: 0, dir: 2, pattern: 1 });
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = () => done({ ...sel });
      draw(''); drawSel();
      const on = $('.schar.on', d); if (on) on.scrollIntoView({ block: 'center' });
    }).then(v => v || null);
}
async function facePicker(cur, title) {
  const r0 = await api('sheets?sub=faces');
  let sel = { name: cur.name || '', index: cur.index || 0 };
  return openDialog(`<header><h3>${esc(title || '选头像')}</h3><button class="quiet small" data-x>取消</button></header>
    <div class="dbody" style="max-height:74vh"><div style="display:flex;gap:8px"><input id="fq" placeholder="筛选（共 ${r0.sheets.length} 张）" style="flex:1"><button class="small" data-none>不要头像</button></div><div id="fl" class="sheetgrid"></div></div>
    <footer><span class="sp"></span><button class="primary" data-ok>用这个</button></footer>`,
    (d, done) => {
      const draw = q => {
        $('#fl', d).innerHTML = r0.sheets.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 60).map(s => `<div class="sheet"><div class="sheetname">${esc(s.name)}</div><div class="sheetchars faces">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<button class="schar ${sel.name === s.name && sel.index === i ? 'on' : ''}" data-n="${esc(s.name)}" data-i="${i}"></button>`).join('')}</div></div>`).join('') || '<div class="dim">没有头像图</div>';
        $$('.schar', d).forEach(b => { mountSprite(b, b.dataset.n, Number(b.dataset.i), 2, 56, false, 'faces'); b.onclick = () => { sel = { name: b.dataset.n, index: Number(b.dataset.i) }; $$('.schar.on', d).forEach(x => x.classList.remove('on')); b.classList.add('on'); }; });
      };
      $('#fq', d).oninput = e => draw(e.target.value.trim().toLowerCase());
      $('[data-none]', d).onclick = () => done({ name: '', index: 0 });
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = () => done(sel);
      draw('');
    }).then(v => v || null);
}
