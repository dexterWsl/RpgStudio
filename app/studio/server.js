#!/usr/bin/env node
'use strict';
// 通用剧情编辑器：单独启动（不需要别的编辑器、不需要云端）
//   node studio/server.js --project "D:\Games\我的游戏"            直接改游戏目录里的 data（每次保存前自动备份）
//   node studio/server.js --project <游戏目录> --data <工作副本/data> 改工作副本，不碰游戏本体
//   node studio/server.js                                          不指定也行：打开后在「工程」里导入游戏（压缩包 / 本机文件夹）
//   其它参数：--port 8700  --host 127.0.0.1  --profile generic|example  --read-only  --projects <导入的游戏放哪>
// 打开 http://127.0.0.1:8700/studio
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createStudio } = require('./handler.js');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = k => args.includes(k);

const project = arg('--project', process.env.STUDIO_PROJECT || '');
const gameDir = project ? path.resolve(project) : '';
const dataDir = arg('--data') ? path.resolve(arg('--data')) : '';
if (gameDir && !fs.existsSync(path.join(dataDir || path.join(gameDir, 'data'), 'System.json')) && !fs.existsSync(path.join(gameDir, 'www', 'data', 'System.json'))) {
  console.error('找不到 System.json：' + (dataDir || gameDir) + '\n要指向 RPG Maker MV/MZ 工程目录（里面有 data/ 文件夹）。');
  process.exit(1);
}
const PORT = Number(arg('--port', 8700));
const HOST = arg('--host', '127.0.0.1');
const ROOT = path.resolve(__dirname, '..');
const tag = crypto.createHash('md5').update(gameDir || 'none').digest('hex').slice(0, 8);

const studio = createStudio({
  gameDir: gameDir || undefined,
  dataDir: dataDir || undefined,
  profile: arg('--profile', ''),
  readOnly: flag('--read-only'),
  backupsDir: path.join(ROOT, 'backups', 'studio', (gameDir ? path.basename(gameDir) : 'none').replace(/[^\w\u4e00-\u9fff.-]+/g, '_') + '-' + tag),
  settingsFile: path.join(__dirname, 'data', 'settings.json'),
  // 导入的游戏（复制进来的）和工程列表放这里
  projects: { dir: path.resolve(arg('--projects', path.join(__dirname, 'data', 'projects'))), builtinName: gameDir ? '' : undefined },
  allowHosts: [HOST],
});

const server = http.createServer(async (req, res) => {
  // 一个请求出错不能把整个服务带走：没被 handle 内部兜住的异常在这里收尾
  try {
    // 只给本机用：别的电脑连进来一律拒绝（跟本地版 START 的规则保持一致）
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!['127.0.0.1', '::1'].includes(ip)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('只在本机用：别的电脑连不进来'); }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(302, { location: '/studio' }); return res.end(); }
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
server.listen(PORT, HOST, () => {
  const cur = studio.registry.current();
  if (cur && fs.existsSync(path.join(studio.project.dataDir(), 'System.json'))) {
    const info = studio.project.info();
    console.log(`rpgStudio：${info.title}（${info.engine}${info.engineVersion ? ' ' + info.engineVersion : ''}）`);
    console.log(`  数据：${info.dataDir}${cur.builtin && !dataDir ? '（直接改游戏目录，保存前自动备份到 backups/studio/）' : ''}`);
  } else console.log('rpgStudio：还没有工程，打开后点「导入游戏」');
  console.log(`  导入的游戏放在：${studio.registry.dir()}`);
  console.log(`  打开 http://${HOST}:${PORT}/studio`);
});
