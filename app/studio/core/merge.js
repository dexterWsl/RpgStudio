'use strict';
// 通用核心：不认识任何具体游戏。图片编号段、有没有名字框等由调用方（profile）传进来。
// 台词整段重写：指令 ↔ 编辑框文字 的无损往返
//
// 以前：把指令读成简化条目 → 用户改文字 → 按条目重新生成整段指令。
//       读的时候就丢了头像/窗口设置、多行对话框、\N[n]、<center>、非常量的变量操作、图片位置……
//       所以哪怕一个字没改，保存也会把这些全部冲掉。
// 现在：
//   1. 把一段连续的「台词/图片/等待/开关/变量/物品/传送」指令切成片段，每个片段记住自己的原始指令；
//   2. 每个片段在编辑框里是固定的一行（多行对话框是几行）；
//   3. 保存时按文字逐段对齐（最长公共子序列）：没改过的片段原样写回原始指令；
//      挪了位置的片段也原样搬过去；只有改过/新增的片段才重新生成，
//      并沿用同位置原片段的设置（头像表情、窗口、图片编号和位置、传送朝向）。
//   所以「打开 → 不改 → 保存」一定不改数据；改一句只动那一句。
//
// 编辑框写法：
//   名字：台词     一个对话框（不写名字 = 旁白）
//   ＋第二行       接在上一句的同一个对话框里（游戏里的多行对话）
//   ：台词         冒号开头 = 明确是旁白（用于空行、或旁白本身带冒号/以 # ＋ 开头的情况）
//   台词里的 \N[4] 显示成角色名（马库斯）；保存改过的句子时，原来是 \N[4] 的名字会换回 \N[4]
//   #图 / #等待 / #开关 / #变量 / #物品 / #传送 / #选项   和以前一样
//   #图 图片名     叠在当前最上面那张的上一层（透明图层层叠加；编号段由游戏配置决定，越大越靠上）
//   #清图          关闭剧情图片：配置了编号段的 = 一把关掉 min~max；通用配置 = 关掉这一页自己显示的图
//   #清图 图片2    按顺序关：关掉第 2 个「#图」显示的那张（从编辑框顶上往下数 #图）；也可以写 #清图2、#关闭图片2
//   #清图 图片名   按名字关正在显示的那张
//   #原样 ……      编辑框表达不了的指令（例如「变量 = 游戏数据」）：可以删、可以挪，不能改内容
//   ■ 选了「……」  选项的一个分支：改字 = 改选项；照着写一行 = 加一个选项；删掉这一行和它下面的内容 = 删掉这个选项
//   ■ ……          其它原来的结构（条件、插件、音效、调用公共事件、选项的开头和结尾……）：不能改、删、挪
//   │             行首的竖线表示在选项/条件里面（只是显示，写不写都行）
//
// 整页编辑（analyzeList / mergeList）：■ 结构行把一页切成若干「区域」，每个区域里的台词/图片
// 单独按上面的规则合并；结构行原样保留，所以带选项、条件的段落也能改台词。

// 能放进编辑框的指令：台词、图片、等待、开关变量物品、传送，还有演出（淡入淡出、音乐音效、色调、震动、气泡）
const EDITABLE = new Set([101, 401, 231, 235, 230, 121, 122, 126, 201, 221, 222, 223, 225, 241, 242, 245, 246, 250, 213, 117, 211, 322, 214, 123, 354, 204, 224, 236]);
// 演出插件（#飘字 #动作）的插件指令，连同后面「谁 = …」那几行续行，也能放进编辑框
const { isStageCmd } = require('./stage.js');
const stageAt = (list, i) => {
  const c = list[i];
  if (isStageCmd(c)) return true;
  if (!c || c.code !== 657) return false;
  let k = i - 1;
  while (k >= 0 && list[k].code === 657) k--;
  return k >= 0 && list[k].code === 357 && isStageCmd(list[k]);
};
const isBust = name => /^立绘\//.test(String(name || ''));
const OPS = ['=', '+', '-', '*', '/', '%'];
const KEEP = '#原样 ';
const ANCHOR = '■';
const BAR = '│ ';
const stripBar = line => line.replace(/^(?:│ ?)+/, '');
const oneLine = s => String(s == null ? '' : s).replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 100);
// 结构指令的续行：脚本、插件参数、注释、移动路线、商店、滚动文字
const CONT = new Set([405, 408, 505, 605, 655, 657]);
// 选项的每一个分支：「■ 选了「选项的字」」，字可以改；照着写一行 = 加一个选项，删掉 = 删掉这个选项
const choiceLine = label => ANCHOR + ' 选了「' + String(label ?? '') + '」';
// 「■ 选项（3 个）：A / B / C」：只是列出有哪些选项，方便一眼看全（改字在下面的「■ 选了」行）
const choiceHead = labels => {
  const s = (labels || []).map(l => (String(l ?? '').trim() ? String(l) : '（空）')).join(' / ').replace(/\s*[\r\n]+\s*/g, ' ');
  return ANCHOR + ` 选项（${(labels || []).length} 个）：` + (s.length > 160 ? s.slice(0, 160) + '…' : s);
};
const HEAD_RE = /^■ 选项(?:$|（|：)/;
const CHOICE_RE = /^■\s*选了「([^\n]*)」$/;
const MAX_CHOICES = 6;   // RPG Maker 的「显示选项」最多 6 个

