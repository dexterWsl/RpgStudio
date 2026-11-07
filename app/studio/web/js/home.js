'use strict';
// 概览：统计、会自己开始的剧情、台词最多的地方、游戏约定、可能走不到的条件
// ---------- 概览 ----------
async function viewHome(main) {
  main.innerHTML = '<div class="loading">正在整理剧情骨架…</div>';
  const P = S.project;
  const o = await api('overview');
  const stat = (n, t) => `<div class="card stat"><b>${n}</b><span>${t}</span></div>`;
  const auto = o.auto.map(a => `<a class="rowlink" href="${hrefOf(a.at)}"><span>${esc(a.where)}</span><span class="r">${esc(a.trigger)}${a.lines ? ' · ' + a.lines + ' 句' : ''}</span>
    <span class="sub">${a.when.length ? '当 ' + a.when.map(esc).join('，') : '一进地图就开始'}</span></a>`);
  const talky = o.talky.map(a => `<a class="rowlink" href="${hrefOf(a.at)}"><span>${esc(a.where)}</span><span class="r num">${a.lines} 句</span><span class="sub">${esc(a.first)}</span></a>`);
  const audit = (title, list, count, kind) => !count ? '' : `<div class="card note"><h3>${title}（${count}）</h3>
    <p>${list.map(x => `<span class="ref" data-kind="${kind}" data-id="${x.id}" tabindex="0">${esc(x.label)}</span>`).join('，')}${count > list.length ? ' …' : ''}</p></div>`;
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>${esc(P.title)}</h1><span class="tag">${esc(P.engine)}${P.engineVersion ? ' ' + esc(P.engineVersion) : ''}</span></div>
    <div class="meta"><span>${P.encrypted ? '图片加密' : '图片不加密'}</span><span>${esc(P.profile.label)}配置</span>${progAxis() ? `<a href="#/progress">剧情${PTYPE[PROG.config.main.type]}推进（${progAxis().segs.length} ${PROG.config.main.type === 'day' ? '天' : '段'}）</a>` : ''}<a href="#/projects" class="faint" title="${esc(P.dataDir)}">数据在哪</a></div>
    <div class="stats">
      ${stat(P.maps, '张地图')}${stat(o.scenes, '处有台词')}${stat(o.totalLines, '句台词')}${stat(P.commonEvents, '个公共事件')}${stat(P.switches, '个开关')}${stat(P.variables, '个变量')}
    </div>
    <div class="section"><h2>会自己开始的剧情</h2><span class="dim">自动执行 / 并行处理的事件页和公共事件，剧情通常从这里推进</span></div>
    <div class="card rows">${capped(auto, 6, o.autoCount > o.auto.length ? `再显示 ${o.auto.length - 6} 个（共 ${o.autoCount} 个，最多列 ${o.auto.length} 个）` : null) || '<div class="empty" style="border:0">没有自动执行或并行处理的事件</div>'}</div>
    <div class="section"><h2>台词最多的地方</h2></div>
    <div class="card rows">${capped(talky, 6) || '<div class="empty" style="border:0">还没有台词</div>'}</div>
    ${P.profile.notes.length ? foldSec('notes', '这个游戏的约定', `${P.profile.notes.length} 条，来自「${esc(P.profile.label)}」配置`,
      `<div class="notes">${P.profile.notes.map(n => `<div class="card note"><h3>${esc(n.title)}</h3><p>${linkify(n.text)}</p>${n.at ? `<a href="${hrefOf(n.at)}">打开 ${esc(n.where)}</a>` : ''}</div>`).join('')}</div>`) : ''}
    ${(o.audit.switchNeverSetCount || o.audit.varNeverSetCount) ? foldSec('audit', '可能走不到的条件', `被判断，但没有任何事件去打开 / 修改它（${o.audit.switchNeverSetCount + o.audit.varNeverSetCount} 个）`,
      `<div class="notes">${audit('开关', o.audit.switchNeverSet, o.audit.switchNeverSetCount, 'switch')}${audit('变量', o.audit.varNeverSet, o.audit.varNeverSetCount, 'var')}</div><p class="dim" style="font-size:12.5px;margin-top:6px">脚本、插件里改的这里看不到。</p>`) : ''}
  </div>`;
  bindFoldSec(main);
}
