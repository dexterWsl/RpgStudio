'use strict';
// 演出插件 RpgStudio_Stage：编辑框里的 #飘字 / #动作 变成这个插件的插件指令，游戏里由它来演
//   #飘字 [谁：]文字      字从人物头上（或画面中间）飘起来再淡掉，不挡剧情往下走
//   #动作 谁 步骤…        按名字找到这个人（主角 / 本事件 / 地图上叫这个名字的事件），走几步、转身、跳、冒气泡
//   按名字找人，所以写在场景（公共事件）里也行，不用管事件编号。
//
//   ensure(root)：游戏里没有这个插件就装上（写 js/plugins/RpgStudio_Stage.js，在 js/plugins.js 里登记）；版本旧了就换新的
//   usesStage(list)：这一串指令里有没有用到它
const fs = require('fs');
const path = require('path');

const PLUGIN = 'RpgStudio_Stage';
const VERSION = 7;

// 步骤（#动作 后面的那些词）→ 移动路线指令编号（Game_Character.ROUTE_*）
//   上下左右可以带步数（上3）；等可以带秒（等0.5）；速度 1~6
const STEP_CODES = {
  上: 4, 下: 1, 左: 2, 右: 3, 前进: 12, 后退: 13, 靠近主角: 10, 远离主角: 11, 乱走: 9,
  转上: 19, 转下: 16, 转左: 17, 转右: 18, 转身: 22, 面向主角: 25, 背对主角: 26,
  跳: 14, 慢: 29, 快: 29, 隐身: 39, 现身: 40, 穿透: 37, 不穿透: 38, 踏步: 33, 停步: 34,
};
const BALLOON_STEPS = { '！': 1, '!': 1, '？': 2, '?': 2, '♪': 3, '♥': 4, '怒': 5, '汗': 6, '乱': 7, '…': 8, '……': 8, '灯': 9, 'Zzz': 10, 'zzz': 10 };
const STEP_RE = /^(?:(上|下|左|右)(\d{1,2})?|等(\d+(?:\.\d+)?)秒?|速度([1-6]))$/;
const validStep = s => STEP_RE.test(s) || s in STEP_CODES || s in BALLOON_STEPS;

