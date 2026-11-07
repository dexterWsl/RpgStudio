'use strict';
// 预览播放：黑底放 CG、下面对话框，点一下走一句；选项点着选，条件分支问「成立吗」
//   playAt(at, title)        播一页（{type:'map',map,ev,page} / {type:'ce',ce}）
//   playTimeline(tl, title)  播服务器翻好的步骤（POST play 的结果）
//   storyboardHtml(steps)    把步骤画成一列（新建场景时的实时预览）
// 用单独的 <dialog>：新建场景的弹窗开着的时候也能叠在上面播
// 图：自带的显示图片（左上 / 中心原点）、立绘插件的立绘（位置 0~10，底部居中，入场 / 退场滑进滑出）、视频层插件的视频
const movie = name => '/api/studio/movie?name=' + enc(name);
async function playAt(at, title) {
  const q = at.type === 'ce' ? 'ce=' + at.ce : `map=${at.map}&ev=${at.ev}&page=${at.page || 0}`;
  try { const tl = await api('play?' + q); playTimeline(tl, title || tl.title); } catch (e) { toast(e.message, true); }
}
async function playText(text, at, title) {
  try { const tl = await api('play', at ? { text, at } : { text }); playTimeline(tl, title); } catch (e) { toast(e.message, true); }
}

