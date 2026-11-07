'use strict';
// 各路由模块共用的小工具：报错、取整、空白事件页
const clone = o => JSON.parse(JSON.stringify(o));
const END = () => ({ code: 0, indent: 0, parameters: [] });

function blankPage() {
  return {
    conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
    directionFix: false, image: { characterIndex: 0, characterName: '', direction: 2, pattern: 0, tileId: 0 },
    list: [END()],
    moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true,
  };
}

class UserError extends Error { constructor(msg, extra) { super(msg); Object.assign(this, extra || {}); } }
const need = (cond, msg) => { if (!cond) throw new UserError(msg); };
const int = (v, msg) => { const n = Number(v); need(Number.isInteger(n), msg || '需要整数'); return n; };

module.exports = { clone, END, blankPage, UserError, need, int };
