'use strict';
const path = require('node:path');

const KEY = 'rpgStudioWorldTime';
const name = 'RpgStudio_WorldTime';
const ENTRY = { name, status: true, description: 'rpgStudio 世界时间与人物日程', parameters: {} };
const PLUGIN_FILE = 'js/plugins/' + name + '.js';
const SOURCE = path.join(__dirname, '../web/world-time-runtime.js');
const defaults = { start: 480, secondsPerMinute: 2, dayVariable: 0, minuteVariable: 0, weekdayVariable: 0, weekOrigin: 1 };
const worldOf = system => ({ clock: { ...defaults, ...system?.[KEY]?.clock }, schedules: system?.[KEY]?.schedules || {} });
const used = system => !!system?.[KEY];
const scheduleTag = id => `<RpgStudioSchedule:${id}>`;
function clockVariables(system) {
  const clock = worldOf(system).clock;
  return [clock.dayVariable, clock.minuteVariable, clock.weekdayVariable].filter(Boolean);
}

module.exports = { KEY, ENTRY, PLUGIN_FILE, SOURCE, used, worldOf, scheduleTag, clockVariables };
