'use strict';
// 示例配置：照这个写你自己游戏的约定。默认不会被选中（match 永远返回 0），
// 要用它得手动指定：--profile example，或者界面「工程设置 → 游戏配置」里选。
//
// 一个配置能做四件事：
//   1. 图片规则：剧情 CG 用哪一段编号；只写「#清图」时怎么关
//   2. 在开关 / 变量 / 公共事件 / 地图事件旁边显示「这在游戏里是干什么的」（hints）
//   3. 在概览里列出这个游戏的剧情骨架，方便找插入点（notes）
//   4. 指定剧情进度怎么认（progress），不写就自动识别
//
// 下面的编号都是占位用的，换成你自己游戏的。
module.exports = {
  id: 'example',
  label: '示例',
  // 认游戏：返回分数，越高越优先；0 = 不是这个游戏。都不认识就用 generic。
  //   这里返回 0，所以只有手动指定时才会用到。
  match() {
    return 0;
    /* 真实写法大概长这样：标题对得上就给高分，再看几个「骨架」特征兜底：
    const sys = project.sys();
    if (/我的游戏/i.test(String(sys.gameTitle || ''))) return 10;
    const v10 = String((sys.variables || [])[10] || '');
    const ce5 = project.name('ce', 5);
    return /daycount/i.test(v10) && /按日|day/i.test(ce5) ? 5 : 0;
    */
  },
  // 剧情图片：新加的「#图」在这段编号里往上叠（透明图层层叠，越大越靠上）。
  //   clearAll: 'script' = 只写「#清图」时用一条脚本把 min~max 全关掉（CG 常在别的事件里显示时用）
  //             'shown'  = 只关这一页自己显示的图（不知道别的编号是不是界面图时用，generic 就是这样）
  pictures: { min: 50, max: 89, clearAll: 'script' },
  // 剧情进度：按天 = 一个变量记第几天，可以再几个开关当时段（互斥）。
  //   不写这段就让编辑器自动识别；按章节 / 按开关链的写法见 README「游戏配置」。
  progress: {
    main: {
      type: 'day',
      var: 10,
      slots: [{ switch: 20, label: '白天' }, { switch: 21, label: '黄昏' }, { switch: 22, label: '夜晚' }],
    },
  },
  // 角色的英文原名（汉化前），用来认「SayaAffection」这种英文名的变量属于谁。
  // 从 i18n/editor-names-*.json 里读（没有就算了）；不需要就整段删掉。
  actorAliases() {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', '..', 'i18n');
    const out = {};
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^editor-names-.*\.json$/.test(f)); } catch { return out; }
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
        for (const [id, r] of Object.entries(d.actors || {})) if (r && r.en) (out[id] = out[id] || []).push(String(r.en));
      } catch { }
    }
    return out;
  },
  // 概览页「这个游戏的约定」：写清楚怎么推进剧情、哪些编号别占用。
  //   at: { type: 'ce', ce: 5 } 或 { type: 'map', map: 1, ev: 3, page: 1 } 会变成可以点过去的链接
  notes: [
    { title: '日循环', text: '每天三段：开关 20 白天 → 21 黄昏 → 22 夜晚，三个开关互斥。' },
    { title: '天数', text: '变量 10 DayCount 是唯一权威进度，每晚 +1。改它等于改章节。' },
    {
      title: '按日派发',
      text: '公共事件 5 里每天一段「如果 变量10 = N」：公告 → 开当天的开关 → 传送。空白天是最干净的插入点。',
      at: { type: 'ce', ce: 5 },
    },
    { title: '剧情图片', text: '剧情 CG 用图片 50~89 号（底图 50，差分往上叠）。90 号以上留给界面图，别占用。' },
  ],
  // 开关 / 变量 / 公共事件 / 地图事件旁边的说明。键的写法：
  //   'switch:25'  'var:10'  'ce:5'  'map:1/ev:3'
  hints: {
    'switch:20': '白天', 'switch:21': '黄昏', 'switch:22': '夜晚',
    'var:10': '天数（每晚 +1，唯一权威进度）',
    'ce:5': '按日派发（每天一段分支）',
  },
};
