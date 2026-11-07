'use strict';
// 新建一个空白的 RPG Maker MZ 游戏
//   引擎（js/ 里的运行脚本）从别处拷：RPG Maker MZ 自带的空白工程（newdata）或者你已经有的一个 MZ 游戏。
//   编辑器本身不带引擎和素材——它们不是这个仓库的东西。
//   数据库（data/*.json）在这里从零生成：一个角色、一个职业、必需的技能 / 状态、一张空地图、系统设置（中文用语）。
//   不拷素材时，窗口皮肤 / 图标 / 触屏按钮画几张朴素的占位图，游戏能直接跑起来，之后用「导入素材」换掉。
//
//   const r = createGame(destDir, { title, engineDir, copyAssets })
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rmStringify } = require('./store.js');
const Maps = require('./maps.js');
const { canvas, encodePng } = require('../lib/png.js');

const ENGINE_FILES = ['js/rmmz_core.js', 'js/main.js'];
const SKIP_COPY = /(^|[\\/])(save|backups?|\.git|node_modules|Thumbs\.db|desktop\.ini|\.DS_Store)$/i;

// ---------- 引擎从哪来 ----------
// 一个文件夹能不能当引擎来源：有 MZ 的运行脚本（RPG Maker 的 newdata、任何 MZ 游戏都有）
function engineInfo(dir) {
  const root = path.resolve(String(dir || ''));
  const has = f => fs.existsSync(path.join(root, f));
  if (has('js/rpg_core.js') || has('www/js/rpg_core.js')) return { ok: false, error: '这是 MV 的游戏。新建游戏现在只支持用 MZ 的引擎' };
  const miss = ENGINE_FILES.filter(f => !has(f));
  if (miss.length) return { ok: false, error: '这里找不到 MZ 的运行脚本（' + miss.join('、') + '）' };
  let version = '';
  try { const m = /v(\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.join(root, 'js/rmmz_core.js'), 'utf8').slice(0, 400)); version = m ? m[1] : ''; } catch { }
  const assets = ['img/system', 'img/tilesets', 'img/characters'].filter(has);
  return { ok: true, dir: root, version, assets, isNewdata: /newdata$/i.test(root) || (!has('data/Map001.json') && has('img/tilesets')) };
}

// RPG Maker MZ 装在哪：Steam 版 / 官网版的常见位置（只在 Windows 上找）
function findRpgMakerMZ() {
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const d of 'CDEFGH') {
    for (const rel of [
      'Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata',
      'Program Files\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata',
      'SteamLibrary\\steamapps\\common\\RPG Maker MZ\\newdata',
      'Steam\\steamapps\\common\\RPG Maker MZ\\newdata',
      'Program Files\\KADOKAWA\\RPGMZ\\newdata',
      'Program Files (x86)\\KADOKAWA\\RPGMZ\\newdata',
    ]) {
      const p = d + ':\\' + rel;
      try { if (fs.existsSync(path.join(p, 'js', 'rmmz_core.js'))) out.push(p); } catch { }
    }
  }
  return out;
}

// ---------- 数据库 ----------
const audio = name => ({ name: name || '', pan: 0, pitch: 100, volume: 90 });
const vehicle = (idx) => ({ bgm: audio(''), characterIndex: idx, characterName: '', startMapId: 0, startX: 0, startY: 0 });

