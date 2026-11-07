'use strict';
// 游戏设置（System.json 里做游戏最常改的那些）：标题、开始位置、标题画面、菜单里有哪些项、系统音效、窗口色调、初始队伍
//   GET  system            现在的设置 + 能选的图 / 音乐 / 音效
//   POST system/update {…} 只改给了的字段
//   POST system/launcher    在游戏文件夹里放双击启动器（开始游戏.cmd，core/launcher.js）
const fs = require('fs');
const path = require('path');
const { need, int } = require('../lib/util.js');
const launcher = require('../core/launcher.js');

const MENU = ['物品', '技能', '装备', '状态', '整队', '保存'];
const SOUNDS = ['光标', '确定', '取消', '不行', '装备', '保存', '读档', '战斗开始', '逃跑', '敌人攻击', '敌人受伤', '敌人倒下', 'Boss 倒下 1', 'Boss 倒下 2', '角色受伤', '角色倒下', '回复', '没打中', '躲开', '魔法躲开', '魔法反射', '商店', '使用物品', '使用技能'];

module.exports = function (ctx) {
  const { project } = ctx;
  function audioList(sub) {
    const dir = path.join(project.gameRoot(), 'audio', sub);
    let names = [];
    try { names = fs.readdirSync(dir).filter(f => /\.(ogg|m4a|ogg_|m4a_|rpgmvo|rpgmvm)$/i.test(f)).map(f => f.replace(/\.[^.]+$/, '')); } catch { }
    return [...new Set(names)].sort();
  }
  function view() {
    const s = project.sys();
    return {
      title: s.gameTitle || '', locale: s.locale || '', currency: s.currencyUnit || '',
      start: { map: Number(s.startMapId) || 0, x: Number(s.startX) || 0, y: Number(s.startY) || 0 },
      title1: s.title1Name || '', title2: s.title2Name || '', titleBgm: (s.titleBgm && s.titleBgm.name) || '', drawTitle: s.optDrawTitle !== false,
      menu: MENU.map((label, i) => ({ label, on: (s.menuCommands || [])[i] !== false })),
      sounds: SOUNDS.slice(0, 4).map((label, i) => ({ label, name: ((s.sounds || [])[i] || {}).name || '' })),
      windowTone: (s.windowTone || [0, 0, 0, 0]).slice(0, 4),
      followers: !!s.optFollowers,
      party: (s.partyMembers || []).map(Number),
      maps: project.mapList().map(m => ({ id: m.id, name: m.name })),
      actors: project.rows('actor'),
      images: { titles1: project.listImages('titles1'), titles2: project.listImages('titles2') },
      audio: { bgm: audioList('bgm'), se: audioList('se') },
      launcher: launcher.has(project.gameRoot()),
    };
  }
  return {
    get: { system: () => view() },
    post: {
      'system/update'(T, b) {
        T.store.edit(['System.json'], docs => {
          const s = docs['System.json'];
          if (b.title != null) { const t = String(b.title).trim().slice(0, 60); need(t, '游戏名不能为空'); s.gameTitle = t; }
          if (b.currency != null) s.currencyUnit = String(b.currency).slice(0, 10);
          if (b.start) {
            const map = int(b.start.map, '开始地图不对'), x = int(b.start.x, '坐标不对'), y = int(b.start.y, '坐标不对');
            const m = project.map(map);
            need(m, '地图 ' + map + ' 不存在');
            need(x >= 0 && y >= 0 && x < m.width && y < m.height, `(${x}, ${y}) 在地图外面`);
            s.startMapId = map; s.startX = x; s.startY = y;
          }
          const img = (sub, n) => { n = String(n || ''); if (n) need(project.findImage(sub, n), '图「' + n + '」不在 img/' + sub + ' 里'); return n; };
          if (b.title1 != null) s.title1Name = img('titles1', b.title1);
          if (b.title2 != null) s.title2Name = img('titles2', b.title2);
          if (b.titleBgm != null) s.titleBgm = { name: String(b.titleBgm), pan: 0, pitch: 100, volume: 90 };
          if (b.drawTitle != null) s.optDrawTitle = !!b.drawTitle;
          if (Array.isArray(b.menu)) s.menuCommands = MENU.map((_, i) => b.menu[i] !== false);
          if (Array.isArray(b.sounds)) {
            s.sounds = s.sounds || [];
            b.sounds.slice(0, SOUNDS.length).forEach((n, i) => { if (n != null) s.sounds[i] = { name: String(n), pan: 0, pitch: 100, volume: 90 }; });
          }
          if (Array.isArray(b.windowTone)) s.windowTone = [0, 1, 2].map(i => Math.max(-255, Math.min(255, int(b.windowTone[i] || 0)))).concat([0]);
          if (b.followers != null) s.optFollowers = !!b.followers;
          if (Array.isArray(b.party)) {
            const p = b.party.map(x => int(x, '队伍成员不对'));
            for (const a of p) need(project.has('actor', a), '角色 ' + a + ' 不存在');
            need(p.length >= 1 && p.length <= 8, '队伍要有 1~8 个人');
            s.partyMembers = p;
          }
        });
        return { view: view() };
      },
      'system/launcher'() {
        const root = project.gameRoot();
        const r = launcher.write(root, { title: project.sys().gameTitle, nodePath: launcher.localNode() });
        return { ...r, cmd: path.join(root, launcher.CMD), view: view() };
      },
    },
  };
};
