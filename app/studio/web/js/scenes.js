'use strict';
// 场景：新建场景（台词 + CG）、放到地图上的某一天、在选项里关联、场景库页
//   一个场景 = 一个公共事件（第一条是 <RpgStudioScene> 注释）；地图上的事件、选项都去调用它，改一处各处一起变
const TRIG_OPTS = [[0, '走过去按确定键'], [1, '碰到就开始'], [3, '一进地图自动播']];
const sameAt = (a, b) => a && b && a.type === b.type && (a.type === 'ce' ? a.ce === b.ce : a.map === b.map && a.ev === b.ev && a.page === b.page);

// 「放在哪」那一段文字：地图 2「灯塔镇」(8, 8) · 第 3 天 · 夜晚
function placeText(p) {
  const m = S.maps.find(x => x.id === p.map);
  const ax = progAxis();
  const when = ax && p.seg != null && p.seg >= 0 ? ' · ' + ax.segs[p.seg] + (p.slot >= 0 && ax.slots[p.slot] ? ' · ' + ax.slots[p.slot] : '') : '';
  return `地图 ${p.map}「${m ? m.name : ''}」(${p.x}, ${p.y})${when}`;
}

// 新建场景 / 把已有场景放到地图上
//   opts.place = { map, x, y, seg, slot }  放在哪（从地图工作台点空格子来的）
//   opts.link  = { at, line, label }        建好后关联到这个选项
//   opts.sceneId / sceneName                不新建，只把这个场景放到 place
//   st：选小人要借用同一个弹窗，选完带着填好的内容回来
async function sceneDialog(opts = {}, st = null) {
  st = st || { name: '', text: '', trigger: 0, once: true, exact: true, image: null, advanceTo: '' };
  const placing = !!opts.sceneId;
  const p = opts.place;
  const ax = progAxis();
  const hasNext = p && ax && p.seg != null && p.seg >= 0 && p.seg < ax.segs.length - 1;
  const actors = (await lookup('actor')).filter(a => a.name).slice(0, 24);
  const title = placing ? `把场景「${esc(opts.sceneName || '')}」放在这里` : opts.link ? `新建场景，选「${esc(opts.link.label)}」时播` : '新建场景';
  const r = await openDialog(`<header><h3>${title}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody scdlg">
      ${placing ? `<div class="scexist"><span>场景「${esc(opts.sceneName || '')}」</span><button type="button" class="small" id="scPlayExisting">▶ 播放这个场景</button></div>` : `<div class="scbody">
        <div class="scleft">
          <div class="fgrid"><label for="scName">名字</label><input id="scName" maxlength="40" placeholder="比如：图书馆的夜谈" value="${esc(st.name)}"></div>
          <div class="csec"><span class="csec-t">谁说什么</span><span class="faint">一行一句「名字：台词」；「#图 图片名」从这句开始显示 CG，「#清图」关掉；「#选项 去 | 不去」下面每行用 #1 #2 开头</span></div>
          <div class="scchips">${actors.map(a => `<button type="button" class="small" data-sa="${esc(a.name)}">${esc(a.name)}</button>`).join('')}<button type="button" class="small" id="scPicBtn">插入 CG…</button><button type="button" class="small" data-sins="#清图">#清图</button></div>
          <div id="scPics" class="picture-picker scpics" hidden></div>
          <textarea id="scText" rows="12" placeholder="老船长：今晚的海很安静。&#10;#图 cg_harbor&#10;小鱼：嗯……&#10;#清图">${esc(st.text)}</textarea>
        </div>
        <div class="scprev" aria-label="预览">
          <div class="scprev-h"><b>预览</b><span class="faint">边写边看</span><span class="sp"></span><button type="button" class="small primary" id="scPlay">▶ 播放</button></div>
          <div id="scBoard" class="sboard"><div class="faint">写了台词，这里会一句句显示出来，CG 直接显示图</div></div>
        </div>
      </div>`}
      ${p ? `<div class="csec"><span class="csec-t">放在哪</span><span>${esc(placeText(p))}</span></div>
        ${ax && p.seg != null && p.seg >= 0 ? `<label class="switch"><input type="checkbox" id="spExact" ${st.exact && hasNext ? 'checked' : ''} ${hasNext ? '' : 'disabled'}><span>只在${ax.type === 'day' ? '这一天' : '这一段'}出现${hasNext ? `（${esc(ax.segs[p.seg + 1])}起就没有了）` : '（已经是最后一段）'}</span></label>` : ''}
        <div class="fgrid">
          <span>怎么开始</span><div class="imodes">${TRIG_OPTS.map(([v, l]) => `<label class="switch"><input type="radio" name="spTrig" value="${v}" ${st.trigger === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          ${ax && p.seg != null && p.seg >= 0 && hasNext ? `<label for="spAdv">播完以后</label><select id="spAdv"><option value="">不推进剧情</option>${ax.segs.map((l, i) => i > p.seg ? `<option value="${i}" ${String(st.advanceTo) === String(i) ? 'selected' : ''}>推进到${esc(l)}</option>` : '').join('')}</select>` : ''}
          <span>只播一次</span><label class="switch"><input type="checkbox" id="spOnce" ${st.once || st.trigger === 3 ? 'checked' : ''} ${st.trigger === 3 ? 'disabled' : ''}><span id="spOnceNote">${st.trigger === 3 ? '自动播的一定只播一次，不然会一直重复' : '播过以后这个格子就空了'}</span></label>
          <span>小人</span><div class="imgrow"><span class="pspr" id="spImg"></span><span class="dim" id="spImgName" style="font-size:12.5px"></span><button type="button" class="small" id="spImgPick">选小人</button>${st.image ? '<button type="button" class="quiet small" id="spImgNone">不要小人</button>' : ''}</div>
        </div>` : opts.link ? '' : '<div class="fnote">先放进场景库。以后在「剧情进度」里点地图上的空格子把它放到某一天，或者在事件的「选了 …」旁边点「关联场景」。</div>'}
      <div id="scErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>${placing ? '放在这里' : p ? '新建并放在这里' : opts.link ? '新建并关联' : '新建场景'}</button></footer>`,
    (d, done) => {
      if (!placing) { d.classList.add('dlg-wide'); d.addEventListener('close', () => d.classList.remove('dlg-wide'), { once: true }); }
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const err = m => { $('#scErr', d).innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
      const ta = $('#scText', d);
      // 实时预览：停下来 0.35 秒就把台词翻成步骤，画成一列（图直接显示，找不到的标红）
      let timer = 0, seq = 0;
      const board = $('#scBoard', d);
      const refresh = () => {
        if (!board) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const my = ++seq, t = ta.value;
          if (!t.trim()) { board.innerHTML = '<div class="faint">写了台词，这里会一句句显示出来，CG 直接显示图</div>'; return; }
          try { const tl = await api('play', { text: t }); if (my === seq) board.innerHTML = storyboardHtml(tl.steps) || '<div class="faint">还没有台词和图</div>'; }
          catch (e) { if (my === seq) board.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
        }, 350);
      };
      if (ta) { ta.addEventListener('input', refresh); if (ta.value.trim()) refresh(); }
      if ($('#scPlay', d)) $('#scPlay', d).onclick = () => { if (!ta.value.trim()) { err('先写几句台词'); ta.focus(); return; } playText(ta.value, null, ($('#scName', d).value || '').trim() || '新场景'); };
      if ($('#scPlayExisting', d)) $('#scPlayExisting', d).onclick = () => playAt({ type: 'ce', ce: opts.sceneId }, opts.sceneName);
      const insert = s => {
        const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
        const before = v.slice(0, a), after = v.slice(b);
        const pre = before && !before.endsWith('\n') ? '\n' : '';
        ta.value = before + pre + s + after;
        const pos = (before + pre + s).length;
        ta.focus(); ta.setSelectionRange(pos, pos);
        refresh();
      };
      if (ta) {
        $$('[data-sa]', d).forEach(b => b.onclick = () => insert(b.dataset.sa + '：'));
        $$('[data-sins]', d).forEach(b => b.onclick = () => insert(b.dataset.sins + '\n'));
        $('#scPicBtn', d).onclick = async () => {
          const box = $('#scPics', d);
          box.hidden = !box.hidden;
          if (box.hidden) return;
          const search = $('input', box);
          if (search) { search.focus(); return; }
          const button = $('#scPicBtn', d);
          button.disabled = true;
          box.textContent = '正在读取图片…';
          try {
            const { names } = await api('images?sub=pictures');
            if (box.isConnected) mountPicturePicker(box, names, name => {
              insert('#图 ' + name + '\n');
              box.hidden = true;
            });
          } catch (e) {
            box.hidden = true;
            if (box.isConnected) err(e.message);
          } finally {
            button.disabled = false;
          }
        };
        if (!placing) ($('#scName', d).value ? ta : $('#scName', d)).focus();
      }
      const snap = () => ({
        name: $('#scName', d) ? $('#scName', d).value : st.name, text: ta ? ta.value : st.text,
        trigger: $('input[name=spTrig]:checked', d) ? Number($('input[name=spTrig]:checked', d).value) : st.trigger,
        once: $('#spOnce', d) ? $('#spOnce', d).checked : st.once, exact: $('#spExact', d) ? $('#spExact', d).checked : st.exact, image: st.image,
        advanceTo: $('#spAdv', d) ? $('#spAdv', d).value : st.advanceTo,
      });
      if (p) {
        const showImg = () => {
          const box = $('#spImg', d); box.innerHTML = '';
          const im = st.image;
          if (im && im.characterName) {
            loadSheet(im.characterName).then(sh => { if (!sh) return; const f = frameOf(sh, im.characterName, im.characterIndex, im.direction, im.pattern); const cv = document.createElement('canvas'); cv.width = f.pw; cv.height = f.ph; cv.className = 'sprcv'; cv.style.height = '48px'; cv.style.width = 48 * f.pw / f.ph + 'px'; cv.getContext('2d').drawImage(sh, f.sx, f.sy, f.pw, f.ph, 0, 0, f.pw, f.ph); box.appendChild(cv); });
            $('#spImgName', d).textContent = im.characterName + (isBigSheet(im.characterName) ? '' : ' 第 ' + ((im.characterIndex || 0) + 1) + ' 个');
          } else { box.innerHTML = '<span class="pnone">无</span>'; $('#spImgName', d).textContent = '不显示（看不见的触发点）'; }
        };
        showImg();
        $$('input[name=spTrig]', d).forEach(x => x.onchange = () => {
          const auto = Number(x.value) === 3 && x.checked;
          const once = $('#spOnce', d);
          if (auto) { once.checked = true; once.disabled = true; $('#spOnceNote', d).textContent = '自动播的一定只播一次，不然会一直重复'; }
          else { once.disabled = false; $('#spOnceNote', d).textContent = '播过以后这个格子就空了'; }
        });
        $('#spImgPick', d).onclick = () => done({ pick: snap() });
        if ($('#spImgNone', d)) $('#spImgNone', d).onclick = () => done({ again: { ...snap(), image: null } });
      }
      $('[data-ok]', d).onclick = async () => {
        err('');
        const s = snap();
        const placeBody = p ? { map: p.map, x: p.x, y: p.y, seg: p.seg, slot: p.slot, trigger: s.trigger, once: s.once, exact: s.exact, image: s.image, advanceTo: s.advanceTo === '' ? null : Number(s.advanceTo) } : null;
        const btn = $('[data-ok]', d); btn.disabled = true;
        try {
          if (placing) { const x = await api('scene/place', { id: opts.sceneId, ...placeBody }); done({ placed: x.placed, id: opts.sceneId }); return; }
          if (!s.name.trim()) { btn.disabled = false; $('#scName', d).focus(); return err('给场景起个名字'); }
          if (!s.text.trim()) { btn.disabled = false; ta.focus(); return err('写几句台词（一行一句：名字：台词）'); }
          const x = await api('scene/create', { name: s.name, text: s.text, place: placeBody });
          if (opts.link) await api('scene/link', { at: opts.link.at, line: opts.link.line, id: x.id });
          done({ placed: x.placed, id: x.id, created: true });
        } catch (e) { btn.disabled = false; err(e.message); }
      };
    });
  if (r && r.pick) {
    const cur = r.pick.image || {};
    const sp = await spritePicker({ name: cur.characterName, index: cur.characterIndex, dir: cur.direction, pattern: cur.pattern }, { title: '场景的小人' });
    return sceneDialog(opts, { ...r.pick, image: sp ? { characterName: sp.name, characterIndex: sp.index, direction: sp.dir, pattern: sp.pattern } : r.pick.image });
  }
  if (r && r.again) return sceneDialog(opts, r.again);
  if (!r || (!r.id && !r.placed)) return;
  S.lookups = {};
  if (r.placed) {
    toast(`已${r.created ? '新建场景并' : '把场景'}放在${placeText(p)}${r.placed.until ? '（' + r.placed.until + '起就没有了）' : ''}${r.placed.advance ? '，播完推进到' + r.placed.advance : ''}`);
    PW.placing = null;
    PW.sel = { map: r.placed.map, ev: r.placed.ev, page: 0 };
    PW.map = r.placed.map;
    if (typeof ME !== 'undefined' && ME) ME.stageCells = null;
    await refreshMaps();
    if (route().name === 'progress') render(); else location.hash = '#/progress';
    return;
  }
  await refreshMaps();
  if (opts.link) { toast('已新建场景并关联到「' + opts.link.label + '」'); render(); return; }
  toast('已新建场景，放进了场景库');
  if (route().name === 'scenes') render(); else location.hash = '#/scenes';
}

// 选项关联场景：在「选了 xxx」下面插一条调用
async function linkDialog(at, line, label) {
  let data;
  try { data = await api('scenes'); } catch (e) { toast(e.message, true); return; }
  const r = await openDialog(`<header><h3>选「${esc(label)}」时播哪个场景</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      ${data.scenes.length > 6 ? `<input id="slq" placeholder="筛选（共 ${data.scenes.length} 个场景）">` : ''}
      <div id="sll" class="sclist"></div>
      <div class="fnote">关联以后，选这个选项时先播它原来的台词，再播场景。</div>
      <div id="slErr"></div>
    </div>
    <footer><button type="button" id="slNew">＋ 新建一个场景并关联</button><span class="sp"></span><button data-x>关闭</button></footer>`,
    (d, done) => {
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const draw = q => {
        const list = data.scenes.filter(s => !q || (s.name + ' ' + s.first).toLowerCase().includes(q));
        $('#sll', d).innerHTML = list.map(s => {
          const linked = s.uses.some(u => u.kind === 'choice' && sameAt(u.at, at) && u.choiceLine === line);
          return `<div class="scrow ${linked ? 'on' : ''}"><div class="scr-m"><b>${esc(s.name)}</b><span class="faint">${s.lines} 句${s.pics.length ? ' · ' + s.pics.length + ' 张图' : ''}</span><div class="dim scr-t">${esc((s.speaker ? s.speaker + '：' : '') + s.first)}</div></div>
            ${linked ? `<button type="button" class="small" data-sun="${s.id}">取消关联</button>` : `<button type="button" class="small primary" data-sln="${s.id}">关联</button>`}</div>`;
        }).join('') || `<div class="empty">${data.scenes.length ? '没有符合的场景' : '还没有场景，点下面「新建一个场景并关联」。'}</div>`;
        $$('[data-sln]', d).forEach(b => b.onclick = async () => {
          try { await api('scene/link', { at, line, id: Number(b.dataset.sln) }); done({ ok: '已关联场景' }); } catch (e) { $('#slErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
        });
        $$('[data-sun]', d).forEach(b => b.onclick = async () => {
          try { await api('scene/unlink', { at, line, id: Number(b.dataset.sun) }); done({ ok: '已取消关联' }); } catch (e) { $('#slErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
        });
      };
      if ($('#slq', d)) $('#slq', d).oninput = e => draw(e.target.value.trim().toLowerCase());
      $('#slNew', d).onclick = () => done({ create: true });
      draw('');
    });
  if (r && r.create) return sceneDialog({ link: { at, line, label } });
  if (r && r.ok) { toast(r.ok); render(); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('.sclink');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { linkDialog(JSON.parse(b.dataset.sat), Number(b.dataset.sline), b.dataset.slabel || ''); } catch (err) { toast(err.message, true); }
});

// 一处使用写成一行字
function useText(u) {
  const w = u.where.replace(/^地图 \d+「([^」]*)」 · /, '$1 · ');
  if (u.kind === 'choice') return `选项「${u.label}」· ${w}`;
  if (u.kind === 'page') return `${u.stage ? u.stage + ' · ' : ''}${w.replace(/ · 第 1 页$/, '')}${u.pos ? ` (${u.pos.x}, ${u.pos.y})` : ''}`;
  return w;
}
// ---------- 场景库页 ----------
async function viewScenes(main) {
  main.innerHTML = '<div class="loading">正在读取场景…</div>';
  const [data] = await Promise.all([api('scenes'), PROG ? null : loadProgress()]);
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>场景</h1><span class="dim">一段剧情（台词 + CG）。放到地图上的某一天，或者挂到某个选项下面；改一处，用到它的地方一起变</span><span class="sp"></span><button class="primary small" id="scNew">＋ 新建场景</button></div>
    ${data.scenes.length > 8 ? `<input id="scq" class="scq" placeholder="筛选场景（共 ${data.scenes.length} 个）">` : ''}
    <div class="scgrid" id="scGrid"></div>
  </div>`;
  $('#scNew').onclick = () => sceneDialog({});
  const draw = q => {
    const list = data.scenes.filter(s => !q || (s.name + ' ' + s.first).toLowerCase().includes(q));
    $('#scGrid').innerHTML = list.map(s => `<div class="card sccard">
      <div class="sc-h"><b>${esc(s.name)}</b><span class="faint num">公共事件 ${s.id}</span></div>
      <div class="sc-t">${s.first ? `<span class="dim">${esc(s.speaker || '旁白')}：</span>${esc(s.first)}` : '<span class="faint">还没有台词</span>'}</div>
      <div class="sc-meta faint">${s.lines} 句${s.pics.length ? ' · ' + s.pics.length + ' 张图' : ''}</div>
      ${s.pics.length ? `<div class="sc-pics">${s.pics.slice(0, 4).map(n => `<img loading="lazy" src="${img('pictures', n)}" alt="" onerror="this.remove()">`).join('')}</div>` : ''}
      <div class="sc-uses">${s.uses.length ? s.uses.slice(0, 5).map(u => `<a href="${hrefOf(u.at)}">${esc(useText(u))}</a>`).join('') + (s.uses.length > 5 ? `<span class="faint">还有 ${s.uses.length - 5} 处</span>` : '') : '<span class="faint">还没放到地图上，也没关联到选项</span>'}</div>
      <div class="sc-acts"><button type="button" class="small" data-splay="${s.id}">▶ 预览</button><a class="small" href="#/ce/${s.id}">看 / 改台词</a><button type="button" class="small" data-splace="${s.id}">放到地图</button>${s.uses.length ? '' : `<button type="button" class="quiet small" data-sdel="${s.id}">删除</button>`}</div>
    </div>`).join('') || `<div class="empty">${data.scenes.length ? '没有符合的场景' : '还没有场景。点右上角「＋ 新建场景」写第一段；已有的公共事件也可以在它的页面里「⋯ → 加进场景库」。'}</div>`;
    $$('[data-splay]').forEach(b => b.onclick = () => { const s = data.scenes.find(x => x.id === Number(b.dataset.splay)); playAt({ type: 'ce', ce: s.id }, s.name); });
    $$('[data-splace]').forEach(b => b.onclick = () => {
      const s = data.scenes.find(x => x.id === Number(b.dataset.splace));
      PW.placing = { id: s.id, name: s.name };
      toast(progAxis() ? '选好哪一天，再点地图上的空格子' : '点地图上的空格子放这个场景');
      location.hash = '#/progress';
    });
    $$('[data-sdel]').forEach(b => b.onclick = async () => {
      const s = data.scenes.find(x => x.id === Number(b.dataset.sdel));
      if (!await confirmDialog('删除场景', `删除场景「${s.name}」？它没有被任何地方用到，会清空公共事件 ${s.id}。`, '删除场景')) return;
      try { await api('scene/delete', { id: s.id }); toast('已删除'); await refreshMaps(); render(); } catch (e) { toast(e.message, true); }
    });
  };
  if ($('#scq')) $('#scq').oninput = e => draw(e.target.value.trim().toLowerCase());
  draw('');
}