// ---------- 图片规则（每个游戏不一样，由配置 profile 决定） ----------
//   min~max：新加的 #图 用哪段编号（叠图：当前最上面那张 +1）
//   clearAll：只写「#清图」时怎么关
//     'script' = 一条脚本把 min~max 全关掉（剧情 CG 常在别的事件里显示，要能一把清掉）
//     'shown'  = 只关这一页自己显示、还没关的图（通用：不知道别的编号是不是界面图，不乱碰）
function pictureRules(opts = {}) {
  const min = Number.isInteger(opts.min) ? opts.min : 1;
  const max = Number.isInteger(opts.max) ? opts.max : 100;
  if (min < 1 || max < min) throw new Error('图片编号范围不对：' + min + '~' + max);
  const mode = opts.clearAll === 'script' ? 'script' : 'shown';
  const CLEAR_ALL = `for (let i = ${min}; i <= ${max}; i++) $gameScreen.erasePicture(i);`;
  const isClearAll = c => !!c && c.code === 355 && String(c.parameters[0] || '').trim().replace(/;$/, '') === CLEAR_ALL.replace(/;$/, '');
  // 新的一张图放哪：当前显示的剧情图里最上面那张的上一层
  //   立绘（img/pictures/立绘/…）用编号段最上面的几个固定号，不算在叠图里
  const nextPicId = slots => {
    const used = [...slots.entries()].filter(([i, n]) => i >= min && i <= max && !isBust(n)).map(([i]) => i);
    let id = used.length ? Math.max(...used) + 1 : min;
    while (slots.has(id) && id <= max) id++;
    if (id > max) throw new Error(`同时叠着的图太多了（最多 ${max - min + 1} 张），先用 #清图 关掉一些`);
    return id;
  };
  // 这一条能不能放进编辑框（脚本只认「关闭全部图片」这一句，而且后面没有续行）
  const editableAt = (list, i) => !!list[i] && (EDITABLE.has(list[i].code) || stageAt(list, i) || (isClearAll(list[i]) && !(list[i + 1] && list[i + 1].code === 655)));
  const picApply = (st, c) => {
    if (!c) return;
    if (c.code === 231) { st.slots.set(c.parameters[0], c.parameters[1]); st.last = c.parameters[0]; st.shows.push({ id: c.parameters[0], name: c.parameters[1] }); }
    else if (c.code === 235) st.slots.delete(c.parameters[0]);
    else if (isClearAll(c)) st.slots.clear();
  };
  const blockRange = list => {
    const idx = [];
    (list || []).forEach((c, i) => { if (editableAt(list, i)) idx.push(i); });
    if (!idx.length) return null;
    const first = idx[0], last = idx[idx.length - 1];
    for (let i = first; i <= last; i++) if (!editableAt(list, i)) return { first, last, contiguous: false };
    return { first, last, contiguous: true };
  };
  return { min, max, mode, CLEAR_ALL, isClearAll, nextPicId, editableAt, picApply, blockRange };
}
const GENERIC_PICS = pictureRules();

// 图片状态：图片编号 → 正在显示的图名
//   shows：按顺序记下每一次「#图」显示的图（第 N 个 = 图片N），用来按顺序关图
const newPicState = from => ({ slots: new Map(from ? from.slots : []), last: from ? from.last : null, shows: from ? from.shows.slice() : [] });

