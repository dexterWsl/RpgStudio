'use strict';
const path = require('path');
const { installRuntimePlugin } = require('./runtime-plugin.js');

const PLUGIN = 'RpgStudio_MapEffects';
const PLUGIN_FILE = `js/plugins/${PLUGIN}.js`;
const SOURCE = path.join(__dirname, '../web/map-effects.js');
const ENTRY = { name: PLUGIN, status: true, description: 'rpgStudio 地图高低差和天气', parameters: {} };

function ensure(root, backupsDir) {
  installRuntimePlugin(root, backupsDir, { entry: ENTRY, source: SOURCE, backupPrefix: 'map-effects' });
}

module.exports = { ...require('../web/map-effects.js'), PLUGIN, PLUGIN_FILE, SOURCE, ensure };