const pluginSource = () => `//=============================================================================
// ${PLUGIN}.js  v${VERSION}
// rpgStudio 演出插件（编辑器自动装上的；#飘字 / #动作 用它来演，别删）
//=============================================================================
/*:
 * @target MZ
 * @plugindesc rpgStudio 演出：头顶飘字、按名字让人物做动作
 * @author rpgStudio
 * @url https://github.com/dexterWsl/rpgstudio
 *
 * @help
 * rpgStudio 编辑框里的这两种写法会变成这个插件的插件指令：
 *
 *   #飘字 林屿：真的是我的问题吗      字从林屿头上飘起来再淡掉（不挡剧情）
 *   #飘字 画面：……                 在画面中间随便一处飘
 *   #飘字 没人知道                   不写名字 = 主角头上
 *
 *   #动作 赵磊 转身 ！ 下2 等0.5 转上
 *   #动作 王浩 跳 不等               不等 = 不等他做完，接着往下（两个人一起动）
 *
 * 并行事件（比如路人闲聊）里的飘字，剧情在演、对话框开着的时候不飘。
 *
 * 「谁」：主角 / 本事件 / 带队角色的名字（= 主角）/ 这张地图上事件的名字
 *       （事件名「赵磊·吃饭/赵磊」「赵磊·走」这种也认得出是赵磊；有好几个时先找看得见的）。
 * 步骤：上 下 左 右（可带步数：上3）、前进、后退、靠近主角、远离主角、乱走、
 *       转上 转下 转左 转右、转身、面向主角、背对主角、跳、等0.5（秒）、
 *       速度1~6、慢、快、隐身、现身、穿透、不穿透、踏步、停步、
 *       气泡：！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz
 * 走不过去的那一步会跳过，不会卡住。
 *
 * @command float
 * @text 飘字
 * @arg who
 * @text 谁
 * @desc 主角 / 本事件 / 画面 / 地图上事件的名字；空 = 主角
 * @default
 * @arg text
 * @text 文字
 * @default
 *
 * @command act
 * @text 动作
 * @arg who
 * @text 谁
 * @default 主角
 * @arg steps
 * @text 步骤
 * @desc 用空格隔开，比如：转身 ！ 下2 等0.5
 * @default
 * @arg wait
 * @text 等做完
 * @type boolean
 * @default true
 */
(() => {
  const NAME = "${PLUGIN}";
  const MZ = typeof PluginManager.registerCommand === "function";
  const CODES = ${JSON.stringify(STEP_CODES)};
  const BALLOONS = ${JSON.stringify(BALLOON_STEPS)};

  // ---------- 找人 ----------
  function findCharacter(interp, who) {
    who = String(who || "").trim();
    if (!who || who === "主角" || who === "玩家") return $gamePlayer;
    if (who === "本事件" || who === "这个人") return interp.character(0);
    const leader = $gameParty.leader();
    if (leader && leader.name() === who) return $gamePlayer;
    // 名字完全一样的优先；其次是「赵磊·吃饭/赵磊」这种几个名字拼起来的、或「赵磊·走」这种带后缀的
    const names = e => String((e.event() && e.event().name) || "").split("/").map(s => s.trim());
    const all = $gameMap.events().filter(e => e && e.event() && !e._erased);
    const tiers = [
      all.filter(e => e.event().name === who),
      all.filter(e => names(e).includes(who)),
      all.filter(e => names(e).some(n => n.split("·")[0] === who)),
    ];
    // 先在每一档里找看得见的（这一段有行走图的那个），都没有再退回看不见的
    for (const t of tiers) { const v = t.find(e => e.characterName() && e.page()); if (v) return v; }
    for (const t of tiers) if (t.length) return t[0];
    return null;
  }
  const charRef = ch => (ch === $gamePlayer ? { p: 1 } : ch ? { e: ch.eventId() } : null);
  const charOf = ref => (!ref ? null : ref.p ? $gamePlayer : $gameMap.event(ref.e));

  // ---------- 飘字 ----------
  const floats = () => ($gameTemp._rsFloats = $gameTemp._rsFloats || []);
  let serial = 0;
  // 并行事件（路人闲聊）里的飘字：剧情在演、对话框开着的时候不飘，不抢戏
  function ambientBusy(interp) {
    const id = interp && interp._eventId;
    const ev = id > 0 && $gameMap.event(id);
    if (!ev || ev._trigger !== 4) return false;
    return $gameMap.isEventRunning() || $gameMessage.isBusy();
  }
  function addFloat(interp, who, text) {
    text = String(text || "");
    if (!text || ambientBusy(interp)) return;
    const screen = String(who || "").trim() === "画面";
    const ch = screen ? null : findCharacter(interp, who);
    if (!screen && !ch) return;
    const len = [...text].length;
    const life = Math.min(480, 170 + len * 7);
    const list = floats();
    // 同一个人头上已经有字：旧的往上让一行（像念头一个一个冒出来，把前面的顶上去），新的左右稍微错开一点
    const same = list.filter(f => (screen ? f.screen : !f.screen && JSON.stringify(f.ref) === JSON.stringify(charRef(ch))));
    for (const o of same) o.lift = (o.lift || 0) + (screen ? 40 : 32);
    const dx = same.length ? Math.round((Math.random() * 2 - 1) * 26) : 0;
    const f = { id: ++serial, text, t: 0, life, dx, screen, ref: charRef(ch), big: screen, lift: 0, shown: 0 };
    if (screen) {
      f.x = Math.round(Graphics.width * (0.22 + Math.random() * 0.56));
      f.y = Math.round(Graphics.height * (0.34 + Math.random() * 0.36));
    }
    list.push(f);
  }

  function Sprite_RsFloat() { this.initialize(...arguments); }
  Sprite_RsFloat.prototype = Object.create(Sprite.prototype);
  Sprite_RsFloat.prototype.constructor = Sprite_RsFloat;
  Sprite_RsFloat.prototype.initialize = function(f) {
    Sprite.prototype.initialize.call(this);
    this._f = f;
    const size = f.big ? 26 : 21;
    const face = MZ ? $gameSystem.mainFontFace() : "GameFont";
    const probe = new Bitmap(1, 1);
    probe.fontFace = face; probe.fontSize = size;
    const w = Math.ceil(probe.measureTextWidth(f.text)) + 16, h = size + 14;
    this.bitmap = new Bitmap(w, h);
    this.bitmap.fontFace = face;
    this.bitmap.fontSize = size;
    this.bitmap.outlineColor = "rgba(0, 0, 0, 0.8)";
    this.bitmap.outlineWidth = 5;
    this.bitmap.textColor = "#f4f4f4";
    this.bitmap.drawText(f.text, 0, 0, w, h, "center");
    this.anchor.x = 0.5;
    this.anchor.y = 1;
    this.opacity = 0;
    this.update();
  };
  Sprite_RsFloat.prototype.update = function() {
    Sprite.prototype.update.call(this);
    const f = this._f;
    let bx, by;
    if (f.screen) { bx = f.x; by = f.y; }
    else {
      const ch = charOf(f.ref);
      if (!ch) { this.visible = false; return; }
      bx = ch.screenX(); by = ch.screenY() - 54;
    }
    const k = f.t / f.life;
    // 被顶上去的那一段慢慢挪过去，不跳
    f.shown = (f.shown || 0) + ((f.lift || 0) - (f.shown || 0)) * 0.18;
    // 人在画面最上面（比如躺在靠墙的床上）：往上飘会出画面，改成从脚下往下排
    if (f.down == null) f.down = !f.screen && by < 150;
    this.x = Math.round(bx + f.dx + Math.sin(f.t / 28 + f.id) * 3);
    this.y = f.down ? Math.round(by + 100 + k * 30 + f.shown) : Math.round(by - k * (f.screen ? 24 : 30) - f.shown);
    const fadeIn = Math.min(1, f.t / 24), fadeOut = Math.min(1, (f.life - f.t) / 50);
    this.opacity = Math.round(255 * Math.max(0, Math.min(fadeIn, fadeOut)));
    const half = this.bitmap ? this.bitmap.width / 2 : 0;
    this.x = Math.max(half, Math.min(Graphics.width - half, this.x));
  };

  function FloatLayer() { this.initialize(...arguments); }
  FloatLayer.prototype = Object.create(Sprite.prototype);
  FloatLayer.prototype.constructor = FloatLayer;
  FloatLayer.prototype.initialize = function() { Sprite.prototype.initialize.call(this); this._map = new Map(); };
  FloatLayer.prototype.update = function() {
    const list = floats();
    const live = new Set(list.map(f => f.id));
    for (const [id, sp] of this._map) if (!live.has(id)) { this.removeChild(sp); if (sp.bitmap && sp.bitmap.destroy) sp.bitmap.destroy(); this._map.delete(id); }
    for (const f of list) if (!this._map.has(f.id)) { const sp = new Sprite_RsFloat(f); this._map.set(f.id, sp); this.addChild(sp); }
    Sprite.prototype.update.call(this);
  };

  // 字在人物和天气上面、图片（CG、立绘）下面；色调不染它
  const _createPictures = Spriteset_Base.prototype.createPictures;
  Spriteset_Base.prototype.createPictures = function() {
    if (this instanceof Spriteset_Map) { this._rsFloatLayer = new FloatLayer(); this.addChild(this._rsFloatLayer); }
    _createPictures.call(this);
  };
  const _mapUpdate = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _mapUpdate.call(this);
    const list = floats();
    if (!list.length) return;
    for (const f of list) f.t++;
    $gameTemp._rsFloats = list.filter(f => f.t < f.life);
  };
  // 换地图就清掉
  const _performTransfer = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function() {
    if (this.isTransferring() && $gameTemp) $gameTemp._rsFloats = [];
    _performTransfer.call(this);
  };

  // ---------- 动作 ----------
  function buildRoute(steps) {
    const list = [];
    const push = (code, parameters) => list.push({ code, indent: null, parameters: parameters || [] });
    for (const s of String(steps || "").split(/\\s+/).filter(Boolean)) {
      let m;
      if ((m = /^(上|下|左|右)(\\d{1,2})?$/.exec(s))) { for (let i = 0; i < (Number(m[2]) || 1); i++) push(CODES[m[1]]); }
      else if ((m = /^等(\\d+(?:\\.\\d+)?)秒?$/.exec(s))) push(15, [Math.max(1, Math.round(Number(m[1]) * 60))]);
      else if ((m = /^速度([1-6])$/.exec(s))) push(29, [Number(m[1])]);
      else if (s === "慢") push(29, [2]);
      else if (s === "快") push(29, [5]);
      else if (s === "跳") push(14, [0, 0]);
      else if (BALLOONS[s]) push(45, ["RpgStudioStage.balloon(this, " + BALLOONS[s] + ")"]);
      else if (CODES[s]) push(CODES[s]);
    }
    list.push({ code: 0, parameters: [] });
    return { list, repeat: false, skippable: true, wait: false };
  }
  window.RpgStudioStage = {
    balloon(ch, id) { if (MZ) $gameTemp.requestBalloon(ch, id); else ch.requestBalloon(id); },
  };
  function act(interp, who, steps, wait) {
    const ch = findCharacter(interp, who);
    if (!ch) return;
    $gameMap.refreshIfNeeded && $gameMap.refreshIfNeeded();
    ch.forceMoveRoute(buildRoute(steps));
    // 等他做完：MZ 认 _characterId（-1 = 主角，其他 = 事件编号），MV 认 _character；两个都设上
    if (wait) { interp._character = ch; interp._characterId = ch === $gamePlayer ? -1 : ch.eventId(); interp.setWaitMode("route"); }
  }

  // ---------- 插件指令 ----------
  const yes = v => v === true || v === "true";
  if (MZ) {
    PluginManager.registerCommand(NAME, "float", function(a) { addFloat(this, a.who, a.text); });
    PluginManager.registerCommand(NAME, "act", function(a) { act(this, a.who, a.steps, yes(a.wait)); });
  }
  // MV：插件指令是一行字「RpgStudio_Stage float {...}」
  const _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    if (command !== NAME) return _pluginCommand.call(this, command, args);
    let a = {};
    try { a = JSON.parse(args.slice(1).join(" ")); } catch (e) { }
    if (args[0] === "float") addFloat(this, a.who, a.text);
    else if (args[0] === "act") act(this, a.who, a.steps, yes(a.wait));
  };
})();
`;

