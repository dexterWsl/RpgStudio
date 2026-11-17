'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createStudio } = require('../handler.js');
const { blankData } = require('../core/blank.js');
const { commands } = require('../core/stage.js');
const { blankPage, END } = require('../lib/util.js');
const { canvas, encodePng } = require('../lib/png.js');

async function test() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sheet-delete-'));
  const game = path.join(temp, 'game'), data = path.join(game, 'data');
  const chars = path.join(game, 'img', 'characters');
  const backupsDir = path.join(temp, 'backups');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(chars, '子目录'), { recursive: true });

  const files = blankData({ title: '小人图删除测试', fonts: {} });
  Object.assign(files['Actors.json'][1], { characterName: 'Group', characterIndex: 3 });
  Object.assign(files['System.json'].boat, { characterName: 'Vehicle', characterIndex: 1 });
  const page = blankPage();
  page.list = [
    { code: 205, indent: 0, parameters: [0, { list: [{ code: 41, parameters: ['Route', 1] }] }] },
    { code: 355, indent: 0, parameters: ['this.character(0).setImage("Attack", 0);'] },
    ...commands('as', { who: 'NPC', sheet: 'Stage', index: 2 }, true), END(),
  ];
  files['Map001.json'].events[1] = { id: 1, name: '事件', x: 4, y: 4, pages: [page] };
  for (const [name, doc] of Object.entries(files)) fs.writeFileSync(path.join(data, name), JSON.stringify(doc), 'utf8');

  const png = encodePng(canvas(144, 192));
  const protectedNames = ['Group', 'Vehicle', 'Route', 'Attack', 'Stage'];
  for (const name of protectedNames) fs.writeFileSync(path.join(chars, name + '.png'), png);
  const unused = '子目录/$测试';
  for (const extension of ['.png', '.png_']) fs.writeFileSync(path.join(chars, unused + extension), png);

  const studio = createStudio({ gameDir: game, backupsDir });
  const server = http.createServer((req, res) => studio.handle(req, res));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/studio/`;
    const { projectKey } = await (await fetch(base + 'project')).json();
    const deleteSheet = name => fetch(base + 'assets/delete', {
      method: 'POST', headers: { 'x-studio-project': projectKey, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'img', sub: 'characters', name }),
    });

    const group = await (await fetch(base + 'sheet-usage?sub=characters&name=Group&index=0')).json();
    assert.equal(group.canDelete, true);
    assert.deepEqual(group.refs, []);
    assert.deepEqual(group.sheetRefs.map(ref => ref.id), ['Group#3']);
    for (const name of protectedNames) {
      const deleted = await deleteSheet(name);
      assert.equal(deleted.status, 400);
      assert.match((await deleted.json()).error, /引用/);
      assert(fs.existsSync(path.join(chars, name + '.png')));
    }
    const sheets = async () => (await (await fetch(base + 'sheets?sub=characters')).json()).sheets.map(sheet => sheet.name);
    assert((await sheets()).includes(unused));
    const deleted = await deleteSheet(unused);
    assert.equal(deleted.status, 200);
    const { backup, remaining } = await deleted.json();
    assert.equal(remaining, false);
    for (const extension of ['.png', '.png_']) {
      assert(!fs.existsSync(path.join(chars, unused + extension)));
      assert.deepEqual(fs.readFileSync(path.join(backup, path.basename(unused) + extension)), png);
    }
    assert(!(await sheets()).includes(unused));
    console.log('小人图整张引用保护、多个文件版本备份与删除、列表更新通过');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
