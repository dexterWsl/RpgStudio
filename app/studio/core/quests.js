'use strict';
const path = require('node:path');

const KEY = 'rpgStudioQuests';
const QUEST_STATES = { 未接取: 0, 已接取: 1, 完成: 10000, 失败: -1 };
const name = 'RpgStudio_Quests';
const ENTRY = { name, status: true, description: 'rpgStudio 任务与任务日志', parameters: {} };
const PLUGIN_FILE = 'js/plugins/' + name + '.js';
const SOURCE = path.join(__dirname, '../web/quests-runtime.js');
const questsOf = system => Array.isArray(system?.[KEY]) ? system[KEY] : [];
const used = system => questsOf(system).length > 0;

function questOf(system, ref) {
  const value = String(ref).trim();
  return questsOf(system).find(q => /^\d+$/.test(value) ? q.id === Number(value) : q.name === value);
}

function questInstruction({ id, action, step }, mz) {
  if (!mz) return [{ code: 356, indent: 0, parameters: [`${name} ${id} ${action} ${step}`] }];
  const args = { id: String(id), action, step: String(step) };
  return [
    { code: 357, indent: 0, parameters: [name, 'progress', '任务进度', args] },
    ...Object.entries(args).map(([key, value]) => ({ code: 657, indent: 0, parameters: [key + ' = ' + value] })),
  ];
}

function readQuestInstruction(c) {
  if (c?.code === 357 && c.parameters?.[0] === name && c.parameters[1] === 'progress') {
    const args = c.parameters[3] || {};
    return { id: Number(args.id), action: args.action, step: Number(args.step) };
  }
  if (c?.code !== 356) return null;
  const match = /^RpgStudio_Quests (\d+) (接取|推进|完成|失败) (\d+)$/.exec(c.parameters?.[0]);
  return match ? { id: Number(match[1]), action: match[2], step: Number(match[3]) } : null;
}

module.exports = { KEY, QUEST_STATES, ENTRY, PLUGIN_FILE, SOURCE, used, questsOf, questOf, questInstruction, readQuestInstruction };