function terms() {
  return {
    basic: ['等级', 'Lv', 'HP', 'HP', 'MP', 'MP', 'TP', 'TP', '经验值', 'EXP'],
    commands: ['战斗', '逃跑', '攻击', '防御', '物品', '技能', '装备', '状态', '整队', '保存', '游戏结束', '设置', '武器', '防具', '贵重物品', '装备', '最强装备', '全部卸下', '开始游戏', '继续游戏', null, '返回标题', '取消', null, '购买', '卖出'],
    params: ['最大HP', '最大MP', '攻击力', '防御力', '魔法攻击', '魔法防御', '敏捷', '幸运', '命中率', '回避率'],
    messages: {
      alwaysDash: '始终奔跑', commandRemember: '记住上次的选择', touchUI: '触屏按钮',
      bgmVolume: '背景音乐 音量', bgsVolume: '背景声音 音量', meVolume: '音效旋律 音量', seVolume: '音效 音量',
      possession: '持有数', expTotal: '当前经验值', expNext: '距离下一%1',
      saveMessage: '保存到哪个文件？', loadMessage: '读取哪个文件？', file: '文件', autosave: '自动保存',
      partyName: '%1的队伍', emerge: '%1出现了！', preemptive: '%1先发制人！', surprise: '%1被偷袭了！',
      escapeStart: '%1开始逃跑！', escapeFailure: '但是没能逃掉！', victory: '%1胜利了！', defeat: '%1全军覆没了。',
      obtainExp: '获得了 %1 %2！', obtainGold: '获得了 %1\\G！', obtainItem: '获得了%1！', levelUp: '%1的%2升到了 %3！', obtainSkill: '学会了%1！',
      useItem: '%1使用了%2！', criticalToEnemy: '会心一击！', criticalToActor: '痛恨一击！',
      actorDamage: '%1受到了 %2 点伤害！', actorRecovery: '%1的%2回复了 %3！', actorGain: '%1的%2增加了 %3！', actorLoss: '%1的%2减少了 %3！',
      actorDrain: '%1的%2被吸走了 %3！', actorNoDamage: '%1没有受到伤害！', actorNoHit: '没有命中%1！',
      enemyDamage: '%1受到了 %2 点伤害！', enemyRecovery: '%1的%2回复了 %3！', enemyGain: '%1的%2增加了 %3！', enemyLoss: '%1的%2减少了 %3！',
      enemyDrain: '%1的%2被吸走了 %3！', enemyNoDamage: '%1没有受到伤害！', enemyNoHit: '没有命中%1！',
      evasion: '%1躲开了攻击！', magicEvasion: '%1抵消了魔法！', magicReflection: '%1反弹了魔法！', counterAttack: '%1反击了！', substitute: '%1保护了%2！',
      buffAdd: '%1的%2提升了！', debuffAdd: '%1的%2下降了！', buffRemove: '%1的%2恢复了！', actionFailure: '对%1没有效果！',
    },
  };
}

function systemJson(o) {
  const zh = /^zh/.test(o.locale);
  return {
    advanced: {
      gameId: o.gameId, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624,
      // 中文游戏用系统里的中文字体（引擎自带的 M+ 字体没有简体字形）；文件名留空 = 不加载字体文件
      numberFontFilename: zh ? '' : (o.fonts.number || ''), mainFontFilename: zh ? '' : (o.fonts.main || ''),
      fallbackFonts: zh ? '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif' : 'Verdana, sans-serif',
      fontSize: 26, windowOpacity: 192, screenScale: 1, picturesUpperLimit: 100,
    },
    airship: vehicle(3), boat: vehicle(0), ship: vehicle(1),
    armorTypes: ['', '普通防具', '魔法防具', '轻型防具', '重型防具', '小型盾', '大型盾'],
    attackMotions: [{ type: 0, weaponImageId: 0 }, { type: 1, weaponImageId: 1 }, { type: 1, weaponImageId: 2 }],
    battleBgm: audio(''), battleback1Name: '', battleback2Name: '', battlerHue: 0, battlerName: '', battleSystem: 0,
    currencyUnit: '元', defeatMe: audio(''), editMapId: 1,
    elements: ['', '物理', '火', '冰', '雷', '水', '土', '风', '光', '暗'],
    equipTypes: ['', '武器', '盾', '头', '身体', '装饰品'],
    gameTitle: o.title, gameoverMe: audio(''),
    hasEncryptedAudio: false, hasEncryptedImages: false, encryptionKey: '',
    itemCategories: [true, true, true, true], locale: o.locale, magicSkills: [1],
    menuCommands: [true, true, true, true, true, true],
    optAutosave: true, optDisplayTp: true, optDrawTitle: true, optExtraExp: false, optFloorDeath: false, optFollowers: false,
    optKeyItemsNumber: false, optSideView: false, optSlipDeath: false, optTransparent: false,
    partyMembers: [1], skillTypes: ['', '魔法', '必杀技'],
    // 系统音效全部留空：没有素材时不去加载，不然一开游戏就报「找不到文件」
    sounds: Array.from({ length: 24 }, () => audio('')),
    startMapId: 1, startX: 8, startY: 6,
    switches: ['', ...Array(20).fill('')], variables: ['', ...Array(20).fill('')],
    terms: terms(),
    testBattlers: [{ actorId: 1, equips: [0, 0, 0, 0, 0], level: 1 }], testTroopId: 0,
    title1Name: '', title2Name: '', titleBgm: audio(''), titleCommandWindow: { background: 0, offsetX: 0, offsetY: 0 },
    versionId: o.versionId, victoryMe: audio(''),
    weaponTypes: ['', '短剑', '剑', '连枷', '斧', '鞭', '杖', '弓', '弩', '枪', '爪', '拳套', '矛'],
    windowTone: [0, 0, 0, 0], tileSize: 48,
  };
}

