'use strict';
// 回想房：总览、加回想（完整播放 / 只看图）、新建 / 换回想房
// ---------- 回想房 ----------
// 一张地图当回想房；每个入口事件 = 一个回想。可以挑已有的剧情加进来（完整播放 / 只看图）
const recallTitle = e => {
  const n = String(e.name || '').trim().replace(/^(Gallery_|回想_)/, '').replace(/_/g, ' ');
  if (n && !/^EV\d+$/.test(n)) return n;
  const s = e.scenes.find(x => x.label);
  return s ? s.label : '（没有名字）';
};
function unlockText(e) {
  const u = e.unlock;
  const parts = [];
  const ref = s => `<span class="ref" data-kind="switch" data-id="${s.id}" tabindex="0" title="${esc(s.name || '')}">开关 ${s.id}</span>`;
  // 入口页的条件：一条一行，写清楚在哪里打开
  for (const s of u.switches.filter(x => x.from === 'page')) {
    if (s.setCount) parts.push(`<span>看过才解锁：${ref(s)} 在 ${esc(s.setBy[0].where)}${s.setCount > 1 ? ` 等 ${s.setCount} 处` : ''}打开</span>`);
    else parts.push(`<span class="warnt">要 ${ref(s)}，正常玩没有地方打开它${s.roomSet ? '（只有回想房里的「全解锁」会打开）' : ''}</span>`);
  }
  // 选项前面的条件：每段一个开关，合成一行
  const ch = u.switches.filter(x => x.from === 'choice');
  if (ch.length) {
    const good = ch.filter(s => !s.on || s.setCount), bad = ch.filter(s => s.on && !s.setCount);
    if (good.length) parts.push(`<span>${ch.length > 1 ? '每段各自解锁' : '这段要'}：${good.map(ref).join('、')}，正常玩会打开</span>`);
    if (bad.length) parts.push(`<span class="warnt">${bad.map(ref).join('、')} 正常玩没有地方打开${bad.some(s => s.roomSet) ? '（只有回想房里的「全解锁」会打开）' : ''}</span>`);
  }
  if (u.variable) parts.push(`<span>变量 ${u.variable.id}「${esc(u.variable.name || '')}」≥ ${u.variable.value}</span>`);
  for (const o of u.other) parts.push(`<span>${esc(o)}</span>`);
  return parts.length ? parts.join('') : '<span class="okt">一开始就能看</span>';
}
async function viewGallery(main) {
  main.innerHTML = '<div class="loading">正在整理回想房…</div>';
  const v = await api('gallery');
  if (!v.map) { galleryEmpty(main, v); return; }
  let filter = S.galFilter || 'all';
  const scenes = v.entries.filter(e => e.kind === 'scene'), others = v.entries.filter(e => e.kind !== 'scene');
  const never = scenes.filter(e => e.neverOn.length), open = scenes.filter(e => e.open);
  main.innerHTML = `<div class="page wide">
    <div class="titlebar"><h1>回想房</h1>
      <a class="tag" href="#/map/${v.map.id}">地图 ${v.map.id}「${esc(v.map.name)}」</a>
      <span class="sp"></span>
      <button class="primary small" id="galAdd">＋ 加回想</button>
      ${moreMenu([{ id: 'galUnlockAll', label: '全部解锁（一开始就能看）' }, { id: 'galUse', label: '换一张地图当回想房' }, { id: 'galNew', label: '新建一张回想房' }])}
    </div>
    <div class="meta"><span>${scenes.length} 个回想</span><span>${open.length} 个一开始就能看</span>${never.length ? `<span class="warnt">${never.length} 个正常玩解锁不了</span>` : ''}${v.map.forced ? '' : `<span class="faint">按地图名认出来的</span>`}</div>
    <div class="filters"><div class="seg" id="galF">
      <button data-f="all">全部</button><button data-f="never">正常玩解锁不了</button><button data-f="open">一开始就能看</button><button data-f="mine">在这里加的</button>
    </div><input type="search" id="galQ" placeholder="按标题、内容筛选" style="max-width:240px"></div>
    <div class="galgrid" id="galGrid"></div>
    ${others.length ? foldSec('galOther', '回想房里的其它事件', `${others.length} 个：门、存档点、设置之类，不算回想`, `<div class="card rows">${others.map(e => `<a class="rowlink" href="#/event/${v.map.id}/${e.ev}/${e.page}"><span>事件 ${e.ev}「${esc(e.name || '')}」</span><span class="r">(${e.x}, ${e.y})</span></a>`).join('')}</div>`) : ''}
    <div class="section"><h2>还没进回想的 CG 剧情</h2><span class="dim">有 2 张以上剧情图、而且大多没在回想房出现过</span></div>
    <div class="card rows">${capped(v.gaps.map(g => `<div class="rowlink gaprow"><a href="${hrefOf(g.at)}">${esc(g.where)}</a><span class="r">${g.pics} 张图${g.lines ? ' · ' + g.lines + ' 句' : ''}<button class="small" data-gap='${esc(JSON.stringify(g.at))}'>加进回想</button></span>${g.first ? `<span class="sub">${esc(g.first)}</span>` : ''}</div>`), 8) || '<div class="empty" style="border:0">没有了，带 CG 的剧情都在回想房里</div>'}</div>
  </div>`;
  bindMenu(main); bindFoldSec(main);
  const card = e => {
    const t = recallTitle(e);
    const pics = [...new Set(e.scenes.flatMap(s => s.pics))].slice(0, 5);
    const calls = e.scenes.flatMap(s => s.calls);
    const plays = e.source ? `完整播放${calls.length ? ` 公共事件 ${calls[0].ce}${calls[0].name ? '「' + esc(calls[0].name) + '」' : ''}` : ''}${e.source.pic ? '，也可以只看图' : ''}` : e.scenes.length > 1 ? `${e.scenes.length} 段：${e.scenes.map(s => esc(s.label || '（没写）')).join(' / ')}`
      : calls.length ? `调用 ${calls.map(c => `公共事件 ${c.ce}${c.name ? '「' + esc(c.name) + '」' : ''}`).join('、')}` : `直接写在入口里`;
    const lines = e.scenes.reduce((n, s) => n + s.lines, 0), shown = e.scenes.reduce((n, s) => n + s.shown, 0);
    return `<div class="card galcard ${e.neverOn.length ? 'never' : ''}" data-ev="${e.ev}">
      <div class="galhead"><span class="galspr" data-spr='${esc(JSON.stringify(e.image || {}))}'></span>
        <div class="galt"><a href="#/event/${v.map.id}/${e.ev}/${e.page}">${esc(t)}</a><span class="faint">事件 ${e.ev} · (${e.x}, ${e.y})${shown ? ` · ${shown} 张图` : ''}${lines ? ` · ${lines} 句` : ''}</span></div>
        ${moreMenu([e.unlock.switches.length ? { id: 'gu' + e.ev, label: '解锁这个（一开始就能看）' } : null, e.source && e.source.copy ? { id: 'gs' + e.ev, label: '重新复制（原剧情改过以后同步）' } : null, { id: 'gr' + e.ev, label: '从回想房拿掉', danger: true }])}
      </div>
      <div class="galplays">${plays}</div>
      ${pics.length ? `<div class="galpics">${pics.map(n => `<img loading="lazy" src="${img('pictures', n)}" alt="" title="${esc(n)}" onerror="this.remove()">`).join('')}</div>` : ''}
      <div class="galunlock">${unlockText(e)}</div>
      ${e.source ? `<div class="galsrc">来自 <a href="${hrefOf(e.source.at)}">${esc(e.source.where || '')}</a>${e.source.copy ? '（复制了一份）' : ''}</div>` : ''}
    </div>`;
  };
  const draw = () => {
    $$('#galF button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    const q = ($('#galQ').value || '').trim().toLowerCase();
    const list = scenes.filter(e => (filter === 'all' || (filter === 'never' ? e.neverOn.length : filter === 'open' ? e.open : !!e.source)) &&
      (!q || (recallTitle(e) + ' ' + e.scenes.map(s => s.label + ' ' + s.calls.map(c => c.name).join(' ')).join(' ')).toLowerCase().includes(q)));
    $('#galGrid').innerHTML = list.map(card).join('') || `<div class="empty">${filter === 'mine' ? '还没有在这里加过回想。点「＋ 加回想」从已有的剧情里挑。' : '没有符合的回想'}</div>`;
    $$('.galspr', main).forEach(el => { const im = JSON.parse(el.dataset.spr); if (im.characterName) mountSprite(el, im.characterName, im.characterIndex, im.direction || 2, 40, false); else el.innerHTML = '<span class="pnone">无</span>'; });
    bindMenu($('#galGrid'));
    for (const e of list) {
      const u = $('#gu' + e.ev), s = $('#gs' + e.ev), r = $('#gr' + e.ev);
      if (u) u.onclick = () => galAct('gallery/unlock', { ev: e.ev, choices: true }, '已解锁「' + recallTitle(e) + '」');
      if (s) s.onclick = () => galAct('gallery/resync', { ev: e.ev }, '已重新复制「' + recallTitle(e) + '」');
      if (r) r.onclick = async () => {
        if (!await confirmDialog('从回想房拿掉', `拿掉「${recallTitle(e)}」？会删掉回想房里的这个入口事件${e.source && e.source.copy ? '，复制出来的公共事件没有别人用也会清空' : ''}；原剧情不受影响。删除前自动备份。`, '拿掉')) return;
        galAct('gallery/remove', { ev: e.ev }, '已拿掉');
      };
    }
  };
  $$('#galF button').forEach(b => b.onclick = () => { filter = b.dataset.f; S.galFilter = filter; draw(); });
  $('#galQ').oninput = draw;
  $('#galAdd').onclick = () => recallAddDialog(null);
  $('#galUnlockAll').onclick = async () => {
    if (!await confirmDialog('全部解锁', `把 ${scenes.length} 个回想都改成一开始就能看：清掉入口的开关条件和选项前面的 <<条件>>。「第几天」这种变量条件留着。改之前自动备份。`, '全部解锁')) return;
    galAct('gallery/unlock', { choices: true }, '已全部解锁');
  };
  $('#galUse').onclick = () => galleryRoomDialog(v, 'use');
  $('#galNew').onclick = () => galleryRoomDialog(v, 'copy');
  $$('[data-gap]', main).forEach(b => b.onclick = () => recallAddDialog([JSON.parse(b.dataset.gap)]));
  draw();
}
async function galAct(path, body, msg) {
  try { const r = await api(path, body); toast(msg + (r.changed != null ? `（改了 ${r.changed} 处）` : '')); render(); } catch (e) { toast(e.message, true); }
}
function galleryEmpty(main, v) {
  main.innerHTML = `<div class="page"><div class="titlebar"><h1>回想房</h1></div>
    <div class="card galempty">
      <p>还没有回想房。回想房就是一张地图：每个回想是里面的一个入口事件，走过去按确定就能把一段剧情完整再看一遍，或者只看 CG。</p>
      <div class="edbar"><button class="primary" id="galNew">新建回想房（复制一张地图的样子）</button><button id="galUse">用一张现有地图</button></div>
    </div></div>`;
  $('#galNew').onclick = () => galleryRoomDialog(v, 'copy');
  $('#galUse').onclick = () => galleryRoomDialog(v, 'use');
}
async function galleryRoomDialog(v, mode) {
  const maps = v.maps || [];
  const r = await openDialog(`<header><h3>${mode === 'copy' ? '新建回想房' : '换一张地图当回想房'}</h3></header>
    <div class="dbody">
      <div class="fgrid">
        ${mode === 'copy' ? '<label for="grName">名字</label><input id="grName" maxlength="40" value="回想房">' : ''}
        <label for="grMap">${mode === 'copy' ? '照着哪张地图' : '用哪张地图'}</label><select id="grMap">${maps.map(m => `<option value="${m.id}" ${v.map && m.id === v.map.id ? 'selected' : ''}>${m.id} ${esc(m.name)}</option>`).join('')}</select>
      </div>
      <div class="fnote">${mode === 'copy' ? '新地图的图块、大小、BGM 跟它一样，不带它的事件。建好后在地图页里可以再改。' : '这张地图的备注里会写上 &lt;RpgStudioRecallRoom&gt;，以后就认它。'}</div>
      <div id="grErr"></div>
    </div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>${mode === 'copy' ? '新建' : '就用它'}</button></footer>`,
    (d, done) => {
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        try { const x = await api('gallery/room', mode === 'copy' ? { mode, from: Number($('#grMap', d).value), name: $('#grName', d).value } : { mode, map: Number($('#grMap', d).value) }); done(x); }
        catch (e) { $('#grErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (r) { toast(mode === 'copy' ? '已新建回想房：地图 ' + r.map : '回想房换成了地图 ' + r.map); await refreshMaps(); render(); }
}
// 挑已有的剧情加进回想房。preset = 预先勾上的来源（事件页 / 公共事件 / 缺口里点的）
async function recallAddDialog(preset) {
  let src;
  try { src = (await api('gallery/sources')).sources; } catch (e) { toast(e.message, true); return; }
  const key = at => JSON.stringify(at.type === 'map' ? { type: 'map', map: at.map, ev: at.ev, page: at.page } : { type: 'ce', ce: at.ce });
  const pick = new Map();   // key → { at, title, image }
  const defTitle = s => { const n = String(s.name || '').trim(); return (n && !/^EV\d+$/.test(n) ? n : (s.first || s.where)).replace(/^[「『"]/, '').slice(0, 24); };
  const keep = RA_KEEP, opts0 = RA_OPTS || { unlock: 'open', picOnly: true };
  RA_KEEP = null; RA_OPTS = null;
  for (const at of preset || []) { const s = src.find(x => key(x.at) === key(at)); if (s) pick.set(key(at), (keep && keep.get(key(at))) || { at: s.at, title: defTitle(s), image: s.image || null }); }
  let onlyCg = !(preset && preset.length), hideIn = true, q = '';
  const r = await openDialog(`<header><h3>加回想：挑已有的剧情</h3><button class="quiet small" data-x>取消</button></header>
    <div class="dbody" style="max-height:76vh">
      <div class="filters" style="margin:0">
        <input type="search" id="raQ" placeholder="搜地图、事件名、台词" style="flex:1;min-width:160px">
        <label class="switch"><input type="checkbox" id="raCg" ${onlyCg ? 'checked' : ''}><span>只看有 CG 的</span></label>
        <label class="switch"><input type="checkbox" id="raIn" checked><span>藏起已经在回想房里的</span></label>
      </div>
      <div class="ralist" id="raList"></div>
      <div id="raPicked"></div>
      <div class="raopts">
        <span class="dim">解锁</span>
        <label class="switch"><input type="radio" name="raUn" value="open" ${opts0.unlock !== 'seen' ? 'checked' : ''}><span>一开始就能看</span></label>
        <label class="switch"><input type="radio" name="raUn" value="seen" ${opts0.unlock === 'seen' ? 'checked' : ''}><span>看过原剧情才解锁</span></label>
        <label class="switch" style="margin-left:auto"><input type="checkbox" id="raPic" ${opts0.picOnly ? 'checked' : ''}><span>加「只看图」选项</span></label>
      </div>
      <div class="fnote">在回想房里完整播放：台词、CG、音乐、选项照原样；播之前记下开关 / 变量 / 物品，播完恢复，不影响存档进度。传送会去掉。公共事件直接调用原来那一个，地图事件复制一份。</div>
      <div id="raErr"></div>
    </div>
    <footer><span class="dim" id="raCount"></span><span class="sp"></span><button class="primary" data-ok>加进回想房</button></footer>`,
    (d, done) => {
      const drawList = () => {
        const list = src.filter(s => (!onlyCg || s.pics > 0) && (!hideIn || !s.inRoom || pick.has(key(s.at))) &&
          (!q || (s.where + ' ' + s.name + ' ' + s.first).toLowerCase().includes(q)))
          .sort((a, b) => (pick.has(key(b.at)) - pick.has(key(a.at))) || (b.pics - a.pics) || (b.lines - a.lines)).slice(0, 150);
        $('#raList', d).innerHTML = list.map(s => `<label class="rarow ${pick.has(key(s.at)) ? 'on' : ''}"><input type="checkbox" data-k='${esc(key(s.at))}' ${pick.has(key(s.at)) ? 'checked' : ''}>
          <span class="raw"><b>${esc(s.where)}</b><span class="faint">${s.first ? esc(s.first) : ''}</span></span>
          <span class="r">${s.pics ? s.pics + ' 张图' : ''}${s.pics && s.lines ? ' · ' : ''}${s.lines ? s.lines + ' 句' : ''}${s.inRoom ? ' · 已在回想房' : ''}</span></label>`).join('') || '<div class="empty" style="border:0">没有符合的</div>';
        $$('#raList input', d).forEach(cb => cb.onchange = () => {
          const k = cb.dataset.k, s = src.find(x => key(x.at) === k);
          if (cb.checked) pick.set(k, { at: s.at, title: defTitle(s), image: s.image || null }); else pick.delete(k);
          cb.closest('.rarow').classList.toggle('on', cb.checked);
          drawPicked();
        });
      };
      const drawPicked = () => {
        $('#raCount', d).textContent = pick.size ? `选了 ${pick.size} 段` : '还没选';
        $('#raPicked', d).innerHTML = pick.size ? `<div class="csec"><span class="csec-t">回想房里显示成</span><span class="faint">标题和小人可以改</span></div>${[...pick].map(([k, p]) => `<div class="rapick" data-pk='${esc(k)}'>
          <button type="button" class="raspr" title="换小人"></button>
          <input value="${esc(p.title)}" maxlength="30" aria-label="标题">
          <span class="faint">${esc((src.find(x => key(x.at) === k) || {}).where || '')}</span>
          <button type="button" class="quiet small" data-unpick>不要了</button></div>`).join('')}` : '';
        $$('.rapick', d).forEach(row => {
          const p = pick.get(row.dataset.pk);
          const sp = $('.raspr', row);
          if (p.image && p.image.characterName) mountSprite(sp, p.image.characterName, p.image.characterIndex, p.image.direction || 2, 32, false); else sp.textContent = '选小人';
          $('input', row).oninput = e => { p.title = e.target.value; };
          $('[data-unpick]', row).onclick = () => { pick.delete(row.dataset.pk); drawList(); drawPicked(); };
          sp.onclick = () => {
            // 选小人要借用同一个弹窗：先记下已经选的，选完再打开回来
            RA_OPTS = { unlock: $('input[name=raUn]:checked', d).value, picOnly: $('#raPic', d).checked };
            done({ again: true, choose: row.dataset.pk });
          };
        });
      };
      $('#raQ', d).oninput = e => { q = e.target.value.trim().toLowerCase(); drawList(); };
      $('#raCg', d).onchange = e => { onlyCg = e.target.checked; drawList(); };
      $('#raIn', d).onchange = e => { hideIn = e.target.checked; drawList(); };
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        if (!pick.size) { $('#raErr', d).innerHTML = '<div class="err">先在上面勾要加的剧情</div>'; return; }
        const unlock = $('input[name=raUn]:checked', d).value, picOnly = $('#raPic', d).checked;
        try {
          const x = await api('gallery/add', { items: [...pick.values()].map(p => ({ source: p.at, title: p.title.trim() || '回想', image: p.image || {}, unlock, picOnly })) });
          done({ added: x });
        } catch (e) { $('#raErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      drawList(); drawPicked();
      $('#raQ', d).focus();
    });
  if (r && r.again) {
    // 换小人，然后带着已经选的回到这个弹窗
    const p = pick.get(r.choose);
    const im = p.image || {};
    const s = await spritePicker({ name: im.characterName, index: im.characterIndex, dir: im.direction, pattern: im.pattern }, { title: '回想房里显示的小人' });
    if (s) p.image = s.name ? { characterName: s.name, characterIndex: s.index, direction: s.dir, pattern: s.pattern } : null;
    RA_KEEP = pick;
    return recallAddDialog([...pick.values()].map(x => x.at));
  }
  if (r && r.added) {
    const c = r.added.created;
    toast(`已加进回想房：${c.map(x => '「' + x.title + '」').join('')}${c.some(x => x.switch) ? '，看过原剧情后解锁' : ''}`);
    if (location.hash !== '#/gallery') location.hash = '#/gallery'; else render();
  }
}
let RA_KEEP = null, RA_OPTS = null;
