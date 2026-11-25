'use strict';

function enemyTroopOptions(troops, selected) {
  return valueOptions(troops.map(row => ({ ...row, name: `${row.id} · ${row.name || '未命名'}` })), selected, '选择敌群');
}

async function mapEnemiesDialog(map) {
  const r = await api('map/enemies?map=' + map);
  const result = await openDialog(`<header><h3>敌人设置</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><form id="mapEnemyForm"><fieldset class="edit-fields" ${r.canWrite ? '' : 'disabled'}>
    <div class="edit-toggle"><label><input type="checkbox" id="randomEnemies" ${r.random ? 'checked' : ''}> 随机遇敌</label><span class="dim">在指定区域走动时随机进入战斗。</span></div>
    <div class="edit-toggle"><label for="encounterStep">平均遇敌步数</label><input type="number" id="encounterStep" required min="1" max="999" value="${esc(r.step)}"></div>
    <div class="edit-toggle"><label><input type="checkbox" id="visibleEnemies" ${r.visible ? 'checked' : ''}> 游荡敌人</label><span class="dim">放置的敌人会出现在地图上，接触主角时进入战斗。</span></div>
    <div class="edit-toggle"><label><input type="checkbox" id="chaseEnemies" ${r.chase ? 'checked' : ''}> 追踪主角</label><span class="dim">游荡敌人会在距离内追踪主角，其余时间继续游荡。</span></div>
    <div class="edit-section"><h3>随机遇敌的敌群</h3><button type="button" class="small" data-add-encounter ${r.troops.length ? '' : 'disabled'}>添加敌群</button></div>
    <div class="edit-list" data-encounter-list></div>
    ${r.troops.length ? '' : '<p class="dim">在<a href="#/people/enemies" data-enemy-link>敌人管理</a>保存敌人后，这里就能选择它的敌群。</p>'}
    <details class="edit-more"><summary>高级设置</summary>
    <div class="edit-section"><h3>随机遇敌条件</h3></div>
    <div class="edit-toggle"><label for="encounterMinSteps">进图后至少走</label><input type="number" id="encounterMinSteps" required min="0" max="9999999" value="${esc(r.minSteps)}"> 步</div>
    <div class="edit-toggle"><label for="encounterSwitch">条件开关</label><select id="encounterSwitch">${valueOptions(r.switches, r.switchId, '不限')}</select>
      <select id="encounterSwitchOn" aria-label="要求的开关状态"><option value="on" ${r.switchOn ? 'selected' : ''}>打开时允许</option><option value="off" ${r.switchOn ? '' : 'selected'}>关闭时允许</option></select></div>
    <p class="dim">满足步数和开关条件后才开始计算遇敌。步数为 0 表示不限。事件或物品可写 <code>#免遇敌 1000</code> 临时阻止随机遇敌。</p>
    <div class="edit-section"><h3>游荡敌人</h3></div>
    <div class="edit-toggle"><label for="enemyRange">追踪距离（格）</label><input type="number" id="enemyRange" required min="1" max="15" value="${r.range}"></div>
    </details></fieldset></form>
    <div class="edit-section"><h3>已放置的敌人</h3></div>
    <div class="rows">${r.events.map(row => `<a class="rowlink" href="#/event/${map}/${row.id}/0" data-enemy-link><span>${esc(row.name)}</span><span class="dim">(${row.x}, ${row.y})</span></a>`).join('') || '<p class="dim">在地图的「事件」模式点击空格，再选「放置敌人」。</p>'}</div>
    <div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>${r.canWrite ? '取消' : '关闭'}</button>${r.canWrite ? '<button type="submit" form="mapEnemyForm" class="primary" data-save>保存敌人设置</button>' : ''}</footer>`, (d, done) => {
    const form = $('form', d), fields = $('fieldset', d), list = $('[data-encounter-list]', d);
    const addRow = ({ troopId = 0, weight = 5, regionSet = [] } = {}) => list.insertAdjacentHTML('beforeend', `<div class="encounter-row">
      <div class="folder-input"><select aria-label="敌群" data-troop>${enemyTroopOptions(r.troops, troopId)}</select><button type="button" class="small quiet" data-remove>移除</button></div>
      <details class="edit-more"><summary>权重与区域</summary><div class="equip-stats">
      <label>权重<input type="number" data-weight required min="1" max="9999" value="${esc(weight)}"></label>
      <label>区域<input data-regions value="${esc(regionSet.join(', '))}" placeholder="整张地图"></label></div>
      <p class="dim">权重越高越容易出现。区域留空表示整张地图，多个区域编号用空格或逗号分开。</p></details></div>`);
    r.encounters.forEach(addRow);
    $$('[data-x],[data-enemy-link]', d).forEach(el => el.onclick = () => done(null));
    if (!r.canWrite) return;
    const value = id => Number($('#' + id, d).value), checked = id => $('#' + id, d).checked;
    const error = $('[data-error]', d), save = $('[data-save]', d);
    const gate = $('#encounterSwitch', d), gateState = $('#encounterSwitchOn', d);
    gate.onchange = () => { gateState.disabled = Number(gate.value) === 0; };
    gate.onchange();
    $('[data-add-encounter]', d).onclick = () => addRow();
    list.onclick = e => { const remove = e.target.closest('[data-remove]'); if (remove) remove.closest('.encounter-row').remove(); };
    form.addEventListener('invalid', e => { const more = e.target.closest('details'); if (more) more.open = true; }, true);
    form.onsubmit = async e => {
      e.preventDefault();
      const encounters = $$('.encounter-row', list).map(row => ({ troopId: Number($('[data-troop]', row).value), weight: Number($('[data-weight]', row).value),
        regionSet: $('[data-regions]', row).value.split(/[\s,，]+/).filter(Boolean) }));
      const payload = { map, random: checked('randomEnemies'), visible: checked('visibleEnemies'), chase: checked('chaseEnemies'),
        step: value('encounterStep'), range: value('enemyRange'), encounters, minSteps: value('encounterMinSteps'),
        switchId: Number(gate.value), switchOn: gateState.value === 'on' };
      save.disabled = fields.disabled = true;
      error.textContent = '';
      try { done(await api('map/enemies/save', payload)); }
      catch (e) { error.textContent = e.message; }
      finally { save.disabled = fields.disabled = false; }
    };
  });
  if (result) toast('已保存敌人设置');
}

