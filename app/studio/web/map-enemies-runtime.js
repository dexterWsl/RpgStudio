/*:
 * @plugindesc rpgStudio 地图敌人与随机遇敌条件
 * @help 保留游戏的原生遇敌规则，增加地图的步数、开关条件和指定步数免遇敌。
 */
(function () {
  'use strict';
  var source, config;
  function settings() {
    var value = $dataMap && $dataMap.meta && $dataMap.meta.RpgStudioEnemies;
    if (!config || source !== value) {
      source = value;
      try { config = JSON.parse(value || '{}') || {}; } catch (_) { config = {}; }
    }
    return config;
  }

  function isEnemy(event) {
    var data = event.event();
    return data && data.meta && data.meta.RpgStudioMapEnemy;
  }

  Game_System.prototype.rpgStudioSetEncounterImmunity = function (steps) {
    this._rpgStudioEncounterUntilStep = steps > 0 ? $gameParty.steps() + steps : null;
  };

  var setupMap = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function (mapId) {
    setupMap.call(this, mapId);
    this._rpgStudioEncounterEntryStep = $gameParty.steps();
  };

  function encounterBlocked() {
    var until = $gameSystem._rpgStudioEncounterUntilStep, step = $gameParty.steps();
    if (until != null && step <= until) return true;
    var options = settings();
    if (options.switchId && $gameSwitches.value(options.switchId) !== (options.switchOn !== false)) return true;
    if (!options.minSteps) return false;
    // 旧存档第一次加载步数条件时，从载入后的当前脚步开始计算。
    if ($gameMap._rpgStudioEncounterEntryStep == null) $gameMap._rpgStudioEncounterEntryStep = step;
    return step - $gameMap._rpgStudioEncounterEntryStep < options.minSteps;
  }

  var canEncounter = Game_Player.prototype.canEncounter;
  Game_Player.prototype.canEncounter = function () {
    return !encounterBlocked() && canEncounter.call(this);
  };

  var executeEncounter = Game_Player.prototype.executeEncounter;
  Game_Player.prototype.executeEncounter = function () {
    return !encounterBlocked() && executeEncounter.call(this);
  };

  var meetsConditions = Game_Event.prototype.meetsConditions;
  Game_Event.prototype.meetsConditions = function (page) {
    if (isEnemy(this) && settings().visible !== true) return false;
    return meetsConditions.call(this, page);
  };

  var moveTypeRandom = Game_Event.prototype.moveTypeRandom;
  Game_Event.prototype.moveTypeRandom = function () {
    var options = isEnemy(this) && settings();
    if (options && options.chase === true && $gamePlayer &&
        $gameMap.distance(this.x, this.y, $gamePlayer.x, $gamePlayer.y) <= (options.range || 5)) {
      var direction = this.findDirectionTo($gamePlayer.x, $gamePlayer.y);
      if (direction) this.moveStraight(direction);
      return;
    }
    moveTypeRandom.call(this);
  };
})();