function playTimeline(tl, title) {
  const W = tl.screen.w, H = tl.screen.h;
  const d = document.createElement('dialog');
  d.className = 'playerdlg';
  d.innerHTML = `<div class="pl-top"><b>预览${title ? '：' + esc(title) : ''}</b><span class="faint">点画面或按空格继续 · Esc 关掉</span><span class="sp"></span>
      <button type="button" class="small" data-pl="restart">从头播</button><button type="button" class="small" data-pl="close">关闭</button></div>
    <div class="pl-wrap"><div class="pl-stage" style="width:${W}px;height:${H}px">
      <div class="pl-pics"></div><div class="pl-tws"></div><div class="pl-fade"></div>
      <div class="pl-msg" hidden><div class="pl-face" hidden></div><div class="pl-body"><div class="pl-name" hidden></div><div class="pl-text"></div></div><span class="pl-next" aria-hidden="true">▼</span></div>
      <div class="pl-ask" hidden></div>
      <div class="pl-note" hidden></div>
    </div></div>
    <div class="pl-bottom faint"><span class="pl-count"></span></div>`;
  document.body.appendChild(d);
  const stage = $('.pl-stage', d), wrap = $('.pl-wrap', d);
  const fit = () => {
    const k = Math.min((window.innerWidth * 0.92) / W, (window.innerHeight - 140) / H, 1.25);
    stage.style.transform = `scale(${k})`;
    wrap.style.width = W * k + 'px'; wrap.style.height = H * k + 'px';
  };
  fit();
  window.addEventListener('resize', fit);
  const pics = new Map(), tws = new Map();
  let stack, said, waiting, ended;
  const els = { msg: $('.pl-msg', d), face: $('.pl-face', d), name: $('.pl-name', d), text: $('.pl-text', d), ask: $('.pl-ask', d), note: $('.pl-note', d), fade: $('.pl-fade', d), count: $('.pl-count', d), layer: $('.pl-pics', d), twLayer: $('.pl-tws', d) };
  // 立绘插件：位置 0~10 → 坐标（左右各留 bufferX，底边对齐），哪些位置自动镜像
  const B = tl.bust || { ax: 0.5, ay: 1, sx: 100, sy: 100, inverted: [], bufferX: 200, stagger: 0, addY: 0 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const posX = p => { p = clamp(p, 0, 10); return clamp(Math.round(p * (W - B.bufferX * 2) / 10) + B.bufferX, B.bufferX, W - B.bufferX); };
  const posY = p => { p = clamp(p, 0, 10); return H + Math.round((5 - Math.abs(5 - p)) * B.stagger) + B.addY; };
  const autoMirror = (mode, pos) => mode === 'Mirror' || (mode === 'Auto' && B.inverted.includes(pos)) || (mode === 'Auto-Reverse' && !B.inverted.includes(pos));
  const ORIGIN = { 'Upper Left': [0, 0], Center: [0.5, 0.5] };
  const key = s => (s.video ? 'v' : '') + s.id;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const secs = f => (still ? 0 : (f || 0) / 60);
  // 锚点放到 (x, y)，绕锚点缩放 / 镜像
  const place = (el, s) => {
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    el.style.transformOrigin = `${s.ax * 100}% ${s.ay * 100}%`;
    el.style.transform = `translate(${-s.ax * 100}%, ${-s.ay * 100}%) scale(${(s.mirrored ? -1 : 1) * (s.sx == null ? 100 : s.sx) / 100}, ${(s.sy == null ? 100 : s.sy) / 100})`;
    el.style.opacity = (s.op == null ? 255 : s.op) / 255;
  };
  // 从 a 变到 b（frames 帧）；不用等，下一句台词照常出来
  function animate(el, a, b, frames) {
    const t = secs(frames);
    el.style.transition = 'none';
    place(el, a);
    if (!t) { if (a !== b) place(el, b); return; }
    void el.offsetWidth;
    el.style.transition = `left ${t}s, top ${t}s, opacity ${t}s, transform ${t}s`;
    place(el, b);
  }
  function makeEl(s) {
    let el;
    if (s.missing) {
      el = document.createElement('div');
      el.className = 'pl-missing';
      el.textContent = (s.video ? '找不到视频：' : '找不到图片：') + s.name;
    } else if (s.video) {
      el = document.createElement('video');
      el.muted = true; el.autoplay = true; el.playsInline = true; el.loop = !!s.loop;
      el.src = movie(s.name);
    } else {
      el = document.createElement('img');
      el.src = img('pictures', s.name);
      el.alt = s.name;
    }
    el.dataset.z = key(s);
    if (s.bust) el.dataset.bust = '1';
    return el;
  }
  function showPic(s) {
    const k = key(s);
    const old = pics.get(k);
    if (old) old.remove();
    const el = makeEl(s);
    let st;
    if (s.bust) {
      const [ax, ay] = ORIGIN[s.bust.origin] || [B.ax, B.ay];
      const pos = s.bust.pos;
      st = { id: s.id, name: s.name, bust: true, pos, x: posX(pos), y: posY(pos), ax, ay, sx: B.sx, sy: B.sy, op: 255, mirrored: autoMirror(s.bust.mirror, pos) };
    } else {
      const o = s.origin === 1 ? 0.5 : 0;
      st = { ...s, ax: o, ay: o };
    }
    el.style.zIndex = s.id * 2 + (s.video ? 1 : 0);
    el._s = st;
    pics.set(k, el);
    els.layer.appendChild(el);
    if (s.from && s.dur) animate(el, { ...st, x: st.x + s.from.dx, y: st.y + s.from.dy, op: 0 }, st, s.dur);
    else animate(el, st, st, 0);
  }
  // 立绘换图：位置、镜像都不变
  function swapPic(s) {
    const old = pics.get(key(s));
    if (!old) return;
    const el = makeEl({ ...s, bust: old._s.bust });
    el.style.zIndex = old.style.zIndex;
    el._s = { ...old._s, name: s.name };
    animate(el, el._s, el._s, 0);
    old.replaceWith(el);
    pics.set(key(s), el);
  }
  function movePic(s) {
    const el = pics.get(key(s));
    if (!el) return;
    const o = el._s, n = { ...o };
    for (const f of ['x', 'y', 'sx', 'sy', 'op']) if (s[f] != null) n[f] = s[f];
    if (s.origin != null && !o.bust) n.ax = n.ay = s.origin === 1 ? 0.5 : 0;
    if (s.pos != null || s.dpos != null || (s.reset && o.pos != null)) {
      n.pos = s.pos != null ? s.pos : s.dpos != null ? clamp((o.pos == null ? 5 : o.pos) + s.dpos, 0, 10) : o.pos;
      n.x = posX(n.pos); n.y = posY(n.pos);
    }
    if (s.dx) n.x = o.x + s.dx;
    if (s.dy) n.y = o.y + s.dy;
    if (s.dop != null) n.op = clamp((o.op == null ? 255 : o.op) + s.dop, 0, 255);
    if (s.flip) n.mirrored = !o.mirrored;
    if (s.mirror) n.mirrored = s.mirror === 'Toggle' ? !o.mirrored : autoMirror(s.mirror, n.pos);
    el._s = n;
    animate(el, o, n, s.dur);
  }
  // 关图；立绘退场是往旁边滑出去、淡出
  function erasePic(s) {
    const k = key(s), el = pics.get(k);
    if (!el) return;
    pics.delete(k);
    if (!secs(s.dur)) { el.remove(); return; }
    const o = el._s;
    animate(el, o, { ...o, x: o.x + (s.to ? s.to.dx : 0), y: o.y + (s.to ? s.to.dy : 0), op: 0 }, s.dur);
    setTimeout(() => el.remove(), secs(s.dur) * 1000 + 60);
  }
  // 文字窗口插件：画面上的一块字
  function textWin(s) {
    let el = tws.get(s.id);
    if (s.off) { if (el) el.remove(); tws.delete(s.id); return; }
    if (!el) { el = document.createElement('div'); el.className = 'pl-tw'; el._s = {}; els.twLayer.appendChild(el); tws.set(s.id, el); }
    const o = el._s = { ...el._s, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) };
    el.textContent = o.text || '';
    const w = o.w || 400;
    el.style.left = (o.x == null ? (W - w) / 2 : o.x) + 'px';
    el.style.top = (o.y == null ? H / 3 : o.y) + 'px';
    el.style.width = w + 'px';
    el.style.minHeight = o.h ? o.h + 'px' : '';
    el.style.background = `rgba(16,22,40,${(o.op == null ? 192 : o.op) / 255})`;
  }
  let noteTimer = 0;
  const note = t => { els.note.textContent = t; els.note.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(() => { els.note.hidden = true; }, 1400); };
  function say(s) {
    els.ask.hidden = true;
    els.msg.hidden = false;
    els.msg.className = 'pl-msg bg' + s.bg + ' pos' + s.pos + (s.scroll ? ' scroll' : '');
    els.face.hidden = !s.face;
    if (s.face) {
      els.face.style.backgroundImage = `url("${img('faces', s.face.name)}")`;
      els.face.style.backgroundPosition = `${-(s.face.index % 4) * 144}px ${-Math.floor(s.face.index / 4) * 144}px`;
    }
    els.name.hidden = !s.speaker;
    els.name.textContent = s.speaker || '';
    if (s.align) { els.text.innerHTML = s.lines.map((l, k) => `<span class="ln ${s.align[k] || 'left'}">${esc(l) || ' '}</span>`).join(''); }
    else els.text.textContent = s.lines.join('\n');
    said++;
    els.count.textContent = `第 ${said} 句`;
  }
  function ask(question, options, onPick) {
    els.ask.innerHTML = `${question ? `<div class="pl-q">${esc(question)}</div>` : ''}${options.map((o, i) => `<button type="button" data-ask="${i}">${esc(o)}</button>`).join('')}`;
    els.ask.hidden = false;
    waiting = true;
    $$('[data-ask]', els.ask).forEach(b => b.onclick = e => { e.stopPropagation(); els.ask.hidden = true; waiting = false; onPick(Number(b.dataset.ask)); stage.focus(); next(); });
  }
  function finish() {
    ended = true;
    els.msg.hidden = true;
    els.ask.innerHTML = `<div class="pl-q">播完了（${said} 句）</div><button type="button" data-end="restart">从头播</button><button type="button" data-end="close">关闭</button>`;
    els.ask.hidden = false;
    $('[data-end="restart"]', els.ask).onclick = e => { e.stopPropagation(); start(); };
    $('[data-end="close"]', els.ask).onclick = e => { e.stopPropagation(); d.close(); };
  }
  // 往下走：不用等的（图、等待、淡入淡出……）一口气做完，停在下一句台词 / 选项上
  function next() {
    if (waiting || ended) return;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i >= top.steps.length) { stack.pop(); continue; }
      const s = top.steps[top.i++];
      if (s.t === 'say') { say(s); return; }
      if (s.t === 'pic') showPic(s);
      else if (s.t === 'swap') swapPic(s);
      else if (s.t === 'move') movePic(s);
      else if (s.t === 'erase') erasePic(s);
      else if (s.t === 'textwin') textWin(s);
      else if (s.t === 'fade') els.fade.classList.toggle('on', !!s.out);
      else if (s.t === 'note') note(s.text);
      else if (s.t === 'call') stack.push({ steps: s.steps, i: 0 });
      else if (s.t === 'choice') {
        const opts = [...s.options, ...(s.cancel ? ['（按取消）'] : [])];
        ask('', opts, k => { const b = k < s.options.length ? s.branches[k] : s.cancel; if (b && b.length) stack.push({ steps: b, i: 0 }); });
        return;
      } else if (s.t === 'if') {
        ask('如果 ' + s.cond + '？', ['成立', '不成立'], k => { const b = k === 0 ? s.yes : s.no; if (b && b.length) stack.push({ steps: b, i: 0 }); });
        return;
      }
    }
    finish();
  }
  function start() {
    els.layer.innerHTML = ''; els.twLayer.innerHTML = '';
    pics.clear(); tws.clear();
    els.fade.classList.remove('on');
    els.msg.hidden = true; els.ask.hidden = true;
    stack = [{ steps: tl.steps, i: 0 }]; said = 0; waiting = false; ended = false;
    next();
  }
  stage.tabIndex = -1;
  stage.onclick = () => next();
  // 空格 / 回车往下走（焦点在哪都行，只要播放器开着；焦点在按钮上时还是按那个按钮）
  const onKey = e => { if (!d.open || !(e.key === ' ' || e.key === 'Enter') || (e.target.closest && e.target.closest('button'))) return; e.preventDefault(); next(); };
  document.addEventListener('keydown', onKey);
  $('[data-pl="restart"]', d).onclick = () => start();
  $('[data-pl="close"]', d).onclick = () => d.close();
  d.addEventListener('close', () => { window.removeEventListener('resize', fit); document.removeEventListener('keydown', onKey); d.remove(); });
  d.showModal();
  stage.focus();
  if (!tl.steps.length) { els.ask.innerHTML = '<div class="pl-q">这一页没有台词和图片可以播</div>'; els.ask.hidden = false; ended = true; return; }
  start();
}

