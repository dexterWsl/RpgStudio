'use strict';
// 开关 / 变量：列表、改名、新建、按人物筛

function passiveFields(rule) {
  return `<div class="passive-fields" data-passive>
    <label>累计方式 <select data-passive-type><option value="">普通变量</option><option value="steps" ${rule?.type === 'steps' ? 'selected' : ''}>移动时累计</option><option value="time" ${rule?.type === 'time' ? 'selected' : ''}>按游戏时间累计</option></select></label>
    <div class="passive-values" data-passive-values hidden>
      <label>间隔 <input data-passive-every type="number" min="1" step="1" value="${esc(rule?.every ?? 1)}"> <span data-passive-unit></span></label>
      <label>每次增加 <input data-passive-amount type="number" min="1" step="1" value="${esc(rule?.amount ?? 1)}"></label>
      <p class="dim" data-passive-note></p>
    </div></div>`;
}

function bindPassiveFields(root, enabled = () => true) {
  const fields = $('[data-passive]', root);
  if (!fields) return null;
  const type = $('[data-passive-type]', fields);
  const sync = () => {
    fields.hidden = !enabled();
    $('[data-passive-values]', fields).hidden = !type.value;
    $('[data-passive-unit]', fields).textContent = type.value === 'steps' ? '步' : '秒';
    $('[data-passive-note]', fields).textContent = type.value === 'steps' ? '按主角正常走过的步数累计。' : '在地图和战斗中计时，打开菜单或切到后台时暂停。';
  };
  type.onchange = sync;
  sync();
  return { sync, value: () => type.value ? { type: type.value, every: $('[data-passive-every]', fields).valueAsNumber, amount: $('[data-passive-amount]', fields).valueAsNumber } : null };
}

function variableDialog({ row, person, free }) {
  const heading = row ? '自动累计 · ' + (row.name || '变量 ' + row.id) : person ? '给' + person.name + '新建变量' : '新建变量';
  return openDialog(`<header><h3>${esc(heading)}</h3></header><div class="dbody">
    ${row ? '' : `<div class="fgrid"><label for="variableName">名字</label><input id="variableName" maxlength="${person ? 30 : 40}" placeholder="例如 步数或游戏时间" autocomplete="off"></div>`}
    ${row || person ? '' : `<p class="dim">将使用编号 ${free}。</p>`}${passiveFields(row?.passive)}<div role="alert"></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-ok>${row ? '保存' : '新建变量'}</button></footer>`, (d, done) => {
    const fields = bindPassiveFields(d), input = $('#variableName', d), button = $('[data-ok]', d), gen = d._gen;
    $('[data-x]', d).onclick = () => done();
    button.onclick = async () => {
      if (button.disabled) return;
      const passive = fields.value(), name = input?.value.trim();
      if (input && !name) { input.focus(); return; }
      button.disabled = true;
      try {
        const result = person ? await api('person/newvar', { key: person.key, kind: 'var', label: name, passive, view: false })
          : await api('name', { kind: 'var', id: row?.id || 'new', name, passive });
        done(result);
      } catch (error) {
        if (d.open && d._gen === gen) $('[role="alert"]', d).innerHTML = `<div class="err">${esc(error.message)}</div>`;
      } finally { button.disabled = false; }
    };
    if (input) { input.focus(); input.onkeydown = e => { if (e.key === 'Enter') button.click(); }; }
  });
}

