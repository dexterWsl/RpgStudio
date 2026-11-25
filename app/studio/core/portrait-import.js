'use strict';

const { createHash } = require('node:crypto');
const { int, need } = require('../lib/util.js');
const layered = require('./layered-portrait.js');

const isSourcePicture = command => command?.code === 231 && typeof command.parameters?.[1] === 'string' &&
  command.parameters[1] && !layered.readPicture(command.parameters[1]);

function sources(each, where, actor, common = []) {
  const result = [];
  const names = [actor?.name, actor?.portrait].filter(Boolean).map(name => name.toLowerCase());
  const named = text => names.some(name => String(text || '').toLowerCase().includes(name));
  const memo = new Map();
  function collect(list, trail = []) {
    const found = new Set();
    for (const command of list) {
      if (isSourcePicture(command)) found.add(command.parameters[1]);
      if (command?.code !== 117) continue;
      const id = command.parameters?.[0];
      if (!common[id] || trail.length >= 6 || trail.includes(id)) continue;
      if (!memo.has(id)) memo.set(id, collect(common[id].list || [], [...trail, id]));
      for (const file of memo.get(id)) found.add(file);
    }
    return found;
  }
  each((at, list, conditions, owner) => {
    const pictures = [...collect(list)];
    if (!pictures.length) return;
    const label = where(at);
    const typed = actor && list.some(c => c?.code === 101 && (named(c.parameters?.[4]) || c.parameters?.[4] === `\\N[${actor.id}]`));
    const related = !!(typed || named(owner?.name) || pictures.some(named));
    result.push({ at, label, pictures, related });
  });
  return result.sort((a, b) => Number(b.related) - Number(a.related));
}

function locate(ctx, at) {
  if (at?.type === 'troop') {
    const troop = int(at.troop, '敌群编号不对'), page = int(at.page, '页码不对');
    const event = ctx.project.read('Troops.json')?.[troop]?.pages?.[page];
    need(event, '找不到这个敌群事件页');
    return event.list || [];
  }
  const ref = ctx.at.parse(at), file = ctx.at.fileOf(ref);
  return ctx.at.locate({ [file]: ctx.project.read(file) }, ref).holder.list || [];
}

function hint(name) {
  const key = name.split(/[/\\]/).at(-1).toLowerCase().replace(/[_.\- ]+/g, ' ');
  const roles = [
    ['hairBack', /后发|後髪|後ろ髪|\b(?:back hair|hair back|hair b)\b/],
    ['hairFront', /前发|前髪|\b(?:front hair|hair front|hair f)\b/],
    ['eyes', /眉|眼|瞳|目|\b(?:eyes?|brows?|eyebrows?)\b/],
    ['mouth', /嘴|口|\b(?:mouth|lips?)\b/],
    ['armL', /左手|左臂|左腕|\b(?:left arm|arm left|arm l|l arm|left hand|hand l)\b/],
    ['armR', /右手|右臂|右腕|\b(?:right arm|arm right|arm r|r arm|right hand|hand r)\b/],
    ['legs', /腿部|双腿|脚部|\b(?:legs?|feet)\b/],
    ['hands', /手部|双手|\bhands?\b/],
    ['weapon', /武器|长剑|短剑|\b(?:weapon|sword)\b/],
    ['clothes', /衣服|服装|上衣|衣装|\b(?:clothes|costume|outfit|dress)\b/],
    ['head', /头部|顔|脸|\b(?:head|face)\b/],
    ['body', /身体|躯干|体幹|胴体|\b(?:body|torso|base)\b/],
  ];
  return roles.find(([, pattern]) => pattern.test(key))?.[0] || '';
}

function pictureTransform(p) {
  const [origin, designation, x, y, sx, sy, opacity, blend] = p.slice(2, 10);
  const scaleX = sx ?? 100, scaleY = sy ?? 100, alpha = opacity ?? 255;
  const valid = x => typeof x === 'number' && Number.isFinite(x);
  let issue = '';
  if (designation !== 0) issue = '位置来自游戏变量';
  else if (blend) issue = '使用了特殊混合模式';
  else if (![0, 1].includes(origin) || ![x, y].every(valid) || ![scaleX, scaleY, alpha].every(Number.isInteger) ||
    Math.abs(scaleX) > 2000 || Math.abs(scaleY) > 2000 || alpha < 0 || alpha > 255) issue = '图片参数超出木偶可编辑范围';
  return { origin, x, y, scaleX, scaleY, alpha, issue };
}

function agree(exits) {
  return new Map([...exits[0]].filter(([id, row]) => exits.every(pictures => JSON.stringify(pictures.get(id)) === JSON.stringify(row))));
}

