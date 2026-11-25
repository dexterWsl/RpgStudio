'use strict';
// 小人库：行走图 / 头像库、上传、替换一格、调整（偏移 / 缩放 / 翻转）
// ---------- 小人库 ----------
async function viewSprites(main, sub) {
  if (sub === 'doll') { closeSide(); return viewPaperDoll(main); }
  sub = sub === 'faces' ? 'faces' : 'characters';
  main.innerHTML = '<div class="loading">正在读取小人…</div>';
  const r = await api('sheets?sub=' + sub);
  let q = '', filter = 'all';
  main.innerHTML = `<div class="page wide">
    <div class="crumbs"><a href="#/people">人物</a><span>›</span><span>小人库</span></div>
    <div class="titlebar"><h1>小人库</h1>
      <div class="seg"><button data-sub="characters" class="${sub === 'characters' ? 'on' : ''}">行走图</button><button data-sub="faces" class="${sub === 'faces' ? 'on' : ''}">头像</button></div>
      <span class="dim" id="spriteSheetCount">${r.sheets.length} 张图</span><span class="sp"></span>
      ${r.canWrite && sub === 'characters' ? '<a class="tag" href="#/sprites/doll">纸娃娃制作</a>' : ''}
      ${r.canWrite && sub === 'characters' ? '<button class="small" id="upFour">从四视图做</button>' : ''}
      ${r.canWrite ? `<button class="primary small" id="upNew">上传${sub === 'faces' ? '头像' : '小人'}</button>` : ''}</div>
    <div class="filters"><input type="search" id="sq" placeholder="按图名筛选"><div class="seg" id="sf"><button data-f="all" class="on">全部</button><button data-f="used">用到的</button><button data-f="unused">没用到的</button></div>
      <span class="dim" style="font-size:12.5px">点一个${sub === 'faces' ? '头像' : '小人'}看它用在哪里、替换或调整</span></div>
    <div id="sgrid" class="sheetgrid big"></div>
  </div>`;
  const grid = $('#sgrid', main);
  const count = $('#spriteSheetCount', main);
  const onDeleted = (name, remaining) => {
    if (!remaining) r.sheets = r.sheets.filter(s => s.name !== name);
    if (!grid.isConnected) return;
    count.textContent = `${r.sheets.length} 张图`;
    draw();
  };
  const draw = () => {
    const list = r.sheets.filter(s => (!q || s.name.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'used' ? Object.keys(s.uses).length : !Object.keys(s.uses).length)));
    grid.innerHTML = list.map(s => `<div class="sheet card"><div class="sheetname">${esc(s.name)}${s.big ? ' <span class="faint">单人</span>' : ''}${s.object ? ' <span class="faint">物件</span>' : ''}</div>
      <div class="sheetchars ${sub === 'faces' ? 'faces' : ''}">${(s.big ? [0] : [0, 1, 2, 3, 4, 5, 6, 7]).map(i => `<button class="schar" data-n="${esc(s.name)}" data-i="${i}" title="${s.uses[i] ? '用在 ' + s.uses[i] + ' 处' : '没被用到'}">${s.uses[i] ? `<em>${s.uses[i]}</em>` : ''}</button>`).join('')}</div></div>`).join('') || '<div class="empty">没有符合的图</div>';
    $$('.schar', grid).forEach(b => {
      const em = $('em', b);
      mountSprite(b, b.dataset.n, Number(b.dataset.i), 2, sub === 'faces' ? 64 : 44, false, sub).then(() => { if (em) b.appendChild(em); });
      b.onclick = () => { $$('.schar.on', grid).forEach(x => x.classList.remove('on')); b.classList.add('on'); showSheetChar(sub, b.dataset.n, Number(b.dataset.i), r.canWrite, onDeleted); };
    });
  };
  $$('[data-sub]', main).forEach(b => b.onclick = () => go('#/sprites/' + b.dataset.sub));
  $('#sq').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#sf button').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#sf button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  if ($('#upNew')) $('#upNew').onclick = () => uploadDialog(sub, null);
  if ($('#upFour')) $('#upFour').onclick = fourViewDialog;
  draw();
}
// 右栏：一个小人用在哪里 + 替换 / 调整
async function showSheetChar(sub, name, index, canWrite, onDeleted) {
  const side = $('#side');
  $('#shell').classList.remove('noside');
  side.innerHTML = '<div class="side-in loading">正在查找…</div>';
  const selection = S.side = { kind: sub, id: name + '#' + index };
  const r = await api(`sheet-usage?sub=${sub}&name=${enc(name)}&index=${index}`).catch(e => {
    if (S.side === selection) { closeSide(); toast(e.message, true); }
  });
  if (!r || S.side !== selection) return;
  const big = sub === 'characters' && isBigSheet(name);
  const otherRefs = (r.sheetRefs || []).filter(x => Number(x.id.slice(x.id.lastIndexOf('#') + 1)) !== index);
  const refLink = x => `<a class="refitem" href="${x.at.type === 'actor' ? '#/people/a' + x.at.actor : hrefOf(x.at)}"><div class="w">${esc(x.where)}</div><div class="t">${esc(x.text)}</div></a>`;
  side.innerHTML = `<div class="side-in">
    <button class="quiet small sideclose" id="sideX">关闭</button>
    <h2>${esc(name)}${big ? '' : ` · 第 ${index + 1} 个`}</h2>
    <div class="pbig side">${sub === 'faces' ? '<span class="pdir" data-dir="2"></span>' : ['2', '4', '6', '8'].map(d => `<span class="pdir" data-dir="${d}"></span>`).join('')}</div>
    ${r.diagonal ? `<div class="pbig side">${[[2, '左下'], [4, '右下'], [6, '左上'], [8, '右上']].map(([dir, label]) => `<span class="pdir" data-diagonal="${dir}" title="${label}"></span>`).join('')}</div>` : ''}
    ${canWrite ? `<div class="edbar"><button class="small" id="scReplace">替换成上传的图</button>${sub === 'characters' ? '<button class="small" id="scAdjust">调整</button><button class="small" id="scDiagonal">斜向站姿</button>' : ''}
      ${r.canDelete ? `<button class="small danger" id="scDelete" ${r.sheetRefs.length ? 'disabled' : ''}>删除整张图</button>` : ''}</div>` : ''}
    ${canWrite && r.canDelete && r.sheetRefs.length ? '<div class="fnote">这张图仍在使用，请先更换下方引用的图像。</div>' : ''}
    ${canWrite && r.canDelete === false ? '<div class="fnote">这张图位于当前工程的可删除目录之外。</div>' : ''}
    <div class="dim" style="margin-top:10px">${r.refs.length ? `用在 ${r.refs.length} 处` : '没有地方用到它'}</div>
    ${r.refs.map(refLink).join('')}
    ${otherRefs.length ? `<div class="dim" style="margin-top:10px">同一张图的其他位置用在 ${otherRefs.length} 处</div>${otherRefs.map(refLink).join('')}` : ''}
  </div>`;
  $$('[data-dir]', side).forEach(el => mountSprite(el, name, index, Number(el.dataset.dir), sub === 'faces' ? 120 : 56, sub !== 'faces', sub));
  $$('[data-diagonal]', side).forEach(el => mountSprite(el, r.diagonal, index, Number(el.dataset.diagonal), 56, false, sub));
  $('#sideX').onclick = closeSide;
  if ($('#scReplace')) $('#scReplace').onclick = () => uploadDialog(sub, { name, index, big });
  if ($('#scAdjust')) $('#scAdjust').onclick = () => adjustDialog(name, index);
  if ($('#scDiagonal')) $('#scDiagonal').onclick = async () => {
    try { if (await diagonalSheetDialog(name, r.diagonal) && S.side === selection) await showSheetChar(sub, name, index, canWrite, onDeleted); }
    catch (e) { toast(e.message, true); }
  };
  const remove = $('#scDelete', side);
  if (remove) remove.onclick = async () => {
    remove.disabled = true;
    try {
      const confirmed = await confirmDialog('删除整张图', `删除「${name}」？${big ? '' : '同一张图里的所有位置都会删除。'}删除前会自动备份。`, '删除');
      if (!confirmed) return;
      const result = await api('assets/delete', { kind: 'img', sub, name });
      forgetImage(sub, name);
      if (S.side === selection) closeSide();
      onDeleted(name, result.remaining);
      toast(result.remaining ? '已删除工作区图片，现显示原游戏中同名的图' : '已删除整张图，原文件已备份');
    } catch (e) { toast(e.message, true); }
    finally { remove.disabled = false; }
  };
}

