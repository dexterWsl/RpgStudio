'use strict';
// 搜索和结构检查
// ---------- 搜索 ----------
let searchTimer = 0;
$('#q').addEventListener('input', e => { clearTimeout(searchTimer); const v = e.target.value.trim(); searchTimer = setTimeout(() => { if (v) location.hash = '#/search/' + enc(v); }, 350); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { clearTimeout(searchTimer); go('#/search/' + enc(e.target.value.trim())); } });
async function viewSearch(main, q) {
  if ($('#q').value.trim() !== q) $('#q').value = q;
  main.innerHTML = '<div class="loading">正在搜索…</div>';
  const r = await api('search?q=' + enc(q));
  const TYPE = { line: '台词', choice: '选项', 'event-name': '事件名', 'ce-name': '公共事件', 'map-name': '地图', switch: '开关', var: '变量', comment: '注释', script: '脚本', plugin: '插件' };
  const mark = s => esc(s).split(esc(q)).join(`<mark style="background:#3b3216;color:#ffe3a3;border-radius:3px">${esc(q)}</mark>`);
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>搜索「${esc(q)}」</h1><span class="dim">${r.hits.length >= 300 ? '只显示前 300 条' : r.hits.length + ' 条'}</span></div>
    <div class="card rows">${r.hits.map(h => {
      const href = h.type === 'switch' ? `#/names/switch/${h.id}` : h.type === 'var' ? `#/names/var/${h.id}` : hrefOf(h.at);
      const where = h.type === 'switch' || h.type === 'var' ? `${TYPE[h.type]} ${h.id}` : h.where;
      return `<a class="rowlink" href="${href}"><span>${h.speaker ? `<b style="color:var(--c-say);font-weight:600">${esc(h.speaker)}</b>：` : ''}${mark(h.text)}</span><span class="r">${TYPE[h.type] || h.type}</span><span class="sub">${esc(where)}${h.line != null ? ` · 第 ${h.line + 1} 条` : ''}</span></a>`;
    }).join('') || '<div class="empty" style="border:0">没找到</div>'}</div></div>`;
}

// ---------- 结构检查 ----------
async function viewCheck(main) {
  main.innerHTML = '<div class="loading">正在检查所有事件页…</div>';
  const r = await api('check');
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>结构检查</h1><span class="dim">检查每一页的缩进、分支结构，以及引用的开关 / 变量 / 公共事件 / 图片是否存在。只看不改。</span></div>
    ${r.count ? `<div class="card rows">${r.problems.map(p => `<a class="rowlink" href="${hrefOf(p.at)}"><span>${esc(p.where)}</span><span class="r">${p.errors.length} 个问题</span><span class="sub" style="white-space:normal">${p.errors.map(e => esc(`第 ${e.line + 1} 条：${e.msg}`)).join('<br>')}</span></a>`).join('')}</div>
      ${r.count > r.problems.length ? `<p class="dim">只列出前 ${r.problems.length} 页，共 ${r.count} 页有问题</p>` : ''}`
      : '<div class="empty">没有发现问题</div>'}
    <p class="dim" style="margin-top:10px;font-size:12.5px">保存时只拦「保存后新出现的问题」，原来就有的问题不会让你什么都存不了。</p>
  </div>`;
}
