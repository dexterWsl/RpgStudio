'use strict';
const { need, int } = require('../lib/util.js');
const World = require('../core/world-time.js');
const { questsOf } = require('../core/quests.js');
const { rulesOf } = require('../core/variable-rules.js');
const { ensureRuntimePlugin } = require('../core/runtime-plugin.js');

const scheduleMarker = /<RpgStudioSchedule:(\d+)>/g;
const parts = ({ start, end }) => start < end ? [[start, end]] : [[start, 1440], [0, end]];
const overlap = (a, b) => parts(a).some(([x, y]) => parts(b).some(([u, v]) => x < v && u < y));

module.exports = function (ctx) {
  const { project, opts } = ctx;
  const variables = () => project.rows('var').filter(r => r.name);
  const restricted = system => new Set([...questsOf(system).map(q => q.variable), ...Object.keys(rulesOf(system).passive).map(Number)]);
  return {
    get: {
      'world-time'(T, q) {
        const system = project.sys(), world = World.worldOf(system), actor = Number(q('actor')) || 0;
        const blocked = restricted(system);
        return { active: World.used(system), clock: world.clock, schedules: world.schedules[actor] || [],
          maps: project.mapList().filter(m => m.hasFile), variables: variables().filter(r => !blocked.has(r.id)), canWrite: !opts.readOnly };
      },
      'world-time/events'(T, q) {
        const id = int(q('map'), '地图编号不对'), map = project.map(id);
        need(map, '找不到这张地图');
        return { events: (map.events || []).filter(Boolean).map(e => ({ id: e.id, name: e.name, x: e.x, y: e.y })) };
      },
    },
    post: {
      'world-time/clock'(T, b) {
        const start = int(b.start, '开始时间不对'), secondsPerMinute = int(b.secondsPerMinute, '时间速度请填整数');
        need(start >= 0 && start < 1440 && secondsPerMinute >= 1 && secondsPerMinute <= 600, '开始时间要在 24 小时内，速度为每分钟 1～600 秒');
        const preview = World.worldOf(project.sys()).clock;
        const dayVariable = int(b.dayVariable ?? preview.dayVariable ?? 0), minuteVariable = int(b.minuteVariable ?? preview.minuteVariable ?? 0);
        const weekdayVariable = int(b.weekdayVariable ?? preview.weekdayVariable ?? 0);
        const weekOrigin = int(b.weekOrigin ?? preview.weekOrigin ?? 1, '星期起始不对');
        need(weekOrigin >= 1 && weekOrigin <= 7, '星期起始要在 1 到 7（1 是月曜日）');
        const ids = [dayVariable, minuteVariable, weekdayVariable].filter(Boolean);
        need(new Set(ids).size === ids.length, '天数、分钟和曜日请用不同的变量');
        T.store.edit(['System.json'], docs => {
          const system = docs['System.json'], world = World.worldOf(system), blocked = restricted(system);
          for (const id of ids) need(project.has('var', id) && !blocked.has(id), '请选择未用于任务或自动累计的有效变量');
          ensureRuntimePlugin(ctx, World);
          system[World.KEY] = { ...world, clock: { start, secondsPerMinute, dayVariable, minuteVariable, weekdayVariable, weekOrigin } };
        });
        return {};
      },
      'world-time/schedule'(T, b) {
        const actor = int(b.actor, '人物编号不对');
        need(project.has('actor', actor), '找不到这个人物');
        need(Array.isArray(b.rows) && b.rows.length <= 32, '每日可以设置最多 32 个时段');
        const rows = b.rows.map(row => {
          const start = int(row.start), end = int(row.end), map = int(row.map), event = int(row.event);
          need(start >= 0 && start < 1440 && end >= 0 && end <= 1440 && start !== end, '请选择有效的开始和结束时间');
          need(project.has('map', map) && event > 0, '请选择地图和事件');
          return { start, end, map, event };
        }).sort((a, b) => a.start - b.start);
        need(!rows.some((a, i) => rows.slice(i + 1).some(b => overlap(a, b))), '同一人物在同一时间只能有一个地点，请调整重叠的时段');
        const previous = World.worldOf(project.sys()).schedules[actor] || [];
        const mapIds = [...new Set([...previous, ...rows].map(row => row.map))].filter(id => project.has('map', id));
        T.store.edit(['System.json', ...mapIds.map(project.mapFile)], docs => {
          const system = docs['System.json'], world = World.worldOf(system), marker = World.scheduleTag(actor);
          const eventOf = row => docs[project.mapFile(row.map)]?.events?.[row.event];
          for (const row of rows) {
            const event = eventOf(row);
            need(event, '找不到选中的地图事件');
            const assigned = [...String(event.note || '').matchAll(scheduleMarker)].some(m => Number(m[1]) !== actor);
            const reserved = Object.entries(world.schedules).some(([id, slots]) => Number(id) !== actor && slots.some(slot => slot.map === row.map && slot.event === row.event));
            need(!assigned && !reserved, '「' + event.name + '」已关联到其他人物的日程');
            need(!event.pages?.some(page => page.trigger === 3 || page.trigger === 4), '请选择可互动的 NPC 事件，自动执行或并行事件不能作为日程地点');
          }
          if (rows.length) ensureRuntimePlugin(ctx, World);
          for (const row of previous) {
            const event = eventOf(row);
            if (event) event.note = String(event.note || '').replaceAll(marker, '').trimEnd();
          }
          for (const row of rows) {
            const event = eventOf(row);
            if (!String(event.note || '').includes(marker)) event.note = [event.note, marker].filter(Boolean).join('\n');
          }
          if (rows.length) world.schedules[actor] = rows;
          else delete world.schedules[actor];
          if (rows.length || World.used(system)) system[World.KEY] = world;
        });
        return {};
      },
    },
  };
};
