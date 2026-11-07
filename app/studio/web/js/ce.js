'use strict';
// 公共事件：阅读 / 改台词、改名和触发、新建
// ---------- 公共事件 ----------
async function viewCe(main, id) {
  if (S.tab !== 'ces') { S.tab = 'ces'; remember(); drawNav(); }
  main.innerHTML = '<div class="loading">正在读取公共事件…</div>';
  const c = await api('ce?id=' + id);
  const callers = capped(c.calledFrom.map(x => `<a class="rowlink" href="${hrefOf(x.at)}"><span>${esc(x.where)}</span><span class="r">第 ${x.line + 1} 条</span></a>`), 6);
  main.innerHTML = `<div class="page">
    <div class="crumbs"><span>公共事件</span></div>
    <div class="titlebar"><h1><span class="id num">公共事件 ${c.id}</span>${esc(c.name || '（未命名）')}</h1>${c.isScene ? '<a class="tag acc" href="#/scenes">场景</a>' : ''}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}<span class="sp"></span>
      ${c.isScene ? '<button class="small" id="cePlace">放到地图</button>' : ''}<button class="small" id="ceSet">改名和触发</button>${moreMenu([{ id: 'ceRecall', label: '加进回想房' }, { id: 'ceScene', label: c.isScene ? '移出场景库（内容不动）' : '加进场景库' }])}</div>
    <div class="card when2">
      <div class="wl"><span class="wk">开始</span><span class="wv">${linkify(c.triggerText)}</span></div>
      <div class="wl"><span class="wk">调用</span>${c.calledFrom.length ? `<button type="button" class="linkbtn" id="toCallers">${c.calledFrom.length} 处</button>` : '<span class="wv none">没有事件调用它</span>'}</div>
    </div>
    <div id="pageBody"></div>
    ${callers ? `<div class="section" id="ceCallers"><h2>调用它的地方</h2></div><div class="card rows">${callers}</div>` : ''}
  </div>`;
  $('#ceSet').onclick = () => ceDialog(c);
  bindMenu(main);
  $('#ceRecall').onclick = () => recallAddDialog([{ type: 'ce', ce: id }]);
  $('#ceScene').onclick = async () => {
    try { await api('scene/mark', { id, on: !c.isScene }); toast(c.isScene ? '已移出场景库' : '已加进场景库'); render(); } catch (e) { toast(e.message, true); }
  };
  if ($('#cePlace')) $('#cePlace').onclick = () => { PW.placing = { id, name: c.name }; toast(progAxis() ? '选好哪一天，再点地图上的空格子' : '点地图上的空格子放这个场景'); location.hash = '#/progress'; };
  if ($('#toCallers')) $('#toCallers').onclick = () => $('#ceCallers').scrollIntoView({ behavior: 'smooth', block: 'start' });
  pageBody($('#pageBody'), c, { type: 'ce', ce: id });
}


async function ceDialog(c) {
  const sw = await lookup('switch');
  const r = await openDialog(`<header><h3>公共事件 ${c.id}</h3></header>
    <div class="dbody"><div class="fgrid">
      <label for="ce_n">名字</label><input id="ce_n" maxlength="40" value="${esc(c.name)}">
      <label for="ce_t">触发</label><select id="ce_t">${['无（只能被调用）', '自动执行', '并行处理'].map((t, i) => `<option value="${i}" ${c.trigger === i ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label for="ce_s">条件开关</label><select id="ce_s">${options(sw, c.switchId)}</select>
    </div><div class="fnote">触发选「自动执行 / 并行处理」时，条件开关打开后它就会开始运行。</div><div id="ceErr"></div></div>
    <footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>保存</button></footer>`,
    (d, done) => {
      const sync = () => { $('#ce_s', d).disabled = $('#ce_t', d).value === '0'; };
      $('#ce_t', d).onchange = sync; sync();
      $('[data-x]', d).onclick = () => done(null);
      $('[data-ok]', d).onclick = async () => {
        try { await api('ce/update', { id: c.id, name: $('#ce_n', d).value, trigger: Number($('#ce_t', d).value), switchId: Number($('#ce_s', d).value) }); done(true); }
        catch (e) { $('#ceErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  if (r) { toast('已保存'); await refreshMaps(); render(); }
}
async function newCeDialog() {
  const name = await promptDialog('新建公共事件', '名字（会用第一个空着的公共事件）', '');
  if (!name) return;
  try { const r = await api('ce/create', { name }); toast('已新建公共事件 ' + r.id); await refreshMaps(); location.hash = '#/ce/' + r.id; } catch (e) { toast(e.message, true); }
}
