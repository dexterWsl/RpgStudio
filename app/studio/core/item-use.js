'use strict';
const { END, need, UserError } = require('../lib/util.js');

const COMMON_EVENT = 44;
function ownerOf(event) {
  const first = event?.list?.[0];
  const match = first?.code === 108 && /^<RpgStudioItemUse:(\d+):([01])>$/.exec(first.parameters?.[0]);
  return match ? { item: Number(match[1]), prefix: Number(match[2]) } : null;
}

function findUse(item, events) {
  if (!item.id) return null;
  for (const effect of item.effects || []) {
    const event = effect.code === COMMON_EVENT ? events[effect.dataId] : null;
    const owner = ownerOf(event);
    if (owner?.item === item.id) return { event, list: event.list.slice(1 + owner.prefix) };
  }
  return null;
}

const isOriginalCall = (effect, item, events) => effect.code === COMMON_EVENT && ownerOf(events[effect.dataId])?.item !== item.id;

function saveUse(T, entry, events, previous, text, mv) {
  const before = previous?.list || [END()];
  let list = before;
  if (text !== undefined) {
    need(typeof text === 'string' && text.length <= 60000, '物品使用效果最多可写 60000 字');
    const analysis = T.merger.analyzeList(before);
    need(analysis.editable, '请在公共事件页编辑这份使用效果：' + analysis.reason);
    try { list = T.merger.mergeList(before, text, { analysis }).list; }
    catch (error) { throw new UserError(error.message); }
    const problems = T.validator.newProblems(before, list).fresh;
    if (problems.length) throw new UserError(problems.slice(0, 6).map(p => p.msg).join('；'), { problems });
  }
  const effects = entry.effects ||= [];
  const active = list.some(c => c.code !== 0);
  if (!active && !previous) return;
  const event = previous?.event || events.find(e => ownerOf(e)?.item === entry.id);
  const id = event?.id || Math.max(events.length, 1);
  need(!list.some(c => c.code === 117 && c.parameters[0] === id), '物品使用效果不能调用自身');
  const original = effects.filter(effect => isOriginalCall(effect, entry, events));
  const prior = mv && active ? original.at(-1)?.dataId : 0;
  // MV 只会保留最后一个预约的公共事件，先调用原本会执行的那个事件。
  const prefix = prior ? [{ code: 117, indent: 0, parameters: [prior] }] : [];
  const marker = { code: 108, indent: 0, parameters: [`<RpgStudioItemUse:${entry.id}:${prefix.length}>`] };
  events[id] = { ...event, id, name: '物品效果 · ' + entry.name, trigger: 0, switchId: 1, list: [marker, ...prefix, ...list] };
  entry.effects = effects.filter(effect => effect.code !== COMMON_EVENT || effect.dataId !== id);
  if (active) entry.effects.push({ code: COMMON_EVENT, dataId: id, value1: 0, value2: 0 });
}

module.exports = { ownerOf, findUse, isOriginalCall, saveUse };
