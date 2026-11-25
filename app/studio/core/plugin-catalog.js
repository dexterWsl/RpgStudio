'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseHeader } = require('./pluginargs.js');

const LEGACY = '@legacy';
const keyOf = name => String(name || '').replace(/\.js$/i, '').replace(/\\/g, '/');
const within = (root, file) => { const rel = path.relative(root, file); return !!rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

function pluginFiles(project) {
  const root = path.join(project.gameRoot(), 'js', 'plugins'), files = new Map();
  function scan(dir, depth) {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of list) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) scan(file, depth + 1);
      if (entry.isFile() && /\.js$/i.test(entry.name) && within(root, file)) files.set(keyOf(path.relative(root, file)), file);
    }
  }
  scan(root, 0);
  return files;
}

function readMetadata(source) {
  const headers = [...source.matchAll(/\/\*:(?:[\w-]+)?[\s\S]*?\*\//g)].map(match => match[0]);
  const commands = new Map();
  for (const header of headers) for (const [id, spec] of parseHeader(header)) if (!commands.has(id)) commands.set(id, { ...spec, declaration: 'header' });
  for (const match of source.matchAll(/\bPluginManager\s*\.\s*registerCommand\s*\(\s*(?:[\w.$]+|["'][^"'\r\n]+["'])\s*,\s*(["'])([^"'\r\n]+)\1/g)) {
    if (!commands.has(match[2])) commands.set(match[2], { text: '', args: [], declaration: 'registration' });
  }
  const description = headers.map(doc => /^\s*\*\s*@plugindesc\s+(.+)$/m.exec(doc)?.[1]?.trim()).find(Boolean) || '';
  return { description, commands };
}

function usages(project, each) {
  const configured = new Set(project.plugins().map(x => keyOf(x.name)));
  return project.memoize('plugin-market-usage:' + [...configured].join('|'), () => {
    const index = new Map();
    const add = (plugin, id, label, at, line, kind) => {
      if (!plugin || !id) return;
      const key = keyOf(plugin);
      if (!index.has(key)) index.set(key, new Map());
      const group = index.get(key), ref = group.get(id) || { id, text: label || id, count: 0, kinds: [], refs: [] };
      if (!ref.kinds.includes(kind)) ref.kinds.push(kind);
      ref.count++;
      if (ref.refs.length < 100) ref.refs.push({ at, line });
      group.set(id, ref);
    };
    each((at, list) => {
      for (let i = 0; i < list.length; i++) {
        const c = list[i], p = c?.parameters || [];
        if (c?.code === 357) {
          add(p[0], p[1], p[2], at, i, 'MZ');
        } else if (c?.code === 356) {
          const [name, sub] = String(p[0] || '').trim().split(/\s+/);
          if (configured.has(keyOf(name))) add(name, sub || name, '', at, i, 'MV');
          else add(LEGACY, name, '', at, i, 'MV');
        } else if (c?.code === 355 && configured.has('PictureLive2D')) {
          const line = i, lines = [String(p[0] || '')];
          while (list[i + 1]?.code === 655) lines.push(String(list[++i].parameters?.[0] || ''));
          const script = lines.join('\n');
          if (!/\$gameScreen\s*\.\s*live2d\s*\(|new\s+Game_Live2D\s*\(/.test(script)) continue;
          for (const match of script.matchAll(/\.\s*(live2d|setModel|setAnimation|clearAnimation|setExpression|setVisible|setScale|setOffset|setMix)\s*\(/g)) add('PictureLive2D', 'script:' + match[1], match[1], at, line, '脚本');
        }
      }
    });
    return index;
  });
}

function catalog(project, each) {
  const calls = usages(project, each), files = pluginFiles(project), registered = new Map();
  for (const [order, info] of project.plugins().entries()) registered.set(keyOf(info.name), { ...info, order });
  return [...new Set([...registered.keys(), ...files.keys(), ...calls.keys()])].map(key => {
    const entry = registered.get(key), used = calls.get(key), file = files.get(key);
    return { key, name: entry?.name || (key === LEGACY ? '未归属的 MV 指令' : key), description: entry?.description || '',
      status: entry ? (entry.status === false ? 'off' : 'on') : (file ? 'unregistered' : 'missing'),
      file: !!file, order: entry?.order ?? null, uses: used ? [...used.values()].reduce((sum, command) => sum + command.count, 0) : 0 };
  });
}

function details(project, each, key) {
  const record = catalog(project, each).find(row => row.key === key);
  if (!record) return null;
  const file = pluginFiles(project).get(key);
  let meta = { description: '', commands: new Map() };
  if (file) {
    try { meta = readMetadata(fs.readFileSync(file, 'utf8')); } catch { }
  }
  const used = usages(project, each).get(key) || new Map();
  const commands = [...new Set([...meta.commands.keys(), ...used.keys()])].map(id => {
    const schema = meta.commands.get(id), use = used.get(id);
    return { id, text: schema?.text || use?.text || id, args: schema?.args || [], declaration: schema?.declaration || '',
      count: use?.count || 0, kinds: use?.kinds || [], refs: use?.refs || [] };
  });
  return { ...record, description: record.description || meta.description, commands };
}

module.exports = { catalog, details, readMetadata };
