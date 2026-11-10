#!/usr/bin/env node
'use strict';
// 在真的 RPG Maker MZ 运行时里测演出插件（会开一个无界面的浏览器跑游戏）
//   node studio/test/runtime.js <MZ 引擎来源> [--wd WD_ConditionalChoice.js] [--shots 截图前缀]
//   引擎来源 = 有 js/rmmz_core.js 的文件夹：RPG Maker MZ 的 newdata，或者随便一个 MZ 游戏
//   要装 playwright（npm i playwright，再 npx playwright install chromium）
// 测什么：
//   用编辑器的「新建游戏」在临时文件夹里生成一个小游戏，再用编辑框的写法写几段剧情（存的时候自动装演出插件）：
//   场景独立：场景里 #传送 圣佳 …（换成圣佳演、传送过去、到了往前走）→ 场景播完回到原来的格子、换回主角、队友跟着，
//             调用场景的那一页等传送回来才往下走；场景外的 #传送 就是主角传送，不回去
//   选项条件：<<[…]>> 灰掉、点不了；(([…])) 不显示，分支编号不乱；--wd 时同时装上 WD_ConditionalChoice，交给它演
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('要先装 playwright：npm i playwright && npx playwright install chromium'); process.exit(2); }
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
const ENGINE = args.find((a, i) => !a.startsWith('--') && !['--wd', '--shots'].includes(args[i - 1]));
if (!ENGINE) { console.error('用法：node studio/test/runtime.js <MZ 引擎来源> [--wd WD_ConditionalChoice.js] [--shots 截图前缀]'); process.exit(2); }
const DEST = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgstudio-rt-')) + path.sep + 'game';
const ROOT = DEST, SHOT = opt('--shots');

// ---------- 1. 造一个小游戏 ----------
const { createGame } = require('../core/blank.js');
const { canvas, encodePng } = require('../lib/png.js');
const { createStudio } = require('../handler.js');
const { MARK_CMD } = require('../core/scenes.js');
createGame(DEST, { title: 'RT', engineDir: ENGINE });
const D = f => path.join(DEST, 'data', f);
const rd = f => JSON.parse(fs.readFileSync(D(f), 'utf8'));
const wr = (f, v) => fs.writeFileSync(D(f), JSON.stringify(v));
// 字体：只有这一个
const sys = rd('System.json');
const fonts = fs.existsSync(path.join(DEST, 'fonts')) ? fs.readdirSync(path.join(DEST, 'fonts')).filter(f => /\.(woff2?|ttf|otf)$/i.test(f)) : [];
for (const k of ['mainFontFilename', 'numberFontFilename']) if (!fonts.includes(sys.advanced[k]) && fonts.length) sys.advanced[k] = fonts[0];
sys.partyMembers = [1, 3]; sys.optFollowers = true; sys.startMapId = 1; sys.startX = 3; sys.startY = 3;
sys.titleBgm = { name: '', pan: 0, pitch: 100, volume: 90 };
sys.sounds = sys.sounds.map(s => ({ ...s, name: '' }));
wr('System.json', sys);
// 角色：林屿（主角）、圣佳、伙伴
const actors = rd('Actors.json');
const base = actors[1];
actors[1] = { ...base, id: 1, name: '林屿', characterName: 'Hero', characterIndex: 0 };
actors[2] = { ...base, id: 2, name: '圣佳', characterName: 'Seika', characterIndex: 0 };
actors[3] = { ...base, id: 3, name: '伙伴', characterName: 'Hero', characterIndex: 1 };
wr('Actors.json', actors);
// 行走图（纯色块）
const sheet = (rgb) => { const c = canvas(576, 384); for (let i = 0; i < 8; i++) c.rect((i % 4) * 144, Math.floor(i / 4) * 192, 144, 192, [rgb[0], rgb[1], (rgb[2] + i * 20) % 256, 255]); return encodePng(c); };
fs.writeFileSync(path.join(DEST, 'img/characters/Hero.png'), sheet([40, 90, 200]));
fs.writeFileSync(path.join(DEST, 'img/characters/Seika.png'), sheet([220, 60, 120]));
// 第二张地图「学校」
const m1 = rd('Map001.json');
m1.width = Math.max(m1.width, 20); m1.height = Math.max(m1.height, 15);
m1.data = new Array(m1.width * m1.height * 6).fill(0);
for (let i = 0; i < m1.width * m1.height; i++) m1.data[i] = 1536;   // 地上铺一层能走的图块（A5 第一格）
wr('Map001.json', m1);
wr('Map002.json', { ...m1, displayName: '学校', events: [null] });
const infos = rd('MapInfos.json');
infos[2] = { ...infos[1], id: 2, name: '学校', order: 2 };
wr('MapInfos.json', infos);
// 用编辑器写：场景（CE 1）、调用它的（CE 2）、带条件的选项（CE 3）、场景外的传送（CE 4）
const studio = createStudio({ gameDir: DEST, checkHost: false, backupsDir: path.join(path.dirname(DEST), 'backups') });
let T = studio.tools();
const ces = rd('CommonEvents.json');
while (ces.length < 6) ces.push({ id: ces.length, list: [{ code: 0, indent: 0, parameters: [] }], name: '', switchId: 1, trigger: 0 });
ces.forEach((c, i) => { if (c) c.id = i; });
wr('CommonEvents.json', ces);
studio.project.invalidate && studio.project.invalidate();
T = studio.tools();
const merge = (base, text) => { const al = T.merger.analyzeList(base, { baseIndent: 0 }); return T.merger.mergeList(base, (al.text ? al.text + '\n' : '') + text, { analysis: al }).list; };
const END = { code: 0, indent: 0, parameters: [] };
const scene = merge([MARK_CMD(), END], '#传送 圣佳 学校 5 5 前进2\n圣佳：我在学校。\n#动作 圣佳 右\n圣佳：走一步。');
T.store.edit(['CommonEvents.json'], docs => { docs['CommonEvents.json'][1] = { id: 1, list: scene, name: '场景甲', switchId: 1, trigger: 0 }; });
T = studio.tools();
const caller = merge([END], '#场景 场景甲\n#变量 2 = 7');
// 场景播完以后：记下这时候在哪张地图（要等传送回去再往下走）
caller.splice(caller.length - 1, 0, { code: 355, indent: 0, parameters: ['$gameVariables.setValue(3, $gameMap.mapId() * 1000 + $gamePlayer.x * 10 + $gamePlayer.y)'] });
const choice = merge([END], '#选项 普通 | <<[s[1]]>>锁住的 | (([s[2]]))藏起来 | 最后\n#1 #变量 1 = 1\n#2 #变量 1 = 2\n#3 #变量 1 = 3\n#4 #变量 1 = 4');
const plain = merge([END], '#传送 学校 2 2 朝上');
T.store.edit(['CommonEvents.json'], docs => {
  const a = docs['CommonEvents.json'];
  a[1] = { id: 1, list: scene, name: '场景甲', switchId: 1, trigger: 0 };
  a[2] = { id: 2, list: caller, name: '调用场景', switchId: 1, trigger: 0 };
  a[3] = { id: 3, list: choice, name: '选项', switchId: 1, trigger: 0 };
  a[4] = { id: 4, list: plain, name: '主角传送', switchId: 1, trigger: 0 };
});

