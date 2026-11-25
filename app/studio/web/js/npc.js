'use strict';

function npcInteractionFields() {
  return `<div class="edit-section"><h3>互动写法</h3></div>
    <div class="edins" role="toolbar" aria-label="插入 NPC 指令">
      <button type="button" class="small" data-npc-insert="choices">选项</button>
      <button type="button" class="small" data-npc-insert="bubble">文字气泡</button>
      <button type="button" class="small" data-npc-insert="scene">场景</button>
    </div>
    <textarea class="settlement-source npc-writing" rows="5" spellcheck="false" aria-label="NPC 互动写法" placeholder="#气泡 ：你好！"></textarea>
    <p class="dim">留空只摆放人物。填写互动后默认第一行是 <code>#面向主角</code>。</p>${writingHelp()}`;
}

function bindNpcInteraction(dialog) {
  const source = $('.npc-writing', dialog);
  bindWritingHelp(dialog);
  $$('[data-npc-insert]', dialog).forEach(button => button.onclick = async () => {
    try {
      const kind = button.dataset.npcInsert;
      let line = '#气泡 ：你好！';
      if (kind === 'choices') line = '#选项 1 2 3\n#1\n#2\n#3';
      if (kind === 'scene') {
        const scene = await scenePicker();
        if (!scene || !dialog.open) return;
        line = '#场景 ' + scene;
      }
      const start = source.selectionStart, end = source.selectionEnd;
      const before = start > 0 && source.value[start - 1] !== '\n' ? '\n' : '';
      const after = end < source.value.length && source.value[end] !== '\n' ? '\n' : '';
      source.setRangeText(before + line + after, start, end, 'end');
      source.focus();
    } catch (error) { toast(error.message, true); }
  });
  return source;
}

async function placeNpc({ map, point, actorId } = {}) {
  const { people } = await api('people');
  const actors = people.filter(p => p.actorId);
  const result = await openDialog(`<header><h3>放置 NPC</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid">
      <label for="npcActor">人物</label><select id="npcActor">${valueOptions(actors.map(a => ({ id: a.actorId, name: a.name })), actorId || 0, '自定义')}</select>
      <label for="npcName">事件名</label><input id="npcName" maxlength="40">
      <label>地图行走图</label><div class="folder-input"><button type="button" class="small" data-npc-sprite>选择行走图</button><span data-npc-graphic class="dim"></span></div>
      ${point ? '' : '<label>位置</label><div class="folder-input"><button type="button" class="small" data-npc-point>地图上选</button><span data-npc-location class="dim">未选择</span></div>'}
    </div>${npcInteractionFields()}<div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-save>放置 NPC</button></footer>`, (d, done) => {
    const source = bindNpcInteraction(d), select = $('#npcActor', d), name = $('#npcName', d);
    const graphic = $('[data-npc-graphic]', d), error = $('[data-error]', d), save = $('[data-save]', d);
    let sprite, destination = point ? { ...point, map } : null;
    const showGraphic = () => { graphic.textContent = sprite?.name || '未选择'; };
    select.onchange = () => {
      const picked = actors.find(a => a.actorId === Number(select.value));
      name.value = picked?.name || '';
      sprite = picked?.sprite;
      showGraphic();
    };
    select.onchange();
    $('[data-npc-sprite]', d).onclick = async () => {
      try {
        const picked = await spritePicker(sprite || {}, { title: 'NPC 行走图', parent: d, allowNone: false });
        if (picked) { sprite = picked; showGraphic(); }
      } catch (e) { error.textContent = e.message; }
    };
    if (!point) $('[data-npc-point]', d).onclick = async () => {
      try {
        const pos = await transferDialog(destination?.map || S.project.start?.map || 0, { title: 'NPC 放在哪里', coordinateOnly: true });
        if (pos) { destination = { map: pos.id, x: pos.x, y: pos.y }; $('[data-npc-location]', d).textContent = `${pos.name} (${pos.x}, ${pos.y})`; }
      } catch (e) { error.textContent = e.message; }
    };
    $$('[data-x]', d).forEach(button => button.onclick = () => done(null));
    save.onclick = async () => {
      if (!destination || !sprite?.name) { error.textContent = '请选择放置位置和行走图'; return; }
      save.disabled = true;
      try {
        const image = { characterName: sprite.name, characterIndex: sprite.index, direction: sprite.dir || 2, pattern: sprite.pattern ?? 1 };
        const saved = await api('event/create', { ...destination, image, name: name.value, npcText: source.value });
        done({ ...saved, map: destination.map });
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
  });
  if (result) { toast('已放置 NPC'); await refreshMaps(); go(`#/event/${result.map}/${result.id}/0`); }
}
