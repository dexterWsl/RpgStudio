'use strict';
const path = require('node:path');
const { need } = require('../lib/util.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');

const ENTRY = { name: 'RpgStudio_Directions', status: true, description: 'rpgStudio 斜向站姿', parameters: {} };
const SOURCE = path.join(__dirname, '../web/directions-runtime.js');
const PLUGIN_FILE = `js/plugins/${ENTRY.name}.js`;
const KEY = 'rpgStudioDiagonalSheets';
const sheets = system => system?.[KEY] || {};
const used = system => Object.keys(sheets(system)).length > 0;
const isSingle = name => /^[!]*\$/.test(name);

function setSheet(ctx, system, name, other) {
  const project = ctx.project, base = project.imageSize('characters', name);
  need(base, '找不到原行走图');
  const current = { ...sheets(system) };
  if (other) {
    const size = project.imageSize('characters', other);
    need(name !== other && size && isSingle(name) === isSingle(other) && size.w === base.w && size.h === base.h, '斜向站姿图需与原行走图等宽等高、使用相同的单人或八人格式');
    ensureRuntimePlugin(ctx, { ENTRY, SOURCE });
    Object.defineProperty(current, name, { value: other, enumerable: true, configurable: true, writable: true });
  } else delete current[name];
  system[KEY] = current;
}

module.exports = { ENTRY, SOURCE, PLUGIN_FILE, used, sheets, setSheet };
