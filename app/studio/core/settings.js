'use strict';
// 每个工程自己的设置（图片编号段、手动选的配置、剧情进度的分法……）
//   游戏文件夹里有 rpgstudio.json（用编辑器新建的游戏都有）：设置存在游戏里，挪文件夹、打包给别人都跟着走；
//   没有的（导入的别人的游戏）：存在编辑器自己的 settings.json，按游戏路径分开，不往别人的游戏里写东西
//
//   const S = createSettings({ project, file: () => 编辑器的 settings.json })
//   S.get()          这个工程现在的设置
//   S.save(patch)    合并进去（值是 null 的删掉）；读坏了就报错，不会当成空的覆盖掉
const fs = require('fs');
const path = require('path');
const { UserError } = require('../lib/util.js');

function readJson(f) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return null; }
  try { return JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new UserError(path.basename(f) + ' 不是合法的 JSON，先修好再改设置：' + e.message); }
}
// 先写临时文件再改名：写到一半断电也不会留下半个 JSON
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

function createSettings({ project, file }) {
  const settingsFile = () => (typeof file === 'function' ? file() : file);
  const gameFile = () => path.join(project.gameDir(), 'rpgstudio.json');
  const all = () => { try { return readJson(settingsFile()) || {}; } catch { return {}; } };
  const inGame = () => { try { const j = readJson(gameFile()); return j && typeof j === 'object' ? j : null; } catch { return null; } };

  function get() {
    const g = inGame();
    return g ? (g.settings || {}) : (all()[project.gameDir()] || {});
  }
  function save(patch) {
    const clean = o => { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };
    if (fs.existsSync(gameFile())) {
      const g = readJson(gameFile()) || {};
      g.settings = clean({ ...(g.settings || {}), ...patch });
      writeJson(gameFile(), g);
      return;
    }
    const f = settingsFile();
    if (!f) throw new UserError('没有地方存设置（启动时没给 settingsFile）');
    const a = readJson(f) || {};
    a[project.gameDir()] = clean({ ...(a[project.gameDir()] || {}), ...patch });
    writeJson(f, a);
  }
  return { get, save, gameFile };
}

module.exports = { createSettings, readJson, writeJson };