// ---------- 上传 ----------
const loadFileImage = file => new Promise((res, rej) => {
  if (!/^image\/png$/.test(file.type) && !/\.png$/i.test(file.name)) { rej(new Error('只支持 PNG 图片（透明背景）')); return; }
  const fr = new FileReader();
  fr.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('图片读不出来')); im.src = fr.result; };
  fr.onerror = () => rej(new Error('文件读不出来'));
  fr.readAsDataURL(file);
});
const canvasPng = cv => cv.toDataURL('image/png');
function showSpriteGuide(box, guide, previewSample) {
  const { recommended: r, sizes, tileSize } = guide;
  const sample = r.sample;
  box.innerHTML = `<div class="sprguide">
    ${sample ? '<div class="sprguide-sprite" aria-hidden="true"></div>' : ''}
    <div><strong>推荐单帧 ${r.width} × ${r.height} px</strong>
      <div class="dim">${r.uses ? `工程里引用最多，共 ${r.uses} 处` : r.sheets ? `工程里最常见，共 ${r.sheets} 张` : '按本工程地图格计算'} · 地图每格 ${tileSize} px</div>
      <div class="faint">单人整图 ${r.width * 3} × ${r.height * 4} px · 8 人整图 ${r.width * 12} × ${r.height * 8} px</div>
      ${sizes.length > 1 ? `<div class="faint">其他常用单帧 ${sizes.slice(1).map(s => s.width + ' × ' + s.height).join('、')} px</div>` : ''}
    </div>
    ${sample ? `<div class="sprguide-file"><span class="dim">${esc(sample.name)}${sample.big ? '' : ' · 第 ' + (sample.index + 1) + ' 位'}</span>
      ${previewSample ? '<button type="button" class="small" data-guide-sample aria-haspopup="dialog">查看游戏样图</button>'
        : `<a class="tag" href="${esc(img('characters', sample.name))}" download="${esc(sample.name.split('/').at(-1))}.png">下载游戏示例</a>`}</div>` : ''}
  </div>`;
  if (sample) mountSprite($('.sprguide-sprite', box), sample.name, sample.index, 2, 50, true, 'characters');
  if (sample && previewSample) $('[data-guide-sample]', box).onclick = () => previewSample(sample);
}
// 猜上传的是单人图（3×4 帧）还是 8 人图（12×8 帧）：帧越接近方形越像
function guessLayout(im) {
  const w = im.naturalWidth, h = im.naturalHeight, opts = [];
  if (w % 3 === 0 && h % 4 === 0) opts.push({ kind: 'single', fw: w / 3, fh: h / 4 });
  if (w % 12 === 0 && h % 8 === 0) opts.push({ kind: 'sheet', fw: w / 12, fh: h / 8 });
  opts.sort((a, b) => Math.abs(Math.log(a.fw / a.fh)) - Math.abs(Math.log(b.fw / b.fh)));
  return opts;
}
async function uploadDialog(sub, target) {
  // target：{ name, index, big } = 替换已有的这一个；null = 新文件
  let im = null, layout = null;
  const isFace = sub === 'faces';
  const r = await openDialog(`<header><h3>${target ? `替换 ${esc(target.name)}${target.big ? '' : ' 的第 ' + (target.index + 1) + ' 个'}` : isFace ? '上传头像' : '上传小人'}</h3></header>
    <div class="dbody">
      ${isFace ? '' : '<div id="upGuide">正在读取本工程的推荐尺寸…</div>'}
      <label class="drop" id="drop"><input type="file" accept="image/png" id="upf" hidden><span>把 PNG 拖到这里，或者点这里选文件</span></label>
      <div class="fnote">${isFace ? '头像图：4 列 × 2 行，每格一个头像（RPG Maker 标准是 576×288）；也可以只传一张头像，会放进你选的那一格。' : '行走图：<b>单人图</b> 3 列（姿势）× 4 行（朝向：下、左、右、上），文件名会自动加 $；<b>8 人图</b> 12 列 × 8 行。背景要透明。'}</div>
      <div id="upPrev" class="upprev"></div>
      <div class="fgrid" id="upForm" style="display:none">
        ${!isFace ? '<label>看起来是</label><select id="upLayout"></select>' : ''}
        ${target ? '' : `<label for="upName">文件名</label><input id="upName" maxlength="60" placeholder="例：Saya_school">`}
        ${!target && !isFace ? '<label>物件</label><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="upObj"> 门、宝箱这类物件（文件名加 !，游戏里不往上抬 6 像素）</label>' : ''}
      </div>
      <div id="upErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok disabled>${target ? '替换并保存' : '上传'}</button></footer>`,
    (d, done) => {
      const guide = $('#upGuide', d);
      if (guide) api('sprite-guide').then(info => { if (guide.isConnected) showSpriteGuide(guide, info); })
        .catch(() => { if (guide.isConnected) guide.textContent = '暂时无法读取本工程的推荐尺寸'; });
      const fail = m => { $('#upErr', d).innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
      const preview = () => {
        const box = $('#upPrev', d);
        box.innerHTML = '';
        if (!im) return;
        const big = document.createElement('img'); big.src = im.src; big.className = 'upimg'; box.appendChild(big);
        const meta = document.createElement('div'); meta.className = 'dim'; meta.style.fontSize = '12.5px';
        meta.textContent = `${im.naturalWidth} × ${im.naturalHeight}` + (layout ? `，每帧 ${layout.fw} × ${layout.fh}` : '');
        box.appendChild(meta);
      };
      const pick = async file => {
        fail('');
        try { im = await loadFileImage(file); } catch (e) { fail(e.message); return; }
        if (!isFace) {
          const opts = guessLayout(im);
          if (!opts.length) { fail(`尺寸 ${im.naturalWidth}×${im.naturalHeight} 切不成行走图：单人图要能被 3（宽）和 4（高）整除，8 人图要能被 12 和 8 整除`); im = null; preview(); return; }
          $('#upLayout', d).innerHTML = opts.map((o, i) => `<option value="${i}">${o.kind === 'single' ? '单人图' : '8 人图'}（每帧 ${o.fw}×${o.fh}）</option>`).join('');
          layout = opts[0];
          $('#upLayout', d).onchange = e => { layout = opts[Number(e.target.value)]; preview(); };
        }
        if ($('#upName', d) && !$('#upName', d).value) $('#upName', d).value = file.name.replace(/\.png$/i, '').replace(/^[!$]+/, '').replace(/[^\w一-鿿 .()\-]/g, '_').slice(0, 50);
        $('#upForm', d).style.display = '';
        $('[data-ok]', d).disabled = false;
        preview();
      };
      $('#upf', d).onchange = e => e.target.files[0] && pick(e.target.files[0]);
      const drop = $('#drop', d);
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); };
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        fail('');
        try {
          let name, data, overwrite = false;
          if (target) {
            name = target.name; overwrite = true;
            data = await composeReplace(sub, target, im, layout);
          } else {
            const base = $('#upName', d).value.trim();
            if (!base) throw new Error('起个文件名');
            const obj = $('#upObj', d) && $('#upObj', d).checked;
            name = (obj ? '!' : '') + (!isFace && layout.kind === 'single' ? '$' : '') + base;
            const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0);
            data = canvasPng(cv);
          }
          const x = await api('image/save', { sub, name, data, overwrite });
          done(x);
        } catch (e) { fail(e.message); }
      };
    });
  if (!r) return;
  forgetImage(sub, r.name);
  toast((target ? '已替换：' : '已上传：') + r.name + (r.encrypted ? '（已按游戏密钥加密）' : ''));
  if (route().name === 'sprites') render();
}
// 替换：把上传的图放进原图的那一格（8 人图只换那一个人；单人图 / 头像整张换）
async function composeReplace(sub, target, im, layout) {
  const old = await (sub === 'faces' ? loadFace(target.name) : loadSheet(target.name));
  if (!old) throw new Error('原图读不出来');
  const cv = document.createElement('canvas'); cv.width = old.naturalWidth; cv.height = old.naturalHeight;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  c.drawImage(old, 0, 0);
  if (sub === 'faces') {
    const fw = old.naturalWidth / 4, fh = old.naturalHeight / 2;
    const isSheet = im.naturalWidth >= fw * 4 - 1 && Math.abs(im.naturalWidth / im.naturalHeight - 2) < 0.05;
    if (isSheet) { c.clearRect(0, 0, cv.width, cv.height); c.drawImage(im, 0, 0, cv.width, cv.height); }
    else { const x = (target.index % 4) * fw, y = Math.floor(target.index / 4) * fh; c.clearRect(x, y, fw, fh); c.drawImage(im, x, y, fw, fh); }
    return canvasPng(cv);
  }
  if (target.big) {
    if (layout.kind !== 'single') throw new Error('原图是单人图，请上传单人图（3 列 × 4 行）');
    c.clearRect(0, 0, cv.width, cv.height); c.drawImage(im, 0, 0, cv.width, cv.height);
    return canvasPng(cv);
  }
  const pw = old.naturalWidth / 12, ph = old.naturalHeight / 8;
  const bx = (target.index % 4) * 3 * pw, by = Math.floor(target.index / 4) * 4 * ph;
  if (layout.kind === 'sheet') {
    // 传的是 8 人图：取它同一格的那个人
    const sw = im.naturalWidth / 12, sh = im.naturalHeight / 8;
    c.clearRect(bx, by, pw * 3, ph * 4);
    c.drawImage(im, (target.index % 4) * 3 * sw, Math.floor(target.index / 4) * 4 * sh, sw * 3, sh * 4, bx, by, pw * 3, ph * 4);
  } else { c.clearRect(bx, by, pw * 3, ph * 4); c.drawImage(im, bx, by, pw * 3, ph * 4); }
  return canvasPng(cv);
}

