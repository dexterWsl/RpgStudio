'use strict';
const path = require('node:path');
const { need, int } = require('../lib/util.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');

const KEY = 'rpgStudioExtraConditions';
const SYSTEM_KEY = 'rpgStudioPageConditions';
const ENTRY = { name: 'RpgStudio_PageConditions', status: true, description: 'rpgStudio 事件页条件', parameters: {} };
const SOURCE = path.join(__dirname, '../web/page-conditions-runtime.js');
const PLUGIN_FILE = `js/plugins/${ENTRY.name}.js`;
const used = system => system?.[SYSTEM_KEY] === true;
const extraOf = conditions => Array.isArray(conditions?.[KEY]) ? conditions[KEY] : [];

function termsOf(c) {
  if (!c) return [];
  const terms = [];
  if (c.switch1Valid) terms.push({ kind: 'switch', id: c.switch1Id });
  if (c.switch2Valid) terms.push({ kind: 'switch', id: c.switch2Id });
  if (c.variableValid) terms.push({ kind: 'var', id: c.variableId, value: c.variableValue });
  if (c.selfSwitchValid) terms.push({ kind: 'selfSwitch', channel: c.selfSwitchCh });
  if (c.itemValid) terms.push({ kind: 'item', id: c.itemId });
  if (c.actorValid) terms.push({ kind: 'actor', id: c.actorId });
  return terms.concat(extraOf(c));
}

function checkExtra(rows, project) {
  need(Array.isArray(rows), '追加条件必须是列表');
  return rows.map((row, i) => {
    const kind = row?.kind;
    if (kind === 'selfSwitch') {
      need(['A', 'B', 'C', 'D'].includes(row.channel), '独立开关只能是 A/B/C/D');
      return { kind, channel: row.channel };
    }
    need(['switch', 'var', 'item', 'actor'].includes(kind), `第 ${i + 1} 个追加条件类型不对`);
    const id = int(row.id, `第 ${i + 1} 个追加条件的编号要是整数`);
    need(project.has(kind, id), `第 ${i + 1} 个追加条件引用的编号 ${id} 不存在`);
    if (kind === 'var') {
      need(Number.isSafeInteger(row.value), `第 ${i + 1} 个追加条件的变量值要是整数`);
      return { kind, id, value: row.value };
    }
    return { kind, id };
  });
}

function setExtra(conditions, rows) {
  if (rows.length) conditions[KEY] = rows;
  else delete conditions[KEY];
}

function activate(ctx, system) {
  ensureRuntimePlugin(ctx, { ENTRY, SOURCE });
  system[SYSTEM_KEY] = true;
}

module.exports = { KEY, ENTRY, SOURCE, PLUGIN_FILE, used, extraOf, termsOf, checkExtra, setExtra, activate };