// 同时装上 WD_ConditionalChoice：选项条件交给它，演出插件不插手
if (opt('--wd')) {
  fs.copyFileSync(opt('--wd'), path.join(DEST, 'js/plugins/WD_ConditionalChoice.js'));
  const f = path.join(DEST, 'js/plugins.js');
  const wdEntry = { name: 'WD_ConditionalChoice', status: true, description: '', parameters: { disabledSE: '', hiddenDefault: 'hidden1', alternativeText: '[]', errorHandling: 'error1', choiceColors: '{"active":"0","disabled":"7"}' } };
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('[\n', '[\n' + JSON.stringify(wdEntry) + ',\n'));
}

// ---------- 2. 在浏览器里跑 ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff': 'font/woff', '.wasm': 'application/wasm', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✖ ' + m); } };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 816, height: 624 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.SceneManager && SceneManager._scene && SceneManager._scene.constructor.name === 'Scene_Title', null, { timeout: 30000 });
  await page.evaluate(() => { DataManager.setupNewGame(); SceneManager.goto(Scene_Map); });
  await page.waitForFunction(() => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isReady() && !$gamePlayer.isTransferring() && $gameMap.mapId() === 1, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const state = () => page.evaluate(() => ({ map: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, d: $gamePlayer.direction(), sheet: $gamePlayer.characterName(), idx: $gamePlayer.characterIndex(), followers: $gamePlayer.followers().isVisible(), as: $gamePlayer._rsAs, msg: $gameMessage.isBusy(), running: $gameMap.isEventRunning(), v: [1, 2, 3].map(i => $gameVariables.value(i)) }));
  const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(50); } return false; };
  const pressOk = () => page.keyboard.press('Enter');
  // 一直按确定，直到条件成立（对话框第一下是把字显示完，第二下才关）
  const advance = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; if (await page.evaluate(() => $gameMessage.isBusy())) await pressOk(); await page.waitForTimeout(150); } return false; };

  console.log('场景独立：');
  const s0 = await state();
  ok(s0.map === 1 && s0.sheet === 'Hero' && s0.followers, '开始：在地图 1，主角 Hero，队友跟着 ' + JSON.stringify(s0));
  await page.evaluate(() => $gameMap._interpreter.setup($dataCommonEvents[2].list, 0));
  ok(await until(() => $gameMap.mapId() === 2 && !$gamePlayer.isTransferring()), '场景里传送到地图 2');
  const s1 = await state();
  ok(s1.sheet === 'Seika' && !s1.followers && s1.as && s1.as.name === '圣佳', '换成圣佳演、队友不跟着 ' + JSON.stringify({ sheet: s1.sheet, f: s1.followers }));
  ok(await until(() => $gameMessage.isBusy()), '到了以后走完再说话');
  const s2 = await state();
  ok(s2.x === 5 && s2.y === 7, '到了往前走了 2 格（朝下）：(' + s2.x + ', ' + s2.y + ')');
  if (SHOT) await page.screenshot({ path: SHOT + '-scene.png' });
  ok(await advance(() => $gameMessage.isBusy() && $gamePlayer.x === 6 && /走一步/.test($gameMessage.allText())), '#动作 圣佳 右 → 找到的是主角的小人（往右一格）');
  ok(await advance(() => $gameMap.mapId() === 1 && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning()), '场景播完回到地图 1');
  const s3 = await state();
  ok(s3.x === s0.x && s3.y === s0.y && s3.sheet === 'Hero' && s3.followers && !s3.as, '回到原来的格子、换回 Hero、队友又跟着 ' + JSON.stringify({ x: s3.x, y: s3.y, sheet: s3.sheet, f: s3.followers }));
  ok(s3.v[1] === 7 && s3.v[2] === 1000 + s0.x * 10 + s0.y, '调用场景的那一页接着往下走，而且是传送回来以后才走（记下的位置 ' + s3.v[2] + '）');

  console.log('场景外的传送：');
  await page.evaluate(() => $gameMap._interpreter.setup($dataCommonEvents[4].list, 0));
  ok(await until(() => $gameMap.mapId() === 2 && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning()), '传送到地图 2');
  await page.waitForTimeout(400);
  const s4 = await state();
  ok(s4.map === 2 && s4.x === 2 && s4.y === 2 && s4.d === 8 && s4.sheet === 'Hero', '留在那里（不是场景，不回去），朝上 ' + JSON.stringify({ map: s4.map, x: s4.x, y: s4.y, d: s4.d }));

  console.log('选项条件：');
  const runChoice = async (s1on, s2on) => {
    await page.evaluate(([a, b]) => { $gameSwitches.setValue(1, a); $gameSwitches.setValue(2, b); $gameVariables.setValue(1, 0); $gameMap._interpreter.setup($dataCommonEvents[3].list, 0); }, [s1on, s2on]);
    await until(() => { const w = SceneManager._scene._messageWindow && SceneManager._scene._messageWindow._choiceListWindow; return w && w.active && w.isOpen() && w._list.length > 0; });
    await page.waitForTimeout(200);
    return page.evaluate(() => { const w = SceneManager._scene._messageWindow._choiceListWindow; return w._list.map(c => (c.enabled && !/^\\C\[7\]/.test(c.name) ? '' : '灰:') + c.name.replace(/^\\C\[\d+\]/, '')); });   // 装了 WD_ConditionalChoice 时它用灰色字（\C[7]）表示
  };
  let items = await runChoice(true, true);
  ok(JSON.stringify(items) === JSON.stringify(['普通', '灰:锁住的', '最后']), '开关 1、2 都开：「锁住的」是灰的，「藏起来」不显示 ' + JSON.stringify(items));
  await page.waitForTimeout(300);
  if (SHOT) await page.screenshot({ path: SHOT + '-choice.png' });
  await page.evaluate(() => SceneManager._scene._messageWindow._choiceListWindow.select(1));
  await pressOk();
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => SceneManager._scene._messageWindow._choiceListWindow.active && $gameVariables.value(1) === 0), '点灰的那个：选不了（窗口还在）');
  await page.evaluate(() => SceneManager._scene._messageWindow._choiceListWindow.select(2));
  await pressOk();
  ok(await until(() => !$gameMap.isEventRunning() && $gameVariables.value(1) === 4), '选「最后」→ 走第 4 个分支（藏起来的不打乱编号）');
  items = await runChoice(false, false);
  ok(JSON.stringify(items) === JSON.stringify(['普通', '锁住的', '藏起来', '最后']), '开关都关：四个都在、都能选 ' + JSON.stringify(items));
  await page.evaluate(() => SceneManager._scene._messageWindow._choiceListWindow.select(2));
  await pressOk();
  ok(await until(() => !$gameMap.isEventRunning() && $gameVariables.value(1) === 3), '选「藏起来」→ 第 3 个分支');
  const real = errs.filter(e => !/GL Driver|willReadFrequently|GPU stall|CanvasTextAlign/.test(e));
  ok(!real.length, '没有报错 ' + real.slice(0, 3).join(' | '));
  console.log(fail ? `✖ ${fail} 项没过（${pass} 项通过）` : `全部通过（${pass} 项）`);
  await browser.close(); srv.close();
  fs.rmSync(path.dirname(DEST), { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