// ---------- 调整一个小人：偏移、缩放、左右翻转 ----------
async function adjustDialog(name, index) {
  const sheet = await loadSheet(name);
  if (!sheet) { toast('原图读不出来', true); return; }
  const big = isBigSheet(name);
  const pw = sheet.naturalWidth / (big ? 3 : 12), ph = sheet.naturalHeight / (big ? 4 : 8);
  const bx = big ? 0 : (index % 4) * 3 * pw, by = big ? 0 : Math.floor(index / 4) * 4 * ph;
  let st = { dx: 0, dy: 0, scale: 100, flip: false };
  // 生成调整后的这一个人（3×4 帧）
  const build = () => {
    const out = document.createElement('canvas'); out.width = pw * 3; out.height = ph * 4;
    const c = out.getContext('2d'); c.imageSmoothingEnabled = false;
    const k = st.scale / 100;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      // 左右翻转：每帧镜像，并且「向左」「向右」两行对调
      const srcRow = st.flip ? [0, 2, 1, 3][row] : row;
      const sx = bx + col * pw, sy = by + srcRow * ph;
      const w = pw * k, h = ph * k;
      const x = col * pw + (pw - w) / 2 + st.dx, y = row * ph + (ph - h) + st.dy;   // 缩放以帧的底边中点为准
      c.save();
      c.beginPath(); c.rect(col * pw, row * ph, pw, ph); c.clip();
      if (st.flip) { c.translate(x + w, y); c.scale(-1, 1); c.drawImage(sheet, sx, sy, pw, ph, 0, 0, w, h); }
      else c.drawImage(sheet, sx, sy, pw, ph, x, y, w, h);
      c.restore();
    }
    return out;
  };
  const r = await openDialog(`<header><h3>调整 ${esc(name)}${big ? '' : ' 的第 ' + (index + 1) + ' 个'}</h3></header>
    <div class="dbody">
      <div class="adjprev" id="adjPrev"></div>
      <div class="fgrid">
        <label for="aj_dy">上下</label><span class="ins" style="display:flex;gap:8px;align-items:center"><input id="aj_dy" type="range" min="-24" max="24" value="0" style="flex:1"><span class="num" id="aj_dyv">0</span></span>
        <label for="aj_dx">左右</label><span class="ins" style="display:flex;gap:8px;align-items:center"><input id="aj_dx" type="range" min="-24" max="24" value="0" style="flex:1"><span class="num" id="aj_dxv">0</span></span>
        <label for="aj_s">大小</label><span class="ins" style="display:flex;gap:8px;align-items:center"><input id="aj_s" type="range" min="50" max="150" value="100" style="flex:1"><span class="num" id="aj_sv">100%</span></span>
        <label>翻转</label><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="aj_f"> 左右翻转（朝左、朝右的两行也会对调）</label>
      </div>
      <div class="fnote">只改这一个人。可以覆盖原图（会先备份），也可以另存成一张新的单人图。</div>
      <div id="ajErr"></div>
    </div>
    <footer><button class="quiet" data-reset>还原</button><span class="sp"></span><button data-x>取消</button><button data-new>另存为新小人</button><button class="primary" data-ok>覆盖原图</button></footer>`,
    (d, done) => {
      const prev = $('#adjPrev', d);
      let frameCv = null, step = 0, timer = 0;
      const repaint = () => {
        frameCv = build();
        prev.innerHTML = '';
        for (const row of [0, 1, 2, 3]) {
          const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; cv.className = 'sprcv';
          cv.style.width = Math.round(pw * 1.6) + 'px'; cv.style.height = Math.round(ph * 1.6) + 'px';
          cv.dataset.row = row; prev.appendChild(cv);
        }
        tick();
      };
      const tick = () => {
        const pat = [0, 1, 2, 1][step % 4];
        $$('canvas', prev).forEach(cv => { const c = cv.getContext('2d'); c.clearRect(0, 0, pw, ph); c.drawImage(frameCv, pat * pw, Number(cv.dataset.row) * ph, pw, ph, 0, 0, pw, ph); });
      };
      if (!reduceMotion) timer = setInterval(() => { step++; if (!d.open) { clearInterval(timer); return; } tick(); }, 190);
      const bind = (id, key, fmt) => { $('#' + id, d).oninput = e => { st[key] = Number(e.target.value); $('#' + id + 'v', d).textContent = fmt(st[key]); repaint(); }; };
      bind('aj_dy', 'dy', v => v); bind('aj_dx', 'dx', v => v); bind('aj_s', 'scale', v => v + '%');
      $('#aj_f', d).onchange = e => { st.flip = e.target.checked; repaint(); };
      $('[data-reset]', d).onclick = () => { st = { dx: 0, dy: 0, scale: 100, flip: false }; ['aj_dy', 'aj_dx'].forEach(i => { $('#' + i, d).value = 0; $('#' + i + 'v', d).textContent = 0; }); $('#aj_s', d).value = 100; $('#aj_sv', d).textContent = '100%'; $('#aj_f', d).checked = false; repaint(); };
      $('[data-x]', d).onclick = () => { clearInterval(timer); done(null); };
      const save = async asNew => {
        try {
          let nm = name, data;
          if (asNew) {
            nm = await new Promise(res => { const v = prompt('新小人的文件名（会自动加 $）', name.replace(/^[!$]+/, '') + (big ? '' : '_' + (index + 1)) + '_adj'); res(v); });
            if (!nm) return;
            nm = (/^!/.test(name) ? '!' : '') + '$' + nm.replace(/^[!$]+/, '');
            data = canvasPng(frameCv);
          } else {
            const cv = document.createElement('canvas'); cv.width = sheet.naturalWidth; cv.height = sheet.naturalHeight;
            const c = cv.getContext('2d'); c.drawImage(sheet, 0, 0); c.clearRect(bx, by, pw * 3, ph * 4); c.drawImage(frameCv, bx, by);
            data = canvasPng(cv);
          }
          const x = await api('image/save', { sub: 'characters', name: nm, data, overwrite: !asNew });
          clearInterval(timer); done(x);
        } catch (e) { $('#ajErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      $('[data-ok]', d).onclick = () => save(false);
      $('[data-new]', d).onclick = () => save(true);
      repaint();
    });
  if (!r) return;
  forgetImage('characters', r.name);
  toast((r.name === name ? '已覆盖原图（原图已备份）：' : '已另存为：') + r.name);
  render();
}

// ---------- 从四视图做小人 ----------
const WALK_VIEWS = [['front', '正面'], ['left', '左侧'], ['right', '右侧'], ['back', '背面']];
const WALK_VIEW_NAMES = {
  front: /正面|前面|朝下|front/i,
  left: /左侧|左面|朝左|left/i,
  right: /右侧|右面|朝右|right/i,
  back: /背面|后面|朝上|back/i,
};

function fitWalkView(im, height, margin) {
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const source = document.createElement('canvas'); source.width = w; source.height = h;
  const sg = source.getContext('2d'); sg.drawImage(im, 0, 0);
  const a = sg.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) throw new Error('图片全透明，请选择有角色的 PNG');
  const sourceWidth = x1 - x0 + 1, sourceHeight = y1 - y0 + 1;
  const width = Math.max(1, Math.round(height * sourceWidth / sourceHeight));
  const cv = document.createElement('canvas'); cv.width = width + margin * 2; cv.height = height;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = height < sourceHeight;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, x0, y0, sourceWidth, sourceHeight, margin, 0, width, height);
  source.width = source.height = 0;
  const pixels = g.getImageData(0, 0, cv.width, height).data;
  return { cv, pixels, ...walkFootprint(pixels, cv.width, height) };
}

