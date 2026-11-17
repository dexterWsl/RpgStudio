'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createStudio } = require('../handler.js');
const { blankData } = require('../core/blank.js');
const { ENTRY, PLUGIN_FILE, SOURCE, rulesOf } = require('../core/variable-rules.js');
const { listZip, extractEntry } = require('../core/zip.js');

function writeTestData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(blankData({ title: '变量测试', locale: 'zh_CN', versionId: 1 }))) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data), 'utf8');
  }
}

function runPlugin(source, system, step, time, result, alternate) {
  const engine = vm.createContext({ $dataSystem: system, step, time, result, alternate, assert });
  vm.runInContext(`
    let $gameSystem, $gameParty, $gameVariables, $gameSwitches;
    class Game_Party { steps() { return this.count || 0; } increaseSteps() { this.count = this.steps() + 1; } }
    class Game_Variables { value(id) { return this[id] || 0; } setValue(id, value) { this[id] = Math.floor(value); } }
    class Game_Switches { value(id) { return !!this[id]; } setValue(id, value) { this[id] = value; } }
    class Scene_Map { isActive() { return this.active !== false; } update() {} }
    class Scene_Battle extends Scene_Map { update() {} }
    const SceneManager = { isSceneChanging: () => false }, document = { hidden: false };
    const DataManager = {
      createGameObjects() { $gameSystem = {}; $gameParty = new Game_Party(); $gameVariables = new Game_Variables(); $gameSwitches = new Game_Switches(); },
      extractSaveContents(save) { $gameSystem = save.system; $gameVariables = Object.assign(new Game_Variables(), save.variables); $gameSwitches = Object.assign(new Game_Switches(), save.switches); },
    };
  `, engine);
  vm.runInContext(source, engine);
  vm.runInContext(`
    DataManager.createGameObjects();
    assert.equal($gameSwitches.value(result), false);
    assert.equal($gameSwitches.value(alternate), true);
    $gameParty.increaseSteps();
    assert.equal($gameVariables.value(step), 0);
    const save = JSON.stringify({system: $gameSystem, variables: $gameVariables, switches: $gameSwitches});
    DataManager.createGameObjects();
    $gameParty.increaseSteps();
    assert.equal($gameVariables.value(step), 0);
    DataManager.extractSaveContents(JSON.parse(save));
    $gameParty.increaseSteps();
    assert.equal($gameVariables.value(step), 3);
    assert.equal($gameSwitches.value(result), false);
    assert.equal($gameSwitches.value(alternate), false);
    const scene = new Scene_Map();
    document.hidden = true;
    for (let i = 0; i < 120; i++) scene.update();
    assert.equal($gameVariables.value(time), 0);
    document.hidden = false;
    scene.active = false;
    for (let i = 0; i < 120; i++) scene.update();
    assert.equal($gameVariables.value(time), 0);
    const battle = new Scene_Battle();
    for (let i = 0; i < 59; i++) battle.update();
    assert.equal($gameVariables.value(time), 0);
    battle.update();
    assert.equal($gameVariables.value(time), 2);
    assert.equal($gameSwitches.value(result), true);
    $gameSwitches.setValue(result, false);
    assert.equal($gameSwitches.value(result), true);
    $gameVariables.setValue(step, 1);
    assert.equal($gameSwitches.value(result), false);
    assert.equal($gameSwitches.value(alternate), true);
    DataManager.extractSaveContents({system: {}, variables: {[step]: 7, [time]: 2}, switches: {[result]: false}});
    assert.equal($gameSwitches.value(result), true);
    assert.equal($gameSwitches.value(alternate), false);
  `, engine);
}

