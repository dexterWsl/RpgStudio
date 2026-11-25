'use strict';

async function settlementPicker() {
  try {
    const { groups } = await api('settlements');
    const ready = groups.filter(g => g.editable && g.text);
    if (!ready.length) { toast('请先到「结算组」新建一组操作', true); return null; }
    const names = ready.map(g => g.ref === g.name ? g.name : g.id + ' ' + g.name);
    const choice = await chooseDialog('插入结算组', names);
    return choice == null ? null : ready[names.indexOf(choice)]?.ref || null;
  } catch (error) { toast(error.message, true); return null; }
}

async function viewSettlements(main, selectedId) {
  main.innerHTML = '<div class="loading">正在读取结算组…</div>';
  const loading = main.firstElementChild;
  const { groups, canWrite } = await api('settlements');
  if (!loading.isConnected) return;
  const cards = groups.map(group => {
    const examples = group.examples.filter(use => hrefOf(use.at) !== '#/').map(use => '<a class="tag" href="' + esc(hrefOf(use.at)) + '">' + esc(use.where) + '</a>').join('');
    return `<section class="card settlement-card" data-group="${group.id}">
      <div class="settlement-heading"><h2>${esc(group.name || '结算组 ' + group.id)}</h2><span class="dim">调用 ${group.uses} 处</span><span class="sp"></span>
        ${group.text ? '<button type="button" class="small" data-group-impact>影响范围</button>' : ''}
        ${canWrite && group.editable ? '<button type="button" class="small" data-settlement-edit>编辑</button>' : ''}</div>
      ${group.editable ? `<code class="t-code">#结算 ${esc(group.ref)}</code><pre class="settlement-script">${esc(group.text || '还没有结算指令')}</pre>`
        : '<p class="dim">此组含有当前编辑器无法转换成文本的原生指令，或启用了自动触发。</p>'}
      ${examples ? '<div class="settlement-heading">' + examples + '</div>' : ''}</section>`;
  }).join('');
  main.innerHTML = `<div class="page"><div class="titlebar"><h1>结算组</h1><span class="sp"></span>
    ${canWrite ? '<button class="primary small" id="newSettlement">新建结算组</button>' : ''}</div>
    <p class="dim">逐行写奖励、队伍、变量和开关指令，可以加条件。写剧情时用 <code>#结算 组名</code> 调用。</p>
    <div class="settlement-list">${cards || '<div class="empty">还没有结算组</div>'}</div></div>`;
  const edit = async group => {
    try {
      const saved = await settlementDialog(group);
      if (!saved) return;
      toast('已保存结算组「' + saved.name + '」');
      await refreshMaps();
      go('#/settlements/' + saved.id);
    } catch (error) { toast(error.message, true); }
  };
  const create = $('#newSettlement', main);
  if (create) create.onclick = () => edit(null);
  for (const card of $$('[data-group]', main)) {
    const group = groups.find(g => g.id === Number(card.dataset.group));
    const editButton = $('[data-settlement-edit]', card), impactButton = $('[data-group-impact]', card);
    if (editButton) editButton.onclick = () => edit(group);
    if (impactButton) impactButton.onclick = async () => {
      impactButton.disabled = true;
      try {
        const result = await api('settlement/impact?id=' + group.id);
        if (card.isConnected) showSettlementImpact(group.name, result);
      } catch (error) { toast(error.message, true); }
      finally { impactButton.disabled = false; }
    };
    if (group.id === Number(selectedId)) { card.classList.add('settlement-selected'); card.scrollIntoView({ block: 'nearest' }); }
  }
}

async function collectSettlementSelection(text) {
  const source = text.value;
  const { selectionStart, selectionEnd } = text;
  if (!source.slice(selectionStart, selectionEnd).trim()) { toast('先选中要收进结算组的指令', true); return; }
  const first = selectionStart === 0 ? 0 : source.lastIndexOf('\n', selectionStart - 1) + 1;
  const nextLine = source.indexOf('\n', source[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd);
  const last = nextLine < 0 ? source.length : nextLine;
  const selected = source.slice(first, last);
  const body = selected.split('\n').map(line => line.replace(/^[\t ]*(?:│ ?)+/, '')).join('\n').trim();
  const indent = /^[\t │]*/.exec(selected)[0];
  const saved = await settlementDialog(null, { selectedText: body });
  if (!saved || !text.isConnected || text.value !== source) return;
  text.setRangeText(indent + '#结算 ' + saved.name, first, last, 'end');
  text.focus({ preventScroll: true });
  text.dispatchEvent(new Event('input', { bubbles: true }));
  toast('已保存结算组并替换选中的指令');
}

function settlementDialog(group, { selectedText } = {}) {
  const example = '#如果 变量 好感度 >= 3\n  #物品 药水 +1\n  #变量 好感度 +1\n#否则\n  #开关 等待交付 开\n#条件结束';
  const tools = [['item', '物品'], ['var', '变量'], ['switch', '开关'], ['if', '如果']];
  return openDialog(`<header><h3>${selectedText != null ? '收成结算组' : group ? '编辑结算组' : '新建结算组'}</h3><button type="button" class="small" data-group-impact>影响范围</button></header>
    <div class="dbody"><div class="fgrid"><label for="settlementName">组名</label>
      <input id="settlementName" maxlength="40" value="${esc(group?.name || '')}" placeholder="例如 交付任务奖励"></div>
      <div class="edins" role="toolbar" aria-label="插入"><span class="edins-k">插入</span>
        ${tools.map(([kind, label]) => `<button type="button" class="small" data-settlement-insert="${kind}">${label}</button>`).join('')}</div>
      <div class="settlement-pick" hidden></div>
      <textarea class="settlement-source" aria-label="结算指令" spellcheck="false" placeholder="${esc(example)}">${esc(selectedText ?? group?.text ?? '')}</textarea>
      ${selectedText == null ? '' : '<p class="dim">保存结算组后，会将选中的指令替换成一条结算调用。然后可继续编辑和保存当前事件。</p>'}
      ${writingHelp({ settlement: true })}
      <div id="settlementError" role="alert"></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-ok>${selectedText == null ? '保存结算组' : '保存并替换'}</button></footer>`, (d, done) => {
    const name = $('#settlementName', d), text = $('.settlement-source', d), pick = $('.settlement-pick', d);
    const save = $('[data-ok]', d), cancel = $('[data-x]', d), preview = $('[data-group-impact]', d), gen = d._gen;
    const toolbar = $('.edins', d);
    bindWritingHelp(d);
    let saving = false, reading = false, pickVersion = 0;
    const active = () => d.open && d._gen === gen;
    const fail = msg => { $('#settlementError', d).innerHTML = msg ? '<div class="err">' + esc(msg) + '</div>' : ''; };
    function insert(line, selectCondition = false) {
      const start = text.selectionStart, end = text.selectionEnd;
      const pre = start > 0 && text.value[start - 1] !== '\n' ? '\n' : '';
      const post = end < text.value.length && text.value[end] !== '\n' ? '\n' : '';
      text.setRangeText(pre + line + post, start, end, 'end');
      text.focus();
      if (selectCondition) text.setSelectionRange(start + pre.length + '#如果 '.length, start + pre.length + line.indexOf('\n'));
    }
    for (const button of $$('[data-settlement-insert]', toolbar)) button.onclick = async () => {
      const kind = button.dataset.settlementInsert, label = button.textContent;
      const request = ++pickVersion;
      pick.hidden = true;
      if (kind === 'if') { insert('#如果 变量 名字 >= 1\n  \n#条件结束', true); return; }
      try {
        const rows = await lookup(kind);
        if (!active() || request !== pickVersion || saving) return;
        if (!rows.length) { fail('这个工程没有可选的' + label); return; }
        fail('');
        pick.innerHTML = `<select aria-label="选择${label}">${options(rows)}</select><button type="button" class="small">插入${label}</button>`;
        pick.hidden = false;
        const select = $('select', pick);
        $('button', pick).onclick = () => {
          const row = rows[select.selectedIndex], target = row.name.trim();
          const unique = target && !/[\r\n]/.test(target) && !/^\d+$/.test(target) && rows.find(a => a.name.trim().toLowerCase() === target.toLowerCase())?.id === row.id;
          pick.hidden = true;
          insert('#' + label + ' ' + (unique ? target : row.id) + (kind === 'switch' ? ' 开' : ' +1'));
        };
        select.focus();
      } catch (error) { if (active() && request === pickVersion) fail(error.message); }
    };
    d.classList.add('dlg-settlement');
    const preventClose = event => { if (saving) event.preventDefault(); };
    d.addEventListener('cancel', preventClose);
    d.addEventListener('close', () => { d.classList.remove('dlg-settlement'); d.removeEventListener('cancel', preventClose); }, { once: true });
    d.onclick = event => { if (event.target === d && !saving) done(null); };
    cancel.onclick = () => done(null);
    preview.onclick = async () => {
      if (reading || saving) return;
      fail('');
      reading = preview.disabled = true;
      try {
        const result = await api('settlement/impact', { id: group?.id, text: text.value });
        if (active() && !saving) showSettlementImpact(name.value, result);
      } catch (error) { if (active()) fail(error.message); }
      finally { if (active()) { reading = false; preview.disabled = saving; } }
    };
    save.onclick = async () => {
      if (saving) return;
      fail('');
      saving = save.disabled = cancel.disabled = preview.disabled = name.disabled = text.disabled = toolbar.inert = pick.inert = true;
      try {
        const result = await api('settlement/save', { id: group?.id, name: name.value, text: text.value });
        if (active()) done(result);
      } catch (error) { if (active()) fail(error.message); }
      finally {
        if (active()) {
          saving = save.disabled = cancel.disabled = name.disabled = text.disabled = toolbar.inert = pick.inert = false;
          preview.disabled = reading;
        }
      }
    };
    text.onkeydown = e => {
      if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save.click(); }
    };
    text.setSelectionRange(text.value.length, text.value.length);
    name.focus();
  });
}

function showSettlementImpact(name, { targets, callers }) {
  const editing = $('#dlg').open;
  const d = document.createElement('dialog');
  d.className = 'dlg-impact';
  d.setAttribute('aria-labelledby', 'groupImpactTitle');
  const usage = { check: '读取／判断', set: '修改', script: '脚本引用', say: '显示' };
  const links = rows => rows.map(r => {
    const href = hrefOf(r.at), where = esc(r.where);
    return `<li class="impact-entry"><div>${href === '#/' ? `<strong>${where}</strong>` : `<a href="${esc(href)}" ${editing ? 'target="_blank" rel="noopener"' : ''}>${where}</a>`}
      ${r.line < 0 ? '' : `<span class="dim">第 ${r.line + 1} 条</span>`}</div><p>${usage[r.use] ? usage[r.use] + ' · ' : ''}${esc(r.text)}</p></li>`;
  }).join('');
  d.innerHTML = `<header><h3 id="groupImpactTitle">影响范围${name.trim() ? ' · ' + esc(name.trim()) : ''}</h3><button type="button" class="quiet small" data-x autofocus>关闭</button></header>
    <div class="dbody"><p class="dim">列出本组会修改的目标和相关事件。条件里的指令只在对应分支执行。</p>
      ${targets.map((t, ti) => `<details class="impact-group" open><summary>${esc(t.label)} <span class="dim">${t.refs.length} 处关联</span></summary>
        <ul class="group-impact-actions">${t.actions.map((a, ai) => `<li><code>${esc(a.text)}</code><span class="dim">第 ${a.line} 行${a.conditional ? ' · 条件内' : ''}</span>
          ${['var', 'switch'].includes(t.kind) ? `<button type="button" class="small quiet" data-try="${ti}:${ai}">试算</button>` : ''}</li>`).join('')}</ul>
        ${t.refs.length ? `<ul>${links(t.refs)}</ul>` : '<p class="dim">未找到其他事件引用。</p>'}</details>`).join('')}
      ${callers.length ? `<details class="impact-group"><summary>调用此结算组 <span class="dim">${callers.length} 处</span></summary><ul>${links(callers)}</ul></details>` : ''}</div>`;
  document.body.appendChild(d);
  $('[data-x]', d).onclick = () => d.close();
  d.onclick = e => { if (e.target === d || (!editing && e.target.closest('a'))) d.close(); };
  for (const button of $$('[data-try]', d)) button.onclick = () => {
    const [ti, ai] = button.dataset.try.split(':').map(Number), t = targets[ti];
    showActionImpact(t.kind, t.id, t.actions[ai]);
  };
  d.addEventListener('close', () => d.remove(), { once: true });
  d.showModal();
}