function footColumns(pixels, width, start, height) {
  const columns = new Uint32Array(width);
  for (let y = start; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 40) columns[x]++;
    }
  }
  return columns;
}

function walkRuns(width, occupied) {
  const runs = [];
  for (let x = 0; x < width; x++) {
    if (!occupied(x)) continue;
    const left = x;
    while (x + 1 < width && occupied(x + 1)) x++;
    runs.push({ left, right: x, center: (left + x) / 2 });
  }
  return runs;
}

function walkFootprint(pixels, width, height) {
  // 用躯干定位角色，再找靠近躯干的脚底。低垂的武器或衣角可能也接近地面。
  const torsoTop = Math.floor(height * 0.36), torsoBottom = Math.ceil(height * 0.6);
  const torso = footColumns(pixels, width, torsoTop, torsoBottom);
  let middle = torso.reduce((sum, n) => sum + n, 0) / 2;
  const core = middle ? torso.findIndex(n => (middle -= n) <= 0) : Math.floor(width / 2);
  const trunk = walkRuns(width, x => torso[x] >= (torsoBottom - torsoTop) * 0.35).find(run => run.left <= core && run.right >= core);
  const torsoWidth = trunk ? trunk.right - trunk.left + 1 : width;
  const start = Math.floor(height * 0.84);
  const columns = footColumns(pixels, width, start, height);
  const runs = walkRuns(width, x => columns[x] >= Math.max(1, Math.round((height - start) * 0.22)));
  const weight = run => columns.subarray(run.left, run.right + 1).reduce((sum, n) => sum + n, 0);
  const score = run => weight(run) / (1 + Math.abs(run.center - core) / (height * 0.1));
  runs.sort((a, b) => score(b) - score(a));
  const main = runs[0];
  if (!main) return { left: core, right: core, center: core, columns, start, torsoWidth };
  const other = runs.slice(1).find(run => {
    const gap = Math.max(run.left - main.right, main.left - run.right);
    return gap <= height * 0.19 && weight(run) >= weight(main) * 0.36;
  }) || main;
  const left = Math.min(main.left, other.left), right = Math.max(main.right, other.right);
  return { left, right, center: (left + right + 1) / 2, columns, start, torsoWidth };
}

