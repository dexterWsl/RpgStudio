/*:
 * @target MZ
 * @plugindesc rpgStudio 世界时间与人物日程
 * @command 跳到
 * @text 跳到
 * @desc 把时钟拨到今天的某个时刻，或睡到次日 07:40
 * @arg time
 * @text 时刻
 * @desc 08:30 这种今天的时刻；次日 = 明天 07:40
 * @default 次日
 */
(() => {
  'use strict';
  const PERIODS = ['上课', '课余', '部活', '夜间', '深夜'];
  const WEEKDAYS = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'];
  const WAKE = 7 * 60 + 40;
  const config = () => $dataSystem.rpgStudioWorldTime;
  const clockState = clock => {
    if (!$gameSystem._rpgStudioClock) $gameSystem._rpgStudioClock = { minutes: clock.start, frames: 0 };
    return $gameSystem._rpgStudioClock;
  };
  const inSlot = (minute, start, end) => start < end ? minute >= start && minute < end : minute >= start || minute < end;
  const namedId = (list, name) => {
    if (!list) return 0;
    for (let i = 1; i < list.length; i++) if (list[i] === name) return i;
    return 0;
  };
  const weekdayOf = (day, origin) => {
    const o = origin >= 1 && origin <= 7 ? origin : 1;
    return ((day - 1 + o - 1) % 7) + 1;
  };
  // 07:40 前和 23:00 后是深夜；07:40–08:30、15:20–15:30 不打开时段开关
  const periodOf = minute => {
    if (minute >= 510 && minute < 730) return '上课';
    if (minute >= 730 && minute < 780) return '课余';
    if (minute >= 780 && minute < 920) return '上课';
    if (minute >= 930 && minute < 1080) return '部活';
    if (minute >= 1080 && minute < 1380) return '夜间';
    if (minute >= 1380 || minute < 460) return '深夜';
    return '';
  };
  const setVar = (id, value) => {
    if (!id || id >= ($dataSystem.variables || []).length) return;
    if ($gameVariables.value(id) !== value) $gameVariables.setValue(id, value);
  };
  const setSw = (id, on) => {
    if (!id || id >= ($dataSystem.switches || []).length) return;
    if (!!$gameSwitches.value(id) !== on) $gameSwitches.setValue(id, on);
  };
  const labelOf = (clock, state) => {
    const day = Math.floor(state.minutes / 1440) + 1, minute = state.minutes % 1440;
    const week = WEEKDAYS[weekdayOf(day, clock.weekOrigin) - 1];
    return week + ' ' + String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
  };

  function publish(clock, state) {
    const day = Math.floor(state.minutes / 1440) + 1, minute = state.minutes % 1440;
    setVar(clock.dayVariable, day);
    setVar(clock.minuteVariable, minute);
    setVar(clock.weekdayVariable || namedId($dataSystem.variables, '曜日'), weekdayOf(day, clock.weekOrigin));
    const period = periodOf(minute);
    for (const name of PERIODS) setSw(namedId($dataSystem.switches, name), name === period);
    const schoolDay = weekdayOf(day, clock.weekOrigin) <= 5;
    setSw(namedId($dataSystem.switches, '平日'), schoolDay);
    setSw(namedId($dataSystem.switches, '休日'), !schoolDay);
  }

  function jumpClock(spec) {
    const world = config();
    if (!world) return;
    const state = clockState(world.clock);
    const text = String(spec || '').trim();
    if (!text || text === '次日' || text === '明天') state.minutes = (Math.floor(state.minutes / 1440) + 1) * 1440 + WAKE;
    else {
      const m = /^(\d{1,2})[:：](\d{2})$/.exec(text);
      if (!m) return;
      const hour = Number(m[1]), minute = Number(m[2]);
      if (hour > 23 || minute > 59) return;
      state.minutes = Math.floor(state.minutes / 1440) * 1440 + hour * 60 + minute;
    }
    state.frames = 0;
    publish(world.clock, state);
    if ($gameMap) $gameMap.requestRefresh();
  }

  PluginManager.registerCommand('RpgStudio_WorldTime', '跳到', args => jumpClock(args.time));

  function Window_RpgStudioClock() {
    this.initialize(...arguments);
  }
  Window_RpgStudioClock.prototype = Object.create(Window_Base.prototype);
  Window_RpgStudioClock.prototype.constructor = Window_RpgStudioClock;
  Window_RpgStudioClock.prototype.initialize = function() {
    const width = 268;
    Window_Base.prototype.initialize.call(this, new Rectangle(Graphics.boxWidth - width - 52, 0, width, 76));
    this._label = '';
    this.opacity = 192;
  };
  Window_RpgStudioClock.prototype.refresh = function() {
    this.contents.clear();
    this.contents.fontSize = 22;
    this.drawText(this._label, 0, 0, this.contentsWidth(), 'center');
  };
  Window_RpgStudioClock.prototype.update = function() {
    Window_Base.prototype.update.call(this);
    const world = config();
    if (!world) { this.visible = false; return; }
    this.visible = true;
    const text = labelOf(world.clock, clockState(world.clock));
    if (text !== this._label) { this._label = text; this.refresh(); }
  };

  const eventConditions = Game_Event.prototype.meetsConditions;
  Game_Event.prototype.meetsConditions = function(page) {
    const world = config();
    const event = this.event();
    const marker = /<RpgStudioSchedule:(\d+)>/.exec(event.note || '');
    const schedule = marker && world && world.schedules && world.schedules[marker[1]];
    const slots = schedule && schedule.filter(slot => slot.map === this._mapId && slot.event === this.eventId());
    if (slots && slots.length) {
      const minute = clockState(world.clock).minutes % 1440;
      if (!slots.some(slot => inSlot(minute, slot.start, slot.end))) return false;
    }
    return eventConditions.apply(this, arguments);
  };

  const setupMap = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function(mapId) {
    const world = config();
    if (world) publish(world.clock, clockState(world.clock));
    setupMap.call(this, mapId);
  };

  const startMap = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function() {
    const world = config();
    if (world) publish(world.clock, clockState(world.clock));
    startMap.apply(this, arguments);
  };

  const createDisplay = Scene_Map.prototype.createDisplayObjects;
  Scene_Map.prototype.createDisplayObjects = function() {
    createDisplay.apply(this, arguments);
    this._rpgStudioClockWindow = new Window_RpgStudioClock();
    this.addWindow(this._rpgStudioClockWindow);
  };

  const updateMap = Game_Map.prototype.update;
  Game_Map.prototype.update = function(sceneActive) {
    const world = config();
    if (world && sceneActive && !$gameMessage.isBusy() && !this.isEventRunning() && !$gamePlayer.isTransferring()) {
      const state = clockState(world.clock);
      state.frames++;
      if (state.frames >= world.clock.secondsPerMinute * 60) {
        state.frames = 0;
        state.minutes++;
        publish(world.clock, state);
        this.requestRefresh();
      }
    }
    updateMap.apply(this, arguments);
  };
})();
