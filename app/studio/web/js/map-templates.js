'use strict';
async function placeMapTemplate(map, point) {
  const r = await api('map/templates');
  if (!r.canWrite) { toast('当前工程为只读模式', true); return; }
  const result = await openDialog(`<header><h3>地图交互模板</h3><button class="quiet small" type="button" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid">
      <label for="templateKind">模板</label><select id="templateKind">${Object.entries(r.templates).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('')}</select>
      <label for="templateMode">交互次数</label><div><select id="templateMode"><option value="once">仅一次</option><option value="repeat">持续可交互</option></select><div class="dim template-mode-note" data-mode-note></div></div>
      <label for="templateName">事件名</label><input id="templateName" maxlength="40" placeholder="留空时用模板名">
      <label>事件图像</label><div class="folder-input"><button type="button" class="small" data-graphic>选图像</button><span class="dim" data-graphic-name>无</span></div>
    </div><div class="fgrid" data-fields></div><p class="dim">放在这张地图的 (${point.x}, ${point.y})，生成后可继续编辑事件。</p><div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button><button class="primary" type="button" data-ok>创建事件</button></footer>`, (d, done) => {
    const kind = $('#templateKind', d), mode = $('#templateMode', d), fields = $('[data-fields]', d);
    const error = $('[data-error]', d), save = $('[data-ok]', d);
    let image = null, openImage = null;
    mode.disabled = !r.defaultModes;
    const pickGraphic = async (current, title) => {
      const selected = await spritePicker({ name: current?.characterName, index: current?.characterIndex, dir: current?.direction, pattern: current?.pattern }, { title, parent: d });
      if (!selected) return current;
      return selected.name ? { characterName: selected.name, characterIndex: selected.index, direction: selected.dir, pattern: selected.pattern } : null;
    };
    $('[data-graphic]', d).onclick = async () => {
      try { image = await pickGraphic(image, '模板事件图像'); $('[data-graphic-name]', d).textContent = image?.characterName || '无'; }
      catch (e) { error.textContent = e.message; }
    };
    const updateMode = () => {
      const once = mode.value === 'once', kindId = kind.value;
      const opened = $('[data-open-image-fields]', fields);
      if (opened) opened.hidden = !once;
      let note = '可以反复使用。';
      if (once) {
        note = '成功使用后会记录状态，离开地图或读档后仍有效。';
        if (kindId === 'chest') note = '只发一次奖励，之后显示打开后的样子。已开启状态随存档保存。';
        if (kindId === 'pickup') note = '拾取后消失，状态随存档保存。';
        if (kindId === 'save' || kindId === 'shop') note = '打开界面就算使用了一次，退出也会记下状态。';
      } else if (kindId === 'chest' || kindId === 'pickup') note = '每次互动都会获得奖励。';
      $('[data-mode-note]', d).textContent = mode.disabled ? note + ' 重启工具后可更改交互次数。' : note;
    };
    const renderFields = () => {
      error.textContent = '';
      const item = kind.value === 'chest' || kind.value === 'pickup' || kind.value === 'door';
      fields.innerHTML = item ? `<label for="templateItem">${kind.value === 'door' ? '钥匙物品' : '获得物品'}</label><select id="templateItem">${valueOptions(r.items, 0, '选择物品')}</select>` : '';
      if (kind.value === 'chest' || kind.value === 'pickup') fields.insertAdjacentHTML('beforeend', '<label for="templateCount">数量</label><input id="templateCount" type="number" min="1" value="1">');
      if (kind.value === 'chest') {
        fields.insertAdjacentHTML('beforeend', `<div class="template-open-image" data-open-image-fields><label>打开后的图像</label><div class="folder-input"><button type="button" class="small" data-open-image>选图像</button><span class="dim" data-open-name>${esc(openImage?.characterName || '沿用事件图像')}</span></div></div>`);
        $('[data-open-image]', fields).onclick = async () => {
          try { openImage = await pickGraphic(openImage, '宝箱打开后的图像'); const label = $('[data-open-name]', fields); if (label) label.textContent = openImage?.characterName || '沿用事件图像'; }
          catch (e) { error.textContent = e.message; }
        };
      }
      if (kind.value === 'door') {
        fields.insertAdjacentHTML('beforeend', `<label for="templateMap">目标地图</label><select id="templateMap">${valueOptions(r.maps, map)}</select>
          <label>到达坐标</label><div class="folder-input"><input id="templateX" min="0" type="number" aria-label="X 坐标" value="0"><input id="templateY" min="0" type="number" aria-label="Y 坐标" value="0"><button type="button" class="small" data-destination>地图上选</button></div>`);
        $('[data-destination]', fields).onclick = async () => {
          const target = Number($('#templateMap', fields).value);
          try {
            const initial = { x: Number($('#templateX', fields).value), y: Number($('#templateY', fields).value) };
            const chosen = await transferDialog(target, { initial });
            if (chosen && d.open) { $('#templateMap', fields).value = chosen.id; $('#templateX', fields).value = chosen.x; $('#templateY', fields).value = chosen.y; }
          } catch (e) { error.textContent = e.message; }
        };
      }
      if (kind.value === 'inn') fields.innerHTML = '<label for="templatePrice">房费（金币）</label><input type="number" id="templatePrice" min="0" value="10">';
      if (kind.value === 'shop') fields.innerHTML = '<label for="templateGoods">商品清单</label><textarea id="templateGoods" rows="6" placeholder="#商店&#10;#物品 回复药&#10;#金币 100G&#10;#商店结束"></textarea>';
      updateMode();
    };
    const chooseTemplate = () => {
      mode.value = r.defaultModes?.[kind.value] || (['chest', 'pickup'].includes(kind.value) ? 'once' : 'repeat');
      renderFields();
    };
    kind.onchange = chooseTemplate;
    mode.onchange = updateMode;
    $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
    save.onclick = async () => {
      const get = id => $('#' + id, d)?.value;
      save.disabled = true;
      error.textContent = '';
      try {
        const body = { kind: kind.value, mode: mode.value, map, ...point, name: get('templateName'), image, openImage };
        if (get('templateItem') != null) body.item = Number(get('templateItem'));
        if (get('templateCount') != null) body.count = Number(get('templateCount'));
        if (kind.value === 'door') body.to = { map: Number(get('templateMap')), x: Number(get('templateX')), y: Number(get('templateY')) };
        if (kind.value === 'inn') body.price = Number(get('templatePrice'));
        if (kind.value === 'shop') body.goods = get('templateGoods');
        done(await api('map/template', body));
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
    chooseTemplate();
  });
  if (result) {
    toast('已创建模板事件');
    await refreshMaps();
    go(`#/event/${map}/${result.id}/0`);
  }
}
