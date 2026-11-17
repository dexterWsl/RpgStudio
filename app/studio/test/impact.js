'use strict';

const assert = require('node:assert/strict');
const { createDescriber } = require('../core/commands.js');
const { createXref } = require('../core/xref.js');
const { outcome } = require('../core/impact.js');

const command = (code, parameters = [], indent = 0) => ({ code, indent, parameters });
const commands = [
  command(111, [1, 1, 0, 10, 1]),
  command(401, ['商店已解锁'], 1),
  command(411),
  command(401, ['积分还不够'], 1),
  command(412),
  command(111, [0, 1, 1]),
  command(401, ['门关着'], 1),
  command(412),
  command(111, [1, 2, 1, 1, 4]),
  command(412),
  command(111, [12, '$gameSwitches.value(1) !== false && $gameVariables.value(1) >= 3']),
  command(412),
  command(102, [['<<[v[1]<8]>>进入商店', '(([!s[1]]))开门']]),
  command(401, ['现在有 \\V[1] 点积分']),
  command(355, ['$gameVariables.value(1 + offset); $gameVariables.setValue(2, 99);']),
  command(122, [1, 600, 1, 0, 2]),
  command(0),
];
const db = {
  'CommonEvents.json': [null, { id: 1, trigger: 1, switchId: 1, list: [command(401, ['门已打开'])] }],
  'Troops.json': [null, { id: 1, pages: [{ conditions: { switchValid: true, switchId: 1, turnValid: true }, list: [] }] }],
};
const project = {
  KIND_LABEL: { var: '变量', switch: '开关' },
  label: (kind, id) => `${kind} ${id}`, name: () => '', expandN: text => text,
  read: file => db[file] || [], count: () => 600,
  mapList: () => [{ id: 1 }],
  map: () => ({ events: [null, { id: 1, pages: [{ conditions: { variableValid: true, variableId: 1, variableValue: 10 }, trigger: 3, list: commands }] }] }),
  memoize: (_, build) => build(),
};
const xref = createXref(project, createDescriber(project));
const vars = xref.of('var', 1), switches = xref.of('switch', 1);
const branch = vars.find(r => r.line === 0);
const check = (row, change, value, before) => outcome(row.rule, row.kind, row.id, change, value, before);

assert.deepEqual(branch.rule.preview, ['商店已解锁']);
assert.deepEqual(branch.rule.alternative, ['积分还不够']);
assert.equal(check(branch, 'add', 1, 9).enter, true);
assert.equal(check(branch, 'add', 1, 4).enter, false);
assert.equal(check(branch, 'sub', 1, 10).leave, true);
assert.equal(check(branch, 'add', -1, 10).leave, true);
assert.equal(check(branch, 'add', 2).leave, false);
assert.equal(check(branch, 'sub', 2).leave, true);
assert.equal(check(branch, 'set', 10).enter, true);
assert.equal(check(branch, 'set', 9).leave, true);
assert.equal(check(vars.find(r => r.rule?.type === 'page'), 'add', 1, 9).enter, true);
assert.equal(check(vars.find(r => r.line === 8), 'add', 1, 9).context, true);
assert.equal(check(switches.find(r => r.line === 5), 'off').enter, true);
assert.equal(check(switches.find(r => r.line === 5), 'on').leave, true);
assert.equal(check(vars.find(r => r.line === 10), 'add', 2, 1).context, true);
assert.equal(check(switches.find(r => r.line === 10), 'off').after, false);
assert.equal(check(switches.find(r => r.rule?.type === 'common'), 'on').enter, true);
assert.equal(check(switches.find(r => r.rule?.type === 'common'), 'off').leave, true);
assert.equal(check(switches.find(r => r.rule?.type === 'battle'), 'on').context, true);
assert.equal(check(vars.find(r => r.rule?.type === 'choiceLock'), 'add', 1, 7).leave, true);
assert.equal(check(switches.find(r => r.rule?.type === 'choiceHide'), 'off').enter, true);
assert(vars.some(r => r.use === 'say'));
assert(!vars.some(r => r.use === 'script'));
assert(xref.of('var', 2).some(r => r.use === 'script'));
assert(xref.of('var', 600).some(r => r.use === 'set'));
console.log('变量增减、开关状态、分支和关联扫描：通过');
