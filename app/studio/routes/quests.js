'use strict';
const { need, int } = require('../lib/util.js');
const Quest = require('../core/quests.js');
const { isSettlement } = require('../core/settlements.js');
const { ensureRuntimePlugin } = require('../core/runtime-plugin.js');

module.exports = function (ctx) {
  const { project, where, opts } = ctx;
  const settlementChoices = () => (project.read('CommonEvents.json') || []).filter(isSettlement).map(e => ({ id: e.id, name: e.name }));
  const entry = (T, quest) => ({ ...quest, refs: T.xref.of('quest', quest.id).map(r => ({ ...r, where: where(r.at) })) });
  return {
    get: {
      quests(T) {
        const quests = Quest.questsOf(project.sys()).map(q => entry(T, q));
        return { quests, switches: project.rows('switch').filter(r => r.name), settlements: settlementChoices(), canWrite: !opts.readOnly };
      },
    },
    post: {
      'quest/save'(T, b) {
        const id = int(b.id ?? 0, '任务编号不对');
        const name = String(b.name || '').trim(), description = String(b.description || '').trim();
        const steps = Array.isArray(b.steps) ? b.steps.map(s => String(s || '').trim()) : [];
        need(name && name.length <= 40 && !/[\r\n]/.test(name) && !/^\d+$/.test(name), '任务名要在 1～40 字内，且不能是纯数字');
        need(description.length <= 500, '任务简介最多 500 字');
        need(steps.length >= 1 && steps.length <= 30 && steps.every(s => s && s.length <= 100 && !/[\r\n]/.test(s)), '填写 1～30 个步骤，每步最多 100 字');
        const reward = int(b.reward ?? 0, '结算组不对');
        const acceptSwitch = int(b.acceptSwitch ?? 0), finishSwitch = int(b.finishSwitch ?? 0);
        need(!reward || settlementChoices().some(r => r.id === reward), '请选择现有的结算组');
        for (const sw of [acceptSwitch, finishSwitch]) need(!sw || project.has('switch', sw), '找不到条件开关');
        const saved = T.store.edit(['System.json'], docs => {
          const system = docs['System.json'];
          const quests = Quest.questsOf(system);
          const quest = id ? Quest.questOf(system, String(id)) : null;
          need(!id || quest, '找不到要编辑的任务');
          need(!quests.some(q => q.id !== id && q.name === name), '已有同名任务');
          need(!quest || steps.length >= quest.steps.length, '已保存的任务步骤用于事件和存档，可以修改文字或在末尾增加步骤');
          ensureRuntimePlugin(ctx, Quest);
          const nextId = quest ? quest.id : Math.max(0, ...quests.map(q => q.id)) + 1;
          const variable = quest ? quest.variable : Math.max(1, (system.variables || []).length);
          system.variables ||= [''];
          system.variables[variable] = '任务 #' + nextId + ' ' + name;
          const next = { id: nextId, variable, name, description, steps, reward, acceptSwitch, finishSwitch };
          system[Quest.KEY] = quest ? quests.map(q => q.id === id ? next : q) : [...quests, next];
          return next;
        }).result;
        return { quest: entry(T, saved) };
      },
    },
  };
};
