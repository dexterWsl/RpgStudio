'use strict';
// 结算组用一条注释标记，后面放 RPG Maker 的原生指令。
const MARK = '<RpgStudioSettlement>';
const settlementMark = () => ({ code: 108, indent: 0, parameters: [MARK] });
const isSettlement = event => event?.list?.[0]?.code === 108 && event.list[0].parameters?.[0] === MARK;

function settlementId(events, ref) {
  const q = String(ref || '').trim();
  if (/^\d+$/.test(q)) return isSettlement(events[Number(q)]) ? Number(q) : 0;
  const matches = events.filter(event => isSettlement(event) && String(event.name || '').trim().toLowerCase() === q.toLowerCase());
  return q && matches.length === 1 ? matches[0].id : 0;
}

function settlementRef(events, id) {
  const name = String(events[id]?.name || '').trim();
  return name && settlementId(events, name) === Number(id) ? name : String(id);
}

function settlementBody(event) {
  const end = event?.list?.at(-1);
  if (!isSettlement(event) || event.trigger || end?.code !== 0 || end.indent !== 0) return null;
  const body = event.list.slice(1, -1);
  return body.every(c => [0, 111, 121, 122, 126, 411, 412].includes(c?.code)) ? body : null;
}

module.exports = { isSettlement, settlementId, settlementRef, settlementMark, settlementBody };
