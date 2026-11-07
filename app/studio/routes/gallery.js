'use strict';
// 回想房：总览、挑已有剧情加回想（完整播放 / 只看图）、解锁、重新复制、拿掉
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const { ROOM_TAG } = require('../core/gallery.js');
module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  // ---------- 回想房 ----------
  function galleryView(T) {
    const v = JSON.parse(JSON.stringify(T.gallery.view()));   // 视图是缓存的，下面要往里加东西，先复制一份
    for (const e of v.entries) {
      for (const s of e.unlock.switches) { s.setCount = s.setBy.length; s.setBy = s.setBy.slice(0, 3).map(at => ({ at, where: where(at) })); }
      if (e.source && e.source.at) e.source.where = where(e.source.at);
    }
    v.gaps = v.map ? T.gallery.gaps(60).map(g => ({ ...g, where: where(g.at) })) : [];
    v.maps = project.mapList().map(m => ({ id: m.id, name: m.name }));
    return v;
  }
  const msgHead = T => { const s = project.messageStyle(); return speaker => ({ code: 101, indent: 0, parameters: T.nameBox ? ['', 0, s.background, s.position, speaker || ''] : ['', 0, s.background, s.position] }); };
  const stripChoiceCond = t => String(t == null ? '' : t).replace(/^\s*<<.*?>>\s*/, '');
  function calledCes(T) { const s = new Set(); for (const r of T.xref.index().refs) if (r.kind === 'ce' && r.use === 'call') s.add(Number(r.id)); return s; }
  const emptyCe = id => ({ id, list: [END()], name: '', switchId: 1, trigger: 0 });
  // 一组副本内部的相互调用不妨碍清理；外部仍在调用的副本及其依赖必须保留。
  function unusedCopies(T, ids, mapId, evId, replacing = []) {
    const owned = new Set(ids.filter(id => id > 0));
    const internal = new Set([...owned, ...replacing]);
    const kept = new Set();
    for (const id of owned) if (T.xref.of('ce', id).some(r => r.use === 'call'
      && !(r.at.type === 'map' && r.at.map === mapId && r.at.ev === evId)
      && !(r.at.type === 'ce' && internal.has(r.at.ce)))) kept.add(id);
    const ces = project.read('CommonEvents.json') || [];
    const pending = [...kept];
    while (pending.length) {
      const ce = ces[pending.pop()];
      for (const c of (ce && ce.list) || []) if (c.code === 117) {
        const id = Number(c.parameters[0]);
        if (owned.has(id) && !kept.has(id)) { kept.add(id); pending.push(id); }
      }
    }
    return [...owned].filter(id => !kept.has(id));
  }
  Object.assign(V, { galleryView });
  return {
    get: {
      gallery: T => galleryView(T),
      'gallery/sources': T => ({ sources: T.gallery.sources().map(s => ({ ...s, where: where(s.at) })) }),
    },
    post: {
    // 回想房：用哪张地图（mode=use）/ 复制一张地图的样子新建（mode=copy，不带事件）
    'gallery/room'(T, b) {
      const tagged = T.gallery.candidates().filter(c => c.tagged).map(c => c.id);
      let id;
      if (b.mode === 'copy') {
        const from = int(b.from, '选一张地图当样子');
        const name = String(b.name || '').trim().slice(0, 40) || '回想房';
        id = ctx.actions['map/create'](T, { name, parentId: 0, copyFrom: from }).id;
        T.store.edit([project.mapFile(id)], docs => { const m = docs[project.mapFile(id)]; m.events = [null]; m.displayName = m.displayName || name; });
      } else {
        id = int(b.map, '选一张地图');
        need(project.mapList().some(m => m.id === id), '地图 ' + id + ' 不存在');
      }
      const files = [...new Set([...tagged, id].map(x => project.mapFile(x)))];
      T.store.edit(files, docs => {
        for (const f of files) { const m = docs[f]; if (!m) continue; m.note = String(m.note || '').split(ROOM_TAG).join('').replace(/\n{3,}/g, '\n\n').trim(); }
        const m = docs[project.mapFile(id)];
        m.note = (m.note ? m.note.replace(/\s+$/, '') + '\n' : '') + ROOM_TAG;
      });
      return { map: id, view: galleryView(tools()) };
    },
    // 挑已有的事件加进回想房：items = [{ source: at, title, image, unlock: 'open'|'seen', picOnly }]
    'gallery/add'(T, b) {
      const G = T.gallery;
      const cur = G.current();
      need(cur, '还没有回想房：先指定或新建一张地图当回想房');
      const items = Array.isArray(b.items) ? b.items : [];
      need(items.length >= 1 && items.length <= 50, '一次加 1~50 个');
      const gm = project.mapFile(cur.id);
      const files = new Set(['CommonEvents.json', gm]);
      for (const it of items) {
        const at = it.source || {};
        need(at.type === 'map' || at.type === 'ce', '来源不对');
        if (at.type === 'map') { need(int(at.map) !== cur.id, '回想房里的事件不能再加进回想房'); files.add(project.mapFile(int(at.map))); }
        need(String(it.title || '').trim(), '给每个回想起个标题');
      }
      if (items.some(it => it.unlock === 'seen')) files.add('System.json');
      const head = msgHead(T);
      const called = calledCes(T);
      const counts = T.xref.counts('switch');
      const created = [];
      T.store.edit([...files], docs => {
        const ces = docs['CommonEvents.json'];
        const room = docs[gm];
        const flags = (V.tilesetOf(room.tilesetId) || {}).flags || null;
        const usedCe = new Set(), usedSw = new Set();
        const freeCe = () => {
          for (let i = 1; i < ces.length; i++) {
            const c = ces[i];
            if (usedCe.has(i) || called.has(i)) continue;
            if (!c || (!String(c.name || '').trim() && (c.list || []).filter(x => x && x.code !== 0).length === 0 && !c.trigger)) { usedCe.add(i); return i; }
          }
          ces.push(null); usedCe.add(ces.length - 1); return ces.length - 1;
        };
        const freeSw = () => {
          const arr = docs['System.json'].switches;
          for (let i = 1; i < arr.length; i++) if (!usedSw.has(i) && !String(arr[i] || '').trim() && !counts[i]) { usedSw.add(i); return i; }
          arr.push(''); usedSw.add(arr.length - 1); return arr.length - 1;
        };
        const near = (room.events || []).filter(e => e && G.parseTag(e.note)).map(e => ({ x: e.x, y: e.y }));
        if (!near.length) for (const e of room.events || []) if (e && (e.pages || []).some(p => p.image && p.image.characterName && p.trigger <= 2)) near.push({ x: e.x, y: e.y });
        for (const it of items) {
          const at = { ...it.source };
          const title = String(it.title).trim().slice(0, 30);
          let srcList;
          if (at.type === 'map') {
            at.map = int(at.map); at.ev = int(at.ev); at.page = int(at.page || 0);
            const sm = docs[project.mapFile(at.map)];
            const e = sm && (sm.events || [])[at.ev];
            need(e && e.pages[at.page], `地图 ${at.map} 事件 ${at.ev} 第 ${at.page + 1} 页不存在`);
            srcList = e.pages[at.page].list;
          } else {
            at.ce = int(at.ce);
            need(ces[at.ce], '公共事件 ' + at.ce + ' 不存在');
            srcList = ces[at.ce].list;
          }
          const cp = G.copyGraph(srcList, ces, freeCe, { sourceCe: at.type === 'ce' ? at.ce : 0, title });
          const ceId = cp.ce, removed = cp.removed;
          let picCe = 0;
          if (it.picOnly !== false) {
            const io = G.imageOnly(ces[ceId].list, head, ces);
            if (io.shown) { picCe = freeCe(); ces[picCe] = { id: picCe, list: [...io.list, END()], name: ('回想·' + title + '·只看图').slice(0, 40), switchId: 1, trigger: 0 }; }
          }
          const en = G.entryCommands(title, ceId, ces, head, picCe);
          // 看过才解锁：新开关，在原剧情开头打开
          let sw = 0;
          if (it.unlock === 'seen') {
            sw = freeSw();
            docs['System.json'].switches[sw] = ('回想·' + title).slice(0, 40);
            srcList.splice(0, 0, { code: 121, indent: 0, parameters: [sw, sw, 0] });
          }
          let pos;
          if (it.x != null && it.y != null) {
            pos = { x: int(it.x), y: int(it.y) };
            need(pos.x >= 0 && pos.y >= 0 && pos.x < room.width && pos.y < room.height, '位置在回想房外面');
            need(!(room.events || []).some(e => e && e.x === pos.x && e.y === pos.y), `(${pos.x}, ${pos.y}) 已经有事件了`);
          } else pos = G.freeSpot(room, flags, near);
          need(pos, '回想房里找不到空位了，换一张大点的地图');
          const image = V.checkImage(it.image || {}, null);
          let id = (room.events || []).findIndex((e, i) => i > 0 && !e);
          if (id < 0) id = Math.max(1, room.events.length);
          const page = blankPage();
          page.image = image; page.list = en.list;
          const pages = [page];
          if (sw) {
            const locked = blankPage();
            locked.image = clone(image);
            locked.list = [head(''), { code: 401, indent: 0, parameters: ['（还没看过这段剧情）'] }, END()];
            page.conditions.switch1Valid = true; page.conditions.switch1Id = sw;
            pages.unshift(locked);
          }
          room.events[id] = { id, name: ('回想_' + title).slice(0, 40), note: G.makeTag(at, ceId, true, picCe, cp.deps), pages, x: pos.x, y: pos.y };
          near.push(pos);
          created.push({ ev: id, x: pos.x, y: pos.y, ce: ceId, picCe, copied: true, switch: sw, removed, title, pics: en.pics, lines: en.lines });
        }
      });
      return { created, view: galleryView(tools()) };
    },
    // 解锁：清掉入口的开关条件（变量条件留着，多半是「第几天」）；choices = 选项前面的 <<条件>> 也去掉
    'gallery/unlock'(T, b) {
      const cur = T.gallery.current();
      need(cur, '还没有回想房');
      const gm = project.mapFile(cur.id);
      const only = b.ev != null ? int(b.ev) : null;
      const ids = only != null ? [only] : T.gallery.view().entries.filter(e => e.kind === 'scene').map(e => e.ev);
      let n = 0;
      T.store.edit([gm], docs => {
        const room = docs[gm];
        for (const id of ids) {
          const e = (room.events || [])[id];
          need(e, '事件 ' + id + ' 不存在');
          for (const pg of e.pages || []) {
            const c = pg.conditions || {};
            if (c.switch1Valid) { c.switch1Valid = false; n++; }
            if (c.switch2Valid) { c.switch2Valid = false; n++; }
            if (b.choices) for (const cmd of pg.list || []) {
              if (cmd.code === 102) { const before = JSON.stringify(cmd.parameters[0]); cmd.parameters[0] = (cmd.parameters[0] || []).map(stripChoiceCond); if (JSON.stringify(cmd.parameters[0]) !== before) n++; }
              if (cmd.code === 402) cmd.parameters[1] = stripChoiceCond(cmd.parameters[1]);
            }
          }
        }
      });
      return { changed: n, view: galleryView(tools()) };
    },
    // 重新复制：原剧情改过以后，把回想里的那份（和「只看图」）更新成现在的样子
    'gallery/resync'(T, b) {
      const G = T.gallery;
      const cur = G.current();
      need(cur, '还没有回想房');
      const gm = project.mapFile(cur.id);
      const e0 = ((project.readFresh(gm) || {}).events || [])[int(b.ev)];
      need(e0, '事件不存在');
      const tag = G.parseTag(e0.note);
      need(tag && tag.at, '这个入口不是在这里加的回想，没法重新复制');
      const files = new Set([gm, 'CommonEvents.json']);
      if (tag.at.type === 'map') files.add(project.mapFile(tag.at.map));
      const head = msgHead(T);
      const clear = unusedCopies(T, tag.deps, cur.id, int(b.ev), [tag.ce]);
      T.store.edit([...files], docs => {
        const ces = docs['CommonEvents.json'];
        const room = docs[gm];
        const e = room.events[int(b.ev)];
        const pg = e.pages[e.pages.length - 1];
        const t = (pg.list || []).find(c => c.code === 401 && /^回想：/.test(c.parameters[0] || ''));
        const title = t ? String(t.parameters[0]).replace(/^回想：/, '') : String(e.name || '').replace(/^回想_/, '');
        let srcList;
        if (tag.at.type === 'map') {
          const e = ((docs[project.mapFile(tag.at.map)] || {}).events || [])[tag.at.ev];
          need(e && e.pages[tag.at.page], '原来的事件页已经不在了');
          srcList = e.pages[tag.at.page].list.filter(c => !(c.code === 121 && (docs[gm].events[int(b.ev)].pages || []).some(p => p.conditions && p.conditions.switch1Valid && p.conditions.switch1Id === c.parameters[0] && c.parameters[0] === c.parameters[1])));
        } else {
          need(ces[tag.at.ce], '原来的公共事件不见了');
          srcList = ces[tag.at.ce].list;
        }
        const allocate = () => { const id = ces.length; ces.push(null); return id; };
        const cp = G.copyGraph(srcList, ces, allocate, { rootId: tag.copy ? tag.ce : 0, sourceCe: tag.at.type === 'ce' ? tag.at.ce : 0, title });
        for (const id of clear) ces[id] = emptyCe(id);
        if (tag.pic && ces[tag.pic]) ces[tag.pic].list = [...G.imageOnly(ces[cp.ce].list, head, ces).list, END()];
        pg.list = G.entryCommands(title, cp.ce, ces, head, tag.pic && ces[tag.pic] ? tag.pic : 0).list;
        e.note = String(e.note || '').replace(/<RpgStudioRecall:[^>]*>/i, G.makeTag(tag.at, cp.ce, true, tag.pic, cp.deps));
      });
      return { view: galleryView(tools()) };
    },
    // 从回想房拿掉：删入口事件；这里复制出来的公共事件没别人调用就一起清空
    'gallery/remove'(T, b) {
      const cur = T.gallery.current();
      need(cur, '还没有回想房');
      const gm = project.mapFile(cur.id);
      const id = int(b.ev);
      const e0 = ((project.readFresh(gm) || {}).events || [])[id];
      need(e0, '事件不存在');
      const tag = T.gallery.parseTag(e0.note);
      const clear = tag ? unusedCopies(T, [tag.copy ? tag.ce : 0, tag.pic, ...tag.deps], cur.id, id) : [];
      T.store.edit([gm, ...(clear.length ? ['CommonEvents.json'] : [])], docs => {
        docs[gm].events[id] = null;
        for (const c of clear) docs['CommonEvents.json'][c] = emptyCe(c);
      });
      return { cleared: clear, view: galleryView(tools()) };
    },
    },
  };
};
