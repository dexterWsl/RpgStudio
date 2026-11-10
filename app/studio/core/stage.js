'use strict';
// 演出插件 RpgStudio_Stage：编辑器自动装进游戏的那个插件（js/plugins/RpgStudio_Stage.js）
//
//   插件指令（编辑框里的写法 → 插件指令，见 core/script.js）
//     #飘字 [谁：]文字            float     字从人物头上（或画面中间）飘起来再淡掉，不挡剧情
//     #动作 谁 步骤…              act       按名字找到人，走几步、转身、跳、冒气泡
//     #扮演 谁 [行走图 编号]       as        场景里：主角的小人换成这个人（场景播完自动换回）
//     #传送 [谁] 地图 x y …        transfer  带「谁」或「到了以后的步骤」的传送（不带的还是普通的「场所移动」）
//   不用写指令、装上就生效的
//     场景独立：场景（公共事件第一条是注释 <RpgStudioScene>）里传送过、扮演过别人，
//               场景播完主角回到进场景前的地方、换回原来的样子（跟着的队友、透明、速度也恢复）
//     选项条件：选项文字里的 <<[条件]>> / (([条件]))（WD_ConditionalChoice 的写法，见 core/choicecond.js）；
//               游戏里装了 WD_ConditionalChoice 就交给它，没装由这个插件来演
//
//   ensure(root)：游戏里没有这个插件就装上（写文件、在 js/plugins.js 里登记）；版本旧了就换新的
//   wants(list)：这一串指令要不要这个插件（用了它的插件指令，或者选项里有条件）
const fs = require('fs');
const path = require('path');
const { MARK } = require('./scenes.js');

const PLUGIN = 'RpgStudio_Stage';
const VERSION = 8;
const DESCRIPTION = 'rpgStudio 演出：飘字、按名字动、场景里换人演、选项条件';

// 插件指令和参数（MZ 的插件指令每个参数一行续行「谁 = 林屿」，跟 RPG Maker MZ 编辑器写出来的一样）
const COMMANDS = {
  float: { text: '飘字', args: [['who', '谁'], ['text', '文字']] },
  act: { text: '动作', args: [['who', '谁'], ['steps', '步骤'], ['wait', '等做完']] },
  as: { text: '扮演', args: [['who', '谁'], ['sheet', '行走图'], ['index', '编号']] },
  transfer: { text: '传送', args: [['who', '谁'], ['map', '地图'], ['x', 'X'], ['y', 'Y'], ['dir', '朝向'], ['steps', '到了以后']] },
};

// 步骤（#动作 后面的那些词）→ 移动路线指令编号（Game_Character.ROUTE_*）
//   上下左右可以带步数（上3）；等可以带秒（等0.5）；速度 1~6；前进 / 后退也可以带步数（前进3）
const STEP_CODES = {
  上: 4, 下: 1, 左: 2, 右: 3, 前进: 12, 后退: 13, 靠近主角: 10, 远离主角: 11, 乱走: 9,
  转上: 19, 转下: 16, 转左: 17, 转右: 18, 转身: 22, 面向主角: 25, 背对主角: 26,
  跳: 14, 慢: 29, 快: 29, 隐身: 39, 现身: 40, 穿透: 37, 不穿透: 38, 踏步: 33, 停步: 34,
};
const BALLOON_STEPS = { '！': 1, '!': 1, '？': 2, '?': 2, '♪': 3, '♥': 4, '怒': 5, '汗': 6, '乱': 7, '…': 8, '……': 8, '灯': 9, 'Zzz': 10, 'zzz': 10 };
const STEP_RE = /^(?:(上|下|左|右|前进|后退)(\d{1,2})?|等(\d+(?:\.\d+)?)秒?|速度([1-6]))$/;
const validStep = s => STEP_RE.test(s) || s in STEP_CODES || s in BALLOON_STEPS;
// 朝向：0 = 不变（RPG Maker 的「场所移动」也是这几个数）
const DIRS = { 下: 2, 左: 4, 右: 6, 上: 8 };
const DIR_TEXT = { 2: '下', 4: '左', 6: '右', 8: '上' };

