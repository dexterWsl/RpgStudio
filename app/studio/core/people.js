'use strict';
// 人物（通用）：谁在哪里说话、出场，以及「这个人用到了哪些开关 / 变量」
//   人物 = 数据库里的角色（Actors.json）+ 只在台词里出现、不是角色的说话人
//   出现在一页里的方式：
//     说话：对话框的名字是 \N[n] 或角色名；或者对话框用的是这个角色的头像
//     出场：事件页的图像是这个角色的行走图
//   相关数值：这个人出现的那些页里，判断 / 修改了哪些开关、变量；越是「只和这个人有关」的分越高
//     另外：名字里带这个人名字的；手动关联的（写在角色备注里的 <RpgStudioLinks:var 12,switch 3>）
const LINK_RE = /<RpgStudioLinks:([^>]*)>/i;

function parseLinks(note) {
  const m = LINK_RE.exec(String(note || ''));
  if (!m) return [];
  return m[1].split(/[,，]/).map(s => s.trim()).map(s => /^(var|switch)\s+(\d+)$/i.exec(s)).filter(Boolean).map(x => ({ kind: x[1].toLowerCase(), id: Number(x[2]) }));
}
function writeLinks(note, links) {
  const tag = links.length ? `<RpgStudioLinks:${links.map(l => `${l.kind} ${l.id}`).join(',')}>` : '';
  note = String(note || '');
  if (LINK_RE.test(note)) return note.replace(LINK_RE, tag).replace(/\n{3,}/g, '\n\n').trim();
  return tag ? (note ? note.replace(/\s+$/, '') + '\n' + tag : tag) : note;
}

