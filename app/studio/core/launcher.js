'use strict';
// 双击启动器：在游戏文件夹里放「开始游戏.cmd」+ js/rpgstudio_launcher.cjs，不开编辑器也能玩
//   双击 .cmd → 用 Node.js 在本机开一个只读的小网页服务器（只听 127.0.0.1）→ 有 Edge / Chrome 就开成单独的游戏窗口，没有就用默认浏览器。
//   Node.js 从这几处找：游戏文件夹里的 runtime\node、生成时 rpgStudio 本地版自带的那个、游戏在本地版 data\games\ 里时往上三层、电脑上装的。
//   端口按游戏编号（System.json 的 gameId）固定：存档在浏览器里，是按「地址 + 游戏编号」存的，端口不变存档才找得回来。
//   要发给没装 Node.js 的人：用 RPG Maker MZ 的「文件 → 部署」做成 Game.exe。
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const CMD = '开始游戏.cmd';
const SCRIPT = 'js/rpgstudio_launcher.cjs';

const scriptSource = () => `'use strict';
// rpgStudio 生成的双击启动器（第 ${VERSION} 版）：「开始游戏.cmd」调用这个文件
//   在本机开一个只读的小网页服务器（只听 127.0.0.1），用 Edge / Chrome 的单独窗口（没有就用默认浏览器）打开游戏
//   参数：--browser 用默认浏览器打开   --no-open 不自动打开   --port 8800 换端口（存档跟着端口走）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = k => args.includes(k);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.rpgmvp': 'application/octet-stream', '.rpgmvo': 'application/octet-stream', '.rpgmvm': 'application/octet-stream',
  '.png_': 'application/octet-stream', '.ogg_': 'application/octet-stream', '.m4a_': 'application/octet-stream',
};

let sys = {};
try { sys = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'System.json'), 'utf8')); } catch (e) {
  console.error('读不到 data\\\\System.json：这个文件要放在游戏文件夹的 js\\\\ 里。' + e.message);
  process.exit(1);
}
const title = sys.gameTitle || path.basename(ROOT);
const gameId = Number(sys.advanced && sys.advanced.gameId) || [...path.basename(ROOT)].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7);
const ID = 'rpgstudio-game:' + gameId;
const HEALTH = '/__rpgstudio_launcher';
const askPort = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 0;
const PORT = askPort > 0 && askPort < 65536 ? askPort : 8730 + (gameId % 200);

function serve(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\\/+/, ''); } catch { res.writeHead(400); res.end(); return; }
  if (rel === HEALTH.slice(1)) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(ID); return; }
  if (!rel) rel = 'index.html';
  const file = path.resolve(ROOT, rel);
  const inside = path.relative(ROOT, file);
  // 只发游戏文件：不出游戏文件夹，不发存档、备份、启动器自己
  if (!file.startsWith(ROOT + path.sep) || /(^|[\\\\/])(save|backups?|\\.git|runtime)([\\\\/]|$)/i.test(inside) || /\\.(cmd|cjs|bat|exe|dll)$/i.test(file)) { res.writeHead(404); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('没有这个文件：' + rel); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    const s = fs.createReadStream(file);
    s.on('error', () => res.destroy());
    s.pipe(res);
  });
}

// Edge / Chrome 的 --app 窗口：没有地址栏、标签页，看起来就是一个游戏窗口
function appBrowser() {
  if (process.platform !== 'win32') return null;
  const env = process.env;
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const rels = ['Microsoft\\\\Edge\\\\Application\\\\msedge.exe', 'Google\\\\Chrome\\\\Application\\\\chrome.exe'];
  for (const r of rels) for (const b of bases) { const f = path.join(b, r); if (fs.existsSync(f)) return f; }
  return null;
}
function open(url) {
  if (flag('--no-open')) return;
  const w = Number(sys.advanced && sys.advanced.screenWidth) || 816, h = Number(sys.advanced && sys.advanced.screenHeight) || 624;
  const exe = !flag('--browser') && appBrowser();
  if (exe) {
    try {
      const p = spawn(exe, ['--app=' + url, '--window-size=' + (w + 16) + ',' + (h + 39)], { detached: true, stdio: 'ignore' });
      p.on('error', () => openDefault(url));
      p.unref();
      return;
    } catch { }
  }
  openDefault(url);
}
function openDefault(url) {
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  exec(cmd, () => { });
}

function ready(port) {
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('');
  console.log('  《' + title + '》已经打开：' + url);
  console.log('  玩的时候别关这个黑窗口，关掉游戏就停了。存档在浏览器里，下次双击还在。');
  console.log('');
  open(url);
}

// 端口上已经开着这个游戏（又双击了一次）：直接再开一个窗口；是别的程序：报错
function already(port) {
  return new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port, path: HEALTH, timeout: 1500 }, x => {
      let s = '';
      x.on('data', d => { s += d; });
      x.on('end', () => res(s === ID));
    });
    r.on('error', () => res(false));
    r.on('timeout', () => { r.destroy(); res(false); });
  });
}

const server = http.createServer(serve);
server.on('error', async e => {
  if (e.code === 'EADDRINUSE' && await already(PORT)) { ready(PORT); setTimeout(() => process.exit(0), 300); return; }
  console.error('  启动不了：' + (e.code === 'EADDRINUSE' ? '端口 ' + PORT + ' 被别的程序占着。换一个：开始游戏.cmd --port 8800（换了端口，浏览器里的存档要重新开始）' : e.message));
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => ready(PORT));
`;

