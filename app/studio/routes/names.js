'use strict';
// 开关 / 变量：列表、改名、新建
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');

module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  function namesView(T, kind) {
    const counts = T.xref.counts(kind);
    const audit = T.xref.audit(kind);
    const flag = {};
    for (const [k, ids] of Object.entries(audit)) for (const id of ids) (flag[id] = flag[id] || []).push(k);
    const n = project.count(kind);
    let own = new Map();
    try { own = T.people.owners(kind); } catch { /* 人物统计失败不影响列表 */ }
    const out = [];
    for (let id = 1; id <= n; id++) {
      const name = project.name(kind, id);
      const c = counts[id] || {};
      if (!name && !c.total) continue;
      const o = own.get(id) || { shared: 0, people: [] };
      out.push({ id, name, hint: hint(kind + ':' + id), check: c.check || 0, set: c.set || 0, script: c.script || 0, total: c.total || 0, flags: flag[id] || [], people: o.people, shared: o.shared });
    }
    return { kind, total: n, rows: out, free: freeSlot(T, kind) };
  }
  // 第一个没名字、也没被用过的编号（新建开关/变量用）
  function freeSlot(T, kind) {
    const counts = T.xref.counts(kind);
    const n = project.count(kind);
    for (let id = 1; id <= n; id++) if (!project.name(kind, id).trim() && !counts[id]) return id;
    return n + 1;
  }
  Object.assign(V, { freeSlot });
  return {
    get: {
      names: (T, q) => namesView(T, q('kind') === 'var' ? 'var' : 'switch'),
    },
    post: {
    // 开关 / 变量改名；id = 'new' 时用第一个空着的编号（不够就往后加）
    name(T, b) {
      const kind = b.kind === 'var' ? 'var' : b.kind === 'switch' ? 'switch' : null;
      need(kind, '只能改开关或变量的名字');
      const name = String(b.name || '').trim().slice(0, 40);
      let id = b.id === 'new' ? freeSlot(T, kind) : int(b.id);
      need(id >= 1 && id <= 5000, '编号不对');
      if (b.id === 'new') need(name, '起个名字');
      T.store.edit(['System.json'], docs => {
        const arr = docs['System.json'][kind === 'var' ? 'variables' : 'switches'];
        need(id < arr.length || b.id === 'new', '编号超出范围');
        while (arr.length <= id) arr.push('');
        arr[id] = name;
      });
      return { id, kind, name };
    },
    },
  };
};
