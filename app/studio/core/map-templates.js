'use strict';
const { blankPage, END, int, need } = require('../lib/util.js');

const templates = { chest: '宝箱', pickup: '拾取物', door: '钥匙门', inn: '旅馆', save: '存档点', shop: '商店' };
const defaultModes = Object.fromEntries(Object.keys(templates).map(kind => [kind, ['chest', 'pickup'].includes(kind) ? 'once' : 'repeat']));
const cmd = (code, ...parameters) => ({ code, indent: 0, parameters });
const nested = list => list.map(c => ({ ...c, indent: c.indent + 1 }));
const branch = (params, yes, no) => [cmd(111, ...params), ...nested([...yes, END()]), cmd(411), ...nested([...no, END()]), cmd(412)];

function makeTemplate(T, kind, b, project, checkImage) {
  const page = blankPage();
  if (b.image) page.image = checkImage(b.image, page.image);
  const spoken = text => [T.script.msgHead(''), cmd(401, text)];
  const label = templates[kind];
  const mode = b.mode ?? defaultModes[kind];
  need(mode === 'once' || mode === 'repeat', '请选择交互次数');
  const markUsed = mode === 'once' ? [cmd(123, 'A', 0)] : [];
  const name = String(b.name || '').trim().slice(0, 40) || label;
  const pages = [page];
  if (kind === 'chest' || kind === 'pickup') {
    const item = int(b.item, '请选择物品'), count = int(b.count, '数量要填整数');
    need(project.has('item', item) && count >= 1 && count <= 999999, '请选择存在的物品，数量为 1～999999');
    if (kind === 'pickup') page.priorityType = 0;
    page.directionFix = true;
    page.list = [cmd(126, item, 0, 0, count), ...markUsed, ...spoken(`获得 ${project.name('item', item)} ×${count}`), END()];
  } else if (kind === 'door') {
    const item = int(b.item, '请选择钥匙'), toMap = int(b.to?.map), x = int(b.to?.x), y = int(b.to?.y);
    need(project.has('item', item), '请选择存在的物品作为钥匙');
    const map = project.map(toMap);
    need(map && x >= 0 && x < map.width && y >= 0 && y < map.height, '传送落点不在目标地图内');
    need(toMap !== b.map || x !== b.x || y !== b.y, '目的地不能是这扇门所在的格子');
    page.list = [...branch([8, item], [...markUsed, cmd(201, 0, toMap, x, y, 0, 0)], spoken('需要 ' + project.name('item', item) + '。')), END()];
  } else if (kind === 'inn') {
    const price = int(b.price, '房费要填整数');
    need(price >= 0 && price <= 999999, '房费需在 0～999999 内');
    const stay = [...(price ? [cmd(125, 1, 0, price)] : []), cmd(221), cmd(230, 40), cmd(314, 0, 0), ...markUsed, cmd(222)];
    const pay = price ? branch([7, price, 0], stay, spoken('金币不足。')) : stay;
    const label = price ? '休息（' + price + ' 金币）' : '休息';
    page.list = [...spoken('要休息吗？'), cmd(102, [label, '离开'], 1, 0, 2, 0),
      cmd(402, 0, label), ...nested([...pay, END()]),
      cmd(402, 1, '离开'), { ...END(), indent: 1 }, cmd(404), END()];
  } else if (kind === 'save') {
    page.list = [...markUsed, cmd(352), END()];
  } else if (kind === 'shop') {
    const goods = String(b.goods || '').trim();
    const source = /^[#＃]\s*商店/.test(goods) ? goods : '#商店 ' + goods.split(/\r?\n/).filter(line => line.trim()).join(' | ');
    const lines = T.script.parseScript(source);
    page.list = [...markUsed, ...T.script.scriptCommands(lines), END()];
  }
  if (mode === 'once') {
    const used = blankPage();
    used.conditions.selfSwitchValid = true;
    used.directionFix = true;
    if (kind === 'pickup') used.priorityType = 0;
    else used.image = { ...page.image };
    if (kind === 'chest') {
      if (b.openImage) used.image = checkImage(b.openImage, page.image);
      used.list = [...spoken('宝箱已经打开了。'), END()];
    }
    pages.push(used);
  }
  return { name, note: 'rpgStudio · ' + label, pages };
}

module.exports = { templates, defaultModes, makeTemplate };