function createPeople(project, xref, aliases) {
  const P = project;
  const spriteKey = (name, index) => `${name}#${Number(index) || 0}`;

  function build() {
    const actors = (P.read('Actors.json') || []).filter(a => a && a.id > 0);
    const persons = new Map();
    const byName = new Map(), bySprite = new Map(), byFace = new Map();
    const multi = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const a of actors) {
      const name = String(a.name || '').trim();
      if (!name && !a.characterName && !a.faceName) continue;
      const key = 'a' + a.id;
      persons.set(key, {
        key, actorId: a.id, name: name || ('角色 ' + a.id), nickname: String(a.nickname || ''), profile: String(a.profile || ''),
        sprite: a.characterName ? { name: a.characterName, index: a.characterIndex || 0 } : null,
        face: a.faceName ? { name: a.faceName, index: a.faceIndex || 0 } : null,
        links: parseLinks(a.note), pages: new Map(), lines: 0,
      });
      if (name && !byName.has(name)) byName.set(name, key);
      if (a.characterName) multi(bySprite, spriteKey(a.characterName, a.characterIndex), key);
      if (a.faceName) multi(byFace, spriteKey(a.faceName, a.faceIndex), key);
    }
    const refsByAt = new Map();
    for (const r of xref.index().refs) {
      if (r.kind !== 'switch' && r.kind !== 'var') continue;
      const k = JSON.stringify(r.at);
      if (!refsByAt.has(k)) refsByAt.set(k, []);
      refsByAt.get(k).push(r);
    }
    let totalPages = 0;
    xref.each((at, list, cond, owner) => {
      totalPages++;
      const atKey = JSON.stringify(at);
      const hit = (key, how, n) => {
        const p = persons.get(key);
        if (!p) return;
        let e = p.pages.get(atKey);
        if (!e) p.pages.set(atKey, e = { at, says: 0, appears: false });
        if (how === 'say') { e.says += n; p.lines += n; } else e.appears = true;
      };
      if (at.type === 'map') {
        const pg = (owner.pages || [])[at.page];
        const im = pg && pg.image;
        if (im && im.characterName) for (const k of bySprite.get(spriteKey(im.characterName, im.characterIndex)) || []) hit(k, 'appear');
      }
      list.forEach((c, i) => {
        if (!c || c.code !== 101) return;
        const p = c.parameters || [];
        const raw = String(p[4] || '').trim();
        const keys = [];
        const nm = /^\\N\[(\d+)\]$/i.exec(raw);
        if (nm) keys.push('a' + nm[1]);
        else if (raw) {
          const name = P.expandN(raw).trim();
          const k = byName.get(name);
          if (k) keys.push(k);
          else {
            const sk = 's:' + name;
            if (!persons.has(sk)) persons.set(sk, { key: sk, name, speakerOnly: true, pages: new Map(), lines: 0, links: [] });
            keys.push(sk);
          }
        }
        if (p[0]) for (const k of byFace.get(spriteKey(p[0], p[1])) || []) if (!keys.includes(k)) keys.push(k);
        let n = 0;
        for (let j = i + 1; j < list.length && list[j] && list[j].code === 401; j++) n++;
        for (const k of keys) hit(k, 'say', Math.max(1, n));
      });
    });
    // 每个开关 / 变量出现在多少页里（越常见，对某个人来说越没有区分度）
    const df = new Map();
    for (const [, refs] of refsByAt) {
      const seen = new Set(refs.map(r => r.kind + ':' + r.id));
      for (const k of seen) df.set(k, (df.get(k) || 0) + 1);
    }
    return { persons, refsByAt, df, totalPages };
  }
  const index = () => P.memoize('people', build);

  // 这个人用到的开关 / 变量（按相关程度排序）；按数据签名缓存
  const related = (key, limit = 30) => P.memoize('people-related-' + key + '-' + limit, () => relatedNow(key, limit));
  function relatedNow(key, limit) {
    const ix = index();
    const p = ix.persons.get(key);
    if (!p) return { vars: [], switches: [] };
    const score = new Map();
    const bump = (kind, id, s, why) => {
      const k = kind + ':' + id;
      let e = score.get(k);
      if (!e) score.set(k, e = { kind, id: Number(id), score: 0, check: 0, set: 0, pages: new Set(), why: new Set() });
      e.score += s;
      if (why) e.why.add(why);
      return e;
    };
    // 每页每个数值只算一次（取这一页里最重的用法），出现的页越多分越高；到处都用的数值（天数之类）分低
    const W = { check: 3, set: 2, script: 1 };
    for (const [atKey] of p.pages) {
      const best = new Map();
      for (const r of ix.refsByAt.get(atKey) || []) {
        const k = r.kind + ':' + r.id;
        const cur = best.get(k) || { r, w: 0, check: 0, set: 0 };
        cur.w = Math.max(cur.w, W[r.use] || 1);
        if (r.use === 'check') cur.check++; else if (r.use === 'set') cur.set++;
        best.set(k, cur);
      }
      for (const [k, b] of best) {
        const idf = Math.log(1 + ix.totalPages / (ix.df.get(k) || 1));
        const x = bump(b.r.kind, b.r.id, b.w * idf);
        x.check += b.check; x.set += b.set;
        x.pages.add(atKey);
      }
    }
    const names = [p.name, p.nickname, ...((aliases && p.actorId && aliases[p.actorId]) || [])].map(s => String(s || '').trim()).filter(s => s.length >= 2);
    for (const kind of ['var', 'switch']) {
      const n = P.count(kind);
      for (let id = 1; id <= n; id++) {
        const nm = P.name(kind, id);
        if (nm && names.some(x => nm.toLowerCase().includes(x.toLowerCase()))) bump(kind, id, 20, '名字');
      }
    }
    for (const l of p.links || []) bump(l.kind, l.id, 1000, '手动关联');
    const out = { vars: [], switches: [] };
    for (const e of [...score.values()].sort((a, b) => b.score - a.score)) {
      const row = { kind: e.kind, id: e.id, name: P.name(e.kind, e.id), score: Math.round(e.score * 10) / 10, check: e.check, set: e.set, pages: e.pages.size, why: [...e.why], linked: e.why.has('手动关联') };
      if (e.pages.size) row.why.push(`出现在 ${e.pages.size} 页`);
      (e.kind === 'var' ? out.vars : out.switches).push(row);
    }
    out.vars = out.vars.slice(0, limit);
    out.switches = out.switches.slice(0, limit);
    return out;
  }

  // 一个事件里出现的人（给设置出现条件时快速挑数值用）
  function inEvent(mapId, evId) {
    const ix = index();
    const out = [];
    for (const p of ix.persons.values()) {
      let says = 0, appears = false;
      for (const e of p.pages.values()) if (e.at.type === 'map' && e.at.map === mapId && e.at.ev === evId) { says += e.says; appears = appears || e.appears; }
      if (says || appears) out.push({ key: p.key, name: p.name, actorId: p.actorId || 0, says, appears });
    }
    return out.sort((a, b) => (b.appears - a.appears) || (b.says - a.says));
  }

  function list() {
    return [...index().persons.values()].map(p => ({
      key: p.key, actorId: p.actorId || 0, name: p.name, nickname: p.nickname || '', speakerOnly: !!p.speakerOnly,
      sprite: p.sprite || null, face: p.face || null, lines: p.lines, pages: p.pages.size, links: (p.links || []).length,
    })).sort((a, b) => (a.speakerOnly - b.speakerOnly) || (a.actorId && b.actorId ? a.actorId - b.actorId : b.lines - a.lines));
  }
  const get = key => index().persons.get(key) || null;

  // 反过来：每个开关 / 变量主要属于谁（给开关 / 变量列表的「人物」一列和按人物筛选用）
  //   看「用到这个数值的页里，这个人出现的比例」比「这个人平时出现的比例」高多少：
  //   主角几乎每页都在，不会因为到处出现就把所有数值都占了；很多人都差不多的（坐标、天数）算多人共用
  //   手动关联、名字里带人名的直接算这个人的
  function owners(kind) {
    return P.memoize('people-owners-' + kind, () => {
      const ix = index();
      const total = Math.max(1, ix.totalPages);
      const pagesOf = new Map(); // id → Set(atKey)
      for (const [atKey, refs] of ix.refsByAt) for (const r of refs) if (r.kind === kind) {
        if (!pagesOf.has(r.id)) pagesOf.set(r.id, new Set());
        pagesOf.get(r.id).add(atKey);
      }
      const cand = new Map(); // id → [{key, name, w, sure}]
      const add = (id, p, w, sure) => {
        if (!cand.has(id)) cand.set(id, []);
        const list = cand.get(id);
        const e = list.find(x => x.key === p.key);
        if (e) { e.w = Math.max(e.w, w); e.sure = e.sure || sure; } else list.push({ key: p.key, name: p.name, w, sure });
      };
      const n = P.count(kind);
      for (const p of ix.persons.values()) {
        if (p.speakerOnly && p.lines < 3) continue;
        const base = p.pages.size / total;
        const overlap = new Map();
        for (const atKey of p.pages.keys()) for (const r of ix.refsByAt.get(atKey) || []) if (r.kind === kind) overlap.set(r.id, (overlap.get(r.id) || new Set()).add(atKey));
        for (const [id, set] of overlap) {
          const all = pagesOf.get(id).size;
          const share = set.size / all, lift = base ? share / base : 0;
          if (share >= 0.3 && lift >= 2) add(id, p, share * Math.log(lift), false);
        }
        for (const l of p.links || []) if (l.kind === kind) add(l.id, p, 100, true);
        const names = [p.name, p.nickname, ...((aliases && p.actorId && aliases[p.actorId]) || [])].map(s => String(s || '').trim().toLowerCase()).filter(s => s.length >= 2);
        if (names.length) for (let id = 1; id <= n; id++) {
          const nm = P.name(kind, id).toLowerCase();
          if (nm && names.some(x => nm.includes(x))) add(id, p, 50, true);
        }
      }
      const out = new Map();
      for (const [id, list] of cand) {
        list.sort((a, b) => (b.sure - a.sure) || (b.w - a.w));
        const sure = list.filter(x => x.sure);
        const top = list[0].w;
        const near = sure.length ? sure : list.filter(x => x.w >= top * 0.5);
        if (!sure.length && near.length > 3) out.set(id, { shared: near.length, people: [] });
        else out.set(id, { shared: 0, people: near.slice(0, 3).map(({ key, name }) => ({ key, name })) });
      }
      // 很多人的页里都有、但谁都不突出的：多人共用
      for (const [id, set] of pagesOf) if (!out.has(id) && set.size >= 8) {
        let k = 0;
        for (const p of ix.persons.values()) { let c = 0; for (const a of set) if (p.pages.has(a)) c++; if (c >= 2) k++; }
        if (k > 3) out.set(id, { shared: k, people: [] });
      }
      return out;
    });
  }

  return { index, related, inEvent, list, get, owners };
}

module.exports = { createPeople, parseLinks, writeLinks };
