'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { need } = require('../lib/util.js');

function installRuntimePlugin(root, backupsDir, { entry, source, backupPrefix }) {
  const listFile = path.join(root, 'js/plugins.js');
  if (!fs.existsSync(listFile)) return;
  const list = fs.readFileSync(listFile, 'utf8');
  const start = list.indexOf('['), end = list.lastIndexOf(']');
  let entries;
  try { entries = JSON.parse(list.slice(start, end + 1)); } catch { }
  need(Array.isArray(entries), '读不懂游戏的 js/plugins.js，无法启用「' + entry.description + '」。');
  const installed = entries.find(p => p && p.name === entry.name);
  let next = list;
  if (!installed) {
    next = list.slice(0, end).trimEnd() + (entries.length ? ',\n' : '\n') + JSON.stringify(entry) + '\n' + list.slice(end);
  } else if (!installed.status) {
    installed.status = true;
    next = list.slice(0, start) + '[\n' + entries.map(p => JSON.stringify(p)).join(',\n') + '\n' + list.slice(end);
  }

  const file = path.join(root, 'js/plugins', entry.name + '.js');
  const src = fs.readFileSync(source, 'utf8');
  const exists = fs.existsSync(file);
  const replace = !exists || fs.readFileSync(file, 'utf8') !== src;
  if (!replace && next === list) return;
  const backupRoot = path.resolve(backupsDir);
  fs.mkdirSync(backupRoot, { recursive: true });
  const backup = fs.mkdtempSync(path.join(backupRoot, backupPrefix + '-'));
  if (next !== list) fs.copyFileSync(listFile, path.join(backup, 'plugins.js'));
  if (replace && exists) fs.copyFileSync(file, path.join(backup, entry.name + '.js'));

  function write(file, text) {
    const tmp = file + '.tmp-' + process.pid;
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, file);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  // 插件文件先就绪，插件列表才启用它。
  if (replace) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    write(file, src);
  }
  if (next !== list) write(listFile, next);
}

module.exports = { installRuntimePlugin };