function inspect(project, list) {
  const common = project.read('CommonEvents.json') || [], cache = new Map(), frames = new Map(), notices = new Set();
  let budget = 50000;
  function image(row) {
    if (!cache.has(row.name)) cache.set(row.name, project.imageSize('pictures', row.name));
    const size = cache.get(row.name), suggested = hint(row.name), issue = row.issue || row.effect || row.tone || '';
    if (!size?.w || !size?.h || size.w > 2400 || size.h > 2400) return { ...row, suggested, issue: issue || '找不到可用的 PNG 图片或图片超过 2400 像素' };
    const w = size.w * Math.abs(row.scaleX) / 100, h = size.h * Math.abs(row.scaleY) / 100;
    const center = row.origin === 1, flipX = row.scaleX < 0, flipY = row.scaleY < 0;
    const x = Math.round(row.x) - (center ? w / 2 : flipX ? w : 0);
    const y = Math.round(row.y) - (center ? h / 2 : flipY ? h : 0);
    return { ...row, x, y, w, h, suggested, flipX, flipY, issue };
  }
  function capture(pictures, line, trail, kind = '') {
    const visible = [...pictures.values()].filter(row => row.alpha !== 0 && row.scaleX !== 0 && row.scaleY !== 0).sort((a, b) => a.id - b.id);
    if (!visible.length) return;
    const key = createHash('sha256').update(JSON.stringify(visible)).digest('hex').slice(0, 24);
    if (frames.has(key)) return;
    const layers = visible.map(image);
    const clean = layers.filter(row => !row.issue);
    if (!clean.length) {
      for (const row of layers) if (row.issue) notices.add(row.issue);
      return;
    }
    frames.set(key, { key, line, trail, kind, layers });
  }

  function walk(commands, pictures, trail) {
    const flow = [];
    for (const [i, command] of commands.entries()) {
      if (--budget < 0 || frames.size >= 500) { notices.add('本次读取到前 500 个画面，可从具体公共事件或事件页继续提取。'); break; }
      if (!command) continue;
      const p = command.parameters || [], code = command.code, top = flow.at(-1);
      if (code === 111 || code === 102) { flow.push({ code, indent: command.indent, base: new Map(pictures), exits: [], branch: false }); continue; }
      if (top?.indent === command.indent && (top.code === 111 && code === 411 || top.code === 102 && [402, 403].includes(code))) {
        if (top.code === 111 || top.branch) top.exits.push(pictures);
        top.branch = true; pictures = new Map(top.base); continue;
      }
      if (top?.indent === command.indent && (top.code === 111 && code === 412 || top.code === 102 && code === 404)) {
        top.exits.push(pictures);
        if (!top.branch || top.code === 102) top.exits.push(top.base);
        pictures = agree(top.exits); flow.pop(); continue;
      }
      if (isSourcePicture(command) && Number.isInteger(p[0]) && p[0] >= 1 && p[0] <= 1000) {
        pictures.set(p[0], { id: p[0], name: p[1], ...pictureTransform(p), effect: '' });
        capture(pictures, i + 1, trail);
      } else if (code === 231) pictures.delete(p[0]);
      else if (code === 235 && pictures.delete(p[0])) capture(pictures, i + 1, trail, '移除后');
      else if (code === 232 && pictures.has(p[0])) {
        const row = pictures.get(p[0]);
        const transform = Number(p[10]) > 0 ? pictureTransform(p) : { origin: p[2], issue: p[9] ? '使用了特殊混合模式' : row.issue };
        pictures.set(p[0], { ...row, ...transform });
        capture(pictures, i + 1, trail, '移动终点');
      } else if (code === 233 && pictures.has(p[0]) && Number(p[1])) {
        pictures.set(p[0], { ...pictures.get(p[0]), effect: '使用了旋转动画' });
      } else if (code === 234 && pictures.has(p[0])) {
        const row = pictures.get(p[0]);
        pictures.set(p[0], { ...row, tone: Array.isArray(p[1]) && p[1].some(value => value) ? '使用了图片色调' : '' });
        capture(pictures, i + 1, trail);
      } else if (code === 117 && common[p[0]] && trail.length < 6 && !trail.includes(p[0])) {
        pictures = walk(common[p[0]].list || [], pictures, [...trail, p[0]]);
      } else if ([112, 113, 115, 117, 119, 413, 355, 356, 357].includes(code)) {
        if (pictures.size) notices.add('遇到插件、脚本或跳转时，后续候选会重新从原生图片指令开始识别。');
        pictures = new Map();
        if (code === 115 && !flow.length) break;
      }
    }
    return pictures;
  }

  walk(list, new Map(), []);
  return { frames: [...frames.values()], notices: [...notices] };
}

function draft(project, frame, mapping, root) {
  const used = new Set(), photoIds = new Set();
  need(Array.isArray(mapping) && mapping.length && mapping.length <= Object.keys(layered.slots).length, '请至少为一张图分配部位');
  const source = mapping.map(selection => {
    const id = int(selection?.id, '图片编号不对'), slot = selection?.slot;
    const row = frame.layers.find(layer => layer.id === id);
    need(row && !row.issue, row?.issue || '在这一帧找不到选中的图层');
    need(Object.hasOwn(layered.slots, slot) && !used.has(slot) && !photoIds.has(id), '每张图片和每个部位只能选择一次');
    used.add(slot); photoIds.add(id);
    return { ...row, slot };
  });
  const left = Math.floor(Math.min(...source.map(row => row.x))), top = Math.floor(Math.min(...source.map(row => row.y)));
  let width = Math.max(64, Math.ceil(Math.max(...source.map(row => row.x + row.w))) - left);
  if (width % 2) width++;
  const height = Math.max(64, Math.ceil(Math.max(...source.map(row => row.y + row.h))) - top);
  need(width <= 2400 && height <= 2400 && Math.abs(left + width / 2) <= 8192 && Math.abs(top + height) <= 8192, '选中的图层范围太大，请缩小到属于同一角色的图层');
  const images = source.map(row => {
    const asset = project.loadImage('pictures', row.name);
    need(asset && asset.mime === 'image/png', '找不到图层「' + row.name + '」的 PNG');
    return { row, asset };
  });
  const layout = { ...layered.empty(), width, height, placement: { x: left + width / 2, y: top + height } };
  for (const { row, asset } of images) {
    const png = layered.importPart(project, asset.buf, root);
    layout.layers[row.slot] = { ...layout.layers[row.slot], file: png.name, x: row.x - left, y: row.y - top,
      scale: Math.abs(row.scaleX), scaleY: Math.abs(row.scaleX) === Math.abs(row.scaleY) ? null : Math.abs(row.scaleY),
      opacity: row.alpha, z: row.id, flipX: row.flipX, flipY: row.flipY };
  }
  return layout;
}

module.exports = { sources, locate, inspect, draft };
