'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { need } = require('../lib/util.js');
const { installRuntimePlugin } = require('./runtime-plugin.js');

const KEY = 'rpgStudioVariableRules';
const PLUGIN = 'RpgStudio_VariableRules';
const PLUGIN_FILE = `js/plugins/${PLUGIN}.js`;
const SOURCE = path.join(__dirname, '../web/variable-rules.js');
const ENTRY = { name: PLUGIN, status: true, description: 'rpgStudio 变量累计与布尔条件组', parameters: {} };
const OPERATORS = ['=', '>=', '<=', '>', '<', '!='];

function rulesOf(system) {
  const config = system?.[KEY];
  return { passive: config?.passive || {}, groups: config?.groups || {} };
}

function parsePassive(data) {
  if (data === undefined || data === null) return data;
  need(data && ['steps', 'time'].includes(data.type), '请选择移动或游戏时间累计');
  need(Number.isSafeInteger(data.every) && data.every > 0 && (data.type !== 'time' || Number.isSafeInteger(data.every * 60)), '累计间隔要是正整数');
  need(Number.isSafeInteger(data.amount) && data.amount > 0, '每次增加的数值要是正整数');
  return { type: data.type, every: data.every, amount: data.amount };
}

function describePassive(rule) {
  return `每 ${rule.every} ${rule.type === 'steps' ? '步' : '秒'}增加 ${rule.amount}`;
}

function changeRule(ctx, system, kind, id, rule) {
  const current = rulesOf(system);
  if (rule) {
    const root = ctx.project.gameRoot();
    need(fs.existsSync(path.join(root, 'js/plugins.js')), '自动累计和布尔条件组需要完整的 RPG Maker 游戏目录，请导入带 js 插件列表的工程。');
    if (!ctx.workDataDir()) installRuntimePlugin(root, ctx.backupsDir(), { entry: ENTRY, source: SOURCE, backupPrefix: 'variable-rules' });
    system[KEY] = { ...current, [kind]: { ...current[kind], [id]: rule } };
  } else if (Object.hasOwn(current[kind], id)) {
    const next = { ...current, [kind]: { ...current[kind] } };
    delete next[kind][id];
    if (Object.keys(next.passive).length || Object.keys(next.groups).length) system[KEY] = next;
    else delete system[KEY];
  }
}

module.exports = { PLUGIN_FILE, SOURCE, ENTRY, OPERATORS, rulesOf, parsePassive, describePassive, changeRule };
