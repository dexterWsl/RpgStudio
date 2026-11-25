'use strict';

async function viewLayeredPortrait(main, key) {
  main.innerHTML = '<div class="loading">正在读取立绘…</div>';
  const actorId = Number(/^a(\d+)$/.exec(key)?.[1]);
  const { actor, layout: saved, screen, canWrite } = await api('layered-portrait?actor=' + actorId);
  if (route().a !== key || route().b !== 'portrait') return;
  const engine = RpgStudioLayered;
  const numberFields = fields => fields.map(([prop, text, min, max, step = 1, optional = false]) =>
    `<label>${text}<input type="number" data-geometry="${prop}" min="${min}" max="${max}" step="${step}" ${optional ? 'data-optional' : 'required'}></label>`).join('');
  const layerFields = (slot, label) => `<details class="edit-more" data-part="${slot}"><summary>${label} <span class="dim" data-status></span></summary>
    <div class="portrait-import"><label>当前素材 <select data-variant></select></label><button type="button" class="small" data-add-variant>添加命名素材</button></div>
    <div class="portrait-import"><label>导入 PNG <input type="file" data-file accept=".png,image/png"></label>
      <button type="button" class="small" data-align>拖动部位</button><button type="button" class="small quiet" data-clear>移除</button></div>
    <div class="portrait-coordinates">${numberFields([['x', '横坐标', -8192, 8192, 'any'], ['y', '纵坐标', -8192, 8192, 'any'], ['scale', '缩放（%）', 1, 2000],
      ...(slot === 'armL' || slot === 'armR' ? [['pivotX', '肩关节 X（%）', 0, 100], ['pivotY', '肩关节 Y（%）', 0, 100]] : [])])}</div>
    <details class="edit-more"><summary>变换与层级</summary><label class="edit-toggle"><input type="checkbox" data-flip="flipX"> 水平翻转</label>
      <label class="edit-toggle"><input type="checkbox" data-flip="flipY"> 垂直翻转</label><div class="portrait-coordinates">${numberFields([
      ['scaleY', '纵向缩放（%）', 1, 2000, 1, true], ['opacity', '不透明度', 0, 255], ['z', '层级', 1, 1000, 1, true]])}</div>
      <p class="dim">纵向缩放留空沿用原缩放。层级越大越靠前，留空按部位顺序放置。</p></details></details>`;
  const slotRows = Object.entries(engine.slots);
  main.innerHTML = `<div class="page wide"><div class="crumbs"><a href="#/people">人物</a><span>›</span><a href="#/people/${enc(key)}">${esc(actor.name)}</a><span>›</span><span>立绘</span></div>
    <div class="titlebar"><h1>分层制作</h1></div><form class="card plugin-config"><fieldset class="edit-fields" ${canWrite ? '' : 'disabled'}>
    <div class="layered-workspace"><section class="layered-stage">
      <canvas id="layeredCanvas" aria-label="分层立绘预览"></canvas>
      <div class="edit-section"><label>表情 <select id="layeredFace"></select></label><label>动作 <select id="layeredMotion">${Object.entries(engine.actions).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <button type="button" class="small" id="layeredReplay">重播动作</button></div>
      <p class="dim" id="layeredAlign" hidden></p><p><code id="layeredLine"></code></p><button type="button" class="small" id="layeredCopy">复制写法</button><p class="dim">保存后可把这行写进剧情，也能在「动态立绘」中用于画中画。</p>
    </section><section><div class="edit-section"><h2>部位</h2><button type="button" class="small" id="layeredImport">从事件提取立绘</button><button type="button" class="small" id="layeredDemo">载入木偶示例</button></div>
      <label>立绘名称 <input id="layeredTitle" placeholder="${esc(actor.name)}" maxlength="24"></label>
      <details class="edit-more" ${saved.region?.enabled ? 'open' : ''}><summary>显示位置与遮罩</summary>
        <p class="dim">写 <code>#立绘 立绘名</code> 时默认靠右。开启遮罩后，立绘会自动适配框内区域。</p>
        ${portraitRegionFields(saved.region || engine.defaultRegion(), screen, '<canvas class="portrait-frame-preview" id="layeredFramePreview" aria-hidden="true"></canvas>', '', '开启遮罩框选位置')}
        <button type="button" class="small" id="layeredOrigin" hidden>复制导入原位写法</button>
      </details>
      <p class="dim">导入透明 PNG，可用整张画布对齐，也可用裁好的部位图。调好左右臂的肩关节，再预览挥手和攻击。</p>
      <div class="portrait-coordinates"><label>画布宽（像素）<input type="number" id="layeredWidth" min="64" max="2400" required></label>
        <label>画布高（像素）<input type="number" id="layeredHeight" min="64" max="2400" required></label></div>
      ${slotRows.filter(([id]) => !id.startsWith('extra')).map(([id, label]) => layerFields(id, label)).join('')}
      <details class="edit-more" id="layeredExtras"><summary>附加图层 <span class="dim" data-extras-count></span></summary>
        ${slotRows.filter(([id]) => id.startsWith('extra')).map(([id, label]) => layerFields(id, label)).join('')}</details>
      <div class="edit-section"><h2>表情组合</h2><button type="button" id="layeredAddFace" class="small">添加表情</button></div>
      <p class="dim">表情可替换眉眼和嘴，沿用基础部位的位置和缩放。其他部位共用。</p><div id="layeredFaces"></div>
      ${layeredLibraryFields()}
    </section></div>
    ${canWrite ? '<div class="edit-section"><button type="submit" class="primary small">保存立绘</button></div>' : ''}
    </fieldset><div data-error role="alert"></div></form></div>`;

  const form = $('form', main), fieldset = $('fieldset', form), cv = $('#layeredCanvas', form), error = $('[data-error]', form);
  const framePreview = $('#layeredFramePreview', form);
  const faceSelect = $('#layeredFace', form), motionSelect = $('#layeredMotion', form), faceList = $('#layeredFaces', form);
  const parts = $$('[data-part]', form), width = $('#layeredWidth', form), height = $('#layeredHeight', form);
  const title = $('#layeredTitle', form);
  const who = /^[\s@]|\s/.test(actor.name) ? '@' + actor.id : actor.name;
  let layout = saved, selected = '', preview = null, drag = null;
  const variantNames = {};
  const variantsOf = slot => layout.variants[slot] || (layout.variants[slot] = {});
  const currentPart = slot => variantsOf(slot)[variantNames[slot]] || layout.layers[slot];
  const editParts = () => Object.fromEntries(Object.entries(variantNames).filter(([, name]) => name));
  const normalize = layout => ({ ...layout, region: layout.region || engine.defaultRegion(), layers: Object.fromEntries(slotRows.map(([id]) => [id, { ...engine.emptyLayer(), ...layout.layers[id] }])),
    variants: layout.variants || {}, states: layout.states || {}, programs: layout.programs || {} });
  layout = normalize(layout);
  const getRegion = bindPortraitRegion(form, value => { layout.region = value; changed(); });
  const portraitName = () => layout.name || who;
  function refresh() {
    const oldMotion = motionSelect.value;
    const motionOptions = { ...engine.actions };
    for (const name of Object.keys(layout.programs)) if (!Object.hasOwn(engine.builtInLabels, name)) motionOptions[name] = name;
    motionSelect.innerHTML = Object.entries(motionOptions).map(([key, label]) => `<option value="${esc(key)}" ${key === oldMotion ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const face = faceSelect.value || engine.faceDefault, action = motionSelect.value || 'still';
    const state = library.state();
    preview = { layout: previewLibrary(layout), state, selection: { parts: editParts() }, face, action };
    const scale = Math.min(1, 640 / Math.max(layout.width, layout.height));
    const w = Math.round(layout.width * scale), h = Math.round(layout.height * scale);
    for (const canvas of [cv, framePreview]) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }
    const actionName = action === 'still' ? '' : engine.actions[action] || action;
    const lines = ['#立绘 ' + portraitName()];
    if (state !== '正常') lines.push('#立绘 ' + state);
    if (face !== engine.faceDefault) lines.push('#立绘 表情 ' + face);
    if (actionName) lines.push('#立绘动作 ' + actionName);
    $('#layeredLine', form).textContent = lines.join('\n');
  }
  function changed() { S.dirty = true; refresh(); }
  function syncPart(row) {
    const slot = row.dataset.part, layer = currentPart(slot), select = $('[data-variant]', row);
    const names = Object.keys(variantsOf(slot));
    select.innerHTML = '<option value="">基础素材</option>' + names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
    select.value = variantNames[slot] || '';
    $('[data-status]', row).textContent = layer.file ? '已导入' : '';
    $('[data-align]', row).disabled = !layer.file;
    $('[data-clear]', row).disabled = !layer.file;
    $('[data-clear]', row).hidden = !!select.value;
    $$('[data-geometry]', row).forEach(input => { input.value = layer[input.dataset.geometry] ?? (input.dataset.geometry === 'opacity' ? 255 : ''); });
    $$('[data-flip]', row).forEach(input => { input.checked = !!layer[input.dataset.flip]; });
  }
  function syncFaces(currentFace) {
    const names = Object.keys(layout.faces);
    faceSelect.innerHTML = [engine.faceDefault, ...names].map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
    if (names.includes(currentFace)) faceSelect.value = currentFace;
    faceList.innerHTML = names.map(name => `<details class="edit-more" data-face="${esc(name)}"><summary>${esc(name)}</summary>
      ${['eyes', 'mouth'].map(slot => `<div class="portrait-import" data-slot="${slot}"><label>${engine.slots[slot]} <input type="file" accept=".png,image/png" data-file></label>
        <span class="dim" data-indicator>${layout.faces[name][slot] ? '已导入' : '沿用基础部位'}</span><button type="button" class="small quiet" data-clear ${layout.faces[name][slot] ? '' : 'disabled'}>沿用基础部位</button></div>`).join('')}
      </details>`).join('');
    if (names.includes(currentFace)) $$('.edit-more', faceList).find(el => el.dataset.face === currentFace).open = true;
  }
  function sync() {
    width.value = layout.width; height.value = layout.height; title.value = layout.name || '';
    getRegion.set(layout.region);
    $('#layeredOrigin', form).hidden = !layout.placement;
    const extras = slotRows.filter(([id]) => id.startsWith('extra') && layout.layers[id].file).length;
    $('[data-extras-count]', form).textContent = extras ? extras + ' 层' : '';
    parts.forEach(syncPart); syncFaces(faceSelect.value); library.sync(); refresh();
  }
  function align(slot) {
    selected = slot;
    const hint = $('#layeredAlign', form);
    hint.hidden = !slot;
    hint.textContent = slot ? '在预览中拖动' + engine.slots[slot] + '，位置会同步到坐标。' : '';
    cv.classList.toggle('align', !!slot);
    if (slot) { motionSelect.value = 'still'; refresh(); }
  }
  cv.onpointerdown = event => {
    if (!selected || event.button !== 0 || fieldset.disabled) return;
    const layer = currentPart(selected);
    const rect = cv.getBoundingClientRect();
    drag = { id: event.pointerId, px: event.clientX, py: event.clientY, x: layer.x, y: layer.y, rect };
    cv.setPointerCapture(event.pointerId);
  };
  cv.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    const layer = currentPart(selected), clamp = value => Math.max(-8192, Math.min(8192, Math.round(value)));
    layer.x = clamp(drag.x + (event.clientX - drag.px) * layout.width / drag.rect.width);
    layer.y = clamp(drag.y + (event.clientY - drag.py) * layout.height / drag.rect.height);
    syncPart(parts.find(row => row.dataset.part === selected));
    changed();
  };
  cv.onlostpointercapture = () => { drag = null; };
  for (const [input, prop] of [[width, 'width'], [height, 'height']]) input.oninput = () => {
    if (input.validity.valid) { layout[prop] = input.valueAsNumber; changed(); }
  };
  title.oninput = () => { layout.name = title.value.trim(); changed(); };
  for (const row of parts) {
    const slot = row.dataset.part;
    $('[data-variant]', row).onchange = event => { variantNames[slot] = event.target.value; syncPart(row); refresh(); };
    $('[data-add-variant]', row).onclick = async () => {
      const name = await promptDialog('添加' + engine.slots[slot] + '素材', '素材名称', '');
      if (!name) return;
      if (!puppetName(name) || Object.keys(variantsOf(slot)).some(old => old.toLowerCase() === name.toLowerCase())) {
        error.textContent = '同一部位的素材名要唯一，可用中文、字母、数字、下划线或短横线。'; return;
      }
      error.textContent = '';
      variantsOf(slot)[name] = { ...currentPart(slot), file: '' };
      variantNames[slot] = name;
      syncPart(row); changed();
      $('[data-file]', row).focus();
    };
    $('[data-align]', row).onclick = () => align(slot);
    $('[data-clear]', row).onclick = () => { currentPart(slot).file = ''; if (selected === slot) align(''); syncPart(row); changed(); };
    $$('[data-geometry]', row).forEach(input => input.oninput = () => {
      if (input.validity.valid) { currentPart(slot)[input.dataset.geometry] = input.hasAttribute('data-optional') && !input.value ? null : input.valueAsNumber; changed(); }
    });
    $$('[data-flip]', row).forEach(input => input.onchange = () => { currentPart(slot)[input.dataset.flip] = input.checked; changed(); });
  }
  async function perform(task) {
    error.textContent = ''; fieldset.disabled = true;
    try { await task(); } catch (e) { error.textContent = e.message; }
    finally { fieldset.disabled = !canWrite; }
  }
  form.onchange = event => {
    const input = event.target, file = input.files?.[0];
    if (!file || !input.matches('[data-file]')) return;
    const row = input.closest('[data-part]'), face = input.closest('[data-face]')?.dataset.face;
    perform(async () => {
      const upload = await uploadFile('/api/studio/upload/layered-portrait', file);
      if (!form.isConnected) return;
      if (row) { currentPart(row.dataset.part).file = upload.name; syncPart(row); }
      else { layout.faces[face][input.closest('[data-slot]').dataset.slot] = upload.name; syncFaces(face); }
      changed();
    }).finally(() => { input.value = ''; });
  };
  faceList.onclick = event => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    const face = button.closest('[data-face]').dataset.face;
    layout.faces[face][button.closest('[data-slot]').dataset.slot] = '';
    syncFaces(face); changed();
  };
  $('#layeredAddFace', form).onclick = async () => {
    const name = await openDialog('<header><h3>添加表情</h3></header><form><div class="dbody"><label>表情名 <input name="face" required maxlength="24" placeholder="例如 生气"></label><p class="err" data-face-error></p></div><footer><button type="button" data-cancel>取消</button><button class="primary" type="submit">添加</button></footer></form>', (dialog, done) => {
      const edit = $('form', dialog); $('[data-cancel]', dialog).onclick = () => done(null);
      edit.onsubmit = event => {
        event.preventDefault();
        const value = edit.elements.face.value.trim();
        if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(value) || value === engine.faceDefault || value in layout.faces) {
          $('[data-face-error]', dialog).textContent = '请输入一个未使用的表情名，可用中文、字母、数字、下划线或短横线。'; return;
        }
        done(value);
      };
    });
    if (!name) return;
    layout.faces[name] = { eyes: '', mouth: '' }; syncFaces(name); changed();
  };
  $('#layeredDemo', form).onclick = () => {
    if (Object.values(layout.layers).some(layer => layer.file) && !confirm('将当前草稿替换为木偶示例？保存前可以返回原立绘。')) return;
    perform(async () => { const demo = await api('layered-portrait/demo', { actor: actor.id }); if (!form.isConnected) return; layout = normalize({ ...demo.layout, region: layout.region }); clearParts(); align(''); sync(); changed(); });
  };
  $('#layeredImport', form).onclick = () => {
    if (Object.values(layout.layers).some(part => part.file) && !confirm('将提取的图层载入当前木偶草稿？保存前可返回原立绘。')) return;
    perform(async () => {
      const imported = await choosePortraitImport(actor);
      if (!imported || !form.isConnected) return;
      layout = normalize({ ...imported, name: layout.name, region: layout.region });
      clearParts(); align(''); sync(); changed();
    });
  };
  async function copyLine(line) {
    try { await navigator.clipboard.writeText(line); toast('已复制立绘写法'); }
    catch { toast('请选中文字复制', true); }
  }
  $('#layeredCopy', form).onclick = () => copyLine($('#layeredLine', form).textContent);
  $('#layeredOrigin', form).onclick = () => copyLine('#立绘 ' + portraitName() + ' 默认 原位');
  faceSelect.onchange = motionSelect.onchange = $('#layeredReplay', form).onclick = refresh;
  form.onsubmit = event => {
    event.preventDefault();
    perform(async () => {
      await api('layered-portrait', { actor: actor.id, layout });
      if (!form.isConnected) return;
      S.dirty = false; toast('已保存分层立绘');
    });
  };
  function clearParts() { for (const slot of Object.keys(variantNames)) delete variantNames[slot]; parts.forEach(syncPart); }
  const library = bindLayeredLibrary(form, {
    layout: () => layout, refresh, changed, error,
    resetParts() { clearParts(); faceSelect.value = engine.faceDefault; motionSelect.value = 'still'; },
    capture(state) {
      const data = previewLibrary(layout).states[state];
      const parts = { ...data?.parts, ...editParts() };
      const expression = faceSelect.value !== engine.faceDefault ? faceSelect.value : data?.face;
      return [...(expression ? ['#表情 ' + expression] : []), ...Object.entries(parts).map(([slot, name]) => '#' + engine.slots[slot] + ' ' + name)].join('\n');
    },
    play(action) { refresh(); motionSelect.value = action; refresh(); },
  });
  sync();
  engine.mount(cv, () => preview, file => img(engine.partSub, file));
  engine.mount(framePreview, () => layout.region.enabled ? preview : null, file => img(engine.partSub, file));
}
