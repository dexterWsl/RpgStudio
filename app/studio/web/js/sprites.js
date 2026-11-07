'use strict';
// 小人库：行走图 / 头像库、上传、替换一格、调整（偏移 / 缩放 / 翻转）
// ---------- 小人库 ----------
async function viewSprites(main, sub) {
  sub = sub === 'faces' ? 'faces' : 'characters';
  main.innerHTML = '<div class="loading">正在读取小人…</div>';
  const r = await api('sheets?sub=' + sub);
  let q = '', filter = 'all';
  main.innerHTML = `<div class="page wide">
    <div class="crumbs"><a href="#/people">人物</a><span>›</span><span>小人库</span></div>
    <div class="titlebar"><h1>小人库</h1>
      <div class="seg"><button data-sub="characters" class="${sub === 'characters' ? 'on' : ''}">行走图</button><button data-sub="faces" class="${sub === 'faces' ? 'on' : ''}">头像</button></div>
      <span class="dim">${r.sheets.length} 张图</span><span class="sp"></span>
      ${r.canWrite && sub === 'characters' ? '<button class="small" id="upThree" title="正面、侧面、背面三张站立图（或者一张三视图），拼成游戏里能走的小人">从三视图做</button>' : ''}
      ${r.canWrite ? `<button class="primary small" id="upNew">上传${sub === 'faces' ? '头像' : '小人'}</button>` : ''}</div>
    <div class="filters"><input type="search" id="sq" placeholder="按图名筛选"><div class="seg" id="sf"><button data-f="all" class="on">全部</button><button data-f="used">用到的</button><button data-f="unused">没用到的</button></div>
      <span class="dim" style="font-size:12.5px">点一个${sub === 'faces' ? '头像' : '小人'}看它用在哪里、替换或调整</span></div>
    <div id="sgrid" class="sheetgrid big"></div>
  </div>`;
  const draw = () => {
    const list = r.sheets.filter(s => (!q || s.name.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'used' ? Object.keys(s.uses).length : !Object.keys(s.uses).length)));
    $('#sgrid').innerHTML = list.map(s => `<div class="sheet card"><div class="sheetname">${esc(s.name)}${s.big ? ' <span class="faint">单人</span>' : ''}${s.object ? ' <span class="faint">物件</span>' : ''}</div>
      <div class="sheetchars ${sub === 'faces' ? 'faces' : ''}">${(s.big ? [0] : [0, 1, 2, 3, 4, 5, 6, 7]).map(i => `<button class="schar" data-n="${esc(s.name)}" data-i="${i}" title="${s.uses[i] ? '用在 ' + s.uses[i] + ' 处' : '没被用到'}">${s.uses[i] ? `<em>${s.uses[i]}</em>` : ''}</button>`).join('')}</div></div>`).join('') || '<div class="empty">没有符合的图</div>';
    $$('#sgrid .schar').forEach(b => {
      const em = $('em', b);
      mountSprite(b, b.dataset.n, Number(b.dataset.i), 2, sub === 'faces' ? 64 : 44, false, sub).then(() => { if (em) b.appendChild(em); });
      b.onclick = () => { $$('#sgrid .schar.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); showSheetChar(sub, b.dataset.n, Number(b.dataset.i), r.canWrite); };
    });
  };
  $$('[data-sub]', main).forEach(b => b.onclick = () => go('#/sprites/' + b.dataset.sub));
  $('#sq').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#sf button').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#sf button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  if ($('#upNew')) $('#upNew').onclick = () => uploadDialog(sub, null);
  if ($('#upThree')) $('#upThree').onclick = () => threeViewDialog();
  draw();
}
// 右栏：一个小人用在哪里 + 替换 / 调整
async function showSheetChar(sub, name, index, canWrite) {
  const side = $('#side');
  $('#shell').classList.remove('noside');
  side.innerHTML = '<div class="side-in loading">正在查找…</div>';
  S.side = { kind: sub, id: name + '#' + index };
  const r = await api(`sheet-usage?sub=${sub}&name=${enc(name)}&index=${index}`);
  const big = sub === 'characters' && isBigSheet(name);
  side.innerHTML = `<div class="side-in">
    <button class="quiet small sideclose" id="sideX">关闭</button>
    <h2>${esc(name)}${big ? '' : ` · 第 ${index + 1} 个`}</h2>
    <div class="pbig side">${sub === 'faces' ? '<span class="pdir" data-dir="2"></span>' : ['2', '4', '6', '8'].map(d => `<span class="pdir" data-dir="${d}"></span>`).join('')}</div>
    ${canWrite ? `<div class="edbar"><button class="small" id="scReplace">替换成上传的图</button>${sub === 'characters' ? '<button class="small" id="scAdjust">调整</button>' : ''}</div>` : ''}
    <div class="dim" style="margin-top:10px">${r.refs.length ? `用在 ${r.refs.length} 处` : '没有地方用到它'}</div>
    ${r.refs.map(x => `<a class="refitem" href="${x.at.type === 'actor' ? '#/people/a' + x.at.actor : hrefOf(x.at)}"><div class="w">${esc(x.where)}</div><div class="t">${esc(x.text)}</div></a>`).join('')}
  </div>`;
  $$('.pdir', side).forEach(el => mountSprite(el, name, index, Number(el.dataset.dir), sub === 'faces' ? 120 : 56, sub !== 'faces', sub));
  $('#sideX').onclick = closeSide;
  if ($('#scReplace')) $('#scReplace').onclick = () => uploadDialog(sub, { name, index, big });
  if ($('#scAdjust')) $('#scAdjust').onclick = () => adjustDialog(name, index);
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

// ---------- 从三视图做小人 ----------
//   正面 / 右侧 / 背面三张透明站立图（或者一张三视图，左右等分成三份），拼成单人行走图（3 列 × 4 行）：
//   朝下 = 正面，朝左 = 右侧镜像，朝右 = 右侧，朝上 = 背面；走路的左右两帧整体往上抬几像素（只有站姿也能看出在走）。
//   脚底对齐：每张图都按「最下面那一排不透明像素的中点」放在格子底部中间，正面的身高缩到设定的像素。
//   AI 出的三视图（比如 ComfyUI 的「立绘转高清像素小人」）就是这个格式。
function viewBox(im) {
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
  const a = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) throw new Error('有一张图是全透明的（背景要透明，人物不透明）');
  // 脚：最下面 6% 高度里不透明像素的平均 x
  const band = Math.max(2, Math.round((y1 - y0) * 0.06));
  let sx = 0, n = 0;
  for (let y = y1 - band; y <= y1; y++) for (let x = x0; x <= x1; x++) if (a[(y * w + x) * 4 + 3] > 40) { sx += x; n++; }
  return { cv, x0, y0, x1, y1, fx: n ? sx / n : (x0 + x1) / 2, fy: y1 + 1 };
}
// 缩小：一半一半地缩，比一次缩到底清楚
function shrinkCanvas(src, s) {
  let cur = src, k = s;
  while (k < 0.5) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cur.width / 2)); c.height = Math.max(1, Math.round(cur.height / 2));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; k *= 2;
  }
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, c.width, c.height);
  return c;
}
// 走路的三帧：左脚抬起 / 站着 / 右脚抬起（游戏里按 0 1 2 1 轮着放）。跟 lonely/art/dnf_sheets.py 是同一套规则：
//   正面、背面：腿分左右两半（从两腿之间最空的那一列分开），抬起那条腿从胯往下慢慢收上去，上半身往下沉一点
//   侧面：两条腿叠在一起的那一竖条复制两份，一份往前迈、一份（暗一点，远的那条腿）往后迈，抬起的那只脚离地一点
//   腿从哪里开始算：脚底往上 44% 的身高。数值都是游戏里的像素，乘上「迈步幅度」
const WALK = { leg: 0.44, lift: 3.5, sink: 1, stride: 4, sideLift: 1.5 };
function legSplit(a, w, b) {
  const hip = b.fy - WALK.leg * (b.fy - b.y0);
  const lo = Math.floor(b.fy - (b.fy - hip) * 0.55), bw = b.x1 + 1 - b.x0;
  const c0 = Math.floor(b.fx - bw * 0.15), c1 = Math.floor(b.fx + bw * 0.15);
  let best = Infinity, split = b.fx;
  for (let x = Math.max(0, c0); x <= Math.min(w - 1, c1); x++) {
    let n = 0;
    for (let y = lo; y < b.fy; y++) if (a[(y * w + x) * 4 + 3] > 40) n++;
    if (n < best - 0.5 || (Math.abs(n - best) <= 0.5 && Math.abs(x + 0.5 - b.fx) < Math.abs(split - b.fx))) { best = Math.min(best, n); split = x + 0.5; }
  }
  return { split, hip };
}
function legBand(a, w, b, hip) {
  const y0 = Math.floor(b.fy - (b.fy - hip) * 0.12);
  const on = x => { for (let y = y0; y < b.fy; y++) if (a[(y * w + x) * 4 + 3] > 40) return true; return false; };
  let x = Math.round(b.fx);
  if (!on(x)) { let best = null; for (let i = 0; i < w; i++) if (on(i) && (best == null || Math.abs(i - b.fx) < Math.abs(best - b.fx))) best = i; if (best == null) return [x - 4, x + 4]; x = best; }
  let l = x, r = x;
  while (l > 0 && on(l - 1)) l--;
  while (r < w - 1 && on(r + 1)) r++;
  const m = Math.floor((r - l) * 0.25) + 2;
  return [l - m, r + m];
}
// 一帧：kind = 'front'（正面 / 背面）或 'side'；side = -1 / 1 是哪条腿抬；k = 原图像素 / 游戏像素
function stepFrame(b, kind, side, k) {
  const w = b.cv.width, h = b.cv.height;
  const a = b.cv.getContext('2d').getImageData(0, 0, w, h).data;
  const { split, hip } = legSplit(a, w, b);
  const H0 = Math.floor(hip), L = Math.max(1, b.fy - hip), sink = WALK.sink * k;
  const t = y => Math.min(1, Math.max(0, (y - hip) / L));
  const out = new Float32Array(w * h * 4);
  const put = (i, r, g, bl, al) => {
    const f = al / 255;
    out[i] = r * f + out[i] * (1 - f); out[i + 1] = g * f + out[i + 1] * (1 - f); out[i + 2] = bl * f + out[i + 2] * (1 - f);
    out[i + 3] = Math.max(out[i + 3], al);
  };
  // 腿的一部分（cols 选哪些列）按行挪：dy、dx 只跟这一行在腿上的位置有关
  const warp = (cols, dyOf, dxOf, mul = 1) => {
    for (let y = H0; y < h; y++) {
      const ny = Math.round(y + dyOf(y)); if (ny < 0 || ny >= h) continue;
      const dx = Math.round(dxOf(y));
      for (let x = 0; x < w; x++) {
        if (!cols(x)) continue;
        const i = (y * w + x) * 4, al = a[i + 3];
        if (!al) continue;
        const nx = x + dx; if (nx < 0 || nx >= w) continue;
        put((ny * w + nx) * 4, a[i] * mul, a[i + 1] * mul, a[i + 2] * mul, al);
      }
    }
  };
  const drop = y => sink * (1 - t(y));
  if (kind === 'front') {
    const lift = WALK.lift * k;
    for (const part of [-1, 1]) warp(x => (part < 0 ? x < split : x >= split), y => drop(y) - (part === side ? lift * Math.pow(t(y), 1.3) : 0), () => 0);
  } else {
    const stride = WALK.stride * k, lift = WALK.sideLift * k;
    const [l, r] = legBand(a, w, b, hip);
    const inBand = x => x >= l && x <= r;
    warp(inBand, y => drop(y) - (side < 0 ? lift * Math.pow(t(y), 1.5) : 0), y => -stride * Math.pow(t(y), 1.1), 0.72);   // 远的那条腿往后、暗一点
    warp(x => !inBand(x), drop, () => 0);
    warp(inBand, y => drop(y) - (side > 0 ? lift * Math.pow(t(y), 1.5) : 0), y => stride * Math.pow(t(y), 1.1));
  }
  // 胯以上整块往下沉一点，盖在腿上面
  const sh = Math.round(sink);
  for (let y = 0; y < H0; y++) {
    const ny = y + sh; if (ny >= h) continue;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (a[i + 3]) put((ny * w + x) * 4, a[i], a[i + 1], a[i + 2], a[i + 3]); }
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const img = new ImageData(w, h);
  for (let i = 0; i < out.length; i++) img.data[i] = out[i];
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}
function makeWalkSheet(views, o) {
  // views：{ front, right, back }（Image 或 canvas）；o：{ height, step（迈步幅度，0 = 原地不动）, glow }
  const H = Math.max(24, Math.min(240, Number(o.height) || 96));
  const amp = Math.max(0, Math.min(2, o.step == null || o.step === '' ? 1 : Number(o.step)));
  const bx = { front: viewBox(views.front), right: viewBox(views.right), back: viewBox(views.back) };
  const s = H / (bx.front.fy - bx.front.y0), k = amp / s;
  const half = Math.max(...Object.values(bx).map(b => Math.max(b.fx - b.x0, b.x1 + 1 - b.fx))) * s + WALK.stride * amp;
  const top = Math.max(...Object.values(bx).map(b => b.fy - b.y0)) * s;
  const pad = o.glow ? 6 : 2;
  const fw = Math.ceil((half + pad) * 2 / 2) * 2, fh = Math.ceil(top + pad + 4);
  // 每个方向三帧：左脚 / 站 / 右脚（迈步幅度 0：三帧一样）
  const frames = {};
  for (const [key, kind] of [['front', 'front'], ['right', 'side'], ['back', 'front']]) {
    const b = bx[key];
    const f = amp > 0 ? [stepFrame(b, kind, -1, k), b.cv, stepFrame(b, kind, 1, k)] : [b.cv, b.cv, b.cv];
    frames[key] = f.map(cv => shrinkCanvas(cv, s));
  }
  const sheet = document.createElement('canvas'); sheet.width = fw * 3; sheet.height = fh * 4;
  const g = sheet.getContext('2d');
  const rows = [['front', false], ['right', true], ['right', false], ['back', false]];   // 下 左 右 上
  rows.forEach(([key, flip], row) => {
    const b = bx[key];
    for (let col = 0; col < 3; col++) {
      const im = frames[key][key === 'back' ? 2 - col : col];
      const ox = col * fw, oy = row * fh;
      g.save();
      g.beginPath(); g.rect(ox, oy, fw, fh); g.clip();
      const dx = fw / 2 - b.fx * s, dy = fh - 3 - b.fy * s;
      if (flip) { g.translate(ox + fw, oy); g.scale(-1, 1); } else g.translate(ox, oy);
      if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = 5; g.drawImage(im, Math.round(dx), Math.round(dy)); g.shadowBlur = 0; }
      g.drawImage(im, Math.round(dx), Math.round(dy));
      g.restore();
    }
  });
  return { sheet, fw, fh };
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
async function threeViewDialog() {
  let views = null, made = null;
  const r = await openDialog(`<header><h3>从三视图做小人</h3></header>
    <div class="dbody">
      <label class="drop" id="drop"><input type="file" accept="image/png" id="tvf" multiple hidden><span>把一张<b>三视图</b>（正面、右侧、背面从左到右排）拖到这里，或者三张单图一起拖进来</span></label>
      <div class="fnote">三张单图按文件名认：带「正」「前」「front」的是正面，带「右」「侧」「side」的是右侧，带「背」「后」「back」的是背面；认不出来就按顺序。背景要透明。朝左那一行用右侧镜像出来。</div>
      <div id="tvPrev" class="upprev"></div>
      <div class="fgrid" id="tvForm" style="display:none">
        <label for="tvH">身高（像素）</label><input id="tvH" type="number" min="24" max="240" value="96"><span class="faint" style="grid-column:2">游戏里一格是 48 像素；RPG Maker 默认小人大约 40</span>
        <label for="tvStep">迈步幅度</label><select id="tvStep"><option value="1">正常</option><option value="1.5">大步</option><option value="0.6">小碎步</option><option value="0">不迈步（站着不动）</option></select>
        <label for="tvGlow">外发光</label><select id="tvGlow"><option value="">无</option><option value="rgba(255,205,70,0.95)">金色</option><option value="rgba(255,60,50,0.95)">红色</option><option value="rgba(110,180,255,0.95)">蓝色</option></select>
        <label for="tvName">文件名</label><input id="tvName" maxlength="60" placeholder="例：豪哥">
      </div>
      <div id="tvErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok disabled>保存成行走图</button></footer>`,
    (d, done) => {
      const fail = m => { $('#tvErr', d).innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
      const redraw = () => {
        const box = $('#tvPrev', d); box.innerHTML = '';
        if (!views) return;
        try {
          made = makeWalkSheet(views, { height: $('#tvH', d).value, step: $('#tvStep', d).value, glow: $('#tvGlow', d).value });
          walkPreview(box, made);
          const img = document.createElement('img'); img.src = made.sheet.toDataURL('image/png'); img.className = 'upimg'; img.style.imageRendering = 'auto'; box.appendChild(img);
          const meta = document.createElement('div'); meta.className = 'dim'; meta.style.fontSize = '12.5px';
          meta.textContent = `${made.sheet.width} × ${made.sheet.height}，每帧 ${made.fw} × ${made.fh}（单人图，文件名会加 $）`;
          box.appendChild(meta); fail('');
          $('[data-ok]', d).disabled = false;
        } catch (e) { made = null; fail(e.message); $('[data-ok]', d).disabled = true; }
      };
      const pick = async files => {
        fail(''); views = null;
        try {
          const ims = [];
          for (const f of files) ims.push({ name: f.name, im: await loadFileImage(f) });
          if (ims.length === 1) {
            // 一张三视图：等分成三份
            const im = ims[0].im, w = Math.floor(im.naturalWidth / 3), h = im.naturalHeight;
            const part = i => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, -i * w, 0); return c; };
            views = { front: part(0), right: part(1), back: part(2) };
          } else if (ims.length === 3) {
            const find = re => ims.find(x => re.test(x.name));
            const fr = find(/正|前|front/i), ri = find(/右|侧|side|right/i), bk = find(/背|后|back/i);
            views = fr && ri && bk && new Set([fr, ri, bk]).size === 3 ? { front: fr.im, right: ri.im, back: bk.im } : { front: ims[0].im, right: ims[1].im, back: ims[2].im };
          } else throw new Error('要一张三视图，或者正面、右侧、背面三张图');
          if (!$('#tvName', d).value) {
            const n0 = files[0].name.replace(/\.png$/i, '').replace(/^\d+_/, '').replace(/^[!$]+/, '');
            $('#tvName', d).value = (files.length === 1 ? n0.replace(/[_ ]?三视图$/, '') : '').replace(/[^\w一-鿿 .()\-]/g, '_').slice(0, 50);
          }
          $('#tvForm', d).style.display = '';
          redraw();
        } catch (e) { fail(e.message); }
      };
      $('#tvf', d).onchange = e => e.target.files.length && pick([...e.target.files]);
      const drop = $('#drop', d);
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) pick([...e.dataTransfer.files]); };
      for (const id of ['#tvH', '#tvStep', '#tvGlow']) $(id, d).onchange = redraw;
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        fail('');
        try {
          const base = $('#tvName', d).value.trim();
          if (!base) throw new Error('起个文件名');
          if (!made) throw new Error('先放图');
          const x = await api('image/save', { sub: 'characters', name: '$' + base.replace(/^[!$]+/, ''), data: made.sheet.toDataURL('image/png'), overwrite: false });
          done(x);
        } catch (e) { fail(e.message); }
      };
    });
  if (!r) return;
  forgetImage('characters', r.name);
  toast('已保存：' + r.name + '（在事件和人物里选它就能用）');
  render();
}
