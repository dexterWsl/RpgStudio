const EXTRA_PAGE_CONDITIONS = 'rpgStudioExtraConditions';
const PAGE_CONDITION_FIELDS = {
  switch: { label: '开关', slots: ['switch1', 'switch2'] },
  var: { label: '变量', slots: ['variable'] },
  selfSwitch: { label: '独立开关', slots: ['selfSwitch'] },
  item: { label: '持有物品', slots: ['item'] },
  actor: { label: '角色在队伍', slots: ['actor'] },
};

function bindPageConditions(d, initial, choices) {
  const box = $('#extraPageConditions', d);
  const checked = row => $('input[type=checkbox]', row);
  const keyOf = row => $('select', row).value;
  const sync = () => {
    const count = $$('.frow input[type=checkbox]:checked', d).length;
    $('#cNone', d).hidden = count > 0;
    $('#cAnd', d).hidden = count < 2;
  };
  const rows = kind => [
    ...PAGE_CONDITION_FIELDS[kind].slots.map(slot => $('[data-row="' + slot + '"]', d)),
    ...$$('[data-extra="' + kind + '"]', box),
  ];

  function bindRow(row) {
    checked(row).onchange = () => {
      if (!checked(row).checked) {
        if (row.dataset.extra) row.remove();
        else row.hidden = true;
      }
      sync();
    };
  }

  function append(kind) {
    const label = PAGE_CONDITION_FIELDS[kind].label;
    const row = document.createElement('div');
    row.className = 'frow';
    row.dataset.extra = kind;
    const opts = kind === 'selfSwitch' ? ['A', 'B', 'C', 'D'].map(ch => `<option>${ch}</option>`).join('') : options(choices[kind]);
    const operand = kind === 'var'
      ? '<span class="dim">≥</span><input type="number" class="n num" aria-label="变量下限" value="0">'
      : ['switch', 'selfSwitch'].includes(kind) ? '<span class="dim">为开</span>' : '';
    row.innerHTML = `<input type="checkbox" checked aria-label="启用${label}条件"><span>${label}</span>
      <div class="ins"><select aria-label="${label}">${opts}</select>${operand}</div>`;
    box.append(row);
    bindRow(row);
    return row;
  }

  function add(kind, term = {}, focus = true) {
    const key = term.id ?? term.channel;
    const all = rows(kind);
    const active = all.filter(row => checked(row).checked);
    const existing = key == null ? null : active.find(row => keyOf(row) === String(key));
    const row = existing || all.find(row => !checked(row).checked) || append(kind);
    const select = $('select', row);
    const threshold = $('input[type=number]', row);
    if (key != null) select.value = String(key);
    else {
      const used = new Set(active.map(keyOf));
      const option = [...select.options].find(o => !used.has(o.value));
      if (option) select.value = option.value;
    }
    if (threshold && (!existing || term.value != null)) threshold.value = term.value ?? 0;
    row.hidden = false;
    checked(row).checked = true;
    if (focus) {
      (existing && threshold ? threshold : select).focus();
      if (existing && threshold) threshold.select();
    }
    sync();
  }

  function remove(kind, matches) {
    for (const row of rows(kind)) {
      if (!checked(row).checked || !matches(Number(keyOf(row)))) continue;
      checked(row).checked = false;
      checked(row).onchange();
    }
  }

  function addChoice(kind, { id, name }) {
    choices[kind] = choices[kind].filter(o => o.id !== id).concat({ id, name }).sort((a, b) => a.id - b.id);
    $('[data-add="' + kind + '"]', d).disabled = false;
    for (const row of rows(kind)) {
      const select = $('select', row);
      select.innerHTML = options(choices[kind], select.value);
    }
    add(kind, { id });
  }

  function extras() {
    return [...box.children].map(row => {
      const kind = row.dataset.extra;
      const key = keyOf(row);
      if (kind === 'selfSwitch') return { kind, channel: key };
      const id = Number(key);
      if (kind === 'var') return { kind, id, value: $('input[type=number]', row).valueAsNumber };
      return { kind, id };
    });
  }

  $$('[data-row]', d).forEach(bindRow);
  const saved = initial[EXTRA_PAGE_CONDITIONS];
  for (const term of Array.isArray(saved) ? saved : []) {
    if (!Object.hasOwn(PAGE_CONDITION_FIELDS, term?.kind)) continue;
    const row = append(term.kind);
    $('select', row).value = term.channel ?? term.id;
    if (term.kind === 'var') $('input[type=number]', row).value = term.value;
  }
  $$('[data-add]', d).forEach(button => {
    const kind = button.dataset.add;
    button.disabled = kind !== 'selfSwitch' && !choices[kind].length;
    button.onclick = () => add(kind);
  });
  sync();
  return { add, remove, addChoice, extras };
}
