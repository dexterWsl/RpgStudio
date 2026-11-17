/*:
 * @target MZ
 * @plugindesc rpgStudio 地图高低差和进图天气（MV / MZ）
 * @help 请在 rpgStudio 的「高低差」和「天气」中编辑地图效果。
 */
'use strict';
(() => {
  const MAX_LEVEL = 8;
  const DIRECTIONS = [0, 2, 4, 6, 8]; // 台阶箭头从低处指向高处
  const CODES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
  const WEATHER_TYPES = ['inherit', 'none', 'rain', 'storm', 'snow'];
  const terrainTag = () => /(?:\r?\n)?<RpgStudioTerrain:(\d+):([0-9A-Za-i]+)>/g;
  const weatherTag = () => /(?:\r?\n)?<RpgStudioWeather:(none|rain|storm|snow),(\d+),(\d+)>/g;
  const level = v => Math.floor(v / DIRECTIONS.length);
  const direction = v => DIRECTIONS[v % DIRECTIONS.length];
  const cell = (height, stair) => height * DIRECTIONS.length + DIRECTIONS.indexOf(stair);
  const validCell = v => Number.isInteger(v) && v >= 0 && v < CODES.length;
  const edgePassable = (from, to, d) => {
    const rise = level(to) - level(from);
    return rise === 0 || (rise === 1 && direction(from) === d) || (rise === -1 && direction(to) === 10 - d);
  };

  function readTerrain(note, width, height, targetWidth = width, targetHeight = height) {
    const tag = terrainTag().exec(note || '');
    if (!tag) return [];
    const sourceWidth = Number(tag[1]);
    if (!Number.isInteger(sourceWidth) || sourceWidth < 1 || sourceWidth > 256) return [];
    const data = new Array(targetWidth * targetHeight).fill(0);
    for (let i = 0; i < tag[2].length; i++) {
      const x = i % sourceWidth, y = Math.floor(i / sourceWidth);
      if (y >= Math.min(height, targetHeight)) break;
      if (x < Math.min(width, targetWidth)) data[y * targetWidth + x] = CODES.indexOf(tag[2][i]);
    }
    return data;
  }
  function readWeather(note) {
    const tag = weatherTag().exec(note || '');
    return tag ? { type: tag[1], power: Math.max(1, Math.min(Number(tag[2]), 9)), frames: Math.min(Number(tag[3]), 600) }
      : { type: 'inherit', power: 5, frames: 60 };
  }
  function withTag(note, pattern, tag) {
    const plain = (note || '').replace(pattern, '');
    return tag ? plain + (plain ? '\n' : '') + tag : plain;
  }
  function writeTerrain(note, width, data) {
    const codes = data.map(v => CODES[v]).join('').replace(/0+$/, '');
    return withTag(note, terrainTag(), codes ? `<RpgStudioTerrain:${width}:${codes}>` : '');
  }
  function writeWeather(note, { type, power, frames }) {
    return withTag(note, weatherTag(), type === 'inherit' ? '' : `<RpgStudioWeather:${type},${power},${frames}>`);
  }
  const mapNote = note => (note || '').replace(terrainTag(), '').replace(weatherTag(), '');
  function writeMapNote(note, text) {
    const tags = [...(note || '').matchAll(terrainTag()), ...(note || '').matchAll(weatherTag())];
    tags.sort((a, b) => a.index - b.index);
    return [mapNote(text), ...tags.map(m => m[0].trimStart())].filter(Boolean).join('\n');
  }

  // 游戏运行时按当前地图数据查询，避免把高低层复制进存档。
  function install() {
    const terrainByMap = new WeakMap();
    function mapEdgePassable(x, y, d) {
      if (!$dataMap) return true;
      if (!terrainByMap.has($dataMap)) terrainByMap.set($dataMap, readTerrain($dataMap.note, $dataMap.width, $dataMap.height));
      const data = terrainByMap.get($dataMap);
      if (!data.length) return true;
      const x2 = $gameMap.roundXWithDirection(x, d), y2 = $gameMap.roundYWithDirection(y, d);
      return edgePassable(data[y * $dataMap.width + x] || 0, data[y2 * $dataMap.width + x2] || 0, d);
    }
    const isMapPassable = Game_CharacterBase.prototype.isMapPassable;
    Game_CharacterBase.prototype.isMapPassable = function(x, y, d) {
      return isMapPassable.call(this, x, y, d) && mapEdgePassable(x, y, d);
    };

    // 引擎会在撞到事件时尝试触发它，隔着断崖时也要检查高度。
    function touchesAcrossCliff(actor, x, y) {
      if (actor.pos(x, y)) return false;
      for (const d of [actor.direction(), 2, 4, 6, 8]) {
        if (x === $gameMap.roundXWithDirection(actor.x, d) && y === $gameMap.roundYWithDirection(actor.y, d)) {
          return !mapEdgePassable(actor.x, actor.y, d);
        }
      }
      return false;
    }
    const startMapEvent = Game_Player.prototype.startMapEvent;
    Game_Player.prototype.startMapEvent = function(x, y, triggers, normal) {
      if (normal && !this.isInVehicle() && !this.isThrough() && !this.isDebugThrough()) {
        if (touchesAcrossCliff(this, x, y)) return;
        const d = this.direction();
        const x1 = $gameMap.roundXWithDirection(this.x, d), y1 = $gameMap.roundYWithDirection(this.y, d);
        if ($gameMap.isCounter(x1, y1) && x === $gameMap.roundXWithDirection(x1, d) && y === $gameMap.roundYWithDirection(y1, d) &&
            (!mapEdgePassable(this.x, this.y, d) || !mapEdgePassable(x1, y1, d))) return;
      }
      startMapEvent.call(this, x, y, triggers, normal);
    };
    const checkEventTriggerTouch = Game_Event.prototype.checkEventTriggerTouch;
    Game_Event.prototype.checkEventTriggerTouch = function(x, y) {
      if (this.isThrough() || !touchesAcrossCliff(this, x, y)) checkEventTriggerTouch.call(this, x, y);
    };

    const performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
      const mapId = $gameMap.mapId();
      performTransfer.call(this);
      // 同图传送、读档重载、从菜单返回时，保持剧情刚设定的天气。
      if ($gameMap.mapId() === mapId) return;
      const weather = readWeather($dataMap.note);
      if (weather.type !== 'inherit') $gameScreen.changeWeather(weather.type, weather.power, weather.frames);
    };
  }

  const api = { MAX_LEVEL, WEATHER_TYPES, level, direction, cell, validCell, edgePassable, readTerrain, writeTerrain, readWeather, writeWeather, mapNote, writeMapNote };
  if (typeof Game_Map === 'function') install();
  else if (typeof module === 'object' && module.exports) module.exports = api;
  else window.RpgStudioMapEffects = api;
})();