function classParams() {
  const curve = (a, b) => Array.from({ length: 100 }, (_, lv) => Math.round(a + b * lv));
  return [curve(100, 30), curve(20, 5), curve(10, 2), curve(10, 2), curve(10, 2), curve(10, 2), curve(10, 2), curve(10, 2)];
}

function blankData(o) {
  const skill = (id, name, scope, msg) => ({
    id, animationId: -1, damage: { critical: id === 1, elementId: -1, formula: id === 1 ? 'a.atk * 4 - b.def * 2' : '0', type: id === 1 ? 1 : 0, variance: 20 },
    description: '', effects: id === 1 ? [{ code: 21, dataId: 0, value1: 1, value2: 0 }] : [{ code: 21, dataId: 2, value1: 1, value2: 0 }],
    hitType: id === 1 ? 1 : 0, iconIndex: id === 1 ? 76 : 81, message1: msg, message2: '', messageType: 1, mpCost: 0, name, note: '',
    occasion: 1, repeats: 1, requiredWtypeId1: 0, requiredWtypeId2: 0, scope, speed: id === 2 ? 2000 : 0, stypeId: 0, successRate: 100, tpCost: 0, tpGain: id === 1 ? 10 : 0,
  });
  const map = Maps.newMap({ width: 17, height: 13, tilesetId: 1, displayName: '' });
  const flags = new Array(8192).fill(0); flags[0] = 0x10;
  return {
    'Actors.json': [null, { id: 1, battlerName: '', characterIndex: 0, characterName: '', classId: 1, equips: [0, 0, 0, 0, 0], faceIndex: 0, faceName: '', traits: [], initialLevel: 1, maxLevel: 99, name: o.hero || '主角', nickname: '', note: '', profile: '' }],
    'Animations.json': [null],
    'Armors.json': [null],
    'Classes.json': [null, {
      id: 1, expParams: [30, 20, 30, 30], learnings: [], name: '普通人', note: '', params: classParams(),
      traits: [{ code: 23, dataId: 0, value: 1 }, { code: 22, dataId: 0, value: 0.95 }, { code: 22, dataId: 1, value: 0.05 }, { code: 22, dataId: 2, value: 0.04 }, { code: 41, dataId: 1, value: 1 }, { code: 51, dataId: 1, value: 0 }, { code: 52, dataId: 1, value: 0 }],
    }],
    'CommonEvents.json': [null],
    'Enemies.json': [null],
    'Items.json': [null],
    'MapInfos.json': [null, { id: 1, expanded: false, name: 'MAP001', order: 1, parentId: 0, scrollX: 0, scrollY: 0 }],
    'Map001.json': map,
    'Skills.json': [null, skill(1, '攻击', 1, '%1发动了攻击！'), skill(2, '防御', 11, '%1在防御。')],
    'States.json': [null, {
      id: 1, autoRemovalTiming: 0, chanceByDamage: 100, iconIndex: 1, maxTurns: 1, message1: '倒下了！', message2: '被打倒了！', message3: '', message4: '站起来了！', messageType: 1,
      minTurns: 1, motion: 3, name: '战斗不能', note: '', overlay: 0, priority: 100, releaseByDamage: false, removeAtBattleEnd: false, removeByDamage: false,
      removeByRestriction: false, removeByWalking: false, restriction: 4, stepsToRemove: 100, traits: [{ code: 23, dataId: 9, value: 0 }],
    }],
    'System.json': systemJson(o),
    'Tilesets.json': [null, { id: 1, flags, mode: 1, name: '图块集 1', note: '', tilesetNames: ['', '', '', '', '', '', '', '', ''] }],
    'Troops.json': [null],
    'Weapons.json': [null],
  };
}

