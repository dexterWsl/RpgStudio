#!/usr/bin/env node
'use strict';
// 打一个「下载下来双击就能用」的发布包：app/ + 自带的 Node.js + 两个 .cmd，压成一个 zip。
//
//   node tools/build-release.js                       用 app/version.json 里的版本号
//   node tools/build-release.js --version v2026.11.04 指定版本（开头的 v 会去掉）
//   node tools/build-release.js --runtime D:\runtime\node   不下载，直接用现成的 runtime\node
//   node tools/build-release.js --node 22.23.4 --mirror https://npmmirror.com/mirrors/node
//
// 产物：dist/rpgStudio-<版本>-win-x64.zip 和同名 .sha256
// 目录结构（解压后双击「启动.cmd」）：
//   rpgStudio-<版本>\{启动.cmd, 检查环境.cmd, 使用说明.txt, README.md, app\, runtime\node\node.exe}
//
// 只用 Node 自带的模块；读写 zip 复用编辑器自己的 core/zip.js（正好也是它的回归测试）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { listZip, extractEntry, writeZip } = require('../app/studio/core/zip.js');

const ROOT = path.resolve(__dirname, '..');
const NODE_VERSION = '22.23.4';
const TARGET = 'win-x64';
const KEEP_TOP = ['启动.cmd', '检查环境.cmd', '使用说明.txt'];
const KEEP_OPTIONAL = ['README.md', 'LICENSE'];

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = k => argv.includes(k);

const readVersion = () => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'version.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
};
const version = String(arg('--version', readVersion())).replace(/^v/i, '').trim() || readVersion();
const nodeVersion = String(arg('--node', NODE_VERSION)).replace(/^v/i, '');
const mirror = String(arg('--mirror', 'https://nodejs.org/dist')).replace(/\/+$/, '');
const outDir = path.resolve(arg('--out', path.join(ROOT, 'dist')));
const runtimeSrc = arg('--runtime', '');
const noRuntime = flag('--no-runtime');           // 轻量包：不带 node.exe，要求电脑上装了 Node.js 18+
const folderName = `rpgStudio-${version}`;
const stage = path.join(outDir, '.stage', folderName);
const zipName = `${folderName}-${noRuntime ? 'lite' : TARGET}.zip`;
const zipPath = path.join(outDir, zipName);

const say = m => console.log('  ' + m);
const step = m => console.log('\n' + m);
const mb = n => (n / 1048576).toFixed(1) + ' MB';

