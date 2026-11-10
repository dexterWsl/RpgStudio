'use strict';
// 插件指令（MZ 的 357 指令）：从 js/plugins/<插件名>.js 的注释头里读参数表，让编辑框能直接写插件的指令。
//
//   #插件 VisuMZ_2_VNPictureBusts Basic_ExitBusts（["50"]，-200）
//   #插件 VisuMZ_2_VNPictureBusts Basic_GraphicChange（50，standing images/Saya_standing_nervous）
//   #插件 Art_MultiBgs stop
//
// 参数按插件里写的顺序一个一行（全角「，」分开，括号里写不下可以写逗号）；没写的用插件里的 @default。
// 生成的是「插件指令」(357) + 每个参数一行续行 (657)，和 RPG Maker 编辑器里看到的一样。
//
// 只有「生成回去和原来一模一样」的指令才用 #插件 显示（见 lineOf）；对不上的（插件里没写参数表、
// 显示文字不一样、参数里有换行……）还是照旧显示成 ■（只读）。
const fs = require('fs');
const path = require('path');

const RE_COMMAND = /^@command\s+(\S+)/;
const RE_ARG = /^@arg\s+(\S+)/;
const RE_TEXT = /^@text\s+(.*)$/;
const RE_DEFAULT = /^@default\s+(.*)$/;

// 插件注释头里的参数表：@command 名字 / @text 显示名 / @arg 参数键 / @text 参数名 / @default 默认值
//   → Map(指令名 → { text: 显示名, args: [{ key, label, def }] })
function parseHeader(text) {
  const cmds = new Map();
  let cur = null;
  let arg = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^\s*\*\s?(.*)$/.exec(raw);
    if (!m) continue;
    const s = m[1].trim();
    let x;
    if ((x = RE_COMMAND.exec(s))) { cur = { text: '', args: [] }; cmds.set(x[1], cur); arg = null; continue; }
    if (!cur) continue;
    if ((x = RE_ARG.exec(s))) { arg = { key: x[1], label: x[1], def: null }; cur.args.push(arg); continue; }
    if ((x = RE_TEXT.exec(s))) {
      if (arg) arg.label = x[1].trim() || arg.key;
      else cur.text = x[1].trim();
      continue;
    }
    if ((x = RE_DEFAULT.exec(s))) { if (arg) arg.def = x[1].trim(); continue; }
  }
  return cmds;
}

