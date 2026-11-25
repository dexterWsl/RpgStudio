'use strict';
const { need } = require('../lib/util.js');
const { questOf, QUEST_STATES, questInstruction, readQuestInstruction } = require('./quests.js');
const { encounterSteps, immunityCommand, immunitySteps } = require('./encounter-commands.js');
const { readShop, formatShop } = require('./shop.js');

const catalogKinds = { 物品: 'item', 武器: 'weapon', 防具: 'armor' };
const shopKinds = Object.keys(catalogKinds);
const basicCodes = [103, 125, 127, 128, 129, 136, 302, 314, 315, 318];
const isQuestCommand = c => !!readQuestInstruction(c);
const signed = (operation, n) => (operation === 0 ? '+' : '-') + n;
const cmd = (code, ...parameters) => ({ code, indent: 0, parameters });

function createGameplayCommands(project, resolve, refText, mz) {
  const ref = (value, kind, allowMissing) => {
    const id = resolve(value, kind);
    need(Number.isSafeInteger(id) && id > 0 && (allowMissing || project.has(kind, id)), '找不到' + project.label(kind, 0).split(' ')[0] + '「' + value + '」');
    return id;
  };
  const amount = number => {
    const value = Number(number);
    need(Number.isSafeInteger(value) && value > 0 && value <= 99999999, '数量需要在 1～99999999 内');
    return value;
  };
  const name = (kind, id) => {
    const value = refText(kind, id);
    return /[\r\n|｜]/.test(value) ? String(id) : value;
  };

  function parse(line, { allowMissingTargets } = {}) {
    const head = /^[#＃]\s*(金币|金钱|武器|防具|队伍|恢复|经验|技能|输入数字|商店|任务|遇敌|免遇敌)(?=\s|[:：]|$)[\s:：]*(.*)$/.exec(line);
    if (!head) return null;
    const [, verb, rest] = head;
    const find = (value, kind) => ref(value, kind, allowMissingTargets);
    const target = value => value === '全队' ? [0, 0] : [0, find(value, 'actor')];
    const result = (commands, kind, id) => ({ type: 'gameplay', commands, kind, id });
    const change = /^(.+?)\s*([+\-−])\s*(\d+)$/.exec(rest);
    if (verb === '遇敌') {
      need(rest === '开' || rest === '关', '遇敌写法示例 #遇敌 开 或 #遇敌 关');
      return result([cmd(136, rest === '开' ? 1 : 0)]);
    }
    if (verb === '免遇敌') {
      need(/^\d+$/.test(rest), '免遇敌写法示例 #免遇敌 1000，写 0 清除保护');
      return result([immunityCommand(encounterSteps(rest))]);
    }
    if (verb === '金币' || verb === '金钱') {
      const gold = /^([+\-−])\s*(\d+)$/.exec(rest);
      need(gold, '金币写法示例 #金币 +100');
      return result([cmd(125, gold[1] === '+' ? 0 : 1, 0, amount(gold[2]))], 'gold', 1);
    }
    if (verb === '武器' || verb === '防具') {
      need(change, `写法示例 #${verb} ${verb === '武器' ? '铁剑' : '皮甲'} +1`);
      const kind = catalogKinds[verb], id = find(change[1], kind);
      return result([cmd(kind === 'weapon' ? 127 : 128, id, change[2] === '+' ? 0 : 1, 0, amount(change[3]), false)], kind, id);
    }
    if (verb === '队伍') {
      const party = /^(.+?)\s+(加入|离队|离开)$/.exec(rest);
      need(party, '队伍写法示例 #队伍 林屿 加入');
      const id = find(party[1], 'actor');
      return result([cmd(129, id, party[2] === '加入' ? 0 : 1, false)], 'actor', id);
    }
    if (verb === '恢复') {
      const who = target(rest);
      return result([cmd(314, ...who)], who[1] ? 'actor' : 'party', who[1] || 1);
    }
    if (verb === '经验') {
      need(change, '经验写法示例 #经验 林屿 +20');
      const who = target(change[1]);
      return result([cmd(315, ...who, change[2] === '+' ? 0 : 1, 0, amount(change[3]), true)], who[1] ? 'actor' : 'party', who[1] || 1);
    }
    if (verb === '技能') {
      const learn = /^(.+?)\s*[|｜]\s*(.+?)\s+(学会|忘记)$/.exec(rest);
      need(learn, '技能写法示例 #技能 林屿 | 治疗 学会');
      const who = target(learn[1].trim()), skill = find(learn[2], 'skill');
      return result([cmd(318, ...who, learn[3] === '学会' ? 0 : 1, skill)], 'skill', skill);
    }
    if (verb === '输入数字') {
      const input = /^(.+?)\s+([1-8])$/.exec(rest);
      need(input, '输入数字写法示例 #输入数字 密码 4，位数为 1～8');
      const id = find(input[1], 'var');
      return result([cmd(103, id, Number(input[2]))]);
    }
    if (verb === '商店') {
      const fields = rest.split(/[|｜]/).map(value => value.trim());
      const buyOnly = fields[fields.length - 1] === '只买';
      if (buyOnly) fields.pop();
      need(fields.length > 0 && fields.length <= 99, '商店要有 1～99 个商品');
      const goods = fields.map(field => {
        const product = /^(物品|武器|防具)\s+(.+?)(?:\s+价格\s+(\d+))?$/.exec(field);
        need(product, '商店写法示例 #商店 物品 回复药 | 武器 铁剑 价格 100 | 只买');
        const price = product[3] == null ? 0 : Number(product[3]);
        need(Number.isSafeInteger(price) && price <= 99999999, '价格需要在 0～99999999 内');
        return [shopKinds.indexOf(product[1]), find(product[2], catalogKinds[product[1]]), product[3] == null ? 0 : 1, price];
      });
      return result(goods.map((good, i) => i ? cmd(605, ...good) : cmd(302, ...good, buyOnly)));
    }
    const action = /^(.+?)\s+(接取|推进\s+\d+|完成|失败)$/.exec(rest);
    need(action, '任务写法示例 #任务 找钥匙 接取、#任务 找钥匙 推进 2、#任务 找钥匙 完成');
    const quest = questOf(project.sys(), action[1]);
    need(quest, '找不到任务「' + action[1] + '」');
    const step = /^推进\s+(\d+)$/.exec(action[2]);
    const value = step ? Number(step[1]) : 0;
    need(!step || (value >= 2 && value <= quest.steps.length), '推进需要指定第 2 步到最后一步中的一个步骤');
    return result(questInstruction({ id: quest.id, action: step ? '推进' : action[2], step: value }, mz));
  }

  function lineOf(c, raw = [c]) {
    const p = c.parameters || [];
    const who = (mode, id) => mode === 0 ? (id === 0 ? '全队' : name('actor', id)) : '';
    switch (c.code) {
      case 103: return '#输入数字 ' + name('var', p[0]) + ' ' + p[1];
      case 125: return '#金币 ' + signed(p[0], p[2]);
      case 127: return '#武器 ' + name('weapon', p[0]) + ' ' + signed(p[1], p[3]);
      case 128: return '#防具 ' + name('armor', p[0]) + ' ' + signed(p[1], p[3]);
      case 129: return '#队伍 ' + name('actor', p[0]) + (p[1] === 0 ? ' 加入' : ' 离队');
      case 136: return p[0] === 0 ? '#遇敌 关' : p[0] === 1 ? '#遇敌 开' : '';
      case 314: return who(p[0], p[1]) ? '#恢复 ' + who(p[0], p[1]) : '';
      case 315: return who(p[0], p[1]) ? '#经验 ' + who(p[0], p[1]) + ' ' + signed(p[2], p[4]) : '';
      case 318: return who(p[0], p[1]) ? '#技能 ' + who(p[0], p[1]) + ' | ' + name('skill', p[3]) + (p[2] === 0 ? ' 学会' : ' 忘记') : '';
      case 302: {
        const goods = raw.map(row => {
          const [kind, id, priced, price] = row.parameters || [];
          return { kind, id, ...(priced ? { price } : {}) };
        });
        return formatShop({ goods, buyOnly: p[4] }, name);
      }
    }
    const steps = raw.length === 1 ? immunitySteps(c) : null;
    if (steps !== null) return '#免遇敌 ' + steps;
    const shop = raw.length === 1 && readShop(c);
    if (shop) return formatShop(shop, name);
    const action = readQuestInstruction(c);
    if (!action) return '';
    const quest = questOf(project.sys(), String(action.id));
    return quest ? '#任务 ' + quest.name + ' ' + action.action + (action.step ? ' ' + action.step : '') : '';
  }

  function condition(text) {
    const m = /^任务\s+(.+?)\s+(未接取|已接取|完成|失败|第\s*\d+\s*步)$/.exec(text);
    if (!m) return null;
    const quest = questOf(project.sys(), m[1]);
    need(quest, '找不到任务「' + m[1] + '」');
    const status = m[2];
    const step = /^第\s*(\d+)\s*步$/.exec(status);
    if (step) need(Number(step[1]) > 0 && Number(step[1]) <= quest.steps.length, '这个任务没有该步骤');
    const value = step ? Number(step[1]) : QUEST_STATES[status];
    return [1, quest.variable, 0, value, status === '已接取' ? 1 : 0];
  }

  return { parse, lineOf, condition };
}

module.exports = { createGameplayCommands, basicCodes, isQuestCommand };