async function variableGroupDialog(group, groups) {
  const switches = group ? [] : (await lookup('switch')).filter(row => !groups.some(g => g.id === row.id));
  return openDialog(`<header><h3>${group ? '编辑变量组' : '新建变量组'}</h3></header><div class="dbody">
    <div class="fgrid">
      <label for="groupOutput">布尔结果</label>${group ? `<strong id="groupOutput">${esc(group.label)}</strong>` : `<select id="groupOutput"><option value="new">新建结果开关</option>${options(switches)}</select>`}
      ${group ? '' : '<label for="groupName" data-group-name>开关名字</label><input id="groupName" data-group-name maxlength="40" placeholder="例如 奖励可领取">'}
      <label for="groupMode">成立方式</label><select id="groupMode"><option value="all">全部满足</option><option value="any" ${group?.mode === 'any' ? 'selected' : ''}>任一满足</option></select>
    </div>
    <p class="dim">满足时结果为 true（开），否则为 false（关）。结果开关由这些条件自动更新。</p>
    <label for="groupConditions">变量条件（每行一条）</label><textarea id="groupConditions" rows="5" spellcheck="false" placeholder="变量 好感度 &gt;= 3&#10;变量 任务进度 = 2">${esc(group?.text || '')}</textarea>
    <div role="alert"></div></div><footer>${group ? '<button type="button" class="danger" data-remove>删除变量组</button>' : ''}
    <span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-ok>保存变量组</button></footer>`, (d, done) => {
    const output = $('#groupOutput', d), name = $('#groupName', d), save = $('[data-ok]', d), remove = $('[data-remove]', d), gen = d._gen;
    if (name) {
      output.onchange = () => $$('[data-group-name]', d).forEach(el => el.hidden = output.value !== 'new');
      name.focus();
    }
    $('[data-x]', d).onclick = () => done();
    const submit = async deleting => {
      if (save.disabled) return;
      if (deleting && !confirm('删除变量组「' + group.label + '」？')) return;
      save.disabled = true;
      if (remove) remove.disabled = true;
      try {
        const result = await api('variable/group', { id: group?.id, switch: output.value, name: name?.value,
          mode: $('#groupMode', d).value, text: $('#groupConditions', d).value, remove: deleting });
        done({ ...result, removed: deleting });
      } catch (error) {
        if (d.open && d._gen === gen) $('[role="alert"]', d).innerHTML = `<div class="err">${esc(error.message)}</div>`;
      } finally { save.disabled = false; if (remove) remove.disabled = false; }
    };
    save.onclick = () => submit(false);
    if (remove) remove.onclick = () => submit(true);
  });
}

