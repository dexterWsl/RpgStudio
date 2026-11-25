'use strict';
const { need, int } = require('../lib/util.js');

const KEY = 'rpgStudioRelationships';
const profileOf = (system, actor) => system[KEY]?.[actor] || { role: '', notes: '', variable: 0, stages: [], links: [] };

function readProfile(body, actor, project) {
  const role = String(body.role ?? '').trim(), notes = String(body.notes ?? '').trim();
  const variable = int(body.variable ?? 0, '请选择好感变量');
  need(role.length <= 80 && notes.length <= 2000, '身份和背景说明太长');
  need(variable === -1 || variable === 0 || project.has('var', variable), '找不到好感变量');
  need(Array.isArray(body.stages) && body.stages.length <= 32, '最多可设置 32 个好感阶段');
  need(Array.isArray(body.links) && body.links.length <= 64, '最多可设置 64 条人物关系');
  const stages = body.stages.map(row => {
    const name = String(row.name ?? '').trim(), min = int(row.min, '好感门槛要填整数');
    need(name && name.length <= 40, '好感阶段名称要有 1～40 字');
    need(Math.abs(min) <= 999999, '好感门槛需在 -999999～999999 内');
    return { name, min };
  }).sort((a, b) => a.min - b.min);
  need(!stages.length || variable !== 0, '设置好感阶段前请先选择或新建好感变量');
  need(new Set(stages.map(row => row.min)).size === stages.length, '好感阶段的门槛不能重复');
  const links = body.links.map(row => {
    const target = int(row.target, '请选择关联的人物');
    const type = String(row.type ?? '').trim(), note = String(row.note ?? '').trim();
    need(target !== actor && project.has('actor', target), '请选择其他人物');
    need(type && type.length <= 40 && note.length <= 240, '关系类型要有 1～40 字，说明最多 240 字');
    return { target, type, note };
  });
  return { role, notes, variable, stages, links };
}

module.exports = { KEY, profileOf, readProfile };
