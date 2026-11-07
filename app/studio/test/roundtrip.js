#!/usr/bin/env node
'use strict';
// 回归测试：通用编辑器「改台词」必须无损（只读，不写盘）
//   node studio/test/roundtrip.js <游戏目录> [--profile example]
// 对每个地图事件页、每个公共事件：
//   1. 能编辑的：原指令 → 编辑框文字 → 合并回去，必须一字不差
//   2. 改一句：只能动那一句的 401
//   3. 删一句：只少那个对话框
//   4. 改 ■ 结构行：必须报错
// 退出码：0 全部通过；1 有失败
const path = require('path');
const { createStudio } = require('../handler.js');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir) { console.error('用法：node studio/test/roundtrip.js <游戏目录> [--profile example]'); process.exit(2); }
const pi = args.indexOf('--profile');
const studio = createStudio({ gameDir: path.resolve(dir), profile: pi >= 0 ? args[pi + 1] : '', settingsFile: path.join(require('os').tmpdir(), 'studio-test-settings.json'), backupsDir: path.join(require('os').tmpdir(), 'studio-test-backups') });
const T = studio.tools();
const { stripBar } = require('../core/merge.js');

const J = x => JSON.stringify(x.map(c => [c.code, c.indent, c.parameters]));
const stat = { lists: 0, withText: 0, editable: 0, edit: 0, del: 0, guard: 0, 改选项: 0, 加选项: 0, 删选项: 0 };
const fails = [], reasons = {};
const fail = (w, m) => fails.push(w + '：' + m);