function walkLegSplit(b, side) {
  const { width, height } = b.cv;
  const { left, right, center, start, columns, pixels } = b;
  const span = right - left + 1;
  if (span < Math.max(3, height * 0.035)) return null;
  // 宽裙摆上的暗褶皱不能单独作为两只脚的依据。
  const useShade = !side && span <= b.torsoWidth * 0.83 + 1;
  const shades = useShade ? Array.from({ length: span }, (_, i) => {
    let light = 0, sole = -1;
    for (let y = start; y < height; y++) {
      const p = (y * width + left + i) * 4;
      if (pixels[p + 3] <= 40) continue;
      light += pixels[p] * 0.21 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.07;
      sole = y;
    }
    return { luma: light / Math.max(1, columns[left + i]), sole };
  }) : null;
  const total = columns.subarray(left, right + 1).reduce((sum, n) => sum + n, 0);
  const shoulder = Math.max(1, Math.round(span * 0.17));
  let mass = 0, best = -Infinity, split = null;
  for (let x = left + 1; x <= right; x++) {
    mass += columns[x - 1];
    const balance = Math.abs(2 * mass / total - 1);
    if (balance > 0.48) continue;
    const lo = Math.max(left, x - shoulder - 1), hi = Math.min(right, x + shoulder);
    const filled = Math.min(Math.max(...columns.subarray(lo, x)), Math.max(...columns.subarray(x, hi + 1)));
    const gap = 1 - Math.min(columns[x - 1], columns[x]) / Math.max(1, filled);
    let evidence = gap - 0.28;
    // 侧面只认轮廓缝。正背面鞋子相贴时，两边鞋底错开也能佐证较暗的接缝。
    if (shades) {
      const nearLeft = shades[lo - left], nearRight = shades[hi - left];
      const m = shades[x - left - 1].luma, n = shades[x - left].luma;
      const flank = Math.min(nearLeft.luma, nearRight.luma);
      const seam = (4 * Math.min(m, n) + Math.max(m, n)) / 5;
      const contrast = flank - seam;
      evidence = Math.max(evidence, (contrast - 23) / 80);
      if (nearLeft.sole >= 0 && nearRight.sole >= 0 && Math.abs(nearLeft.sole - nearRight.sole) >= Math.max(2, height * 0.02)) {
        evidence = Math.max(evidence, contrast / Math.max(48, flank) - 0.24);
      }
    }
    if (evidence <= 0) continue;
    const score = evidence - balance * 0.5 - Math.abs(x - center) / span * 0.2;
    if (score > best) { best = score; split = x; }
  }
  return split;
}

function traceWalkFoot(b, left, right, min = 0, max = b.cv.width - 1) {
  const { width, height } = b.cv;
  const limit = Math.floor(height * 0.48);
  const reach = Math.max(1, Math.round(height * 0.025));
  const maxWidth = (right - left + 1) * 1.7 + 2;
  const mergeWidth = (b.right - b.left + 1) * 1.22 + 2;
  const bands = new Array(height);
  let top = height, count = 0, missing = 0;
  for (let y = height - 1; y >= limit; y--) {
    const runs = b.runs[y];
    let best = null, distance = Infinity;
    for (const run of runs) {
      const lo = Math.max(run.left, min), hi = Math.min(run.right, max);
      if (lo > hi || lo > right + reach || hi < left - reach) continue;
      const shift = Math.abs(lo + hi - left - right);
      if (shift < distance) { best = { left: lo, right: hi, width: run.right - run.left + 1 }; distance = shift; }
    }
    if (!best) {
      if (++missing > Math.max(2, Math.ceil(height * (count ? 0.025 : 0.09)))) break;
      continue;
    }
    // 追到与更宽的裙摆或躯干合在一起的地方时停止。
    if (best.right - best.left + 1 > maxWidth || best.width > mergeWidth) break;
    ({ left, right } = best);
    bands[y] = best;
    top = y;
    count++;
    missing = 0;
  }
  return count >= Math.max(3, Math.round(height * 0.075)) ? { top, bands } : null;
}

function walkFeet(b, side) {
  const { width, height } = b.cv;
  b.runs = Array.from({ length: height }, (_, y) => walkRuns(width, x => b.pixels[(y * width + x) * 4 + 3] > 40));
  const split = walkLegSplit(b, side);
  if (split == null) return null;
  const left = traceWalkFoot(b, b.left, split - 1, 0, split - 1);
  const right = traceWalkFoot(b, split, b.right, split);
  if (!left || !right) return null;
  if (!side) {
    // 错开的鞋底可能跨过竖直鞋缝。把最底部贴着整只鞋的细边归还给那只鞋。
    const thin = Math.max(1, Math.round((b.right - b.left + 1) * 0.18));
    for (let y = height - 1; y >= b.start; y--) {
      const a = left.bands[y], c = right.bands[y];
      if (!a || !c) continue;
      const leftWidth = a.right - a.left + 1, rightWidth = c.right - c.left + 1;
      const small = Math.min(leftWidth, rightWidth), large = Math.max(leftWidth, rightWidth);
      if (a.right + 1 !== c.left || small > thin || large < small * 2.5) break;
      if (leftWidth < rightWidth) { c.left = a.left; delete left.bands[y]; }
      else { a.right = c.right; delete right.bands[y]; }
    }
  }
  return [left, right];
}

function walkFaceColors(b) {
  const { width, height } = b.cv;
  const radius = Math.round(height * 0.12);
  const left = Math.max(0, Math.floor(b.center - radius)), right = Math.min(width, Math.ceil(b.center + radius));
  const hair = new Map(), colors = new Map();
  const faceTop = Math.floor(height * 0.29);
  for (let y = Math.floor(height * 0.12); y < height * 0.58; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      const [r, g, blue, alpha] = b.pixels.subarray(i, i + 4);
      if (alpha < 160 || Math.max(r, g, blue) < 64 || Math.max(r, g, blue) - Math.min(r, g, blue) < 18) continue;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (blue >> 4);
      if (y < faceTop) hair.set(key, [r, g, blue]);
      else if (!hair.has(key)) colors.set(key, [r, g, blue]);
    }
  }
  const hairColors = [...hair.values()];
  const distinct = [...colors.values()].filter(([r, g, blue]) => !hairColors.some(([a, c, d]) =>
    Math.abs(r - a) + Math.abs(g - c) + Math.abs(blue - d) <= 48));
  // 从面部附近选最集中的色相，减少眼睛、头发高光和衣服颜色的干扰。
  const groups = Array.from({ length: 12 }, () => []);
  for (const color of distinct) {
    const [r, g, blue] = color;
    const hue = (Math.round(Math.atan2(g - blue, r - g) * 6 / Math.PI) + 12) % 12;
    groups[hue].push(color);
  }
  const family = groups.map((group, i) => [...groups[(i + 11) % 12], ...group, ...groups[(i + 1) % 12]]);
  const selected = family.reduce((best, group) => group.length > best.length ? group : best, []);
  const light = ([r, g, blue]) => r + g + blue;
  return selected.sort((a, b) => light(a) - light(b));
}

