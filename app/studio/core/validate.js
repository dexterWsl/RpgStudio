'use strict';
// 保存前的检查（通用）：结构对不对、引用的东西在不在
//   checkList(list) → [{ line, level:'error'|'warn', msg }]
//   newProblems(before, after) → 保存后新出现的错误（原来就有的不拦，免得旧数据的问题让人什么都存不了）

// 这些指令后面紧跟的是「下一层」（缩进 +1）
const OPENS_BODY = new Set([111, 112, 402, 403, 411, 601, 602, 603]);
// 一层结束（缩进 +1 的结束标记 0）之后，下一条必须是这些之一
const AFTER_BODY = new Set([402, 403, 404, 411, 412, 413, 602, 603, 604]);

// 台词一行在游戏里占多宽：汉字算 1，英文数字算 0.5；\N[1] 这类文字代码按换出来的样子大概算，颜色、图标代码不算
function lineWidth(text) {
  const t = String(text || '').replace(/\\[NnPp]\[\d+\]/g, '名字').replace(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z{}$.|!><^]/g, '');
  return [...t].reduce((n, ch) => n + (/[\u0000-\u00ff]/.test(ch) ? 0.5 : 1), 0);
}

function createValidator(project) {
  const P = project;

  function checkList(list, opts = {}) {
    const out = [];
    const err = (line, msg) => out.push({ line, level: 'error', msg });
    const warn = (line, msg) => out.push({ line, level: 'warn', msg });
    if (!Array.isArray(list) || !list.length) { err(0, '指令列表是空的（至少要有一个结束标记）'); return out; }
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || typeof c !== 'object' || !Number.isInteger(c.code) || !Number.isInteger(c.indent) || c.indent < 0 || !Array.isArray(c.parameters)) {
        err(i, '第 ' + (i + 1) + ' 条指令格式不对（需要 code / indent / parameters）');
        return out;
      }
    }
    const last = list[list.length - 1];
    if (last.code !== 0 || last.indent !== 0) err(list.length - 1, '最后一条必须是结束标记（code 0，缩进 0）');

    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.indent > a.indent) {
        if (!OPENS_BODY.has(a.code)) err(i, `缩进不对：「${a.code}」后面不能多缩进一层`);
        else if (b.indent !== a.indent + 1) err(i, '缩进一次只能多一层');
      } else if (b.indent < a.indent) {
        if (a.code !== 0) err(i, `缩进不对：一层里的内容必须以结束标记收尾（第 ${i} 条之前）`);
        else if (b.indent !== a.indent - 1) err(i, '缩进一次只能少一层');
        else if (!AFTER_BODY.has(b.code)) err(i, `一层结束之后应该是「否则 / 下一个选项 / 分支结束」，这里是「${b.code}」`);
      }
      if (OPENS_BODY.has(a.code) && b.indent !== a.indent + 1) err(i, `「${a.code}」下面的内容要多缩进一层`);
    }
    // 选项：102 → 402/403 … → 404
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.code === 102) {
        const n = (c.parameters[0] || []).length;
        let j = i + 1, seen = 0;
        while (j < list.length && !(list[j].indent === c.indent && list[j].code === 404)) {
          if (list[j].indent < c.indent) break;
          if (list[j].indent === c.indent && list[j].code === 402) seen++;
          j++;
        }
        if (j >= list.length || list[j].code !== 404) err(i, '选项没有「选项结束」');
        else if (seen !== n) warn(i, `选项有 ${n} 个，但分支有 ${seen} 个`);
      }
      if (c.code === 111 || c.code === 112) {
        const want = c.code === 111 ? 412 : 413;
        let j = i + 1;
        while (j < list.length && list[j].indent > c.indent) j++;
        while (j < list.length && list[j].indent === c.indent && c.code === 111 && list[j].code === 411) { j++; while (j < list.length && list[j].indent > c.indent) j++; }
        if (j >= list.length || list[j].code !== want) err(i, c.code === 111 ? '条件分支没有「条件结束」' : '循环没有「循环结束」');
      }
      if (c.code === 101 && !(list[i + 1] && list[i + 1].code === 401)) warn(i, '对话框里没有文字');
      // 一行太长，游戏里会被窗口截掉（按默认字号 26、画面 816 宽估算：没头像约 30 个汉字，有头像约 23 个）
      if (c.code === 401) {
        let h = i - 1;
        while (h >= 0 && list[h].code === 401) h--;
        const face = h >= 0 && list[h].code === 101 && list[h].parameters[0];
        const w = lineWidth(c.parameters[0]);
        if (w > (face ? 23 : 30)) warn(i, `这一行台词有点长（约 ${Math.ceil(w)} 个字宽），游戏里可能显示不全，拆成两行（下一行用「＋」开头）`);
      }
    }
    // 引用
    for (let i = 0; i < list.length; i++) {
      const c = list[i], p = c.parameters;
      switch (c.code) {
        case 117: if (!P.has('ce', p[0])) err(i, `调用的公共事件 ${p[0]} 不存在`); break;
        case 121: if (!P.has('switch', p[0]) || !P.has('switch', p[1])) err(i, `开关 ${p[0]} 超出范围（共 ${P.count('switch')} 个）`); break;
        case 122: if (!P.has('var', p[0]) || !P.has('var', p[1])) err(i, `变量 ${p[0]} 超出范围（共 ${P.count('var')} 个）`); break;
        case 126: if (!P.has('item', p[0])) err(i, `物品 ${p[0]} 不存在`); break;
        case 201: if (p[0] === 0 && !P.has('map', p[1])) err(i, `传送的目标地图 ${p[1]} 不存在`); break;
        case 231: if (opts.images !== false && p[1] && !P.findImage('pictures', p[1])) err(i, `图片「${p[1]}」不存在（img/pictures）`); break;
        case 111:
          if (p[0] === 0 && !P.has('switch', p[1])) err(i, `条件里的开关 ${p[1]} 超出范围`);
          if (p[0] === 1 && !P.has('var', p[1])) err(i, `条件里的变量 ${p[1]} 超出范围`);
          break;
      }
    }
    return out;
  }

  // 只拦「新出现的」错误：按错误文字计数，保存后多出来的才算
  function newProblems(beforeList, afterList, opts) {
    const before = beforeList ? checkList(beforeList, opts) : [];
    const after = checkList(afterList, opts);
    const cnt = new Map();
    for (const e of before) if (e.level === 'error') cnt.set(e.msg, (cnt.get(e.msg) || 0) + 1);
    const fresh = [];
    for (const e of after) {
      if (e.level !== 'error') continue;
      const n = cnt.get(e.msg) || 0;
      if (n > 0) cnt.set(e.msg, n - 1); else fresh.push(e);
    }
    return { fresh, warnings: after.filter(e => e.level === 'warn'), all: after };
  }

  return { checkList, newProblems };
}

module.exports = { createValidator };