// 生成 .cmd（CRLF）：chcp 65001 之后的中文才不乱码，所以中文都放在 chcp 后面
function cmdSource(o = {}) {
  const tries = ['%~dp0runtime\\node\\node.exe'];
  if (o.nodePath && /\.exe$/i.test(o.nodePath)) tries.push(o.nodePath);
  tries.push('%~dp0..\\..\\..\\runtime\\node\\node.exe');      // 游戏在 rpgStudio 本地版的 data\games\ 里
  const title = String(o.title || '游戏').replace(/[%^&|<>"]/g, '');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `title ${title}`,
    'cd /d "%~dp0"',
    'set "NODE_EXE="',
    ...[...new Set(tries)].map(t => `if not defined NODE_EXE if exist "${t}" set "NODE_EXE=${t}"`),
    'if not defined NODE_EXE (where node >nul 2>nul && set "NODE_EXE=node")',
    'if not defined NODE_EXE goto nonode',
    `"%NODE_EXE%" "%~dp0${SCRIPT.replace(/\//g, '\\')}" %*`,
    'if errorlevel 1 pause',
    'endlocal',
    'goto :eof',
    ':nonode',
    'echo.',
    'echo 这台电脑上找不到 Node.js，开不了游戏。',
    'echo   自己玩：装 Node.js 18 以上（https://nodejs.org/），或者用 rpgStudio 打开这个游戏点「▶ 试玩」。',
    'echo   发给别人玩：用 RPG Maker MZ 打开 game.rmmzproject，「文件 → 部署」做成 Game.exe。',
    'echo.',
    'pause',
    'endlocal',
  ];
  return lines.join('\r\n') + '\r\n';
}

const has = root => fs.existsSync(path.join(root, CMD)) && fs.existsSync(path.join(root, SCRIPT));

// 写进游戏文件夹（内容一样就不动）；o.title 窗口标题，o.nodePath 生成时用的 node.exe
function write(root, o = {}) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('游戏文件夹里没有 index.html，不是能在浏览器里跑的 RPG Maker 游戏');
  const files = { [CMD]: cmdSource(o), [SCRIPT]: scriptSource() };
  const changed = [];
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    let old = null;
    try { old = fs.readFileSync(f, 'utf8'); } catch { }
    if (old === body) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body, 'utf8');
    changed.push(rel);
  }
  return { files: Object.keys(files), changed };
}

// 本地版自带的 node（runtime\node\node.exe）才写进 .cmd；电脑上装的 node 用 where 找得到，不用写死
const localNode = () => (process.platform === 'win32' && /runtime[\\/]node[\\/]node\.exe$/i.test(process.execPath) ? process.execPath : '');

module.exports = { VERSION, CMD, SCRIPT, has, write, localNode, cmdSource, scriptSource };
