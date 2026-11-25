'use strict';

const puppetName = value => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,24}$/u.test(value) && !['默认', '无', '自动'].includes(value) && !Object.hasOwn(Object.prototype, value);

function layeredLibraryFields() {
  return `<details class="edit-more"><summary>整套立绘状态</summary>
    <div class="edit-section"><label>状态 <select id="puppetState"></select></label><button type="button" class="small" id="puppetAddState">新增状态</button>
      <button type="button" class="small" id="puppetCapture">记录当前搭配</button></div>
    <p class="dim">把整套变化封装成一个自定义写法。给状态取名「受伤」后，剧情中写 <code>#立绘 受伤</code>。</p>
    <textarea id="puppetStateSource" aria-label="状态写法" rows="4" maxlength="4000" placeholder="#身体 身体受伤&#10;#腿部 受伤&#10;#手部 伤口"></textarea>
    <label id="puppetRule">自动切换条件 <input id="puppetCondition" maxlength="300" placeholder="例 受伤变量 或 变量 伤势 >= 2"></label>
    <p class="dim">条件留空可手动调用。多个条件同时成立时用列表中最先满足的状态。</p>
  </details><details class="edit-more"><summary>全身动作</summary>
    <div class="edit-section"><label>动作组 <select id="puppetProgram"></select></label><button type="button" class="small" id="puppetAddProgram">新增动作</button>
      <button type="button" class="small" id="puppetPlay">预览这组动作</button></div>
    <textarea id="puppetProgramSource" aria-label="动作写法" rows="5" maxlength="4000" placeholder="#身体 发力&#10;#右手 挥剑&#10;#等待 0.3"></textarea>
    <p class="dim">攻击和受击已有模板。动作组里的换件和表情会在播完后恢复；可用 <code>#等待 0.3</code> 控制停留。</p>
  </details>`;
}

function previewLibrary(layout) {
  const engine = RpgStudioLayered;
  const operations = source => String(source || '').split(/\r?\n/).map(engine.parseEdit).filter(Boolean);
  const states = Object.fromEntries(Object.entries(layout.states).map(([name, data]) => {
    const selection = { parts: {} };
    for (const op of operations(data.source)) engine.applyEdit(selection, op);
    return [name, selection];
  }));
  const programs = Object.fromEntries(Object.entries(layout.programs).filter(([, data]) => data.source).map(([name, data]) => {
    const ops = operations(data.source).map(op => op[0] === 'wait' ? ['wait', Math.max(1, Math.round(op[1] * 60))] : op);
    const frames = ops.reduce((sum, op) => sum + (op[0] === 'wait' ? op[1] : 0), 0) + (ops.at(-1)?.[0] === 'wait' ? 0 : 36);
    return [name, { ops, frames }];
  }));
  return { ...layout, states, programs };
}

function bindLayeredLibrary(form, callbacks) {
  const { layout, changed, refresh, capture, error } = callbacks;
  const state = $('#puppetState', form), stateSource = $('#puppetStateSource', form), condition = $('#puppetCondition', form);
  const program = $('#puppetProgram', form), programSource = $('#puppetProgramSource', form);
  const options = (items, selected) => items.map(item => `<option ${item === selected ? 'selected' : ''} value="${esc(item)}">${esc(item)}</option>`).join('');
  function showState() {
    const row = layout().states[state.value];
    stateSource.value = row?.source || '';
    condition.value = row?.condition || '';
    $('#puppetRule', form).hidden = state.value === '正常';
  }
  function showProgram() { programSource.value = layout().programs[program.value]?.source || ''; }
  function sync() {
    state.innerHTML = options(['正常', ...Object.keys(layout().states).filter(name => name !== '正常')], state.value);
    program.innerHTML = options([...new Set(['攻击', '受击', ...Object.keys(layout().programs)])], program.value);
    showState(); showProgram();
  }
  async function add(kind, group, select, reserved = []) {
    const name = await promptDialog('新增' + kind, kind + '名称', '');
    if (!name) return;
    if (!puppetName(name) || Object.hasOwn(layout()[group], name) || reserved.includes(name)) {
      error.textContent = kind + '名称已存在或格式不正确。可用中文、字母、数字、下划线或短横线。'; return;
    }
    error.textContent = '';
    layout()[group][name] = { source: '' };
    const option = new Option(name, name, false, true); select.add(option);
    showState(); showProgram(); changed();
  }
  state.onchange = () => { showState(); callbacks.resetParts(); refresh(); };
  program.onchange = showProgram;
  const updateState = () => {
    layout().states[state.value] = { source: stateSource.value, condition: condition.value };
    changed();
  };
  stateSource.oninput = condition.oninput = updateState;
  programSource.oninput = () => {
    if (programSource.value.trim()) layout().programs[program.value] = { source: programSource.value };
    else if (['攻击', '受击'].includes(program.value)) delete layout().programs[program.value];
    else layout().programs[program.value] = { source: '' };
    changed();
  };
  $('#puppetCapture', form).onclick = () => {
    stateSource.value = capture(state.value);
    updateState();
  };
  $('#puppetAddState', form).onclick = () => add('立绘状态', 'states', state, ['正常']);
  $('#puppetAddProgram', form).onclick = () => add('动作', 'programs', program, Object.values(RpgStudioLayered.actions));
  $('#puppetPlay', form).onclick = () => callbacks.play(RpgStudioLayered.builtInLabels[program.value] || program.value);
  return { sync, state: () => state.value || '正常' };
}