// ---------- 占位的系统图（不拷素材时用） ----------
// 窗口皮肤（192×192）：左上背景、右上边框、光标、翻页箭头、等待的小三角、文字颜色表——位置都照 MZ 的约定
function windowSkin() {
  const c = canvas(192, 192);
  c.rect(0, 0, 96, 96, [24, 28, 38, 255]);                       // 背景
  for (let y = 0; y < 96; y += 4) c.rect(0, 96 + y, 96, 2, [255, 255, 255, 10]);   // 背景上叠的花纹（很淡的横线）
  c.frame(96, 0, 96, 96, [200, 205, 215, 255], 2);                 // 边框
  c.frame(99, 3, 90, 90, [80, 86, 100, 255], 1);
  c.rect(96, 96, 48, 48, [255, 255, 255, 40]); c.frame(96, 96, 48, 48, [255, 255, 255, 140], 2);   // 光标
  for (let i = 0; i < 8; i++) { c.rect(160 - i, 100 + i, 2 * i + 1, 1, [230, 230, 235, 255]); c.rect(160 - i, 139 - i, 2 * i + 1, 1, [230, 230, 235, 255]); }   // 上下箭头
  for (let f = 0; f < 4; f++) for (let i = 0; i < 6; i++) c.rect(144 + (f % 2) * 24 + 6 + i, 144 + Math.floor(f / 2) * 24 + 8 + i + (f % 2), 12 - 2 * i, 1, [235, 235, 240, 255]);   // 等待输入的小三角
  const colors = [
    [255, 255, 255], [32, 160, 214], [255, 120, 76], [102, 204, 64], [153, 204, 255], [204, 192, 255], [255, 255, 160], [128, 128, 128],
    [192, 192, 192], [32, 112, 204], [255, 56, 16], [0, 160, 16], [62, 154, 222], [160, 152, 255], [255, 204, 32], [0, 0, 0],
    [132, 170, 255], [255, 255, 64], [255, 32, 32], [32, 32, 64], [224, 128, 64], [240, 192, 64], [64, 128, 192], [64, 192, 240],
    [128, 255, 128], [192, 128, 128], [128, 128, 255], [255, 128, 255], [0, 160, 64], [0, 224, 96], [160, 96, 224], [192, 128, 255],
  ];
  colors.forEach((rgb, n) => c.rect(96 + (n % 8) * 12, 144 + Math.floor(n / 8) * 12, 12, 12, [...rgb, 255]));
  return encodePng(c);
}
// 触屏按钮（ButtonSet）：一格 48×48，上一行平时、下一行按下；顺序照 Sprite_Button.buttonData
function buttonSet() {
  const c = canvas(48 * 11, 96);
  const W = [235, 235, 240, 255];
  const box = (bx, w, row) => { c.rect(bx * 48 + 2, row * 48 + 2, w * 48 - 4, 44, row ? [90, 100, 120, 230] : [40, 46, 60, 220]); c.frame(bx * 48 + 2, row * 48 + 2, w * 48 - 4, 44, [200, 205, 215, 255], 2); };
  const tri = (cx, cy, up) => { for (let i = 0; i < 9; i++) c.rect(cx - i, cy + (up ? i : -i), 2 * i + 1, 1, W); };
  for (const row of [0, 1]) {
    box(0, 2, row); c.rect(30, row * 48 + 22, 36, 4, W);                       // 取消
    box(2, 1, row); tri(120, row * 48 + 16, true); box(3, 1, row); tri(168, row * 48 + 32, false);   // 上一页 / 下一页
    box(4, 1, row); tri(216, row * 48 + 30, false); box(5, 1, row); tri(264, row * 48 + 18, true);   // 下 / 上
    box(6, 1, row); tri(312, row * 48 + 30, false); box(7, 1, row); tri(360, row * 48 + 18, true);
    box(8, 2, row); c.rect(420, row * 48 + 22, 24, 4, W); c.rect(430, row * 48 + 12, 4, 24, W);   // 确定
    box(10, 1, row); for (const y of [16, 23, 30]) c.rect(492, row * 48 + y, 24, 3, W);             // 菜单
  }
  return encodePng(c);
}
const iconSet = () => encodePng(canvas(512, 32));
// 地图上一定会加载的：飞艇的影子（Shadow1）；战斗、气泡、游戏结束用的也补上空图，免得哪天用到时报「找不到文件」
function shadow(w, h) {
  const c = canvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (x - w / 2 + 0.5) / (w / 2), dy = (y - h / 2 + 0.5) / (h / 2); if (dx * dx + dy * dy < 1) c.px(x, y, [0, 0, 0, 110]); }
  return encodePng(c);
}
const EXTRA_SYSTEM = [['Shadow1', () => shadow(48, 48)], ['Shadow2', () => shadow(64, 24)], ['Balloon', () => encodePng(canvas(384, 720))], ['GameOver', () => { const c = canvas(816, 624); c.rect(0, 0, 816, 624, [0, 0, 0, 255]); return encodePng(c); }], ['States', () => encodePng(canvas(96, 96))], ['Weapons1', () => encodePng(canvas(96, 64))], ['Weapons2', () => encodePng(canvas(96, 64))], ['Weapons3', () => encodePng(canvas(96, 64))]];