T.xref.each((at, list) => {
  if (at.type === 'troop') return;
  stat.lists++;
  const where = at.type === 'map' ? `Map${at.map}/ev${at.ev}/p${at.page}` : `CE${at.ce}`;
  if (!list.some(c => c.code === 401 || c.code === 231)) return;
  stat.withText++;
  const al = T.merger.analyzeList(list, { baseIndent: 0 });
  if (!al.editable) { reasons[al.reason] = (reasons[al.reason] || 0) + 1; return; }
  stat.editable++;
  const run = t => T.merger.mergeList(list, t, { analysis: al });
  const r0 = run(al.text);
  if (!r0.unchanged || J(r0.list) !== J(list)) return fail(where, '不改直接保存，结果不一样');
  const lines = al.text.split('\n');
  const k = lines.findIndex(l => { const s = stripBar(l).trim(); return s && !/^[#＃■＋+]/.test(s); });
  if (k >= 0) {
    const t = lines.slice(); t[k] += '（改）';
    try {
      const r = run(t.join('\n'));
      const diff = r.list.map((c, i) => (JSON.stringify([c.code, c.indent, c.parameters]) === JSON.stringify([list[i].code, list[i].indent, list[i].parameters]) ? -1 : i)).filter(i => i >= 0);
      if (r.list.length === list.length && diff.length === 1 && list[diff[0]].code === 401) stat.edit++;
      else fail(where, '改一句动到了别的指令 ' + JSON.stringify(diff.slice(0, 5)));
    } catch (e) { fail(where, '改一句报错：' + e.message); }
    let n = 1; while (k + n < lines.length && /^[＋+]/.test(stripBar(lines[k + n]).trim())) n++;
    try {
      const t2 = lines.slice(); t2.splice(k, n);
      const r = run(t2.join('\n'));
      if (r.list.length < list.length) stat.del++; else fail(where, '删一句没有变短');
    } catch (e) { fail(where, '删一句报错：' + e.message); }
  }
  const a = lines.findIndex(l => stripBar(l).trim().startsWith('■'));
  if (a >= 0) {
    const t = lines.slice(); t[a] += '改';
    try { run(t.join('\n')); fail(where, '改了 ■ 结构行居然没报错'); } catch { stat.guard++; }
  }
  // 选项：改字 / 加一个 / 删一个（第一个「显示选项」）
  const s = l => stripBar(l).trim();
  const isHead = x => /^■ 选项($|（|：)/.test(x);
  const c0 = lines.findIndex(l => isHead(s(l)));
  if (c0 >= 0) {
    // 这个选项的分支行、按取消时、选项结束（跳过里面套着的选项）
    let depth = 0, end = -1, cancel = -1;
    const branches = [];
    for (let i = c0 + 1; i < lines.length; i++) {
      const x = s(lines[i]);
      if (isHead(x)) depth++;
      else if (x === '■ 选项结束') { if (!depth) { end = i; break; } depth--; }
      else if (!depth && x === '■ 按取消时') cancel = i;
      else if (!depth && x.startsWith('■ 选了「')) branches.push(i);
    }
    const head = list.findIndex(c => c.code === 102);
    const cmds = r => r.list.filter(c => c.code === 102 || c.code === 402);
    const check = (r, what, ok) => {
      const v = T.validator.newProblems(list, r.list);
      if (v.fresh.length) return fail(where, what + '后出现新问题：' + v.fresh[0].msg);
      if (!ok(r)) return fail(where, what + '结果不对');
      stat[what]++;
    };
    if (end > 0 && branches.length) {
      // 改字：只动「显示选项」和那个分支两条
      const t = lines.slice(); t[branches[0]] = t[branches[0]].replace(/」$/, '改」');
      try {
        const r = run(t.join('\n'));
        const diff = r.list.map((c, i) => (list[i] && J([c]) === J([list[i]]) ? -1 : i)).filter(i => i >= 0);
        // 只动「显示选项」和那个分支两条；而且 102 的选项列表里只有被改的那一项变
        // （102 的选项文字和 402 的分支文字不一定一致：手工改过、插件生成的都可能有偏差，不能顺手改别的）
        const before = list[head].parameters[0] || [], after = (r.list[head] || {}).parameters?.[0] || [];
        const moved = before.map((x, i) => (x !== after[i] ? i : -1)).filter(i => i >= 0);
        check(r, '改选项', () => r.list.length === list.length && diff.length === 2 && diff.every(i => [102, 402].includes(list[i].code))
          && before.length === after.length && moved.length === 1 && String(after[moved[0]]).includes('改'));
      } catch (e) { fail(where, '改选项报错：' + e.message); }
      // 加一个：放在选项结束（或按取消时）前面，下面写一句
      if (branches.length < 6) {
        const at = cancel > 0 ? cancel : end;
        const t2 = lines.slice(); t2.splice(at, 0, '■ 选了「新选项」', '：新加的一句');
        try {
          const r = run(t2.join('\n'));
          check(r, '加选项', () => r.list[head].parameters[0].length === list[head].parameters[0].length + 1 && r.list[head].parameters[0].slice(-1)[0] === '新选项'
            && cmds(r).filter(c => c.code === 402 && c.indent === list[head].indent).length >= branches.length + 1 && r.list.some(c => c.code === 401 && c.parameters[0] === '新加的一句'));
        } catch (e) { fail(where, '加选项报错：' + e.message); }
      }
      // 删一个：删掉最后一个「■ 选了」和它下面的所有内容（含套着的 ■ 行），到按取消时 / 选项结束为止
      if (branches.length > 1) {
        const b = branches[branches.length - 1];
        const t3 = lines.slice(); t3.splice(b, (cancel > 0 ? cancel : end) - b);
        try {
          const r = run(t3.join('\n'));
          check(r, '删选项', () => r.list[head].parameters[0].length === list[head].parameters[0].length - 1);
        } catch (e) { fail(where, '删选项报错：' + e.message); }
      }
    }
  }
});

console.log(`${T.prof.label}配置 · 共 ${stat.lists} 页，有台词/图 ${stat.withText}，能整页编辑 ${stat.editable}`);
console.log(`  改一句 ${stat.edit} ✓  删一句 ${stat.del} ✓  结构行保护 ${stat.guard} ✓`);
console.log(`  改选项 ${stat.改选项} ✓  加选项 ${stat.加选项} ✓  删选项 ${stat.删选项} ✓`);
for (const [r, n] of Object.entries(reasons)) console.log(`  不能编辑（${n}）：${r}`);
if (fails.length) { console.log('失败 ' + fails.length + '：'); fails.slice(0, 30).forEach(f => console.log('  ✖ ' + f)); process.exit(1); }
console.log('全部通过');
