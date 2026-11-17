'use strict';
// 编辑框里的「剧情脚本」写法 ↔ 指令（通用版：名字从工程里查，图片规则和对话框样式由调用方给）
//
//   名字：台词              一个对话框（不写名字 = 旁白）
//   ＋第二行                接在上一句的同一个对话框里
//   ：台词                  明确是旁白
//   #图 图片名              显示图片（叠在最上面）
//   #清图 / #清图 图片2 / #清图 图片名
//   #等待 1.5               停 1.5 秒
//   #开关 名字或编号 开/关
//   #变量 名字或编号 = + - * / % 数字
//   #物品 名字或编号 +1 / -1
//   #传送 地图名或编号 x y [朝上|朝下|朝左|朝右] [到了以后的步骤…]
//                           场景里还能写谁：#传送 圣佳 学校 10 5 前进3 = 换成圣佳演、传送过去、往前走 3 格；
//                           场景里传送过、扮演过别人，场景播完主角自动回到原来的地方、换回原来的样子；场景外的传送就是主角传送
//   #选项 去 | 不去         下面用 #1 #2 写各自的内容
//   演出：
//   #淡出 / #淡入            画面变黑 / 恢复
//   #音乐 名字 [音量]        放背景音乐（audio/bgm）；#停音乐 [秒] 渐渐停掉
//   #环境音 名字 [音量]      背景声音（audio/bgs，雨声、人声）；#停环境音 [秒]
//   #音效 名字 [音量]        音效（audio/se）
//   #色调 夜晚 [秒]          正常 / 夜晚 / 深夜 / 黄昏 / 回忆 / 灰暗 / 红；不写秒 = 1 秒
//   #震动 [强度]             画面震一下（1~9，默认 5）
//   #气泡 ！ [主角|本事件]   人物头上冒气泡：！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz
//   #字幕 文字               画面中间一条暗底的字（章节名、时间、地点）；几行用 ｜ 隔开
//   #立绘 人物 表情 [左|中|右]  显示立绘 img/pictures/立绘/人物_表情（底边贴着画面下沿）；同一个人再写一次 = 换表情 / 换位置
//   #退场 人物 / #退场       收起这个人的立绘 / 收起所有立绘
//   #场景 名字               在这里播另一个场景（调用公共事件），播完接着往下
//   #结算 组名               按顺序执行结算组里的开关与变量操作
//   #行走图 角色 图名 编号   换角色的行走图（现实 / 游戏里两套样子）
//   #透明 开 / #透明 关      主角隐身 / 现身（黑场、过场时用）
//   #消失                    这个事件先不见（离开地图再回来又在：打倒的怪、拿走的东西）
//   #独立开关 A 开           这个事件自己的开关（只播一次的剧情用）
//   #回到标题                结局放完回到标题画面
//   人物和镜头：
//   #飘字 [谁：]文字         字从人物头上一句一句飘起来再淡掉（不挡剧情）；谁 = 主角 / 本事件 / 画面 / 事件名字，不写 = 主角
//   #动作 谁 步骤… [不等]    按名字让人物动：上 下 左 右（上3）、前进3、转身、面向主角、背对主角、跳、后退、等0.5、气泡 ！ ？…
//   #扮演 谁 [行走图 编号]   只在场景里：主角的小人换成这个人（角色名 = 用这个角色的行走图；#扮演 主角 = 换回来）
//                            （#飘字 #动作 #扮演、带人的 #传送 是演出插件 RpgStudio_Stage 的插件指令，第一次用时编辑器自动把插件装进游戏）
//   #镜头 方向 格数 [速度]   镜头平移（上下左右，速度 1~6，默认 3），移完再往下
//   #天气 雨|暴雨|雪|无 [强度] [秒]
//   #闪光 [白|红] [秒]
//   #插件 插件名 指令名（值1，值2…）  直接写插件指令（MZ 的 357）：参数按插件里的顺序，没写的用插件里的默认值
//                           例：#插件 VisuMZ_2_VNPictureBusts Basic_ExitBusts（["50"]，-200）
const { newPicState } = require('./merge.js');
const stage = require('./stage.js');
const { isSettlement, settlementBody, settlementId, settlementRef } = require('./settlements.js');

