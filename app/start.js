#!/usr/bin/env node
'use strict';
// rpgStudio 本地版：检查环境 → 启动编辑器 → 打开浏览器。没有登录，只在本机用（只听 127.0.0.1）
//   启动.cmd 会用自带的 runtime\node\node.exe 跑这个文件；也可以自己 node app/start.js
//   参数：<游戏文件夹>      直接改这个游戏（把游戏文件夹拖到「启动.cmd」上也是这个效果），保存前自动备份
//         --check           只检查环境，不启动
//         --port 8700       端口（被占用就往后找空的）
//         --no-open         不自动打开浏览器
//         --read-only       只读：能看不能改
// 数据都放在本地版文件夹的 data\ 里：导入的游戏（复制进来的）、工程设置、备份、导入素材的暂存
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const MIN_NODE = 18;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = k => args.includes(k);
const valued = new Set(['--port', '--host', '--profile']);
const loose = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.has(args[i - 1])));

// 本地版：app\start.js + app\studio\；在仓库里：local\start.js + studio\
const APP = __dirname;
const STUDIO = [path.join(APP, 'studio'), path.join(APP, '..', 'studio')].find(d => fs.existsSync(path.join(d, 'handler.js')));
const HOME = fs.existsSync(path.join(APP, 'studio')) ? path.resolve(APP, '..') : path.resolve(APP, '..', 'local-data');
const DATA = path.resolve(process.env.RPGSTUDIO_DATA || path.join(HOME, 'data'));

const ok = m => console.log('  [好] ' + m);
const bad = m => console.log('  [错] ' + m);
const note = m => console.log('       ' + m);

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(APP, 'version.json'), 'utf8')); } catch { return null; }
}
function portFree(port, host) {
  return new Promise(res => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, host);
  });
}
// 这个端口上是不是已经开着一个 rpgStudio（重复双击启动.cmd 时直接打开它）
function existing(port, host) {
  return new Promise(res => {
    const req = http.get({ host, port, path: '/api/studio/local', timeout: 1500 }, r => {
      let s = '';
      r.on('data', d => { s += d; });
      r.on('end', () => { try { const j = JSON.parse(s); res(j && j.app === 'rpgStudio' ? j : null); } catch { res(null); } });
    });
    req.on('error', () => res(null));
    req.on('timeout', () => { req.destroy(); res(null); });
  });
}
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => { });
}
function findGame(dir) {
  for (const sub of ['', 'www']) if (fs.existsSync(path.join(dir, sub, 'data', 'System.json'))) return true;
  return false;
}

