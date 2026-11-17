'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProject } = require('../core/project.js');
const { canvas, encodePng } = require('../lib/png.js');
const people = require('../routes/people.js');

const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgstudio-doll-test-'));
fs.mkdirSync(path.join(gameDir, 'data'));
const sys = { advanced: {}, tileSize: 48, hasEncryptedImages: true, encryptionKey: '0123456789abcdeffedcba9876543210' };
fs.writeFileSync(path.join(gameDir, 'data', 'System.json'), JSON.stringify(sys), 'utf8');
const project = createProject({ gameDir });
const png = (w, h) => {
  const c = canvas(w, h);
  c.rect(0, 0, w, h, [221, 165, 86, 255]);
  return encodePng(c);
};
const make = (p, wrote = []) => people({
  project: p, views: {}, opts: { onWrite: files => wrote.push(files) },
  uploadRoot: () => null, encryptUploads: () => true,
});
const T = { xref: { index: () => ({
  by: new Map([['sprite:$常用#0', [{}, {}, {}]], ['sprite:!道具#0', Array(20).fill({})]]),
}) } };

const routes = make(project);
assert.deepEqual(routes.get['sprite-guide'](T).recommended, { width: 48, height: 48 });
project.writeImage('characters', '$常用', png(144, 192), { encrypt: true });
project.writeImage('characters', '备用甲', png(768, 384), { encrypt: true });
project.writeImage('characters', '备用乙', png(768, 384), { encrypt: true });
project.writeImage('characters', '!道具', png(576, 384), { encrypt: true });
assert.deepEqual(project.imageSize('characters', '$常用'), { w: 144, h: 192 });
const guide = routes.get['sprite-guide'](T);
assert.equal(guide.recommended.sample.name, '$常用', '推荐尺寸优先采用使用次数最多的非物件行走图');
assert.equal(guide.recommended.uses, 3);
assert.equal(guide.sizes[1].sheets, 2);

const data = {
  walk: png(150, 256).toString('base64'),
  battle: png(450, 384).toString('base64'),
  attack: png(150, 256).toString('base64'),
};
const request = { name: '木偶', ...data };
assert.throws(() => routes.post['doll/save'](T, { ...request, battle: data.walk }), /PNG 格式不对/);
assert(!project.findImage('characters', '$木偶'));
const result = routes.post['doll/save'](T, request);
assert.deepEqual(result, { walk: '$木偶', battle: '木偶', attack: '$木偶_攻击', encrypted: true });
assert.deepEqual(project.loadImage('sv_actors', result.battle).buf, Buffer.from(data.battle, 'base64'));
assert.deepEqual(project.imageSize('characters', result.attack), { w: 150, h: 256 });
assert.throws(() => routes.post['doll/save'](T, request), /已有素材/);

const writes = [];
const failure = make({ ...project, writeImage(sub, ...args) {
  if (sub === 'sv_actors') throw new Error('模拟战斗图写入失败');
  return project.writeImage(sub, ...args);
} }, writes);
assert.throws(() => failure.post['doll/save'](T, { ...request, name: '失败' }), /模拟战斗图写入失败/);
assert(!project.findImage('characters', '$失败'), '写入一半失败时应清理已写的行走图');
assert(!writes.length);
console.log('工程推荐尺寸、加密 PNG、三张素材保存和失败恢复：通过');