// 括号里的参数：全角「，」或半角逗号分开；引号、方括号、圆括号里的逗号不算
function splitValues(body) {
  const s = String(body || '').trim();
  if (!s) return [];
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('([{（【'.includes(ch)) { depth++; cur += ch; continue; }
    if (')]}）】'.includes(ch)) { depth--; cur += ch; continue; }
    if ((ch === '，' || ch === ',') && depth <= 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const fileCache = new Map();   // 插件文件 → { key: 修改时间+大小, cmds }

function createPluginArgs(project, opts = {}) {
  const mz = opts.mz !== false;   // MV 的插件指令是一行自由文本（356），这里先只管 MZ

  function schemaOf(plugin) {
    if (!mz) return null;
    const name = String(plugin || '');
    if (!name || name.includes('..') || /[\\/:]/.test(name)) return null;
    let file;
    try { file = path.join(project.gameRoot(), 'js', 'plugins', name + '.js'); } catch { return null; }
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const key = st.mtimeMs + ':' + st.size;
    const hit = fileCache.get(file);
    if (hit && hit.key === key) return hit.cmds;
    let cmds = null;
    try { cmds = parseHeader(fs.readFileSync(file, 'utf8')); } catch { cmds = null; }
    fileCache.set(file, { key, cmds });
    return cmds;
  }

  // 插件名打错（少写了前缀之类）：列几个像的
  function nearPlugin(name) {
    try {
      const dir = path.join(project.gameRoot(), 'js', 'plugins');
      const q = String(name || '').toLowerCase();
      const near = fs.readdirSync(dir).filter(f => /\.js$/i.test(f)).map(f => f.replace(/\.js$/i, '')).filter(n => n.toLowerCase().includes(q) || q.includes(n.toLowerCase())).slice(0, 3);
      return near.length ? '。是不是：' + near.join(' / ') : '';
    } catch { return ''; }
  }

  const specOf = (plugin, cmd) => {
    const cmds = schemaOf(plugin);
    return cmds ? cmds.get(String(cmd || '')) || null : null;
  };

  // 写法 → 片段：值按参数表顺序（没写的用 @default）
  function item(plugin, cmd, rest) {
    const spec = specOf(plugin, cmd);
    if (!spec) {
      const cmds = schemaOf(plugin);
      if (!cmds) throw new Error('找不到插件 js/plugins/' + plugin + '.js（「#插件」要读它的参数表）' + nearPlugin(plugin));
      const near = [...cmds.keys()].filter(k => k.toLowerCase().includes(String(cmd).toLowerCase()) || String(cmd).toLowerCase().includes(k.toLowerCase())).slice(0, 3);
      throw new Error('插件 ' + plugin + ' 里没有「' + cmd + '」的参数表（@command），这个指令只能用 ■ 显示，不能在编辑框里写' + (near.length ? '。是不是：' + near.join(' / ') : ''));
    }
    const s = String(rest || '').trim();
    let values = [];
    if (s) {
      const m = /^[（(]([\s\S]*)[）)]$/.exec(s);
      if (!m) throw new Error('「#插件」的参数要写在括号里：' + '#插件 ' + plugin + ' ' + cmd + '（值1，值2）');
      values = splitValues(m[1]);
    }
    if (values.length > spec.args.length) {
      throw new Error('「#插件 ' + plugin + ' ' + cmd + '」只有 ' + spec.args.length + ' 个参数：' + spec.args.map(a => a.label).join('，'));
    }
    return { type: 'plugin', plugin, cmd, values };
  }

  // 片段 → 指令：357 + 每个参数一行 657
  function commandsOf(it) {
    const spec = specOf(it.plugin, it.cmd);
    if (!spec) throw new Error('找不到插件指令的参数表：' + it.plugin + ' ' + it.cmd);
    const values = spec.args.map((a, i) => {
      const v = it.values[i];
      return v === undefined || v === '' ? (a.def == null ? '' : a.def) : v;
    });
    const args = {};
    spec.args.forEach((a, i) => { args[a.key] = values[i]; });
    return [
      { code: 357, indent: 0, parameters: [it.plugin, it.cmd, spec.text || '', args] },
      ...spec.args.map((a, i) => ({ code: 657, indent: 0, parameters: [a.label + ' = ' + values[i]] })),
    ];
  }

  // 指令 → 编辑框那一行；生成回去对不上就返回空（照旧显示成 ■）
  // 同一条指令会被问好几次（能不能编辑、怎么显示、合并时再核一遍），按对象记一下
  const lineCache = new WeakMap();
  function lineOf(c) {
    if (!mz || !c || c.code !== 357) return '';
    if (lineCache.has(c)) return lineCache.get(c);
    const line = computeLine(c);
    lineCache.set(c, line);
    return line;
  }
  function computeLine(c) {
    const p = c.parameters || [];
    const plugin = String(p[0] || '');
    const cmd = String(p[1] || '');
    const spec = specOf(plugin, cmd);
    if (!spec) return '';
    const args = p[3];
    if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
    const keys = spec.args.map(a => a.key);
    if (Object.keys(args).some(k => !keys.includes(k))) return '';
    const values = [];
    for (const k of keys) {
      if (!(k in args)) return '';
      const v = String(args[k]);
      if (!v || /[\r\n]/.test(v) || v !== v.trim()) return '';
      values.push(v);
    }
    if ((spec.text || '') !== String(p[2] == null ? '' : p[2])) return '';
    const line = '#插件 ' + plugin + ' ' + cmd + (keys.length ? '（' + values.join('，') + '）' : '');
    // 再解析 / 生成一次，必须和原指令一模一样
    let back;
    try { back = commandsOf(item(plugin, cmd, keys.length ? '（' + values.join('，') + '）' : '')); } catch { return ''; }
    if (back.length !== 1 + keys.length) return '';
    const same = (a, b) => JSON.stringify([a.code, a.parameters]) === JSON.stringify([b.code, b.parameters]);
    if (!same(back[0], c)) return '';
    return line;
  }

  const can = c => !!lineOf(c);
  return { schemaOf, specOf, item, commandsOf, lineOf, can };
}

module.exports = { createPluginArgs, parseHeader, splitValues };
