'use strict';
const { isDeepStrictEqual } = require('node:util');
const { need, int, END, UserError } = require('../lib/util.js');
const { isSettlement, settlementRef, settlementMark, settlementBody } = require('../core/settlements.js');

const OPS = ['=', '+', '-', '*', '/', '%'];

function actionLine(action, target) {
  if (action.type === 'switch') return '#开关 ' + target + (action.on ? ' 开' : ' 关');
  if (action.type === 'item') return '#物品 ' + target + ' ' + (action.add ? '+' : '-') + action.count;
  return '#变量 ' + target + ' ' + OPS[action.op] + action.value;
}

function displayText(T, event) {
  const body = settlementBody(event);
  if (!body) return null;
  const name = (kind, id) => {
    const ref = T.script.refText(kind, id);
    return /[\r\n]/.test(ref) ? String(id) : ref;
  };
  try {
    const lines = [];
    for (const { code, indent, parameters: p } of body) {
      let line;
      switch (code) {
        case 0: continue;
        case 411: line = '#否则'; break;
        case 412: line = '#条件结束'; break;
        case 111: {
          const cond = T.describer.condSrc(p);
          const named = cond.replace(/(变量|开关) (\d+) /g, (_, kind, id) => kind + ' ' + name(kind === '变量' ? 'var' : 'switch', id) + ' ');
          let readable;
          try { if (isDeepStrictEqual(T.script.condParams(named, { strict: true, allowMissingTargets: true }), p)) readable = named; } catch { }
          line = '#如果 ' + (readable ?? cond);
          break;
        }
        case 121: line = actionLine({ type: 'switch', on: p[2] === 0 }, name('switch', p[0])); break;
        case 122: line = actionLine({ type: 'var', op: p[2], value: p[4] }, name('var', p[0])); break;
        case 126: line = actionLine({ type: 'item', add: p[1] === 0, count: p[3] }, name('item', p[0])); break;
        default: line = T.script.gameplayLine({ code, indent, parameters: p });
      }
      lines.push('  '.repeat(indent) + line);
    }
    const text = lines.join('\n');
    const built = T.script.scriptCommands(T.script.parseScript(text, { settlement: true, allowMissingTargets: true }));
    const core = c => [c.code, c.indent, c.parameters];
    return isDeepStrictEqual(built.map(core), body.map(core)) ? text : null;
  } catch { return null; }
}

function parseText(T, text) {
  need(typeof text === 'string' && text.trim(), '至少写一条结算指令');
  try { return T.script.parseScript(text, { settlement: true }); }
  catch (error) { throw new UserError(error.message); }
}

function collectActions(items, conditional = false) {
  return items.flatMap(a => a.type === 'if'
    ? [...collectActions(a.then, true), ...collectActions(a.else || [], true)]
    : [{ ...a, conditional }]);
}

module.exports = function ({ project, where, opts }) {
  function impact(T, text, id) {
    const targets = new Map();
    const events = project.read('CommonEvents.json') || [];
    const refsAt = r => ({ at: r.at, line: r.line, use: r.use, text: r.text,
      where: r.at.type === 'ce' && isSettlement(events[r.at.ce]) ? '结算组「' + events[r.at.ce].name + '」' : where(r.at) });
    const actions = collectActions(parseText(T, text));
    need(actions.length, '至少写一条结算指令');
    for (const a of actions) {
      const kind = a.kind || a.type, key = kind + ':' + a.id;
      const label = kind === 'gold' ? '金币' : kind === 'party' ? '全队' : project.label(kind, a.id);
      if (!targets.has(key)) targets.set(key, { kind, id: a.id, label, actions: [],
        refs: T.xref.of(kind, a.id).filter(r => r.at.type !== 'ce' || r.at.ce !== id).map(refsAt) });
      const text = a.type === 'gameplay' ? T.script.gameplayLine(a.commands[0]) : actionLine(a, T.script.refText(kind, a.id));
      targets.get(key).actions.push({ ...a, text });
    }
    return { targets: [...targets.values()], callers: id ? T.xref.of('ce', id).map(refsAt) : [] };
  }
  return {
    get: {
      settlements(T) {
        const events = project.read('CommonEvents.json') || [];
        return { canWrite: !opts.readOnly, groups: events.filter(isSettlement).map(event => {
          const text = displayText(T, event);
          const refs = T.xref.of('ce', event.id);
          return { id: event.id, name: event.name, ref: settlementRef(events, event.id), editable: text !== null, text,
            uses: refs.length, examples: refs.slice(0, 5).map(r => ({ at: r.at, where: where(r.at) })) };
        }) };
      },
      'settlement/impact'(T, q) {
        const id = int(q('id'), '结算组编号不对');
        const text = displayText(T, (project.read('CommonEvents.json') || [])[id]);
        need(text !== null, '找不到可读取的结算组');
        return impact(T, text, id);
      },
    },
    post: {
      'settlement/impact'(T, b) {
        return impact(T, b.text, b.id == null ? 0 : int(b.id, '结算组编号不对'));
      },
      'settlement/save'(T, b) {
        const name = String(b.name || '').trim();
        need(name && name.length <= 40 && !/^\d+$/.test(name) && !/[\r\n]/.test(name), '结算组名称要在 1～40 字内，不能是纯数字');
        const actions = b.text === undefined && Array.isArray(b.actions) ? b.actions.map((a, i) => {
          const pos = '第 ' + (i + 1) + ' 条';
          need(a && ['switch', 'var'].includes(a.type), pos + '的操作类型不对');
          const id = int(a.id, pos + '请选目标开关或变量');
          need(project.has(a.type, id), pos + '的目标不存在');
          if (a.type === 'switch') {
            need(typeof a.on === 'boolean', pos + '请选择开或关');
            return { type: a.type, id, on: a.on };
          }
          need([0, 1, 2].includes(a.op), pos + '请选择赋值、增加或减少');
          need(Number.isSafeInteger(a.value), pos + '的值要填整数');
          return { type: a.type, id, op: a.op, value: a.value };
        }) : parseText(T, b.text);
        need(collectActions(actions).length, '至少写一条结算指令');
        const list = [settlementMark(), ...T.script.scriptCommands(actions), END()];
        let id = b.id == null ? 0 : int(b.id, '结算组编号不对');
        T.store.edit(['CommonEvents.json'], docs => {
          const events = docs['CommonEvents.json'];
          need(!events.some((event, index) => index !== id && isSettlement(event) && String(event.name || '').trim().toLowerCase() === name.toLowerCase()), '已有同名结算组');
          if (b.id != null) need(id > 0 && displayText(T, events[id]) !== null, '这个结算组不存在或含有其它指令，无法编辑');
          else id = Math.max(1, events.length);
          events[id] = { ...events[id], id, name, list, trigger: 0, switchId: 1 };
        });
        return { id, name };
      },
    },
  };
};
