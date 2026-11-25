'use strict';

async function viewEnemies(main) {
  main.innerHTML = '<div class="loading">正在读取敌人…</div>';
  const { rows, canWrite } = await api('enemies');
  if (route().name !== 'people' || route().a !== 'enemies') return;
  main.innerHTML = `<div class="page"><div class="crumbs"><a href="#/people">人物</a><span>›</span><span>敌人管理</span></div>
    <div class="titlebar"><h1>敌人管理</h1><span class="sp"></span>${canWrite ? '<button class="primary small" data-new-enemy>新建敌人</button>' : ''}</div>
    <div class="filters"><input type="search" placeholder="筛选名称或编号" aria-label="筛选敌人"></div><div class="card rows" data-enemy-list></div></div>`;
  const filter = $('input[type=search]', main), list = $('[data-enemy-list]', main);
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    list.innerHTML = rows.filter(r => !q || String(r.name || '').toLowerCase().includes(q) || String(r.id) === q)
      .map(r => `<button type="button" class="catalog-row" data-enemy="${r.id}"><span class="num dim">${r.id}</span><span>${esc(r.name || '未命名')}</span><span class="dim">生命 ${r.hp}</span></button>`).join('') || '<div class="empty">没有符合的敌人</div>';
  };
  const edit = async id => {
    try { if (await enemyDialog(id)) { S.lookups = {}; toast('已保存敌人'); render(); } }
    catch (e) { toast(e.message, true); }
  };
  filter.oninput = draw;
  list.onclick = e => { const button = e.target.closest('[data-enemy]'); if (button) edit(Number(button.dataset.enemy)); };
  if (canWrite) $('[data-new-enemy]', main).onclick = () => edit(0);
  draw();
}

async function enemyDialog(id) {
  const r = await api('enemy/entry?id=' + id), enemy = r.enemy;
  const titles = ['无', '物品', '武器', '防具'];
  const graphics = [...new Set(['', ...r.graphics, enemy.battlerName || ''])];
  const graphicOptions = graphics.map(name => `<option value="${esc(name)}" ${name === (enemy.battlerName || '') ? 'selected' : ''}>${esc(name || '无')}</option>`).join('');
  const actions = enemy.actions || [], simple = actions.length === 0 || (actions.length === 1 && actions[0].conditionType === 0);
  const number = (key, value, label, min = 0, max = 9999999) => `<input id="${key}" type="number" required min="${min}" max="${max}" value="${Number(value) || 0}" aria-label="${label}">`;
  const stat = i => `<label for="enemyStat${i}">${r.stats[i]}</label>${number('enemyStat' + i, enemy.params?.[i], r.stats[i], i === 0 ? 1 : 0, 999999)}`;
  return openDialog(`<header><h3>${id ? '编辑敌人' : '新建敌人'}</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><form id="enemyForm"><fieldset class="edit-fields" ${r.canWrite ? '' : 'disabled'}><div class="fgrid">
      <label for="enemyName">名称</label><input id="enemyName" required maxlength="80" value="${esc(enemy.name)}">
      <label for="enemyGraphic">战斗图像</label><div class="edit-graphic"><select id="enemyGraphic">${graphicOptions}</select><img data-preview alt="敌人战斗图像" hidden></div>
      ${[0, 2, 3].map(stat).join('')}
      <label for="enemyExp">奖励经验</label>${number('enemyExp', enemy.exp, '奖励经验')}
      <label for="enemyGold">奖励金币</label>${number('enemyGold', enemy.gold, '奖励金币')}
    </div><details class="edit-more"><summary>高级设置</summary><div class="fgrid">
      ${[1, 4, 5, 6, 7].map(stat).join('')}
      <label for="enemyHue">色相</label>${number('enemyHue', enemy.battlerHue, '色相', 0, 360)}
      <label>${simple ? '普通行动技能' : '行动'}</label>${simple ? `<select id="enemySkill" aria-label="普通行动技能">${valueOptions(r.skills, actions[0]?.skillId || 0, '无')}</select>` : '<span class="dim">已有多项行动或行动条件，保存时保留原设定。</span>'}
      <label for="enemyNote">备注</label><textarea id="enemyNote" rows="2" maxlength="12000">${esc(enemy.note)}</textarea>
    </div>
    <div class="edit-section"><h3>战利品</h3><span class="dim">每个掉落的概率为 1 / 分母</span></div>
    <div class="edit-list">${Array.from({ length: 3 }, (_, i) => {
      const drop = enemy.dropItems?.[i] || { kind: 0, dataId: 1, denominator: 1 };
      return `<div class="edit-line edit-line-three" data-drop="${i}"><select aria-label="掉落类型" data-kind>${valueOptions(titles.map((name, id) => ({ id, name })), drop.kind)}</select>
        <select aria-label="掉落物" data-item></select>${number('enemyDrop' + i, drop.denominator, '掉落概率分母', 1, 999999)}</div>`;
    }).join('')}</div></details></fieldset></form>
    <p class="dim">${r.troops.length ? '所在敌群：' + r.troops.map(t => esc(`${t.id} · ${t.name}`)).join('、') + '。 ' : ''}${r.canWrite ? '保存时会准备一个可在地图上选择的单敌人敌群。' : ''}</p><div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>${r.canWrite ? '取消' : '关闭'}</button>${r.canWrite ? '<button type="submit" form="enemyForm" class="primary" data-save>保存敌人</button>' : ''}</footer>`, (d, done) => {
    const get = key => $('#' + key, d).value, fieldset = $('fieldset', d), form = $('form', d);
    const preview = $('[data-preview]', d), graphic = $('#enemyGraphic', d), hue = $('#enemyHue', d);
    const updateGraphic = () => {
      preview.hidden = !graphic.value;
      if (graphic.value) preview.src = img(r.folder, graphic.value);
      preview.style.filter = `hue-rotate(${Number(hue.value) || 0}deg)`;
    };
    graphic.onchange = hue.oninput = updateGraphic;
    updateGraphic();
    const rows = $$('[data-drop]', d);
    rows.forEach((row, i) => {
      const kind = $('[data-kind]', row), item = $('[data-item]', row), denominator = $('input', row);
      const update = selected => {
        item.innerHTML = valueOptions(r.drops[Number(kind.value)] || [], selected, kind.value === '0' ? '无' : '选择掉落物');
        item.disabled = denominator.disabled = kind.value === '0';
      };
      update(enemy.dropItems?.[i]?.kind ? enemy.dropItems[i].dataId : 0);
      kind.onchange = () => update(0);
    });
    $$('[data-x]', d).forEach(el => el.onclick = () => done(null));
    form.addEventListener('invalid', e => { const more = e.target.closest('details'); if (more) more.open = true; }, true);
    form.onsubmit = async event => {
      event.preventDefault();
      if (!r.canWrite) return;
      const save = $('[data-save]', d), error = $('[data-error]', d);
      const body = { id, name: get('enemyName'), note: get('enemyNote'), battlerName: graphic.value, battlerHue: Number(hue.value), exp: Number(get('enemyExp')), gold: Number(get('enemyGold')),
        params: r.stats.map((_, i) => Number(get('enemyStat' + i))),
        drops: rows.map(row => ({ kind: Number($('[data-kind]', row).value), dataId: Number($('[data-item]', row).value), denominator: Number($('input', row).value) })) };
      if (simple) body.skill = Number(get('enemySkill'));
      save.disabled = fieldset.disabled = true;
      error.textContent = '';
      try { done(await api('enemy/save', body)); }
      catch (e) { error.textContent = e.message; }
      finally { save.disabled = fieldset.disabled = false; }
    };
  });
}
