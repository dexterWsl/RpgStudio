'use strict';
const { need, int } = require('../lib/util.js');
const { freeEventId } = require('../core/maps.js');
const { encounterSteps } = require('../core/encounter-commands.js');
const Enemies = require('../core/map-enemies.js');

module.exports = function (ctx) {
  const { project, opts, views } = ctx;
  function mapId(value) {
    const id = int(value, '地图编号不对');
    need(project.has('map', id), '找不到这张地图');
    return id;
  }
  function troopValid(troop) {
    return troop?.members?.some(member => !member.hidden && project.has('enemy', member.enemyId));
  }
  return {
    get: {
      'map/enemies'(T, q) {
        const map = project.map(mapId(q('map')));
        const events = (map.events || []).filter(event => Enemies.troopOfEvent(event)).map(({ id, x, y, name }) => ({ id, x, y, name }));
        const troops = (project.read('Troops.json') || []).filter(troopValid).map(({ id, name }) => ({ id, name }));
        return { ...Enemies.readConfig(map), events, troops, switches: project.rows('switch').filter(row => row.name), canWrite: !opts.readOnly };
      },
    },
    post: {
      'map/enemies/save'(T, b) {
        const file = project.mapFile(mapId(b.map));
        const { random, visible, chase } = b;
        need([random, visible, chase].every(value => typeof value === 'boolean'), '请选择三个开关的状态');
        const range = int(b.range, '追踪距离要填整数'), step = int(b.step, '平均遇敌步数要填整数');
        need(range >= 1 && range <= 15, '追踪距离需在 1～15 格内');
        need(step >= 1 && step <= 999, '平均遇敌步数需在 1～999 内');
        need(Array.isArray(b.encounters) && (!random || b.encounters.length), '开启随机遇敌需要配置至少一个敌群');
        T.store.edit([file, 'System.json'], docs => {
          const map = docs[file], previous = Enemies.readConfig(map);
          const minSteps = encounterSteps(b.minSteps ?? previous.minSteps);
          const switchId = int(b.switchId ?? previous.switchId, '请选择有效的条件开关');
          const switchOn = b.switchOn ?? previous.switchOn;
          need(switchId === 0 || project.has('switch', switchId) || switchId === previous.switchId, '找不到条件开关');
          need(typeof switchOn === 'boolean', '请选择开关状态');
          const encounters = b.encounters.map(row => {
            const troopId = int(row.troopId, '请选择敌群'), weight = int(row.weight, '权重要填整数');
            const troop = (project.read('Troops.json') || [])[troopId];
            need(troopValid(troop) || previous.encounters.some(entry => entry.troopId === troopId), '请选择可用的敌群');
            need(weight >= 1 && weight <= 9999, '权重需在 1～9999 内');
            need(Array.isArray(row.regionSet), '区域编号格式不对');
            const regionSet = [...new Set(row.regionSet.map(value => int(value, '区域编号要填整数')))];
            need(regionSet.every(region => region >= 0 && region <= 255), '区域编号需在 0～255 内');
            return { troopId, weight, regionSet };
          });
          if (minSteps || switchId) Enemies.activate(ctx, docs['System.json']);
          Enemies.writeConfig(map, { random, visible, chase, range, step, encounters, minSteps, switchId, switchOn });
        });
        return {};
      },
      'map/enemies/place'(T, b) {
        const file = project.mapFile(mapId(b.map)), x = int(b.x, '坐标不对'), y = int(b.y, '坐标不对');
        const troop = (project.read('Troops.json') || [])[int(b.troop, '请选择敌群')];
        need(troopValid(troop), '请选择可用的敌群');
        const image = views.checkImage(b.image || {});
        need(image.characterName, '请选择敌人的行走图');
        const { result: id } = T.store.edit([file, 'System.json'], docs => {
          const map = docs[file];
          need(x >= 0 && x < map.width && y >= 0 && y < map.height, '格子在地图外');
          need(!map.events.some(event => event && event.x === x && event.y === y), '这格已经有事件');
          const id = freeEventId(map);
          map.events[id] = Enemies.makeEnemyEvent(id, x, y, troop, image, b.permanent === true);
          const options = Enemies.readConfig(map);
          if (b.enableVisible === true && !options.visible) Enemies.writeConfig(map, { ...options, visible: true });
          Enemies.activate(ctx, docs['System.json']);
          return id;
        });
        return { id };
      },
    },
  };
};
