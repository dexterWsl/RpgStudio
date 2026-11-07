'use strict';
// 交叉引用：每个开关 / 变量 / 公共事件 / 物品 / 图片 / 地图在哪里被用到
//   扫描：所有地图的所有事件页（出现条件 + 指令）、公共事件（触发开关 + 指令）、敌群事件页
//   每条引用：{ kind, id, use: 'check'|'set'|'call'|'show'|'go'|'script', at: 位置, line, text }
//   位置 at：{ type:'map', map, ev, page } | { type:'ce', ce } | { type:'troop', troop, page }
// 另外顺便做全文搜索（台词、选项、事件名、公共事件名、开关/变量名）

const SCRIPT_REFS = [
  [/\$gameSwitches\.(?:setValue|value)\(\s*(\d+)/g, 'switch'],
  [/\$gameVariables\.(?:setValue|value)\(\s*(\d+)/g, 'var'],
  [/\$gameTemp\.reserveCommonEvent\(\s*(\d+)/g, 'ce'],
];

const STR_KINDS = new Set(['picture', 'sprite', 'face']);

function createXref(project, describer) {
  const P = project;

  function each(fn) {
    for (const m of P.mapList()) {
      let data;
      try { data = P.map(m.id); } catch { continue; }
      if (!data) continue;
      for (const e of data.events || []) {
        if (!e) continue;
        (e.pages || []).forEach((pg, pi) => fn({ type: 'map', map: m.id, ev: e.id, page: pi }, pg.list || [], pg.conditions, e));
      }
    }
    for (const c of P.read('CommonEvents.json') || []) if (c) fn({ type: 'ce', ce: c.id }, c.list || [], null, c);
    for (const t of P.read('Troops.json') || []) if (t) (t.pages || []).forEach((pg, pi) => fn({ type: 'troop', troop: t.id, page: pi }, pg.list || [], null, t));
  }

  function build() {
    const refs = [];
    const add = (kind, id, use, at, line, text) => { if (STR_KINDS.has(kind) ? !!id : Number(id) > 0) refs.push({ kind, id: STR_KINDS.has(kind) ? String(id) : Number(id), use, at, line, text }); };
    each((at, list, cond, owner) => {
      // 出现条件
      if (cond) {
        if (cond.switch1Valid) add('switch', cond.switch1Id, 'check', at, -1, '出现条件');
        if (cond.switch2Valid) add('switch', cond.switch2Id, 'check', at, -1, '出现条件');
        if (cond.variableValid) add('var', cond.variableId, 'check', at, -1, `出现条件：≥ ${cond.variableValue}`);
        if (cond.itemValid) add('item', cond.itemId, 'check', at, -1, '出现条件');
        if (cond.actorValid) add('actor', cond.actorId, 'check', at, -1, '出现条件');
      }
      // 事件图像（行走图）
      if (at.type === 'map') {
        const pg = (owner.pages || [])[at.page];
        const im = pg && pg.image;
        if (im && im.characterName) add('sprite', im.characterName + '#' + (im.characterIndex || 0), 'show', at, -1, '事件图像');
      }
      if (at.type === 'ce' && owner.trigger > 0) add('switch', owner.switchId, 'check', at, -1, '触发开关（' + (owner.trigger === 1 ? '自动执行' : '并行处理') + '）');
      list.forEach((c, i) => {
        if (!c) return;
        const p = c.parameters || [];
        const t = () => describer.describe(c);
        switch (c.code) {
          case 111:
            if (p[0] === 0) add('switch', p[1], 'check', at, i, t());
            else if (p[0] === 1) { add('var', p[1], 'check', at, i, t()); if (p[2] === 1) add('var', p[3], 'check', at, i, t()); }
            else if (p[0] === 4) add('actor', p[1], 'check', at, i, t());
            else if (p[0] === 8) add('item', p[1], 'check', at, i, t());
            else if (p[0] === 12) scan(String(p[1] || ''), at, i, 'check');
            break;
          case 121: for (let k = p[0]; k <= p[1] && k - p[0] < 500; k++) add('switch', k, 'set', at, i, t()); break;
          case 122:
            for (let k = p[0]; k <= p[1] && k - p[0] < 500; k++) add('var', k, 'set', at, i, t());
            if (p[3] === 1) add('var', p[4], 'check', at, i, t());
            if (p[3] === 4) scan(String(p[4] || ''), at, i, 'script');
            break;
          case 103: case 104: case 285: add('var', p[0], 'set', at, i, t()); break;
          case 117: add('ce', p[0], 'call', at, i, t()); break;
          case 126: add('item', p[0], 'set', at, i, t()); if (p[2] === 1) add('var', p[3], 'check', at, i, t()); break;
          case 129: add('actor', p[0], 'set', at, i, t()); break;
          case 201: if (p[0] === 0) add('map', p[1], 'go', at, i, t()); else { add('var', p[1], 'check', at, i, t()); add('var', p[2], 'check', at, i, t()); add('var', p[3], 'check', at, i, t()); } break;
          case 231: add('picture', p[1], 'show', at, i, t()); break;
          case 355: case 655: scan(String(p[0] || ''), at, i, 'script'); break;
          case 322:
            if (p[1]) add('sprite', p[1] + '#' + (p[2] || 0), 'set', at, i, '更改角色图像');
            if (p[3]) add('face', p[3] + '#' + (p[4] || 0), 'set', at, i, '更改角色图像');
            break;
          case 101: if (p[0]) add('face', p[0] + '#' + (p[1] || 0), 'say', at, i, t()); if (p[4]) for (const m of String(p[4]).matchAll(/\\N\[(\d+)\]/gi)) add('actor', m[1], 'say', at, i, t()); break;
        }
      });
    });
    // 数据库角色的行走图 / 头像
    for (const a of project.read('Actors.json') || []) {
      if (!a) continue;
      const at = { type: 'actor', actor: a.id };
      if (a.characterName) add('sprite', a.characterName + '#' + (a.characterIndex || 0), 'actor', at, -1, '角色的行走图');
      if (a.faceName) add('face', a.faceName + '#' + (a.faceIndex || 0), 'actor', at, -1, '角色的头像');
    }
    function scan(code, at, i, use) {
      for (const [re, kind] of SCRIPT_REFS) for (const m of code.matchAll(re)) add(kind, m[1], kind === 'ce' ? 'call' : use, at, i, '脚本：' + code.replace(/\s+/g, ' ').slice(0, 60));
    }
    // 按 kind:id 分组
    const by = new Map();
    for (const r of refs) {
      const k = r.kind + ':' + r.id;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return { refs, by };
  }

  const index = () => P.memoize('xref', build);

  function of(kind, id) {
    const key = kind + ':' + (STR_KINDS.has(kind) ? String(id) : Number(id));
    return (index().by.get(key) || []).slice();
  }
  // 一类东西的使用次数：{ id → { check, set, call, ... , total } }
  function counts(kind) {
    const out = {};
    for (const [k, list] of index().by) {
      if (!k.startsWith(kind + ':')) continue;
      const id = k.slice(kind.length + 1);
      const o = out[id] = { total: list.length };
      for (const r of list) o[r.use] = (o[r.use] || 0) + 1;
    }
    return out;
  }

  // 全文搜索
  function search(q, limit = 200) {
    const want = String(q || '').trim().toLowerCase();
    if (!want) return [];
    const hits = [];
    const push = h => { if (hits.length < limit) hits.push(h); };
    const match = s => String(s || '').toLowerCase().includes(want);
    for (const kind of ['switch', 'var']) for (const r of P.rows(kind)) if (r.name && match(r.name)) push({ type: kind, id: r.id, text: r.name });
    for (const r of P.rows('ce')) if (match(r.name)) push({ type: 'ce-name', at: { type: 'ce', ce: r.id }, text: r.name });
    for (const m of P.mapList()) if (match(m.name)) push({ type: 'map-name', at: { type: 'map', map: m.id }, text: m.name });
    each((at, list, cond, owner) => {
      if (hits.length >= limit) return;
      if (at.type === 'map' && at.page === 0 && match(owner.name)) push({ type: 'event-name', at, text: owner.name });
      let speaker = '';
      list.forEach((c, i) => {
        if (!c) return;
        const p = c.parameters || [];
        if (c.code === 101) speaker = P.expandN(p[4] || '');
        if (c.code === 401 || c.code === 405) { const s = P.expandN(p[0]); if (match(s) || (speaker && match(speaker) && c.code === 401 && list[i - 1] && list[i - 1].code === 101)) push({ type: 'line', at, line: i, speaker, text: s }); }
        else if (c.code === 102) { const s = (p[0] || []).join(' / '); if (match(s)) push({ type: 'choice', at, line: i, text: s }); }
        else if ((c.code === 108 || c.code === 408 || c.code === 355 || c.code === 655) && match(p[0])) push({ type: c.code < 300 ? 'comment' : 'script', at, line: i, text: String(p[0]).slice(0, 80) });
        else if (c.code === 357 && match(JSON.stringify(p))) push({ type: 'plugin', at, line: i, text: describer.describe(c) });
      });
    });
    return hits;
  }

  // 没人用的、只写不读的、只读不写的开关 / 变量（剧情排查用）
  function audit(kind) {
    const names = P.rows(kind);
    const c = counts(kind);
    const out = { unusedNamed: [], neverSet: [], neverChecked: [], unnamedUsed: [] };
    const all = new Set([...names.map(r => String(r.id)), ...Object.keys(c)]);
    for (const id of all) {
      const nm = P.name(kind, id);
      const u = c[id] || {};
      if (nm && !u.total) out.unusedNamed.push(Number(id));
      if (u.total && !nm) out.unnamedUsed.push(Number(id));
      if (u.check && !u.set && !u.script) out.neverSet.push(Number(id));
      if (u.set && !u.check && !u.script) out.neverChecked.push(Number(id));
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
    return out;
  }

  return { index, of, counts, search, audit, each };
}

module.exports = { createXref };
