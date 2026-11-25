'use strict';
const INVENTORY_NAMES = { item: '物品', weapon: '武器', armor: '防具' };
const EQUIP_STATS = ['最大生命', '最大魔力', '攻击', '防御', '魔攻', '魔防', '敏捷', '幸运'];
const ITEM_SCOPES = ['无', '敌方单体', '敌方全体', '随机敌方 1 人', '随机敌方 2 人', '随机敌方 3 人', '随机敌方 4 人', '我方单体', '我方全体', '我方倒下单体', '我方倒下全体', '使用者', '我方单体（含倒下）', '我方全体（含倒下）', '敌我全体'];
const numberedChoices = (labels, start = 0) => labels.map((name, i) => ({ id: i + start, name }));

async function viewInventory(main, category) {
  const kind = Object.hasOwn(INVENTORY_NAMES, category) ? category : 'item';
  const { rows, canWrite } = await api('inventory?kind=' + kind);
  if (route().name !== 'inventory' || route().a !== category) return;
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>物品与装备</h1><span class="sp"></span>${canWrite ? `<button id="newInventory" class="primary small">新建${INVENTORY_NAMES[kind]}</button>` : ''}</div>
    <div class="filters"><div class="seg">${Object.entries(INVENTORY_NAMES).map(([key, label]) => `<button type="button" data-catalog="${key}" class="${kind === key ? 'on' : ''}">${label}</button>`).join('')}</div><input type="search" aria-label="筛选名称或编号" placeholder="筛选名称或编号" id="inventoryFilter"></div>
    <div class="card rows" id="inventoryRows"></div>
  </div>`;
  const list = $('#inventoryRows', main), filter = $('#inventoryFilter', main);
  const edit = async id => {
    try { if (await editInventory(kind, id)) { S.lookups = {}; render(); } }
    catch (e) { toast(e.message, true); }
  };
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const visible = rows.filter(r => !q || r.name?.toLowerCase().includes(q) || String(r.id) === q);
    list.innerHTML = visible.map(r => `<button type="button" class="catalog-row" data-item-id="${r.id}"><span class="num dim">${r.id}</span><span>${esc(r.name || '未命名')}</span><span class="dim">${Number(r.price) || 0} 金币</span></button>`).join('') || '<div class="empty">没有符合的条目</div>';
  };
  filter.oninput = draw;
  list.onclick = event => { const row = event.target.closest('[data-item-id]'); if (row) edit(Number(row.dataset.itemId)); };
  $$('[data-catalog]', main).forEach(b => b.onclick = () => go('#/inventory/' + b.dataset.catalog));
  if ($('#newInventory', main)) $('#newInventory', main).onclick = () => edit(0);
  draw();
}

async function editInventory(kind, id) {
  const r = await api('inventory/entry?kind=' + kind + '&id=' + id);
  const a = r.entry;
  const number = (key, value, min = 0, max = 99999999) => `<input data-field="${key}" type="number" value="${Number(value) || 0}" min="${min}" max="${max}" step="1">`;
  const select = (key, options) => `<select data-field="${key}">${options}</select>`;
  const effect = (key, label, input) => `<label>${label}</label>${r.effects[key].locked ? '<span class="dim">已有多个同类效果，保留原设定</span>' : input}`;
  const effects = `
    <label>物品分类</label>${select('itypeId', valueOptions(numberedChoices(['普通物品', '关键物品', '隐藏物品 A', '隐藏物品 B'], 1), a.itypeId))}
    <label>使用目标</label>${select('scope', valueOptions(numberedChoices(ITEM_SCOPES.slice(0, r.engine === 'MV' ? 12 : 15)), a.scope))}
    <label>使用时机</label>${select('occasion', valueOptions(numberedChoices(['随时', '仅战斗', '仅菜单', '不可主动使用']), a.occasion))}
    <label for="inventoryConsume">使用后消耗</label><input type="checkbox" id="inventoryConsume" ${a.consumable ? 'checked' : ''}>
    ${effect('hp', '固定回复生命', number('hp', r.effects.hp.value, 0, 999999))}
    ${effect('mp', '固定回复魔力', number('mp', r.effects.mp.value, 0, 999999))}
    ${effect('event', '使用时调用', select('event', valueOptions(r.events, r.effects.event.value, '无公共事件')))}`;
  const equipment = `
    <label>装备分类</label>${select('type', valueOptions(r.types, kind === 'weapon' ? a.wtypeId : a.atypeId))}
    ${kind === 'armor' ? `<label>装备部位</label>${select('slot', valueOptions(r.slots, id ? a.etypeId : r.slots[0]?.id))}` : ''}
    <label>属性加成</label><div class="equip-stats">${EQUIP_STATS.map((name, i) => `<label>${name}${number('stat' + i, a.params?.[i], -999999, 999999)}</label>`).join('')}</div>`;
  return openDialog(`<header><h3>${id ? esc(a.name || INVENTORY_NAMES[kind]) : '新建' + INVENTORY_NAMES[kind]}</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="fgrid">
        <label for="inventoryName">名称</label><input id="inventoryName" maxlength="80" value="${esc(a.name)}">
        <label>图标编号</label><div class="folder-input">${number('iconIndex', a.iconIndex, 0, 99999)}${r.iconset ? '<button type="button" class="small" data-icon>选图标</button>' : ''}</div>
        <label>价格</label>${number('price', a.price)}
        <label for="inventoryMaxItems">最大持有量</label><input id="inventoryMaxItems" type="number" min="1" max="${r.maxItemsLimit}" value="${r.maxItems ?? ''}" placeholder="引擎默认（通常为 99）">
        <label for="inventoryDesc">说明</label><textarea id="inventoryDesc" rows="2" maxlength="1000">${esc(a.description)}</textarea>
        ${kind === 'item' ? effects : equipment}
        ${kind !== 'armor' ? `<label>动画</label>${select('animationId', valueOptions(kind === 'item' ? [{ id: -1, name: '普通攻击' }, ...r.animations] : r.animations, a.animationId || 0, '无'))}` : ''}
        <label for="inventoryNote">备注</label><textarea id="inventoryNote" rows="2" maxlength="12000">${esc(a.note)}</textarea>
      </div>
      ${kind === 'item' ? itemUseEditor(r) : ''}
      ${r.uses.length ? `<details><summary>查看引用（${r.uses.length}）</summary>${r.uses.map(ref => `<a class="refitem" href="${hrefOf(ref.at)}" data-close-link><div class="w">${esc(ref.where)}</div><div class="t">${esc(ref.text)}</div></a>`).join('')}</details>` : ''}
      <div role="alert" data-error></div>
    </div><footer><span class="sp"></span><button type="button" data-x>取消</button>${r.canWrite ? '<button type="button" class="primary" data-ok>保存</button>' : ''}</footer>`, (d, done) => {
    const field = key => $(`[data-field="${key}"]`, d);
    const val = key => Number(field(key)?.value);
    const ok = $('[data-ok]', d);
    $$('[data-x], [data-close-link]', d).forEach(b => b.onclick = () => done(false));
    if (kind === 'item') bindItemUse(d);
    const icon = $('[data-icon]', d);
    if (icon) icon.onclick = async () => {
      const index = await pickInventoryIcon();
      if (index != null && d.open) field('iconIndex').value = index;
    };
    if (!ok) return;
    ok.onclick = async () => {
      const report = $('[data-error]', d);
      report.textContent = '';
      const fields = { kind, id, name: $('#inventoryName', d).value, description: $('#inventoryDesc', d).value, note: $('#inventoryNote', d).value, iconIndex: val('iconIndex'), price: val('price'), animationId: field('animationId') ? val('animationId') : 0 };
      const cap = $('#inventoryMaxItems', d).value;
      fields.maxItems = cap === '' ? null : Number(cap);
      if (kind === 'item') Object.assign(fields, { itypeId: val('itypeId'), scope: val('scope'), occasion: val('occasion'), consumable: $('#inventoryConsume', d).checked,
        effects: Object.fromEntries(['hp', 'mp', 'event'].filter(k => field(k) && Number(r.effects[k].value) !== val(k)).map(k => [k, val(k)])) });
      else Object.assign(fields, { type: val('type'), slot: kind === 'armor' ? val('slot') : 1, params: EQUIP_STATS.map((_, i) => val('stat' + i)) });
      const useText = $('#itemUseText', d);
      if (useText && useText.value !== r.useEffects.text) fields.useEffects = useText.value;
      ok.disabled = true;
      try { await api('inventory/save', fields); toast('已保存' + INVENTORY_NAMES[kind]); done(true); }
      catch (e) { report.textContent = e.message; }
      finally { ok.disabled = false; }
    };
  });
}

function pickInventoryIcon() {
  return openDialog(`<header><h3>选图标</h3><button type="button" class="quiet small" data-x>取消</button></header>
    <div class="dbody"><div class="icon-chooser"></div></div>`, (d, done) => {
    const image = new Image(), box = $('.icon-chooser', d);
    image.onload = () => {
      if (!d.open) return;
      const count = Math.floor(image.naturalHeight / 32) * 16;
      for (let index = 0; index < count; index++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = '图标 ' + index;
        button.setAttribute('aria-label', button.title);
        button.style.backgroundImage = `url("${image.src}")`;
        button.style.backgroundPosition = `-${index % 16 * 32}px -${Math.floor(index / 16) * 32}px`;
        button.onclick = () => done(index);
        box.append(button);
      }
    };
    image.onerror = () => { box.textContent = '无法读取本工程的图标集'; };
    image.src = img('system', 'IconSet');
    $('[data-x]', d).onclick = () => done(null);
  });
}
