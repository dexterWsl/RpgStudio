// 图块地图：编号规则、画法、自动元件接边（浏览器和 Node 共用）
//   编号段和画法照 RPG Maker MZ 引擎（rmmz_core.js 的 Tilemap）；MV 一样。
//   地图 data：width × height × 6 层，下标 = (层 × 高 + y) × 宽 + x
//     第 0~3 层：图块编号；第 4 层：阴影（4 个四分之一格的位）；第 5 层：区域编号 0~255
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tilemap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = 48;
  const ID = { B: 0, C: 256, D: 512, E: 768, A5: 1536, A1: 2048, A2: 2816, A3: 4352, A4: 5888, MAX: 8192 };

  // 自动元件的四分之一格取哪一块（半格坐标）
  const FLOOR = [
    [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]], [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
    [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]], [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
    [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]], [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
    [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]], [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
    [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]], [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
    [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]], [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
    [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]], [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
    [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]], [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]], [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
    [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]], [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
    [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]], [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]], [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  ];
  const WALL = [
    [[2, 2], [1, 2], [2, 1], [1, 1]], [[0, 2], [1, 2], [0, 1], [1, 1]], [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[2, 2], [3, 2], [2, 1], [3, 1]], [[0, 2], [3, 2], [0, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
    [[2, 2], [1, 2], [2, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [1, 3]], [[2, 0], [1, 0], [2, 3], [1, 3]], [[0, 0], [1, 0], [0, 3], [1, 3]],
    [[2, 2], [3, 2], [2, 3], [3, 3]], [[0, 2], [3, 2], [0, 3], [3, 3]], [[2, 0], [3, 0], [2, 3], [3, 3]], [[0, 0], [3, 0], [0, 3], [3, 3]],
  ];
  const WATERFALL = [
    [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
  ];

  const isAuto = id => id >= ID.A1 && id < ID.MAX;
  const isA5 = id => id >= ID.A5 && id < ID.A1;
  const isA1 = id => id >= ID.A1 && id < ID.A2;
  const isA2 = id => id >= ID.A2 && id < ID.A3;
  const isA3 = id => id >= ID.A3 && id < ID.A4;
  const isA4 = id => id >= ID.A4 && id < ID.MAX;
  const kindOf = id => Math.floor((id - ID.A1) / 48);
  const shapeOf = id => (id - ID.A1) % 48;
  const kindBase = kind => ID.A1 + kind * 48;
  const isATile = id => id >= ID.A5 && id < ID.MAX;           // A 页（地面）
  // 自动元件的种类：floor（地面，47 种接法）/ wall（墙，16 种）/ waterfall（瀑布，4 种）
  function autoType(kind) {
    if (kind < 16) return kind >= 4 && kind % 2 === 1 ? 'waterfall' : 'floor';
    if (kind < 48) return 'floor';
    if (kind < 80) return 'wall';
    return Math.floor(kind / 8) % 2 === 1 ? 'wall' : 'floor';
  }
  const tableOf = kind => (autoType(kind) === 'wall' ? WALL : autoType(kind) === 'waterfall' ? WATERFALL : FLOOR);

  // ---------- 画 ----------
  // sheets：9 张图（A1 A2 A3 A4 A5 B C D E），没有的是 null
  function drawNormal(ctx, sheets, id, dx, dy, s) {
    const set = isA5(id) ? 4 : 5 + Math.floor(id / 256);
    const src = sheets[set];
    if (!src) return false;
    const sx = (Math.floor(id / 128) % 2 * 8 + id % 8) * T;
    const sy = Math.floor(id % 256 / 8) % 16 * T;
    if (sx + T > src.width || sy + T > src.height) return false;
    ctx.drawImage(src, sx, sy, T, T, dx, dy, s, s);
    return true;
  }
  function drawAuto(ctx, sheets, id, dx, dy, s, flags) {
    const kind = kindOf(id), shape = shapeOf(id);
    const tx = kind % 8, ty = Math.floor(kind / 8);
    let set = 0, bx = 0, by = 0, table = FLOOR, isTable = false;
    if (isA1(id)) {
      set = 0;
      if (kind === 0) { bx = 0; by = 0; }
      else if (kind === 1) { bx = 0; by = 3; }
      else if (kind === 2) { bx = 6; by = 0; }
      else if (kind === 3) { bx = 6; by = 3; }
      else {
        bx = Math.floor(tx / 4) * 8;
        by = ty * 6 + Math.floor(tx / 2) % 2 * 3;
        if (kind % 2 === 1) { bx += 6; table = WATERFALL; }
      }
    } else if (isA2(id)) {
      set = 1; bx = tx * 2; by = (ty - 2) * 3;
      isTable = !!(flags && (flags[id] & 0x80));
    } else if (isA3(id)) {
      set = 2; bx = tx * 2; by = (ty - 6) * 2; table = WALL;
    } else {
      set = 3; bx = tx * 2; by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
      if (ty % 2 === 1) table = WALL;
    }
    const src = sheets[set];
    const t = table[shape];
    if (!src || !t) return false;
    const w1 = T / 2, h1 = T / 2, q = s / 2;
    for (let i = 0; i < 4; i++) {
      const qsx = t[i][0], qsy = t[i][1];
      const sx1 = (bx * 2 + qsx) * w1, sy1 = (by * 2 + qsy) * h1;
      if (sx1 + w1 > src.width || sy1 + h1 > src.height) continue;
      const dx1 = dx + (i % 2) * q, dy1 = dy + Math.floor(i / 2) * q;
      if (isTable && (qsy === 1 || qsy === 5)) {
        const qsx2 = qsy === 1 ? [0, 3, 2, 1][qsx] : qsx;
        ctx.drawImage(src, (bx * 2 + qsx2) * w1, (by * 2 + 3) * h1, w1, h1, dx1, dy1, q, q);
        ctx.drawImage(src, sx1, sy1, w1, h1 / 2, dx1, dy1 + q / 2, q, q / 2);
      } else ctx.drawImage(src, sx1, sy1, w1, h1, dx1, dy1, q, q);
    }
    return true;
  }
  function drawTile(ctx, sheets, id, dx, dy, s, flags) {
    if (!(id > 0 && id < ID.MAX)) return false;
    return isAuto(id) ? drawAuto(ctx, sheets, id, dx, dy, s || T, flags) : drawNormal(ctx, sheets, id, dx, dy, s || T);
  }
  // A2 桌子类图块（图块集标志 0x80）：下面一格画出桌子的前沿（照 MZ 的 _addTableEdge）
  function drawTableEdge(ctx, sheets, id, dx, dy, s) {
    if (!isA2(id)) return;
    const src = sheets[1];
    if (!src) return;
    const kind = kindOf(id), t = FLOOR[shapeOf(id)];
    const bx = kind % 8 * 2, by = (Math.floor(kind / 8) - 2) * 3;
    const w1 = T / 2, h1 = T / 2, q = s / 2;
    for (let i = 0; i < 2; i++) {
      const qsx = t[2 + i][0], qsy = t[2 + i][1];
      ctx.drawImage(src, (bx * 2 + qsx) * w1, (by * 2 + qsy) * h1 + h1 / 2, w1, h1 / 2, dx + (i % 2) * q, dy, q, q / 2);
    }
  }
  const isShadowingTile = id => isA3(id) || isA4(id);
  // 画地图上的一格，顺序和 MZ 引擎一模一样（Tilemap._addSpot）：
  //   下层：第 1、2 层 → 阴影 → 上一格是桌子时的桌沿 → 第 3、4 层（带 ☆ 标志 0x10 的除外）
  //   上层：带 ☆ 的图块（在人物上面），按层的顺序最后画
  // data 读不到（地图外）= 0
  function drawSpot(ctx, sheets, flags, data, w, h, x, y, dx, dy, s) {
    const rd = (xx, yy, z) => (xx >= 0 && xx < w && yy >= 0 && yy < h ? data[(z * h + yy) * w + xx] || 0 : 0);
    const t0 = rd(x, y, 0), t1 = rd(x, y, 1), t2 = rd(x, y, 2), t3 = rd(x, y, 3), shadow = rd(x, y, 4), up1 = rd(x, y - 1, 1);
    const higher = id => !!(flags && (flags[id] & 0x10));
    const table = id => isA2(id) && !!(flags && (flags[id] & 0x80));
    const upper = [];
    const spot = id => { if (higher(id)) upper.push(id); else drawTile(ctx, sheets, id, dx, dy, s, flags); };
    spot(t0); spot(t1);
    drawShadow(ctx, shadow, dx, dy, s);
    if (table(up1) && !table(t1) && !isShadowingTile(t0)) drawTableEdge(ctx, sheets, up1, dx, dy, s);
    spot(t2); spot(t3);
    for (const id of upper) drawTile(ctx, sheets, id, dx, dy, s, flags);
  }
  // 调色板里的样子：地面用它的「单格」样子，墙和瀑布用两边都断开的样子
  function previewId(kindOrId) {
    if (kindOrId < ID.A1) return kindOrId;
    const kind = kindOf(kindOrId);
    const t = autoType(kind);
    return kindBase(kind) + (t === 'wall' ? 15 : t === 'waterfall' ? 3 : 47);
  }
  // 阴影：第 4 层的 4 个位 = 左上 / 右上 / 左下 / 右下
  function drawShadow(ctx, bits, dx, dy, s) {
    if (!(bits & 0x0f)) return;
    const q = s / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 4; i++) if (bits & (1 << i)) ctx.fillRect(dx + (i % 2) * q, dy + Math.floor(i / 2) * q, q, q);
  }

  // ---------- 自动元件接边 ----------
  // 某一格四个角各取哪一块：看上下左右和斜角的邻居是不是同一种（地图外面算同一种，跟 RPG Maker 一样）
  const FLOOR_INDEX = new Map(FLOOR.map((t, i) => [JSON.stringify(t), i]));
  function floorShape(same) {
    // same(dx, dy) → 邻居是不是同一种
    const U = same(0, -1), D = same(0, 1), L = same(-1, 0), R = same(1, 0);
    const q = (v, h, diag, center, inner, hEdge, vEdge, corner) => (v && h ? (diag ? center : inner) : (!v && h ? hEdge : v && !h ? vEdge : corner));
    const tl = q(U, L, same(-1, -1), [2, 4], [2, 0], [2, 2], [0, 4], [0, 2]);
    const tr = q(U, R, same(1, -1), [1, 4], [3, 0], [1, 2], [3, 4], [3, 2]);
    const bl = q(D, L, same(-1, 1), [2, 3], [2, 1], [2, 5], [0, 3], [0, 5]);
    const br = q(D, R, same(1, 1), [1, 3], [3, 1], [1, 5], [3, 3], [3, 5]);
    const k = FLOOR_INDEX.get(JSON.stringify([tl, tr, bl, br]));
    return k == null ? 0 : k;
  }
  const wallShape = same => (same(-1, 0) ? 0 : 1) | (same(0, -1) ? 0 : 2) | (same(1, 0) ? 0 : 4) | (same(0, 1) ? 0 : 8);
  const waterfallShape = same => (same(-1, 0) ? 0 : 1) | (same(1, 0) ? 0 : 2);

  // 按邻居重算 (x, y) 这一格、这一层的自动元件形状；不是自动元件就原样返回
  //   地面、瀑布：邻居是同一种就算连着；地图外面算连着（RPG Maker 也是这样）
  //   墙（A3、A4 的墙面）：规则拿一张实际游戏的 1900 多格现成墙对过（吻合 97.7%，其余是手工摆的）：
  //     上下：只有同一种墙才算连着；地图外面不算
  //     左右：地图外面不算；同一种墙要上下结构一样才算连着（一边下面还有墙、另一边没有，中间就有边）；
  //           A4 的天花板（墙顶）挨着墙：天花板上面也是天花板、并且这一列墙是挂在天花板下面的，才算连着
  //     A3：同一种，或者挨着自己的屋顶
  const isCeilingKind = k => typeof k === 'number' && k >= 80 && Math.floor(k / 8) % 2 === 0;
  function autoShapeAt(data, w, h, layer, x, y) {
    const i = (layer * h + y) * w + x;
    const id = data[i];
    if (!isAuto(id)) return id;
    const kind = kindOf(id);
    const t = autoType(kind);
    const kindAt = (ddx, ddy) => {
      const nx = x + ddx, ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return 'out';
      const n = data[(layer * h + ny) * w + nx];
      return isAuto(n) ? kindOf(n) : -1;
    };
    let same;
    if (t !== 'wall') same = (ddx, ddy) => { const n = kindAt(ddx, ddy); return n === 'out' || n === kind; };
    else if (kind < 80) same = (ddx, ddy) => { const n = kindAt(ddx, ddy); return n !== 'out' && (n === kind || (ddx !== 0 && kind % 16 >= 8 && n === kind - 8)); };
    else {
      const hangs = () => { let yy = -1; while (kindAt(0, yy) === kind) yy--; return isCeilingKind(kindAt(0, yy)); };
      same = (ddx, ddy) => {
        const n = kindAt(ddx, ddy);
        if (n === 'out') return false;
        if (ddy) return n === kind;
        if (n === kind) return (kindAt(ddx, -1) === kind) === (kindAt(0, -1) === kind) && (kindAt(ddx, 1) === kind) === (kindAt(0, 1) === kind);
        return isCeilingKind(n) && isCeilingKind(kindAt(ddx, -1)) && hangs();
      };
    }
    const shape = t === 'wall' ? wallShape(same) : t === 'waterfall' ? waterfallShape(same) : floorShape(same);
    return kindBase(kind) + shape;
  }
  // 改了一些格子之后：这些格子和周围一圈的自动元件都重算形状。返回 [[下标, 旧值, 新值], ...]
  function refreshAuto(data, w, h, cells) {
    const touched = new Set();
    const add = (nx, ny) => { if (nx >= 0 && ny >= 0 && nx < w && ny < h) touched.add(ny * w + nx); };
    const isA4WallAt = (nx, ny) => { for (let z = 0; z < 4; z++) { const v = data[(z * h + ny) * w + nx]; if (isA4(v) && autoType(kindOf(v)) === 'wall') return true; } return false; };
    for (const [x, y] of cells) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(x + dx, y + dy);
      // 墙要看「这一列是不是挂在天花板下面」：上面改了，下面整列墙（和它们左右的墙）都可能变
      for (let yy = y + 1; yy < h && isA4WallAt(x, yy); yy++) for (let dx = -1; dx <= 1; dx++) add(x + dx, yy);
    }
    const out = [];
    for (const c of touched) {
      const x = c % w, y = Math.floor(c / w);
      for (let layer = 0; layer < 4; layer++) {
        const i = (layer * h + y) * w + x;
        const v = autoShapeAt(data, w, h, layer, x, y);
        if (v !== data[i]) { out.push([i, data[i], v]); data[i] = v; }
      }
    }
    return out;
  }

  // ---------- 放一块图块（自动分层） ----------
  //   A 页（地面）：放在第 0 层；会清掉这一格 B~E 的东西（RPG Maker 也是这样）
  //   B~E：第 2 层空着就放第 2 层；否则放第 3 层（第 3 层原来的挪到第 2 层）
  //   layer 是 0~3 时：只写那一层
  // 返回 [[下标, 旧值, 新值], ...]
  function place(data, w, h, x, y, id, layer) {
    const at = z => (z * h + y) * w + x;
    const ch = [];
    const set = (z, v) => { const i = at(z); if (data[i] !== v) { ch.push([i, data[i], v]); data[i] = v; } };
    if (layer >= 0 && layer <= 3) set(layer, id);
    else if (id === 0) {
      // 自动分层的橡皮：先擦上层，上层没东西再擦地面
      if (data[at(3)] || data[at(2)]) { set(3, 0); set(2, 0); }
      else if (data[at(1)]) set(1, 0);
      else set(0, 0);
    } else if (isATile(id)) { set(0, id); set(2, 0); set(3, 0); }
    else {
      const l2 = data[at(2)], l3 = data[at(3)];
      if (l2 === id || l3 === id) return ch;
      if (!l2) set(2, id);
      else if (!l3) set(3, id);
      else { set(2, l3); set(3, id); }
    }
    return ch;
  }
  // 吸管：从上往下第一块不是空的
  function topTile(data, w, h, x, y) {
    for (let z = 3; z >= 0; z--) { const v = data[(z * h + y) * w + x]; if (v) return v; }
    return 0;
  }

  // ---------- 调色板 ----------
  // 页签 A：A1 2 行、A2 4 行、A3 4 行、A4 6 行、A5 16 行（每行 8 格；有图才显示）
  // 页签 B~E：8 列 × 32 行（图的左半边 16 行在前，右半边 16 行在后）
  function paletteTabs(names) {
    const has = i => !!(names && names[i]);
    const tabs = [];
    const a = [];
    const addKinds = (from, rows) => { for (let r = 0; r < rows; r++) for (let c = 0; c < 8; c++) a.push(kindBase(from + r * 8 + c)); };
    if (has(0)) addKinds(0, 2);
    if (has(1)) addKinds(16, 4);
    if (has(2)) addKinds(48, 4);
    if (has(3)) addKinds(80, 6);
    if (has(4)) for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) a.push(ID.A5 + r * 8 + c);
    if (a.length) tabs.push({ key: 'A', cells: a });
    ['B', 'C', 'D', 'E'].forEach((k, n) => {
      if (!has(5 + n)) return;
      const base = ID[k], cells = [];
      for (let r = 0; r < 32; r++) for (let c = 0; c < 8; c++) cells.push(base + (r < 16 ? r * 8 + c : 128 + (r - 16) * 8 + c));
      tabs.push({ key: k, cells });
    });
    return tabs;
  }

  return { T, ID, FLOOR, WALL, WATERFALL, drawSpot, drawTableEdge, isAuto, isA1, isA2, isA3, isA4, isA5, isATile, kindOf, shapeOf, kindBase, autoType, tableOf, drawTile, drawShadow, previewId, autoShapeAt, refreshAuto, place, topTile, paletteTabs, floorShape, wallShape };
});