async function placeMapEnemy(map, point) {
  const r = await api('map/enemies?map=' + map);
  if (!r.canWrite) { toast('当前工程为只读模式', true); return; }
  const result = await openDialog(`<header><h3>放置敌人</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody">${r.troops.length ? `<div class="fgrid">
      <label for="placeTroop">敌群</label><select id="placeTroop">${enemyTroopOptions(r.troops, r.troops.length === 1 ? r.troops[0].id : 0)}</select>
      <label>地图行走图</label><div class="folder-input"><button type="button" class="small" data-graphic>选择行走图</button><span class="dim" data-graphic-name>未选择</span></div>
      <label for="enemyRespawn">击败后</label><select id="enemyRespawn"><option value="return">下次进入地图时恢复</option><option value="permanent">永久消失</option></select></div>
      ${r.visible ? '' : '<label class="edit-toggle"><input type="checkbox" data-enable-visible checked> 同时开启本地图的游荡敌人</label>'}
      <p class="dim">放在这张地图的 (${point.x}, ${point.y})。</p>` : '<p>请先到<a href="#/people/enemies" data-x>敌人管理</a>创建敌人。</p>'}
    <div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button>${r.troops.length ? '<button class="primary" type="button" data-save>放置敌人</button>' : ''}</footer>`, (d, done) => {
    $$('[data-x]', d).forEach(el => el.onclick = () => done(null));
    const save = $('[data-save]', d);
    if (!save) return;
    let sprite;
    const error = $('[data-error]', d), graphic = $('[data-graphic]', d);
    graphic.onclick = async () => {
      try {
        const picked = await spritePicker(sprite || {}, { title: '敌人行走图', allowNone: false, parent: d });
        if (picked) { sprite = picked; $('[data-graphic-name]', d).textContent = sprite.name || '未选择'; }
      } catch (e) { error.textContent = e.message; }
    };
    save.onclick = async () => {
      const image = sprite && { characterName: sprite.name, characterIndex: sprite.index, direction: sprite.dir, pattern: sprite.pattern };
      const body = { map, ...point, image, troop: Number($('#placeTroop', d).value), permanent: $('#enemyRespawn', d).value === 'permanent',
        enableVisible: $('[data-enable-visible]', d)?.checked || false };
      save.disabled = graphic.disabled = true;
      error.textContent = '';
      try { done(await api('map/enemies/place', body)); }
      catch (e) { error.textContent = e.message; }
      finally { save.disabled = graphic.disabled = false; }
    };
  });
  if (result) {
    toast('已放置游荡敌人');
    await refreshMaps();
    go(`#/event/${map}/${result.id}/0`);
  }
}