// 这串指令里有没有用到演出插件
const isStageCmd = c => !!c && ((c.code === 357 && (c.parameters || [])[0] === PLUGIN) || (c.code === 356 && String((c.parameters || [])[0] || '').startsWith(PLUGIN + ' ')));
const usesStage = list => (list || []).some(isStageCmd);

// 装上 / 更新插件；返回做了什么（'' = 本来就装好了）
function ensure(root) {
  const js = path.join(root, 'js');
  const listFile = path.join(js, 'plugins.js');
  if (!fs.existsSync(listFile)) return '';
  let did = '';
  const file = path.join(js, 'plugins', PLUGIN + '.js');
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { }
  const src = pluginSource();
  if (old !== src) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, src, 'utf8');
    fs.renameSync(tmp, file);
    did = old ? 'updated' : 'installed';
  }
  const list = fs.readFileSync(listFile, 'utf8');
  if (!new RegExp('["\']name["\']\\s*:\\s*["\']' + PLUGIN + '["\']').test(list)) {
    // $plugins = [ ... ]; 在最后一项后面加上（插件列表是 JS，不是 JSON：只动结尾的那个「]」）
    const at = list.lastIndexOf(']');
    if (at < 0) return did;
    const before = list.slice(0, at).replace(/\s*$/, '');
    const entry = `{"name":"${PLUGIN}","status":true,"description":"rpgStudio 演出：头顶飘字、按名字让人物做动作","parameters":{}}`;
    const sep = /\[\s*$/.test(before) ? '\n' : ',\n';
    const next = before + sep + entry + '\n' + list.slice(at);
    const tmp = listFile + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, listFile);
    did = did || 'registered';
  }
  return did;
}

module.exports = { PLUGIN, VERSION, STEP_CODES, BALLOON_STEPS, validStep, isStageCmd, usesStage, ensure, pluginSource };
