#!/usr/bin/env node
'use strict';
// 剧情进度自检（只读，不写盘）：看这个游戏被认成哪种推进方式，时间线 / 地图亮暗 / 事件页标注算得对不对
//   node studio/test/progress.js <游戏目录> [--profile example]
// 检查：
//   1. 主线 + 每条支线的时间线都能算出来，分段从小到大
//   2. 同一页 / 同一个分支在时间线里只列一次（「到第几段」写在后面），而且没被「每段都有」重复列
//   3. 每个地图事件：地图亮暗给的「这一段显示第几页」和事件页的进度标注对得上
// 退出码：0 全部通过；1 有失败
const path = require('path');
const { createStudio } = require('../handler.js');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir) { console.error('用法：node studio/test/progress.js <游戏目录> [--profile example]'); process.exit(2); }
const pi = args.indexOf('--profile');
const tmp = require('os').tmpdir();
const studio = createStudio({ gameDir: path.resolve(dir), profile: pi >= 0 ? args[pi + 1] : '', settingsFile: path.join(tmp, 'studio-test-progress-settings.json'), backupsDir: path.join(tmp, 'studio-test-backups') });
const T = studio.tools();
const P = T.progress;
const fails = [];
const fail = m => fails.push(m);

const cfg = P.config();
const m = cfg.main;
const desc = m.type === 'day' ? `按天：变量 ${m.var}，${m.segs.length} 天${m.slots.length ? '，时段 ' + m.slots.map(s => s.label).join(' / ') : ''}`
  : m.type === 'chapter' ? `按章节：变量 ${m.var}，${m.segs.length} 段`
  : m.type === 'switches' ? `按开关链：${m.chain.map(c => c.label).join(' → ')}` : '按地图（没认出进度变量）';
console.log(`主线 ${desc}（${{ saved: '自己设的', profile: '游戏配置给的', detected: '自动认出来的' }[cfg.source]}）`);
if (cfg.tracks.length) console.log('支线 ' + cfg.tracks.map(t => `${t.label}（变量 ${t.var}，${t.steps.length} 步）`).join('、'));

const t0 = Date.now();
for (const key of ['main', ...cfg.tracks.map(t => 't' + t.var)]) {
  const tl = P.timeline(key);
  if (!tl.axis) { if (key !== 'main' || m.type !== 'map') fail(key + '：算不出时间线'); continue; }
  const froms = tl.segs.map(s => s.from).filter(x => x != null);
  if (froms.some((x, i) => i && x <= froms[i - 1])) fail(key + '：分段没有从小到大');
  const seen = new Map();
  const id = e => JSON.stringify(e.at) + ':' + (e.line == null ? '' : e.line);
  tl.segs.forEach((s, i) => s.entries.forEach(e => {
    const k = id(e) + ':' + i;
    if (seen.has(k)) fail(`${key}：${e.where} 在「${s.label}」列了两次`);
    seen.set(k, true);
    if (e.to != null && e.to !== -1 && e.to < i) fail(`${key}：${e.where} 的「到」比开始还早`);
  }));
  const inSegs = new Set([...seen.keys()].map(k => k.replace(/:\d+$/, '')));
  for (const e of tl.always) if (inSegs.has(id(e))) fail(`${key}：${e.where} 既在「每段都有」又在某一段`);
  const n = tl.segs.reduce((a, s) => a + s.entries.length, 0);
  console.log(`  ${key === 'main' ? '主线' : tl.axis.label}：${tl.segs.length} 段，按段新出现 ${n} 条，每段都有 ${tl.always.length} 条，推进点 ${tl.segs.reduce((a, s) => a + s.advances.length, 0) + tl.advances.length} 处`);
}

// 地图亮暗 ↔ 事件页标注
let events = 0, related = 0;
if (m.type !== 'map') {
  for (const info of studio.project.mapList()) {
    let data;
    try { data = studio.project.map(info.id); } catch { continue; }
    if (!data) continue;
    const mc = P.mapCells(info.id);
    const nSlot = Math.max(1, mc.axis.slots.length);
    for (const e of data.events || []) {
      if (!e) continue;
      events++;
      const cells = mc.events[e.id];
      const st = P.eventStages(info.id, e.id);
      if (!cells) { if (st) fail(`地图 ${info.id} 事件 ${e.id}：地图上说跟进度无关，事件页却有标注`); continue; }
      related++;
      if (!st || st.length !== e.pages.length) { fail(`地图 ${info.id} 事件 ${e.id}：事件页没有每页的进度`); continue; }
      if (cells.length !== mc.axis.segs.length * nSlot) fail(`地图 ${info.id} 事件 ${e.id}：格子数不对`);
      // 地图上某一格显示第 p 页 → 事件页里第 p 页不能写「被挡住」
      for (const c of cells) if (c && st[c.p] && st[c.p].never) fail(`地图 ${info.id} 事件 ${e.id}：第 ${c.p + 1} 页地图上会显示，事件页却说被挡住`);
    }
  }
  console.log(`  地图事件 ${events} 个，跟主线进度有关的 ${related} 个`);
}
console.log(`  用时 ${Date.now() - t0}ms`);
if (fails.length) { console.log(`\n失败 ${fails.length} 处：\n` + fails.slice(0, 30).join('\n')); process.exit(1); }
console.log('全部通过');
