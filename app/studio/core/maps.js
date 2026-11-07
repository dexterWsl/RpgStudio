'use strict';
// 地图本身的编辑（通用）：图块数据、新建 / 改属性 / 改大小 / 删除地图
//   data：width × height × 6 层（0~3 图块、4 阴影、5 区域），下标 = (层 × 高 + y) × 宽 + x
const crypto = require('crypto');

const MAX_TILE = 8192;
const MAX_SIZE = 256;
const hashData = data => crypto.createHash('md5').update(JSON.stringify(data || [])).digest('hex');

// 保存图块前检查：长度、每一层的取值范围
function checkData(data, w, h) {
  if (!Array.isArray(data)) throw new Error('图块数据不对');
  if (data.length !== w * h * 6) throw new Error(`图块数据长度不对：应该是 ${w}×${h}×6 = ${w * h * 6}，收到 ${data.length}`);
  const n = w * h;
  for (let i = 0; i < data.length; i++) {
    const v = data[i], z = Math.floor(i / n);
    if (!Number.isInteger(v) || v < 0) throw new Error(`第 ${z + 1} 层有不合法的值`);
    if (z < 4 && v >= MAX_TILE) throw new Error(`第 ${z + 1} 层有不存在的图块编号 ${v}`);
    if (z === 4 && v > 15) throw new Error('阴影层的值不对');
    if (z === 5 && v > 255) throw new Error('区域编号只能是 0~255');
  }
}

// 改大小：左上角不动，右边 / 下边加宽或裁掉
function resizeData(data, w, h, w2, h2) {
  const out = new Array(w2 * h2 * 6).fill(0);
  for (let z = 0; z < 6; z++) for (let y = 0; y < Math.min(h, h2); y++) for (let x = 0; x < Math.min(w, w2); x++) {
    out[(z * h2 + y) * w2 + x] = data[(z * h + y) * w + x] || 0;
  }
  return out;
}

// 新地图（字段和 RPG Maker MZ 新建地图一样；MV 多出来的字段不影响）
function newMap({ width, height, tilesetId, displayName }) {
  return {
    autoplayBgm: false, autoplayBgs: false, battleback1Name: '', battleback2Name: '',
    bgm: { name: '', pan: 0, pitch: 100, volume: 90 }, bgs: { name: '', pan: 0, pitch: 100, volume: 90 },
    disableDashing: false, displayName: displayName || '', encounterList: [], encounterStep: 30,
    height, note: '', parallaxLoopX: false, parallaxLoopY: false, parallaxName: '', parallaxShow: true,
    parallaxSx: 0, parallaxSy: 0, scrollType: 0, specifyBattleback: false, tilesetId, width,
    data: new Array(width * height * 6).fill(0),
    events: [null],
  };
}

// 这一格人能不能站（照引擎的算法：从上往下看四层图块，☆ 跳过，第一个有设置的说了算）
function passable(m, flags, x, y) {
  const W = m.width, H = m.height;
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  if (!flags) return true;
  for (let z = 3; z >= 0; z--) {
    const t = (m.data || [])[(z * H + y) * W + x] || 0;
    if (!t && z > 0) continue;
    const f = flags[t] || 0;
    if (f & 0x10) continue;
    return (f & 0x0f) !== 0x0f;
  }
  return false;
}

const sizeOk = (w, h) => Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= MAX_SIZE && h <= MAX_SIZE;

module.exports = { checkData, resizeData, newMap, hashData, sizeOk, passable, MAX_SIZE };
