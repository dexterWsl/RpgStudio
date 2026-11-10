'use strict';
// 选项条件：写在选项文字里的两种标记（WD_ConditionalChoice 插件的写法；游戏里没装这个插件时，
// 编辑器自带的演出插件 RpgStudio_Stage 按同样的规则来演，见 core/stage.js）
//
//   <<[条件]>>   条件「成立」时锁住：选项还在，但是灰的、点不了
//   (([条件]))   条件「成立」时不显示
//
//   注意方向：标记里写的是「什么时候不让选」。编辑器给人看、让人填的是反过来的「要满足什么才能选 / 才显示」，
//   存的时候再取反（need ⇄ tag，见 negate）。
//
// 条件写法（照插件帮助）：
//   s[3] / !s[3]        开关 3 开 / 关
//   v[65]<70            变量比较：= != > >= < <=，右边可以是数字、v[4]、g（金币）、i[5]（物品个数）
//   g>=100              金币
//   p[3] / !p[3]        角色 3 在 / 不在队伍
//   i[5] w[5] a[5]      持有物品 / 武器 / 护甲（武器护甲算装备着的）；也能比较个数：i[6]>=v[4]
//   前面加 ! = 取反；逗号 = 全部成立，分号 = 任意一个成立（两种混着写 = 全部成立）
//   插件 2.4 起标记可以出现在文字的任何位置

const DISABLE_RE = /<<\[(.*?)\]>>/;
const HIDE_RE = /\(\(\[(.*?)\]\)\)/;
const ANY_RE = /<<\[(.*?)\]>>|\(\(\[(.*?)\]\)\)/g;

// 「<<[a]>>(([b]))文字」→ { disable: 'a', hide: 'b', text: '文字' }
function split(label) {
  const s = String(label == null ? '' : label);
  const d = DISABLE_RE.exec(s), h = HIDE_RE.exec(s);
  return { disable: d ? d[1] : '', hide: h ? h[1] : '', text: s.replace(ANY_RE, '') };
}
const has = label => { const c = split(label); return !!(c.disable || c.hide); };

// { disable, hide, text } → 选项文字（标记放在最前面）
function join(cc) {
  const c = cc || {};
  return (c.disable ? '<<[' + c.disable + ']>>' : '') + (c.hide ? '(([' + c.hide + ']))' : '') + String(c.text == null ? '' : c.text);
}

// ---------- 一条条件 ----------
// 拆成 { neg, a, op, b }：照插件的切法（运算对象 / 比较符号 / 数字），剩下的只能是一个「!」
const TOKEN_RE = /[sviwap]\[\d+\]|g|===|==|<=|>=|!==|!=|=|<|>|[-+]?\d+/g;
const OPS = new Set(['===', '==', '=', '!==', '!=', '<=', '>=', '<', '>']);
function parseTerm(t) {
  const s = String(t || '').replace(/\s+/g, '');
  const toks = s.match(TOKEN_RE) || [];
  let rest = s;
  for (const k of toks) rest = rest.replace(k, '');
  if (rest !== '' && rest !== '!') return null;
  if (toks.length === 1 && !OPS.has(toks[0])) return { neg: rest === '!', a: toks[0], op: '', b: '' };
  if (toks.length === 3 && !OPS.has(toks[0]) && OPS.has(toks[1]) && !OPS.has(toks[2])) return { neg: rest === '!', a: toks[0], op: toks[1], b: toks[2] };
  return null;
}
const termText = x => (x.neg ? '!' : '') + x.a + x.op + x.b;
const FLIP = { '<': '>=', '>=': '<', '>': '<=', '<=': '>', '=': '!=', '==': '!=', '===': '!=', '!=': '=', '!==': '=' };
// 一条取反：带 ! 的去掉 !；比较的换成相反的比较（v[1]<5 → v[1]>=5，读起来比 !v[1]<5 顺）；其它前面加 !
function negateTerm(t) {
  const x = parseTerm(t);
  if (!x) { const s = String(t || '').trim(); return s[0] === '!' ? s.slice(1) : '!' + s; }
  if (x.neg) return termText({ ...x, neg: false });
  if (x.op) return termText({ ...x, op: FLIP[x.op] });
  return termText({ ...x, neg: true });
}

// 整串 → { or, terms }（照插件：只有分号 = 任意成立；其它 = 全部成立）
function parts(cond) {
  const s = String(cond || '').replace(/\s+/g, '');
  if (!s) return { or: false, terms: [] };
  const or = s.includes(';') && !s.includes(',');
  return { or, terms: s.split(/[;,]/).filter(Boolean) };
}
const terms = cond => parts(cond).terms;
// 整串取反（德摩根）：全部成立 ⇄ 任意一个不成立
function negate(cond) {
  const p = parts(cond);
  if (!p.terms.length) return '';
  return p.terms.map(negateTerm).join(p.or ? ',' : ';');
}