// ---------- 拷文件 ----------
function copyDir(src, dest, filter) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (SKIP_COPY.test(e.name) || (filter && !filter(s, e))) continue;
    if (e.isDirectory()) n += copyDir(s, d, filter);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function indexHtml(title) {
  return `<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="user-scalable=no">
        <link rel="icon" href="icon/icon.png" type="image/png">
        <link rel="apple-touch-icon" href="icon/icon.png">
        <link rel="stylesheet" type="text/css" href="css/game.css">
        <title>${title.replace(/[<>&]/g, '')}</title>
    </head>
    <body style="background-color: black">
        <script type="text/javascript" src="js/main.js"></script>
    </body>
</html>
`;
}
// 引擎来源里没有 css/game.css 时补一份：加载中的转圈、出错时的提示（main.js 会用到这两个元素）
const GAME_CSS = `body { background: #000; margin: 0; overflow: hidden; }
#errorPrinter { position: absolute; left: 0; right: 0; top: 0; bottom: 0; margin: auto; width: 90%; height: 40%; text-align: center; color: #fff; font: 20px sans-serif; text-shadow: 1px 1px 3px #000; z-index: 99; }
#errorName { color: #ff8; font-weight: bold; margin-bottom: 12px; }
#loadingSpinner { margin: auto; position: absolute; left: 0; top: 0; right: 0; bottom: 0; width: 96px; height: 96px; z-index: 10; }
#loadingSpinnerImage { width: 100%; height: 100%; border-radius: 50%; border: 12px solid rgba(255, 255, 255, 0.2); border-top-color: rgba(255, 255, 255, 0.7); box-sizing: border-box; animation: rmspin 1.4s linear infinite; }
@keyframes rmspin { to { transform: rotate(360deg); } }
`;
const PLUGINS_JS ='// Generated by RPG Maker.\n// Do not edit this file directly.\nvar $plugins =\n[\n];\n';

