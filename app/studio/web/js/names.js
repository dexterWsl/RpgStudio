'use strict';
// 开关 / 变量：列表、改名、新建、按人物筛
// ---------- 开关 / 变量 ----------
async function viewNames(main, kind, focus) {
  main.innerHTML = '<div class="loading">正在统计…</div>';
  const [r, pl] = await Promise.all([api('names?kind=' + kind), api('people').catch(() => ({ people: [] }))]);
  const label = kind === 'var' ? '变量' : '开关';
  const people = pl.people.filter(p => !p.speakerOnly || p.lines >= 3);
  let filter = 'all', q = '', who = S.namesWho || '', rel = null;   // rel = 选中人物的相关数值 Map(id → 行)
  const FLAG = { neverSet: '只判断没人改', neverChecked: '只改没人判断', unusedNamed: '有名字但没用到' };
  main.innerHTML = `<div class="page" style="max-width:1000px">
    <div class="titlebar"><h1>${label}</h1><span class="dim">共 ${r.total} 个编号，下面列出有名字或被用到的 ${r.rows.length} 个</span><span class="sp"></span><button class="primary small" id="newName">新建${label}</button></div>
    <div class="filters">
      <input type="search" id="nq" placeholder="按编号或名字筛选">
      <div class="seg" id="nf"><button data-f="all" class="on">全部</button><button data-f="neverSet">只判断没人改</button><button data-f="neverChecked">只改没人判断</button><button data-f="unused">没用到</button></div>
      ${people.length ? `<label class="nwho"><span class="dim">人物</span><select id="nwho"><option value="">全部人物</option>${people.map(p => `<option value="${esc(p.key)}" ${who === p.key ? 'selected' : ''}>${esc(p.name)}${p.speakerOnly ? '（只说话）' : ''}</option>`).join('')}</select></label>` : ''}
    </div>
    <div id="nwhoBar"></div>
    <div class="card" style="overflow:auto"><table class="ntable"><thead><tr><th style="width:56px">#</th><th>名字</th><th class="c">判断</th><th class="c">设置</th><th class="c hide-narrow">脚本</th><th class="hide-narrow" id="npcol">人物</th><th class="hide-narrow">提示</th></tr></thead><tbody id="ntb"></tbody></table></div>
    <p class="dim" style="margin-top:8px;font-size:12.5px">名字直接改，回车或点别处就保存。点一行看它在哪里被用到。「人物」一列是按台词和出场自动算的：用到这个${label}的地方主要是谁在说话 / 出场；在人物页里可以手动关联。</p>
  </div>`;
  const tb = $('#ntb');
  const whoCell = x => {
    if (rel) { const e = rel.get(x.id); return e ? `<span class="why${e.linked ? ' linked' : ''}">${esc(e.why.join(' · '))}</span>` : ''; }
    if (x.shared) return `<span class="faint" title="${x.shared} 个人的戏里都用到">多人共用</span>`;
    return x.people.map(p => `<a class="pchip" href="#/people/${enc(p.key)}">${esc(p.name)}</a>`).join(' ');
  };
  const draw = () => {
    let rows = r.rows.filter(x => (!q || (x.id + ' ' + x.name + ' ' + x.hint + ' ' + x.people.map(p => p.name).join(' ')).toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'unused' ? x.flags.includes('unusedNamed') : x.flags.includes(filter))));
    if (rel) rows = rows.filter(x => rel.has(x.id)).sort((a, b) => rel.get(b.id).score - rel.get(a.id).score);
    $('#npcol').textContent = rel ? '为什么相关' : '人物';
    tb.innerHTML = rows.map(x => `<tr data-id="${x.id}"><td class="num faint">${x.id}</td>
      <td><input value="${esc(x.name)}" data-orig="${esc(x.name)}" aria-label="${label} ${x.id} 的名字" maxlength="40"></td>
      <td class="c">${x.check || ''}</td><td class="c">${x.set || ''}</td><td class="c hide-narrow">${x.script || ''}</td>
      <td class="hide-narrow npeople">${whoCell(x)}</td>
      <td class="hide-narrow">${x.hint ? `<span class="hint">${esc(x.hint)}</span> ` : ''}${x.flags.map(f => `<span class="flag ${f}">${FLAG[f]}</span>`).join(' ')}</td></tr>`).join('')
      || `<tr><td colspan="7" class="dim" style="padding:20px;text-align:center">${rel ? '这个人的戏里没有用到' + label + '，可以点上面的「新建」给他加一个' : '没有符合的' + label}</td></tr>`;
    $$('tr[data-id]', tb).forEach(tr => {
      tr.onclick = e => { if (e.target.tagName === 'INPUT' || e.target.closest('a')) return; $$('tr.on', tb).forEach(t => t.classList.remove('on')); tr.classList.add('on'); showRefs(kind, tr.dataset.id); };
      const inp = $('input', tr);
      const commit = async () => {
        if (inp.value === inp.dataset.orig) return;
        try { await api('name', { kind, id: Number(tr.dataset.id), name: inp.value }); inp.dataset.orig = inp.value; const x = r.rows.find(y => y.id === Number(tr.dataset.id)); if (x) x.name = inp.value; toast(`已改名：${label} ${tr.dataset.id}`); }
        catch (e) { toast(e.message, true); inp.value = inp.dataset.orig; }
      };
      inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = inp.dataset.orig; inp.blur(); } };
      inp.onblur = commit;
      inp.onfocus = () => { $$('tr.on', tb).forEach(t => t.classList.remove('on')); tr.classList.add('on'); showRefs(kind, tr.dataset.id); };
    });
  };
  $('#nq').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#nf button').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#nf button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  const pickWho = async key => {
    who = key; S.namesWho = key; rel = null;
    const p = people.find(x => x.key === key);
    $('#newName').textContent = p ? `给${p.name}新建${label}` : `新建${label}`;
    if (!p) { $('#nwhoBar').innerHTML = ''; draw(); return; }
    $('#nwhoBar').innerHTML = '<div class="dim" style="margin:0 0 8px;font-size:13px">正在算…</div>';
    try {
      const v = await api('person?key=' + enc(key));
      const list = kind === 'var' ? v.related.vars : v.related.switches;
      rel = new Map(list.map(x => [x.id, x]));
      // 相关但列表里没有的（没名字也没被用到，只是手动关联了）补一行
      for (const x of list) if (!r.rows.some(y => y.id === x.id)) r.rows.push({ id: x.id, name: x.name || '', hint: '', check: 0, set: 0, script: 0, total: 0, flags: [], people: [], shared: 0 });
      $('#nwhoBar').innerHTML = `<div class="nwhobar">${esc(p.name)}的戏里用到的${label}，按相关程度排：先是手动关联的、名字里带${esc(p.name)}的，再是在${esc(p.name)}说话 / 出场的页里被判断、被改的（越是只在这个人的戏里出现越靠前）。<a href="#/people/${enc(key)}">去人物页手动关联</a></div>`;
    } catch (e) { $('#nwhoBar').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    draw();
  };
  if ($('#nwho')) $('#nwho').onchange = e => pickWho(e.target.value);
  $('#newName').onclick = async () => {
    const p = who && people.find(x => x.key === who);
    if (p) {
      const lab = await promptDialog(`给${p.name}新建${label}`, `名字会存成「${p.name}·你写的名字」${p.actorId ? '，并且手动关联到' + p.name : ''}`, '');
      if (!lab) return;
      try { const x = await api('person/newvar', { key: p.key, kind, label: lab }); toast(`已新建${label} ${x.id}「${x.name}」`); S.lookups = {}; S.project = await api('project'); render(); } catch (e) { toast(e.message, true); }
      return;
    }
    const name = await promptDialog('新建' + label, `名字（会用第 ${r.free} 号${r.free > r.total ? '，往后加一个' : '，这个编号现在空着'}）`, '');
    if (!name) return;
    try { const x = await api('name', { kind, id: 'new', name }); toast(`已新建${label} ${x.id}「${x.name}」`); S.lookups = {}; S.project = await api('project'); render(); } catch (e) { toast(e.message, true); }
  };
  if (who && people.some(p => p.key === who)) await pickWho(who); else { who = ''; draw(); }
  if (focus) { const tr = $(`tr[data-id="${focus}"]`, tb); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.click(); } }
}