function walkHands(b, feet, view, colors) {
  const { width, height } = b.cv;
  const side = view === 'left' || view === 'right', facing = view === 'left' ? -1 : 1;
  // 侧面只用中亮部，避免手的深色描边和腿、衣摆连在一起。
  const palette = side ? colors.slice(Math.floor(colors.length * 0.45)) : colors;
  const hip = Math.min(...feet.map(foot => foot.top));
  const first = Math.max(Math.floor(height * 0.34), Math.floor(hip - height * 0.22));
  const last = hip - 1;
  const match = new Uint8Array(width * height);
  const colorCache = new Map();
  for (let y = first; y < last; y++) {
    for (let x = 0; x < width; x++) {
      const offset = x - b.center, distance = Math.abs(offset);
      if (side ? distance > height * 0.18 || offset * facing > height * 0.045
        : distance < height * 0.095 || distance > height * 0.34) continue;
      const i = (y * width + x) * 4;
      if (b.pixels[i + 3] < 100) continue;
      const [r, g, blue] = b.pixels.subarray(i, i + 3);
      if (Math.max(r, g, blue) - Math.min(r, g, blue) < 14) continue;
      const key = r * 65536 + g * 256 + blue;
      if (!colorCache.has(key)) {
        colorCache.set(key, palette.some(([a, c, d]) => Math.abs(r - a) + Math.abs(g - c) + Math.abs(blue - d) <= 39));
      }
      match[y * width + x] = Number(colorCache.get(key));
    }
  }

  const hands = [];
  for (let seed = first * width; seed < last * width; seed++) {
    if (!match[seed]) continue;
    const queue = [seed], bands = new Array(height);
    let top = last, bottom = first, left = width, right = 0;
    match[seed] = 0;
    for (let j = 0; j < queue.length; j++) {
      const i = queue[j], x = i % width, y = Math.floor(i / width);
      const row = bands[y] || (bands[y] = { left: x, right: x });
      row.left = Math.min(row.left, x); row.right = Math.max(row.right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      left = Math.min(left, x); right = Math.max(right, x);
      for (const next of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, i - width, i + width]) {
        if (match[next]) { match[next] = 0; queue.push(next); }
      }
    }
    const handWidth = right - left + 1, handHeight = bottom - top + 1;
    if (top <= first || bottom >= last - 1 || handWidth < height * 0.035 || handHeight < height * 0.035 ||
        Math.max(handWidth, handHeight) > height * 0.145 || queue.length < handWidth * handHeight * 0.46 ||
        Math.max(handWidth, handHeight) > Math.min(handWidth, handHeight) * 2) continue;
    const onLeft = (left + right) / 2 < b.center;
    // 正背面只收紧贴人体外轮廓的手，避免把衣服上的同色纹样当成手。
    const edge = onLeft ? 'left' : 'right', sign = onLeft ? -1 : 1;
    if (!side && !bands.some((row, y) => b.runs[y].some(run =>
      row.left >= run.left && row.right <= run.right && Math.abs(row[edge] - run[edge]) <= height * 0.031))) continue;

    // 手下方仍有连贯的外侧轮廓时，可能握着扫帚、法杖等长物件。
    let outline = 0;
    for (let y = Math.max(hip, bottom + Math.ceil(height * 0.045)); y < hip + height * 0.16 && y < height; y++) {
      if (b.runs[y].some(run => onLeft
        ? run.left < b.left - 1 && run.left <= left && run.right >= left - height * 0.04
        : run.right > b.right + 1 && run.right >= right && run.left <= right + height * 0.04)) outline++;
    }
    if (outline >= height * 0.045) continue;

    // 连同紧贴手的轮廓移动，手腕上方作为固定点。
    const rim = Math.max(1, Math.round(height * 0.012));
    bands.forEach((row, y) => {
      const run = b.runs[y].find(r => row.left >= r.left && row.right <= r.right);
      if (!run) return;
      row.left = !side && onLeft && row.left - run.left <= height * 0.035 ? run.left : Math.max(run.left, row.left - rim);
      row.right = !side && !onLeft && run.right - row.right <= height * 0.035 ? run.right : Math.min(run.right, row.right + rim);
    });
    hands.push({ top: top - Math.max(1, Math.round(height * 0.026)), bottom, bands, sign });
  }
  if (side) return hands.length === 1 ? hands : [];
  return hands.filter(hand => hands.filter(other => other.sign === hand.sign).length === 1);
}

function stepFrame(b, view, leftStep, motion, feet, hands = []) {
  const { width: w, height: h } = b.cv;
  const a = b.pixels;
  const img = new ImageData(w, h), out = img.data;
  out.set(a);
  const put = (dst, src, shade) => {
    const alpha = a[src + 3];
    if (!alpha) return;
    const below = out[dst + 3] * (1 - alpha / 255);
    const sum = alpha + below;
    for (let channel = 0; channel < 3; channel++) {
      out[dst + channel] = (a[src + channel] * shade * alpha + out[dst + channel] * below) / sum;
    }
    out[dst + 3] = sum;
  };
  const erase = part => part.bands.forEach(({ left, right }, y) => {
    out.fill(0, (y * w + left) * 4, (y * w + right + 1) * 4);
  });
  const warp = (part, stride, lift, shade = 1) => {
    const length = Math.max(1, (part.bottom ?? h - 1) - part.top);
    part.bands.forEach(({ left, right }, y) => {
      const t = (y - part.top) / length;
      const ny = y - Math.round(lift * Math.pow(t, 1.25));
      const dx = Math.round(stride * t);
      for (let x = left; x <= right; x++) {
        const nx = x + dx;
        if (ny >= 0 && ny < h && nx >= 0 && nx < w) put((ny * w + nx) * 4, (y * w + x) * 4, shade);
      }
    });
  };
  if (view === 'front' || view === 'back') {
    const raised = feet[Number(leftStep === (view === 'front'))];
    erase(raised);
    warp(raised, 0, motion.lift);
  } else {
    const facingLeft = view === 'left';
    const nearLeads = leftStep === facingLeft;
    const stride = (leftStep ? -1 : 1) * motion.stride;
    const [far, near = far] = feet;
    erase(far);
    if (near !== far) erase(near);
    warp(far, -stride, nearLeads ? 0 : motion.sideLift, near === far ? 0.8 : 1);
    warp(near, stride, nearLeads ? motion.sideLift : 0);
  }
  for (const hand of hands) {
    const side = view === 'left' || view === 'right';
    const isLeftArm = side ? view === 'left' : (hand.sign < 0) === (view === 'back');
    const forward = isLeftArm !== leftStep;
    const facing = view === 'left' ? -1 : 1;
    erase(hand);
    // 手盖在身体上时，用两边的衣服像素补上移开后的区域，避免出现透明洞。
    hand.bands.forEach(({ left, right }, y) => {
      if (left === 0 || right + 1 === w || !b.runs[y].some(run => run.left < left && run.right > right)) return;
      const from = (y * w + left - 1) * 4, to = (y * w + right + 1) * 4;
      for (let x = left; x <= right; x++) {
        const mix = (x - left + 1) / (right - left + 2), i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) out[i + c] = a[from + c] * (1 - mix) + a[to + c] * mix;
        out[i + 3] = a[i + 3];
      }
    });
    warp(hand, side ? motion.arm * facing * (forward ? 1 : -1) : 0, motion.arm * (forward ? 1 : 0.4));
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}