// 新建游戏：dest 必须是不存在或空的文件夹
//   o.title 游戏标题；o.engineDir 引擎来源；o.copyAssets 连素材一起拷（RPG Maker 的 newdata、你自己的游戏）
//   o.hero 主角名；o.locale 语言（默认 zh_CN）
function createGame(dest, o) {
  const title = String(o.title || '').trim().slice(0, 60);
  if (!title) throw new Error('给游戏起个名字');
  const eng = engineInfo(o.engineDir);
  if (!eng.ok) throw new Error(eng.error);
  dest = path.resolve(dest);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('这个文件夹不是空的：' + dest);
  if (dest.startsWith(eng.dir + path.sep)) throw new Error('不能把新游戏放进引擎来源的文件夹里');
  fs.mkdirSync(dest, { recursive: true });
  const src = eng.dir;
  try {
    // 1. 引擎：js/（插件不拷，新游戏从干净的插件列表开始）、字体、样式、图标
    copyDir(path.join(src, 'js'), path.join(dest, 'js'), s => !/[\\/]js[\\/]plugins(\.js)?$/i.test(s));
    fs.mkdirSync(path.join(dest, 'js', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'js', 'plugins.js'), PLUGINS_JS, 'utf8');
    require('./stage.js').ensure(dest);   // 演出插件（#飘字 #动作）新游戏直接带上
    for (const d of ['fonts', 'css', 'icon']) copyDir(path.join(src, d), path.join(dest, d));
    if (!fs.existsSync(path.join(dest, 'css', 'game.css'))) { fs.mkdirSync(path.join(dest, 'css'), { recursive: true }); fs.writeFileSync(path.join(dest, 'css', 'game.css'), GAME_CSS, 'utf8'); }
    let html = fs.existsSync(path.join(src, 'index.html')) ? fs.readFileSync(path.join(src, 'index.html'), 'utf8') : indexHtml(title);
    html = /<title>[^<]*<\/title>/i.test(html) ? html.replace(/<title>[^<]*<\/title>/i, '<title>' + title.replace(/[<>&]/g, '') + '</title>') : html;
    fs.writeFileSync(path.join(dest, 'index.html'), html, 'utf8');
    const pkgName = 'game-' + crypto.randomBytes(3).toString('hex');
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: pkgName, main: 'index.html', 'chromium-args': '--force-color-profile=srgb', window: { title, width: 816, height: 624, position: 'center', icon: 'icon/icon.png' } }, null, 4), 'utf8');
    let proj = 'RPGMZ ' + (eng.version || '1.0.0');
    try { proj = fs.readFileSync(path.join(src, 'game.rmmzproject'), 'utf8').trim() || proj; } catch { }
    fs.writeFileSync(path.join(dest, 'game.rmmzproject'), proj, 'utf8');

    // 2. 数据库
    let fonts = {};
    try { const s0 = JSON.parse(fs.readFileSync(path.join(src, 'data', 'System.json'), 'utf8').replace(/^﻿/, '')); fonts = { main: (s0.advanced || {}).mainFontFilename, number: (s0.advanced || {}).numberFontFilename, sys: s0 }; } catch { }
    const data = blankData({ title, locale: o.locale || 'zh_CN', hero: o.hero, gameId: crypto.randomInt(1, 2 ** 31 - 1), versionId: crypto.randomInt(1, 2 ** 31 - 1), fonts });
    // 3. 素材：一起拷（图块集定义也跟着拷，通行设置才对得上），或者画占位的系统图
    let assets = 0;
    if (o.copyAssets) {
      for (const d of ['img', 'audio', 'effects']) assets += copyDir(path.join(src, d), path.join(dest, d), s => !/[\\/]img[\\/]pictures$/i.test(s));
      for (const f of ['Tilesets.json', 'Animations.json']) {
        try { data[f] = JSON.parse(fs.readFileSync(path.join(src, 'data', f), 'utf8').replace(/^﻿/, '')); } catch { }
      }
      const s0 = fonts.sys || {};
      if (s0.hasEncryptedImages || s0.hasEncryptedAudio) Object.assign(data['System.json'], { hasEncryptedImages: !!s0.hasEncryptedImages, hasEncryptedAudio: !!s0.hasEncryptedAudio, encryptionKey: s0.encryptionKey || '' });
      // 系统音效：newdata 里有 RTP 的声音，按 RPG Maker 默认的名字填上
      if (fs.existsSync(path.join(dest, 'audio', 'se', 'Cursor3.ogg')) && Array.isArray(s0.sounds)) data['System.json'].sounds = s0.sounds;
    }
    const sysDir = path.join(dest, 'img', 'system');
    fs.mkdirSync(sysDir, { recursive: true });
    for (const [n, make] of [['Window', windowSkin], ['IconSet', iconSet], ['ButtonSet', buttonSet], ...EXTRA_SYSTEM]) {
      if (!fs.existsSync(path.join(sysDir, n + '.png')) && !fs.existsSync(path.join(sysDir, n + '.png_'))) fs.writeFileSync(path.join(sysDir, n + '.png'), make());
    }
    for (const d of ['img/characters', 'img/faces', 'img/pictures', 'img/tilesets', 'img/parallaxes', 'audio/bgm', 'audio/bgs', 'audio/me', 'audio/se']) fs.mkdirSync(path.join(dest, d), { recursive: true });
    const dataDir = path.join(dest, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    for (const [f, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, f), rmStringify(v), 'utf8');
    // 4. 编辑器自己的设置跟着游戏走（剧情进度的分法、图片编号段……），挪文件夹、打包给别人都不丢
    fs.writeFileSync(path.join(dest, 'rpgstudio.json'), JSON.stringify({ createdBy: 'rpgStudio', createdAt: new Date().toISOString(), engineFrom: src, settings: {} }, null, 2), 'utf8');
    // 5. 双击启动器（开始游戏.cmd）：不开编辑器也能玩
    const launcher = require('./launcher.js');
    launcher.write(dest, { title, nodePath: launcher.localNode() });
    return { dir: dest, title, engine: eng, assets };
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { createGame, engineInfo, findRpgMakerMZ, blankData, windowSkin, buttonSet };
