'use strict';
// 地图：地图信息、图块编辑、新建 / 改属性 / 删除地图
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, UserError } = require('../lib/util.js');
const Maps = require('../core/maps.js');
const Effects = require('../core/map-effects.js');
const marks = require('../core/marks.js');
module.exports = function (ctx) {
  const { project, hint, tools, backupsDir } = ctx;
  const V = ctx.views;
  const ensureEffects = () => { if (!ctx.workDataDir()) Effects.ensure(project.gameRoot(), backupsDir()); };
  const terrainOf = m => Effects.readTerrain(m.note, m.width, m.height);
  const mapHash = (m, terrain) => Maps.hashData([m.width, m.height, m.data, terrain]);
  const sameWeather = (a, b) => b && a.type === b.type && a.power === b.power && a.frames === b.frames;
  function mapView(T, id) {
    const m = project.map(id);
    need(m, '地图 ' + id + ' 不存在');
    const info = project.mapList().find(x => x.id === id) || {};
    const note = Effects.mapNote(m.note);
    const events = (m.events || []).filter(Boolean).map(e => ({
      id: e.id, name: e.name, x: e.x, y: e.y,
      hint: hint(`map:${id}/ev:${e.id}`),
      pages: e.pages.map(pg => ({
        conditionText: T.describer.pageConditions(pg.conditions),
        trigger: pg.trigger,
        image: pg.image,
        mark: marks.get(pg.list),
        lines: ctx.lineCount(pg.list),
        first: ctx.firstLine(pg.list),
      })),
    }));
    return {
      id, name: info.name || '', displayName: m.displayName || '', width: m.width, height: m.height,
      tileset: project.label('tileset', m.tilesetId), parallax: m.parallaxName || '', note,
      weather: Effects.readWeather(m.note),
      bgm: (m.autoplayBgm && m.bgm && m.bgm.name) || '',
      props: { name: info.name || '', displayName: m.displayName || '', width: m.width, height: m.height, tilesetId: m.tilesetId, autoplayBgm: !!m.autoplayBgm, bgmName: (m.bgm && m.bgm.name) || '', bgsName: (m.autoplayBgs && m.bgs && m.bgs.name) || '', parallaxName: m.parallaxName || '', note, parentId: info.parentId || 0 },
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
    const terrain = terrainOf(m);
    return { id, width: m.width, height: m.height, data: m.data || [], terrain, hash: mapHash(m, terrain), tileset: ts, missing, parallax, scrollType: m.scrollType || 0 };
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
    // 图块、区域和高低层共用一次保存；摘要用于防止覆盖别处的修改。
    'map/tiles'(T, b) {
      const id = int(b.map, '地图编号不对');
      const mf = project.mapFile(id);
      let hash = '';
      T.store.edit([mf], docs => {
        const m = docs[mf];
        need(m, '地图 ' + id + ' 不存在');
        const previous = terrainOf(m);
        need(mapHash(m, previous) === String(b.hash || ''), '地图的图块、区域或高低差已在别处修改，刷新后再改');
        try { Maps.checkData(b.data, m.width, m.height); } catch (e) { throw new UserError(e.message); }
        let terrain = previous;
        if (b.terrain !== undefined) {
          need(Array.isArray(b.terrain) && b.terrain.length === m.width * m.height && b.terrain.every(Effects.validCell), '高低层的格数或取值不对');
          terrain = b.terrain.some(Boolean) ? b.terrain : [];
          if (JSON.stringify(terrain) !== JSON.stringify(previous)) m.note = Effects.writeTerrain(m.note, m.width, terrain);
          if (terrain.length) ensureEffects();
        }
        m.data = b.data;
        hash = mapHash(m, terrain);
      });
      return { hash };
    },
    'map/weather'(T, b) {
      const id = int(b.map, '地图编号不对');
      const w = b.weather;
      need(w && Effects.WEATHER_TYPES.includes(w.type), '天气类型不对');
      need(Number.isInteger(w.power) && w.power >= 1 && w.power <= 9, '天气强度要在 1~9 之间');
      need(Number.isInteger(w.frames) && w.frames >= 0 && w.frames <= 600, '过渡时间要在 0~10 秒之间');
      const weather = w.type === 'inherit' ? Effects.readWeather('') : { type: w.type, power: w.power, frames: w.frames };
      const mf = project.mapFile(id);
      T.store.edit([mf], docs => {
        const m = docs[mf];
        need(m, '地图 ' + id + ' 不存在');
        const previous = Effects.readWeather(m.note);
        const unchanged = sameWeather(previous, weather);
        need(unchanged || sameWeather(previous, b.previous), '这张地图的天气已在别处修改，刷新后再改');
        if (weather.type !== 'inherit') ensureEffects();
        if (!unchanged) m.note = Effects.writeWeather(m.note, weather);
      });
      return { weather };
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
        if (b.note != null && b.note !== Effects.mapNote(m.note)) m.note = Effects.writeMapNote(m.note, String(b.note).slice(0, 4000));
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
            const terrain = Effects.readTerrain(m.note, m.width, m.height, w2, h2);
            if (terrain.length) m.note = Effects.writeTerrain(m.note, w2, terrain);
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