// 写法检查：每一条都要是插件看得懂的（插件遇到看不懂的会跳过这一条，结果就跟想的不一样了）
function check(cond) {
  const bad = parts(cond).terms.filter(t => !parseTerm(t));
  return bad.length ? '看不懂的条件：' + bad.join('、') + '（例：s[3]、!s[3]、v[65]>=70、i[5]、p[2]，几条用逗号隔开）' : '';
}

// ---------- 人话 ----------
const CMP = { '<=': '≤', '>=': '≥', '!=': '≠', '!==': '≠', '=': '=', '==': '=', '===': '=', '<': '<', '>': '>' };
const KIND = { s: 'switch', v: 'var', i: 'item', w: 'weapon', a: 'armor', p: 'actor' };
const KIND_NAME = { switch: '开关', var: '变量', item: '物品', weapon: '武器', armor: '护甲', actor: '角色' };
function describeTerm(t, name) {
  const x = parseTerm(t);
  if (!x) return String(t || '').trim();
  const nm = (kind, id) => {
    let label = '';
    try { label = name ? name(kind, Number(id)) : ''; } catch { label = ''; }
    return KIND_NAME[kind] + ' ' + id + (label ? '「' + label + '」' : '');
  };
  const side = (v, count) => {
    let m;
    if (v === 'g') return '金币';
    if ((m = /^([sviwap])\[(\d+)\]$/.exec(v))) return nm(KIND[m[1]], m[2]) + (count && 'iwa'.includes(m[1]) ? ' 的个数' : '');
    return v;
  };
  const m = /^([sviwap])\[(\d+)\]$/.exec(x.a);
  if (!x.op) {
    if (!m) return (x.neg ? '没有' : '有') + side(x.a);
    const kind = KIND[m[1]];
    if (kind === 'switch') return nm(kind, m[2]) + (x.neg ? ' 为关' : ' 为开');
    if (kind === 'actor') return nm(kind, m[2]) + (x.neg ? ' 不在队伍里' : ' 在队伍里');
    if (kind === 'var') return nm(kind, m[2]) + (x.neg ? ' 是 0' : ' 不是 0');
    return (x.neg ? '没有' : '持有') + nm(kind, m[2]);
  }
  const op = x.neg ? FLIP[x.op] : x.op;
  return side(x.a, true) + ' ' + (CMP[op] || op) + ' ' + side(x.b, true);
}
// 整串 → 人话
function describe(cond, name) {
  const p = parts(cond);
  return p.terms.map(t => describeTerm(t, name)).filter(Boolean).join(p.or ? ' 或者 ' : ' 并且 ');
}
// 一个选项的条件 → 给人看的「要满足什么」：{ lock: '开关 3 为开', hide: '…' }（没有的是空串）
function needs(label, name) {
  const c = split(label);
  return { lock: c.disable ? describe(negate(c.disable), name) : '', hide: c.hide ? describe(negate(c.hide), name) : '' };
}

// ---------- 算（预览、测试用；游戏里由插件算） ----------
// state = { sw(id), v(id), gold, inParty(id), count(kind, id) }
function evalTerm(t, st) {
  const x = parseTerm(t);
  if (!x) return null;
  const val = (v, count) => {
    let m;
    if (v === 'g') return st.gold || 0;
    if ((m = /^([sviwap])\[(\d+)\]$/.exec(v))) {
      const k = m[1], id = Number(m[2]);
      if (k === 's') return st.sw(id) ? 1 : 0;
      if (k === 'v') return Number(st.v(id)) || 0;
      if (k === 'p') return st.inParty(id) ? 1 : 0;
      return st.count(KIND[k], id);
    }
    return Number(v) || 0;
  };
  let r;
  if (!x.op) r = val(x.a) > 0;
  else {
    const a = val(x.a), b = val(x.b);
    r = { '=': a === b, '==': a === b, '===': a === b, '!=': a !== b, '!==': a !== b, '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b }[x.op];
  }
  return x.neg ? !r : r;
}
function test(cond, st) {
  const p = parts(cond);
  const rs = p.terms.map(t => evalTerm(t, st)).filter(r => r !== null);   // 看不懂的跳过（插件默认也是跳过）
  if (!rs.length) return false;
  return p.or ? rs.some(Boolean) : rs.every(Boolean);
}

module.exports = { split, join, has, terms, parts, parseTerm, negate, negateTerm, check, describe, describeTerm, needs, test, evalTerm, CMP };
