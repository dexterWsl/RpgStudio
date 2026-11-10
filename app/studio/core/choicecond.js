'use strict';
// 选项条件（WD_ConditionalChoice 这类插件）：条件写在选项文字前面
//   <<[条件]>>   不满足时「锁住」——选项还在，但是灰的、点不了
//   (([条件]))   不满足时直接不显示
// 条件写法（照插件帮助）：s[3] / !s[3]（开关开 / 关）、v[65]<70（变量比较，右边还能写 v[4]、g）、
//   g（金币）、p[3]（角色在队伍）、i[5] / w[5] / a[5]（物品 / 武器 / 护甲）、前面加 ! = 取反；
//   逗号 = 全部成立，分号 = 任意一个成立。
// 条件里面本身带方括号（v[110]<11），所以不能按「不是 ]」来截，要用最短匹配到结尾的 ]>> / ]))
const PREFIX = /^(?:<<\[([\s\S]*?)\]>>|\(\(\[([\s\S]*?)\]\)\))\s*/;

// 「<<[a]>>(([b]))文字」→ { disable: 'a', hide: 'b', text: '文字' }
function split(label) {
  let s = String(label == null ? '' : label);
  const out = { disable: '', hide: '', text: s };
  let m;
  while ((m = PREFIX.exec(s))) {
    if (m[1] != null) out.disable = m[1];
    else out.hide = m[2];
    s = s.slice(m[0].length);
  }
  out.text = s;
  return out;
}

// { disable, hide, text } → 选项文字
function join(cc) {
  const c = cc || {};
  return (c.disable ? '<<[' + c.disable + ']>>' : '') + (c.hide ? '(([' + c.hide + ']))' : '') + String(c.text == null ? '' : c.text);
}

// 「s[3],v[4]>2」→ ['s[3]', 'v[4]>2']；用分号（任意成立）就不拆
function terms(cond) {
  const s = String(cond || '').trim();
  if (!s) return [];
  if (s.includes(';')) return [s];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

const CMP = { '<=': '≤', '>=': '≥', '!=': '≠', '=': '=', '<': '<', '>': '>' };
const kindName = { switch: '开关', var: '变量', item: '物品', weapon: '武器', armor: '护甲', actor: '角色' };

// 一条条件 → 人话。name(kind, id) 给名字
function describeTerm(t, name) {
  let s = String(t || '').trim();
  if (!s) return '';
  let neg = false;
  if (s[0] === '!') { neg = true; s = s.slice(1); }
  const nm = (kind, id) => {
    let label = '';
    try { label = name ? name(kind, id) : ''; } catch { label = ''; }
    return kindName[kind] + ' ' + id + (label ? '「' + label + '」' : '');
  };
  const side = v => {
    const x = String(v || '').trim();
    let m;
    if (x === 'g') return '金币';
    if ((m = /^!?v\[(\d+)\]$/.exec(x))) return nm('var', m[1]);
    if ((m = /^!?g$/.exec(x))) return '金币';
    return x;
  };
  let m;
  if ((m = /^s\[(\d+)\]$/.exec(s))) return nm('switch', m[1]) + (neg ? '为关' : '为开');
  if ((m = /^p\[(\d+)\]$/.exec(s))) return nm('actor', m[1]) + (neg ? '不在队伍' : '在队伍');
  if ((m = /^([iwa])\[(\d+)\]$/.exec(s))) {
    const kind = { i: 'item', w: 'weapon', a: 'armor' }[m[1]];
    return (neg ? '没有' : '持有') + nm(kind, m[2]);
  }
  if ((m = /^v\[(\d+)\]\s*(<=|>=|!=|=|<|>)\s*(.+)$/.exec(s))) return nm('var', m[1]) + ' ' + (CMP[m[2]] || m[2]) + ' ' + side(m[3]);
  if ((m = /^g\s*(<=|>=|!=|=|<|>)\s*(.+)$/.exec(s))) return '金币 ' + (CMP[m[1]] || m[1]) + ' ' + side(m[2]);
  return (neg ? '不满足：' : '') + s;
}

// 整个条件串 → 人话（and / or 用连接词）
function describe(cond, name) {
  const s = String(cond || '').trim();
  if (!s) return '';
  if (s.includes(';')) {
    return s.split(';').map(x => describeTerm(x, name)).filter(Boolean).join(' 或者 ');
  }
  return terms(s).map(x => describeTerm(x, name)).filter(Boolean).join(' 并且 ');
}

module.exports = { split, join, terms, describe, describeTerm, CMP };
