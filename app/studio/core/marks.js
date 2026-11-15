'use strict';
// 事件标识：写在事件页最前面的那条注释里，例如
//     ◆ ：<RpgStudioMark> ♥
// 这一页生效时，游戏里事件头顶会一直有这个标记（演出插件画）；编辑器地图上也显示，方便找事件。
//   为什么放注释里：RPG Maker 编辑器改地图时不会丢注释，自定义字段会被它抹掉。
//   标记可以是 ！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz（画成气泡），也可以是 ev / 打倒 / 序章 这样的短文字（画成常驻小字）。
const MARK = '<RpgStudioMark>';
const MAX = 6;                       // 太长头顶放不下
const isMark = c => !!c && c.code === 108 && String((c.parameters || [])[0] || '').startsWith(MARK);
const get = list => {
  const c = (list || []).find(isMark);
  return c ? String(c.parameters[0]).slice(MARK.length).trim().slice(0, MAX) : '';
};
// 设成 text；空 = 去掉。返回实际存下来的文字
function set(list, text) {
  list = list || [];
  text = String(text == null ? '' : text).trim().slice(0, MAX);
  for (let i = list.length - 1; i >= 0; i--) if (isMark(list[i])) list.splice(i, 1);
  if (text) list.unshift({ code: 108, indent: 0, parameters: [MARK + ' ' + text] });
  return text;
}
// 整个事件的所有页都写上（RPG Maker 的页是互斥的，「事件级标识」只能落到每一页上）
function setAll(pages, text) {
  for (const pg of pages || []) if (pg && pg.list) set(pg.list, text);
  return text;
}
module.exports = { MARK, MAX, isMark, get, set, setAll };
