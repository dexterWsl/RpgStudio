'use strict';

function portraitRegionFields(region, screen, contents = '', notes = '', label = '限定立绘显示区域') {
  return `<label class="edit-toggle"><input type="checkbox" id="portraitRegionEnabled" ${region.enabled ? 'checked' : ''}> ${label}</label>
    <div id="portraitRegion">
      <p class="dim" id="portraitRegionHelp">拖动空白处框选，拖动框内移动，拖动右下角调整大小。也可以直接输入位置和尺寸。</p>
      <div class="portrait-screen" style="aspect-ratio:${screen.width} / ${screen.height}" role="img" aria-label="立绘显示区域的位置和尺寸" aria-describedby="portraitRegionHelp">
        <div class="portrait-selection">${contents}<span class="portrait-resize"></span></div>
      </div>
      <div class="portrait-coordinates">${[['x', '距左侧（%）', 0, 99], ['y', '距顶部（%）', 0, 99], ['width', '区域宽度（%）', 1, 100], ['height', '区域高度（%）', 1, 100]].map(([key, label, min, max]) =>
        `<label>${label}<input type="number" data-region="${key}" min="${min}" max="${max}" required value="${esc(region[key])}"></label>`).join('')}</div>${notes}
    </div>`;
}

function bindPortraitRegion(form, onChange) {
  const toggle = $('#portraitRegionEnabled', form), region = $('#portraitRegion', form);
  const screen = $('.portrait-screen', region), selection = $('.portrait-selection', screen);
  const fields = Object.fromEntries($$('[data-region]', region).map(input => [input.dataset.region, input]));
  const read = () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.valueAsNumber]));
  const value = () => ({ enabled: toggle.checked, ...read() });
  const change = () => { if (onChange) onChange(value()); };
  let drag = null, bounds = read();
  function render(box) {
    bounds = box;
    Object.assign(selection.style, { left: box.x + '%', top: box.y + '%', width: box.width + '%', height: box.height + '%' });
  }
  function sync() {
    region.hidden = !toggle.checked;
    for (const input of Object.values(fields)) input.disabled = !toggle.checked;
    for (const field of $$('[data-default-position]', form)) field.hidden = toggle.checked;
  }
  function validate() {
    const box = read();
    fields.width.setCustomValidity(box.x + box.width > 100 ? '横向位置和区域宽度合计不能超过 100%' : '');
    fields.height.setCustomValidity(box.y + box.height > 100 ? '纵向位置和区域高度合计不能超过 100%' : '');
    if (!Object.values(fields).every(input => input.validity.valid)) return false;
    render(box);
    return true;
  }
  function write(box) {
    for (const [key, input] of Object.entries(fields)) input.value = box[key];
    return validate();
  }
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  function point(event) {
    const rect = screen.getBoundingClientRect();
    return { x: clamp(Math.round((event.clientX - rect.left) * 100 / rect.width), 0, 100),
      y: clamp(Math.round((event.clientY - rect.top) * 100 / rect.height), 0, 100) };
  }
  screen.onpointerdown = event => {
    if (drag || event.button !== 0 || toggle.matches(':disabled')) return;
    const mode = event.target.closest('.portrait-resize') ? 'resize' : selection.contains(event.target) ? 'move' : 'draw';
    drag = { id: event.pointerId, mode, start: point(event), box: bounds };
    screen.setPointerCapture(event.pointerId);
  };
  screen.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    const { x, y } = point(event), { start, mode, box } = drag;
    let next;
    if (mode === 'move') {
      next = { ...box, x: clamp(box.x + x - start.x, 0, 100 - box.width), y: clamp(box.y + y - start.y, 0, 100 - box.height) };
    } else if (mode === 'resize') {
      next = { ...box, width: clamp(box.width + x - start.x, 1, 100 - box.x), height: clamp(box.height + y - start.y, 1, 100 - box.y) };
    } else if (x !== start.x || y !== start.y) {
      next = { x: Math.min(x, start.x, 99), y: Math.min(y, start.y, 99), width: Math.max(1, Math.abs(x - start.x)), height: Math.max(1, Math.abs(y - start.y)) };
    }
    if (next && write(next)) change();
  };
  screen.onlostpointercapture = () => { drag = null; };
  toggle.onchange = () => { if (!toggle.checked) write(bounds); sync(); change(); };
  Object.values(fields).forEach(input => { input.oninput = () => { if (validate()) change(); }; });
  sync();
  render(bounds);
  value.set = box => { toggle.checked = box.enabled; sync(); write(box); };
  return value;
}