// ---------- 小工具 ----------
function copyTree(from, to, skip = /(^|[\\/])(\.git|node_modules|data|backups|dist)([\\/]|$)|\.tmp-|\.part-/) {
  let n = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (skip.test(e.name)) continue;
      if (e.isDirectory()) walk(s, d);
      else if (e.isFile()) { fs.copyFileSync(s, d); n++; }
    }
  };
  walk(from, to);
  return n;
}
function listTree(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listTree(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------- 1. 自带运行环境 ----------
async function getRuntime(dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (runtimeSrc) {
    step(`运行环境：用现成的 ${runtimeSrc}`);
    const exe = path.join(runtimeSrc, process.platform === 'win32' ? 'node.exe' : 'node');
    if (!fs.existsSync(exe)) throw new Error('这个目录里没有 node.exe：' + runtimeSrc);
    for (const f of fs.readdirSync(runtimeSrc)) {
      const s = path.join(runtimeSrc, f);
      if (fs.statSync(s).isFile() && /^(node|node\.exe|LICENSE|LICENSE\.txt)$/i.test(f)) fs.copyFileSync(s, path.join(dest, f));
    }
  } else {
    const base = `node-v${nodeVersion}-${TARGET}`;
    const url = `${mirror}/v${nodeVersion}/${base}.zip`;
    step(`运行环境：下载 Node.js v${nodeVersion}（${TARGET}）`);
    say(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}（换镜像用 --mirror，或用 --runtime 指定现成的 runtime\\node）`);
    const buf = Buffer.from(await res.arrayBuffer());
    say(`下载完成：${mb(buf.length)}`);
    const tmpZip = path.join(outDir, '.stage', `node-${nodeVersion}.zip`);
    fs.writeFileSync(tmpZip, buf);
    // 只解 node.exe 和 LICENSE，其它（npm / corepack / include…）发布版用不上
    const entries = listZip(tmpZip);
    const want = entries.filter(e => !e.dir && /^node-v[^/]+\/(node\.exe|LICENSE)$/i.test(e.name));
    if (!want.some(e => /node\.exe$/i.test(e.name))) throw new Error('压缩包里没有 node.exe');
    fs.mkdirSync(dest, { recursive: true });
    for (const e of want) await extractEntry(tmpZip, e, path.join(dest, path.basename(e.name)));
    fs.rmSync(tmpZip, { force: true });
  }
  const exe = path.join(dest, 'node.exe');
  if (!fs.existsSync(exe)) throw new Error('运行环境里没有 node.exe');
  say(`node.exe ${mb(fs.statSync(exe).size)}`);
}

// ---------- 2. 程序 + 说明 + 版本号 ----------
function getApp(dest) {
  step('程序文件：app/');
  const n = copyTree(path.join(ROOT, 'app'), path.join(dest, 'app'), /(^|[\\/])(data|backups|\.stage)([\\/]|$)|\.tmp-|\.part-/);
  say(`app/ 共 ${n} 个文件`);
  step('启动脚本和说明');
  for (const f of [...KEEP_TOP, ...KEEP_OPTIONAL]) {
    const s = path.join(ROOT, f);
    if (!fs.existsSync(s)) { if (KEEP_TOP.includes(f)) throw new Error('缺少 ' + f); continue; }
    fs.copyFileSync(s, path.join(dest, f));
    say(f);
  }
  if (!fs.existsSync(path.join(dest, 'LICENSE'))) say('（没有 LICENSE 文件，开源前记得补）');

  const vf = path.join(dest, 'app', 'version.json');
  const rtVer = noRuntime ? '' : (runtimeSrc ? targetRuntimeVersion() : 'v' + nodeVersion).replace(/^v/i, '');
  const info = {
    app: 'rpgStudio 本地版',
    version,
    commit: process.env.GITHUB_SHA || '',
    branch: process.env.GITHUB_REF_NAME || '',
    builtAt: new Date().toISOString(),
    runtime: noRuntime ? '系统安装的 Node.js（18 以上）' : `node v${rtVer}（${TARGET}，自带）`,
  };
  fs.writeFileSync(vf, JSON.stringify(info, null, 2) + '\n', 'utf8');
  say(`version.json → ${version}`);
  return info;
}
function targetRuntimeVersion() {
  try { return execFileSync(path.join(runtimeSrc, 'node.exe'), ['-v'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

// ---------- 3. 先自己体检一遍 ----------
function smokeTest(dir) {
  if (noRuntime) { step('自检：轻量包不带运行环境，跳过'); return; }
  const nose = path.join(dir, 'runtime', 'node', 'node.exe');
  if (process.platform !== 'win32' || !fs.existsSync(nose)) { step('自检：跳过（不是 Windows 或没有 node.exe）'); return; }
  step('自检：用打进去的 node 跑一遍「检查环境」');
  const data = path.join(outDir, '.stage', 'smoke-data');
  fs.rmSync(data, { recursive: true, force: true });
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const out = execFileSync(nose, [path.join(dir, 'app', 'start.js'), '--check', '--port', port], {
    encoding: 'utf8',
    env: { ...process.env, RPGSTUDIO_DATA: data },
  });
  for (const line of out.split(/\r?\n/).filter(l => /\[错\]/.test(l))) throw new Error('自检没通过：' + line.trim());
  say('通过（Node.js / 程序文件 / 数据目录 / 端口 全部正常）');
  fs.rmSync(data, { recursive: true, force: true });
}

// ---------- 4. 打包 ----------
function pack(dir) {
  step('打包');
  const files = listTree(dir);
  const entries = files.map(rel => ({ name: folderName + '/' + rel, data: fs.readFileSync(path.join(dir, rel)) }));
  const buf = writeZip(entries);
  fs.writeFileSync(zipPath, buf);
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(zipPath + '.sha256', `${sum}  ${zipName}\n`, 'utf8');
  say(`${zipName}  ${mb(buf.length)}  （${files.length} 个文件）`);
  say(`${zipName}.sha256`);
  say(`sha256 ${sum}`);
}

(async () => {
  console.log(`rpgStudio 发布包 · ${version} · ${noRuntime ? 'lite（不带运行环境）' : TARGET}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    if (!noRuntime) await getRuntime(path.join(stage, 'runtime', 'node'));
    getApp(stage);
    smokeTest(stage);
    if (!flag('--no-zip')) pack(stage);
    if (!flag('--keep-stage')) fs.rmSync(path.join(outDir, '.stage'), { recursive: true, force: true });
    console.log(`\n好了：${flag('--no-zip') ? stage : zipPath}`);
  } catch (e) {
    console.error('\n失败：' + (e && e.message || e));
    console.error('临时目录留在：' + stage);
    process.exitCode = 1;
  }
})();