async function main() {
  const ver = version();
  console.log('');
  console.log(`rpgStudio 本地版${ver ? '  ' + ver.version : ''}`);
  console.log('──────────────────────────────');
  console.log('检查环境：');
  let fail = false;
  // 1. Node.js
  const major = Number(process.versions.node.split('.')[0]);
  const bundled = /runtime[\\/]node[\\/]node(\.exe)?$/i.test(process.execPath);
  if (major >= MIN_NODE) ok(`Node.js ${process.versions.node}（${bundled ? '本地版自带' : '电脑上装的：' + process.execPath}）`);
  else { bad(`Node.js 版本太旧：${process.versions.node}，需要 ${MIN_NODE} 以上`); note('用本地版自带的 runtime\\node\\node.exe 启动（双击「启动.cmd」），或者升级电脑上的 Node.js'); fail = true; }
  // 2. 程序文件
  if (STUDIO) ok('程序文件齐全');
  else { bad('找不到程序文件 app\\studio\\handler.js'); note('本地版文件夹不完整，重新解压一份'); fail = true; }
  // 3. 数据文件夹能写
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const t = path.join(DATA, '.write-test-' + process.pid);
    fs.writeFileSync(t, 'ok'); fs.unlinkSync(t);
    ok('数据文件夹能写：' + DATA);
  } catch (e) {
    bad('数据文件夹写不进去：' + DATA + '（' + e.code + '）');
    note('别放在 C:\\Program Files 这类需要管理员权限的地方，换到 D 盘或桌面；或者文件夹是只读的');
    fail = true;
  }
  // 4. 指定的游戏
  let gameDir = '';
  if (loose[0]) {
    gameDir = path.resolve(loose[0]);
    if (findGame(gameDir)) ok('游戏：' + gameDir + '（直接改这个文件夹，保存前自动备份）');
    else { bad('这里不是 RPG Maker MV/MZ 游戏：' + gameDir); note('要有 data\\System.json（部署版是 www\\data\\System.json）'); fail = true; }
  }
  // 5. 端口
  const HOST = arg('--host', '127.0.0.1');
  const want = Number(arg('--port', process.env.RPGSTUDIO_PORT || 8700));
  let port = 0;
  const running = await existing(want, HOST);
  if (running && !flag('--check')) {
    ok(`已经有一个 rpgStudio 在 ${want} 端口运行，直接打开它`);
    const url = `http://${HOST}:${want}/studio`;
    if (!flag('--no-open')) openBrowser(url);
    console.log('\n  ' + url + '\n');
    return 0;
  }
  for (let p = want; p < want + 30; p++) if (await portFree(p, HOST)) { port = p; break; }
  if (port) ok(port === want ? `端口 ${port} 可以用` : `端口 ${want} 被占用，换成 ${port}`);
  else { bad(`端口 ${want}~${want + 29} 都被占用`); note('关掉占用端口的程序，或者用 --port 换一个'); fail = true; }
  ok(`系统：${os.type()} ${os.release()}（${process.arch}）`);

  if (fail) { console.log('\n有问题，没有启动。按上面的提示处理后再试。'); return 1; }
  if (flag('--check')) { console.log('\n环境没问题。双击「启动.cmd」就能用。'); return 0; }

  // ---------- 启动 ----------
  const { createStudio } = require(path.join(STUDIO, 'handler.js'));
  const tag = crypto.createHash('md5').update(gameDir || 'none').digest('hex').slice(0, 8);
  const studio = createStudio({
    gameDir: gameDir || undefined,
    profile: arg('--profile', ''),
    readOnly: flag('--read-only'),
    backupsDir: path.join(DATA, 'backups', (gameDir ? path.basename(gameDir) : 'none').replace(/[^\w\u4e00-\u9fff.-]+/g, '_') + '-' + tag),
    settingsFile: path.join(DATA, 'settings.json'),
    assetsDir: path.join(DATA, 'asset-staging'),
    projects: { dir: path.join(DATA, 'projects'), builtinName: gameDir ? '' : undefined, maxUpload: 8 * 1024 ** 3 },
    canConfigure: true,
    allowHosts: [HOST],
  });
  // 把游戏拖到启动.cmd 上 = 要改的就是它：切到它（上次导入的游戏还在列表里，随时能切回去）
  if (gameDir) { try { studio.registry.use('main'); } catch { } }
  const server = http.createServer(async (req, res) => {
    // 一个请求出错不能把整个服务带走
    try {
      const u = new URL(req.url, 'http://x');
      // 只给本机用：别的电脑连进来一律拒绝（防止误改成 0.0.0.0 以后被局域网里的人改游戏）
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!['127.0.0.1', '::1'].includes(ip)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('本地版只能在这台电脑上用'); }
      if (u.pathname === '/') { res.writeHead(302, { location: '/studio' }); return res.end(); }
      if (u.pathname === '/api/studio/local') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ app: 'rpgStudio', local: true, version: ver ? ver.version : '', data: DATA }));
      }
      if (await studio.handle(req, res, u)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('没有这个页面');
    } catch (e) {
      console.error('[studio] ' + req.method + ' ' + req.url + '\n' + (e && e.stack || e));
      try {
        if (!res.headersSent) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('请求不对'); }
        else res.end();
      } catch { }
    }
  });
  server.on('error', e => { console.error('\n启动失败：' + e.message); process.exit(1); });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/studio${gameDir ? '' : '#/projects'}`;
    console.log('──────────────────────────────');
    const cur = studio.registry.current();
    if (cur && fs.existsSync(path.join(studio.project.dataDir(), 'System.json'))) {
      const info = studio.project.info();
      console.log(`现在的游戏：${info.title}（${info.engine}${info.engineVersion ? ' ' + info.engineVersion : ''}）`);
    } else console.log('还没有游戏：打开后点「导入游戏」，选本机文件夹或者上传压缩包');
    console.log(`导入的游戏、设置、备份都在：${DATA}`);
    console.log('');
    console.log('  已经启动：' + url);
    console.log('');
    console.log('用完关掉这个窗口就停止（或者按 Ctrl+C）。');
    if (!flag('--no-open')) openBrowser(url);
  });
  const stop = () => { console.log('\n已停止。'); server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

main().then(code => { if (code != null) process.exitCode = code; }).catch(e => { console.error('\n出错了：' + (e && e.stack || e)); process.exitCode = 1; });
