'use strict';
const path = require('node:path');
const { blankPage, END } = require('../lib/util.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');

const KEY = 'rpgStudioMapEnemies';
const PLUGIN = 'RpgStudio_MapEnemies';
const PLUGIN_FILE = `js/plugins/${PLUGIN}.js`;
const SOURCE = path.join(__dirname, '../web/map-enemies-runtime.js');
const ENTRY = { name: PLUGIN, status: true, description: 'rpgStudio 地图敌人与随机遇敌条件', parameters: {} };
const tag = /(?:\r?\n)?<RpgStudioEnemies:([^>]+)>/;
const enemyTag = /<RpgStudioMapEnemy:(\d+)>/;
const stripNote = note => String(note || '').replace(tag, '');
const carryConfig = (from, to) => stripNote(to) + (String(from || '').match(tag)?.[0] || '');
const troopOfEvent = event => Number(String(event?.note || '').match(enemyTag)?.[1] || 0);
const used = system => system?.[KEY] === true;
function activate(ctx, system) {
  ensureRuntimePlugin(ctx, { ENTRY, SOURCE });
  system[KEY] = true;
}

function readConfig(map) {
  const match = String(map.note || '').match(tag);
  let options = {};
  try { options = JSON.parse(match?.[1] || '{}') || {}; } catch { }
  const active = map.encounterList || [];
  return {
    random: active.length > 0,
    visible: options.visible === true,
    chase: options.chase === true,
    range: options.range || 5,
    step: map.encounterStep || 30,
    encounters: active.length ? active : (options.paused || []),
    minSteps: options.minSteps || 0,
    switchId: options.switchId || 0,
    switchOn: options.switchOn !== false,
  };
}

function writeConfig(map, { random, visible, chase, range, step, encounters, minSteps, switchId, switchOn }) {
  const settings = { visible, chase, range };
  if (!random && encounters.length) settings.paused = encounters;
  if (minSteps) settings.minSteps = minSteps;
  if (switchId) Object.assign(settings, { switchId, switchOn });
  map.encounterStep = step;
  map.encounterList = random ? encounters : [];
  map.note = [stripNote(map.note), `<RpgStudioEnemies:${JSON.stringify(settings)}>`].filter(Boolean).join('\n');
}

function makeEnemyEvent(id, x, y, troop, image, permanent) {
  const page = blankPage();
  page.image = image;
  page.moveType = 1;
  page.trigger = 2;
  page.list = [
    { code: 301, indent: 0, parameters: [0, troop.id, false, false] },
    { code: 601, indent: 0, parameters: [] },
    permanent ? { code: 123, indent: 1, parameters: ['A', 0] } : { code: 214, indent: 1, parameters: [] },
    { ...END(), indent: 1 },
    { code: 604, indent: 0, parameters: [] },
    END(),
  ];
  const pages = [page];
  if (permanent) {
    const defeated = blankPage();
    Object.assign(defeated.conditions, { selfSwitchValid: true, selfSwitchCh: 'A' });
    defeated.priorityType = 0;
    pages.push(defeated);
  }
  return { id, x, y, name: troop.name || '游荡敌人', note: `<RpgStudioMapEnemy:${troop.id}>`, pages };
}

module.exports = { PLUGIN_FILE, SOURCE, ENTRY, stripNote, carryConfig, troopOfEvent, used, activate, readConfig, writeConfig, makeEnemyEvent };
