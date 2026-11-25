'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { need } = require('../lib/util.js');
const { canvas, encodePng } = require('../lib/png.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');
const shared = require('../web/layered-portrait-runtime.js');
const { parseRegion } = require('./portrait-region.js');

const ENTRY = { name: 'RpgStudio_LayeredPortrait', status: true, description: 'rpgStudio 分层立绘', parameters: {} };
const SOURCE = path.join(__dirname, '../web/layered-portrait-runtime.js');
const PLUGIN_FILE = `js/plugins/${ENTRY.name}.js`;
const PART_ID = /^part_[a-f0-9]{40}$/;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const FACE_SLOTS = ['eyes', 'mouth'];
const layoutsOf = system => system?.[shared.key] || {};
const used = system => Object.keys(layoutsOf(system)).length > 0;
const ensure = ctx => ensureRuntimePlugin(ctx, { ENTRY, SOURCE });
const faceNames = layout => [shared.faceDefault, ...Object.keys(layout.faces)];
const label = value => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,24}$/u.test(value) && !Object.hasOwn(Object.prototype, value);
const hasFace = (layout, face) => !!layout && (face === shared.faceDefault || Object.hasOwn(layout.faces, face));
const emptyLayer = shared.emptyLayer;
const empty = () => ({ width: 420, height: 540, layers: Object.fromEntries(Object.keys(shared.slots).map(id => [id, emptyLayer()])), faces: {}, variants: {}, states: {}, programs: {} });

function choices(project) {
  const layouts = layoutsOf(project.sys());
  return (project.read('Actors.json') || []).filter(actor => actor && layouts[actor.id]).map(actor => ({ id: actor.id, name: actor.name, faces: faceNames(layouts[actor.id]) }));
}

function resolveActor(project, ref) {
  const actors = project.read('Actors.json') || [];
  if (/^@[1-9]\d*$/.test(ref)) return actors[Number(ref.slice(1))];
  const layouts = layoutsOf(project.sys());
  const named = actors.filter(actor => actor && (actor.name === ref || layouts[actor.id]?.name === ref));
  return named.length === 1 ? named[0] : null;
}

function forPicture(project, name) {
  const tag = shared.readPicture(name);
  if (!tag) return null;
  const layout = layoutsOf(project.sys())[tag.actor];
  return hasFace(layout, tag.face) && hasAction(layout, tag.action) ? { ...tag, layout } : null;
}

const hasAction = (layout, action) => Object.hasOwn(shared.actions, action) || Object.hasOwn(layout?.programs || {}, action);

function checkEdit(layout, op) {
  if (op[0] === 'face') need(hasFace(layout, op[1]), `找不到立绘表情「${op[1]}」`);
  if (op[0] === 'part') need(['默认', '无'].includes(op[2]) || Object.hasOwn(layout.variants?.[op[1]] || {}, op[2]), `找不到${shared.slots[op[1]]}素材「${op[2]}」`);
}

function importPart(project, png, root) {
  need(png.length >= 33 && png.subarray(0, 16).equals(PNG), '请选择透明 PNG 图片');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  need(width > 0 && height > 0 && width <= 2400 && height <= 2400, '部位图的宽和高须在 1～2400 像素之间');
  const name = 'part_' + createHash('sha256').update(png).digest('hex').slice(0, 40);
  if (!fs.existsSync(path.join(root || project.gameImgRoot(), shared.partSub, name + '.png'))) {
    project.writeImage(shared.partSub, name, png, { root, encrypt: false });
  }
  return { name, width, height };
}

