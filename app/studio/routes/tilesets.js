'use strict';
// 图块集：新建 / 改名字、每页用哪张图、每一格的通行（○ 能走 / × 不能走 / ☆ 盖在人物上面）和其它标记
//   GET  tileset?id=            一个图块集的全部设置 + 能选的图（img/tilesets）
//   POST tileset/save { id, name, mode, names, flags, note }   id 不给 = 新建；flags 可以是完整数组，也可以是 { 编号: 值 } 只改几格
//   通行的值照 RPG Maker：低 4 位 = 下左右上不能走，0x10 = ☆，0x20 梯子、0x40 草丛、0x80 柜台、0x100 伤害地形
const { need, int, UserError } = require('../lib/util.js');

const SLOTS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];

module.exports = function (ctx) {
  const { project } = ctx;
  function view(id) {
    const ts = (project.read('Tilesets.json') || [])[id];
    need(ts, '图块集 ' + id + ' 不存在');
    const names = SLOTS.map((_, i) => String((ts.tilesetNames || [])[i] || ''));
    return {
      id, name: ts.name || '', mode: ts.mode || 0, note: ts.note || '', names, slots: SLOTS,
      missing: names.filter(n => n && !project.findImage('tilesets', n)),
      flags: Array.from({ length: 8192 }, (_, i) => Number((ts.flags || [])[i]) || 0),
      images: project.listImages('tilesets'),
      usedBy: project.mapList().filter(m => { try { return (project.map(m.id) || {}).tilesetId === id; } catch { return false; } }).map(m => ({ id: m.id, name: m.name })),
    };
  }
  return {
    get: {
      tileset: (T, q) => view(int(q('id'), '图块集编号不对')),
    },
    post: {
      'tileset/save'(T, b) {
        let id = b.id == null || b.id === '' || Number(b.id) === 0 ? 0 : int(b.id, '图块集编号不对');
        const names = b.names != null ? SLOTS.map((_, i) => String((b.names || [])[i] || '').trim()) : null;
        if (names) for (const n of names) if (n) need(project.findImage('tilesets', n), '图「' + n + '」不在 img/tilesets 里');
        T.store.edit(['Tilesets.json'], docs => {
          const arr = docs['Tilesets.json'];
          if (!id) {
            id = arr.findIndex((t, i) => i > 0 && !t);
            if (id < 0) { id = arr.length; arr.push(null); }
            need(id <= 999, '图块集最多 999 个');
            arr[id] = { id, flags: new Array(8192).fill(0), mode: 1, name: '', note: '', tilesetNames: SLOTS.map(() => '') };
            arr[id].flags[0] = 0x10;
          }
          const ts = arr[id];
          need(ts, '图块集 ' + id + ' 不存在');
          if (b.name != null) ts.name = String(b.name).trim().slice(0, 40);
          if (b.note != null) ts.note = String(b.note).slice(0, 2000);
          if (b.mode != null) { const m = int(b.mode); need([0, 1, 2].includes(m), '类型只能是 0 世界 / 1 区域 / 2 VX 兼容'); ts.mode = m; }
          if (names) ts.tilesetNames = names;
          if (b.flags != null) {
            const f = Array.isArray(ts.flags) ? ts.flags.slice() : new Array(8192).fill(0);
            while (f.length < 8192) f.push(0);
            const put = (k, v) => {
              const i = int(k, '图块编号不对'), n = int(v, '通行设置要是整数');
              need(i >= 0 && i < 8192, '图块编号要在 0~8191');
              need(n >= 0 && n <= 0xffff, '通行设置的值不对');
              f[i] = n;
            };
            if (Array.isArray(b.flags)) b.flags.forEach((v, i) => put(i, v));
            else if (typeof b.flags === 'object') for (const [k, v] of Object.entries(b.flags)) put(k, v);
            else throw new UserError('通行设置的格式不对');
            // 编号 0 = B 页左上角的「空」格子，所有没画东西的图层都是它：必须是 ☆（不影响通行），跟 RPG Maker 编辑器一样不让改
            //   不然它的「×」会盖到每一个空格子上，整张地图都走不了
            f[0] = 0x10;
            ts.flags = f;
          }
        });
        return { id, view: view(id) };
      },
    },
  };
};