function makeWalkSheet(views, o) {
  const height = Math.round(Math.max(24, Math.min(240, Number(o.height) || 96)));
  const amp = Math.max(0, Math.min(2, Number(o.step ?? 1)));
  const style = amp ? o.style || 'auto' : 'glide';
  // 小尺寸成品先在较大的画布上识别脚缝，保留缩小后会合并的像素。
  const workHeight = style === 'auto' ? Math.max(height, 96) : height;
  const scale = height / workHeight;
  const motion = {
    lift: Math.max(2, height * 0.055) * amp / scale,
    sideLift: Math.max(1, height * 0.022) * amp / scale,
    stride: Math.max(2, height * 0.045) * amp / scale,
    arm: Math.max(1, height * 0.021) * amp / scale,
  };
  const fitted = WALK_VIEWS.map(([view, label]) => {
    let b;
    try { b = fitWalkView(views[view], workHeight, style === 'auto' ? Math.ceil(motion.stride) : 0); }
    catch (e) { throw new Error(label + '：' + e.message); }
    const side = view === 'left' || view === 'right';
    return { b, view, side, feet: style === 'auto' ? walkFeet(b, side) : null };
  });
  const hasFeet = fitted.some(v => !v.side && v.feet);
  const colors = o.arms !== false && style === 'auto' ? walkFaceColors(fitted[0].b) : [];
  const rows = fitted.map(({ b, view, side, feet }) => {
    // 侧面的一双鞋常完全重叠。正面或背面确认有双脚时，才使用侧面鞋形补足前后脚。
    if (!feet && side && hasFeet) {
      const foot = traceWalkFoot(b, b.left, b.right);
      if (foot) feet = [foot];
    }
    if (feet) {
      const hands = colors.length ? walkHands(b, feet, view, colors) : [];
      const frames = [stepFrame(b, view, true, motion, feet, hands), b.cv, stepFrame(b, view, false, motion, feet, hands)];
      return { center: b.center, frames, mode: 'step', arms: hands.length };
    }
    return { center: b.center, frames: [b.cv, b.cv, b.cv], mode: style === 'glide' ? 'glide' : 'float' };
  });
  const pad = o.glow ? 6 : 2;
  const float = rows.some(b => b.mode === 'float') ? Math.max(1, Math.round(height * 0.033 * amp)) : 0;
  const half = Math.max(...rows.map(b => Math.max(b.center, b.frames[1].width - b.center)));
  const fw = 2 * Math.ceil(half * scale + pad), fh = height + pad + 4 + float;
  const sheet = document.createElement('canvas'); sheet.width = fw * 3; sheet.height = fh * 4;
  const g = sheet.getContext('2d');
  g.imageSmoothingEnabled = scale < 1;
  g.imageSmoothingQuality = 'high';
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = 5; }
  rows.forEach(({ center, frames, mode }, row) => {
    frames.forEach((im, col) => {
      const x = col * fw, y = row * fh;
      g.save();
      g.beginPath(); g.rect(x, y, fw, fh); g.clip();
      const rise = mode === 'float' && col !== 1 ? float : 0;
      g.drawImage(im, x + Math.round(fw / 2 - center * scale), y + pad + 1 + float - rise, Math.max(1, Math.round(im.width * scale)), height);
      g.restore();
    });
  });
  return { sheet, fw, fh, modes: rows.map(r => r.mode), arms: rows.map(r => r.arms || 0) };
}
// 预览：四个方向一起走（0 1 2 1）
function walkPreview(box, made) {
  const cv = document.createElement('canvas'), z = 2;
  cv.width = made.fw * 4 * z; cv.height = made.fh * z; cv.className = 'walkprev';
  cv.style.cssText = 'image-rendering:pixelated;background:#5d7a5d;border-radius:6px;max-width:100%';
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  let p = 0;
  const tick = () => {
    if (!cv.isConnected) return;
    const col = [0, 1, 2, 1][p++ % 4];
    g.clearRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < 4; r++) g.drawImage(made.sheet, col * made.fw, r * made.fh, made.fw, made.fh, r * made.fw * z, 0, made.fw * z, made.fh * z);
    setTimeout(tick, 170);
  };
  box.appendChild(cv);
  setTimeout(tick, 0);
}
async function fourViewDialog() {
  const inputs = {};
  let made = null;
  const r = await openDialog(`<header><h3>从四视图做小人</h3></header>
    <div class="dbody">
      <details><summary>本工程的小人尺寸和示例</summary><div id="walkGuide">正在读取…</div></details>
      <button class="drop" id="walkBulk" type="button">选择或拖入横排四视图，也可一次导入四张已命名的 PNG</button>
      <input type="file" accept="image/png" id="walkFiles" multiple hidden>
      <div class="fnote">用透明背景的站姿图。横排图按正面、左侧、右侧、背面等宽排列。单图可按方向命名后一起导入，也可逐张选择。</div>
      <div class="walk-inputs">
        ${WALK_VIEWS.map(([view, label]) => `<div class="walk-view">
          <span id="walk-label-${view}">${label}</span>
          <button class="small walk-file" type="button" data-walk-view="${view}" aria-labelledby="walk-label-${view}">选择 PNG</button>
          <input type="file" accept="image/png" id="walk-file-${view}" hidden>
        </div>`).join('')}
      </div>
      <div id="walkAnimation" class="upprev"></div>
      <div class="fgrid" id="walkOptions" style="display:none">
        <label for="walkHeight">身高（像素）</label><input id="walkHeight" type="number" min="24" max="240" value="96"><span class="faint" style="grid-column:2">游戏里一格是 48 像素。四个方向按同一身高、脚底对齐。</span>
        <label for="walkStyle">动作方式</label><select id="walkStyle"><option value="auto">自动识别双脚</option><option value="float">轻微浮动</option><option value="glide">平移</option></select>
        <label for="walkStep">动作幅度</label><select id="walkStep"><option value="1">正常</option><option value="1.5">大</option><option value="0.6">小</option><option value="0">无</option></select>
        <span>摆臂</span><label><input id="walkArms" type="checkbox" checked> 自动识别可见的手</label>
        <label for="walkGlow">外发光</label><select id="walkGlow"><option value="">无</option><option value="rgba(255,205,70,0.95)">金色</option><option value="rgba(255,60,50,0.95)">红色</option><option value="rgba(110,180,255,0.95)">蓝色</option></select>
        <label for="walkName">文件名</label><input id="walkName" maxlength="60" placeholder="例：小明">
      </div>
      <div id="walkPreview" class="upprev"></div>
      <div id="walkError" role="alert"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok disabled>保存成行走图</button></footer>`,
    (d, done) => {
      const guide = $('#walkGuide', d);
      guide.parentElement.addEventListener('toggle', () => {
        if (guide.parentElement.open) api('sprite-guide').then(info => { if (guide.isConnected) showSpriteGuide(guide, info); })
          .catch(() => { if (guide.isConnected) guide.textContent = '暂时无法读取本工程的推荐尺寸'; });
      });
      const generation = d._gen;
      const active = () => d.open && d._gen === generation;
      const slots = $$('[data-walk-view]', d), bulk = $('#walkBulk', d);
      const options = $('#walkOptions', d), name = $('#walkName', d), save = $('[data-ok]', d);
      const fail = m => { $('#walkError', d).innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
      let busy = false;
      const setBusy = value => {
        busy = value;
        for (const control of [bulk, ...slots, ...$$('input,select', options)]) control.disabled = busy;
        save.disabled = busy || !made;
      };
      const redraw = () => {
        const animation = $('#walkAnimation', d), box = $('#walkPreview', d);
        animation.replaceChildren();
        box.replaceChildren();
        made = null;
        save.disabled = true;
        if (WALK_VIEWS.some(([view]) => !inputs[view])) return;
        options.style.display = '';
        try {
          const views = Object.fromEntries(WALK_VIEWS.map(([view]) => [view, inputs[view].image]));
          const arms = $('#walkArms', d).checked;
          made = makeWalkSheet(views, { height: $('#walkHeight', d).value, step: $('#walkStep', d).value, glow: $('#walkGlow', d).value, style: $('#walkStyle', d).value, arms });
          walkPreview(animation, made);
          const modes = document.createElement('div'); modes.className = 'faint';
          const label = { step: '交替迈步', float: '轻微浮动', glide: '平移' };
          modes.textContent = WALK_VIEWS.map(([, direction], i) => direction + ' ' + label[made.modes[i]]).join(' · ');
          animation.appendChild(modes);
          if (arms && made.modes.includes('step')) {
            const summary = document.createElement('div'); summary.className = 'dim';
            const detected = WALK_VIEWS.flatMap(([, direction], i) => made.arms[i] ? [direction + ' ' + made.arms[i] + ' 只'] : []);
            summary.textContent = detected.length ? '摆臂方向 · ' + detected.join(' · ') : '手部位置不明确，保留原姿势';
            animation.appendChild(summary);
          }
          const img = document.createElement('img'); img.src = made.sheet.toDataURL('image/png'); img.className = 'upimg'; img.style.imageRendering = 'auto'; box.appendChild(img);
          const meta = document.createElement('div'); meta.className = 'dim'; meta.style.fontSize = '12.5px';
          meta.textContent = `${made.sheet.width} × ${made.sheet.height}，每帧 ${made.fw} × ${made.fh}`;
          box.appendChild(meta); fail('');
          save.disabled = busy;
        } catch (e) { made = null; fail(e.message); }
      };
      const pick = async (files, view) => {
        if (busy || !files.length) return;
        setBusy(true);
        fail('');
        try {
          const loaded = {};
          if (view) {
            if (files.length !== 1) throw new Error('每个方向选一张 PNG');
            loaded[view] = { image: await loadFileImage(files[0]), name: files[0].name };
          } else if (files.length === 1) {
            const image = await loadFileImage(files[0]);
            if (image.naturalWidth % 4) throw new Error('横排四视图的宽度要能等分成四份');
            const w = image.naturalWidth / 4, h = image.naturalHeight;
            WALK_VIEWS.forEach(([key], i) => {
              const part = document.createElement('canvas'); part.width = w; part.height = h;
              part.getContext('2d').drawImage(image, i * w, 0, w, h, 0, 0, w, h);
              loaded[key] = { image: part, name: files[0].name };
            });
          } else if (files.length === 4) {
            for (const file of files) {
              const matches = WALK_VIEWS.filter(([key]) => WALK_VIEW_NAMES[key].test(file.name));
              if (matches.length !== 1 || loaded[matches[0][0]]) {
                throw new Error('有文件名无法唯一对应方向，请按正面、左侧、右侧、背面分别选择');
              }
              loaded[matches[0][0]] = { image: await loadFileImage(file), name: file.name };
            }
          } else throw new Error('请选择一张横排四视图，或四张单图');
          if (!active()) return;
          Object.assign(inputs, loaded);
          for (const button of slots) {
            const file = inputs[button.dataset.walkView];
            if (file) button.title = button.textContent = file.name;
          }
          if (!name.value && !view && files.length === 1) {
            name.value = files[0].name.replace(/\.png$/i, '').replace(/^[!$]+/, '')
              .replace(/[_ -]?四视图(?:[_ -]?横排)?$/, '').replace(/[^\w一-鿿 .()\-]/g, '_').slice(0, 50);
          }
          redraw();
        } catch (e) { if (active()) fail(e.message); }
        finally { if (active()) setBusy(false); }
      };
      const bindPicker = (button, input, view) => {
        button.onclick = () => input.click();
        input.onchange = () => { const files = [...input.files]; input.value = ''; pick(files, view); };
        button.ondragover = e => { e.preventDefault(); button.classList.add('over'); };
        button.ondragleave = () => button.classList.remove('over');
        button.ondrop = e => { e.preventDefault(); button.classList.remove('over'); pick([...e.dataTransfer.files], view); };
      };
      bindPicker(bulk, $('#walkFiles', d));
      for (const button of slots) bindPicker(button, $('#walk-file-' + button.dataset.walkView, d), button.dataset.walkView);
      for (const id of ['#walkHeight', '#walkStyle', '#walkStep', '#walkArms', '#walkGlow']) $(id, d).onchange = redraw;
      $('[data-x]', d).onclick = () => done(null);
      save.onclick = async () => {
        if (busy || !made) return;
        const base = name.value.trim().replace(/^[!$]+/, '').trim();
        if (!base) { fail('起个文件名'); name.focus(); return; }
        setBusy(true);
        fail('');
        try {
          const x = await api('image/save', { sub: 'characters', name: '$' + base, data: made.sheet.toDataURL('image/png'), overwrite: false });
          done(x);
        } catch (e) { if (active()) fail(e.message); }
        finally { if (active()) setBusy(false); }
      };
    });
  if (!r) return;
  forgetImage('characters', r.name);
  toast('已保存：' + r.name + '（在事件和人物里选它就能用）');
  render();
}
