'use strict';

const choicecond = require('./choicecond.js');

const ref = (kind, id) => ({ kind, id });
const other = ref('other', 0);
const compare = (left, op, right) => ({ left, op, right });
const switchTest = (id, on = true) => compare(ref('switch', id), '=', on);
const varTest = (id, op, right) => compare(ref('var', id), op, right);
const unknownTest = compare(other, '=', true);
const OPS = ['=', '>=', '<=', '>', '<', '!='];

function commandTest(p, describer) {
  if (p[0] === 0) return [[switchTest(p[1], p[2] === 0)]];
  if (p[0] === 1) return [[varTest(p[1], OPS[p[4]], p[2] === 0 ? p[3] : ref('var', p[3]))]];
  if (p[0] !== 12) return null;
  return describer.parseCondScript(p[1])?.map(group => group.map(t => t.kind === 'switch'
    ? switchTest(t.id, t.on) : varTest(t.id, OPS[t.op], t.val))) || null;
}

function pageTest(c) {
  const terms = [];
  if (c.switch1Valid) terms.push(switchTest(c.switch1Id));
  if (c.switch2Valid) terms.push(switchTest(c.switch2Id));
  if (c.variableValid) terms.push(varTest(c.variableId, '>=', c.variableValue));
  if (c.selfSwitchValid || c.itemValid || c.actorValid) terms.push(unknownTest);
  return [terms];
}

function choiceTest(source) {
  const { terms, or } = choicecond.parts(source);
  const operand = token => {
    const m = /^([sv])\[(\d+)\]$/.exec(token);
    if (m) return ref(m[1] === 's' ? 'switch' : 'var', Number(m[2]));
    return /^[-+]?\d+$/.test(token) ? Number(token) : other;
  };
  const tests = terms.map(choicecond.parseTerm).filter(Boolean).map(t => ({
    ...compare(operand(t.a), t.op ? t.op.replace(/^(===|==)$/, '=').replace('!==', '!=') : '>', t.op ? operand(t.b) : 0),
    numeric: true, neg: t.neg,
  }));
  return or ? tests.map(t => [t]) : [tests];
}

function targets(groups) {
  const byId = new Map();
  for (const t of groups.flat()) for (const x of [t.left, t.right]) {
    if (x?.kind === 'switch' || x?.kind === 'var') byId.set(x.kind + ':' + x.id, x);
  }
  return byId.values();
}

const matches = (operand, kind, id) => operand?.kind === kind && Number(operand.id) === id;

function test(groups, kind, id, value) {
  const resolve = operand => {
    if (matches(operand, kind, id)) return value;
    return typeof operand === 'number' || typeof operand === 'boolean' ? operand : null;
  };
  const evaluate = t => {
    let left = resolve(t.left), right = resolve(t.right);
    if (left === null || right === null) return null;
    if (t.numeric) { left = Number(left); right = Number(right); }
    const result = { '=': left === right, '!=': left !== right, '>=': left >= right, '<=': left <= right, '>': left > right, '<': left < right }[t.op];
    return result === undefined ? null : t.neg ? !result : result;
  };
  const groupResults = groups.map(g => {
    const results = g.map(evaluate);
    return results.includes(false) ? false : results.includes(null) ? null : true;
  });
  return groupResults.includes(true) ? true : groupResults.includes(null) ? null : false;
}

function changedValue(change, value, old) {
  switch (change) {
    case 'set': return value;
    case 'mul': return old * value;
    case 'div': return Math.floor(old / value);
    case 'mod': return old % value;
    case 'sub': return old - value;
    default: return old + value;
  }
}

function outcome(rule, kind, id, change, value, before) {
  if (!rule) return null;
  if (kind === 'switch') return compareStates([change === 'off'], () => change === 'on');
  const delta = change === 'add' ? value : change === 'sub' ? -value : null;
  const next = old => changedValue(change, value, old);
  if (before != null) return compareStates([before], next);
  if (delta === 0) return { enter: false, leave: false, context: false };
  if (change !== 'set' && delta === null) return { enter: false, leave: false, context: true };
  // 两次比较只可能在阈值或平移后的阈值处改变；各检查边界和相邻整数。
  const samples = new Set([0]);
  for (const t of rule.groups.flat()) {
    const bounds = [matches(t.left, kind, id) ? t.right : t.left];
    if (typeof bounds[0] !== 'number') continue;
    if (delta !== null) bounds.push(bounds[0] - delta);
    for (const n of bounds) for (const offset of [-1, 0, 1]) samples.add(n + offset);
  }
  return compareStates(samples, next);

  function compareStates(samples, next) {
    const result = { enter: false, leave: false, context: false, before: null, after: null };
    for (const old of samples) {
      const updated = next(old);
      if (kind === 'var' && (!Number.isSafeInteger(old) || !Number.isSafeInteger(updated))) { result.context = true; continue; }
      const a = test(rule.groups, kind, id, old), b = test(rule.groups, kind, id, updated);
      if (kind === 'switch' || before != null) { result.before = a; result.after = b; }
      if (a === null || b === null) result.context = true;
      else if (a === false && b === true) result.enter = true;
      else if (a === true && b === false) result.leave = true;
    }
    return result;
  }
}

module.exports = { switchTest, unknownTest, commandTest, pageTest, choiceTest, targets, changedValue, outcome };
