'use strict';
// node app/studio/test/map-effects.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createStudio } = require('../handler.js');
const { blankData } = require('../core/blank.js');
const { listZip } = require('../core/zip.js');
const Effects = require('../core/map-effects.js');

async function test() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-map-effects-'));
  const game = path.join(temp, 'game');
  const note = '给地图的备注\r\n<OtherPlugin:true>\n';
  const files = blankData({ title: '地图效果回归测试', fonts: {} });
  files['Map001.json'].note = note;
  files['Map001.json'].data[5 * 17 * 13] = 63;
  fs.mkdirSync(path.join(game, 'data'), { recursive: true });
  fs.mkdirSync(path.join(game, 'js'), { recursive: true });
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(game, 'data', name), JSON.stringify(data), 'utf8');
  const plugins = path.join(game, 'js/plugins.js');
  fs.writeFileSync(plugins, 'var $plugins = [\n];\n', 'utf8');
  const studio = createStudio({ projects: { dir: path.join(temp, 'projects') } });
  const project = studio.registry.add({ gameDir: game, mode: 'copy', addedAt: Date.now() - 1000 });
  const server = http.createServer((req, res) => studio.handle(req, res));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/studio/`;
    let key;
    async function api(route, body, status = 200) {
      const headers = key ? { 'x-studio-project': key } : {};
      const response = await fetch(base + route, body === undefined ? { headers } : {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, status, data.error);
      return data;
    }
    key = (await api('project')).projectKey;
    const old = await api('maptiles?id=1');
    assert.deepEqual(old.terrain, []);
    assert.equal((await api('map?id=1')).props.note, note);
    const terrain = new Array(old.width * old.height).fill(0);
    terrain[0] = Effects.cell(0, 6);
    terrain[1] = Effects.cell(1, 0);
    terrain[old.width + 1] = Effects.cell(2, 0);
    assert(Effects.edgePassable(terrain[0], terrain[1], 6));
    assert(Effects.edgePassable(terrain[1], terrain[0], 4));
    assert(!Effects.edgePassable(terrain[0], terrain[1], 2));
    assert(!Effects.edgePassable(terrain[1], terrain[old.width + 1], 2));
    const save = { map: 1, data: old.data, terrain, hash: old.hash };
    const { hash } = await api('map/tiles', save);
    await api('map/tiles', save, 400);
    await api('map/tiles', { ...save, hash, terrain: [0] }, 400);
    await api('map/tiles', { ...save, hash, terrain: [45, ...terrain.slice(1)] }, 400);
    assert.deepEqual((await api('maptiles?id=1')).data, old.data);

    const previous = Effects.readWeather(note), weather = { type: 'rain', power: 6, frames: 90 };
    await api('map/weather', { map: 1, previous, weather });
    await api('map/weather', { map: 1, previous, weather: { ...weather, type: 'snow' } }, 400);
    assert.equal((await api('maptiles?id=1')).hash, hash);
    assert.equal((await api('map?id=1')).props.note, note);
    assert.deepEqual((await api('map?id=1')).weather, weather);
    assert.equal(fs.readFileSync(plugins, 'utf8').split(Effects.PLUGIN).length, 2);
    assert(fs.existsSync(path.join(game, Effects.PLUGIN_FILE)));

    await api('map/update', { map: 1, width: 3, height: 2, note: '更新备注' });
    const resized = await api('maptiles?id=1');
    assert.deepEqual(resized.terrain, [terrain[0], terrain[1], 0, 0, terrain[old.width + 1], 0]);
    assert.equal(resized.data[5 * 3 * 2], 63);
    const copy = await api('map/create', { name: '地图副本', copyFrom: 1 });
    assert.deepEqual((await api('maptiles?id=' + copy.id)).terrain, resized.terrain);
    assert.deepEqual((await api('map?id=' + copy.id)).weather, weather);
    assert.equal((await api('map?id=' + copy.id)).props.note, '更新备注');

    await api('map/tiles', { map: 1, hash: resized.hash, data: resized.data, terrain: new Array(6).fill(0) });
    await api('map/weather', { map: 1, previous: weather, weather: Effects.readWeather('') });
    assert.equal(studio.project.map(1).note, '更新备注');

    const zip = await fetch(base + 'projects/export?id=' + project.id);
    assert.equal(zip.status, 200);
    const zipFile = path.join(temp, 'export.zip');
    fs.writeFileSync(zipFile, Buffer.from(await zip.arrayBuffer()));
    const exported = listZip(zipFile).map(file => file.name);
    for (const file of ['data/Map001.json', 'data/Map002.json', 'js/plugins.js', Effects.PLUGIN_FILE]) assert(exported.includes(file), file);
    console.log('地图高低差、天气、并发保存、地图缩放和复制、插件导出均通过');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