async function verify(prefix) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgstudio-rules-'));
  const source = path.join(temp, 'original'), work = path.join(temp, 'working'), cover = path.join(temp, 'covered');
  const data = prefix + 'data', plugins = prefix + 'js/plugins.js';
  writeTestData(path.join(source, data));
  fs.mkdirSync(path.dirname(path.join(source, plugins)), { recursive: true });
  fs.writeFileSync(path.join(source, plugins), 'var $plugins = [{"name":"KeepThis","status":false,"parameters":{}}];\n', 'utf8');
  fs.cpSync(source, work, { recursive: true });
  fs.cpSync(source, cover, { recursive: true });
  const old = new Date(2000, 0, 1);
  for (const file of fs.readdirSync(path.join(work, data))) fs.utimesSync(path.join(work, data, file), old, old);
  fs.utimesSync(path.join(work, plugins), old, old);
  const studio = createStudio({ projects: { dir: path.join(temp, 'projects') } });
  const registered = studio.registry.add({ id: 'rules', name: '自动累计测试', mode: 'copy', gameDir: work, source });
  const server = http.createServer((req, res) => studio.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/studio/`;
    const get = async route => (await (await fetch(base + route)).json());
    const { projectKey } = await get('project');
    const post = async (route, body, status = 200) => {
      const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-project': projectKey }, body: JSON.stringify(body) });
      const json = await res.json();
      assert.equal(res.status, status, JSON.stringify(json));
      return json;
    };
    const plain = await post('name', { kind: 'var', id: 'new', name: '普通变量' });
    await post('name', { kind: 'var', id: 'new', name: '无效累计', passive: { type: 'time', every: 0, amount: 1 } }, 400);
    assert(!fs.existsSync(path.join(work, prefix + PLUGIN_FILE)));
    const step = await post('name', { kind: 'var', id: 'new', name: '累计步数', passive: { type: 'steps', every: 2, amount: 3 } });
    const time = await post('name', { kind: 'var', id: 'new', name: '累计时间' });
    await post('name', { kind: 'var', id: time.id, passive: { type: 'time', every: 1, amount: 2 } });
    await post('name', { kind: 'var', id: time.id, name: '累计秒数' });
    const group = await post('variable/group', { switch: 'new', name: '奖励可领取', mode: 'all', text: '变量 累计步数 >= 3\n变量 累计秒数 >= 2' });
    const alternate = await post('variable/group', { switch: 'new', name: '仍需移动', mode: 'any', text: '变量 累计步数 < 2\n变量 累计秒数 > 99' });
    await post('variable/group', { switch: group.id, mode: 'all', text: '变量 累计步数 >= 3' }, 400);
    await post('variable/group', { switch: 'new', name: '无效分组', mode: 'all', text: '变量 999999 >= 2' }, 400);
    const vars = await get('names?kind=var');
    assert(!vars.rows.find(r => r.id === plain.id).passive);
    assert.equal(vars.rows.find(r => r.id === time.id).passiveText, '每 1 秒增加 2');
    assert(vars.groups.find(r => r.id === group.id).text.includes('累计秒数'));
    const impact = await get('impact?kind=var&id=' + step.id + '&change=add&before=0&value=3');
    assert(impact.refs.some(r => r.rule?.type === 'booleanGroup' && r.at.id === alternate.id && r.effect.context));
    const compiled = studio.tools().script.scriptCommands(studio.tools().script.parseScript('#如果 开关 奖励可领取 开\n#变量 累计步数 +1\n#条件结束'));
    assert.deepEqual(compiled[0].parameters, [0, group.id, 0]);
    const response = await fetch(base + 'projects/export?id=' + registered.id);
    assert.equal(response.status, 200);
    const zip = path.join(temp, 'export.zip');
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const entries = listZip(zip);
    assert.deepEqual(entries.map(e => e.name).sort(), [data + '/System.json', plugins, prefix + PLUGIN_FILE].sort());
    for (const e of entries) {
      const dest = path.join(cover, e.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await extractEntry(zip, e, dest);
    }
    const config = JSON.parse(fs.readFileSync(path.join(cover, data, 'System.json'), 'utf8'));
    const installed = fs.readFileSync(path.join(cover, plugins), 'utf8');
    assert(installed.includes('KeepThis') && installed.includes(ENTRY.name));
    assert(!fs.existsSync(path.join(source, prefix + PLUGIN_FILE)));
    assert.deepEqual(rulesOf(JSON.parse(fs.readFileSync(path.join(source, data, 'System.json'), 'utf8'))), { passive: {}, groups: {} });
    runPlugin(fs.readFileSync(path.join(cover, prefix + PLUGIN_FILE), 'utf8'), config, step.id, time.id, group.id, alternate.id);
    await post('name', { kind: 'var', id: step.id, passive: null });
    await post('variable/group', { id: group.id, remove: true });
    const latest = await get('names?kind=var');
    assert(!latest.rows.find(r => r.id === step.id).passive && !latest.groups.some(r => r.id === group.id));
    console.log(`${data} 累计、变量组、存档恢复和导出覆盖均通过`);
  } finally { server.close(); }
}

async function verifyPlaytestOverlay() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgstudio-rules-overlay-'));
  const game = path.join(temp, 'original'), dataDir = path.join(temp, 'overlay');
  fs.mkdirSync(path.join(game, 'js'), { recursive: true });
  fs.writeFileSync(path.join(game, 'js/plugins.js'), 'var $plugins = [];\n', 'utf8');
  writeTestData(dataDir);
  const studio = createStudio({ gameDir: game, dataDir, backupsDir: path.join(temp, 'backups') });
  const server = http.createServer((req, res) => studio.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const { projectKey } = await (await fetch(origin + '/api/studio/project')).json();
    const res = await fetch(origin + '/api/studio/name', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-project': projectKey },
      body: JSON.stringify({ kind: 'var', id: 'new', name: '覆盖层步数', passive: { type: 'steps', every: 1, amount: 1 } }) });
    assert.equal(res.status, 200, await res.text());
    assert.equal(fs.readFileSync(path.join(game, 'js/plugins.js'), 'utf8'), 'var $plugins = [];\n');
    assert(!fs.existsSync(path.join(game, PLUGIN_FILE)));
    assert((await (await fetch(origin + '/play/main/js/plugins.js')).text()).includes(ENTRY.name));
    assert.equal(await (await fetch(origin + '/play/main/' + PLUGIN_FILE)).text(), fs.readFileSync(SOURCE, 'utf8'));
    console.log('独立数据目录试玩加载累计插件，源目录保持原样');
  } finally { server.close(); }
}

(async () => { await verify(''); await verify('www/'); await verifyPlaytestOverlay(); })().catch(error => { console.error(error); process.exitCode = 1; });
