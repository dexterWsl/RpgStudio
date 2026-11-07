'use strict';
// 预览播放：把一页指令翻成能「播」的步骤（不跑游戏，只演台词和图）
//   say 一个对话框 · pic 显示图片 · move 移动图片 · erase 关图 · wait 等待 · fade 淡出淡入 · note 传送 / 音乐这类只提一句
//   choice 选项（每个选项一串步骤）· if 条件分支（成立 / 不成立各一串，播的时候让人选）
//   调用公共事件：往里展开（最多 3 层，同一个不重复展开）
//   插件指令：立绘插件（VNPictureBusts）、视频层插件、文字窗口插件翻成 pic / swap / move / erase / textwin；别的插件是 plugin（只在分镜里提一句）
// 图片带上 missing（游戏里找不到这张图），给预览标红
function createPlayer(project, describer) {
  const P = project;
  const codes = describer.codes || require('./textcodes.js').createTextCodes(project);
  const screen = () => {
    const s = P.read('System.json') || {};
    const a = s.advanced || {};
    return { w: Number(a.screenWidth) || 816, h: Number(a.screenHeight) || 624 };
  };
  const ces = () => P.read('CommonEvents.json') || [];

  // [start, end) 这一段同缩进的指令 → 步骤
  function walk(list, start, end, ctx) {
    const out = [];
    for (let i = start; i < end; i++) {
      const c = list[i];
      if (!c) continue;
      const p = c.parameters || [];
      const ind = c.indent || 0;
      switch (c.code) {
        case 101: {
          const lines = [];
          let j = i + 1;
          while (j < end && list[j] && list[j].code === 401) { lines.push(String(list[j].parameters[0] || '')); j++; }
          // MV 没有名字栏：常见写法是第一行「\n<名字>」或者「【名字】」
          let speaker = P.expandN(p[4] || '');
          if (!speaker && lines.length) {
            const m = /^\\n<([^>]+)>\s*/.exec(lines[0]) || /^【([^】]+)】\s*/.exec(lines[0]);
            if (m) { speaker = P.expandN(m[1]); lines[0] = lines[0].slice(m[0].length); }
          }
          // 文字代码换成游戏里显示的样子：<center> 居中、\LastGainObj 换成刚得到的东西……
          const shown = codes.render(lines, { gain: ctx.gain });
          const say = { t: 'say', speaker: codes.word(speaker), face: p[0] ? { name: p[0], index: p[1] || 0 } : null, bg: p[2] || 0, pos: p[3] == null ? 2 : p[3], lines: shown.map(l => l.text) };
          if (shown.some(l => l.align !== 'left')) say.align = shown.map(l => l.align);
          out.push(say);
          i = j - 1;
          break;
        }
        case 105: {
          const lines = [];
          let j = i + 1;
          while (j < end && list[j] && list[j].code === 405) { lines.push(codes.word(list[j].parameters[0] || '')); j++; }
          out.push({ t: 'say', speaker: '', face: null, bg: 2, pos: 1, scroll: true, lines });
          i = j - 1;
          break;
        }
        case 102: {
          const options = (p[0] || []).map(o => String(o).replace(/^<<[^>]*>>/, ''));
          const branches = options.map(() => []);
          let cancel = null;
          let j = i + 1;
          while (j < end) {
            const h = list[j];
            if (h && (h.indent || 0) === ind && h.code === 404) break;
            if (h && (h.indent || 0) === ind && (h.code === 402 || h.code === 403)) {
              let k = j + 1;
              while (k < end && !(list[k] && (list[k].indent || 0) === ind && [402, 403, 404].includes(list[k].code))) k++;
              const body = walk(list, j + 1, k, ctx);
              if (h.code === 402) { const n = h.parameters[0]; if (branches[n]) branches[n] = body; }
              else cancel = body;
              j = k;
              continue;
            }
            j++;
          }
          out.push({ t: 'choice', options, branches, cancel });
          i = j;
          break;
        }
        case 111: {
          let j = i + 1, mid = -1;
          while (j < end && !(list[j] && (list[j].indent || 0) === ind && list[j].code === 412)) { if (list[j] && (list[j].indent || 0) === ind && list[j].code === 411) mid = j; j++; }
          const yes = walk(list, i + 1, mid >= 0 ? mid : j, ctx);
          const no = mid >= 0 ? walk(list, mid + 1, j, ctx) : [];
          out.push({ t: 'if', cond: describer.describe(c).replace(/^如果\s*/, ''), yes, no });
          i = j;
          break;
        }
        case 231: {
          const direct = p[3] === 0;
          out.push({ t: 'pic', id: p[0], name: String(p[1] || ''), origin: p[2] || 0, x: direct ? p[4] : 0, y: direct ? p[5] : 0, sx: p[6] == null ? 100 : p[6], sy: p[7] == null ? 100 : p[7], op: p[8] == null ? 255 : p[8], missing: !!p[1] && !P.findImage('pictures', p[1]) });
          break;
        }
        case 232: {
          const direct = p[3] === 0;
          out.push({ t: 'move', id: p[0], origin: p[2] || 0, x: direct ? p[4] : null, y: direct ? p[5] : null, sx: p[6], sy: p[7], op: p[8], dur: p[10] || 0 });
          break;
        }
        case 235: out.push({ t: 'erase', id: p[0] }); break;
        case 230: out.push({ t: 'wait', frames: p[0] || 0 }); break;
        case 221: out.push({ t: 'fade', out: true }); break;
        case 222: out.push({ t: 'fade', out: false }); break;
        case 201: out.push({ t: 'note', text: describer.describe(c) }); break;
        case 241: if (p[0] && p[0].name) out.push({ t: 'note', text: '音乐：' + p[0].name }); break;
        case 117: {
          const ce = ces()[p[0]];
          if (!ce) break;
          if (ctx.depth >= 3 || ctx.seen.has(p[0])) { out.push({ t: 'note', text: `调用公共事件 ${p[0]}「${ce.name || ''}」` }); break; }
          ctx.depth++; ctx.seen.add(p[0]);
          const list2 = ce.list || [];
          const inner = walk(list2, 0, list2.length, ctx);
          ctx.depth--; ctx.seen.delete(p[0]);
          if (inner.length) out.push({ t: 'call', id: p[0], name: String(ce.name || ''), steps: inner });
          break;
        }
        case 357: out.push(...pluginSteps(p)); break;
        case 125: case 126: case 127: case 128: { const g = codes.gainOf(c); if (g) ctx.gain = g; break; }
        default: break;
      }
    }
    return out;
  }

  // ---------- 插件指令（MZ 357）：认几个往画面上放东西的插件 ----------
  //   VisuMZ_2_VNPictureBusts 立绘：入场 / 换图 / 退场 / 移动 / 淡入淡出 / 镜像（位置 0~10，播放器按 bust 设置算坐标）
  //   LayeredVideoPlayer 视频：跟图片一样放在图片层（同编号时视频在图片上面）
  //   VisuMZ_3_VisualTextWindows 画面上的文字窗口
  //   别的插件只在分镜里提一句，播放时跳过
  // 参数里的式子只算纯数字和 Graphics.width / height（不执行游戏里的代码），算不出来就当没写
  function calc(v, d = null) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : d;
    const { w, h } = screen();
    const s = String(v == null ? '' : v).trim().replace(/Graphics\.(?:width|boxWidth)/g, w).replace(/Graphics\.(?:height|boxHeight)/g, h);
    if (!s || !/^[\d+\-*/ ().]+$/.test(s)) return d;
    try { const n = Function('"use strict";return (' + s + ')')(); return Number.isFinite(n) ? n : d; } catch { return d; }
  }
  const jsonOr = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const idList = v => (Array.isArray(v) ? v : jsonOr(v, [])).map(x => calc(x)).filter(x => x != null);
  const cleanText = s => P.expandN(String(s || '')).replace(/\\[A-Za-z]+\[[^\]]*\]|\\[A-Za-z]+<[^>]*>|\\[{}$.|!><^]/g, '').replace(/<[A-Za-z][^>]*>/g, '');
  const picMissing = n => !!n && !P.findImage('pictures', n);
  const BUST = 'VisuMZ_2_VNPictureBusts', VIDEO = 'LayeredVideoPlayer', TEXTWIN = 'VisuMZ_3_VisualTextWindows';
  function pluginSteps(p) {
    const [plugin, cmd, desc] = p;
    const a = p[3] && typeof p[3] === 'object' ? p[3] : {};
    const dur = calc(a['Duration:eval'], 20);
    if (plugin === BUST) {
      const ids = idList(a['PictureID:arrayeval']);
      const each = f => ids.map(f);
      switch (cmd) {
        case 'Basic_EnterBust': {
          const name = String(a['PictureName:str'] || '');
          return [{ t: 'pic', id: calc(a['PictureID:eval'], 1), name, bust: { pos: calc(a['Position:num'], 0), origin: a['Origin:str'] || 'Bust', mirror: a['HorzMirror:str'] || 'Auto' },
            from: { dx: calc(a['StartOffsetX:eval'], 0), dy: calc(a['StartOffsetY:eval'], 0) }, dur, missing: picMissing(name) }];
        }
        case 'Basic_GraphicChange': {
          const name = String(a['PictureName:str'] || '');
          return [{ t: 'swap', id: calc(a['PictureID:eval'], 1), name, missing: picMissing(name) }];
        }
        case 'Basic_ExitBusts': return each(id => ({ t: 'erase', id, to: { dx: calc(a['EndOffsetX:eval'], 0), dy: calc(a['EndOffsetY:eval'], 0) }, dur }));
        case 'Fade_FadeIn': return each(id => ({ t: 'move', id, op: 255, dur }));
        case 'Fade_FadeOut': return each(id => (a['AutoErase:eval'] === 'true' ? { t: 'erase', id, dur } : { t: 'move', id, op: 0, dur }));
        case 'Fade_OpacityTo': return each(id => ({ t: 'move', id, op: calc(a['TargetOpacity:num'], 255), dur }));
        case 'Fade_OpacityBy': return each(id => ({ t: 'move', id, dop: calc(a['AdjustOpacity:eval'], 0), dur }));
        case 'Move_MoveToPosition': return each(id => ({ t: 'move', id, pos: calc(a['TargetPosition:eval'], 5), dur, flip: a['FlipDirection:str'] === 'Flip' }));
        case 'Move_MoveByPosition': return each(id => ({ t: 'move', id, dpos: calc(a['MovePosition:eval'], 0), dur, flip: a['FlipDirection:str'] === 'Flip' }));
        case 'Move_MoveToCoordinates': return each(id => ({ t: 'move', id, x: calc(a['TargetX:str']), y: calc(a['TargetY:str']), dur, flip: a['FlipDirection:str'] === 'Flip' }));
        case 'Move_MoveByCoordinates': return each(id => ({ t: 'move', id, dx: calc(a['MoveX:str'], 0), dy: calc(a['MoveY:str'], 0), dur, flip: a['FlipDirection:str'] === 'Flip' }));
        case 'Move_ResetToPosition': return each(id => ({ t: 'move', id, reset: true, dur }));
        case 'Basic_MirrorBust': return each(id => ({ t: 'move', id, mirror: a['HorzMirror:str'] || 'Toggle' }));
        default: break;
      }
    } else if (plugin === VIDEO) {
      const id = calc(a.videoId, 1);
      const vars = a.useVariables === 'true';
      const pos = { origin: calc(a.origin, 0), x: vars ? 0 : calc(a.x, 0), y: vars ? 0 : calc(a.y, 0), sx: calc(a.scaleX, 100), sy: calc(a.scaleY, 100), op: calc(a.opacity, 255) };
      if (cmd === 'playVideo') {
        const name = String(a.file || '');
        return [{ t: 'pic', video: true, id, name, ...pos, loop: a.loop === 'true', missing: !!name && !P.findMovie(name) }];
      }
      if (cmd === 'moveVideo') return [{ t: 'move', video: true, id, ...(vars ? { ...pos, x: null, y: null } : pos), dur: calc(a.duration, 0) }];
      if (cmd === 'stopVideo') return a.mode === 'pause' ? [] : [{ t: 'erase', video: true, id }];
      if (cmd === 'resumeVideo') return [];
    } else if (plugin === TEXTWIN) {
      if (cmd === 'AddChangeVisualTextWindow') {
        const c = jsonOr(a['Customize:struct'], {}) || {};
        const text = cleanText(jsonOr(a['text:json'], a['text:json'] || '')).replace(/\s+$/, '');
        return [{ t: 'textwin', id: calc(a['id:num'], 1), text: text || null, x: calc(c['x:str']), y: calc(c['y:str']), w: calc(c['width:str']), h: calc(c['height:str']), op: calc(c['opacity:eval'], 192) }];
      }
      if (cmd === 'RemoveVisualTextWindow') return idList(a['list:arraynum']).map(id => ({ t: 'textwin', id, off: true }));
    }
    return [{ t: 'plugin', plugin: String(plugin || ''), cmd: String(cmd || ''), text: String(desc || cmd || '') }];
  }
  // 立绘插件的设置：锚点、缩放、哪些位置自动镜像、位置 → 坐标（插件里是一段 JS，这里只认默认模板里的数字）
  function bustSetup() {
    const pl = P.plugin(BUST);
    if (!pl) return null;
    const pr = pl.parameters || {};
    const num = (v, d) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? n : d; };
    const fx = String(jsonOr(pr['ScreenX:func'], pr['ScreenX:func']) || ''), fy = String(jsonOr(pr['ScreenY:func'], pr['ScreenY:func']) || '');
    const m = (re, s) => { const r = re.exec(s); return r ? r[1].replace(/\s+/g, '') : null; };
    return {
      ax: num(pr['AnchorX:num'], 0.5), ay: num(pr['AnchorY:num'], 1),
      sx: num(pr['ScaleX:num'], 100), sy: num(pr['ScaleY:num'], 100),
      inverted: idList(pr['InvertedScale:arraynum']),
      bufferX: num(m(/bufferX\s*=\s*(-?\d+(?:\.\d+)?)/, fx), 200),
      stagger: num(m(/stagger\s*=\s*(-?\d+(?:\.\d+)?)/, fy), 0),
      addY: num(m(/stagger\)\s*([+-]\s*\d+(?:\.\d+)?)/, fy), 0),
    };
  }
  const DEFAULT_BUST = { ax: 0.5, ay: 1, sx: 100, sy: 100, inverted: [], bufferX: 200, stagger: 0, addY: 0 };
  function timeline(list, o = {}) {
    list = list || [];
    const ctx = { depth: 0, seen: new Set(o.self ? [o.self] : []) };
    return { screen: screen(), bust: bustSetup() || DEFAULT_BUST, steps: walk(list, 0, list.length, ctx) };
  }
  return { timeline, screen };
}

module.exports = { createPlayer };