// 色调预设：[红, 绿, 蓝, 灰]
const TINTS = { 正常: [0, 0, 0, 0], 夜晚: [-68, -68, 0, 68], 深夜: [-110, -110, -34, 102], 黄昏: [68, -34, -34, 0], 回忆: [34, -34, -68, 170], 灰暗: [-34, -34, -34, 170], 红: [68, -68, -68, 0] };
// 气泡编号（Balloon.png 的第几行）
const BALLOONS = { '！': 1, '!': 1, '？': 2, '?': 2, '♪': 3, '♥': 4, '怒': 5, '汗': 6, '乱': 7, '…': 8, '...': 8, '……': 8, '灯': 9, 'Zzz': 10, 'zzz': 10 };
const BALLOON_TEXT = ['', '！', '？', '♪', '♥', '怒', '汗', '乱', '…', '灯', 'Zzz'];
const BUST_DIR = '立绘/';
const BUST_POS = { 左: 0.22, 中: 0.5, 右: 0.78 };
const bustName = (who, face) => BUST_DIR + who + '_' + face;
const parseBustName = n => { const m = /^立绘\/(.+?)_([^/]+)$/.exec(String(n || '')); return m ? { who: m[1], face: m[2] } : null; };
const sameTone = (a, b) => (a || []).length === 4 && a.every((v, i) => Number(v) === b[i]);
// 字幕居中：前面垫全角空格（对话框一行大约 30 个汉字宽；英文、数字算半个）
const textWidth = t => [...String(t)].reduce((n, ch) => n + (/[\u0000-\u00ff]/.test(ch) ? 0.5 : 1), 0);
const centerPad = t => '　'.repeat(Math.max(0, Math.floor((30 - textWidth(t)) / 2)));
const tintName = tone => Object.keys(TINTS).find(k => sameTone(tone, TINTS[k])) || '';
const { DIRS, DIR_TEXT } = stage;
const WEATHERS = { 无: 'none', 晴: 'none', 雨: 'rain', 暴雨: 'storm', 雪: 'snow' };
const WEATHER_TEXT = { none: '无', rain: '雨', storm: '暴雨', snow: '雪' };
const FLASHES = { 白: [255, 255, 255, 170], 红: [255, 60, 60, 170] };
const flashName = c => Object.keys(FLASHES).find(k => sameTone(c, FLASHES[k])) || '';
// 步骤：「前进 3」「上 2」这种中间多打了空格的，并成「前进3」
const STEP_WORDS = new Set(['上', '下', '左', '右', '前进', '后退']);
function stepTokens(toks) {
  const out = [];
  for (const t of toks) {
    if (/^\d{1,2}$/.test(t) && out.length && STEP_WORDS.has(out[out.length - 1])) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}
const DIR_RE = /^面?朝(上|下|左|右)$/;
const secText = f => String(Math.round(Number(f) / 60 * 100) / 100);

const STEP_HELP = '能写：上 下 左 右 前进 后退（可带步数：上3、前进3）、靠近主角、远离主角、转上 转下 转左 转右、转身、面向主角、背对主角、跳、等0.5、速度1~6、慢、快、隐身、现身、穿透、不穿透，气泡 ！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz';

function createScript(project, opts = {}) {
  const P = project;
  const pics = opts.pics;
  const nameBox = opts.nameBox !== false;
  // 立绘的位置：横向按左 / 中 / 右，底边贴着画面下沿（要知道图多高：opts.picSize(名字) → {w, h}）
  const screen = () => { const a = (P.sys().advanced) || {}; return { w: Number(a.screenWidth) || 816, h: Number(a.screenHeight) || 624 }; };
  const picSize = n => { try { return (opts.picSize && opts.picSize(n)) || { w: 0, h: 0 }; } catch { return { w: 0, h: 0 }; } };
  // 立绘固定用剧情图片编号段最上面的三个号（左 = 最大，中、右往下），总在 CG 上面
  const bustId = pos => pics.max - ({ 左: 0, 中: 1, 右: 2 }[pos] || 0);
  function bustParams(who, face, pos) {
    const S = screen(), sz = picSize(bustName(who, face));
    const x = Math.round(S.w * BUST_POS[pos]), y = sz.h ? Math.round(S.h - sz.h / 2) : Math.round(S.h / 2);
    return [bustId(pos), bustName(who, face), 1, 0, x, y, 100, 100, 255, 0];
  }
  const posOfX = x => { const S = screen(); let best = '中', d = 1e9; for (const [k, f] of Object.entries(BUST_POS)) { const dd = Math.abs(S.w * f - x); if (dd < d) { d = dd; best = k; } } return best; };
  // 屏幕上正在显示的这个人的立绘：[图片编号, 图名]
  const bustSlotOf = (slots, who) => [...slots.entries()].find(([, v]) => { const b = parseBustName(v); return b && b.who === who; });
  const isBustId = id => id >= pics.max - 2 && id <= pics.max;
  const mz = opts.engine !== 'MV';
  // 插件指令（#插件）：参数表从 js/plugins/<插件名>.js 读；没有就写不了
  const pa = opts.pluginArgs || null;

  // 名字 → 编号：完全一致优先；只有一个包含它的也算
  function resolveRef(raw, kind) {
    const q = String(raw || '').trim();
    if (!q) return 0;
    if (/^\d+$/.test(q)) return Number(q);
    const groups = kind === 'ce' ? P.read('CommonEvents.json') || [] : [];
    const rows = P.rows(kind).filter(x => x.name && !isSettlement(groups[x.id]));
    const want = q.toLowerCase();
    const hit = rows.find(x => x.name.trim().toLowerCase() === want);
    if (hit) return hit.id;
    const part = rows.filter(x => x.name.toLowerCase().includes(want));
    return part.length === 1 ? part[0].id : 0;
  }
  // 编号 → 编辑框里写的名字：名字唯一才写名字，否则写编号
  function refText(kind, id) {
    const nm = P.name(kind, id).trim();
    if (!nm || /^\d+$/.test(nm)) return String(id);
    const first = P.rows(kind).find(x => x.name.trim().toLowerCase() === nm.toLowerCase());
    return first && first.id === Number(id) ? nm : String(id);
  }
  const exists = (kind, id) => P.has(kind, id);
  // 扮演 / 传送里的「谁」：数据库里名字完全一样的角色（游戏里按名字找行走图）
  const actorByName = who => (P.read('Actors.json') || []).find(a => a && String(a.name || '').trim() === String(who || '').trim()) || null;
  const isProtagonist = who => ['主角', '玩家'].includes(String(who || '').trim());

  // 「[谁] 地图 x y [朝向] [步骤…]」：最右边那一对整数是 x y（地图名里可以有数字和空格）；
  // 前面整串是地图名，认不出来再试「第一个词是谁、后面是地图名」
  function parseTransfer(rest) {
    const toks = stepTokens(String(rest).trim().split(/\s+/).filter(Boolean));
    let i = -1;
    for (let k = toks.length - 2; k >= 1; k--) {
      if (/^\d+$/.test(toks[k]) && /^\d+$/.test(toks[k + 1]) && toks.slice(k + 2).every(t => !/^\d+$/.test(t))) { i = k; break; }
    }
    if (i < 0) return null;
    const pre = toks.slice(0, i), post = toks.slice(i + 2);
    let dir = 0;
    const d = post.length ? DIR_RE.exec(post[0]) : null;
    if (d) { dir = DIRS[d[1]]; post.shift(); }
    let who = '', map = resolveRef(pre.join(' '), 'map');
    if (!map && pre.length >= 2) { who = pre[0]; map = resolveRef(pre.slice(1).join(' '), 'map'); }
    return { type: 'transfer', who, map, x: Number(toks[i]), y: Number(toks[i + 1]), dir, steps: post.join(' '), bad: post.filter(t => !stage.validStep(t)) };
  }

  // 条件（#如果 / #条件 后面那段）：
  //   变量 DayCount >= 3 · DayCount >= 3 · 变量 11 = 3 · 变量 天数 大于等于 3 · 开关 自由时间 开
  const COND_OP = { '=': 0, '==': 0, '>=': 1, '<=': 2, '>': 3, '<': 4, '!=': 5 };
  const COND_WORDS = [
    ['大于等于', '>='], ['不小于', '>='], ['小于等于', '<='], ['不大于', '<='], ['不等于', '!='],
    ['>=', '>='], ['<=', '<='], ['!=', '!='], ['≠', '!='], ['<>', '!='], ['==', '='],
    ['等于', '='], ['大于', '>'], ['小于', '<'], ['=', '='], ['>', '>'], ['<', '<'],
  ];
  // 找不到名字时给个"是不是某某"的提示（比如 天数 → DayCount）
  function nearName(kind, name) {
    const rows = P.rows(kind).filter(x => x.name);
    const q = String(name).trim().toLowerCase();
    const dayish = /天|日|day/.test(q);
    const hit = rows.find(x => {
      const n = x.name.toLowerCase();
      return (dayish && /day|天|日/.test(n)) || n.includes(q) || q.includes(n);
    });
    return hit ? hit.name : '';
  }
  // 一个条件 → 111 的参数（开关：[0,id,0|1]，变量：[1,id,0,值,比较]）
  function condOne(t, { strict, allowMissingTargets }) {
    for (const [word, sym] of COND_WORDS) {
      const at = t.lastIndexOf(word);
      if (at <= 0) continue;
      const name = t.slice(0, at).replace(/^变量\s*/, '').trim();
      const val = t.slice(at + word.length).trim();
      if (!name || !/^-?\d+$/.test(val)) continue;
      const id = resolveRef(name, 'var');
      if (!id || (strict && !allowMissingTargets && !exists('var', id))) {
        const near = nearName('var', name);
        throw new Error('找不到这个变量：' + name + (near ? '（是不是「' + near + '」？）' : '') + '　例：#如果 变量 ' + (near || 'DayCount') + ' >= 3');
      }
      if (strict && !Number.isSafeInteger(Number(val))) throw new Error('比较值超出安全整数范围');
      return [1, id, 0, Number(val), COND_OP[sym]];
    }
    const sw = /^(?:开关\s*)?(.+?)\s*(开|关)$/.exec(t);
    if (sw) {
      const id = resolveRef(sw[1].trim(), 'switch');
      if (!id || (strict && !allowMissingTargets && !exists('switch', id))) {
        const near = nearName('switch', sw[1].trim());
        throw new Error('找不到这个开关：' + sw[1].trim() + (near ? '（是不是「' + near + '」？）' : '') + '　例：#如果 开关 自由时间 开');
      }
      return [0, id, sw[2] === '关' ? 1 : 0];
    }
    throw new Error('条件看不懂：' + t + '（能写「变量 DayCount >= 3」「开关 自由时间 开」）');
  }
  // 条件 → 脚本（多个条件用 并且 / 或者 连起来时，存成一条「脚本」条件）
  const condJS = p => p[0] === 0
    ? (p[2] ? `$gameSwitches.value(${p[1]}) === false` : `$gameSwitches.value(${p[1]})`)
    : `$gameVariables.value(${p[1]}) ${['==', '>=', '<=', '>', '<', '!='][p[4]] || '=='} ${p[3]}`;
  // #如果 / #条件 后面那段：先拆 并且 / 或者，再一个个认
  function condParams(text, options = {}) {
    const { strict } = options;
    let t = String(text || '').trim();
    // 外面套了方括号 / 圆括号（[变量 X>=30]、【…】）先剥掉
    for (let k = 0; k < 3; k++) {
      const m = /^[\[【(（]\s*([\s\S]*?)\s*[\]】)）]$/.exec(t);
      if (!m) break;
      t = m[1].trim();
    }
    t = t.replace(/[（(][^）)]*(?:变量|开关)[^）)]*[）)]/g, '').trim();
    // 从阅读视图抄下来的样子也认：变量 38「名字」 ≥ 1、开关 26「名字」 为开
    t = t.replace(/「[^」]{0,40}」/g, '')
      .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '!=')
      .replace(/＝/g, '=').replace(/为\s*(开|关)(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('条件没写：（例：#如果 变量 DayCount >= 3）');
    const ors = t.split(/\s*(?:或者|或是|或|\|\||\|)\s*/).map(s => s.trim());
    if (!ors.length) throw new Error('条件没写：（例：#如果 变量 DayCount >= 3）');
    const groups = ors.filter(g => strict || g).map(g => g.split(/\s*(?:并且|而且|同时|且|&&|&)\s*/).map(s => s.trim()).filter(s => strict || s));
    if (strict && groups.some(g => g.some(s => !s))) throw new Error('请补全条件');
    const flat = groups.flat();
    if (!flat.length) throw new Error('条件没写：（例：#如果 变量 DayCount >= 3）');
    if (flat.length === 1) return condOne(flat[0], options);
    const parts = groups.map(g => g.map(one => condJS(condOne(one, options))).join(' && '));
    return [12, parts.length === 1 ? parts[0] : parts.map(p => '(' + p + ')').join(' || ')];
  }

  function parseScript(text, { settlement = false, allowMissingTargets = false } = {}) {
    const items = [];
    const addMore = (list, line) => {
      const m = /^[＋+](.*)$/.exec(line), last = list[list.length - 1];
      if (!m || !last || last.type !== 'say') return false;
      (last.more = last.more || []).push(m[1].trim());
      return true;
    };
    let choice = null;
    const stack = [];                                   // 还没收尾的 #如果
    const target = () => (stack.length ? stack[stack.length - 1].branch : items);
    const parseOne = line => {
      const pic = /^[#＃]\s*(?:图|CG|cg|显示图片)[\s:：]+(.+)$/.exec(line);
      if (pic) return { type: 'pic', name: pic[1].trim() };
      const cl = /^[#＃]\s*(?:清除图片|关闭图片|清图|关图|不要图)\s*[:：]?\s*(.*)$/.exec(line);
      if (cl) {
        const nm = cl[1].trim().replace(/[０-９]/g, d => String(d.charCodeAt(0) - 0xFF10));
        const ord = /^(?:图片|第)?\s*(\d+)\s*张?$/.exec(nm);
        return ord ? { type: 'clear', order: Number(ord[1]) } : { type: 'clear', name: nm };
      }
      const w = /^[#＃]\s*等待[\s:：]*(\d+(?:\.\d+)?)\s*秒?$/.exec(line);
      if (w) return { type: 'wait', sec: Number(w[1]) };
      const sw = /^[#＃]\s*开关\s*(.+?)\s*(开|关)$/.exec(line);
      if (sw) return { type: 'switch', id: resolveRef(sw[1], 'switch'), on: sw[2] === '开' };
      const vr = /^[#＃]\s*变量\s*(.+?)\s*([+\-−=*×/÷%])\s*(-?\d+)$/.exec(line);
      if (vr) {
        const ops = { '+': 1, '-': 2, '−': 2, '=': 0, '*': 3, '×': 3, '/': 4, '÷': 4, '%': 5 };
        return { type: 'var', id: resolveRef(vr[1], 'var'), op: ops[vr[2]], value: Number(vr[3]) };
      }
      const itm = /^[#＃]\s*物品\s*(.+?)\s*([+\-−])\s*(\d+)$/.exec(line);
      if (itm) return { type: 'item', id: resolveRef(itm[1], 'item'), add: itm[2] === '+', count: Number(itm[3]) };
      const tr = /^[#＃]\s*传送[\s:：]*(.+)$/.exec(line);
      if (tr) { const it = parseTransfer(tr[1]); if (it) return it; }
      const as = /^[#＃]\s*扮演[\s:：]+(\S+)(?:\s+(\S+?)(?:\s+(\d))?)?$/.exec(line);
      if (as) return { type: 'as', who: as[1], sheet: as[2] || '', index: as[3] ? Number(as[3]) : 0 };
      const fd = /^[#＃]\s*(淡出|淡入)$/.exec(line);
      if (fd) return { type: 'fade', out: fd[1] === '淡出' };
      const au = /^[#＃]\s*(音乐|环境音|音效)[\s:：]+(.+?)(?:\s+(\d{1,3}))?$/.exec(line);
      if (au) return { type: { 音乐: 'bgm', 环境音: 'bgs', 音效: 'se' }[au[1]], name: au[2].trim(), volume: au[3] ? Math.min(100, Number(au[3])) : 90 };
      const st = /^[#＃]\s*停(音乐|环境音)(?:[\s:：]*(\d+(?:\.\d+)?)\s*秒?)?$/.exec(line);
      if (st) return { type: st[1] === '音乐' ? 'bgm' : 'bgs', stop: true, sec: st[2] ? Number(st[2]) : 1 };
      const tn = /^[#＃]\s*色调[\s:：]+(\S+?)(?:\s+(\d+(?:\.\d+)?)\s*秒?)?$/.exec(line);
      if (tn && TINTS[tn[1]]) return { type: 'tint', tone: tn[1], sec: tn[2] != null ? Number(tn[2]) : 1 };
      const sk = /^[#＃]\s*震动(?:[\s:：]*([1-9]))?$/.exec(line);
      if (sk) return { type: 'shake', power: sk[1] ? Number(sk[1]) : 5 };
      const bl = /^[#＃]\s*气泡[\s:：]+(\S+)(?:\s+(主角|玩家|本事件|这个人))?$/.exec(line);
      if (bl && BALLOONS[bl[1]]) return { type: 'balloon', balloon: BALLOONS[bl[1]], target: bl[2] === '本事件' || bl[2] === '这个人' ? 0 : -1 };
      const cap = /^[#＃]\s*字幕[\s:：]+(.+)$/.exec(line);
      if (cap) return { type: 'caption', lines: cap[1].split(/[｜|]/).map(x => x.trim()).filter(Boolean).slice(0, 4) };
      const bu = /^[#＃]\s*立绘[\s:：]+(\S+)\s+(\S+?)(?:\s+(左|中|右))?$/.exec(line);
      if (bu) return { type: 'bust', who: bu[1], face: bu[2], pos: bu[3] || '' };
      const ub = /^[#＃]\s*退场(?:[\s:：]+(\S+))?$/.exec(line);
      if (ub) return { type: 'unbust', who: ub[1] || '' };
      const settle = /^[#＃]\s*结算(?:(?:[ \t]+|[:：][ \t]*)(.*))?$/.exec(line);
      if (settle) {
        const ref = (settle[1] || '').trim();
        return { type: 'settlement', id: settlementId(P.read('CommonEvents.json') || [], ref), ref };
      }
      const call = /^[#＃]\s*场景[\s:：]+(.+)$/.exec(line);
      if (call) return { type: 'call', id: resolveRef(call[1], 'ce'), ref: call[1].trim() };
      // #插件 插件名 指令名（值1，值2…）：参数表从插件文件读，生成 357 + 657 续行
      const pl = /^[#＃]\s*插件\s*[:：]?\s*(\S+)\s+([^\s（(]+)\s*([\s\S]*)$/.exec(line);
      if (pl) {
        if (!pa) throw new Error('这个工程没有读插件参数表，写不了「#插件」（要 js/plugins 里的插件文件）');
        return pa.item(pl[1], pl[2], pl[3]);
      }
      const wk = /^[#＃]\s*行走图[\s:：]+(\S+)\s+(\S+)(?:\s+(\d))?$/.exec(line);
      if (wk) return { type: 'look', actor: resolveRef(wk[1], 'actor'), sheet: wk[2], index: wk[3] ? Number(wk[3]) : 0 };
      if (/^[#＃]\s*消失$/.test(line)) return { type: 'erase' };
      if (/^[#＃]\s*回到标题$/.test(line)) return { type: 'title' };
      const ss = /^[#＃]\s*独立开关[\s:：]*([ABCD])\s*(开|关)$/.exec(line);
      if (ss) return { type: 'selfsw', ch: ss[1], on: ss[2] === '开' };
      const tp = /^[#＃]\s*透明[\s:：]*(开|关)$/.exec(line);
      if (tp) return { type: 'transparent', on: tp[1] === '开' };
      const fl = /^[#＃]\s*飘字[\s:：]+(.+)$/.exec(line);
      if (fl) {
        const w = /^([^：:\s]{1,12})[：:]\s*(.+)$/.exec(fl[1].trim());
        return w ? { type: 'float', who: w[1], text: w[2].trim() } : { type: 'float', who: '', text: fl[1].trim() };
      }
      const ac = /^[#＃]\s*动作[\s:：]+(\S+)(?:\s+(.+))?$/.exec(line);
      if (ac) {
        const toks = stepTokens(String(ac[2] || '').trim().split(/\s+/).filter(Boolean));
        let wait = true;
        if (toks[toks.length - 1] === '不等') { wait = false; toks.pop(); }
        return { type: 'act', who: ac[1], steps: toks.join(' '), wait, bad: toks.filter(t => !stage.validStep(t)) };
      }
      const cam = /^[#＃]\s*镜头[\s:：]+(上|下|左|右)\s*(\d{1,3})(?:\s+([1-6]))?$/.exec(line);
      if (cam) return { type: 'camera', dir: DIRS[cam[1]], dist: Number(cam[2]), speed: cam[3] ? Number(cam[3]) : 3 };
      const we = /^[#＃]\s*天气[\s:：]+(无|晴|雨|暴雨|雪)(?:\s+([0-9]))?(?:\s+(\d+(?:\.\d+)?)\s*秒?)?(?:\s+(等完))?$/.exec(line);
      if (we) { const t = WEATHERS[we[1]]; return { type: 'weather', weather: t, power: we[2] == null ? (t === 'none' ? 0 : 5) : Number(we[2]), sec: we[3] == null ? 1 : Number(we[3]), wait: !!we[4] }; }
      const fs_ = /^[#＃]\s*闪光(?:[\s:：]+(白|红))?(?:\s+(\d+(?:\.\d+)?)\s*秒?)?$/.exec(line);
      if (fs_) return { type: 'flash', color: fs_[1] || '白', sec: fs_[2] != null ? Number(fs_[2]) : 0.5 };
      const narr = /^[：:](.*)$/.exec(line);
      if (narr) return { type: 'say', speaker: '', text: narr[1].trim() };
      const m = /^([^：:]{1,12})[：:]\s*(.*)$/.exec(line);
      if (nameBox && m && m[2]) return { type: 'say', speaker: m[1].trim(), text: m[2].trim() };
      return { type: 'say', speaker: '', text: line };
    };
    for (const [i, raw] of String(text || '').split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const lineError = message => new Error((settlement ? '第 ' + (i + 1) + ' 行 · ' : '') + message);
      // #如果 条件 … #否则 … #结束
      const iff = /^[#＃]\s*(?:如果|条件)[\s:：]*(.+)$/.exec(line);
      if (iff && !/^[#＃]\s*(?:结束|条件结束|结束条件|endif)\s*$/i.test(line)) {
        const node = { type: 'if', cond: iff[1].trim(), then: [], else: null, branch: null };
        if (settlement) {
          try { node.params = condParams(node.cond, { strict: true, allowMissingTargets }); } catch (error) { throw lineError(error.message); }
        }
        node.branch = node.then;
        stack.push(node);
        continue;
      }
      if (/^[#＃]\s*(?:否则|不然)\s*$/.test(line)) {
        const node = stack[stack.length - 1];
        if (!node) throw lineError('「#否则」前面没有 #如果');
        if (node.else) throw lineError('一个 #如果 只能写一个 #否则');
        node.else = [];
        node.branch = node.else;
        continue;
      }
      if (/^[#＃]\s*(?:结束|条件结束|结束条件|endif)\s*$/i.test(line)) {
        const node = stack.pop();
        if (!node) throw lineError('「' + (settlement ? '#条件结束' : '#结束') + '」前面没有 #如果');
        target().push(node);
        continue;
      }
      if (settlement) {
        if (!/^[#＃]\s*(?:物品|变量|开关)/.test(line)) throw lineError('结算组可以写 #物品、#变量、#开关、#如果、#否则 和 #条件结束');
        const action = parseOne(line);
        if (action.type === 'say') throw lineError('指令写法有误，请写目标名称或编号及操作');
        if (!action.id || (!allowMissingTargets && !exists(action.type, action.id))) throw lineError('找不到该物品、变量或开关');
        if (action.type === 'item' && (!Number.isSafeInteger(action.count) || action.count < 1)) throw lineError('物品数量要是正整数');
        if (action.type === 'var' && !Number.isSafeInteger(action.value)) throw lineError('变量值要在安全整数范围内');
        target().push({ ...action, line: i + 1 });
        continue;
      }
      const ch = /^[#＃]\s*选项[\s:：]+(.+)$/.exec(line);
      if (ch) {
        const labels = ch[1].split(/[|｜]/).map(x => x.trim()).filter(Boolean).slice(0, 6);
        if (labels.length >= 2) { choice = { type: 'choice', labels, branches: labels.map(() => []) }; target().push(choice); continue; }
      }
      const br = /^[#＃](\d+)\s+(.+)$/.exec(line);
      if (br && choice && Number(br[1]) >= 1 && Number(br[1]) <= choice.labels.length) {
        const list = choice.branches[Number(br[1]) - 1];
        if (addMore(list, br[2].trim())) continue;
        list.push(parseOne(br[2].trim()));
        continue;
      }
      if (/^[#＃](\d+)$/.test(line)) continue;
      if (addMore(target(), line)) continue;
      target().push(parseOne(line));
    }
    if (stack.length) throw new Error('「#如果」还差 ' + stack.length + ' 个「' + (settlement ? '#条件结束' : '#结束') + '」');
    return items;
  }

  const msgHead = speaker => {
    const s = P.messageStyle();
    return { code: 101, indent: 0, parameters: nameBox ? ['', 0, s.background, s.position, speaker || ''] : ['', 0, s.background, s.position] };
  };

  function scriptCommands(items, o = {}) {
    const out = [];
    const st = newPicState();
    for (const id of o.taken || []) st.slots.set(id, '');
    for (const it of items) {
      if ((it.type === 'item' && !it.id) || (it.type === 'var' && !it.id) || (it.type === 'switch' && !it.id) || (it.type === 'transfer' && !it.map)) {
        throw new Error('找不到这个名字：' + JSON.stringify(it));
      }
      if (it.type === 'if') {
        out.push({ code: 111, indent: 0, parameters: it.params || condParams(it.cond) });
        for (const sub of scriptCommands(it.then, o)) out.push({ ...sub, indent: (sub.indent || 0) + 1 });
        out.push({ code: 0, indent: 1, parameters: [] });
        if (it.else) {
          out.push({ code: 411, indent: 0, parameters: [] });
          for (const sub of scriptCommands(it.else, o)) out.push({ ...sub, indent: (sub.indent || 0) + 1 });
          out.push({ code: 0, indent: 1, parameters: [] });
        }
        out.push({ code: 412, indent: 0, parameters: [] });
        continue;
      }
      if (it.type === 'choice') {
        out.push({ code: 102, indent: 0, parameters: [it.labels.slice(), it.labels.length - 1, 0, 2, 1] });
        it.branches.forEach((br, idx) => {
          out.push({ code: 402, indent: 0, parameters: [idx, it.labels[idx]] });
          for (const sub of scriptCommands(br)) out.push({ ...sub, indent: (sub.indent || 0) + 1 });
          out.push({ code: 0, indent: 1, parameters: [] });
        });
        out.push({ code: 404, indent: 0, parameters: [] });
        continue;
      }
      if (it.type === 'say') {
        const speaker = nameBox ? it.speaker : '';
        const first = nameBox || !it.speaker ? it.text : it.speaker + '：' + it.text;
        out.push(msgHead(speaker));
        out.push({ code: 401, indent: 0, parameters: [first] });
        for (const t of it.more || []) out.push({ code: 401, indent: 0, parameters: [t] });
      } else if (it.type === 'switch') {
        out.push({ code: 121, indent: 0, parameters: [it.id, it.id, it.on ? 0 : 1] });
      } else if (it.type === 'var') {
        out.push({ code: 122, indent: 0, parameters: [it.id, it.id, Number(it.op) || 0, 0, Number(it.value) || 0] });
      } else if (it.type === 'item') {
        out.push({ code: 126, indent: 0, parameters: [it.id, it.add ? 0 : 1, 0, Math.max(1, Number(it.count) || 1)] });
      } else if (it.type === 'transfer' && !it.who && !it.steps) {
        out.push({ code: 201, indent: 0, parameters: [0, it.map, it.x, it.y, it.dir || 0, 0] });
      } else if (it.type === 'pic') {
        const have = [...st.slots.entries()].find(([, v]) => v === it.name);
        if (have) { st.shows.push({ id: have[0], name: it.name }); continue; }
        const id = pics.nextPicId(st.slots);
        const c = { code: 231, indent: 0, parameters: [id, it.name, 0, 0, 0, 0, 100, 100, 255, 0] };
        out.push(c); pics.picApply(st, c);
      } else if (it.type === 'clear') {
        if (it.order) {
          const e = st.shows[it.order - 1];
          if (!e) throw new Error(`「#清图 图片${it.order}」：前面只有 ${st.shows.length} 个 #图`);
          if (st.slots.get(e.id) !== e.name) throw new Error(`「#清图 图片${it.order}」：这张图已经不在屏幕上了`);
          out.push({ code: 235, indent: 0, parameters: [e.id] }); st.slots.delete(e.id);
        } else if (it.name) {
          const have = [...st.slots.entries()].filter(([, v]) => v === it.name).pop();
          if (!have) throw new Error('「#清图 ' + it.name + '」：这张图现在没在显示');
          out.push({ code: 235, indent: 0, parameters: [have[0]] }); st.slots.delete(have[0]);
        } else if (pics.mode === 'script') {
          out.push({ code: 355, indent: 0, parameters: [pics.CLEAR_ALL] }); st.slots.clear();
        } else {
          for (const id of [...st.slots.keys()]) if (!(o.taken || []).includes(id) && !parseBustName(st.slots.get(id))) { out.push({ code: 235, indent: 0, parameters: [id] }); st.slots.delete(id); }
        }
      } else if (it.type === 'wait') {
        out.push({ code: 230, indent: 0, parameters: [Math.max(1, Math.round(it.sec * 60))] });
      } else if (it.type === 'bust') {
        for (const c of bustCommands(it, st)) { out.push(c); pics.picApply(st, c); }
      } else if (it.type === 'unbust') {
        for (const c of unbustCommands(it, st)) { out.push(c); pics.picApply(st, c); }
      } else {
        const c = stagingCommand(it);
        if (c) out.push(...c);
      }
    }
    return out;
  }

  // 演出指令（不牵扯图片状态的那些）
  function stagingCommand(it) {
    const se = (name, volume) => ({ name, pan: 0, pitch: 100, volume });
    switch (it.type) {
      case 'fade': return [{ code: it.out ? 221 : 222, indent: 0, parameters: [] }];
      case 'bgm': return [it.stop ? { code: 242, indent: 0, parameters: [Math.max(0, Math.round(it.sec))] } : { code: 241, indent: 0, parameters: [se(it.name, it.volume)] }];
      case 'bgs': return [it.stop ? { code: 246, indent: 0, parameters: [Math.max(0, Math.round(it.sec))] } : { code: 245, indent: 0, parameters: [se(it.name, it.volume)] }];
      case 'se': return [{ code: 250, indent: 0, parameters: [se(it.name, it.volume)] }];
      case 'tint': return [{ code: 223, indent: 0, parameters: [TINTS[it.tone].slice(), Math.max(1, Math.round(it.sec * 60)), true] }];
      case 'shake': return [{ code: 225, indent: 0, parameters: [it.power, 5, 30, true] }];
      case 'balloon': return [{ code: 213, indent: 0, parameters: [it.target, it.balloon, true] }];
      case 'call': {
        if (!it.id || !P.has('ce', it.id)) throw new Error('找不到这个场景：' + (it.ref || it.id));
        if (isSettlement((P.read('CommonEvents.json') || [])[it.id])) throw new Error('请用「#结算 ' + (it.ref || it.id) + '」调用结算组');
        return [{ code: 117, indent: 0, parameters: [it.id] }];
      }
      case 'settlement': {
        if (!it.ref) throw new Error('「#结算」后面要写结算组名或编号');
        const event = (P.read('CommonEvents.json') || [])[it.id];
        if (!isSettlement(event)) throw new Error('找不到结算组「' + it.ref + '」');
        if (!settlementBody(event)) throw new Error('结算组「' + it.ref + '」含有其它指令或开启了自动触发');
        return [{ code: 117, indent: 0, parameters: [it.id] }];
      }
      case 'look': {
        if (!it.actor || !P.has('actor', it.actor)) throw new Error('找不到这个角色：' + JSON.stringify(it));
        const a = (P.read('Actors.json') || [])[it.actor] || {};
        return [{ code: 322, indent: 0, parameters: [it.actor, it.sheet, it.index, a.faceName || '', a.faceIndex || 0, a.battlerName || ''] }];
      }
      case 'transparent': return [{ code: 211, indent: 0, parameters: [it.on ? 0 : 1] }];
      case 'erase': return [{ code: 214, indent: 0, parameters: [] }];
      case 'title': return [{ code: 354, indent: 0, parameters: [] }];
      case 'plugin': return pa ? pa.commandsOf(it) : null;
      case 'camera': return [{ code: 204, indent: 0, parameters: [it.dir, Math.max(1, it.dist), it.speed, true] }];
      case 'weather': return [{ code: 236, indent: 0, parameters: [it.weather, it.power, Math.max(0, Math.round(it.sec * 60)), !!it.wait] }];
      case 'flash': return [{ code: 224, indent: 0, parameters: [FLASHES[it.color].slice(), Math.max(1, Math.round(it.sec * 60)), false] }];
      case 'float': {
        if (!it.text) throw new Error('「#飘字」后面要写飘的字');
        return stageCommands('float', { who: it.who, text: it.text });
      }
      case 'act': {
        if (!it.steps) throw new Error(`「#动作 ${it.who}」后面要写做什么（上 下 左 右、转身、跳、等0.5、！ …）`);
        if (it.bad && it.bad.length) throw new Error(`「#动作」看不懂：${it.bad.join(' ')}（${STEP_HELP}；最后写「不等」= 不等他做完）`);
        return stageCommands('act', { who: it.who, steps: it.steps, wait: it.wait ? 'true' : 'false' });
      }
      case 'as': {
        if (!isProtagonist(it.who) && !it.sheet && !actorByName(it.who)) throw new Error(`「#扮演 ${it.who}」：数据库里没有叫「${it.who}」的角色。不是角色的人要写行走图：#扮演 ${it.who} 行走图名 编号`);
        if (it.sheet && !P.findImage('characters', it.sheet)) throw new Error(`「#扮演」：找不到行走图 img/characters/${it.sheet}`);
        return stageCommands('as', { who: it.who, sheet: it.sheet, index: it.sheet ? it.index : '' });
      }
      case 'transfer': {
        if (!it.who && !it.steps) return null;   // 普通的「场所移动」：在 scriptCommands 里
        if (!it.map || !P.has('map', it.map)) throw new Error('找不到这张地图：' + JSON.stringify(it));
        if (it.who && !isProtagonist(it.who) && !actorByName(it.who)) throw new Error(`「#传送 ${it.who} …」：数据库里没有叫「${it.who}」的角色。不是角色的人先写「#扮演 ${it.who} 行走图名 编号」，下一行再写「#传送 地图 x y」`);
        if (it.bad && it.bad.length) throw new Error(`「#传送」后面的步骤看不懂：${it.bad.join(' ')}（${STEP_HELP}）`);
        return stageCommands('transfer', { who: it.who, map: it.map, x: it.x, y: it.y, dir: it.dir || 0, steps: it.steps });
      }
      case 'selfsw': return [{ code: 123, indent: 0, parameters: [it.ch, it.on ? 0 : 1] }];
      case 'caption': {
        const head = msgHead('');
        head.parameters[2] = 1; head.parameters[3] = 1;
        return [head, ...it.lines.map(t => ({ code: 401, indent: 0, parameters: [centerPad(t) + t] }))];
      }
    }
    return null;
  }
  // 演出插件指令（参数表在 core/stage.js）
  const stageCommands = (cmd, args) => stage.commands(cmd, args, mz);
  // 插件指令 → 写法（只看第一条；续行由调用方核对）
  function stageLine(c) {
    const pc = stage.parseCmd(c);
    if (!pc) return '';
    const a = pc.args;
    const str = k => String(a[k] == null ? '' : a[k]);
    switch (pc.cmd) {
      case 'float': {
        const who = str('who'), text = str('text');
        if (!text || /[\r\n]/.test(text)) return '';
        return '#飘字 ' + (who ? who + '：' : '') + text;
      }
      case 'act': return '#动作 ' + str('who') + ' ' + str('steps') + (str('wait') === 'false' ? ' 不等' : '');
      case 'as': return '#扮演 ' + str('who') + (str('sheet') ? ' ' + str('sheet') + (Number(a.index) ? ' ' + Number(a.index) : '') : '');
      case 'transfer': {
        const id = Number(a.map), dir = Number(a.dir) || 0;
        if (!id || !P.has('map', id)) return '';
        return '#传送 ' + (str('who') ? str('who') + ' ' : '') + refText('map', id) + ' ' + Number(a.x) + ' ' + Number(a.y) + (DIR_TEXT[dir] ? ' 朝' + DIR_TEXT[dir] : '') + (str('steps') ? ' ' + str('steps') : '');
      }
    }
    return '';
  }
  // 立绘：这个人已经在屏幕上 → 原位置换表情（写了位置就挪过去）；不在 → 按位置放（没写位置：第一个人左、第二个人右、再来放中间）
  function bustCommands(it, st) {
    const out = [];
    const have = bustSlotOf(st.slots, it.who);
    let pos = it.pos;
    if (!pos && have) pos = ({ [bustId('左')]: '左', [bustId('中')]: '中', [bustId('右')]: '右' })[have[0]] || '左';
    if (!pos) {
      const busy = new Set([...st.slots.keys()].filter(isBustId));
      pos = ['左', '右', '中'].find(k => !busy.has(bustId(k))) || '中';
    }
    if (have && have[0] !== bustId(pos)) { out.push({ code: 235, indent: 0, parameters: [have[0]] }); }
    out.push({ code: 231, indent: 0, parameters: bustParams(it.who, it.face, pos) });
    return out;
  }
  function unbustCommands(it, st) {
    const ids = it.who ? [bustSlotOf(st.slots, it.who)].filter(Boolean).map(x => x[0]) : [...st.slots.entries()].filter(([, v]) => parseBustName(v)).map(([k]) => k);
    if (!ids.length) throw new Error(it.who ? `「#退场 ${it.who}」：${it.who}现在没有立绘在屏幕上` : '「#退场」：现在没有立绘在屏幕上');
    return ids.map(id => ({ code: 235, indent: 0, parameters: [id] }));
  }
  // 一条指令能不能写成上面这些演出写法（给编辑框用，写不出来就返回空）
  function stagingLine(c, st) {
    const p = c.parameters || [];
    const vol = a => (a && Number(a.volume) !== 90 ? ' ' + a.volume : '');
    const plain = a => a && a.name && Number(a.pan || 0) === 0 && Number(a.pitch == null ? 100 : a.pitch) === 100;
    switch (c.code) {
      case 221: return '#淡出';
      case 222: return '#淡入';
      case 241: return plain(p[0]) ? '#音乐 ' + p[0].name + vol(p[0]) : '';
      case 245: return plain(p[0]) ? '#环境音 ' + p[0].name + vol(p[0]) : '';
      case 250: return plain(p[0]) ? '#音效 ' + p[0].name + vol(p[0]) : '';
      case 242: return '#停音乐' + (Number(p[0]) === 1 ? '' : ' ' + p[0]);
      case 246: return '#停环境音' + (Number(p[0]) === 1 ? '' : ' ' + p[0]);
      case 223: { const t = tintName(p[0]); return t && p[2] ? '#色调 ' + t + (Number(p[1]) === 60 ? '' : ' ' + Math.round(Number(p[1]) / 60 * 100) / 100) : ''; }
      case 225: return Number(p[1]) === 5 && Number(p[2]) === 30 && p[3] ? '#震动' + (Number(p[0]) === 5 ? '' : ' ' + p[0]) : '';
      case 213: return (p[0] === -1 || p[0] === 0) && p[2] && BALLOON_TEXT[p[1]] ? '#气泡 ' + BALLOON_TEXT[p[1]] + (p[0] === 0 ? ' 本事件' : '') : '';
      case 117: {
        const events = P.read('CommonEvents.json') || [];
        if (isSettlement(events[p[0]])) return '#结算 ' + settlementRef(events, p[0]);
        return P.has('ce', p[0]) ? '#场景 ' + refText('ce', p[0]) : '';
      }
      case 211: return '#透明 ' + (p[0] === 0 ? '开' : '关');
      case 214: return '#消失';
      case 354: return '#回到标题';
      case 204: return DIR_TEXT[p[0]] && p[3] ? '#镜头 ' + DIR_TEXT[p[0]] + ' ' + p[1] + (Number(p[2]) === 3 ? '' : ' ' + p[2]) : '';
      case 236: {
        const t = WEATHER_TEXT[p[0]];
        if (!t) return '';
        const defPow = p[0] === 'none' ? 0 : 5;
        const sec = Number(p[2]) === 60 ? '' : ' ' + secText(p[2]);
        // 写了秒就得把强度也写上（不然秒会被当成强度）
        return '#天气 ' + t + (Number(p[1]) !== defPow || sec ? ' ' + p[1] : '') + (sec ? sec + '秒' : '') + (p[3] ? ' 等完' : '');
      }
      case 224: { const n = flashName(p[0]); return n && !p[2] ? '#闪光' + (n === '白' && Number(p[1]) === 30 ? '' : ' ' + n + (Number(p[1]) === 30 ? '' : ' ' + secText(p[1]))) : ''; }
      case 356: return stageLine(c);
      // 插件指令：演出插件（#飘字 #动作）优先，其它插件看参数表能不能把这一条写回来
      case 357: return stageLine(c) || (pa ? pa.lineOf(c) : '');
      case 123: return ['A', 'B', 'C', 'D'].includes(p[0]) ? '#独立开关 ' + p[0] + ' ' + (p[1] === 0 ? '开' : '关') : '';
      case 322: { const a = (P.read('Actors.json') || [])[p[0]] || {}; return a.name && p[3] === (a.faceName || '') && p[4] === (a.faceIndex || 0) && p[5] === (a.battlerName || '') ? '#行走图 ' + refText('actor', p[0]) + ' ' + p[1] + (p[2] ? ' ' + p[2] : '') : ''; }
      case 231: {
        const b = parseBustName(p[1]);
        if (!b) return '';
        const pos = posOfX(p[4]);
        const want = bustParams(b.who, b.face, pos);
        if (JSON.stringify(want) !== JSON.stringify(p)) return '';
        const have = st && bustSlotOf(st.slots, b.who);
        // 写了位置的情况：这个人第一次出场、或者换了位置
        return '#立绘 ' + b.who + ' ' + b.face + (!have || have[0] !== p[0] ? ' ' + pos : '');
      }
      case 235: {
        const nm = st && st.slots.get(p[0]);
        const b = parseBustName(nm);
        return b ? '#退场 ' + b.who : '';
      }
    }
    return '';
  }

  return { parseScript, scriptCommands, resolveRef, refText, exists, msgHead, stagingCommand, stagingLine, bustCommands, unbustCommands, isBustId, parseBustName, stageCommands, condParams };
}

module.exports = { createScript, TINTS, BALLOONS, parseBustName, centerPad };
