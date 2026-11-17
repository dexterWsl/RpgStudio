'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createStudio } = require('../handler.js');
const { blankData } = require('../core/blank.js');
const { blankPage, END } = require('../lib/util.js');
const Effects = require('../core/map-effects.js');
const { listZip } = require('../core/zip.js');

async function test() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-map-resize-'));
  const game = path.join(temp, 'working'), dir = path.join(game, 'data');
  const files = blankData({ title: '调整地图尺寸测试', fonts: {} });
  const map = files['Map001.json'], system = files['System.json'];
  const width = map.width, height = map.height;
  const command = (code, parameters) => ({ code, parameters, indent: 0 });
  const event = (name, x, y, list) => ({ id: 1, name, note: '', x, y, pages: [{ ...blankPage(), list: [...list, END()] }] });
  const cell = (w, h, z, x, y) => (z * h + y) * w + x;
  const terrain = new Array(width * height).fill(0);
  terrain[0] = Effects.cell(3, 0);
  terrain[4 * width + 4] = Effects.cell(2, 6);
  const weather = { type: 'snow', power: 4, frames: 60 };
  map.note = Effects.writeWeather(Effects.writeTerrain('地图备注', width, terrain), weather);
  map.data[0] = 6;
  for (const [z, value] of [[0, 9], [1, 11], [4, 3], [5, 42]]) map.data[cell(width, height, z, 4, 4)] = value;
  map.events[1] = event('保留的 NPC', 4, 4, [command(203, [0, 0, 5, 5, 0]), command(285, [1, 0, 0, 6, 6])]);
  files['MapInfos.json'][2] = { id: 2, name: '传送来源', order: 2, parentId: 0 };
  files['Map002.json'] = structuredClone(map);
  files['Map002.json'].events[1] = event('入口', 2, 2, [command(201, [0, 1, 7, 6, 2, 0]), command(201, [1, 1, 4, 5, 2, 0])]);
  files['CommonEvents.json'][1] = { id: 1, trigger: 0, name: '移动船', list: [command(202, [0, 0, 1, 7, 6]), END()] };
  files['Troops.json'][1] = { id: 1, name: '战斗后传送', members: [], pages: [{ conditions: {}, list: [command(201, [0, 1, 7, 6, 2, 0]), END()] }] };
  system.boat = { ...system.boat, startMapId: 1, startX: 3, startY: 4 };
  fs.mkdirSync(dir, { recursive: true });
  const oldFileTime = new Date(2000, 0, 1);
  for (const [name, doc] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(doc), 'utf8');
    fs.utimesSync(file, oldFileTime, oldFileTime);
  }

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
    const original = await api('maptiles?id=1');
    assert.equal(original.resizeLimit, 256);
    const payload = { map: 1, hash: original.hash, edges: { left: 2, right: 3, top: 1, bottom: 2 } };
    const expanded = await api('map/resize', payload);
    assert.deepEqual(expanded.start, { map: 1, x: system.startX + 2, y: system.startY + 1 });
    assert.equal(expanded.width, width + 5);
    assert.equal(expanded.height, height + 3);
    await api('map/resize', payload, 400);
    const larger = await api('maptiles?id=1');
    assert.equal(larger.data[cell(larger.width, larger.height, 0, 2, 1)], 6);
    const blocked = await api('map/resize', { map: 1, hash: larger.hash, edges: { left: 0, right: -14, top: 0, bottom: 0 } }, 400);
    assert.match(blocked.error, /游戏起点/);
    assert.match(blocked.error, /传送落点/);
    assert.equal((await api('maptiles?id=1')).hash, larger.hash);
    const cropped = await api('map/resize', { map: 1, hash: larger.hash, edges: { left: -3, right: -1, top: -2, bottom: -1 } });
    assert.deepEqual(cropped.start, { map: 1, x: system.startX - 1, y: system.startY - 1 });
    const final = await api('maptiles?id=1');
    assert.equal(final.width, width + 1);
    assert.equal(final.height, height);
    assert.equal(final.data[0], 0);
    for (const [z, value] of [[0, 9], [1, 11], [4, 3], [5, 42]]) assert.equal(final.data[cell(final.width, final.height, z, 3, 3)], value);
    assert.equal(final.terrain[3 * final.width + 3], Effects.cell(2, 6));
    const p = studio.project;
    assert.deepEqual([p.map(1).events[1].x, p.map(1).events[1].y], [3, 3]);
    assert.deepEqual(p.map(1).events[1].pages[0].list[0].parameters, [0, 0, 4, 4, 0]);
    assert.deepEqual(p.map(1).events[1].pages[0].list[1].parameters, [1, 0, 0, 5, 5]);
    assert.deepEqual(p.map(2).events[1].pages[0].list[0].parameters, [0, 1, 6, 5, 2, 0]);
    assert.deepEqual(p.map(2).events[1].pages[0].list[1].parameters, [1, 1, 4, 5, 2, 0]);
    assert.deepEqual(p.read('CommonEvents.json')[1].list[0].parameters, [0, 0, 1, 6, 5]);
    assert.deepEqual(p.read('Troops.json')[1].pages[0].list[0].parameters, [0, 1, 6, 5, 2, 0]);
    assert.deepEqual([p.sys().boat.startX, p.sys().boat.startY], [2, 3]);
    assert.deepEqual(Effects.readWeather(p.map(1).note), weather);
    assert.equal(Effects.mapNote(p.map(1).note), '地图备注');
    const response = await fetch(base + 'projects/export?id=' + project.id);
    assert.equal(response.status, 200);
    const zip = path.join(temp, 'export.zip');
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(listZip(zip).map(entry => entry.name).sort(), ['CommonEvents', 'Map001', 'Map002', 'System', 'Troops'].map(name => 'data/' + name + '.json'));
    console.log('四边扩展和裁剪、图层位置、事件与落点迁移、冲突阻止和导出均通过');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