const fmtSec = frames => String(Math.round((Number(frames) / 60) * 100) / 100);
const clone = o => JSON.parse(JSON.stringify(o));
const sameCmds = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 编辑框文字 → 片段（只看结构，不解析内容）
function segmentText(text) {
  const segs = [];
  let cur = null;
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^[＋+]/.test(t)) {
      const content = line.replace(/^\s*[＋+]/, '');
      if (cur && cur.kind === 'say') { cur.lines.push(content); cur.text += '\n＋' + content; continue; }
      segs.push(cur = { kind: 'orphan', text: '＋' + content });
      continue;
    }
    if (/^[#＃]/.test(t)) {
      if (/^[#＃]\s*选项[\s:：]/.test(t)) { segs.push(cur = { kind: 'choice', text: t }); continue; }
      if (cur && cur.kind === 'choice' && /^[#＃]\d+(\s|$)/.test(t)) { cur.text += '\n' + t; continue; }
      segs.push(cur = { kind: 'mark', text: t });
      continue;
    }
    segs.push(cur = { kind: 'say', first: line, lines: [], text: line });
  }
  return segs;
}

// 「名字：台词」→ { speaker, text }；规则和 story-form 的 parseScript 一致，但不去掉台词里的空格
// （有些旁白靠行首全角空格排版）。tpl = 这一句原来的样子：
//   原来是「纱耶：……」就认原来的名字；原来是旁白，只有写的是认识的名字才算换成人物台词，
//   否则「注意：前方危险」这种旁白改一个字就会变成名叫「注意」的人在说话。
function parseSayLine(line, tpl, known) {
  if (tpl && tpl.speaker && line.startsWith(tpl.speaker + '：')) return { speaker: tpl.speaker, text: line.slice(tpl.speaker.length + 1) };
  const narr = /^\s*[：:](.*)$/.exec(line);
  if (narr) return { speaker: '', text: narr[1] };
  const m = /^\s*([^：:]{1,12})[：:](.*)$/.exec(line);
  if (m && m[1].trim() && !(tpl && !tpl.speaker && !known(m[1].trim()))) return { speaker: m[1].trim(), text: m[2] };
  return { speaker: '', text: line };
}

// 没有名字框的引擎（MV）：整行都是台词，只认「：」开头的旁白写法
function parseNarration(line) {
  const narr = /^\s*[：:](.*)$/.exec(line);
  return { speaker: '', text: narr ? narr[1] : line };
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createMerger(ctx) {
  const P = ctx.pics || GENERIC_PICS;
  const { isClearAll, editableAt, picApply, blockRange, nextPicId } = P;
  const nameBox = ctx.nameBox !== false;   // MV 没有名字框：「名字：」只能留在台词里
  // \N[4] → 角色名（没有名字的保持原样）
  const nameOf = id => { const t = '\\N[' + id + ']', n = ctx.actorName(t); return n && n !== t ? n : ''; };
  const expandN = s => String(s).replace(/\\N\[(\d+)\]/gi, (m, id) => nameOf(id) || m);
  // 这些台词里出现过的 \N[n]：名字 → 原来的写法
  const tokensOf = lines => {
    const m = new Map();
    for (const l of lines) for (const x of String(l).matchAll(/\\N\[(\d+)\]/gi)) { const n = nameOf(x[1]); if (n && !m.has(n)) m.set(n, x[0]); }
    return m;
  };
  const toRaw = (text, map) => {
    const names = [...map.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    return names.length ? text.replace(new RegExp(names.map(escRe).join('|'), 'g'), m => map.get(m)) : text;
  };
  const OTHER_KIND = { 231: 'pic', 235: 'clear', 355: 'clear', 230: 'wait', 121: 'switch', 122: 'var', 126: 'item', 201: 'transfer',
    221: 'fade', 222: 'fade', 223: 'tint', 225: 'shake', 241: 'bgm', 242: 'bgm', 245: 'bgs', 246: 'bgs', 250: 'se', 213: 'balloon', 117: 'call', 211: 'transparent', 322: 'look', 214: 'erase', 123: 'selfsw', 354: 'title',
    204: 'camera', 224: 'flash', 236: 'weather' };
  const STAGING = new Set(['fade', 'tint', 'shake', 'bgm', 'bgs', 'se', 'balloon', 'caption', 'call', 'transparent', 'look', 'erase', 'selfsw', 'title', 'camera', 'flash', 'weather', 'float', 'act']);

  // 一条非台词指令在编辑框里的那一行；确认「这一行再解析回去」能得到同样的核心内容，否则写成 #原样
  function otherLine(c) {
    const p = c.parameters || [];
    const cands = [];
    const ref = (kind, id) => [ctx.refText(kind, id), String(id)];
    switch (c.code) {
      case 231: cands.push('#图 ' + p[1]); break;
      case 230: cands.push('#等待 ' + fmtSec(p[0])); break;
      case 121: if (p[0] === p[1]) for (const r of ref('switch', p[0])) cands.push('#开关 ' + r + ' ' + (p[2] === 0 ? '开' : '关')); break;
      case 122: if (p[0] === p[1] && p[3] === 0 && OPS[p[2]]) for (const r of ref('var', p[0])) cands.push('#变量 ' + r + ' ' + OPS[p[2]] + ' ' + p[4]); break;
      case 126: if (p[2] === 0 && Number(p[3]) >= 1) for (const r of ref('item', p[0])) cands.push('#物品 ' + r + ' ' + (p[1] === 0 ? '+' : '-') + p[3]); break;
      case 201: if (p[0] === 0) for (const r of ref('map', p[1])) cands.push('#传送 ' + r + ' ' + p[2] + ' ' + p[3]); break;
    }
    for (const line of cands) {
      let it;
      try { it = (ctx.parseScript(line) || [])[0]; } catch { continue; }
      if (it && sameCore(it, c)) return line;
    }
    return KEEP + ctx.describe(c);
  }

  function sameCore(it, c) {
    const p = c.parameters || [];
    switch (c.code) {
      case 231: return it.type === 'pic' && it.name === p[1];
      case 230: return it.type === 'wait' && Math.max(1, Math.round(it.sec * 60)) === p[0];
      case 121: return it.type === 'switch' && it.id === p[0] && it.on === (p[2] === 0);
      case 122: return it.type === 'var' && it.id === p[0] && it.op === p[2] && it.value === p[4];
      case 126: return it.type === 'item' && it.id === p[0] && it.add === (p[1] === 0) && it.count === p[3];
      case 201: return it.type === 'transfer' && it.map === p[1] && it.x === p[2] && it.y === p[3];
    }
    return false;
  }

  // 原指令 → 片段
  // 清图那一行：写成「#清图 图片N」= 关掉第 N 个 #图 显示的那张；推算不出来（图是在这段外面显示的）就写成 #原样
  function clearLine(c, st) {
    if (isClearAll(c)) return '#清图';
    const id = c.parameters[0], name = st.slots.get(id);
    let k = -1;
    for (let i = st.shows.length - 1; i >= 0; i--) if (st.shows[i].id === id) { k = i; break; }
    if (name != null && k >= 0 && st.shows[k].name === name) {
      const line = '#清图 图片' + (k + 1);
      let it = null;
      try { it = (ctx.parseScript(line) || [])[0]; } catch { }
      if (it && it.type === 'clear' && it.order === k + 1) return line;
    }
    return KEEP + ctx.describe(c);
  }

  // 演出行 / 立绘行：再解析回去必须得到一模一样的指令，否则不用这种写法
  function checkLine(line, c, st) {
    let it = null;
    try { it = (ctx.parseScript(line) || [])[0]; } catch { return false; }
    if (!it) return false;
    try {
      let cmds;
      if (it.type === 'bust') cmds = ctx.bustCommands(it, newPicState(st));
      else if (it.type === 'unbust') cmds = ctx.unbustCommands(it, newPicState(st));
      else cmds = ctx.stagingCommand(it);
      if (!cmds) return false;
      // 只认一行 = 一条指令（立绘换位置会拆成「#退场」+「#立绘」两行，各自核对）
      return cmds.length === 1 && sameCmds({ ...cmds[0], indent: c.indent }, c);
    } catch { return false; }
  }

  function segmentsOf(list, first, last, st) {
    st = st || newPicState();
    const segs = [];
    let i = first;
    while (i <= last) {
      const c = list[i];
      if (c.code === 101 || c.code === 401) {
        const raw = [];
        let head = null;
        if (c.code === 101) { head = c; raw.push(c); i++; }
        const lines = [];
        while (i <= last && list[i].code === 401) { lines.push(String(list[i].parameters[0] ?? '')); raw.push(list[i]); i++; }
        const speakerRaw = head ? String(head.parameters[4] || '') : '';
        const speaker = ctx.actorName(speakerRaw);
        // 旁白的第一行如果是空的、带冒号、或以 # ＋ ■ │ 开头，前面加「：」表示「这是旁白」，免得被当成名字或标记
        const shown = lines.map(expandN);   // 编辑框里显示角色名，不显示 \N[n]
        const first = shown.length ? shown[0] : '';
        const narrEsc = !speaker && (first === '' || /^\s*[#＃＋+■│：:]/.test(first) || /^\s*[^：:]{1,12}[：:]/.test(first));
        const text0 = speaker ? speaker + '：' + first : (narrEsc ? '：' : '') + first;
        let text = text0 + shown.slice(1).map(l => '\n＋' + l).join('');
        if (text != null && /\n/.test(lines.join(''))) text = null;   // 台词里本身带换行：编辑框表达不了
        // 画面中间暗底、没有名字没有头像 = 字幕
        const hp = head ? head.parameters : null;
        if (hp && !hp[0] && hp[2] === 1 && hp[3] === 1 && !speakerRaw && lines.length && lines.length <= 4 && text != null && ctx.stagingLine) {
          const cap = '#字幕 ' + shown.map(l => l.replace(/^　+/, '')).join('｜');
          let it = null;
          try { it = (ctx.parseScript(cap) || [])[0]; } catch { }
          // 再变回指令必须一模一样（居中垫的空格也要对得上）
          const back = it && it.type === 'caption' ? ctx.stagingCommand(it).slice(1).map(c => c.parameters[0]) : null;
          if (back && back.join('\n') === lines.join('\n') && !/[｜|]/.test(lines.join(''))) { segs.push({ kind: 'caption', head, speakerRaw, speaker, lines, raw, text: cap }); continue; }
        }
        segs.push({ kind: 'say', head, speakerRaw, speaker, lines, raw, text });
        continue;
      }
      if (isStageCmd(c)) {
        // 插件指令 + 续行算一行；再解析回去必须一模一样（续行也算），否则写成 #原样
        const raw = [c];
        let k = i + 1;
        if (c.code === 357) while (k <= last && list[k].code === 657) raw.push(list[k++]);
        const sl = ctx.stagingLine ? ctx.stagingLine(c, st) : '';
        let it = null, ok = false;
        try { it = sl ? (ctx.parseScript(sl) || [])[0] : null; const back = it ? ctx.stagingCommand(it) : null; ok = !!back && back.length === raw.length && back.every((b, n) => sameCmds({ ...b, indent: raw[n].indent }, raw[n])); } catch { ok = false; }
        segs.push({ kind: ok ? it.type : 'other', raw, text: ok ? sl : KEEP + ctx.describe(c) });
        i = k;
        continue;
      }
      let text = null, kind = OTHER_KIND[c.code];
      const sl = ctx.stagingLine ? ctx.stagingLine(c, st) : '';
      if (sl && checkLine(sl, c, st)) { text = sl; if (c.code === 231) kind = 'bust'; if (c.code === 235) kind = 'unbust'; }
      if (text == null) text = (c.code === 235 || c.code === 355) ? clearLine(c, st) : otherLine(c);
      picApply(st, c);
      segs.push({ kind, raw: [c], text });
      i++;
    }
    return segs;
  }

  function analyze(list, opts = {}) {
    const range = blockRange(list);
    if (!range) return { editable: false, empty: true, range: null, segments: [], text: '', display: '' };
    if (!range.contiguous) return { editable: false, range, segments: [], text: '', display: '', reason: '台词中间夹着选项/条件/脚本等指令' };
    const segments = segmentsOf(list, range.first, range.last, newPicState(opts.picState));
    const display = segments.map(s => (s.text != null ? s.text : '（空的对话框）')).join('\n');
    if (segments.some(s => s.text == null)) return { editable: false, range, segments, text: '', display, reason: '有编辑框表达不了的台词（空的首行或换行）' };
    const text = segments.map(s => s.text).join('\n');
    // 自检：这份文字再切回片段，必须和原片段一一对应，否则不开放整段编辑
    const back = segmentText(text);
    if (back.length !== segments.length || back.some((b, k) => b.text !== segments[k].text)) {
      return { editable: false, range, segments, text: '', display, reason: '有台词以 # 或 ＋ 开头，和编辑框写法冲突' };
    }
    return { editable: true, range, segments, text, display: text };
  }

  // 最长公共子序列：返回 [[i, j], ...]
  function lcs(A, B) {
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i].text === B[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i].text === B[j].text) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  // 把编辑框文字合并回指令。返回 { list: 新的整段指令, unchanged }
  function merge(list, text, opts = {}) {
    const an = opts.analysis || analyze(list, { picState: opts.pic });
    if (an.range && !an.editable) throw new Error('这段不能整段改：' + (an.reason || '结构复杂'));
    const ind = opts.indent || 0;
    const A = an.segments || [];
    const B = segmentText(text);
    const origBlock = an.range ? list.slice(an.range.first, an.range.last + 1) : [];

    // 1) 对齐：没改的片段
    const srcOf = new Array(B.length).fill(-1);
    const used = new Array(A.length).fill(false);
    for (const [i, j] of lcs(A, B)) { srcOf[j] = i; used[i] = true; }
    // 2) 挪了位置的片段：文字一模一样就搬原指令
    for (let j = 0; j < B.length; j++) {
      if (srcOf[j] >= 0) continue;
      const i = A.findIndex((a, k) => !used[k] && a.text === B[j].text);
      if (i >= 0) { srcOf[j] = i; used[i] = true; }
    }
    // 3) 改过的片段：在同一个空档里按顺序找同类原片段当模板（沿用头像/图片位置等设置）
    const tplOf = new Array(B.length).fill(null);
    const gapStart = j => { let i = -1; for (let k = j - 1; k >= 0; k--) if (srcOf[k] >= 0) { i = srcOf[k]; break; } return i + 1; };
    const gapEnd = j => { for (let k = j + 1; k < B.length; k++) if (srcOf[k] >= 0) return srcOf[k]; return A.length; };
    for (let j = 0; j < B.length; j++) {
      if (srcOf[j] >= 0) continue;
      const lo = gapStart(j), hi = gapEnd(j);
      let want = B[j].kind === 'say' ? 'say' : null;
      if (B[j].kind === 'mark') {
        let it = null;
        try { it = (ctx.parseScript(B[j].text) || [])[0]; } catch { }
        if (it && it.type !== 'say') want = it.type;
        B[j].item = it;
      }
      if (!want) continue;
      for (let i = lo; i < hi && i < A.length; i++) {
        if (used[i] || A[i].kind !== want) continue;
        tplOf[j] = A[i]; used[i] = true; break;
      }
      if (!tplOf[j]) B[j].gapPos = lo;
    }

    // 4) 逐段输出
    const out = [];
    const st = newPicState(opts.pic);
    const emit = cmds => { for (const c of cmds) { out.push(c); picApply(st, c); } };
    const at = c => ({ ...c, indent: ind + (c.indent || 0) });

    const knownSpeaker = name => A.some(a => a.kind === 'say' && a.speaker === name) || !!ctx.actorIdByName(name);
    const speakerRawFor = (speaker, pos) => {
      if (!speaker) return '';
      const same = A.filter(a => a.kind === 'say' && a.head && a.speaker === speaker);
      if (same.length) return nearest(same, pos).speakerRaw;
      const id = ctx.actorIdByName(speaker);
      return id ? '\\N[' + id + ']' : speaker;
    };
    const nearest = (arr, pos) => arr.reduce((best, a) => (Math.abs(A.indexOf(a) - pos) < Math.abs(A.indexOf(best) - pos) ? a : best), arr[0]);
    const styleFor = (tpl, speakerRaw, pos) => {
      if (tpl && tpl.head) return tpl.head.parameters.slice(0, 4);
      const same = A.filter(a => a.kind === 'say' && a.head && a.speakerRaw === speakerRaw);
      if (same.length) return nearest(same, pos).head.parameters.slice(0, 4);
      const any = A.filter(a => a.kind === 'say' && a.head);
      if (any.length) { const h = nearest(any, pos).head.parameters; return ['', 0, h[2], h[3]]; }
      return (ctx.defaultStyle || ['', 0, 0, 2]).slice(0, 4);
    };

    for (let j = 0; j < B.length; j++) {
      const seg = B[j];
      if (srcOf[j] >= 0) { emit(A[srcOf[j]].raw); continue; }
      const tpl = tplOf[j];
      const pos = tpl ? A.indexOf(tpl) : (seg.gapPos ?? A.length);
      if (seg.kind === 'orphan') throw new Error('「＋」开头的行要接在一句台词后面：' + seg.text);
      if (seg.kind === 'say') {
        const { speaker, text: first } = nameBox ? parseSayLine(seg.first, tpl, knownSpeaker) : parseNarration(seg.first);
        // 名字换回 \N[n]：这句原来是 \N[n] 的换回去；原来写的就是名字的保持名字；新句子按这一页的习惯
        const nmap = new Map(tpl ? tokensOf(tpl.lines) : []);
        const tplRaw = tpl ? tpl.lines.join('\n') : '';
        for (const [n, t] of (opts.nameMap || tokensOf(A.filter(a => a.kind === 'say').flatMap(a => a.lines)))) if (!nmap.has(n) && !tplRaw.includes(n)) nmap.set(n, t);
        const lines = [first, ...seg.lines].map(t => toRaw(t, nmap));
        if (lines.some(l => l.length > 500)) throw new Error('有一句超过 500 字，拆成几句吧');
        const speakerRaw = tpl && tpl.head && tpl.speaker === speaker ? tpl.speakerRaw : speakerRawFor(speaker, pos);
        const style = styleFor(tpl, speakerRaw, pos);
        emit([{ code: 101, indent: ind, parameters: nameBox ? [...style, speakerRaw] : style }, ...lines.map(t => ({ code: 401, indent: ind, parameters: [t] }))]);
        continue;
      }
      if (seg.kind === 'choice') {
        const items = ctx.parseScript(seg.text);
        if (items.length !== 1 || items[0].type !== 'choice') throw new Error('选项写法不对：' + seg.text.split('\n')[0] + '（例：#选项 去 | 不去，下面用 #1 #2 写各自的内容）');
        emit(ctx.scriptCommands(items).map(at));
        continue;
      }
      // # 标记
      if (seg.text.startsWith(KEEP.trim())) throw new Error('「#原样」行只能删除或挪位置，不能改内容：' + seg.text);
      const it = seg.item || (ctx.parseScript(seg.text) || [])[0];
      if (!it || it.type === 'say') throw new Error('看不懂这一行：' + seg.text + '（# 开头的只能是 #图 #清图 #等待 #开关 #变量 #物品 #传送 #选项，演出 #淡出 #淡入 #音乐 #停音乐 #环境音 #音效 #色调 #震动 #气泡 #字幕 #透明 #行走图 #镜头 #天气 #闪光，人物 #飘字 #动作，立绘 #立绘 #退场，#场景）');
      if (it.type === 'bust' || it.type === 'unbust') {
        if (it.type === 'bust' && !ctx.picExists(it.who ? '立绘/' + it.who + '_' + it.face : '')) throw new Error('立绘不存在：img/pictures/立绘/' + it.who + '_' + it.face + '（先把图放进去，或者用「导入素材」）');
        emit((it.type === 'bust' ? ctx.bustCommands(it, st) : ctx.unbustCommands(it, st)).map(at));
        continue;
      }
      if (it.type === 'caption') {
        const cmds = ctx.stagingCommand(it);
        if (tpl && tpl.head) cmds[0].parameters = [...tpl.head.parameters];
        emit(cmds.map(at));
        continue;
      }
      if (STAGING.has(it.type)) {
        const cmds = ctx.stagingCommand(it);
        // 改的是原来那一行：声音沿用原来的声像 / 音调
        if (tpl && tpl.raw[0] && [241, 245, 250].includes(tpl.raw[0].code) && cmds[0].parameters[0] && tpl.raw[0].code === cmds[0].code) {
          const o = tpl.raw[0].parameters[0] || {};
          cmds[0].parameters[0] = { ...cmds[0].parameters[0], pan: o.pan || 0, pitch: o.pitch == null ? 100 : o.pitch };
        }
        emit(cmds.map(at));
        continue;
      }
      if (it.type === 'pic') {
        if (!ctx.picExists(it.name)) throw new Error('台词里的图不存在：' + it.name);
        // 同一张已经在显示：不重复显示，但顺序里还是算一张（编辑框里每个 #图 都是一个「图片N」）
        const showing = [...st.slots.entries()].find(([, v]) => v === it.name);
        if (showing) { st.shows.push({ id: showing[0], name: it.name }); continue; }
        // 改的是原来某一行 #图：留在原来那一层；新加的 #图：叠在最上面
        const params = tpl && tpl.raw[0].code === 231 ? clone(tpl.raw[0].parameters) : [nextPicId(st.slots), it.name, 0, 0, 0, 0, 100, 100, 255, 0];
        params[1] = it.name;
        emit([{ code: 231, indent: ind, parameters: params }]);
      } else if (it.type === 'clear') {
        if (it.order) {
          const e = st.shows[it.order - 1];
          if (!e) throw new Error(`「${seg.text}」：前面只有 ${st.shows.length} 个 #图，没有图片${it.order}（按编辑框里 #图 出现的顺序从 1 数）`);
          if (st.slots.get(e.id) !== e.name) throw new Error(`「${seg.text}」：图片${it.order}（${e.name}）已经不在屏幕上了`);
          emit([{ code: 235, indent: ind, parameters: [e.id] }]);
        } else if (it.name) {
          const ids = [...st.slots.entries()].filter(([, v]) => v === it.name).map(([k]) => k);
          if (!ids.length) throw new Error('「#清图 ' + it.name + '」：这张图现在没在显示，关不了');
          emit([{ code: 235, indent: ind, parameters: [ids[ids.length - 1]] }]);
        } else if (P.mode === 'script') emit([{ code: 355, indent: ind, parameters: [P.CLEAR_ALL] }]);   // 只写 #清图 = 关闭全部剧情图片
        else {
          // 通用：只关这一页自己显示、还没关的图（立绘不算，立绘用 #退场 收）
          const ids = [...st.slots.entries()].filter(([, v]) => !isBust(v)).map(([k]) => k);
          if (!ids.length) throw new Error('「#清图」：这一页前面没有还在显示的图。别处显示的图要保留原来那行「#原样 关闭图片」');
          emit(ids.map(id => ({ code: 235, indent: ind, parameters: [id] })));
        }
      } else if (it.type === 'wait') {
        emit([{ code: 230, indent: ind, parameters: [Math.max(1, Math.round(it.sec * 60))] }]);
      } else {
        const kind = { switch: 'switch', var: 'var', item: 'item', transfer: 'map' }[it.type];
        const id = it.type === 'transfer' ? it.map : it.id;
        if (!kind || !ctx.exists(kind, id)) throw new Error('找不到这个名字：' + seg.text);
        const cmds = ctx.scriptCommands([it]).map(at);
        if (it.type === 'transfer' && tpl) { cmds[0].parameters[4] = tpl.raw[0].parameters[4] || 0; cmds[0].parameters[5] = tpl.raw[0].parameters[5] || 0; }
        emit(cmds);
      }
    }

    // 5) 原来这段结束时没有图在显示，现在多了一张：补一条清图，免得盖住画面
    const st0 = newPicState(opts.pic);
    for (const c of origBlock) picApply(st0, c);
    if (opts.autoClear !== false && !opts.pic && st.slots.size && !st0.slots.size) emit([...st.slots.keys()].map(id => ({ code: 235, indent: ind, parameters: [id] })));

    return { list: out, unchanged: sameCmds(out, origBlock) };
  }

  // ---------- 整页编辑：■ 结构行 + 区域 ----------
  // 一页指令切成：run（连续、同缩进的可编辑指令）/ anchor（一条结构指令 + 它的续行，
  // 前面挂着分支结尾的 code 0）/ tail（整页最后的结束标记）
  function listElements(list) {
    const els = [];
    let i = 0;
    while (i < list.length) {
      const c = list[i];
      if (editableAt(list, i)) {
        let j = i;
        while (j < list.length && editableAt(list, j) && (list[j].indent || 0) === (c.indent || 0)) j++;
        els.push({ type: 'run', start: i, end: j - 1, indent: c.indent || 0 });
        i = j; continue;
      }
      let j = i;
      while (j < list.length && list[j].code === 0) j++;
      if (j >= list.length) { els.push({ type: 'tail', start: i, end: j - 1 }); break; }
      if (editableAt(list, j)) {
        // 中间多出来的结束标记（有些移植脚本会留下）：当成一行结构显示，原样保留
        els.push({ type: 'anchor', start: i, head: i, end: j - 1, indent: list[i].indent || 0, code: 0, line: ANCHOR + ' 结束标记' });
        i = j; continue;
      }
      let k = j + 1;
      while (k < list.length && CONT.has(list[k].code)) k++;
      // 选项：「■ 选项」一行（选项的字写在下面每个「■ 选了「…」」里，那一行可以改字、加、删）
      const line = list[j].code === 102 ? choiceHead(list[j].parameters[0])
        : list[j].code === 402 ? choiceLine(list[j].parameters[1])
          : ANCHOR + ' ' + oneLine(ctx.anchorText(list[j], list.slice(j, k)));
      els.push({ type: 'anchor', start: i, head: j, end: k - 1, indent: list[j].indent || 0, code: list[j].code, line, label: list[j].code === 402 ? String(list[j].parameters[1] ?? '') : null });
      i = k;
    }
    return els;
  }

  const picState = cmds => { const st = newPicState(); for (const c of cmds) picApply(st, c); return st; };

  function analyzeList(list, opts = {}) {
    list = list || [];
    const base = opts.baseIndent != null ? opts.baseIndent : (list.length ? Math.min(...list.map(c => c.indent || 0)) : 0);
    const els = listElements(list);
    const regions = [{ run: null, prev: null, next: null }];
    let reason = '';
    for (const el of els) {
      const cur = regions[regions.length - 1];
      if (el.type === 'run') { if (cur.run) reason = reason || '同一处有两段缩进不同的台词'; else cur.run = el; }
      else if (el.type === 'anchor') { cur.next = el; regions.push({ run: null, prev: el, next: null }); }
      else if (el.type === 'tail') cur.next = el;
      else reason = reason || '结构不规则（中间有多余的结束标记）';
    }
    const anchors = els.filter(e => e.type === 'anchor');
    const bar = ind => BAR.repeat(Math.max(0, (ind || 0) - base));
    const out = [];
    for (const r of regions) {
      if (r.run) {
        r.an = analyze(list.slice(r.run.start, r.run.end + 1), { picState: picState(list.slice(0, r.run.start)) });
        if (!r.an.editable) reason = reason || r.an.reason;
        for (const l of r.an.display.split('\n')) out.push(bar(r.run.indent) + l);
      }
      if (r.next && r.next.type === 'anchor') out.push(bar(r.next.indent) + r.next.line);
    }
    const al = { editable: !reason, reason, text: out.join('\n'), regions, anchors, base, single: !anchors.length };
    if (al.editable) {
      // 自检：这份文字原样合并回去必须一字不差，否则只读
      try { if (!mergeList(list, al.text, { analysis: al }).unchanged) { al.editable = false; al.reason = '自检没通过'; } }
      catch (e) { al.editable = false; al.reason = '自检没通过：' + e.message; }
    }
    return al;
  }

  // 合并整页。■ 结构行原样保留，只有选项可以改：
  //   · 「■ 选了「…」」那一行改字 = 改这个选项的字（显示选项里的和分支上的一起改）
  //   · 照着写一行「■ 选了「…」」= 加一个选项（下面写它的台词）；删掉这一行和它下面的内容 = 删掉这个选项
  //   其它 ■ 行（含「■ 选项」「■ 按取消时」「■ 选项结束」）必须和原来一一对应。
  // 做法：原来的 ■ 行和编辑框里的 ■ 行各自按「选项 → 分支 → 里面的内容」建成树，一层层对齐；
  //   同一个选项的分支按字对齐（最长公共子序列），对不上的按位置配对（= 改了字，里面的 ■ 行要对得上），
  //   多出来的是新选项，少了的是删掉的选项（连同里面所有指令）。选项变了就重写选项列表、分支编号，取消 / 默认选项跟着挪。
  function mergeList(list, text, opts = {}) {
    list = list || [];
    const al = opts.analysis || analyzeList(list, opts);
    const nameMap = tokensOf(list.filter(c => c.code === 401).map(c => c.parameters[0]));
    if (!al.editable) throw new Error('这段不能整段改：' + (al.reason || '结构复杂'));
    // ---- 切文字：内容段 + ■ 行 ----
    const parts = [[]], T = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach((raw, n) => {
      const s = stripBar(raw), t = s.trim();
      if (t.startsWith(ANCHOR)) {
        const m = CHOICE_RE.exec(t);
        if (!m && /^■\s*选了/.test(t)) throw new Error(`第 ${n + 1} 行「${t}」：选项要写成「■ 选了「选项的字」」`);
        T.push({ line: t, n: n + 1, label: m ? m[1] : null });
        parts.push([]); return;
      }
      parts[parts.length - 1].push(s);
    });
    const E = al.anchors;
    const STRUCT = '带 ■ 的行是原来的结构（条件、插件、音效、选项的开头和结尾等），不能修改、删除或挪动；选项只能改「■ 选了「…」」那一行、加一行或删掉。';
    const wrong = (t, e) => new Error(t ? `${STRUCT}第 ${t.n} 行「${t.line}」` + (e ? `，这里应该是「${e.line}」` : /^■\s*(选项|按取消)/.test(t.line) ? '：这一行只能是「■ 选项…」「■ 按取消时」「■ 选项结束」' : '是多出来的（删选项时要把它下面套着的 ■ 行也一起删掉）') : '带 ■ 的结构行不能删除：少了「' + e.line + '」');

    // ---- 原来的选项：每个分支 / 按取消时 / 选项结束属于哪个「显示选项」 ----
    const blockOf = new Map(), blocks = [];
    {
      const st = [];
      for (const e of E) {
        const top = st[st.length - 1];
        if (e.code === 102) { const b = { e, ind: e.indent, branches: [] }; blocks.push(b); blockOf.set(e, b); st.push(b); }
        else if ((e.code === 402 || e.code === 403 || e.code === 404) && top && top.ind === e.indent) {
          blockOf.set(e, top);
          if (e.code === 402) top.branches.push(e);
          if (e.code === 404) st.pop();
        }
      }
    }
    // 原来的 ■ 行建成树：{ fixed } / { b, head, branches: [{ e, items }], cancel, end }
    const treeE = () => {
      let pos = 0;
      const seq = () => {
        const items = [];
        while (pos < E.length) {
          const e = E[pos], b = blockOf.get(e);
          if (b && e.code !== 102) return items;
          if (b) { items.push(block(b)); continue; }
          items.push({ fixed: e }); pos++;
        }
        return items;
      };
      const block = b => {
        const node = { b, head: E[pos++], branches: [], cancel: null, end: null };
        while (pos < E.length) {
          const e = E[pos];
          if (blockOf.get(e) !== b) throw new Error('malformed');
          pos++;
          if (e.code === 402) node.branches.push({ e, items: seq() });
          else if (e.code === 403) node.cancel = { e, items: seq() };
          else { node.end = e; return node; }
        }
        throw new Error('malformed');
      };
      const items = seq();
      if (pos < E.length) throw new Error('malformed');
      return items;
    };
    // 编辑框里的 ■ 行建成树
    const treeT = () => {
      for (const t of T) if (/^■\s*(选项|按取消)/.test(t.line) && !HEAD_RE.test(t.line) && !['■ 选项结束', '■ 按取消时'].includes(t.line)) throw wrong(t, null);
      let pos = 0;
      const isBranch = t => t.label != null || t.line === '■ 按取消时' || t.line === '■ 选项结束';
      const seq = inBlock => {
        const items = [];
        while (pos < T.length) {
          const t = T[pos];
          if (HEAD_RE.test(t.line)) { pos++; items.push(block(t)); continue; }
          if (isBranch(t)) { if (inBlock) return items; throw new Error(`第 ${t.n} 行「${t.line}」：这一行要放在「■ 选项」和「■ 选项结束」之间，不能放进条件、循环里面`); }
          items.push({ fixed: t }); pos++;
        }
        return items;
      };
      const block = head => {
        const node = { head, branches: [], cancel: null, end: null };
        const pre = seq(true);
        if (pre.length) { const t = pre[0].fixed || pre[0].head; throw new Error(`第 ${t.n} 行「${t.line}」：「■ 选项」下面要先是一个「■ 选了「…」」。删选项时，把它下面套着的 ■ 行也一起删掉`); }
        while (pos < T.length) {
          const t = T[pos++];
          if (t.label != null) {
            if (node.cancel) throw new Error(`第 ${t.n} 行「${t.line}」：选项要加在「■ 按取消时」前面`);
            node.branches.push({ t, items: seq(true) });
          } else if (t.line === '■ 按取消时') {
            if (node.cancel) throw new Error(`第 ${t.n} 行：一个选项只能有一个「■ 按取消时」`);
            node.cancel = { t, items: seq(true) };
          } else { node.end = t; return node; }
        }
        throw new Error(`第 ${head.n} 行的「■ 选项」少了对应的「■ 选项结束」`);
      };
      return seq(false);
    };

    // ---- 对齐 ----
    const matchE = new Map();   // 编辑框里的 ■ 行 → 原来的那一条（新选项没有）
    const tBlock = new Map();   // 编辑框里的「■ 选了」→ 属于哪个原来的选项
    const dropped = new Set();  // 删掉的选项里的所有原来的 ■ 行
    const lineOf = it => (it.fixed || it.head);
    const dropAll = items => { for (const it of items) { if (it.fixed) dropped.add(it.fixed); else { dropped.add(it.head); dropped.add(it.end); for (const br of it.branches) { dropped.add(br.e); dropAll(br.items); } if (it.cancel) { dropped.add(it.cancel.e); dropAll(it.cancel.items); } } } };
    const alignSeq = (es, ts, m, tb, dr) => {
      for (let k = 0; k < Math.max(es.length, ts.length); k++) {
        const e = es[k], t = ts[k];
        if (!t) throw wrong(null, lineOf(e));
        if (!e) throw wrong(lineOf(t), null);
        if (e.fixed && t.fixed) { if (t.fixed.line !== e.fixed.line.trim()) throw wrong(t.fixed, e.fixed); m.set(t.fixed, e.fixed); continue; }
        if (e.b && t.head) { alignBlock(e, t, m, tb, dr); continue; }
        throw wrong(lineOf(t), lineOf(e));
      }
    };
    const alignBlock = (eb, tbk, m, tb, dr) => {
      // 「■ 选项（N 个）：…」只是列表：原样、按下面的「■ 选了」重新列的、或者只写「■ 选项」都行；在这一行里改字不算数，要说清楚
      const h = tbk.head.line;
      if (h !== eb.head.line.trim() && h !== '■ 选项' && h !== choiceHead(tbk.branches.map(x => x.t.label)).trim()) {
        throw new Error(`第 ${tbk.head.n} 行「${h}」：「■ 选项」这一行只是列出有哪些选项，在这里改字不算数；要改哪个选项，就改下面对应的「■ 选了「…」」那一行（这一行可以不动）`);
      }
      m.set(tbk.head, eb.head); m.set(tbk.end, eb.end);
      if (!!eb.cancel !== !!tbk.cancel) throw new Error(eb.cancel ? `「■ 按取消时」不能删除（第 ${tbk.end.n} 行前面）` : `第 ${tbk.cancel.t.n} 行「■ 按取消时」：不能新加`);
      if (eb.cancel) { m.set(tbk.cancel.t, eb.cancel.e); alignSeq(eb.cancel.items, tbk.cancel.items, m, tb, dr); }
      const es = eb.branches, ts = tbk.branches;
      const pairs = lcs(es.map(x => ({ text: x.e.label })), ts.map(x => ({ text: x.t.label })));
      // 字一样的分支：里面的 ■ 行要对得上
      const tryPair = (i, j) => {
        const m2 = new Map(), tb2 = new Map(), dr2 = new Set();
        try { alignSeq(es[i].items, ts[j].items, m2, tb2, dr2); } catch (err) { return err; }
        m.set(ts[j].t, es[i].e);
        for (const [a, b] of m2) m.set(a, b);
        for (const [a, b] of tb2) tb.set(a, b);
        for (const x of dr2) dr.add(x);
        return null;
      };
      const used = new Set(), usedT = new Set();
      for (const [i, j] of pairs) { const err = tryPair(i, j); if (err) throw err; used.add(i); usedT.add(j); }
      // 夹在两个对上的分支之间、没对上的：按位置配对（改了字）；里面的 ■ 行对不上就算删一个、加一个
      const bounds = [[-1, -1], ...pairs, [es.length, ts.length]];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const ue = [], ut = [];
        for (let i = bounds[k][0] + 1; i < bounds[k + 1][0]; i++) ue.push(i);
        for (let j = bounds[k][1] + 1; j < bounds[k + 1][1]; j++) ut.push(j);
        for (let q = 0; q < Math.min(ue.length, ut.length); q++) if (!tryPair(ue[q], ut[q])) { used.add(ue[q]); usedT.add(ut[q]); }
      }
      es.forEach((x, i) => { if (!used.has(i)) { dr.add(x.e); dropAll(x.items); } });
      ts.forEach((x, j) => {
        tb.set(x.t, eb.b);
        if (usedT.has(j)) return;
        // 新选项：下面只能写台词
        const bad = x.items[0];
        if (bad) { const t = lineOf(bad); throw new Error(`第 ${t.n} 行「${t.line}」：新加的选项下面只能写台词（带 ■ 的行是原来的结构，不能挪到别的选项下面）`); }
      });
    };
    let strict = false, eTree = null;
    try { eTree = treeE(); } catch { strict = true; }
    if (strict) {
      // 原来的选项结构不规整：不能改选项，所有 ■ 行必须一字不差
      for (let k = 0; k < Math.max(E.length, T.length); k++) {
        if (!T[k]) throw wrong(null, E[k]);
        if (!E[k] || T[k].line !== E[k].line.trim()) throw wrong(T[k], E[k] || null);
        matchE.set(T[k], E[k]);
      }
    } else alignSeq(eTree, treeT(), matchE, tBlock, dropped);

    // ---- 每个选项最后的样子 ----
    const plan = new Map();
    for (const b of strict ? [] : blocks) {
      const final = T.filter(t => tBlock.get(t) === b).map(t => ({ t, e: matchE.get(t) || null, label: t.label }));
      const changed = final.length !== b.branches.length || final.some((f, k) => !f.e || f.e !== b.branches[k] || f.label !== f.e.label);
      if (!changed || dropped.has(b.e)) continue;
      if (!final.length) throw new Error('选项至少要留一个（整段选项不能在这里删）');
      if (final.length > Math.max(MAX_CHOICES, b.branches.length)) throw new Error(`一个「显示选项」最多 ${MAX_CHOICES} 个选项，多了 RPG Maker 编辑器打不开；要更多就再加一个「#选项」`);
      const idxOf = new Map(final.filter(f => f.e).map(f => [list[f.e.head].parameters[0], final.indexOf(f)]));
      const p = clone(list[b.e.head].parameters);
      // 102 的选项列表和 402 的分支文字不一定一致（手工改过、插件生成、改了一半）：没改字的分支保留 102 原来的字，
      // 只写回真正改过的那一条，免得「改一句」把旁边没碰的选项一起改了。
      const origChoices = Array.isArray(p[0]) ? p[0] : [];
      p[0] = final.map(f => {
        if (!f.e || f.label !== f.e.label) return f.label;
        const i = Number(list[f.e.head].parameters[0]);
        return Number.isInteger(i) && origChoices[i] != null ? origChoices[i] : f.label;
      });
      const remap = v => (Number(v) >= 0 ? (idxOf.has(Number(v)) ? idxOf.get(Number(v)) : -1) : v);
      p[1] = remap(p[1]);
      p[2] = remap(p[2]);
      plan.set(b, { params: p, index: new Map(final.map((f, k) => [f.t, k])) });
    }
    // ---- 原来每段台词归到哪一段文字（删掉的选项里的台词一起删掉） ----
    const tOfE = new Map();
    T.forEach((t, k) => { const e = matchE.get(t); if (e) tOfE.set(e, k); });
    const runOf = parts.map(() => null);
    al.regions.forEach((r, k) => {
      if (!r.run) return;
      if (k === 0) { runOf[0] = r; return; }
      const e = E[k - 1];
      if (tOfE.has(e)) runOf[tOfE.get(e) + 1] = r;
    });
    // ---- 输出 ----
    const out = [];
    const open = new Map();   // 改过的选项 → 现在有没有没收尾的分支
    let ctxInd = al.base, afterHead = false;
    const emitPart = k => {
      const t = parts[k].join('\n'), r = runOf[k];
      const pic = al.single ? undefined : picState(out);
      if (r) out.push(...merge(list.slice(r.run.start, r.run.end + 1), t, { analysis: r.an, indent: r.run.indent, pic, nameMap }).list);
      else if (t.trim()) {
        if (afterHead) throw new Error('「■ 选项」下面不能直接写内容，要写在某个「■ 选了「…」」下面');
        out.push(...merge([], t, { indent: ctxInd, pic, nameMap }).list);
      }
    };
    emitPart(0);
    T.forEach((t, k) => {
      const e = matchE.get(t) || null;
      const b = e ? blockOf.get(e) : tBlock.get(t);
      const pl = b ? plan.get(b) : null;
      afterHead = false;
      if (e && e.code === 102 && b) {
        out.push(...list.slice(e.start, e.head), pl ? { ...list[e.head], parameters: pl.params } : list[e.head], ...list.slice(e.head + 1, e.end + 1));
        open.set(b, false);
        afterHead = true; ctxInd = e.indent;
      } else if (b && pl) {
        // 改过的选项：分支 / 按取消时 / 选项结束；前一个分支没收尾就补一个结束标记
        const zeros = e ? list.slice(e.start, e.head) : [];
        if (open.get(b)) out.push(...(zeros.length ? zeros : [{ code: 0, indent: b.ind + 1, parameters: [] }]));
        const code = e ? e.code : 402;
        if (code === 402) {
          const params = [pl.index.get(t), t.label];
          out.push(e ? { ...list[e.head], parameters: params } : { code: 402, indent: b.ind, parameters: params });
        } else out.push(...list.slice(e.head, e.end + 1));
        open.set(b, code !== 404);
        ctxInd = code === 404 ? b.ind : b.ind + 1;
      } else {
        out.push(...list.slice(e.start, e.end + 1));
        ctxInd = [111, 411, 112, 601, 602, 603, 402, 403].includes(e.code) ? e.indent + 1 : e.indent;
      }
      emitPart(k + 1);
    });
    const tail = al.regions[al.regions.length - 1].next;
    if (tail && tail.type === 'tail') out.push(...list.slice(tail.start, tail.end + 1));
    return { list: out, unchanged: sameCmds(out, list) };
  }

  return { analyze, merge, analyzeList, mergeList };
}

module.exports = { createMerger, pictureRules, segmentText, stripBar, newPicState, EDITABLE, ANCHOR, KEEP };
