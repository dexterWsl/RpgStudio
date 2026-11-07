'use strict';
// 工程总览：工程信息、剧情骨架、地图树、引用、搜索、下拉框、结构检查、工程设置
//   module.exports = ctx => ({ get, post })：get[路由](T, q, req) 返回 JSON；post[路由](T, body)
//   ctx 由 handler.js 组装：project / tools / where / hint / views（各模块互相用的视图）/ actions（全部 POST 动作）
const { need, int, clone, END, blankPage, UserError } = require('../lib/util.js');
const { TRIGGERS, CE_TRIGGERS } = require('../core/commands.js');
const Profiles = require('../profiles/index.js');
module.exports = function (ctx) {
  const { project, where, hint, tools, opts } = ctx;
  const V = ctx.views;
  function mapTree() {
    return project.memoize('mapTree', () => project.mapList().map(m => {
      let events = 0, lines = 0, auto = 0;
      try {
        for (const e of (project.map(m.id) || {}).events || []) {
          if (!e) continue;
          events++;
          for (const pg of e.pages || []) { lines += ctx.lineCount(pg.list); if (pg.trigger >= 3) auto++; }
        }
      } catch { }
      return { ...m, events, lines, auto };
    }));
  }

  // 剧情骨架：哪些地方会自己开始（自动执行/并行）、台词最多的事件、开关变量的可疑用法
  function overview(T) {
    return project.memoize('overview', () => {
      const auto = [], talky = [];
      for (const m of project.mapList()) {
        let data; try { data = project.map(m.id); } catch { continue; }
        for (const e of (data && data.events) || []) {
          if (!e) continue;
          e.pages.forEach((pg, pi) => {
            const at = { type: 'map', map: m.id, ev: e.id, page: pi };
            const n = ctx.lineCount(pg.list);
            if (pg.trigger >= 3) auto.push({ at, where: where(at), trigger: TRIGGERS[pg.trigger], when: T.describer.pageConditions(pg.conditions), lines: n });
            if (n) talky.push({ at, where: where(at), lines: n, first: ctx.firstLine(pg.list) });
          });
        }
      }
      for (const c of project.read('CommonEvents.json') || []) {
        if (!c) continue;
        const at = { type: 'ce', ce: c.id };
        const n = ctx.lineCount(c.list);
        if (c.trigger > 0) auto.push({ at, where: where(at), trigger: CE_TRIGGERS[c.trigger], when: [project.label('switch', c.switchId) + ' 为开'], lines: n });
        if (n) talky.push({ at, where: where(at), lines: n, first: ctx.firstLine(c.list) });
      }
      talky.sort((a, b) => b.lines - a.lines);
      const totalLines = talky.reduce((s, x) => s + x.lines, 0);
      const sw = T.xref.audit('switch'), vr = T.xref.audit('var');
      return {
        auto: auto.slice(0, 200), autoCount: auto.length,
        talky: talky.slice(0, 30), scenes: talky.length, totalLines,
        audit: {
          switchNeverSet: sw.neverSet.slice(0, 60).map(id => ({ id, label: project.label('switch', id) })), switchNeverSetCount: sw.neverSet.length,
          varNeverSet: vr.neverSet.slice(0, 60).map(id => ({ id, label: project.label('var', id) })), varNeverSetCount: vr.neverSet.length,
        },
      };
    });
  }

  function projectInfo(T) {
    const prof = T.prof;
    const s = ctx.settings();
    return {
      ...project.info(),
      projectKey: ctx.projectKey(),
      play: '/play/' + encodeURIComponent(ctx.playId()) + '/',
      start: { map: Number(project.sys().startMapId) || 0, x: Number(project.sys().startX) || 0, y: Number(project.sys().startY) || 0 },
      nameBox: T.nameBox,
      profile: { id: prof.id, label: prof.label, notes: prof.notes.map(n => ({ ...n, where: n.at ? where(n.at) : '' })), chosen: s.profile || '' },
      profiles: Profiles.list(),
      pictures: { ...ctx.picOptions(), fromProfile: prof.pictures, custom: !!s.pictures },
      messageStyle: project.messageStyle(),
      canConfigure: ctx.canConfigure(),
      links: ctx.isBuiltin() ? ((typeof opts.links === 'function' ? opts.links() : opts.links) || []) : [],
    };
  }
  Object.assign(V, { projectInfo });
  return {
    get: {
      project: T => projectInfo(T),
      overview: T => overview(T),
      maps: () => ({ maps: mapTree() }),
      refs(T, q) {
        const kind = String(q('kind') || '');
        need(['switch', 'var', 'ce', 'item', 'actor', 'map', 'picture', 'sprite', 'face'].includes(kind), '类型不对');
        const id = ['picture', 'sprite', 'face'].includes(kind) ? String(q('id') || '') : int(q('id'));
        const refs = T.xref.of(kind, id).map(r => ({ ...r, where: where(r.at) }));
        const label = kind === 'picture' ? `图片「${id}」` : project.label(kind, id);
        return { kind, id, label, hint: hint(kind + ':' + id), refs };
      },
      search(T, q) {
        const hits = T.xref.search(q('q') || '', 300).map(h => ({ ...h, where: h.at ? where(h.at) : '' }));
        return { q: q('q') || '', hits };
      },
      // 给下拉框用：开关 / 变量 / 物品 / 角色 / 地图 / 公共事件的 编号 + 名字
      lookup(T, q) {
        const kind = String(q('kind') || '');
        need(['switch', 'var', 'item', 'actor', 'map', 'ce'].includes(kind), '类型不对');
        const n = kind === 'switch' || kind === 'var' ? project.count(kind) : 0;
        const rows = n ? Array.from({ length: n }, (_, i) => ({ id: i + 1, name: project.name(kind, i + 1) })) : project.rows(kind);
        return { kind, rows };
      },
      // 整个工程的结构检查（只报错误，不改）
      check(T) {
        const out = [];
        T.xref.each((at, list) => {
          const errs = T.validator.checkList(list, { images: true }).filter(e => e.level === 'error');
          if (errs.length) out.push({ at, where: where(at), errors: errs.slice(0, 5) });
        });
        return { problems: out.slice(0, 300), count: out.length };
      },
    },
    post: {
    settings(T, b) {
      need(ctx.canConfigure(), '只有管理员能改工程设置');
      const patch = {};
      if (b.profile !== undefined) { need(!b.profile || Profiles.list().some(p => p.id === b.profile), '没有这个配置'); patch.profile = b.profile || ''; }
      if (b.pictures !== undefined) {
        if (b.pictures === null) patch.pictures = null;
        else {
          const min = int(b.pictures.min, '图片编号要是整数'), max = int(b.pictures.max, '图片编号要是整数');
          need(min >= 1 && max <= 999 && min <= max, '图片编号范围不对');
          const clearAll = b.pictures.clearAll === 'script' ? 'script' : 'shown';
          patch.pictures = { min, max, clearAll };
        }
      }
      ctx.saveSettings(patch);
      return { project: projectInfo(tools()) };
    },
    },
  };
};