function parseLayout(project, body, conditions) {
  const range = (n, min, max, name) => {
    need(Number.isInteger(n) && n >= min && n <= max, `${name}须为 ${min}～${max} 的整数`);
    return n;
  };
  const file = (name, title) => {
    if (!name) return '';
    need(typeof name === 'string' && PART_ID.test(name) && project.findImage(shared.partSub, name), `${title}的 PNG 素材不存在`);
    return name;
  };
  const coordinate = (n, name) => { need(typeof n === 'number' && n >= -8192 && n <= 8192, `${name}须在 -8192～8192 之间`); return n; };
  const width = range(body?.width, 64, 2400, '画布宽度'), height = range(body?.height, 64, 2400, '画布高度');
  const name = String(body.name || '').trim();
  need(!name || label(name) && !['默认', '无', '自动', '正常'].includes(name), '立绘名称可用 1～24 个中文、字母、数字、下划线或短横线');
  const part = (v, title) => ({ file: file(v.file, title), x: coordinate(v.x, title + '横坐标'), y: coordinate(v.y, title + '纵坐标'),
    scale: range(v.scale, 1, 2000, title + '缩放'), scaleY: v.scaleY == null ? null : range(v.scaleY, 1, 2000, title + '纵向缩放'),
    opacity: range(v.opacity ?? 255, 0, 255, title + '不透明度'), z: v.z == null ? null : range(v.z, 1, 1000, title + '层级'),
    flipX: v.flipX === true, flipY: v.flipY === true, pivotX: range(v.pivotX, 0, 100, title + '关节横向位置'),
    pivotY: range(v.pivotY, 0, 100, title + '关节纵向位置') });
  const layers = Object.fromEntries(Object.entries(shared.slots).map(([slot, title]) => [slot, part(body.layers?.[slot] || emptyLayer(), title)]));
  need(Object.values(layers).some(layer => layer.file), '至少添加一个基础部位才能保存立绘');
  const entries = Object.entries(body.faces || {});
  need(entries.length <= 24, '一套立绘最多添加 24 个表情');
  const faces = Object.fromEntries(entries.map(([name, changes]) => {
    need(label(name) && name !== shared.faceDefault, '表情名须为 1～24 个字母、数字、汉字、下划线或短横线');
    return [name, Object.fromEntries(FACE_SLOTS.map(slot => [slot, file(changes?.[slot], name + ' · ' + shared.slots[slot])]))];
  }));
  const named = (data, what, parse) => {
    const rows = Array.isArray(data) ? data.map(row => [row?.name, row]) : Object.entries(data || {});
    need(rows.length <= 24, `最多能添加 24 个${what}`);
    const names = new Set();
    return Object.fromEntries(rows.map(([name, value]) => {
      need(label(name) && !['默认', '无', '自动'].includes(name), `${what}名称须为 1～24 个字母、数字、汉字、下划线或短横线`);
      const key = name.toLowerCase();
      need(!names.has(key), `${what}名称「${name}」重复`);
      names.add(key);
      return [name, parse(value, name)];
    }));
  };
  const variants = Object.fromEntries(Object.entries(shared.slots).map(([slot, title]) => [slot,
    named(body.variants?.[slot], title + '素材', (v, name) => {
      const result = part(v, title + '「' + name + '」');
      need(result.file, `请为${title}素材「${name}」导入 PNG`);
      return result;
    })]));
  const layout = { name, width, height, layers, faces, variants };
  if (body.placement != null) layout.placement = { x: coordinate(body.placement.x, '原位横坐标'), y: coordinate(body.placement.y, '原位纵坐标') };
  if (body.region != null) layout.region = parseRegion(body.region);
  const parseEdits = (source, allowWait) => {
    const lines = source.split(/\r?\n/);
    need(source.length <= 4000 && lines.length <= 80, '一组立绘写法最多 80 行');
    return lines.flatMap((line, i) => {
      if (!line.trim()) return [];
      const op = shared.parseEdit(line);
      need(op && (allowWait || op[0] !== 'wait'), `第 ${i + 1} 行可以写部位${allowWait ? '、#表情 或 #等待' : '或 #表情'}`);
      if (op[0] === 'wait') { need(op[1] >= 1 / 60 && op[1] <= 10, '每次等待须在 1 帧至 10 秒之间'); op[1] = Math.round(op[1] * 60); }
      checkEdit(layout, op);
      return [op];
    });
  };
  layout.states = named(body.states, '立绘状态', (v, name) => {
    const source = String(v?.source || '').trim(), condition = String(v?.condition || '').trim();
    const selection = { parts: {}, face: '' };
    for (const op of parseEdits(source, false)) shared.applyEdit(selection, op);
    let groups = [];
    if (condition) {
      need(name !== '正常', '正常是默认状态，自动条件请填在其它状态上');
      need(condition.length <= 300 && conditions, '请输入变量或开关条件');
      groups = conditions(condition, { strict: true });
      need(groups.flat().every(p => p[0] === 0 || p[0] === 1 && p[2] === 0), '立绘的自动条件支持开关和变量');
    }
    return { ...selection, source, condition, groups };
  });
  layout.programs = named(body.programs, '动作', v => {
    const source = String(v?.source || '').trim(), ops = parseEdits(source, true);
    const frames = ops.reduce((total, op) => total + (op[0] === 'wait' ? op[1] : 0), 0) + (ops.at(-1)?.[0] === 'wait' ? 0 : 36);
    need(frames <= 1200, '一个立绘动作最长 20 秒');
    return { source, ops, frames };
  });
  return layout;
}

