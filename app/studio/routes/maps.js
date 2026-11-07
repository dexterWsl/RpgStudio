'use strict';
// 地图：地图信息、图块编辑、新建 / 改属性 / 删除地图
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const Maps = require('../core/maps.js');
module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  function mapView(T, id) {
    const m = project.map(id);
    need(m, '地图 ' + id + ' 不存在');
    const info = project.mapList().find(x => x.id === id) || {};
    const events = (m.events || []).filter(Boolean).map(e => ({
      id: e.id, name: e.name, x: e.x, y: e.y,
      hint: hint(`map:${id}/ev:${e.id}`),
      pages: e.pages.map(pg => ({
        conditionText: T.describer.pageConditions(pg.conditions),
        trigger: pg.trigger,
        image: pg.image,
        lines: ctx.lineCount(pg.list),
        first: ctx.firstLine(pg.list),
      })),
    }));
    return {
      id, name: info.name || '', displayName: m.displayName || '', width: m.width, height: m.height,
      tileset: project.label('tileset', m.tilesetId), parallax: m.parallaxName || '', note: m.note || '',
      bgm: (m.autoplayBgm && m.bgm && m.bgm.name) || '',
      props: { name: info.name || '', displayName: m.displayName || '', width: m.width, height: m.height, tilesetId: m.tilesetId, autoplayBgm: !!m.autoplayBgm, bgmName: (m.bgm && m.bgm.name) || '', bgsName: (m.autoplayBgs && m.bgs && m.bgs.name) || '', parallaxName: m.parallaxName || '', note: m.note || '', parentId: info.parentId || 0 },
      children: project.mapList().filter(x => x.parentId === id).length,
      isStart: Number(project.sys().startMapId) === id,
      events,
    };
  }

  // ---------- 地图编辑 ----------
  function tilesetOf(id) {
    const ts = (project.read('Tilesets.json') || [])[id];
    return ts ? { id: ts.id, name: ts.name || '', mode: ts.mode || 0, names: (ts.tilesetNames || []).map(n => (n && String(n).trim()) || ''), flags: ts.flags || [] } : null;
  }
  function mapTiles(id) {
    const m = project.map(id);
    need(m, '地图 ' + id + ' 不存在');
    const ts = tilesetOf(m.tilesetId);
    const missing = ts ? ts.names.filter(n => n && !project.findImage('tilesets', n)) : [];
    const parallax = { name: m.parallaxName || '', show: !!m.parallaxShow, found: !!(m.parallaxName && project.findImage('parallaxes', m.parallaxName)) };
    return { id, width: m.width, height: m.height, data: m.data || [], hash: Maps.hashData(m.data), tileset: ts, missing, parallax };
  }
  const tilesetList = () => (project.read('Tilesets.json') || []).filter(t => t && t.id > 0).map(t => ({ id: t.id, name: t.name || '', mode: t.mode || 0, names: (t.tilesetNames || []).filter(Boolean).length }));
  const anyMapFile = () => { const m = project.mapList().find(x => x.hasFile); return m ? project.mapFile(m.id) : null; };

  Object.assign(V, { mapView, tilesetOf });
  return {
    get: {
      map: (T, q) => mapView(T, int(q('id'), '地图编号不对')),
      maptiles: (T, q) => mapTiles(int(q('id'), '地图编号不对')),
      tilesets: () => ({ tilesets: tilesetList() }),
    },
    post: {
    // 保存图块（整张地图的 data）。hash = 打开时的 data 摘要：别处改过就不覆盖
    'map/tiles'(T, b) {
      const id = int(b.map, '地图编号不对');
      const mf = project.mapFile(id);
      let hash = '';
      T.store.edit([mf], docs => {
        const m = docs[mf];
        need(m, '地图 ' + id + ' 不存在');
        need(Maps.hashData(m.data) === String(b.hash || ''), '这张地图在别处被改过（可能是另一个窗口或简单模式），刷新后再改');
        try { Maps.checkData(b.data, m.width, m.height); } catch (e) { throw new UserError(e.message); }
        m.data = b.data;
        hash = Maps.hashData(m.data);
      });
      return { hash };
    },
    'map/create'(T, b) {
      const name = String(b.name || '').trim().slice(0, 40);
      need(name, '给地图起个名字');
      const parentId = int(b.parentId || 0, '上级地图不对');
      const infos0 = project.read('MapInfos.json') || [];
      need(parentId === 0 || infos0[parentId], '上级地图不存在');
      let src = null;
      if (b.copyFrom != null) { src = project.map(int(b.copyFrom)); need(src, '要复制的地图不存在'); }
      const width = src ? src.width : int(b.width, '宽度不对'), height = src ? src.height : int(b.height, '高度不对');
      need(Maps.sizeOk(width, height), `大小要在 1~${Maps.MAX_SIZE} 之间`);
      const tilesetId = src ? src.tilesetId : int(b.tilesetId, '图块集不对');
      need(tilesetOf(tilesetId), '图块集 ' + tilesetId + ' 不存在');
      let id = infos0.findIndex((x, i) => i > 0 && !x && !project.exists(project.mapFile(i)));
      if (id < 0) id = Math.max(1, infos0.length);
      need(id <= 999, '地图最多 999 张');
      const mf = project.mapFile(id);
      T.store.edit(['MapInfos.json', mf], docs => {
        const infos = docs['MapInfos.json'];
        while (infos.length <= id) infos.push(null);
        const order = Math.max(0, ...infos.filter(Boolean).map(x => Number(x.order) || 0)) + 1;
        infos[id] = { id, expanded: false, name, order, parentId, scrollX: 0, scrollY: 0 };
        docs[mf] = src ? clone(src) : Maps.newMap({ width, height, tilesetId, displayName: String(b.displayName || '') });
      }, { create: [mf], styleOf: anyMapFile() });
      return { id };
    },
    'map/update'(T, b) {
      const id = int(b.map, '地图编号不对');
      const mf = project.mapFile(id);
      T.store.edit(['MapInfos.json', mf], docs => {
        const m = docs[mf], info = (docs['MapInfos.json'] || [])[id];
        need(m && info, '地图 ' + id + ' 不存在');
        if (b.name != null) { const n = String(b.name).trim().slice(0, 40); need(n, '名字不能为空'); info.name = n; }
        if (b.displayName != null) m.displayName = String(b.displayName).slice(0, 40);
        if (b.note != null) m.note = String(b.note).slice(0, 4000);
        if (b.parallaxName != null) m.parallaxName = String(b.parallaxName).slice(0, 200);
        if (b.bgmName != null) { m.bgm = { ...(m.bgm || { pan: 0, pitch: 100, volume: 90 }), name: String(b.bgmName).slice(0, 200) }; m.autoplayBgm = !!String(b.bgmName).trim(); }
        if (b.bgsName != null) { m.bgs = { ...(m.bgs || { pan: 0, pitch: 100, volume: 90 }), name: String(b.bgsName).slice(0, 200) }; m.autoplayBgs = !!String(b.bgsName).trim(); }
        if (b.tilesetId != null) { const t = int(b.tilesetId); need(tilesetOf(t), '图块集 ' + t + ' 不存在'); m.tilesetId = t; }
        if (b.width != null || b.height != null) {
          const w2 = int(b.width != null ? b.width : m.width, '宽度不对'), h2 = int(b.height != null ? b.height : m.height, '高度不对');
          need(Maps.sizeOk(w2, h2), `大小要在 1~${Maps.MAX_SIZE} 之间`);
          if (w2 !== m.width || h2 !== m.height) {
            const out = (m.events || []).filter(e => e && (e.x >= w2 || e.y >= h2));
            need(!out.length, '改小以后这些事件会在地图外面，先把它们挪进来：' + out.slice(0, 6).map(e => `事件 ${e.id}「${e.name}」(${e.x}, ${e.y})`).join('、'));
            m.data = Maps.resizeData(m.data || [], m.width, m.height, w2, h2);
            m.width = w2; m.height = h2;
          }
        }
      });
      return { view: mapView(tools(), id) };
    },
    'map/delete'(T, b) {
      const id = int(b.map, '地图编号不对');
      const mf = project.mapFile(id);
      need(!project.mapList().some(x => x.parentId === id), '这张地图下面还有子地图，先删掉或挪走它们');
      need(Number(project.sys().startMapId) !== id, '这是游戏开始时所在的地图，不能删');
      T.store.edit(['MapInfos.json', mf], docs => {
        need(docs['MapInfos.json'][id], '地图 ' + id + ' 不存在');
        docs['MapInfos.json'][id] = null;
        docs[mf] = undefined;
      }, { create: [mf] });
      return {};
    },
    },
  };
};
