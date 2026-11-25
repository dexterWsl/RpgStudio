'use strict';
async function viewQuests(main, selected) {
  const r = await api('quests');
  if (route().name !== 'quests' || route().a !== selected) return;
  const quest = r.quests.find(q => q.id === Number(selected));
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>任务</h1><span class="sp"></span>${r.canWrite ? '<button type="button" class="small primary" id="questNew">新建任务</button>' : ''}</div>
    <p class="dim">任务进度随存档保存。可在不同地图、事件或场景里接取、推进和交付同一个任务。</p>
    <div class="card rows">${r.quests.map(q => `<a class="rowlink ${q === quest ? 'on' : ''}" href="#/quests/${q.id}"><span>${esc(q.name)}</span><span class="r">${q.steps.length} 步 · ${q.refs.length} 处调用</span></a>`).join('') || '<div class="empty">还没有任务</div>'}</div>
    ${quest ? questDetails(quest, r) : ''}
    <details class="helpbox"><summary>写法</summary><table>${gameplayGuideRows('quest')}</table></details>
  </div>`;
  const edit = async q => {
    try { const saved = await questEditor(q, r); if (saved) { S.lookups = {}; go('#/quests/' + saved.id); } }
    catch (error) { toast(error.message, true); }
  };
  if ($('#questNew', main)) $('#questNew', main).onclick = () => edit(null);
  if ($('#questEdit', main)) $('#questEdit', main).onclick = () => edit(quest);
}

function questDetails(quest, options) {
  const nameOf = (rows, id) => rows.find(r => r.id === id)?.name || '编号 ' + id;
  return `<section class="card quest-detail">
    <div class="titlebar"><h2>${esc(quest.name)}</h2><span class="sp"></span>${options.canWrite ? '<button type="button" class="small" id="questEdit">编辑任务</button>' : ''}</div>
    ${quest.description ? `<p class="quest-desc">${esc(quest.description)}</p>` : ''}
    <ol>${quest.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="meta">${quest.acceptSwitch ? `<span>接取要求 ${esc(nameOf(options.switches, quest.acceptSwitch))}</span>` : ''}
      ${quest.finishSwitch ? `<span>完成要求 ${esc(nameOf(options.switches, quest.finishSwitch))}</span>` : ''}
      ${quest.reward ? `<a href="#/settlements/${quest.reward}">奖励组 ${esc(nameOf(options.settlements, quest.reward))}</a>` : ''}</div>
    <div class="quest-lines"><code>#任务 ${quest.id} 接取</code>${quest.steps.slice(1).map((_, i) => `<code>#任务 ${quest.id} 推进 ${i + 2}</code>`).join('')}<code>#任务 ${quest.id} 完成</code></div>
    ${quest.refs.length ? `<details><summary>使用位置（${quest.refs.length}）</summary>${quest.refs.map(ref => `<a class="refitem" href="${hrefOf(ref.at)}"><div class="w">${esc(ref.where)}</div><div class="t">${esc(ref.text)}</div></a>`).join('')}</details>` : ''}
  </section>`;
}

function questEditor(quest, options) {
  return openDialog(`<header><h3>${quest ? '编辑任务' : '新建任务'}</h3><button class="quiet small" type="button" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid">
      <label for="questName">名称</label><input id="questName" maxlength="40" value="${esc(quest?.name)}">
      <label for="questDescription">任务简介</label><textarea id="questDescription" rows="3" maxlength="500">${esc(quest?.description)}</textarea>
      <label for="questAccept">接取条件</label><select id="questAccept">${valueOptions(options.switches, quest?.acceptSwitch || 0, '直接接取')}</select>
      <label for="questFinish">完成条件</label><select id="questFinish">${valueOptions(options.switches, quest?.finishSwitch || 0, '到最后一步即可交付')}</select>
      <label for="questReward">完成奖励</label><select id="questReward">${valueOptions(options.settlements, quest?.reward || 0, '无奖励组')}</select>
    </div><div><strong>任务步骤</strong><div class="dim">已保存的步骤编号用于事件和存档。可改步骤文字，或在末尾新增步骤。</div></div>
      <ol class="quest-steps"></ol><button class="small" type="button" data-add-step>添加一步</button><div role="alert" data-error></div>
    </div><footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-ok>保存任务</button></footer>`, (d, done) => {
    const steps = $('.quest-steps', d), add = $('[data-add-step]', d), save = $('[data-ok]', d);
    const updateAdd = () => { add.disabled = steps.children.length >= 30; };
    const addStep = (value, saved) => {
      const row = document.createElement('li');
      row.innerHTML = `<div class="folder-input"><input maxlength="100" value="${esc(value)}" placeholder="例如 去集市找铁匠" aria-label="目标">${saved ? '' : '<button class="small" type="button" data-remove>移除</button>'}</div>`;
      steps.append(row);
      const remove = $('[data-remove]', row);
      if (remove) remove.onclick = () => { if (steps.children.length > 1) { row.remove(); updateAdd(); } };
      return $('input', row);
    };
    for (const value of quest?.steps || ['']) addStep(value, !!quest);
    updateAdd();
    add.onclick = () => { addStep('', false).focus(); updateAdd(); };
    $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
    save.onclick = async () => {
      save.disabled = true;
      const error = $('[data-error]', d);
      error.textContent = '';
      try {
        const { quest: saved } = await api('quest/save', { id: quest?.id || 0, name: $('#questName', d).value, description: $('#questDescription', d).value,
          acceptSwitch: Number($('#questAccept', d).value), finishSwitch: Number($('#questFinish', d).value), reward: Number($('#questReward', d).value), steps: $$('input', steps).map(input => input.value) });
        toast('已保存任务'); done(saved);
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
  });
}

async function questCommandDialog(parent) {
  const { quests } = await api('quests');
  if (parent && !parent.open) return null;
  if (!quests.length) { toast('先在「任务」菜单新建一个任务', true); return null; }
  return openDialog(`<header><h3>插入任务指令</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid">
      <label for="questCommandId">任务</label><select id="questCommandId">${valueOptions(quests)}</select>
      <label for="questCommandAction">操作</label><select id="questCommandAction"></select>
    </div></div><footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-ok>插入</button></footer>`, (d, done) => {
    const selected = $('#questCommandId', d), action = $('#questCommandAction', d);
    const update = () => {
      const quest = quests.find(q => q.id === Number(selected.value));
      const steps = quest.steps.slice(1).map((step, i) => `<option value="推进 ${i + 2}">${esc('推进到第 ' + (i + 2) + ' 步 · ' + step)}</option>`);
      action.innerHTML = '<option>接取</option>' + steps.join('') + '<option>完成</option><option>失败</option>';
    };
    selected.onchange = update;
    $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
    $('[data-ok]', d).onclick = () => done('#任务 ' + selected.value + ' ' + action.value);
    update();
  });
}
