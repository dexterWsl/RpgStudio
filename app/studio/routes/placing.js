'use strict';
// 往地图上放东西：出入口（两张地图之间走过去就换地图）、路人（一群会走来走去、能搭话的小人）
//   POST map/door  { map, x, y, to: {map, x, y}, back, arrive?, backArrive?, se, name, cond }
//        在 (x, y) 放一个出口，走上去传送到 to 那张地图；back = 在 to 那一格放一个回来的出口。
//        到了以后站在出口旁边能走的格子上（不会一落地又踩到出口）：没给 arrive 就自己找（优先出口正下方）
//   POST map/crowd { map, count, sprites: [{characterName, characterIndex}], lines: [...], area, moveType, moveSpeed, moveFrequency, name, cond,
//                    through, group, chatter, stages }
//        在能站人的空格子上随机放 count 个路人：随便走走，搭话说 lines 里的一句（「名字：台词」也行，跟场景写法一样）
//        through：能不能穿过去，默认能（路人不挡路）
//        group: { count, size }：不散着走，两三个人一堆面对面站着聊（size = 2 / 3 / [2, 3]）。count 是几堆；
//               lines 的一项是一堆人的对话（几句用换行隔开），跟这一堆里谁搭话都说这一段
//        chatter：头上冒的闲聊（#飘字），[[一堆的几句], …]（散着走的路人就是一人一句）。只在剧情没在演的时候冒
//        stages: [{ seg, until, lines, chatter }]：按剧情进度换台词：第 seg 段起用这一组，到下一组（或 until）为止；
//               最早那一组之前、until 之后人不在。写了 stages 就不用 lines / chatter / cond
//   cond：事件页的出现条件（跟改条件弹窗里的一样）；也可以写 {seg, until}：只在剧情进度的第 seg 段（到 until 之前）出现
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const Maps = require('../core/maps.js');