// ---------- 开关 / 变量 ----------
async function viewNames(main, kind, focus) {
  main.innerHTML = '<div class="loading">正在统计…</div>';
  const [r, pl] = await Promise.all([api('names?kind=' + kind), api('people').catch(() => ({ people: [] }))]);
  const variable = kind === 'var';
  const supportsRules = variable && Array.isArray(r.groups);
  const groups = supportsRules ? r.groups : [];
  const canWrite = r.canWrite !== false;
  const label = variable ? '变量' : '开关';
  const people = pl.people.filter(p => !p.speakerOnly || p.lines >= 3);
  let filter = 'all', q = '', who = S.namesWho || '', rel = null;   // rel = 选中人物的相关数值 Map(id → 行)
  const FLAG = { neverSet: '只判断没人改', neverChecked: '只改没人判断', unusedNamed: '有名字但没用到' };
  main.innerHTML = `<div class="page" style="max-width:1000px">
    <div class="titlebar"><h1>${label}</h1><span class="dim">共 ${r.total} 个编号，下面列出有名字或被用到的 ${r.rows.length} 个</span><span class="sp"></span>${canWrite ? `<button class="primary small" id="newName">新建${label}</button>` : ''}</div>
    ${supportsRules ? `<section class="card variable-groups">
      <div class="settlement-heading"><h2>变量组</h2><span class="sp"></span>${canWrite ? '<button type="button" class="small" id="newVariableGroup">新建变量组</button>' : ''}</div>
      ${groups.map(g => `<div class="variable-group" data-variable-group="${g.id}"><div class="settlement-heading"><strong>${esc(g.label)}</strong>
        <span class="dim">${g.mode === 'any' ? '任一满足' : '全部满足'}</span><span class="sp"></span>${canWrite ? '<button type="button" class="small quiet" data-group-edit>编辑</button>' : ''}</div>
        <pre class="settlement-script">${esc(g.text)}</pre></div>`).join('') || '<p class="dim">让多条变量条件共同决定一个开关。</p>'}
    </section>` : variable ? '<p class="dim">当前运行的服务版本较旧，重启本地工具后可以使用变量组和自动累计。</p>' : ''}
    <div class="filters">
      <input type="search" id="nq" placeholder="按编号或名字筛选">
      <div class="seg" id="nf"><button data-f="all" class="on">全部</button><button data-f="neverSet">只判断没人改</button><button data-f="neverChecked">只改没人判断</button><button data-f="unused">没用到</button></div>
      ${people.length ? `<label class="nwho"><span class="dim">人物</span><select id="nwho"><option value="">全部人物</option>${people.map(p => `<option value="${esc(p.key)}" ${who === p.key ? 'selected' : ''}>${esc(p.name)}${p.speakerOnly ? '（只说话）' : ''}</option>`).join('')}</select></label>` : ''}
    </div>
    <div id="nwhoBar"></div>
    <div class="card" style="overflow:auto"><table class="ntable"><thead><tr><th style="width:56px">#</th><th>名字</th><th class="c">判断</th><th class="c">设置</th><th class="c hide-narrow">脚本</th><th class="hide-narrow" id="npcol">人物</th><th class="hide-narrow">提示</th><th scope="col">操作</th></tr></thead><tbody id="ntb"></tbody></table></div>
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
      <td><input value="${esc(x.name)}" data-orig="${esc(x.name)}" aria-label="${label} ${x.id} 的名字" maxlength="40" ${canWrite ? '' : 'readonly'}>${x.passiveText ? `<div class="dim passive-summary">${esc(x.passiveText)}</div>` : ''}</td>
      <td class="c">${x.check || ''}</td><td class="c">${x.set || ''}</td><td class="c hide-narrow">${x.script || ''}</td>
      <td class="hide-narrow npeople">${whoCell(x)}</td>
      <td class="hide-narrow">${x.hint ? `<span class="hint">${esc(x.hint)}</span> ` : ''}${x.flags.map(f => `<span class="flag ${f}">${FLAG[f]}</span>`).join(' ')}</td>
      <td><div class="variable-actions">${canWrite && supportsRules ? '<button type="button" class="small quiet" data-passive-edit>自动累计</button>' : ''}${impactButton(kind, x.id)}</div></td></tr>`).join('')
      || `<tr><td colspan="8" class="dim" style="padding:20px;text-align:center">${rel ? '这个人的戏里没有用到' + label + '，可以点上面的「新建」给他加一个' : '没有符合的' + label}</td></tr>`;
    $$('tr[data-id]', tb).forEach(tr => {
      tr.onclick = e => { if (e.target.closest('input, a, button')) return; $$('tr.on', tb).forEach(t => t.classList.remove('on')); tr.classList.add('on'); showRefs(kind, tr.dataset.id); };
      const inp = $('input', tr);
      const commit = async () => {
        if (inp.value === inp.dataset.orig) return;
        try { await api('name', { kind, id: Number(tr.dataset.id), name: inp.value }); inp.dataset.orig = inp.value; const x = r.rows.find(y => y.id === Number(tr.dataset.id)); if (x) x.name = inp.value; toast(`已改名：${label} ${tr.dataset.id}`); }
        catch (e) { toast(e.message, true); inp.value = inp.dataset.orig; }
      };
      inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = inp.dataset.orig; inp.blur(); } };
      inp.onblur = commit;
      inp.onfocus = () => { $$('tr.on', tb).forEach(t => t.classList.remove('on')); tr.classList.add('on'); showRefs(kind, tr.dataset.id); };
      const edit = $('[data-passive-edit]', tr);
      if (edit) edit.onclick = async () => {
        const row = r.rows.find(x => x.id === Number(tr.dataset.id));
        if (await variableDialog({ row })) { toast('已保存变量累计方式'); await render(); }
      };
    });
  };
  $('#nq').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#nf button').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#nf button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  const pickWho = async key => {
    who = key; S.namesWho = key; rel = null;
    const p = people.find(x => x.key === key);
    if ($('#newName')) $('#newName').textContent = p ? `给${p.name}新建${label}` : `新建${label}`;
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
  const newName = $('#newName', main);
  if (newName) newName.onclick = async () => {
    const p = who && people.find(x => x.key === who);
    if (supportsRules) {
      const result = await variableDialog({ person: p || null, free: r.free });
      if (result) { toast(`已新建变量 ${result.id}「${result.name}」`); S.lookups = {}; S.project = await api('project'); go('#/names/var/' + result.id); }
      return;
    }
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
  const editGroup = async group => {
    try {
      const result = await variableGroupDialog(group, groups);
      if (!result) return;
      S.lookups = {};
      S.project = await api('project');
      toast(result.removed ? '已删除变量组' : '已保存变量组');
      go('#/names/var' + (result.removed ? '' : '/group-' + result.id));
    } catch (error) { toast(error.message, true); }
  };
  const newGroup = $('#newVariableGroup', main);
  if (newGroup) newGroup.onclick = () => editGroup(null);
  for (const box of $$('[data-variable-group]', main)) {
    const edit = $('[data-group-edit]', box);
    if (edit) edit.onclick = () => editGroup(groups.find(g => g.id === Number(box.dataset.variableGroup)));
    if (focus === 'group-' + box.dataset.variableGroup) { box.classList.add('settlement-selected'); box.scrollIntoView({ block: 'center' }); }
  }
  if (who && people.some(p => p.key === who)) await pickWho(who); else { who = ''; draw(); }
  if (/^\d+$/.test(focus || '')) { const tr = $(`tr[data-id="${focus}"]`, tb); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.click(); } }
}