const pluginSource = () => `//=============================================================================
// ${PLUGIN}.js  v${VERSION}
// rpgStudio 演出插件（编辑器自动装上的；#飘字 #动作 #扮演 #传送、场景独立、选项条件都靠它，别删）
//=============================================================================
/*:
 * @target MZ
 * @plugindesc ${DESCRIPTION}
 * @author rpgStudio
 * @url https://github.com/dexterWsl/rpgstudio
 *
 * @help
 * rpgStudio 编辑框里的这几种写法会变成这个插件的插件指令：
 *
 *   #飘字 林屿：真的是我的问题吗      字从林屿头上飘起来再淡掉（不挡剧情）
 *   #飘字 画面：……                 在画面中间随便一处飘
 *   #动作 赵磊 转身 ！ 下2 等0.5 转上
 *   #动作 王浩 跳 不等               不等 = 不等他做完，接着往下（两个人一起动）
 *
 * 场景（公共事件第一条是注释 <RpgStudioScene>）里：
 *   #扮演 圣佳                       主角的小人换成圣佳（数据库里叫这个名字的角色的行走图）
 *   #扮演 路人 People1 3             没有角色的人：写行走图和编号
 *   #传送 圣佳 学校 10 5 前进3        换成圣佳、传送过去、到了往前走 3 格
 *   场景里传送过、扮演过别人：场景播完主角自动回到进场景前的地方，换回原来的样子。
 *   场景外的传送就是主角传送，不受影响。
 *
 * 选项条件（游戏里没装 WD_ConditionalChoice 时由这个插件来演，写法一样）：
 *   <<[s[3]]>>选项文字       开关 3 开着的时候这个选项是灰的、选不了
 *   (([!v[5]>=2]))选项文字   变量 5 不到 2 的时候不显示这个选项
 *
 * 「谁」：主角 / 本事件 / 带队角色的名字（= 主角）/ 正在扮演的人 / 这张地图上事件的名字
 *       （事件名「赵磊·吃饭/赵磊」「赵磊·走」这种也认得出是赵磊；有好几个时先找看得见的）。
 * 步骤：上 下 左 右 前进 后退（可带步数：上3、前进3）、靠近主角、远离主角、乱走、
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
 *
 * @command as
 * @text 扮演
 * @desc 场景里：主角的小人换成这个人，场景播完自动换回
 * @arg who
 * @text 谁
 * @desc 角色名（用数据库里这个角色的行走图）；主角 = 换回主角
 * @default
 * @arg sheet
 * @text 行走图
 * @desc 不是角色的人才要写（img/characters 里的图名）
 * @default
 * @arg index
 * @text 编号
 * @desc 行走图里的第几个（0~7）
 * @default 0
 *
 * @command transfer
 * @text 传送
 * @desc 在场景里：传送完、场景播完自动回到原来的地方
 * @arg who
 * @text 谁
 * @desc 场景里换成谁来演（角色名）；空 = 不换人
 * @default
 * @arg map
 * @text 地图
 * @type number
 * @default 1
 * @arg x
 * @text X
 * @type number
 * @default 0
 * @arg y
 * @text Y
 * @type number
 * @default 0
 * @arg dir
 * @text 朝向
 * @desc 0 = 不变，2 下 4 左 6 右 8 上
 * @default 0
 * @arg steps
 * @text 到了以后
 * @desc 到了以后做的动作（跟「动作」的步骤一样）
 * @default
 */
(() => {
  const NAME = "${PLUGIN}";
  const MZ = typeof PluginManager.registerCommand === "function";
  const CODES = ${JSON.stringify(STEP_CODES)};
  const BALLOONS = ${JSON.stringify(BALLOON_STEPS)};
  const SCENE_MARK = ${JSON.stringify(MARK)};
  const hasPlugin = n => typeof $plugins !== "undefined" && $plugins.some(p => p && p.status && p.name === n);

  // ---------- 找人 ----------
  function findCharacter(interp, who) {
    who = String(who || "").trim();
    const player = $gamePlayer;
    if (!who || who === "主角" || who === "玩家") return player;
    if (who === "本事件" || who === "这个人") return interp.character(0);
    if (player._rsAs && player._rsAs.name === who) return player;
    const leader = $gameParty.leader();
    if (!player._rsAs && leader && leader.name() === who) return player;
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

  // ---------- 动作 ----------
  function buildRoute(steps) {
    const list = [];
    const push = (code, parameters) => list.push({ code, indent: null, parameters: parameters || [] });
    for (const s of String(steps || "").split(/\\s+/).filter(Boolean)) {
      let m;
      if ((m = /^(上|下|左|右|前进|后退)(\\d{1,2})?$/.exec(s))) { for (let i = 0; i < (Number(m[2]) || 1); i++) push(CODES[m[1]]); }
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

  // ---------- 场景独立：场景里传送过、扮演过别人，播完回到进场景前的样子 ----------
  //   进场景时记下主角在哪、什么样子（_rsSnap）；场景里传送 / 扮演就记一笔（_rsDirty）；
  //   场景结束（解释器 terminate）时有记过的就恢复。存在解释器上，存档读档也跟着走。
  const isSceneList = list => !!list && list.slice(0, 3).some(c => c && c.code === 108 && String(c.parameters[0] || "").startsWith(SCENE_MARK));
  function snapshot() {
    const p = $gamePlayer;
    return { map: $gameMap.mapId(), x: p.x, y: p.y, d: p.direction(), as: p._rsAs || null, followers: p.followers().isVisible(),
      transparent: p.isTransparent(), speed: p.moveSpeed(), through: !!p._through };
  }
  const _setup = Game_Interpreter.prototype.setup;
  Game_Interpreter.prototype.setup = function(list, eventId) {
    _setup.call(this, list, eventId);
    this._rsScene = isSceneList(list);
    this._rsSnap = this._rsScene && $gamePlayer ? snapshot() : null;
    this._rsDirty = false;
    this._rsThen = "";
  };
  const touch = interp => { if (interp._rsScene) interp._rsDirty = true; };
  // 样子：{ as: { name, sheet, index } 或 null（= 主角自己），followers: 队友跟不跟着 }
  function lookOf(interp, a) {
    const who = String(a.who || "").trim();
    const leader = $gameParty.leader();
    if (!who || who === "主角" || who === "玩家" || (leader && leader.name() === who)) return { as: null, followers: interp._rsSnap ? interp._rsSnap.followers : true };
    let sheet = String(a.sheet || ""), index = Number(a.index) || 0;
    if (!sheet) {
      const d = $dataActors.find(x => x && x.name === who);
      const actor = d && $gameActors.actor(d.id);
      if (actor) { sheet = actor.characterName(); index = actor.characterIndex(); }
    }
    if (!sheet) { console.warn(NAME + "：不知道「" + who + "」用哪张行走图（数据库里没有叫这个名字的角色）"); return null; }
    return { as: { name: who, sheet, index }, followers: false };
  }
  function setLook(L) {
    const p = $gamePlayer;
    p._rsAs = L.as;
    if (L.followers) p.showFollowers(); else p.hideFollowers();
    p.refresh();
  }
  // 后面紧跟着传送：等传送过去再换样子（不然换装会在原地图上闪一下）
  function nextIsTransfer(interp) {
    const list = interp._list || [];
    let k = interp._index + 1;
    while (list[k] && list[k].code === 657) k++;
    const c = list[k];
    if (!c) return false;
    if (c.code === 201) return true;
    if (c.code === 357) return c.parameters[0] === NAME && c.parameters[1] === "transfer";
    if (c.code === 356) return String(c.parameters[0] || "").startsWith(NAME + " transfer");
    return false;
  }
  function actAs(interp, a) {
    touch(interp);
    const L = lookOf(interp, a);
    if (!L) return;
    if (nextIsTransfer(interp)) $gamePlayer._rsAsNext = L; else setLook(L);
  }
  function sceneTransfer(interp, a) {
    if ($gameParty.inBattle()) return;
    touch(interp);
    if (String(a.who || "").trim()) { const L = lookOf(interp, a); if (L) $gamePlayer._rsAsNext = L; }
    $gamePlayer.reserveTransfer(Number(a.map) || $gameMap.mapId(), Number(a.x) || 0, Number(a.y) || 0, Number(a.dir) || 0, 0);
    interp.setWaitMode("transfer");
    interp._rsThen = String(a.steps || "").trim();
  }
  function restore(s) {
    const p = $gamePlayer;
    const L = { as: s.as, followers: s.followers };
    p.setTransparent(s.transparent); p.setMoveSpeed(s.speed); p.setThrough(s.through);
    if ($gameMap.mapId() !== s.map || p.x !== s.x || p.y !== s.y) { p._rsAsNext = L; p.reserveTransfer(s.map, s.x, s.y, s.d, 0); }
    else { setLook(L); p.setDirection(s.d); p.center(p.x, p.y); }
  }
  // 场景里的「场所移动」也算场景里的事
  const _command201 = Game_Interpreter.prototype.command201;
  Game_Interpreter.prototype.command201 = function() {
    if (!$gameParty.inBattle()) touch(this);
    return _command201.apply(this, arguments);
  };
  const _terminate = Game_Interpreter.prototype.terminate;
  Game_Interpreter.prototype.terminate = function() {
    const s = this._rsDirty && this._rsSnap;
    this._rsDirty = false;
    _terminate.call(this);
    if (s) restore(s);
  };
  // 场景播完要传送回去：调用它的那一层等传送完再往下走
  const _updateChild = Game_Interpreter.prototype.updateChild;
  Game_Interpreter.prototype.updateChild = function() {
    const had = !!this._childInterpreter;
    const r = _updateChild.call(this);
    if (had && !this._childInterpreter && $gamePlayer.isTransferring()) { this.setWaitMode("transfer"); return true; }
    return r;
  };
  // 传送带的「到了以后」：传送完再动
  const _updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
  Game_Interpreter.prototype.updateWaitMode = function() {
    if (_updateWaitMode.call(this)) return true;
    if (this._rsThen) { const steps = this._rsThen; this._rsThen = ""; act(this, "主角", steps, true); return this._waitMode === "route"; }
    return false;
  };
  // 扮演：主角的行走图换成那个人的（refresh 会按带队角色重设，所以在它后面再套一次）
  const _playerRefresh = Game_Player.prototype.refresh;
  Game_Player.prototype.refresh = function() {
    _playerRefresh.call(this);
    if (this._rsAs) this.setImage(this._rsAs.sheet, this._rsAs.index);
  };
  // 换地图：清掉飘字；要等传送过去才换的样子在这时候换上（performTransfer 里会 refresh）
  const _performTransfer = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function() {
    if (this.isTransferring()) {
      if ($gameTemp) $gameTemp._rsFloats = [];
      const L = this._rsAsNext;
      if (L) { this._rsAsNext = null; this._rsAs = L.as; if (L.followers) this.showFollowers(); else this.hideFollowers(); }
    }
    _performTransfer.call(this);
  };

  // ---------- 选项条件（没装 WD_ConditionalChoice 时）----------
  //   <<[条件]>> 条件成立时锁住（灰的、选不了）；(([条件])) 条件成立时不显示
  if (!hasPlugin("WD_ConditionalChoice")) {
    const DIS = /<<\\[(.*?)\\]>>/, HID = /\\(\\(\\[(.*?)\\]\\)\\)/, ANY = /<<\\[(.*?)\\]>>|\\(\\(\\[(.*?)\\]\\)\\)/g, HAS = /<<\\[.*?\\]>>|\\(\\(\\[.*?\\]\\)\\)/;
    const TOK = /[sviwap]\\[\\d+\\]|g|===|==|<=|>=|!==|!=|=|<|>|[-+]?\\d+/g;
    const OPS = ["===", "==", "=", "!==", "!=", "<=", ">=", "<", ">"];
    const count = (k, id) => {
      const item = (k === "i" ? $dataItems : k === "w" ? $dataWeapons : $dataArmors)[id];
      if (!item) return 0;
      let n = $gameParty.numItems(item);
      if (k !== "i") for (const actor of $gameParty.members()) for (const e of actor.equips()) if (e === item) n++;
      return n;
    };
    const value = v => {
      let m;
      if (v === "g") return $gameParty.gold();
      if ((m = /^([sviwap])\\[(\\d+)\\]$/.exec(v))) {
        const k = m[1], id = Number(m[2]);
        if (k === "s") return $gameSwitches.value(id) ? 1 : 0;
        if (k === "v") return Number($gameVariables.value(id)) || 0;
        if (k === "p") return $gameParty._actors.includes(id) ? 1 : 0;
        return count(k, id);
      }
      return Number(v) || 0;
    };
    const term = t => {
      const s = String(t).replace(/\\s+/g, "");
      const toks = s.match(TOK) || [];
      let rest = s;
      for (const k of toks) rest = rest.replace(k, "");
      if (rest !== "" && rest !== "!") return null;
      let r;
      if (toks.length === 1 && !OPS.includes(toks[0])) r = value(toks[0]) > 0;
      else if (toks.length === 3 && OPS.includes(toks[1]) && !OPS.includes(toks[0]) && !OPS.includes(toks[2])) {
        const a = value(toks[0]), b = value(toks[2]), op = toks[1];
        r = op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : op === ">=" ? a >= b : op[0] === "!" ? a !== b : a === b;
      } else return null;
      return rest === "!" ? !r : r;
    };
    const test = cond => {
      const s = String(cond || "").replace(/\\s+/g, "");
      const or = s.includes(";") && !s.includes(",");
      const rs = s.split(/[;,]/).filter(Boolean).map(term).filter(r => r !== null);   // 看不懂的跳过
      if (!rs.length) return false;
      return or ? rs.some(Boolean) : rs.every(Boolean);
    };
    window.RpgStudioStage.choiceTest = test;
    const _setupChoices = Game_Interpreter.prototype.setupChoices;
    Game_Interpreter.prototype.setupChoices = function(params) {
      const all = params[0] || [];
      if (!all.some(t => HAS.test(String(t)))) return _setupChoices.call(this, params);
      const map = [], texts = [], locked = [];
      all.forEach((t, i) => {
        t = String(t);
        const h = HID.exec(t), d = DIS.exec(t);
        if (h && test(h[1])) return;
        map.push(i); texts.push(t.replace(ANY, "")); locked.push(!!(d && test(d[1])));
      });
      const indent = this._indent;
      if (!texts.length) { this._branch[indent] = -1; return; }   // 全都不显示：当成什么都没选
      let cancel = params[1] >= all.length ? -2 : params[1];
      if (cancel >= 0) { const k = map.indexOf(cancel); cancel = k >= 0 && !locked[k] ? k : -1; }
      const def = params.length > 2 ? params[2] : 0;
      $gameMessage.setChoices(texts, def >= 0 ? map.indexOf(def) : -1, cancel);
      $gameMessage.setChoiceBackground(params.length > 4 ? params[4] : 0);
      $gameMessage.setChoicePositionType(params.length > 3 ? params[3] : 2);
      $gameMessage._rsLocked = locked;
      $gameMessage.setChoiceCallback(n => { this._branch[indent] = n >= 0 ? map[n] : n; });
    };
    const _clear = Game_Message.prototype.clear;
    Game_Message.prototype.clear = function() { _clear.call(this); this._rsLocked = null; };
    const _makeCommandList = Window_ChoiceList.prototype.makeCommandList;
    Window_ChoiceList.prototype.makeCommandList = function() {
      _makeCommandList.call(this);
      const lk = $gameMessage._rsLocked;
      if (lk) this._list.forEach((c, i) => { if (lk[typeof c.ext === "number" ? c.ext : i]) c.enabled = false; });
    };
    const _drawItem = Window_ChoiceList.prototype.drawItem;
    Window_ChoiceList.prototype.drawItem = function(index) {
      const off = !this.isCommandEnabled(index);
      if (off) this.changePaintOpacity(false);
      _drawItem.call(this, index);
      if (off) this.changePaintOpacity(true);
    };
  }

  // ---------- 插件指令 ----------
  const yes = v => v === true || v === "true";
  const run = (interp, cmd, a) => {
    if (cmd === "float") addFloat(interp, a.who, a.text);
    else if (cmd === "act") act(interp, a.who, a.steps, yes(a.wait));
    else if (cmd === "as") actAs(interp, a);
    else if (cmd === "transfer") sceneTransfer(interp, a);
  };
  if (MZ) for (const cmd of ["float", "act", "as", "transfer"]) PluginManager.registerCommand(NAME, cmd, function(a) { run(this, cmd, a); });
  // MV：插件指令是一行字「RpgStudio_Stage float {...}」
  const _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    if (command !== NAME) return _pluginCommand.call(this, command, args);
    let a = {};
    try { a = JSON.parse(args.slice(1).join(" ")); } catch (e) { }
    run(this, args[0], a);
  };
})();
`;

