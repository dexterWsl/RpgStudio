'use strict';
// 在浏览器里试玩当前游戏：/play/<工程编号>/ = 游戏文件夹（只读，只给 GET）
//   不用装 RPG Maker、不用 nw.js：MZ 本来就能在浏览器里跑，这里只是把游戏文件按网页的方式发出去。
//   多带一个小插件（不写进游戏，只在试玩时由服务器附加到 js/plugins.js 后面），认地址栏的参数：
//     ?new=1                      跳过标题，直接开始新游戏
//     ?map=3&x=5&y=8&d=2          从地图 3 的 (5, 8) 开始，朝向 d（2 下 4 左 6 右 8 上）
//     &v12=3&s5=1                 开始前把变量 12 设成 3、开关 5 打开（「从第 3 章开始试玩」就是这个）
//   存档在浏览器里（IndexedDB），跟游戏文件夹里的 save/ 不是一份。
const fs = require('fs');
const path = require('path');

const PLUGIN = 'RpgStudio_Playtest';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

const pluginSource = () => `//=============================================================================
// ${PLUGIN}.js（rpgStudio 试玩时临时附加，不在游戏文件夹里）
//=============================================================================
(() => {
  const q = new URLSearchParams(location.search);
  const num = k => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : null);
  const map = num('map');
  const vars = [], sws = [];
  for (const [k, v] of q) {
    let m;
    if ((m = /^v(\\d+)$/.exec(k))) vars.push([Number(m[1]), Number(v) || 0]);
    else if ((m = /^s(\\d+)$/.exec(k))) sws.push([Number(m[1]), /^(1|on|true)$/i.test(v)]);
  }
  if (map == null && q.get('new') !== '1') return;
  Scene_Boot.prototype.startNormalGame = function() {
    this.checkPlayerLocation();
    DataManager.setupNewGame();
    for (const [id, v] of vars) $gameVariables.setValue(id, v);
    for (const [id, on] of sws) $gameSwitches.setValue(id, on);
    const x = num('x'), y = num('y');
    if (map != null) $gamePlayer.reserveTransfer(map, x == null || x < 0 ? 0 : x, y == null || y < 0 ? 0 : y, num('d') || 2, 0);
    SceneManager.goto(Scene_Map);
  };
  // 没给坐标（-1）或者那一格站不了人：从地图中间往外找一格能走、没有事件的
  if (map != null && (num('x') == null || num('x') < 0)) {
    const _loaded = Scene_Map.prototype.onMapLoaded;
    let done = false;
    Scene_Map.prototype.onMapLoaded = function() {
      _loaded.call(this);
      if (done || $gameMap.mapId() !== map) return;
      done = true;
      const W = $gameMap.width(), H = $gameMap.height(), cx = W >> 1, cy = H >> 1;
      const ok = (x, y) => $gameMap.isValid(x, y) && [2, 4, 6, 8].some(d => $gameMap.isPassable(x, y, d)) && !$gameMap.eventsXy(x, y).length;
      for (let r = 0; r < Math.max(W, H); r++) for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (ok(xx, yy)) { $gamePlayer.locate(xx, yy); return; }
      }
    };
  }
})();
`;

function createPlaytest(o) {
  // o.root() = 游戏根目录（部署过的 MV 是 www/）；o.id() = 当前工程编号
  function serve(req, res, u) {
    const p = u.pathname;
    const m = /^\/play\/([^/]+)(\/.*)?$/.exec(p);
    if (!m) return false;
    const send = (code, type, body, extra) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache', ...(extra || {}) }); res.end(body); return true; };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', '只能看');
    if (decodeURIComponent(m[1]) !== o.id()) return send(409, 'text/html; charset=utf-8', '<meta charset="utf-8"><p style="font:16px sans-serif">编辑器已经切换到别的工程了，回编辑器重新点「试玩」。</p>');
    if (!m[2]) { res.writeHead(302, { location: p + '/' + (u.search || '') }); res.end(); return true; }
    let rel;
    try { rel = decodeURIComponent(m[2].slice(1)) || 'index.html'; } catch { return send(400, 'text/plain; charset=utf-8', '地址不对'); }
    const root = path.resolve(o.root());
    if (rel === 'js/plugins/' + PLUGIN + '.js') return send(200, MIME['.js'], pluginSource());
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || /(^|[\\/])(save|backups?|\.git)([\\/]|$)/i.test(path.relative(root, file))) return send(404, 'text/plain; charset=utf-8', '没有这个文件');
    let st;
    try { st = fs.statSync(file); } catch { return send(404, 'text/plain; charset=utf-8', '没有这个文件：' + rel); }
    if (!st.isFile()) return send(404, 'text/plain; charset=utf-8', '没有这个文件');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (rel === 'js/plugins.js') {
      // 游戏自己的插件列表后面加上试玩插件（只在发出去的这一份里加，文件不动）
      const src = fs.readFileSync(file, 'utf8');
      return send(200, type, src + `\n$plugins.push({ name: "${PLUGIN}", status: true, description: "rpgStudio 试玩", parameters: {} });\n`);
    }
    // 视频要能拖进度条：支持 Range
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) return send(416, 'text/plain', '', { 'content-range': `bytes */${st.size}` });
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(file, { start, end }).pipe(res);
      return true;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return { serve, PLUGIN };
}

module.exports = { createPlaytest, PLUGIN };
