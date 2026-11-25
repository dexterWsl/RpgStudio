'use strict';

const itemUseTools = [['switch', '开关'], ['var', '变量'], ['item', '物品'], ['gold', '金币'], ['if', '如果'], ['transfer', '传送'], ['scene', '场景'], ['balloon', '气泡'], ['move', '移动'], ['immunity', '免遇敌']];

function itemUseEditor({ useEffects, nativeCalls, canWrite }) {
  return `<details class="edit-more" ${useEffects.text ? 'open' : ''}><summary>使用效果</summary>
    ${nativeCalls.length ? `<p class="dim">原有公共事件 ${nativeCalls.map(event => `<a href="#/ce/${event.id}" data-close-link>${esc(event.name || ('编号 ' + event.id))}</a>`).join('、')}</p>` : ''}
    ${!useEffects.editable ? `<p>这份效果含有特殊结构。<a href="#/ce/${useEffects.event}" data-close-link>打开公共事件</a></p>` : `
    <div class="edins" role="toolbar" aria-label="插入使用效果">${canWrite ? itemUseTools.map(([key, label]) => `<button type="button" class="small" data-item-use="${key}">${label}</button>`).join('') : ''}</div>
    <textarea id="itemUseText" aria-label="物品使用效果" class="settlement-source" rows="6" spellcheck="false" ${canWrite ? '' : 'readonly'} placeholder="#开关 已读地图 开&#10;#变量 使用次数 +1&#10;#场景 指引&#10;#免遇敌 1000">${esc(useEffects.text)}</textarea>
    <p class="dim">逐行写，使用后按顺序执行。传送和地图演出请把物品设为「仅菜单」。队伍共用的道具可把使用目标设为「无」。</p>
    ${writingHelp()}`}</details>`;
}

function bindItemUse(dialog) {
  const text = $('#itemUseText', dialog);
  if (!text) return;
  const nameLine = async (kind, label, suffix) => {
    const name = await pickNameOrCreate('插入' + label, kind);
    return name && `#${label} ${name} ${suffix}`;
  };
  const lines = {
    switch: () => nameLine('switch', '开关', '开'),
    var: () => nameLine('var', '变量', '+1'),
    item: async () => { const name = await pickDialog('插入物品', 'lookup?kind=item'); return name && '#物品 ' + name + ' +1'; },
    gold: () => '#金币 +100',
    if: async () => { const condition = await ifBuilder(); return condition && '#如果 ' + condition + '\n#条件结束'; },
    transfer: async () => { const destination = await transferDialog(0); return destination && transferLine(destination); },
    scene: async () => { const name = await scenePicker(); return name && '#场景 ' + name; },
    balloon: () => balloonLine('主角'),
    move: async () => { const who = await whoDialog('移动路线：谁动'); return who && '#移动 ' + who + ' 下1'; },
    immunity: () => '#免遇敌 1000',
  };
  bindWritingHelp(dialog);
  $$('[data-item-use]', dialog).forEach(button => button.onclick = async () => {
    try {
      const line = await lines[button.dataset.itemUse]();
      if (!line || !dialog.open) return;
      const start = text.selectionStart, end = text.selectionEnd;
      const before = start > 0 && text.value[start - 1] !== '\n' ? '\n' : '';
      const after = end < text.value.length && text.value[end] !== '\n' ? '\n' : '';
      text.setRangeText(before + line + after, start, end, 'end');
      text.focus();
    } catch (error) { $('[data-error]', dialog).textContent = error.message; }
  });
}