// ---------- 编辑器这边用的 ----------
const isStageCmd = c => !!c && ((c.code === 357 && (c.parameters || [])[0] === PLUGIN) || (c.code === 356 && String((c.parameters || [])[0] || '').startsWith(PLUGIN + ' ')));
// 插件指令 → { cmd, args }（MZ 357 / MV 356 两种都认）；不是就 null
function parseCmd(c) {
  if (!isStageCmd(c)) return null;
  if (c.code === 357) return { cmd: String(c.parameters[1] || ''), args: c.parameters[3] && typeof c.parameters[3] === 'object' ? c.parameters[3] : {} };
  const m = new RegExp('^' + PLUGIN + ' (\\w+) (\\{.*\\})$').exec(String(c.parameters[0] || ''));
  if (!m) return null;
  try { return { cmd: m[1], args: JSON.parse(m[2]) }; } catch { return null; }
}
// 生成插件指令：MZ 是「插件指令」+ 每个参数一行续行；MV 是一行字
function commands(cmd, args, mz) {
  const def = COMMANDS[cmd];
  if (!def) throw new Error('演出插件没有这个指令：' + cmd);
  const a = {};
  for (const [k] of def.args) a[k] = args[k] == null ? '' : String(args[k]);
  if (!mz) return [{ code: 356, indent: 0, parameters: [PLUGIN + ' ' + cmd + ' ' + JSON.stringify(a)] }];
  return [
    { code: 357, indent: 0, parameters: [PLUGIN, cmd, def.text, a] },
    ...def.args.map(([k, label]) => ({ code: 657, indent: 0, parameters: [label + ' = ' + a[k]] })),
  ];
}
const hasChoiceCond = list => (list || []).some(c => c && c.code === 102 && (c.parameters[0] || []).some(t => /<<\[.*?\]>>|\(\(\[.*?\]\)\)/.test(String(t))));
const usesStage = list => (list || []).some(isStageCmd);
const wants = list => usesStage(list) || hasChoiceCond(list);

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
    const entry = JSON.stringify({ name: PLUGIN, status: true, description: DESCRIPTION, parameters: {} });
    const sep = /\[\s*$/.test(before) ? '\n' : ',\n';
    const next = before + sep + entry + '\n' + list.slice(at);
    const tmp = listFile + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, listFile);
    did = did || 'registered';
  }
  return did;
}

module.exports = { PLUGIN, VERSION, COMMANDS, STEP_CODES, BALLOON_STEPS, DIRS, DIR_TEXT, validStep, isStageCmd, parseCmd, commands, usesStage, hasChoiceCond, wants, ensure, pluginSource };
