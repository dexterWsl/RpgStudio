'use strict';
const { need, int, UserError } = require('../lib/util.js');
const { templates, defaultModes, makeTemplate } = require('../core/map-templates.js');
const { freeEventId } = require('../core/maps.js');

module.exports = function ({ project, views, opts }) {
  return {
    get: {
      'map/templates'() {
        return { templates, defaultModes, canWrite: !opts.readOnly, items: project.rows('item').filter(row => row.name), maps: project.mapList().filter(map => map.hasFile) };
      },
    },
    post: {
      'map/template'(T, b) {
        const kind = String(b.kind || '');
        need(Object.hasOwn(templates, kind), '请选择交互模板');
        const map = int(b.map, '地图编号不对'), x = int(b.x, '坐标不对'), y = int(b.y, '坐标不对');
        need(project.has('map', map), '找不到这张地图');
        let event;
        try { event = makeTemplate(T, kind, { ...b, map, x, y }, project, views.checkImage); }
        catch (error) { throw new UserError(error.message); }
        const file = project.mapFile(map);
        const { result: id } = T.store.edit([file], docs => {
          const target = docs[file];
          need(x >= 0 && x < target.width && y >= 0 && y < target.height, '格子在地图外');
          need(!target.events.some(e => e && e.x === x && e.y === y), '这格已经有事件');
          const id = freeEventId(target);
          target.events[id] = { ...event, id, x, y };
          return id;
        });
        return { id };
      },
    },
  };
};