// 内置可编辑木偶。每张 PNG 都是一个独立部位，也可用于核对画布对齐和肩关节。
function demo(project, root) {
  const layout = empty();
  const wood = [221, 156, 97], edge = [83, 50, 43], blue = [52, 123, 156], gold = [255, 208, 110];
  function part(w, h, draw) {
    const image = canvas(w, h);
    draw(image);
    return importPart(project, encodePng(image), root).name;
  }
  function ellipse(image, x, y, rx, ry, color) {
    for (let dy = -ry; dy <= ry; dy++) {
      const dx = Math.floor(rx * Math.sqrt(1 - (dy / ry) ** 2));
      image.rect(x - dx, y + dy, dx * 2 + 1, 1, color);
    }
  }
  function set(slot, x, y, file, extra) { Object.assign(layout.layers[slot], { x, y, file }, extra); }
  set('body', 118, 212, part(184, 268, c => {
    ellipse(c, 92, 88, 91, 82, edge); ellipse(c, 92, 88, 85, 75, wood);
    c.rect(48, 82, 88, 165, edge); c.rect(54, 99, 76, 139, wood);
    c.rect(54, 230, 33, 23, edge); c.rect(98, 230, 33, 23, edge);
  }));
  set('clothes', 146, 263, part(128, 145, c => {
    c.rect(1, 10, 126, 126, edge); c.rect(7, 17, 114, 113, blue);
    c.rect(11, 25, 106, 10, gold); c.rect(59, 35, 10, 81, gold);
  }));
  set('head', 126, 76, part(168, 173, c => {
    ellipse(c, 84, 86, 82, 85, edge); ellipse(c, 84, 88, 75, 78, wood);
    ellipse(c, 36, 105, 12, 9, [199, 115, 93]); ellipse(c, 132, 105, 12, 9, [199, 115, 93]);
  }));
  set('hairFront', 130, 73, part(160, 83, c => {
    ellipse(c, 80, 47, 79, 46, edge); ellipse(c, 76, 40, 68, 34, [112, 69, 55]);
  }));
  const arm = part(57, 147, c => {
    ellipse(c, 28, 25, 27, 24, edge); c.rect(9, 25, 39, 87, edge); c.rect(14, 26, 29, 84, wood);
    ellipse(c, 28, 25, 17, 17, blue); ellipse(c, 28, 120, 23, 26, edge); ellipse(c, 28, 120, 17, 20, wood);
  });
  set('armL', 89, 235, arm, { pivotY: 17 }); set('armR', 274, 235, arm, { pivotY: 17 });
  set('eyes', 160, 158, part(100, 36, c => { ellipse(c, 16, 15, 7, 10, edge); ellipse(c, 84, 15, 7, 10, edge); }));
  set('mouth', 181, 203, part(58, 25, c => c.rect(13, 9, 32, 5, edge)));
  set('weapon', 292, 316, part(25, 102, c => { c.rect(8, 3, 9, 94, edge); c.rect(2, 27, 21, 9, gold); c.rect(10, 36, 4, 59, blue); }));
  layout.faces['笑'] = { eyes: part(100, 36, c => {
    for (const x of [16, 84]) { c.rect(x - 8, 13, 16, 5, edge); c.rect(x - 12, 17, 5, 6, edge); c.rect(x + 7, 17, 5, 6, edge); }
  }), mouth: part(58, 25, c => { ellipse(c, 29, 10, 19, 12, edge); c.rect(16, 6, 26, 5, [255, 243, 222]); }) };
  layout.variants.body = { 受伤: { ...layout.layers.body, file: part(184, 268, c => {
    ellipse(c, 92, 88, 91, 82, edge); ellipse(c, 92, 88, 85, 75, [176, 97, 84]);
    c.rect(48, 82, 88, 165, edge); c.rect(54, 99, 76, 139, [176, 97, 84]);
    c.rect(46, 193, 92, 20, [247, 225, 195]); c.rect(84, 188, 19, 30, [250, 239, 212]);
    c.rect(54, 230, 33, 23, edge); c.rect(98, 230, 33, 23, edge);
  }) } };
  layout.states = { 正常: { source: '', parts: {}, face: '', condition: '', groups: [] }, 受伤: { source: '#身体 受伤', parts: { body: '受伤' }, face: '', condition: '', groups: [] } };
  return layout;
}

module.exports = { ...shared, ENTRY, SOURCE, PLUGIN_FILE, PART_ID, used, ensure, empty, layoutsOf, choices, resolveActor, forPicture, hasFace, hasAction, checkEdit, parseLayout, importPart, demo };
