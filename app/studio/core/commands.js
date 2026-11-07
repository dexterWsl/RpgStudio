'use strict';
// 事件指令 → 人话（通用：MV / MZ 的标准指令；插件指令只显示插件名和命令名）
//   describe(c)          一条指令一句话
//   condText(params)     「条件分支」的条件
//   pageConditions(cond) 事件页的出现条件
//   outline(list)        一页指令 → 阅读用的行（对话框和续行合并成一行）
//   category(code)       分类（界面上按颜色区分）

const VAR_OPS = ['=', '+=', '−=', '×=', '÷=', '%='];
const CMP = ['=', '≥', '≤', '>', '<', '≠'];
const DIRS = { 0: '保持', 2: '下', 4: '左', 6: '右', 8: '上' };
const TRIGGERS = ['按确定键', '玩家接触', '事件接触', '自动执行', '并行处理'];
const PRIORITIES = ['在角色下方', '与角色同层', '在角色上方'];
const CE_TRIGGERS = ['无（只能被调用）', '自动执行', '并行处理'];
const BG = ['窗口', '暗化', '透明'];
const POS = ['上', '中', '下'];

const CATS = [
  ['say', [101, 401, 103, 104, 105, 405]],
  ['flow', [0, 102, 402, 403, 404, 109, 111, 411, 412, 112, 413, 113, 115, 117, 118, 119, 601, 602, 603, 604]],
  ['state', [121, 122, 123, 124, 125, 126, 127, 128, 129, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 324, 325, 326]],
  ['stage', [211, 212, 213, 221, 222, 223, 224, 225, 230, 231, 232, 233, 234, 235, 236, 241, 242, 243, 244, 245, 246, 249, 250, 251, 261]],
  ['move', [201, 202, 203, 204, 205, 505, 206, 214, 216, 217]],
  ['code', [355, 655, 356, 357, 657]],
  ['note', [108, 408]],
];
const CAT_OF = new Map();
for (const [cat, codes] of CATS) for (const c of codes) CAT_OF.set(c, cat);
const category = code => CAT_OF.get(code) || 'system';

// 续行：跟在上一条后面、属于同一条指令
const CONT_OF = { 401: 101, 405: 105, 408: 108, 655: 355, 657: 357, 505: 205, 605: 302 };

const { createTextCodes } = require('./textcodes.js');

