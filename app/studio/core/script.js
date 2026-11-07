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
//   #传送 地图名或编号 x y
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
//   #行走图 角色 图名 编号   换角色的行走图（现实 / 游戏里两套样子）
//   #透明 开 / #透明 关      主角隐身 / 现身（黑场、过场时用）
//   #消失                    这个事件先不见（离开地图再回来又在：打倒的怪、拿走的东西）
//   #独立开关 A 开           这个事件自己的开关（只播一次的剧情用）
//   #回到标题                结局放完回到标题画面
//   人物和镜头：
//   #飘字 [谁：]文字         字从人物头上一句一句飘起来再淡掉（不挡剧情）；谁 = 主角 / 本事件 / 画面 / 事件名字，不写 = 主角
//   #动作 谁 步骤… [不等]    按名字让人物动：上 下 左 右（上3）、转身、面向主角、背对主角、跳、后退、等0.5、气泡 ！ ？…
//                            （这两种是演出插件 RpgStudio_Stage 的插件指令，第一次用时编辑器自动把插件装进游戏）
//   #镜头 方向 格数 [速度]   镜头平移（上下左右，速度 1~6，默认 3），移完再往下
//   #天气 雨|暴雨|雪|无 [强度] [秒]
//   #闪光 [白|红] [秒]
const { newPicState } = require('./merge.js');
const stage = require('./stage.js');

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
const DIRS = { 下: 2, 左: 4, 右: 6, 上: 8 };
const DIR_TEXT = { 2: '下', 4: '左', 6: '右', 8: '上' };
const WEATHERS = { 无: 'none', 晴: 'none', 雨: 'rain', 暴雨: 'storm', 雪: 'snow' };
const WEATHER_TEXT = { none: '无', rain: '雨', storm: '暴雨', snow: '雪' };
const FLASHES = { 白: [255, 255, 255, 170], 红: [255, 60, 60, 170] };
const flashName = c => Object.keys(FLASHES).find(k => sameTone(c, FLASHES[k])) || '';
// 演出插件指令的参数（RPG Maker MZ 编辑器里显示成「谁 = 林屿」这样的续行）
const STAGE_ARGS = { float: [['who', '谁'], ['text', '文字']], act: [['who', '谁'], ['steps', '步骤'], ['wait', '等做完']] };
const STAGE_TEXT = { float: '飘字', act: '动作' };
const secText = f => String(Math.round(Number(f) / 60 * 100) / 100);

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

  // 名字 → 编号：完全一致优先；只有一个包含它的也算
  function resolveRef(raw, kind) {
    const q = String(raw || '').trim();
    if (!q) return 0;
    if (/^\d+$/.test(q)) return Number(q);
    const rows = P.rows(kind).filter(x => x.name);
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

  function parseScript(text) {
    const items = [];
    const addMore = (list, line) => {
      const m = /^[＋+](.*)$/.exec(line), last = list[list.length - 1];
      if (!m || !last || last.type !== 'say') return false;
      (last.more = last.more || []).push(m[1].trim());
      return true;
    };
    let choice = null;
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
      const tr = /^[#＃]\s*传送\s*(.+?)\s+(\d+)\s+(\d+)$/.exec(line);
      if (tr) return { type: 'transfer', map: resolveRef(tr[1], 'map'), x: Number(tr[2]), y: Number(tr[3]) };
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
      const call = /^[#＃]\s*场景[\s:：]+(.+)$/.exec(line);
      if (call) return { type: 'call', id: resolveRef(call[1], 'ce'), ref: call[1].trim() };
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
        const toks = String(ac[2] || '').trim().split(/\s+/).filter(Boolean);
        let wait = true;
        if (toks[toks.length - 1] === '不等') { wait = false; toks.pop(); }
        return { type: 'act', who: ac[1], steps: toks.join(' '), wait, bad: toks.filter(t => !stage.validStep(t)) };
      }
      const cam = /^[#＃]\s*镜头[\s:：]+(上|下|左|右)\s*(\d{1,3})(?:\s+([1-6]))?$/.exec(line);
      if (cam) return { type: 'camera', dir: DIRS[cam[1]], dist: Number(cam[2]), speed: cam[3] ? Number(cam[3]) : 3 };
      const we = /^[#＃]\s*天气[\s:：]+(无|晴|雨|暴雨|雪)(?:\s+([1-9]))?(?:\s+(\d+(?:\.\d+)?)\s*秒?)?$/.exec(line);
      if (we) { const t = WEATHERS[we[1]]; return { type: 'weather', weather: t, power: we[2] ? Number(we[2]) : (t === 'none' ? 0 : 5), sec: we[3] != null ? Number(we[3]) : 1 }; }
      const fs_ = /^[#＃]\s*闪光(?:[\s:：]+(白|红))?(?:\s+(\d+(?:\.\d+)?)\s*秒?)?$/.exec(line);
      if (fs_) return { type: 'flash', color: fs_[1] || '白', sec: fs_[2] != null ? Number(fs_[2]) : 0.5 };
      const narr = /^[：:](.*)$/.exec(line);
      if (narr) return { type: 'say', speaker: '', text: narr[1].trim() };
      const m = /^([^：:]{1,12})[：:]\s*(.*)$/.exec(line);
      if (nameBox && m && m[2]) return { type: 'say', speaker: m[1].trim(), text: m[2].trim() };
      return { type: 'say', speaker: '', text: line };
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const ch = /^[#＃]\s*选项[\s:：]+(.+)$/.exec(line);
      if (ch) {
        const labels = ch[1].split(/[|｜]/).map(x => x.trim()).filter(Boolean).slice(0, 6);
        if (labels.length >= 2) { choice = { type: 'choice', labels, branches: labels.map(() => []) }; items.push(choice); continue; }
      }
      const br = /^[#＃](\d+)\s+(.+)$/.exec(line);
      if (br && choice && Number(br[1]) >= 1 && Number(br[1]) <= choice.labels.length) {
        const list = choice.branches[Number(br[1]) - 1];
        if (addMore(list, br[2].trim())) continue;
        list.push(parseOne(br[2].trim()));
        continue;
      }
      if (/^[#＃](\d+)$/.test(line)) continue;
      if (addMore(items, line)) continue;
      items.push(parseOne(line));
    }
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
      } else if (it.type === 'transfer') {
        out.push({ code: 201, indent: 0, parameters: [0, it.map, it.x, it.y, 0, 0] });
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
      case 'call': if (!it.id || !P.has('ce', it.id)) throw new Error('找不到这个场景：' + (it.ref || it.id)); return [{ code: 117, indent: 0, parameters: [it.id] }];
      case 'look': {
        if (!it.actor || !P.has('actor', it.actor)) throw new Error('找不到这个角色：' + JSON.stringify(it));
        const a = (P.read('Actors.json') || [])[it.actor] || {};
        return [{ code: 322, indent: 0, parameters: [it.actor, it.sheet, it.index, a.faceName || '', a.faceIndex || 0, a.battlerName || ''] }];
      }
      case 'transparent': return [{ code: 211, indent: 0, parameters: [it.on ? 0 : 1] }];
      case 'erase': return [{ code: 214, indent: 0, parameters: [] }];
      case 'title': return [{ code: 354, indent: 0, parameters: [] }];
      case 'camera': return [{ code: 204, indent: 0, parameters: [it.dir, Math.max(1, it.dist), it.speed, true] }];
      case 'weather': return [{ code: 236, indent: 0, parameters: [it.weather, it.power, Math.max(0, Math.round(it.sec * 60)), false] }];
      case 'flash': return [{ code: 224, indent: 0, parameters: [FLASHES[it.color].slice(), Math.max(1, Math.round(it.sec * 60)), false] }];
      case 'float': {
        if (!it.text) throw new Error('「#飘字」后面要写飘的字');
        return stageCommands('float', { who: it.who, text: it.text });
      }
      case 'act': {
        if (!it.steps) throw new Error(`「#动作 ${it.who}」后面要写做什么（上 下 左 右、转身、跳、等0.5、！ …）`);
        if (it.bad && it.bad.length) throw new Error(`「#动作」看不懂：${it.bad.join(' ')}（能写：上 下 左 右（上3）、前进、后退、靠近主角、远离主角、转上 转下 转左 转右、转身、面向主角、背对主角、跳、等0.5、速度1~6、慢、快、隐身、现身、穿透、不穿透，气泡 ！ ？ ♪ ♥ 怒 汗 乱 … 灯 Zzz；最后写「不等」= 不等他做完）`);
        return stageCommands('act', { who: it.who, steps: it.steps, wait: it.wait ? 'true' : 'false' });
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
  // 演出插件指令：MZ 是「插件指令」+ 每个参数一行续行（跟 RPG Maker MZ 编辑器写出来的一样）；MV 是一行字
  function stageCommands(cmd, args) {
    if (!mz) return [{ code: 356, indent: 0, parameters: [stage.PLUGIN + ' ' + cmd + ' ' + JSON.stringify(args)] }];
    return [
      { code: 357, indent: 0, parameters: [stage.PLUGIN, cmd, STAGE_TEXT[cmd], { ...args }] },
      ...STAGE_ARGS[cmd].map(([k, label]) => ({ code: 657, indent: 0, parameters: [label + ' = ' + (args[k] ?? '')] })),
    ];
  }
  // 插件指令 → 写法（只看第一条；续行由调用方核对）
  function stageLine(c) {
    let cmd = '', a = null;
    if (c.code === 357 && c.parameters[0] === stage.PLUGIN) { cmd = c.parameters[1]; a = c.parameters[3] || {}; }
    else if (c.code === 356) {
      const m = new RegExp('^' + stage.PLUGIN + ' (float|act) (\\{.*\\})$').exec(String(c.parameters[0] || ''));
      if (m) { cmd = m[1]; try { a = JSON.parse(m[2]); } catch { a = null; } }
    }
    if (!a || typeof a !== 'object') return '';
    if (cmd === 'float') {
      const who = String(a.who || ''), text = String(a.text || '');
      if (!text || /[\r\n]/.test(text)) return '';
      return '#飘字 ' + (who ? who + '：' : '') + text;
    }
    if (cmd === 'act') return '#动作 ' + String(a.who || '') + ' ' + String(a.steps || '') + (String(a.wait) === 'false' ? ' 不等' : '');
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
      case 117: return P.has('ce', p[0]) ? '#场景 ' + refText('ce', p[0]) : '';
      case 211: return '#透明 ' + (p[0] === 0 ? '开' : '关');
      case 214: return '#消失';
      case 354: return '#回到标题';
      case 204: return DIR_TEXT[p[0]] && p[3] ? '#镜头 ' + DIR_TEXT[p[0]] + ' ' + p[1] + (Number(p[2]) === 3 ? '' : ' ' + p[2]) : '';
      case 236: {
        const t = WEATHER_TEXT[p[0]];
        if (!t || p[3]) return '';
        const defPow = p[0] === 'none' ? 0 : 5;
        const sec = Number(p[2]) === 60 ? '' : ' ' + secText(p[2]);
        // 写了秒就得把强度也写上（不然秒会被当成强度）
        return '#天气 ' + t + (Number(p[1]) !== defPow || sec ? ' ' + p[1] : '') + sec;
      }
      case 224: { const n = flashName(p[0]); return n && !p[2] ? '#闪光' + (n === '白' && Number(p[1]) === 30 ? '' : ' ' + n + (Number(p[1]) === 30 ? '' : ' ' + secText(p[1]))) : ''; }
      case 356: case 357: return stageLine(c);
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

  return { parseScript, scriptCommands, resolveRef, refText, exists, msgHead, stagingCommand, stagingLine, bustCommands, unbustCommands, isBustId, parseBustName, stageCommands };
}

module.exports = { createScript, TINTS, BALLOONS, parseBustName, centerPad };