// 一列「分镜」：每句台词、每张图、每个选项（新建场景时边写边看）
function storyboardHtml(steps, depth = 0) {
  const row = s => {
    if (s.t === 'say') return `<div class="sb-say">${s.speaker ? `<b>${esc(s.speaker)}</b>` : '<b class="faint">旁白</b>'}<span>${esc(s.lines.join('\n'))}</span></div>`;
    if (s.t === 'pic' && s.video) return s.missing ? `<div class="sb-pic bad"><span>找不到视频：${esc(s.name)}</span></div>` : `<div class="sb-ev">播放视频 ${esc(s.name)}</div>`;
    if (s.t === 'pic' || s.t === 'swap') {
      const what = s.t === 'swap' ? '换立绘' : s.bust ? '立绘入场' : '显示图片';
      return s.missing ? `<div class="sb-pic bad"><span>找不到图片：${esc(s.name)}</span></div>`
        : `<div class="sb-pic${s.bust || s.t === 'swap' ? ' bust' : ''}"><img loading="lazy" src="${img('pictures', s.name)}" alt=""><span>${what} ${esc(s.name)}</span></div>`;
    }
    if (s.t === 'erase') return `<div class="sb-ev">${s.video ? '关掉视频' : s.to ? '立绘退场' : '关掉图片'} #${s.id}</div>`;
    if (s.t === 'move') return `<div class="sb-ev">${s.video ? '移动视频' : '移动图片'} #${s.id}</div>`;
    if (s.t === 'textwin') return `<div class="sb-ev">${s.off ? `关掉文字窗口 #${s.id}` : `文字窗口：${esc(s.text || '')}`}</div>`;
    if (s.t === 'plugin') return `<div class="sb-ev faint">插件 ${esc(s.plugin)}：${esc(s.text)}</div>`;
    if (s.t === 'wait') return `<div class="sb-ev">等 ${(s.frames / 60).toFixed(1).replace(/\.0$/, '')} 秒</div>`;
    if (s.t === 'fade') return `<div class="sb-ev">${s.out ? '画面淡出' : '画面淡入'}</div>`;
    if (s.t === 'note') return `<div class="sb-ev">${esc(s.text)}</div>`;
    if (s.t === 'call') return `<div class="sb-ev">播「${esc(s.name)}」</div><div class="sb-in">${storyboardHtml(s.steps, depth + 1)}</div>`;
    if (s.t === 'choice') return `<div class="sb-ev sb-ch">选项：${s.options.map(esc).join(' / ')}</div>${s.options.map((o, i) => `<div class="sb-br">选「${esc(o)}」</div><div class="sb-in">${storyboardHtml(s.branches[i] || [], depth + 1) || '<div class="sb-ev faint">（什么都不做）</div>'}</div>`).join('')}`;
    if (s.t === 'if') return `<div class="sb-ev sb-ch">如果 ${esc(s.cond)}</div><div class="sb-br">成立</div><div class="sb-in">${storyboardHtml(s.yes, depth + 1)}</div>${s.no.length ? `<div class="sb-br">不成立</div><div class="sb-in">${storyboardHtml(s.no, depth + 1)}</div>` : ''}`;
    return '';
  };
  return steps.map(row).join('');
}
