'use strict';

const IMPACT_OPS = ['set', 'add', 'sub', 'mul', 'div', 'mod'];

function impactButton(kind, id, action = {}) {
  const change = kind === 'switch' ? (action.on === undefined ? '' : action.on ? 'on' : 'off') : IMPACT_OPS[action.op] || '';
  return `<button type="button" class="small quiet impact-button" data-impact-kind="${kind}" data-impact-id="${id}" data-impact-change="${change}" data-impact-value="${esc(action.value ?? '')}">影响范围</button>`;
}

document.addEventListener('click', e => {
  const button = e.target.closest('[data-impact-kind]');
  if (button) showImpact(button.dataset.impactKind, button.dataset.impactId, { change: button.dataset.impactChange, value: button.dataset.impactValue || undefined });
});

function showActionImpact(kind, id, action) {
  showImpact(kind, id, { change: kind === 'switch' ? (action.on ? 'on' : 'off') : IMPACT_OPS[action.op], value: action.value });
}

function showImpact(kind, id, initial = {}) {
  const variable = kind === 'var';
  const editing = !!$('dialog[open]') || S.dirty;
  const dialog = document.createElement('dialog');
  dialog.className = 'dlg-impact';
  dialog.setAttribute('aria-labelledby', 'impactTitle');
  const operations = variable ? [['add', '增加'], ['sub', '减少'], ['set', '赋值为']] : [['on', '打开'], ['off', '关闭']];
  if (variable && ['mul', 'div', 'mod'].includes(initial.change)) operations.push([initial.change, { mul: '乘以', div: '除以', mod: '取余' }[initial.change]]);
  dialog.innerHTML = `<header><h3 id="impactTitle">影响范围</h3><button type="button" class="quiet small" data-impact-close autofocus>关闭</button></header>
    <div class="dbody">
      <div class="impact-controls">
        <div><label for="impactOp">操作</label><select id="impactOp" data-impact-op>${operations.map(([op, text]) => `<option value="${op}" ${op === initial.change ? 'selected' : ''}>${text}</option>`).join('')}</select></div>
        ${variable ? `<div><label for="impactValue">操作数</label><input id="impactValue" type="number" step="1" data-impact-value value="${esc(initial.value ?? 1)}"></div>
          <div><label for="impactBefore">变化前</label><input id="impactBefore" type="number" step="1" data-impact-before placeholder="可选"></div>` : ''}
      </div>
      <p class="dim" data-impact-scenario></p>
      <div data-impact-results aria-live="polite"></div>
      <p class="fnote">事件何时执行取决于地图、事件页优先级和触发方式。试算按这里选的单条操作进行，能识别的脚本引用会单独列出。</p>
    </div>`;
  document.body.appendChild(dialog);
  const select = $('[data-impact-op]', dialog), operand = $('[data-impact-value]', dialog), before = $('[data-impact-before]', dialog);
  const box = $('[data-impact-results]', dialog), scenario = $('[data-impact-scenario]', dialog);
  let generation = 0, timer;
  function resultCard(row, effect) {
    const href = hrefOf(row.at);
    const title = href === '#/' ? `<strong>${esc(row.where)}</strong>`
      : `<a href="${esc(href)}" ${editing ? 'target="_blank" rel="noopener"' : ''}>${esc(row.where)}</a>`;
    const previews = [];
    if (row.rule?.preview?.length) previews.push([row.rule.type === 'branch' ? '成立时' : '指令示例', row.rule.preview]);
    if (row.rule?.alternative?.length) previews.push(['否则', row.rule.alternative]);
    return `<li class="impact-entry"><div>${title}${row.line < 0 ? '' : `<span class="dim">第 ${row.line + 1} 条</span>`}</div>
      <p>${esc(row.text)}</p>${effect ? `<div class="impact-effect">${esc(effect)}</div>` : ''}
      ${previews.map(([title, lines]) => `<p class="dim">${title} · ${esc(lines.join('；'))}</p>`).join('')}</li>`;
  }
  async function load() {
    const request = ++generation;
    const params = new URLSearchParams({ kind, id, change: select.value });
    if (variable) { params.set('value', operand.value); params.set('before', before.value); }
    box.textContent = '正在查找关联事件…';
    box.setAttribute('aria-busy', 'true');
    scenario.textContent = variable ? (before.value ? '' : '变化前留空时，列出可能跨过的条件。')
      : select.value === 'on' ? '按「关 → 开」查看。' : '按「开 → 关」查看。';
    try {
      const result = await api('impact?' + params);
      if (request !== generation || !dialog.open) return;
      $('#impactTitle', dialog).textContent = '影响范围 · ' + result.label;
      if (variable && before.value) scenario.textContent = result.next == null ? '这次操作无法给出整数试算结果。' : `变量 ${Number(before.value)} → ${result.next}`;
      const groups = { changed: [], context: [], stable: [], reads: [], writes: [], scripts: [] };
      for (const row of result.refs) {
        const e = row.effect;
        if (!e) {
          groups[row.use === 'set' ? 'writes' : row.use === 'script' ? 'scripts' : 'reads'].push(resultCard(row));
          continue;
        }
        const messages = impactMessages(row.rule);
        const possible = variable && !before.value ? '可能' : '';
        if (e.enter || e.leave) groups.changed.push(resultCard(row, [e.enter && possible + messages[0], e.leave && possible + messages[1]].filter(Boolean).join('，也')));
        else if (e.context) groups.context.push(resultCard(row, '还取决于其他条件或游戏中的数值'));
        else groups.stable.push(resultCard(row, e.after === true ? '条件继续成立' : e.after === false ? '条件仍未满足' : '此操作不会改变条件结果'));
      }
      const titles = { changed: '可能改变的事件和条件', context: '需要结合游戏状态判断', stable: '条件结果不变', reads: '读取数值的位置', writes: '改动数值的位置', scripts: '脚本引用' };
      box.innerHTML = Object.entries(groups).filter(([, rows]) => rows.length).map(([key, rows]) =>
        `<details class="impact-group" ${key === 'changed' || key === 'context' || (!groups.changed.length && !groups.context.length && key === 'stable') ? 'open' : ''}>
          <summary>${titles[key]} <span class="dim">${rows.length}</span></summary><ul>${rows.join('')}</ul></details>`).join('') || '<p class="dim">暂时没有找到关联事件。</p>';
    } catch (error) {
      if (request === generation && dialog.open) box.innerHTML = `<div class="err">${esc(error.message)}</div>`;
    } finally { if (request === generation && dialog.open) box.removeAttribute('aria-busy'); }
  }
  dialog.addEventListener('close', () => { clearTimeout(timer); dialog.remove(); });
  $('[data-impact-close]', dialog).onclick = () => dialog.close();
  dialog.onclick = e => {
    if (e.target === dialog || (!editing && e.target.closest('a'))) dialog.close();
  };
  select.onchange = () => { clearTimeout(timer); load(); };
  for (const input of [operand, before].filter(Boolean)) input.oninput = () => {
    generation++;
    clearTimeout(timer);
    timer = setTimeout(load, 220);
  };
  dialog.showModal();
  load();
}

function impactMessages(rule) {
  switch (rule.type) {
    case 'page': return [rule.trigger >= 3 ? '满足自动或并行事件页条件' : '满足事件页出现条件', '不再满足此事件页条件'];
    case 'branch': return ['走成立分支', rule.alternative ? '走「否则」分支' : '跳过成立分支'];
    case 'common': return [rule.trigger === 1 ? '允许公共事件自动执行' : '允许公共事件并行处理', '关闭此公共事件的触发条件'];
    case 'battle': return ['满足敌群事件页条件', '不再满足此敌群事件页条件'];
    case 'shop': return ['商品可购买', '商品购买条件未满足'];
    case 'choiceLock': return ['锁定选项', '解除这项锁定条件'];
    case 'choiceHide': return ['隐藏选项', '解除这项隐藏条件'];
    case 'booleanGroup': return ['布尔结果变为 true（开）', '布尔结果变为 false（关）'];
  }
}