function createDescriber(project, opts = {}) {
  const codes = createTextCodes(project);
  const P = project;
  const isClearAll = opts.isClearAll || (() => false);
  const short = (s, n = 60) => { s = String(s == null ? '' : s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };
  const L = (kind, id) => P.label(kind, id);
  const range = (kind, a, b) => (Number(b) && Number(b) !== Number(a) ? `${P.KIND_LABEL[kind]} ${a}~${b}` : L(kind, a));
  const chr = id => (Number(id) === -1 ? '玩家' : Number(id) === 0 ? '本事件' : `事件 ${id}`);
  const audio = (a, what) => (a && a.name ? `${what}「${a.name}」` : `停止${what}`);

  // 变量运算、物品数量等的「操作数」
  function operand(type, a, b) {
    switch (Number(type)) {
      case 0: return String(a);
      case 1: return L('var', a);
      case 2: return `随机 ${a}~${b}`;
      case 3: return '游戏数据';
      case 4: return '脚本 ' + short(a, 40);
    }
    return String(a);
  }

  function condText(p) {
    p = p || [];
    switch (p[0]) {
      case 0: return `${L('switch', p[1])} 为${p[2] === 0 ? '开' : '关'}`;
      case 1: return `${L('var', p[1])} ${CMP[p[4]] || '?'} ${p[2] === 0 ? p[3] : L('var', p[3])}`;
      case 2: return `独立开关 ${p[1]} 为${p[2] === 0 ? '开' : '关'}`;
      case 3: return `计时器 ${p[1] === 0 ? '≥' : '≤'} ${Math.floor(p[2] / 60)}分${p[2] % 60}秒`;
      case 4: {
        const what = ['在队伍中', `名字是「${p[3]}」`, `职业是 ${L('class', p[3])}`, `学会了 ${L('skill', p[3])}`, `装备了 ${L('weapon', p[3])}`, `装备了 ${L('armor', p[3])}`, `处于 ${L('state', p[3])}`][p[2]] || '';
        return `${L('actor', p[1])} ${what}`;
      }
      case 5: return `敌人 #${Number(p[1]) + 1} ${p[2] === 0 ? '出现了' : '处于 ' + L('state', p[3])}`;
      case 6: return `${chr(p[1])} 面朝${DIRS[p[2]] || p[2]}`;
      case 7: return `金钱 ${['≥', '≤', '<'][p[2]] || '?'} ${p[1]}`;
      case 8: return `持有 ${L('item', p[1])}`;
      case 9: return `持有 ${L('weapon', p[1])}` + (p[2] ? '（含装备中）' : '');
      case 10: return `持有 ${L('armor', p[1])}` + (p[2] ? '（含装备中）' : '');
      case 11: return `按着 ${p[1]} 键`;
      case 12: return '脚本 ' + short(p[1], 50);
      case 13: return `乘坐${['小船', '大船', '飞艇'][p[1]] || '载具'}`;
    }
    return `条件（类型 ${p[0]}）`;
  }

  function describe(c) {
    const p = c.parameters || [];
    if (isClearAll(c)) return '关闭全部剧情图片';
    switch (c.code) {
      case 0: return '结束';
      case 101: return '对话框' + (p[4] ? '｜' + P.expandN(p[4]) : '') + (p[0] ? `（头像 ${p[0]} #${p[1]}）` : '');
      case 401: return P.expandN(p[0]);
      case 102: return '选项：' + (p[0] || []).map(P.expandN).join(' / ');
      case 402: return '选了「' + P.expandN(p[1] ?? '') + '」';
      case 403: return '按取消时';
      case 404: return '选项结束';
      case 103: return `输入数字（${p[1]} 位）→ ${L('var', p[0])}`;
      case 104: return `选择物品 → ${L('var', p[0])}`;
      case 105: return '滚动文字';
      case 405: return P.expandN(p[0]);
      case 108: case 408: return '注释：' + short(p[0]);
      case 109: return '跳过';
      case 111: return '如果 ' + condText(p);
      case 411: return '否则';
      case 412: return '条件结束';
      case 112: return '循环';
      case 413: return '循环结束（回到开头）';
      case 113: return '跳出循环';
      case 115: return '中止事件';
      case 117: return '调用 ' + L('ce', p[0]);
      case 118: return `标签「${p[0]}」`;
      case 119: return `跳到标签「${p[0]}」`;
      case 121: return `${range('switch', p[0], p[1])} → ${p[2] === 0 ? '开' : '关'}`;
      case 122: return `${range('var', p[0], p[1])} ${VAR_OPS[p[2]] || '='} ${operand(p[3], p[4], p[5])}`;
      case 123: return `独立开关 ${p[0]} → ${p[1] === 0 ? '开' : '关'}`;
      case 124: return p[0] === 0 ? `计时器开始（${Math.floor(p[1] / 60)}分${p[1] % 60}秒）` : '计时器停止';
      case 125: return `金钱 ${p[0] === 0 ? '+' : '−'} ${operand(p[1], p[2])}`;
      case 126: return `${p[1] === 0 ? '获得' : '失去'} ${L('item', p[0])} × ${operand(p[2], p[3])}`;
      case 127: return `${p[1] === 0 ? '获得' : '失去'} ${L('weapon', p[0])} × ${operand(p[2], p[3])}`;
      case 128: return `${p[1] === 0 ? '获得' : '失去'} ${L('armor', p[0])} × ${operand(p[2], p[3])}`;
      case 129: return `${L('actor', p[0])} ${p[1] === 0 ? '加入' : '离开'}队伍`;
      case 132: return '更改战斗 BGM';
      case 133: return '更改胜利 ME';
      case 134: return `存档 ${p[0] === 0 ? '禁止' : '允许'}`;
      case 135: return `菜单 ${p[0] === 0 ? '禁止' : '允许'}`;
      case 136: return `遇敌 ${p[0] === 0 ? '禁止' : '允许'}`;
      case 137: return `整队 ${p[0] === 0 ? '禁止' : '允许'}`;
      case 138: return '更改窗口颜色';
      case 139: return '更改战败 ME';
      case 140: return '更改载具 BGM';
      case 201: return p[0] === 0 ? `传送到 ${L('map', p[1])} (${p[2]}, ${p[3]})` : '传送到 变量指定的位置';
      case 202: return '设置载具位置';
      case 203: return `设置 ${chr(p[0])} 的位置`;
      case 204: return `滚动地图（${DIRS[p[0]] || p[0]} ${p[1]} 格）`;
      case 205: return `移动路线：${chr(p[0])}`;
      case 505: return '　路线步骤';
      case 206: return '上下载具';
      case 211: return `透明 ${p[0] === 0 ? '开' : '关'}`;
      case 212: return `${chr(p[0])} 显示动画 ${L('animation', p[1])}`;
      case 213: return `${chr(p[0])} 显示气泡 #${p[1]}`;
      case 214: return '暂时消除本事件';
      case 216: return `跟随队员 ${p[0] === 0 ? '显示' : '隐藏'}`;
      case 217: return '集合队员';
      case 221: return '画面淡出';
      case 222: return '画面淡入';
      case 223: return `画面色调（${p[1]} 帧）`;
      case 224: return '画面闪烁';
      case 225: return '画面震动';
      case 230: return `等待 ${Math.round((Number(p[0]) / 60) * 100) / 100} 秒`;
      case 231: return `显示图片 #${p[0]}「${p[1]}」`;
      case 232: return `移动图片 #${p[0]}`;
      case 233: return `旋转图片 #${p[0]}`;
      case 234: return `图片色调 #${p[0]}`;
      case 235: return `关闭图片 #${p[0]}`;
      case 236: return `天气：${['无', '雨', '暴风雨', '雪'][['none', 'rain', 'storm', 'snow'].indexOf(p[0])] || p[0]}`;
      case 241: return audio(p[0], 'BGM');
      case 242: return `BGM 淡出 ${p[0]} 秒`;
      case 243: return '记住当前 BGM';
      case 244: return '恢复记住的 BGM';
      case 245: return audio(p[0], 'BGS');
      case 246: return `BGS 淡出 ${p[0]} 秒`;
      case 249: return audio(p[0], 'ME');
      case 250: return audio(p[0], '音效');
      case 251: return '停止音效';
      case 261: return `播放视频「${p[0]}」`;
      case 281: return `地图名显示 ${p[0] === 0 ? '开' : '关'}`;
      case 282: return '更改图块 ' + L('tileset', p[0]);
      case 283: return '更改战斗背景';
      case 284: return `更改远景「${p[0]}」`;
      case 285: return `获取位置信息 → ${L('var', p[0])}`;
      case 301: return p[0] === 0 ? `战斗：${L('troop', p[1])}` : '战斗（变量指定 / 随机遇敌）';
      case 601: return '胜利时';
      case 602: return '逃跑时';
      case 603: return '战败时';
      case 604: return '战斗分支结束';
      case 302: return '商店';
      case 605: return '　商品';
      case 303: return `输入名字：${L('actor', p[0])}`;
      case 311: return '更改 HP';
      case 312: return '更改 MP';
      case 326: return '更改 TP';
      case 313: return `更改状态：${L('state', p[3])}`;
      case 314: return '完全恢复';
      case 315: return '更改经验';
      case 316: return '更改等级';
      case 317: return '更改能力值';
      case 318: return `${p[2] === 0 ? '学会' : '忘记'} ${L('skill', p[3])}`;
      case 319: return '更改装备';
      case 320: return `${L('actor', p[0])} 改名为「${p[1]}」`;
      case 321: return '更改职业';
      case 322: return '更改角色图像';
      case 323: return '更改载具图像';
      case 324: return '更改称号';
      case 325: return '更改简介';
      case 331: case 332: case 342: case 333: case 334: case 335: case 336: case 337: case 339: return '敌人操作（' + c.code + '）';
      case 340: return '中止战斗';
      case 351: return '打开菜单';
      case 352: return '打开存档画面';
      case 353: return '游戏结束';
      case 354: return '回到标题';
      case 355: return '脚本：' + short(p[0]);
      case 655: return '　' + short(p[0]);
      case 356: return '插件指令：' + short(p[0]);
      case 357: {
        const args = Object.values(p[3] || {}).filter(v => typeof v === 'string' && v).slice(0, 2).map(v => short(v, 20)).join('，');
        return `插件：${p[0] || ''} ${p[1] || ''}` + (args ? `（${args}）` : '');
      }
      case 657: return '　' + short(p[0]);
    }
    return `其他指令（${c.code}）`;
  }

  // 事件页的出现条件 → 一组短句；没有条件 = 一直出现
  function pageConditions(cd) {
    cd = cd || {};
    const out = [];
    if (cd.switch1Valid) out.push(`${L('switch', cd.switch1Id)} 为开`);
    if (cd.switch2Valid) out.push(`${L('switch', cd.switch2Id)} 为开`);
    if (cd.variableValid) out.push(`${L('var', cd.variableId)} ≥ ${cd.variableValue}`);
    if (cd.selfSwitchValid) out.push(`独立开关 ${cd.selfSwitchCh} 为开`);
    if (cd.itemValid) out.push(`持有 ${L('item', cd.itemId)}`);
    if (cd.actorValid) out.push(`${L('actor', cd.actorId)} 在队伍中`);
    return out;
  }

  // 这一条指令引用了哪些东西（界面上点了能看「在哪里用到」）
  function refsOf(c) {
    const p = c.parameters || [];
    const r = [];
    switch (c.code) {
      case 121: r.push({ kind: 'switch', id: p[0] }); break;
      case 122: r.push({ kind: 'var', id: p[0] }); if (p[3] === 1) r.push({ kind: 'var', id: p[4] }); break;
      case 111:
        if (p[0] === 0) r.push({ kind: 'switch', id: p[1] });
        if (p[0] === 1) { r.push({ kind: 'var', id: p[1] }); if (p[2] === 1) r.push({ kind: 'var', id: p[3] }); }
        if (p[0] === 4) r.push({ kind: 'actor', id: p[1] });
        if (p[0] === 8) r.push({ kind: 'item', id: p[1] });
        break;
      case 117: r.push({ kind: 'ce', id: p[0] }); break;
      case 126: r.push({ kind: 'item', id: p[0] }); break;
      case 201: if (p[0] === 0) r.push({ kind: 'map', id: p[1] }); break;
      case 231: r.push({ kind: 'picture', id: String(p[1] || '') }); break;
      case 103: case 104: r.push({ kind: 'var', id: p[0] }); break;
    }
    return r;
  }

  // 阅读视图：一行一个「动作」。对话框 + 它的几行台词合并；脚本/注释/插件的续行合并
  function outline(list) {
    const rows = [];
    list = list || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      const p = c.parameters || [];
      const row = { i, end: i, code: c.code, indent: c.indent || 0, cat: category(c.code) };
      if (c.code === 0 && i === list.length - 1) continue;   // 整页最后的结束标记不显示
      if (c.code === 101) {
        const lines = [];
        let j = i + 1;
        while (j < list.length && list[j] && list[j].code === 401) { lines.push(String(list[j].parameters[0] ?? '')); j++; }
        // 文字代码换成游戏里显示的样子（<center>、\LastGainObj……）；原文放在 raw 里
        const shown = codes.render(lines, { gain: codes.gainBefore(list, i) });
        const raw = lines.map(P.expandN);
        Object.assign(row, { kind: 'say', speaker: codes.word(p[4] || ''), face: p[0] ? { name: p[0], index: p[1] } : null, style: `${BG[p[2]] || ''}·${POS[p[3]] || ''}`, lines: shown.map(l => l.text), end: j - 1 });
        if (shown.some(l => l.align !== 'left')) row.align = shown.map(l => l.align);
        if (shown.map(l => l.text).join('\n') !== raw.join('\n')) row.raw = raw;
        rows.push(row); i = j - 1; continue;
      }
      if (CONT_OF[c.code] && rows.length && rows[rows.length - 1].code === CONT_OF[c.code]) {
        const prev = rows[rows.length - 1];
        prev.end = i;
        (prev.more = prev.more || []).push(c.code === 505 ? '' : describe(c).trim());
        continue;
      }
      if (c.code === 105) {
        const lines = [];
        let j = i + 1;
        while (j < list.length && list[j] && list[j].code === 405) { lines.push(String(list[j].parameters[0] ?? '')); j++; }
        Object.assign(row, { kind: 'say', speaker: '（滚动文字）', lines: lines.map(l => codes.word(l)), end: j - 1 });
        rows.push(row); i = j - 1; continue;
      }
      if (c.code === 205) {
        let j = i + 1;
        while (j < list.length && list[j] && list[j].code === 505) j++;
        const steps = ((p[1] || {}).list || []).filter(s => s && s.code).length;
        Object.assign(row, { text: describe(c) + `（${steps} 步${(p[1] || {}).wait ? '，等待完成' : ''}）`, end: j - 1 });
        rows.push(row); i = j - 1; continue;
      }
      row.text = describe(c);
      const refs = refsOf(c);
      if (refs.length) row.refs = refs;
      if (c.code === 0) row.text = '';   // 分支内部的结束标记：只占缩进，不显示文字
      if (c.code === 231) row.picture = p[1];
      rows.push(row);
    }
    // 去掉只占位的空结束标记
    return rows.filter(r => !(r.code === 0 && !r.text));
  }

  return { describe, condText, operand, pageConditions, outline, category, refsOf, codes };
}

module.exports = { createDescriber, category, TRIGGERS, PRIORITIES, CE_TRIGGERS, VAR_OPS, CMP };
