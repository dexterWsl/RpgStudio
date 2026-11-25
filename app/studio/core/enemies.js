'use strict';

const PARAMS = ['最大生命', '最大魔力', '攻击', '防御', '魔攻', '魔防', '敏捷', '幸运'];
const DROP_KINDS = ['', 'item', 'weapon', 'armor'];
const defaultAction = skillId => ({ skillId, rating: 5, conditionType: 0, conditionParam1: 0, conditionParam2: 0 });
const emptyDrop = () => ({ kind: 0, dataId: 1, denominator: 1 });

function newEnemy(id, attack) {
  return { id, name: '', note: '', battlerName: '', battlerHue: 0, exp: 0, gold: 0, params: [35, 0, 6, 3, 0, 0, 5, 5],
    traits: [{ code: 22, dataId: 0, value: 0.95 }],
    actions: attack ? [defaultAction(attack)] : [], dropItems: [emptyDrop(), emptyDrop(), emptyDrop()] };
}

function ensureTroop(troops, enemy, system) {
  const existing = troops.find(troop => troop?.members?.length === 1 && troop.members[0].enemyId === enemy.id && !troop.members[0].hidden);
  if (existing) return existing.id;
  const id = Math.max(troops.length, 1);
  const x = Math.round((system.advanced?.screenWidth || 816) / 2);
  const y = Math.round((system.advanced?.screenHeight || 624) * 0.7);
  troops[id] = { id, name: enemy.name, members: [{ enemyId: enemy.id, x, y, hidden: false }], pages: [] };
  return id;
}

module.exports = { PARAMS, DROP_KINDS, defaultAction, emptyDrop, newEnemy, ensureTroop };
