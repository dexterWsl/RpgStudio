'use strict';
// 剧情进度：主线按天 / 按章节 / 按开关链 / 按地图，加几条支线进度。只是看法，不改游戏数据（改条件时「放在第几天」除外）
//   GET  progress                    当前配置（存的 / 游戏配置给的 / 猜的）+ 可选的变量 / 时段开关 / 开关链
//   GET  progress/timeline?axis=     时间线：main 或 t<变量号>（支线）
//   GET  progress/map?id=            这张地图每个事件在每一段显示哪一页（给地图按进度亮暗）
//   POST progress/config {main, tracks}   保存（存在工程设置里）；{reset: true} = 回到自动识别
//   POST progress/start {type, count, …} 从零开始：建变量 / 时段开关 / 第 1~N 天（章）/ 开局设成 1 / 「过一天」场景
const { need, int, blankPage, END } = require('../lib/util.js');
const { MARK_CMD } = require('../core/scenes.js');

module.exports = function (ctx) {
  const { project, where } = ctx;
  return {
    get: {
      progress(T) {
        const cfg = T.progress.config();
        const d = T.progress.detect();
        return {
          config: cfg, source: cfg.source, canConfigure: ctx.canConfigure(),
          candidates: d.candidates, slotCandidates: d.slotCandidates, chainCandidates: d.chainCandidates,
          detected: { main: d.main, tracks: d.tracks },
          switches: Array.from({ length: project.count('switch') }, (_, i) => ({ id: i + 1, name: project.name('switch', i + 1) })).filter(s => s.name),
        };
      },
      'progress/timeline': (T, q) => T.progress.timeline(String(q('axis') || 'main')),
      'progress/map': (T, q) => T.progress.mapCells(Number(q('id'))),
      // 这一天（这一段）的事件顺序：必要（自动播 / 推进剧情）和支线，条件只留进度以外的
      'progress/day'(T, q) {
        const seg = Number(q('seg')) || 0, slot = q('slot') == null || q('slot') === '' ? -1 : Number(q('slot'));
        const d = T.progress.dayOrder(seg, slot);
        if (!d.axis) return d;
        const ax = d.axis, skip = new Set([...ax.slotSwitches, ...ax.chain]);
        const entries = d.entries.map(e => {
          let conds = [];
          if (e.pageCond) {
            const c = { ...e.pageCond };
            if (c.variableValid && ax.kind === 'var' && c.variableId === ax.var) c.variableValid = false;
            for (const k of ['switch1', 'switch2']) if (c[k + 'Valid'] && skip.has(c[k + 'Id'])) c[k + 'Valid'] = false;
            conds = T.describer.pageConditions(c);
          }
          const { pageCond, ...rest } = e;
          return { ...rest, conds };
        });
        return { axis: { type: ax.type, segs: ax.segs, slots: ax.slots }, entries };
      },
      // 某一天（某一段）每张地图上有几个剧情：选天以后地图列表旁边的数字
      //   数字跟「事件顺序」一致：每一段几件事（必要 + 支线），这一段每张地图上几件
      'progress/stage'(T, q) {
        const seg = Number(q('seg')) || 0, slot = q('slot') == null || q('slot') === '' ? -1 : Number(q('slot'));
        const d = T.progress.dayOrder(seg, slot);
        if (!d.axis) return { axis: null, maps: [], segs: [] };
        const segs = d.axis.segs.map((_, s) => T.progress.dayOrder(s, slot).entries.length);
        const per = new Map();
        for (const e of d.entries) if (e.at && e.at.type === 'map') { if (!per.has(e.at.map)) per.set(e.at.map, new Set()); per.get(e.at.map).add(e.at.ev); }
        return { axis: { type: d.axis.type, segs: d.axis.segs, slots: d.axis.slots }, segs, maps: project.mapList().map(m => ({ id: m.id, n: per.has(m.id) ? per.get(m.id).size : 0 })) };
      },
      // 按某种主线类型的默认分段（设置弹窗里换变量 / 换类型时用）
      'progress/setup'(T, q) {
        const type = String(q('type') || ''), v = Number(q('var'));
        if (type === 'day') return { main: T.progress.daySetup(v, []) };
        if (type === 'chapter') return { main: T.progress.chapterSetup(v) };
        if (type === 'track') return { track: T.progress.trackSetup(v) };
        return {};
      },
    },
    post: {
      // 从零开始分阶段：一步建好「按天 / 按章节」要的东西
      //   {type: 'day'|'chapter', count, var: 'new'|编号, varName, slots: 分白天 / 夜晚, opening: 开局设成 1, sleep: 「过一天」场景}
      //   · 变量（新建或用已有的）、时段开关「白天」「夜晚」
      //   · 第 1 ~ count 天（章）：变量 ≥ N 就是第 N 天（章），存成工程设置
      //   · 开局：开始地图上一个看不见的自动执行事件，把变量设成 1（时段：白天开、夜晚关），然后用独立开关 A 关掉自己
      //   · 过一天：场景库里一个公共事件「过一天」：淡出 → 变量 +1 →（白天开、夜晚关）→ 淡入 → 一句旁白；之后放到地图上（比如床）
      'progress/start'(T, b) {
        need(ctx.canConfigure(), '只有管理员能改进度设置');
        const type = b.type === 'chapter' ? 'chapter' : b.type === 'day' ? 'day' : null;
        need(type, '选按天还是按章节');
        const day = type === 'day';
        const count = int(b.count, '要几天 / 几章？');
        need(count >= 1 && count <= 99, '一次最多 99 ' + (day ? '天' : '章'));
        const useSlots = day && !!b.slots, opening = b.opening !== false, sleep = day && !!b.sleep;
        const newVar = b.var === 'new' || b.var == null || b.var === '';
        const varName = String(b.varName || (day ? '天数' : '主线进度')).trim().slice(0, 40);
        if (newVar) {
          need(varName, '给变量起个名字');
          const same = Array.from({ length: project.count('var') }, (_, i) => i + 1).find(id => project.name('var', id).trim() === varName);
          need(!same, `已经有一个变量叫「${varName}」了（变量 ${same}）：选「用已有的变量」，或者换个名字`);
        } else need(project.has('var', int(b.var, '变量编号不对')), '变量 ' + b.var + ' 不存在');
        const sys0 = project.sys();
        const startMap = Number(sys0.startMapId) || 0;
        if (opening) need(startMap > 0 && project.mapList().some(m => m.id === startMap), '游戏没有设开始地图（RPG Maker 里设好玩家的初始位置再来）');
        const nameBox = project.engine().name !== 'MV';
        const style = project.messageStyle();
        const counts = { var: T.xref.counts('var'), switch: T.xref.counts('switch') };
        const files = ['System.json', ...(opening ? [project.mapFile(startMap)] : []), ...(sleep ? ['CommonEvents.json'] : [])];
        const out = { var: 0, switches: [], opening: null, sleep: null };
        T.store.edit(files, docs => {
          const sys = docs['System.json'];
          const taken = { var: new Set(), switch: new Set() };
          // 第一个没名字、也没被用到的编号
          const grab = (kind, name) => {
            const arr = sys[kind === 'var' ? 'variables' : 'switches'];
            let id = 1;
            while (id < arr.length && (String(arr[id] || '').trim() || counts[kind][id] || taken[kind].has(id))) id++;
            need(id <= 5000, kind === 'var' ? '没有空着的变量了' : '没有空着的开关了');
            while (arr.length <= id) arr.push('');
            arr[id] = name; taken[kind].add(id);
            return id;
          };
          const v = out.var = newVar ? grab('var', varName) : int(b.var);
          const slots = useSlots ? [grab('switch', '白天'), grab('switch', '夜晚')] : [];
          out.switches = slots;
          const setSlots = () => (slots.length ? [{ code: 121, indent: 0, parameters: [slots[0], slots[0], 0] }, { code: 121, indent: 0, parameters: [slots[1], slots[1], 1] }] : []);
          if (opening) {
            const m = docs[project.mapFile(startMap)];
            need(m, '开始地图 ' + startMap + ' 读不到');
            const busy = new Set((m.events || []).filter(Boolean).map(e => e.x + ',' + e.y));
            let x = 0, y = 0;
            find: for (y = 0; y < m.height; y++) for (x = 0; x < m.width; x++) if (!busy.has(x + ',' + y) && !(x === sys.startX && y === sys.startY)) break find;
            need(y < m.height, '开始地图上没有空格子放开局事件');
            let id = m.events.findIndex((e, i) => i > 0 && !e);
            if (id < 0) id = Math.max(1, m.events.length);
            const p1 = blankPage(), p2 = blankPage();
            p1.trigger = 3;
            p1.list = [{ code: 122, indent: 0, parameters: [v, v, 0, 0, 1] }, ...setSlots(), { code: 123, indent: 0, parameters: ['A', 0] }, END()];
            p2.conditions.selfSwitchValid = true; p2.conditions.selfSwitchCh = 'A';
            m.events[id] = { id, name: `开局：${day ? '第 1 天' : '第 1 章'}`, note: '新游戏开始时把进度设成 1，只跑一次', pages: [p1, p2], x, y };
            out.opening = { map: startMap, ev: id, x, y };
          }
          if (sleep) {
            const arr = docs['CommonEvents.json'];
            let id = arr.findIndex((c, i) => i > 0 && c && !String(c.name || '').trim() && (c.list || []).length <= 1 && !c.trigger);
            if (id < 0) { id = arr.length; arr.push(null); }
            const say = { code: 101, indent: 0, parameters: nameBox ? ['', 0, style.background, style.position, ''] : ['', 0, style.background, style.position] };
            arr[id] = { id, name: '过一天', switchId: 1, trigger: 0, list: [
              MARK_CMD(),
              { code: 221, indent: 0, parameters: [] },
              { code: 230, indent: 0, parameters: [30] },
              { code: 122, indent: 0, parameters: [v, v, 1, 0, 1] },
              ...setSlots(),
              { code: 222, indent: 0, parameters: [] },
              say, { code: 401, indent: 0, parameters: ['新的一天开始了。'] },
              END(),
            ] };
            out.sleep = { id, name: '过一天' };
          }
        });
        const segs = Array.from({ length: count }, (_, i) => ({ from: i + 1, label: day ? `第 ${i + 1} 天` : `第 ${i + 1} 章` }));
        const main = { type, var: out.var, segs, slots: out.switches.map((s, i) => ({ switch: s, label: ['白天', '夜晚'][i] })) };
        ctx.saveSettings({ progress: { main, tracks: T.progress.config().tracks.filter(t => t.var !== out.var) } });
        return { ...out, config: ctx.tools().progress.config() };
      },
      // 新建一天 / 一章：在主线最后加一段。按开关链的游戏没给开关就新建一个
      'progress/addseg'(T, b) {
        need(ctx.canConfigure(), '只有管理员能改进度设置');
        const cfg = T.progress.config();
        const m = JSON.parse(JSON.stringify(cfg.main));
        need(m.type !== 'map', '这个游戏现在按地图看：先在「设置」里选按天 / 按章节 / 按开关链');
        const label = String(b.label || '').trim().slice(0, 30);
        let seg = 0;
        if (m.type === 'day' || m.type === 'chapter') {
          const last = m.segs[m.segs.length - 1];
          const from = b.from == null || b.from === '' ? last.from + 1 : int(b.from, '起点要是整数');
          need(from > last.from, `要比最后一段（${last.label}，从 ${last.from} 起）大`);
          m.segs.push({ from, label: label || (m.type === 'day' ? `第 ${from} 天` : `第 ${m.segs.length} 章`) });
          seg = m.segs.length - 1;
        } else {
          let sw = b.switch == null || b.switch === '' ? 0 : int(b.switch, '开关编号不对');
          const name = label || `第 ${m.chain.length + 1} 章`;
          if (sw) need(project.has('switch', sw), '开关 ' + sw + ' 超出范围');
          else {
            sw = ctx.views.freeSlot(T, 'switch');
            need(sw >= 1 && sw <= 5000, '没有空着的开关了');
            T.store.edit(['System.json'], docs => {
              const arr = docs['System.json'].switches;
              while (arr.length <= sw) arr.push('');
              arr[sw] = ('进入' + name).slice(0, 40);
            });
          }
          need(!m.chain.some(c => c.switch === sw), '这个开关已经在链上了');
          m.chain.push({ switch: sw, label: name });
          seg = m.chain.length;
        }
        ctx.saveSettings({ progress: { main: m, tracks: cfg.tracks } });
        return { seg, config: ctx.tools().progress.config() };
      },
      'progress/config'(T, b) {
        need(ctx.canConfigure(), '只有管理员能改进度设置');
        if (b.reset) { ctx.saveSettings({ progress: null }); return { config: ctx.tools().progress.config() }; }
        const cfg = T.progress.normalize({ main: b.main, tracks: b.tracks });
        if (b.main && b.main.type !== 'map') need(cfg.main.type !== 'map', '主线的设置不完整（要选变量或开关）');
        ctx.saveSettings({ progress: { main: cfg.main, tracks: cfg.tracks } });
        return { config: ctx.tools().progress.config() };
      },
    },
  };
};
