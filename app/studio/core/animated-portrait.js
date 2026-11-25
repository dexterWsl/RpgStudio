'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { int, need } = require('../lib/util.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');
const layered = require('./layered-portrait.js');
const { parseRegion } = require('./portrait-region.js');

const KEY = 'rpgStudioAnimatedPortrait';
const ENTRY = { name: 'RpgStudio_AnimatedPortrait', status: true, description: 'rpgStudio 动态立绘', parameters: {} };
const PLUGIN_FILE = `js/plugins/${ENTRY.name}.js`;
const SOURCE = path.join(__dirname, '../web/animated-portrait-runtime.js');
const STATES = { idle: '待机', walk: '行走', attack: '攻击', hit: '受击' };
const REGION = { enabled: false, x: 68, y: 43, width: 30, height: 54 };
const FADE = { in: 0, out: 0 };
const DEFAULT = { enabled: false, mode: 'video', media: { idle: '', walk: '', attack: '', hit: '' }, model: '', motions: { idle: '', walk: '', attack: '', hit: '' },
  layeredActor: 0, layeredFaces: {}, width: 30, scale: 50, position: 'bottom' };
function profileOf(system) {
  const profile = system?.[KEY];
  return { ...DEFAULT, ...profile, region: { ...REGION, ...profile?.region }, fade: { ...FADE, ...profile?.fade } };
}
const used = system => system?.[KEY]?.enabled === true;

function clipsOf(project) {
  const clips = [], root = path.join(project.gameRoot(), 'movies');
  function scan(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 5) scan(file, depth + 1);
      if (!entry.isFile() || !/\.(webm|mp4)$/i.test(entry.name)) continue;
      try { clips.push({ name: path.relative(root, file).split(path.sep).join('/'), bytes: fs.statSync(file).size }); } catch { }
    }
  }
  scan(root, 0);
  return clips.sort((a, b) => a.name.localeCompare(b.name));
}

function modelsOf(project) {
  const plugin = project.plugin('PictureLive2D');
  if (!plugin) return [];
  let list;
  try { list = JSON.parse(plugin.parameters?.['json file'] || '[]'); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const folder = path.join(project.gameRoot(), 'img', 'live2d'), models = [];
  for (const raw of list) {
    const id = String(raw).replace(/\.(?:model3\.json|json)$/i, '').replace(/\\/g, '/');
    if (!id || path.isAbsolute(id) || id.split('/').some(part => part === '..' || part === '.') || /[<>:"|?*\x00-\x1f]/.test(id)) continue;
    try {
      const file = path.join(folder, id + '.model3.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const motions = Object.entries(data.FileReferences?.Motions || {}).flatMap(([group, values]) => (Array.isArray(values) ? values : []).map((motion, index) =>
        motion.Name || group + String(index + 1).padStart(2, '0')));
      models.push({ id, motions: [...new Set(motions)] });
    } catch { }
  }
  return models;
}

function parseProfile(b, project) {
  need(typeof b.enabled === 'boolean', '请选择是否启用动态立绘');
  const { mode, position } = b;
  need(['video', 'live2d', 'layered'].includes(mode), '请选择素材类型');
  need(position === 'top' || position === 'bottom', '请选择显示位置');
  const width = int(b.width, '宽度要填整数'), scale = int(b.scale, '模型比例要填整数');
  need(width >= 15 && width <= 55 && scale >= 10 && scale <= 200, '视频宽度为 15～55%，模型比例为 10～200%');
  const existing = profileOf(project.sys());
  const region = parseRegion(b.region === undefined ? existing.region : b.region);
  const fade = parseFade(b.fade === undefined ? existing.fade : b.fade);
  const model = mode === 'live2d' ? String(b.model || '') : '';
  const media = Object.fromEntries(Object.keys(STATES).map(state => [state, mode === 'video' ? String(b.media?.[state] || '') : '']));
  const motions = Object.fromEntries(Object.keys(STATES).map(state => [state, mode === 'live2d' ? String(b.motions?.[state] || '') : '']));
  const layeredActor = mode === 'layered' ? int(b.layeredActor ?? 0, '请选择使用的分层立绘') : 0;
  const layeredFaces = Object.fromEntries(Object.keys(STATES).map(state => [state, mode === 'layered' && layeredActor ? String(b.layeredFaces?.[state] || '') : '']));
  if (b.enabled && mode === 'video') {
    const available = new Set(clipsOf(project).map(clip => clip.name));
    need(media.idle && Object.values(media).every(name => !name || available.has(name)), '请为待机选择一个现有视频，其他状态也须使用工程中的视频');
  }
  if (b.enabled && mode === 'live2d') {
    const found = modelsOf(project).find(value => value.id === model);
    need(found && motions.idle && Object.values(motions).every(name => !name || found.motions.includes(name)), '请选择工程已有的 PictureLive2D 模型和待机动作');
  }
  if (b.enabled && mode === 'layered') {
    const rigs = layered.choices(project), selected = rigs.find(rig => rig.id === layeredActor);
    need(layeredActor ? selected : rigs.length, '请先在人物页制作一套分层立绘，再选择要显示的人物');
    need(Object.values(layeredFaces).every(face => !face || selected?.faces.includes(face)), '请选择人物已有的表情');
  }
  return { enabled: b.enabled, mode, media, model, motions, layeredActor, layeredFaces, width, scale, position, region, fade };
}

function parseFade(value) {
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10;
  need(valid(value?.in) && valid(value?.out), '淡入和淡出时间要在 0～10 秒之间');
  return { in: value.in, out: value.out };
}

function setEnabled(ctx, enabled) { ensureRuntimePlugin(ctx, { ENTRY: { ...ENTRY, status: enabled }, SOURCE }); }

module.exports = { KEY, ENTRY, SOURCE, PLUGIN_FILE, STATES, profileOf, used, clipsOf, modelsOf, parseProfile, setEnabled };
