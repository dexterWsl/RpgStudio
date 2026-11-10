#!/usr/bin/env node
'use strict';
// 回归测试：场景里的传送 / 扮演、选项条件、演出插件（只读，不写盘）
//   node studio/test/stage.js <游戏目录>
// 用游戏里第一个有名字的角色、第一张地图来造句子：
//   1. #传送 / #扮演 的写法 → 指令 → 再变回写法，一字不差（场景里）
//   2. 场景外：#传送 不能带人、#扮演 不能用；普通的 #传送 还是「场所移动」
//   3. 选项条件：标记 ⇄ 「要满足什么」互相转换；阅读视图、预览里说人话
//   4. 演出插件的源码能编译（插件版本、插件指令表）
// 游戏里真的跑一遍（场景播完换回主角、选项灰掉）：test/runtime.js（要 MZ 的运行脚本和 playwright）
const path = require('path');
const vm = require('vm');
const os = require('os');
const { createStudio } = require('../handler.js');
const { MARK_CMD } = require('../core/scenes.js');
const stage = require('../core/stage.js');
const cc = require('../core/choicecond.js');

const dir = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!dir) { console.error('用法：node studio/test/stage.js <游戏目录>'); process.exit(2); }
const studio = createStudio({ gameDir: path.resolve(dir), settingsFile: path.join(os.tmpdir(), 'studio-test-settings.json'), backupsDir: path.join(os.tmpdir(), 'studio-test-backups') });
const T = studio.tools();
const P = studio.project;

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const END = () => ({ code: 0, indent: 0, parameters: [] });
const merge = (base, text) => {
  const al = T.merger.analyzeList(base, { baseIndent: 0 });
  return T.merger.mergeList(base, (al.text ? al.text + '\n' : '') + text, { analysis: al }).list;
};
const textOf = list => T.merger.analyzeList(list, { baseIndent: 0 }).text.split('\n').filter(l => !l.startsWith('■'));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

const actor = (P.read('Actors.json') || []).find(a => a && String(a.name || '').trim() && !/\s/.test(a.name));
const map = P.mapList().find(m => m && m.id);
if (!actor || !map) { console.error('这个游戏里要有一个有名字的角色和一张地图'); process.exit(2); }
const who = actor.name.trim(), mapRef = T.script.refText('map', map.id);

// ---------- 1. 场景里 ----------
const sceneLines = [
  `#传送 ${mapRef} 3 4`,
  `#传送 ${mapRef} 3 4 朝上`,
  `#传送 ${who} ${mapRef} 5 6 前进2`,
  `#传送 ${who} ${mapRef} 5 6 朝左 前进2 转身`,
  `#传送 ${mapRef} 7 8 下2`,
  `#扮演 ${who}`,
  '#扮演 主角',
  `#动作 ${who} 前进3 不等`,
];
const scene = merge([MARK_CMD(), END()], sceneLines.join('\n'));
ok(JSON.stringify(textOf(scene)) === JSON.stringify(sceneLines), '场景里写了再读出来要一样：\n  ' + textOf(scene).join('\n  '));
ok(scene.filter(c => c.code === 201).length === 2, '不带人、不带步骤的 #传送 还是「场所移动」');
ok(scene.find(c => c.code === 201 && c.parameters[4] === 8), '「朝上」写进场所移动的朝向');
const tr = scene.map(stage.parseCmd).filter(x => x && x.cmd === 'transfer');
ok(tr.length === 3 && tr[0].args.who === who && tr[0].args.steps === '前进2' && Number(tr[0].args.map) === map.id, '带人 / 带步骤的是演出插件的传送 ' + JSON.stringify(tr[0] && tr[0].args));
ok(tr[1] && tr[1].args.dir === '4' && tr[1].args.steps === '前进2 转身', '朝向和几个步骤');
ok(scene.map(stage.parseCmd).filter(x => x && x.cmd === 'as').length === 2, '#扮演 两条');
ok(merge([MARK_CMD(), END()], `#传送 ${who} ${mapRef} 5 6 前进 2`).some(c => (stage.parseCmd(c) || {}).args && stage.parseCmd(c).args.steps === '前进2'), '「前进 2」中间有空格也认得');
ok(throws(() => merge([MARK_CMD(), END()], `#传送 没有这个人 ${mapRef} 1 1`), /没有叫「没有这个人」的角色/), '不认识的人：报错说清楚');
ok(throws(() => merge([MARK_CMD(), END()], '#扮演 没有这个人'), /不是角色的人要写行走图/), '#扮演 不认识的人：提示写行走图');
ok(throws(() => merge([MARK_CMD(), END()], `#传送 ${mapRef} 1 1 乱写`), /步骤看不懂/), '看不懂的步骤：报错');
// 不改直接保存：一模一样
const al = T.merger.analyzeList(scene, { baseIndent: 0 });
ok(T.merger.mergeList(scene, al.text, { analysis: al }).unchanged, '场景不改直接保存：不变');

