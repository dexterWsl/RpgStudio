'use strict';
const { int, need } = require('../lib/util.js');

function parseRegion(value) {
  need(typeof value?.enabled === 'boolean', '请选择是否限定立绘显示区域');
  const x = int(value.x, '横向位置要填整数'), y = int(value.y, '纵向位置要填整数');
  const width = int(value.width, '区域宽度要填整数'), height = int(value.height, '区域高度要填整数');
  need(x >= 0 && y >= 0 && width >= 1 && height >= 1 && x + width <= 100 && y + height <= 100, '立绘区域必须在画面内，宽度和高度至少为 1%');
  return { enabled: value.enabled, x, y, width, height };
}

function screenOf(system) {
  const { screenWidth, screenHeight } = system?.advanced || {};
  return { width: Number(screenWidth) || 816, height: Number(screenHeight) || 624 };
}

module.exports = { parseRegion, screenOf };