module.exports = function (ctx) {
  const { project, tools } = ctx;
  const V = ctx.views;
  const flagsOf = m => { const ts = (project.read('Tilesets.json') || [])[m.tilesetId]; return ts ? ts.flags : null; };
  const DIRS = [[0, 1, 2], [0, -1, 8], [-1, 0, 4], [1, 0, 6]];

  // 出现条件：{seg, until} 翻成进度变量的条件（只在这一段出现 = 多一页「从下一段起」的空白页）
  function pagesFor(T, base, cond) {
    if (!cond) return [base];
    if (cond.seg == null) { base.conditions = V.checkConditions(cond); return [base]; }
    const m = T.progress.config().main;
    need(m.type === 'day' || m.type === 'chapter', '按段出现要先在「剧情进度」里设好按天 / 按章节');
    const seg = m.segs[int(cond.seg, '第几段不对')];
    need(seg, '没有第 ' + cond.seg + ' 段');
    base.conditions.variableValid = true; base.conditions.variableId = m.var; base.conditions.variableValue = seg.from;
    const pages = [base];
    if (cond.until != null) {
      const end = m.segs[int(cond.until, '到第几段不对')];
      need(end && end.from > seg.from, '结束的那一段要在开始的后面');
      const blank = blankPage(); blank.priorityType = 0;
      blank.conditions.variableValid = true; blank.conditions.variableId = m.var; blank.conditions.variableValue = end.from;
      pages.push(blank);
    }
    return pages;
  }
  const freeId = m => { let id = m.events.findIndex((e, i) => i > 0 && !e); return id < 0 ? Math.max(1, m.events.length) : id; };
  const busy = m => new Set((m.events || []).filter(Boolean).map(e => e.x + ',' + e.y));
  // 放看不见的事件（闲聊）的格子：优先走不过去的地方（墙、桌子），不占路
  function freeSpot(m, taken) {
    const flags = flagsOf(m);
    let open = null;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      if (taken.has(x + ',' + y)) continue;
      if (!Maps.passable(m, flags, x, y)) return { x, y };
      if (!open) open = { x, y };
    }
    return open;
  }

  // 到了以后站哪：出口四周能走、没有事件的格子（优先正下方：门一般在上面的墙上）
  function arrivalNear(m, x, y, taken) {
    const flags = flagsOf(m);
    for (const [dx, dy, d] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (Maps.passable(m, flags, nx, ny) && !taken.has(nx + ',' + ny)) return { x: nx, y: ny, d };
    }
    return null;
  }
  function doorEvent(id, x, y, o) {
    const pg = blankPage();
    pg.trigger = 1;                                  // 主角碰到就走
    pg.priorityType = o.below ? 0 : 1;               // 能站的格子放在脚下；墙上的门放成跟人一样高（撞上去就走）
    pg.list = [
      ...(o.se ? [{ code: 250, indent: 0, parameters: [{ name: o.se, pan: 0, pitch: 100, volume: 90 }] }] : []),
      { code: 201, indent: 0, parameters: [0, o.to.map, o.to.x, o.to.y, o.to.d || 0, 0] },
      END(),
    ];
    return { id, name: o.name, note: 'rpgStudio 出入口', pages: o.pages ? o.pages(pg) : [pg], x, y };
  }

  return {
    post: {
      'map/door'(T, b) {
        const a = { map: int(b.map, '地图编号不对'), x: int(b.x, '坐标不对'), y: int(b.y, '坐标不对') };
        const to = b.to || {};
        const t = { map: int(to.map, '要去的地图不对'), x: int(to.x, '要去的坐标不对'), y: int(to.y, '要去的坐标不对') };
        need(!(a.map === t.map && a.x === t.x && a.y === t.y), '出口和目的地不能是同一格');
        const files = [...new Set([project.mapFile(a.map), project.mapFile(t.map)])];
        const out = {};
        T.store.edit(files, docs => {
          const ma = docs[project.mapFile(a.map)], mt = docs[project.mapFile(t.map)];
          need(ma, '地图 ' + a.map + ' 不存在'); need(mt, '地图 ' + t.map + ' 不存在');
          for (const [m, p] of [[ma, a], [mt, t]]) need(p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height, `(${p.x}, ${p.y}) 在地图外面`);
          const takenA = busy(ma), takenT = busy(mt);
          need(!takenA.has(a.x + ',' + a.y), `(${a.x}, ${a.y}) 已经有事件了`);
          // 去的那一头：有回来的出口 → 站在它旁边；没有 → 就站在那一格
          const back = b.back !== false;
          if (back) need(!takenT.has(t.x + ',' + t.y), `要去的 (${t.x}, ${t.y}) 已经有事件了，换一格，或者不要回来的出口`);
          const arriveT = b.arrive ? { x: int(b.arrive.x), y: int(b.arrive.y), d: int(b.arrive.d || 0) } : back ? arrivalNear(mt, t.x, t.y, takenT) : { ...t, d: 0 };
          need(arriveT, `要去的 (${t.x}, ${t.y}) 旁边没有能站的格子`);
          const arriveA = b.backArrive ? { x: int(b.backArrive.x), y: int(b.backArrive.y), d: int(b.backArrive.d || 0) } : arrivalNear(ma, a.x, a.y, takenA);
          if (back) need(arriveA, `出口 (${a.x}, ${a.y}) 旁边没有能站的格子，回来时没地方站`);
          const nameA = String(b.name || '').trim() || '出口→' + project.name('map', t.map);
          const pagesA = b.cond ? pg => pagesFor(T, pg, b.cond) : null;
          const idA = freeId(ma);
          ma.events[idA] = doorEvent(idA, a.x, a.y, { name: nameA.slice(0, 40), to: { map: t.map, ...arriveT }, se: b.se, below: Maps.passable(ma, flagsOf(ma), a.x, a.y), pages: pagesA });
          out.door = { map: a.map, ev: idA, arrive: arriveT };
          if (back) {
            const idT = freeId(mt);
            mt.events[idT] = doorEvent(idT, t.x, t.y, { name: ('出口→' + project.name('map', a.map)).slice(0, 40), to: { map: a.map, ...arriveA }, se: b.se, below: Maps.passable(mt, flagsOf(mt), t.x, t.y) });
            out.back = { map: t.map, ev: idT, arrive: arriveA };
          }
        });
        return out;
      },
      'map/crowd'(T, b) {
        const mapId = int(b.map, '地图编号不对');
        const sprites = (b.sprites || []).filter(s => s && s.characterName);
        need(sprites.length, '选几个小人（行走图）');
        const imgs = sprites.map(s => V.checkImage({ characterName: s.characterName, characterIndex: s.characterIndex || 0, direction: 2, pattern: 1 }, null));
        // 台词：每一项先变成指令（跟场景的写法一样，「名字：台词」有名字框；一堆人的对话几句用换行隔开）
        const compile = l => { try { return T.script.scriptCommands(T.script.parseScript(l)); } catch (e) { throw new UserError('台词写法不对：' + l + '（' + e.message + '）'); } };
        const clean = list => (list || []).map(x => String(x || '').trim()).filter(Boolean);
        const stages = b.stages ? b.stages.map(st => ({ seg: int(st.seg, '第几段不对'), until: st.until == null ? null : int(st.until, '到第几段不对'), lines: clean(st.lines).map(compile), chatter: (st.chatter || []).map(c => clean(Array.isArray(c) ? c : [c])) })) : null;
        if (stages) { need(stages.length, 'stages 是空的'); need(!b.cond, '写了 stages（按进度换台词）就不用 cond'); stages.sort((x, y) => x.seg - y.seg); }
        const flat = { lines: clean(b.lines).map(compile), chatter: (b.chatter || []).map(c => clean(Array.isArray(c) ? c : [c])) };
        const G = b.group ? { count: int(b.group.count || 3, '要几堆？'), sizes: [].concat(b.group.size || [2, 3]).map(n => int(n)).filter(n => n === 2 || n === 3) } : null;
        if (G) { need(G.count >= 1 && G.count <= 20, '一次放 1~20 堆'); need(G.sizes.length, '一堆 2 个或 3 个人'); }
        const count = G ? 0 : int(b.count || 6, '要几个人？');
        if (!G) need(count >= 1 && count <= 60, '一次放 1~60 个');
        const moveType = G ? 0 : b.moveType == null ? 1 : int(b.moveType);
        const through = b.through !== false;
        const base = String(b.name || '路人').trim().slice(0, 24) || '路人';
        const placed = [];
        // 按进度换的页：在每个分界点上看「这时候该用哪一组」（盖住它的里面开始最晚的那组），变了才加一页；没有就是空页（人不在）
        const prog = stages ? T.progress.config().main : null;
        if (stages) need(prog && (prog.type === 'day' || prog.type === 'chapter'), '按段换台词要先在「剧情进度」里设好按天 / 按章节');
        const fromOf = i => { const sg = prog.segs[i]; need(sg, '没有第 ' + i + ' 段'); return sg.from; };
        function timeline(make) {
          // make(stage 或 null) → 事件页；返回整个事件的页（第 0 页是最早那一段之前）
          if (!stages) { const pg = make(flat); return b.cond ? pagesFor(T, pg, b.cond) : [pg]; }
          const spans = stages.map((st, i) => ({ st, from: fromOf(st.seg), until: st.until != null ? fromOf(st.until) : i + 1 < stages.length ? fromOf(stages[i + 1].seg) : Infinity }));
          const pts = [...new Set(spans.flatMap(x => [x.from, x.until]).filter(Number.isFinite))].sort((x, y) => x - y);
          const pages = [];
          const first = spans.find(x => x.from <= 0);
          pages.push(first ? make(first.st) : blankAt(null));
          let cur = first || null;
          for (const at of pts) {
            if (at <= 0) continue;
            const cover = spans.filter(x => x.from <= at && at < x.until);
            const act = cover.length ? cover.reduce((m, x) => (x.from >= m.from ? x : m), cover[0]) : null;
            if (act === cur) continue;
            cur = act;
            const pg = act ? make(act.st) : blankAt(null);
            pg.conditions.variableValid = true; pg.conditions.variableId = prog.var; pg.conditions.variableValue = at;
            pages.push(pg);
          }
          need(pages.length <= 20, '按进度换的组太多了（一个事件最多 20 页）');
          return pages;
        }
        function blankAt() { const pg = blankPage(); pg.priorityType = 0; return pg; }
        function person(img, dir, talk) {
          const pg = blankPage();
          pg.image = clone(img); pg.image.direction = dir;
          pg.moveType = moveType; pg.moveSpeed = int(b.moveSpeed || 3); pg.moveFrequency = int(b.moveFrequency || 3);
          V.applyMove(pg, { moveSpeed: pg.moveSpeed, moveFrequency: pg.moveFrequency });
          pg.through = through;
          if (G) pg.stepAnime = false;
          pg.trigger = 0;
          pg.list = talk ? [...clone(talk), END()] : [END()];
          return pg;
        }
        // 闲聊：一个看不见的并行事件，按顺序在这几个人头上飘字，飘完歇一会儿再来（开头错开一点，几堆人不会同时开口）
        function chatterPage(names, lines, k) {
          const pg = blankAt();
          if (!lines || !lines.length) return pg;
          const text = [`#等待 ${(1 + (k * 1.7) % 4).toFixed(1)}`];
          lines.forEach((l, i) => { text.push(`#飘字 ${names[i % names.length]}：${l.replace(/^[^：:]{1,12}[：:]/, '')}`, `#等待 ${(2.2 + Math.min(2, [...l].length * 0.08)).toFixed(1)}`); });
          text.push('#等待 5');
          pg.trigger = 4;
          pg.list = [...compile(text.join('\n')), END()];
          return pg;
        }
        T.store.edit([project.mapFile(mapId)], docs => {
          const m = docs[project.mapFile(mapId)];
          need(m, '地图 ' + mapId + ' 不存在');
          const flags = flagsOf(m), taken = busy(m);
          const ar = b.area || { x: 0, y: 0, w: m.width, h: m.height };
          const ok = (x, y) => x >= Math.max(0, int(ar.x)) && y >= Math.max(0, int(ar.y)) && x < Math.min(m.width, int(ar.x) + int(ar.w)) && y < Math.min(m.height, int(ar.y) + int(ar.h)) && !taken.has(x + ',' + y) && Maps.passable(m, flags, x, y);
          const cells = [];
          for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (ok(x, y)) cells.push({ x, y });
          // 打乱（种子固定在地图编号上，同样的请求放出来的位置一样，方便重做）
          let seed = (mapId * 9301 + (count || G.count * 7) * 49297 + [...base].reduce((n, c) => n + c.charCodeAt(0), 0)) % 233280;
          const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
          for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
          const add = (x, y, name, pages) => { const id = freeId(m); m.events[id] = { id, name, note: 'rpgStudio 路人', pages, x, y }; taken.add(x + ',' + y); return id; };
          if (!G) {
            need(cells.length >= count, `这片地方只有 ${cells.length} 个能站人的空格子，放不下 ${count} 个`);
            for (let k = 0; k < count; k++) {
              const c = cells[k], dir = [2, 4, 6, 8][Math.floor(rnd() * 4)], nm = base + (k + 1);
              const id = add(c.x, c.y, nm, timeline(st => person(imgs[k % imgs.length], dir, st.lines.length ? st.lines[k % st.lines.length] : null)));
              placed.push({ ev: id, x: c.x, y: c.y });
            }
            // 散着走的路人也能冒闲聊：一人一句，轮着
            const anyChat = stages ? stages.some(st => st.chatter.length) : flat.chatter.length;
            if (anyChat) {
              const names = placed.map((_, k) => base + (k + 1));
              const spot = freeSpot(m, taken);
              if (spot) add(spot.x, spot.y, base + '·闲聊', timeline(st => chatterPage(names, st.chatter.flat(), 0)));
            }
            return;
          }
          // 一堆一堆：2 个人面对面；3 个人围着中间一格（中间空着）。堆跟堆之间至少隔一格
          const SHAPES = {
            2: [[[0, 0, 6], [1, 0, 4]], [[0, 0, 2], [0, 1, 8]]],
            3: [[[-1, 0, 6], [1, 0, 4], [0, 1, 8]], [[-1, 0, 6], [1, 0, 4], [0, -1, 2]]],
          };
          const reserved = new Set();
          let sp = 0;
          for (let g = 0; g < G.count; g++) {
            const size = G.sizes[g % G.sizes.length];
            let done = null;
            for (const c of cells) {
              for (const shape of SHAPES[size]) {
                const pts = shape.map(([dx, dy, d]) => ({ x: c.x + dx, y: c.y + dy, d }));
                const need3 = size === 3 ? [{ x: c.x, y: c.y }] : [];
                if ([...pts, ...need3].every(p => ok(p.x, p.y) && !reserved.has(p.x + ',' + p.y))) { done = { pts, c }; break; }
              }
              if (done) break;
            }
            need(done, `这片地方放不下第 ${g + 1} 堆人了（每堆要 ${size === 3 ? '3×2' : '2×1'} 格空地，堆跟堆隔一格）`);
            for (const p of [...done.pts, done.c]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add((p.x + dx) + ',' + (p.y + dy));
            const names = done.pts.map((_, i) => `${base}${g + 1}-${i + 1}`);
            done.pts.forEach((p, i) => {
              const img = imgs[(sp++) % imgs.length];
              const id = add(p.x, p.y, names[i], timeline(st => person(img, p.d, st.lines.length ? st.lines[g % st.lines.length] : null)));
              placed.push({ ev: id, x: p.x, y: p.y, group: g + 1 });
            });
            const anyChat = stages ? stages.some(st => st.chatter.length) : flat.chatter.length;
            if (anyChat) {
              const spot = freeSpot(m, taken);
              if (spot) add(spot.x, spot.y, `${base}${g + 1}·闲聊`, timeline(st => chatterPage(names, st.chatter.length ? st.chatter[g % st.chatter.length] : [], g)));
            }
          }
        });
        return { placed };
      },
    },
  };
};