// ---------- 2. 场景外 ----------
ok(throws(() => merge([END()], `#传送 ${who} ${mapRef} 1 1`), /场景外的 #传送 就是主角传送/), '场景外 #传送 带人：报错');
ok(throws(() => merge([END()], `#扮演 ${who}`), /只能写在场景里/), '场景外 #扮演：报错');
const plain = merge([END()], `#传送 ${mapRef} 1 1 朝下\n#传送 ${mapRef} 2 2 前进1`);
ok(plain[0].code === 201 && plain[0].parameters[4] === 2, '场景外普通的传送：场所移动');
ok((stage.parseCmd(plain[1]) || {}).cmd === 'transfer', '场景外带步骤的传送：可以（不带人）');

// ---------- 3. 选项条件 ----------
ok(cc.negate('s[3]') === '!s[3]' && cc.negate('!s[3]') === 's[3]', '开关取反');
ok(cc.negate('v[1]<5') === 'v[1]>=5' && cc.negate('v[1]>=5') === 'v[1]<5', '比较取反（换成相反的比较）');
ok(cc.negate('s[1],v[2]>3') === '!s[1];v[2]<=3' && cc.negate('!s[1];v[2]<=3') === 's[1],v[2]>3', '全部成立 ⇄ 任意一个不成立');
ok(cc.check('s[1],v[2]>=v[3],g>100,i[4],!p[2]') === '' && /看不懂/.test(cc.check('s[1] 和 s[2]')), '写法检查');
const st = { sw: id => id === 1, v: id => ({ 2: 5, 3: 4 })[id] || 0, gold: 50, inParty: id => id === 1, count: (k, id) => (k === 'item' && id === 4 ? 2 : 0) };
ok(cc.test('s[1],v[2]>v[3]', st) && !cc.test('s[2]', st) && cc.test('!s[2];s[9]', st) && cc.test('i[4]>=2', st) && !cc.test('g>100', st) && cc.test('p[1]', st), '条件计算（和插件同一套规则）');
const label = '<<[!s[24]]>>(([v[11]<2]))甲';
const sp = cc.split(label);
ok(sp.disable === '!s[24]' && sp.hide === 'v[11]<2' && sp.text === '甲' && cc.join(sp) === label, '选项文字拆开再拼回去');
ok(cc.split(' 乙<<[s[1]]>>').text === ' 乙', '标记在文字中间也认（插件 2.4 起）');
const need = cc.needs(label, () => '');
ok(/开关 24 为开/.test(need.lock) && /变量 11 ≥ 2/.test(need.hide), '给人看的是「要满足什么」：' + JSON.stringify(need));
// 阅读视图 / 预览
const ch = merge([END()], '#选项 <<[!s[1]]>>甲 | (([v[2]<3]))乙 | 丙\n#1 ：一\n#2 ：二\n#3 ：三');
const rows = T.describer.outline(ch).filter(r => r.code === 402);
ok(rows[0].cond && /开关 1.*为开 才能选/.test(rows[0].condText) && rows[0].cond.lockNeed === 's[1]', '阅读视图：甲要开关 1 开才能选 ' + rows[0].condText);
ok(rows[1].cond && /才显示/.test(rows[1].condText) && rows[1].cond.hideNeed === 'v[2]>=3', '阅读视图：乙满足才显示 ' + rows[1].condText);
ok(!rows[2].cond, '没条件的没有');
ok(/选项：甲（有条件）/.test(T.describer.describe(ch[0])), '「选项：」那一行不带标记');
const step = T.player.timeline(ch).steps.find(s => s.t === 'choice');
ok(step && step.options.join() === '甲,乙,丙' && step.conds && step.conds[0].lock && step.conds[1].hide && !step.conds[2], '预览：选项去掉标记、带上条件');
ok(stage.wants(ch) && !stage.wants(merge([END()], '：一句')), '有选项条件的要装演出插件');
// 编辑框：选项开头那一行
ok(/■ 选项（3 个）：甲〔有条件〕 \/ 乙〔有条件〕 \/ 丙/.test(T.merger.analyzeList(ch, { baseIndent: 0 }).text), '编辑框「■ 选项」行标出有条件的');

// ---------- 4. 演出插件 ----------
const src = stage.pluginSource();
let compiled = true;
try { new vm.Script(src); } catch (e) { compiled = false; fails.push('插件源码编译不过：' + e.message); }
ok(compiled, '插件源码能编译');
ok(new RegExp('v' + stage.VERSION).test(src.slice(0, 200)), '插件头上写着版本');
for (const k of Object.keys(stage.COMMANDS)) ok(src.includes('@command ' + k), '插件声明了指令 ' + k);
ok(src.includes(require('../core/scenes.js').MARK), '插件认场景标记');

if (fails.length) { console.log(`✖ ${fails.length} 项没过（${pass} 项通过）`); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log(`全部通过（${pass} 项）`);
