'use strict';

function mountRelationships(details, actor, name) {
  const container = $('[data-relationships]', details);
  let loading = false, loaded = false;
  details.ontoggle = async () => {
    if (!details.open || loaded || loading) return;
    loading = true;
    container.textContent = '正在读取人物关系…';
    try {
      const result = await api('person/relationships?actor=' + actor);
      if (details.isConnected) renderRelationships(container, actor, name, result);
      loaded = true;
    } catch (error) {
      container.textContent = error.message + '。重新展开可重试。';
    } finally { loading = false; }
  };
}

function renderRelationships(container, actor, name, { profile, people, incoming, variables, canWrite }) {
  const variableOptions = selected => valueOptions([{ id: -1, name: '保存时新建好感变量' }, ...variables.map(row => ({ ...row, name: `${row.id} · ${row.name || '未命名'}` }))], selected, '未绑定');
  container.innerHTML = `<form><fieldset class="edit-fields" ${canWrite ? '' : 'disabled'}>
    <div class="fgrid">
      <label for="relationRole">身份</label><input id="relationRole" maxlength="80" value="${esc(profile.role)}" placeholder="例：杂货商、守卫">
      <label for="relationNotes">背景与性格</label><textarea id="relationNotes" rows="3" maxlength="2000">${esc(profile.notes)}</textarea>
      <label for="relationVar">主角好感变量</label><select id="relationVar">${variableOptions(profile.variable)}</select>
    </div>
    <div class="edit-section"><h3>好感阶段</h3><button type="button" class="small" data-add="stage">添加阶段</button></div>
    <div class="edit-list" data-stage-list></div>
    <p class="dim" data-affinity-hint></p>
    <div class="edit-section"><h3>与其他人物的关系</h3><button type="button" class="small" data-add="link" ${people.length ? '' : 'disabled'}>添加关系</button></div>
    <div class="edit-list" data-link-list></div>
    ${people.length ? '' : '<p class="dim">新建另一位人物后可添加关系。</p>'}
    ${canWrite ? '<div class="edit-section"><button class="primary small" type="submit">保存人物关系</button></div>' : ''}
  </fieldset><div role="alert" data-error></div></form>
  ${incoming.length ? `<div class="edit-section"><h3>其他人物对 TA 的关系</h3></div><div class="rows">${incoming.map(link => `<a class="rowlink" href="#/people/a${link.actor}"><span>${esc(link.name)} · ${esc(link.type)}</span><span class="dim">${esc(link.note)}</span></a>`).join('')}</div>` : ''}`;
  const form = $('form', container), fields = $('fieldset', form), variable = $('#relationVar', form);
  const stageList = $('[data-stage-list]', form), linkList = $('[data-link-list]', form);
  const error = $('[data-error]', form), hint = $('[data-affinity-hint]', form);
  const stageRow = ({ name = '', min = '' } = {}) => `<div class="edit-line edit-line-three"><input data-name required maxlength="40" aria-label="阶段名称" placeholder="阶段名称" value="${esc(name)}"><input data-min required type="number" min="-999999" max="999999" aria-label="最低好感度" placeholder="最低好感度" value="${esc(min)}"><button type="button" class="small quiet" data-remove>移除</button></div>`;
  const linkRow = ({ target = 0, type = '', note = '' } = {}) => `<div class="edit-line"><select data-target aria-label="关联人物">${valueOptions(people, target, '选择人物')}</select><input data-type required maxlength="40" aria-label="关系类型" placeholder="关系类型，如师徒" value="${esc(type)}"><input data-note maxlength="240" aria-label="关系说明" placeholder="关系说明（可选）" value="${esc(note)}"><button type="button" class="small quiet" data-remove>移除</button></div>`;
  function updateHint() {
    const id = Number(variable.value), first = $('[data-min]', stageList);
    if (id <= 0) { hint.textContent = '绑定好感变量后，可在事件中增减好感，按门槛触发不同对话。'; return; }
    const min = first?.value || '10';
    hint.innerHTML = `台词中可写 <code>#变量 ${id} +1</code>，用 <code>#如果 变量 ${id} &gt;= ${esc(min)}</code> 判断。<a href="#/names/var/${id}">查看变量</a>`;
  }
  stageList.innerHTML = profile.stages.map(stageRow).join('');
  linkList.innerHTML = profile.links.map(linkRow).join('');
  updateHint();
  if (!canWrite) return;
  form.oninput = () => { S.dirty = true; updateHint(); };
  form.onclick = event => {
    const button = event.target.closest('button');
    if (button?.dataset.add === 'stage') stageList.insertAdjacentHTML('beforeend', stageRow());
    else if (button?.dataset.add === 'link') linkList.insertAdjacentHTML('beforeend', linkRow());
    else if (button?.hasAttribute('data-remove')) button.closest('.edit-line').remove();
    else return;
    S.dirty = true;
    updateHint();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const body = { actor, role: $('#relationRole', form).value, notes: $('#relationNotes', form).value, variable: Number(variable.value),
      stages: $$('.edit-line', stageList).map(row => ({ name: $('[data-name]', row).value, min: Number($('[data-min]', row).value) })),
      links: $$('.edit-line', linkList).map(row => ({ target: Number($('[data-target]', row).value), type: $('[data-type]', row).value, note: $('[data-note]', row).value })) };
    fields.disabled = true;
    error.textContent = '';
    try {
      const result = await api('person/relationships', body);
      if (body.variable === -1) {
        if (!variables.some(row => row.id === result.variable)) variables.push({ id: result.variable, name: `${name}·好感度` });
        variable.innerHTML = variableOptions(result.variable);
        S.lookups = {};
      }
      S.dirty = false;
      updateHint();
      toast('已保存人物关系');
    } catch (e) { error.textContent = e.message; }
    finally { fields.disabled = false; }
  };
}
