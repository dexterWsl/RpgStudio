'use strict';
// 「位置」：一页事件指令在哪 —— { type: 'map', map, ev, page } 或 { type: 'ce', ce }
// 各路由模块共用：
//   parse(at)            检查请求里给的位置，整理成上面两种之一（不对就报给用户看的错）
//   fileOf(at)           这一页在哪个数据文件里（MapNNN.json / CommonEvents.json）
//   locate(docs, at)     在 store.edit 读出来的文件里找到这一页：{ holder（有 list 的那个）, doc, event }
//   branchRange(list, line)   「选了 …」（第 line 条是 402）这个分支的范围：{ ind, start, end }
const { need, int, UserError } = require('./util.js');

function createAt(project) {
  function parse(at) {
    at = at || {};
    if (at.type === 'map') return { type: 'map', map: int(at.map, '地图编号不对'), ev: int(at.ev, '事件编号不对'), page: int(at.page || 0, '页码不对') };
    if (at.type === 'ce') return { type: 'ce', ce: int(at.ce, '公共事件编号不对') };
    throw new UserError('缺少位置');
  }
  const fileOf = at => (at.type === 'map' ? project.mapFile(at.map) : 'CommonEvents.json');
  function locate(docs, at) {
    if (at.type === 'map') {
      const doc = docs[project.mapFile(at.map)];
      need(doc, '地图 ' + at.map + ' 不存在');
      const e = (doc.events || [])[at.ev];
      need(e, `地图 ${at.map} 里没有事件 ${at.ev}`);
      const pg = e.pages[at.page];
      need(pg, `事件 ${at.ev} 没有第 ${at.page + 1} 页`);
      return { holder: pg, doc, event: e };
    }
    if (at.type === 'ce') {
      const c = (docs['CommonEvents.json'] || [])[at.ce];
      need(c, '公共事件 ' + at.ce + ' 不存在');
      return { holder: c };
    }
    throw new UserError('不认识的位置');
  }
  // 选项分支：402 那一行之后、同缩进的下一个 402 / 403 / 404 之前
  function branchRange(list, line) {
    const head = list[line];
    need(head && head.code === 402, '第 ' + (line + 1) + ' 条不是「选了 …」');
    const ind = head.indent || 0;
    let end = line + 1;
    while (end < list.length && !(list[end] && (list[end].indent || 0) === ind && [402, 403, 404].includes(list[end].code))) end++;
    return { ind, start: line + 1, end };
  }
  return { parse, fileOf, locate, branchRange };
}

module.exports = { createAt };
