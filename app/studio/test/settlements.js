'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createStudio } = require('../handler.js');
const { blankData } = require('../core/blank.js');
const { listZip, extractEntry } = require('../core/zip.js');

async function verify(dataDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgstudio-settlement-'));
  const original = path.join(root, 'original'), work = path.join(root, 'work'), target = path.join(root, 'target');
  const source = blankData({ title: '结算测试', locale: 'zh_CN', versionId: 1 });
  source['Items.json'].push({ id: 1, name: '回复药' });
  for (const dir of [original, work, target]) {
    fs.mkdirSync(path.join(dir, dataDir), { recursive: true });
    for (const [file, data] of Object.entries(source)) {
      const out = path.join(dir, dataDir, file);
      fs.writeFileSync(out, JSON.stringify(data), 'utf8');
      fs.utimesSync(out, new Date(2000, 0, 1), new Date(2000, 0, 1));
    }
  }
  const originalBytes = file => fs.readFileSync(path.join(original, dataDir, file));
  const studio = createStudio({ projects: { dir: path.join(root, 'projects') } });
  const project = studio.registry.add({ id: 'copy', name: '结算测试', mode: 'copy', gameDir: work, source: original });
  const server = http.createServer((req, res) => studio.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port + '/api/studio/';
    const projectKey = (await (await fetch(base + 'project')).json()).projectKey;
    const get = async route => (await fetch(base + route)).json();
    const post = async (route, body, status = 200) => {
      const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-project': projectKey }, body: JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    };

    const actions = [
      { type: 'switch', id: 1, on: true },
      { type: 'var', id: 1, op: 0, value: 7 },
      { type: 'var', id: 1, op: 1, value: 3 },
      { type: 'var', id: 1, op: 2, value: 2 },
    ];
    const name = '交付任务奖励';
    await post('settlement/save', { name, actions: [{ ...actions[1], value: null }] }, 400);
    assert.deepEqual(fs.readFileSync(path.join(work, dataDir, 'CommonEvents.json')), originalBytes('CommonEvents.json'));
    const group = await post('settlement/save', { name, actions });
    await post('settlement/save', { name, actions }, 400);
    assert((await get('settlements')).groups[0].text.includes('#变量'));

    const map = studio.project.map(1);
    const pos = Array.from({ length: map.width * map.height }, (_, i) => ({ x: i % map.width, y: Math.floor(i / map.width) }))
      .find(p => !map.events.some(ev => ev && ev.x === p.x && ev.y === p.y));
    const created = await post('event/create', { map: 1, ...pos, name: '结算调用测试' });
    const at = { type: 'map', map: 1, ev: created.id, page: 0 };
    await post('text', { at, text: '#结算 不存在' }, 400);
    await post('text', { at, text: '#场景 ' + group.id }, 400);
    await post('text', { at, text: '#结算 ' + name + '\n#天气 雪 6 1.25秒 等完\n#天气 无 0 2秒' });
    const view = await get('event?map=1&ev=' + created.id);
    assert(view.pages[0].script.text.includes('#结算 ' + name));
    assert(view.pages[0].outline.some(row => row.code === 117 && row.text.startsWith('结算')));
    for (const invalid of ['#如果 变量 1 >= 7\n#物品 1 +1', '#如果 开关 99998 开\n#物品 1 +1\n#条件结束', '#物品 1 +0', '#变量 1 +9007199254740992', '#场景 1']) {
      await post('settlement/save', { id: group.id, name, text: invalid }, 400);
    }
    const text = [
      '#开关 1 开', '#变量 1 =7', '#如果 变量 1 >= 7 并且 开关 1 开',
      '  #物品回复药+1', '  #变量1+3', '  #如果 变量 1 = 10', '    #变量 1 -2', '  #条件结束',
      '#否则', '  #物品 1 -1', '#结束',
    ].join('\n');
    const impactBefore = fs.readFileSync(path.join(work, dataDir, 'CommonEvents.json'));
    const draft = await post('settlement/impact', { id: group.id, text });
    assert.deepEqual(fs.readFileSync(path.join(work, dataDir, 'CommonEvents.json')), impactBefore);
    assert(draft.targets.some(t => t.kind === 'item' && t.actions[0].line === 4 && t.actions[0].conditional));
    assert(draft.callers.some(c => c.at.ev === created.id));
    await post('settlement/save', { id: group.id, name: '奖励已确认', text });
    assert((await get('event?map=1&ev=' + created.id)).pages[0].script.text.includes('#结算 奖励已确认'));
    const persisted = (await get('settlements')).groups[0];
    assert.equal(persisted.uses, 1);
    assert(persisted.editable && persisted.text.includes('#条件结束') && persisted.text.includes('#物品 回复药 +1'));
    assert.deepEqual((await get('settlement/impact?id=' + group.id)).targets.map(t => t.kind), ['switch', 'var', 'item']);
    const savedBytes = fs.readFileSync(path.join(work, dataDir, 'CommonEvents.json'));
    await post('settlement/save', { id: group.id, name: persisted.name, text: persisted.text });
    assert.deepEqual(fs.readFileSync(path.join(work, dataDir, 'CommonEvents.json')), savedBytes);
    const impact = await get('impact?kind=var&id=1&change=sub&value=3&before=10');
    assert.equal(impact.next, 7);
    assert.equal(impact.refs.filter(r => r.use === 'set' && r.where === '结算组「奖励已确认」').length, 3);

    const response = await fetch(base + 'projects/export?id=' + project.id);
    assert.equal(response.status, 200, response.ok ? '' : await response.text());
    const zip = path.join(root, 'export.zip');
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const entries = listZip(zip);
    assert.deepEqual(entries.map(e => e.name).sort(), [dataDir + '/CommonEvents.json', dataDir + '/Map001.json']);
    for (const entry of entries) await extractEntry(zip, entry, path.join(target, entry.name));
    const open = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, dataDir, file), 'utf8'));
    assert.equal(open(original, 'CommonEvents.json')[group.id], undefined);
    assert.equal(open(original, 'Map001.json').events[created.id], undefined);
    const ce = open(target, 'CommonEvents.json')[group.id];
    assert.equal(ce.trigger, 0);
    assert.deepEqual(ce.list.map(c => [c.code, c.indent, c.parameters]), [
      [108, 0, ['<RpgStudioSettlement>']], [121, 0, [1, 1, 0]], [122, 0, [1, 1, 0, 0, 7]],
      [111, 0, [12, '$gameVariables.value(1) >= 7 && $gameSwitches.value(1)']],
      [126, 1, [1, 0, 0, 1]], [122, 1, [1, 1, 1, 0, 3]],
      [111, 1, [1, 1, 0, 10, 0]], [122, 2, [1, 1, 2, 0, 2]], [0, 2, []], [412, 1, []],
      [0, 1, []], [411, 0, []], [126, 1, [1, 1, 0, 1]], [0, 1, []], [412, 0, []], [0, 0, []],
    ]);
    const exported = open(target, 'Map001.json').events[created.id].pages[0].list;
    assert.deepEqual(exported.slice(0, 3).map(c => [c.code, c.parameters]), [[117, [group.id]], [236, ['snow', 6, 75, true]], [236, ['none', 0, 120, false]]]);
    console.log(dataDir + ' 保存、改名、导出和覆盖：通过');
  } finally { server.close(); }
}

(async () => {
  await verify('data');
  await verify('www/data');
})().catch(error => { console.error(error); process.exitCode = 1; });
