'use strict';
// 规范模式 —— 编辑框的另一种样子（event.js 的 editBox 里「规范 / 文本」切换）
// 同一份文字按行拆成一块块来显示和改：
//   台词        名字按钮 + 直接能改的字。回车 = 下一句（同一个人）；Shift+回车 = 同一个对话框里另起一行（＋）；
//               字删空了再按退格 = 删掉这一句
//   #传送 等    彩色按钮，不能直接打字改：点一下看它是什么、改（传送 = 在地图上标出去哪一格）；✎ 改成文字
//   ■ 结构      原来的选项、条件分支、脚本……灰色，不能改、删、挪
//               选项：「选项」那一行列出全部选项，点哪个就只展开哪个；每个「选项 N」能改字、能删；条件默认收起，点「条件」展开
//   #选项 / #如果   新写的选项、条件分支，同样能折叠
// 选中一块以后，上面的「插入 …」按钮插在它后面（选的是选项 / 如果 → 插在它里面）
// 文字仍是唯一的来源：每次改动写回编辑框的文字（ed.set），保存还是原来那条路（合并照旧无损）
//
//   const B = mountBlocks(host, { get, set, scene, mapId, nameBox, save, at })
//   B.insert(一行或几行)   B.reload()（外面改了文字）   B.flag(报错信息)   B.undo()

const BLK_DIR = { 2: '下', 4: '左', 6: '右', 8: '上' };
// #后面的词 → 按钮颜色
const BLK_CAT = {
  传送: 'tp', 扮演: 'tp', 场景: 'scene',
  变量: 'state', 开关: 'state', 物品: 'state', 独立开关: 'state',
  图: 'stage', CG: 'stage', cg: 'stage', 显示图片: 'stage', 清图: 'stage', 清除图片: 'stage', 关闭图片: 'stage', 关图: 'stage', 不要图: 'stage', 立绘: 'stage', 退场: 'stage', 字幕: 'stage',
  飘字: 'move', 动作: 'move', 行走图: 'move', 透明: 'move', 气泡: 'move', 消失: 'move',
  音乐: 'sound', 停音乐: 'sound', 环境音: 'sound', 停环境音: 'sound', 音效: 'sound',
  等待: 'screen', 淡出: 'screen', 淡入: 'screen', 色调: 'screen', 震动: 'screen', 闪光: 'screen', 天气: 'screen', 镜头: 'screen', 回到标题: 'screen',
  插件: 'code', 原样: 'keep',
};
const BLK_CONTAINER = new Set(['branch', 'if', 'else', 'cancel', 'loop', 'nif', 'nelse', 'khead']);
const BLK_MOVABLE = new Set(['say', 'cmd', 'keep', 'blank']);

function blkKind(s) {
  if (!String(s).trim()) return 'blank';
  if (/^■/.test(s)) {
    if (/^■\s*选项(?:$|（|：)/.test(s)) return 'chead';
    if (/^■\s*选了「/.test(s)) return 'branch';
    if (/^■\s*如果/.test(s)) return 'if';
    if (/^■\s*否则/.test(s)) return 'else';
    if (/^■\s*按取消时/.test(s)) return 'cancel';
    if (/^■\s*(?:选项结束|条件结束|循环结束)/.test(s)) return 'end';
    if (/^■\s*循环/.test(s)) return 'loop';
    return 'anchor';
  }
  if (/^[#＃]\s*选项[\s:：]/.test(s)) return 'choice';
  if (/^[#＃]\s*(?:结束|条件结束|结束条件|endif)\s*$/i.test(s)) return 'nend';
  if (/^[#＃]\s*(?:否则|不然)\s*$/.test(s)) return 'nelse';
  if (/^[#＃]\s*(?:如果|条件)[\s:：]*\S/.test(s)) return 'nif';
  if (/^[#＃]\s*原样/.test(s)) return 'keep';
  if (/^[#＃]/.test(s)) return 'cmd';
  if (/^[＋+]/.test(s)) return 'more';
  return 'say';
}
// 「■ 选了「<<[…]>>文字」」→ { head, tags, text }
const blkLabel = body => {
  const m = /^(■\s*选了「)((?:<<\[[\s\S]*?\]>>|\(\(\[[\s\S]*?\]\)\))*)([\s\S]*)」$/.exec(body);
  return m ? { head: m[1], tags: m[2], text: m[3] } : { head: '■ 选了「', tags: '', text: body.replace(/^■\s*选了「|」$/g, '') };
};
const blkHasTag = s => /<<\[[\s\S]*?\]>>|\(\(\[[\s\S]*?\]\)\)/.test(s);
const blkStrip = s => String(s).replace(/<<\[[\s\S]*?\]>>|\(\(\[[\s\S]*?\]\)\)/g, '');

function mountBlocks(host, ed) {
  let lines = [], rows = [], sel = -1;
  const folded = new Set(), condOpen = new Set();
  const history = [];
  let typing = -1;                 // 正在打字的那一行（连着打的字算一步撤销）
  let actors = [];
  const needs = new Map();         // 选项文字 → 条件人话（服务端算）
  lookup('actor').then(r => { actors = r.map(a => String(a.name || '').trim()).filter(Boolean); }).catch(() => { });

  // ---------- 拆行 ----------
  function analyze() {
    const out = [], seen = new Map();
    let ifDepth = 0, choice = null;
    lines.forEach((raw, i) => {
      const m = /^((?:│ ?)*)(.*)$/.exec(raw);
      const r = { i, raw, bars: (m[1].match(/│/g) || []).length, body: m[2], k: 0, inner: m[2] };
      const km = /^[#＃]([1-6])(?:\s+([\s\S]*))?$/.exec(r.body);
      if (km && choice && Number(km[1]) <= choice.labels.length) { r.k = Number(km[1]); r.inner = (km[2] || '').trim(); }
      r.kind = r.k && !r.inner ? 'khead' : blkKind(r.inner);
      if (r.kind === 'nend') ifDepth = Math.max(0, ifDepth - 1);
      r.v = r.bars + ifDepth - (r.kind === 'nelse' ? 1 : 0);
      if (r.k) r.v = choice.v + (r.kind === 'khead' ? 0 : 1);
      if (r.kind === 'nif') ifDepth++;
      if (r.kind === 'choice') {
        choice = { i, v: r.v, labels: r.inner.replace(/^[#＃]\s*选项[\s:：]+/, '').split(/[|｜]/).map(x => x.trim()).filter(Boolean).slice(0, 6) };
        r.labels = choice.labels;
      }
      if (r.k) { r.choice = choice.i; r.label = choice.labels[r.k - 1] || ''; }
      const key = r.kind + '\u0001' + r.body;
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      r.key = key + '\u0001' + n;
      out.push(r);
    });
    // 容器（选项 / 如果 …）管到下一个层次不比它深的行；空行看它后面那一行
    for (let a = 0; a < out.length; a++) {
      const r = out[a];
      if (!BLK_CONTAINER.has(r.kind)) continue;
      let b = a + 1;
      while (b < out.length) {
        if (out[b].kind === 'blank') { let c = b; while (c < out.length && out[c].kind === 'blank') c++; if (c < out.length && out[c].v > r.v) { b = c; continue; } break; }
        if (out[b].v > r.v) b++; else break;
      }
      r.end = b;
    }
    // 原来的选项：「■ 选项」下面同一层的「■ 选了」都是它的
    for (let a = 0; a < out.length; a++) {
      const r = out[a];
      if (r.kind !== 'chead') continue;
      r.branches = [];
      for (let b = a + 1; b < out.length; b++) {
        const x = out[b];
        if (x.v < r.v || (x.v === r.v && x.kind === 'end')) { r.endRow = b; break; }
        if (x.v === r.v && x.kind === 'branch') { r.branches.push(b); x.n = r.branches.length; x.head = a; }
        if (x.v === r.v && x.kind === 'cancel') r.cancelRow = b;
      }
    }
    rows = out;
  }

  // ---------- 写回 ----------
  const snapshot = () => { history.push({ text: lines.join('\n'), sel }); if (history.length > 200) history.shift(); };
  function commit(next, newSel) {
    snapshot();
    typing = -1;
    lines = next;
    ed.set(lines.join('\n'));
    if (newSel != null) sel = newSel;
    analyze();
    draw();
  }
  // 打字：只改这一行，不重画（光标留在原处）
  function typeLine(i, raw) {
    if (typing !== i) { snapshot(); typing = i; }
    lines[i] = raw;
    ed.set(lines.join('\n'));
    const r = rows[i];
    if (!r) return;
    r.raw = raw;
    r.body = /^(?:│ ?)*([\s\S]*)$/.exec(raw)[1];
    r.inner = r.k ? r.body.replace(/^[#＃][1-6]\s+/, '').trim() : r.body;
  }
  function undo() {
    const h = history.pop();
    if (!h) { toast('没有可以撤销的了'); return; }
    typing = -1;
    lines = h.text.split('\n');
    sel = h.sel;
    ed.set(h.text);
    analyze();
    draw();
  }
  const prefix = r => '│ '.repeat(r.bars) + (r.k ? '#' + r.k + ' ' : '');

  // ---------- 台词 ----------
  function sayParts(s) {
    if (/^[：:]/.test(s)) return { name: '', text: s.slice(1) };
    const k = ed.nameBox ? /^([^：:]{1,12})[：:](.*)$/.exec(s) : null;
    return k ? { name: k[1].trim(), text: k[2].replace(/^\s+/, '') } : { name: '', text: s };
  }
  function sayLine(name, text) {
    if (name) return name + '：' + text;
    // 旁白：字本身像「名字：」、或者以 # ■ ＋ 开头，前面加「：」才不会被当成别的
    return (ed.nameBox && /^[^：:]{1,12}[：:]/.test(text)) || /^[#＃■＋+：:]/.test(text) ? '：' + text : text;
  }

  // ---------- 按钮上的字 ----------
  function tpParts(rest) {
    const toks = [];
    for (const t of String(rest).trim().split(/\s+/).filter(Boolean)) {
      if (/^\d{1,2}$/.test(t) && toks.length && /^(上|下|左|右|前进|后退)$/.test(toks[toks.length - 1])) toks[toks.length - 1] += t;
      else toks.push(t);
    }
    let k = -1;
    for (let j = toks.length - 2; j >= 1; j--) if (/^\d+$/.test(toks[j]) && /^\d+$/.test(toks[j + 1]) && toks.slice(j + 2).every(t => !/^\d+$/.test(t))) { k = j; break; }
    if (k < 0) return null;
    const pre = toks.slice(0, k), post = toks.slice(k + 2);
    let dir = '';
    const d = post.length ? /^面?朝(上|下|左|右)$/.exec(post[0]) : null;
    if (d) { dir = d[1]; post.shift(); }
    let who = '';
    if (pre.length >= 2 && (actors.includes(pre[0]) || ['主角', '玩家'].includes(pre[0]))) who = pre.shift();
    return { who, map: pre.join(' '), x: Number(toks[k]), y: Number(toks[k + 1]), dir, steps: post.join(' ') };
  }
  function chip(inner) {
    const m = /^[#＃]\s*([^\s:：]+)[\s:：]*([\s\S]*)$/.exec(inner) || [null, inner.replace(/^[#＃]/, ''), ''];
    let verb = m[1], rest = m[2];
    // 「#图片2」这种没空格的：认得出的词放前面
    if (!BLK_CAT[verb]) { const known = Object.keys(BLK_CAT).filter(k => verb.startsWith(k)).sort((a, b) => b.length - a.length)[0]; if (known) { rest = verb.slice(known.length) + (rest ? ' ' + rest : ''); verb = known; } }
    const cat = BLK_CAT[verb] || 'other';
    let v = esc(rest);
    if (verb === '传送') {
      const t = tpParts(rest);
      if (t) v = `${t.who ? `<b>${esc(t.who)}</b> 演 · ` : ''}→ ${esc(t.map)} <span class="cxy">(${t.x}, ${t.y})</span>${t.dir ? ' · 朝' + t.dir : ''}${t.steps ? ' · 到了 ' + esc(t.steps) : ''}`;
    } else if (verb === '场景') v = '▶ ' + esc(rest);
    return { verb, rest, cat, html: `<span class="ck">${esc(verb)}</span>${v ? `<span class="cv">${v}</span>` : ''}` };
  }

  // ---------- 画 ----------
  function hiddenSet() {
    const h = new Set();
    for (const r of rows) if (r.end != null && folded.has(r.key)) for (let j = r.i + 1; j < r.end; j++) h.add(j);
    return h;
  }
  const tools = (r, o = {}) => `<span class="bk-tools">${BLK_MOVABLE.has(r.kind) ? `<button type="button" data-act="up" title="上移">↑</button><button type="button" data-act="down" title="下移">↓</button>` : ''}${o.raw ? '<button type="button" data-act="raw" title="改成文字（直接改这一行）">✎</button>' : ''}${o.del !== false ? `<button type="button" data-act="del" title="${o.delTitle || '删掉这一行'}">×</button>` : ''}</span>`;
  const fold = r => `<button type="button" class="bk-fold${folded.has(r.key) ? ' shut' : ''}" data-act="fold" title="${folded.has(r.key) ? '展开' : '收起'}"></button>`;
  function rowHtml(r, hidden) {
    const cls = `bk bk-${r.kind}${r.i === sel ? ' sel' : ''}${r.k ? ' bk-k' : ''}`;
    const at = `data-i="${r.i}" style="--v:${r.v}"${hidden ? ' hidden' : ''}`;
    const s = r.inner;
    switch (r.kind) {
      case 'say': {
        const p = sayParts(s);
        return `<div class="${cls}" ${at}><button type="button" class="bk-who${p.name ? '' : ' narr'}" data-act="who" title="换说话的人">${esc(p.name || '旁白')}</button><div class="bk-text" contenteditable="plaintext-only" spellcheck="false" data-edit="say" data-ph="写台词…">${esc(p.text)}</div>${tools(r)}</div>`;
      }
      case 'more':
        return `<div class="${cls}" ${at}><span class="bk-plus" title="接在上一句的同一个对话框里">＋</span><div class="bk-text" contenteditable="plaintext-only" spellcheck="false" data-edit="more" data-ph="同一个对话框的下一行…">${esc(s.slice(1))}</div>${tools(r)}</div>`;
      case 'blank':
        return `<div class="${cls}" ${at}><span class="bk-gap"></span>${tools(r, { delTitle: '删掉这个空行' })}</div>`;
      case 'cmd': {
        const c = chip(s);
        return `<div class="${cls}" ${at}><button type="button" class="chip c-${c.cat}" data-act="chip" title="点开看 / 改">${c.html}</button>${tools(r, { raw: true })}</div>`;
      }
      case 'keep':
        return `<div class="${cls}" ${at}><button type="button" class="chip c-keep" data-act="keep" title="编辑框表达不了的指令：能删、能挪，不能改">${esc(s.replace(/^[#＃]\s*原样\s*/, '原样 '))}</button>${tools(r)}</div>`;
      case 'chead': {
        const pills = (r.branches || []).map((b, n) => {
          const x = rows[b], l = blkLabel(x.body);
          return `<button type="button" class="opt-pill${blkHasTag(l.tags) ? ' has-cond' : ''}" data-act="opt" data-b="${b}" title="只展开这个选项">${n + 1}<span>${esc(l.text) || '（空）'}</span></button>`;
        }).join('');
        return `<div class="${cls}" ${at}><span class="bk-tag t-choice">选项</span><span class="opt-pills">${pills}</span>${(r.branches || []).length < 6 ? '<button type="button" class="small quiet" data-act="addopt">＋ 加一个选项</button>' : ''}<button type="button" class="small quiet" data-act="optall" title="全部展开">全部展开</button></div>`;
      }
      case 'branch': {
        const l = blkLabel(r.body), has = blkHasTag(l.tags);
        const open = condOpen.has(r.key), nd = needs.get(l.tags + l.text);
        const condRow = has && open ? `<div class="bk-condbox"><span>${nd ? [nd.hide ? `满足 <b>${esc(nd.hide)}</b> 才显示` : '', nd.lock ? `满足 <b>${esc(nd.lock)}</b> 才能选（不然是灰的）` : ''].filter(Boolean).join('<br>') : '<span class="dim">正在读条件…</span>'}</span><button type="button" class="small" data-act="condedit">改条件</button></div>` : '';
        return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-choice">选项 ${r.n || ''}</span><div class="bk-text bk-label" contenteditable="plaintext-only" spellcheck="false" data-edit="label" data-ph="选项的字">${esc(l.text)}</div>${has ? `<button type="button" class="cond-pill${open ? ' open' : ''}" data-act="cond" title="${open ? '收起条件' : '看这个选项的条件'}">条件</button>` : '<button type="button" class="cond-pill add" data-act="condedit" title="要满足条件才能选 / 才显示">＋条件</button>'}<span class="bk-tools"><button type="button" data-act="delopt" title="删掉这个选项（连同它下面的内容）">删掉这个选项</button></span>${condRow}</div>`;
      }
      case 'if': {
        // 「■ 如果」是原来的结构行：删不掉，但能改条件 / 整个拆掉（拆掉 = 里面的内容提上来，「否则」那段删掉）
        const nth = rows.slice(0, r.i).filter(x => x.kind === 'if').length;
        const cmdLine = ed.condLines && ed.at ? ed.condLines()[nth] : null;
        const src = s.replace(/^■\s*如果\s*/, '');
        const cbtn = cmdLine == null ? '' : `<button type="button" class="cndbtn" data-ifline="${cmdLine}" data-iftext="${esc(src)}" data-iat="${esc(JSON.stringify(ed.at))}" title="改这个条件；留空 = 拆掉这个条件（里面的内容提上来）">条件</button>`;
        return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-if">如果</span><span class="bk-static">${esc(src)}</span>${cbtn}<span class="bk-note">（点「条件」改；留空保存 = 拆掉）</span></div>`;
      }
      case 'else': return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-if">否则</span></div>`;
      case 'cancel': return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-choice">按取消时</span></div>`;
      case 'loop': return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag">循环</span></div>`;
      case 'end': return `<div class="${cls}" ${at}><span class="bk-end">${esc(s.replace(/^■\s*/, ''))}</span></div>`;
      case 'anchor':
        if (/^■\s*注释：<RpgStudioScene>/.test(s)) return `<div class="${cls}" ${at} hidden></div>`;   // 场景库标记，不用给人看
        return `<div class="${cls}" ${at}><span class="chip c-anchor" title="原来的结构，不能改、删、挪">${esc(s.replace(/^■\s*/, ''))}</span></div>`;
      case 'choice':
        return `<div class="${cls}" ${at}><span class="bk-tag t-choice">新选项</span><span class="opt-pills">${(r.labels || []).map((l, n) => `<button type="button" class="opt-pill${blkHasTag(l) ? ' has-cond' : ''}" data-act="kopt" data-k="${n + 1}" title="只展开这个选项">${n + 1}<span>${esc(blkStrip(l))}</span></button>`).join('')}</span><button type="button" class="small quiet" data-act="kedit">改选项…</button>${tools(r, { delTitle: '删掉这组选项（连同每个选项下面的内容）' })}</div>`;
      case 'khead':
        return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-choice">选项 ${r.k}</span><span class="bk-static">${esc(blkStrip(r.label))}</span><span class="bk-note">选中这里再插入 = 插进这个选项</span></div>`;
      case 'nif':
        return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-if">如果</span><button type="button" class="chip c-flow" data-act="nifedit" title="改条件">${esc(s.replace(/^[#＃]\s*(?:如果|条件)[\s:：]*/, ''))}</button>${tools(r, { delTitle: '删掉整个「如果」（连同里面的内容）' })}</div>`;
      case 'nelse': return `<div class="${cls}" ${at}>${fold(r)}<span class="bk-tag t-if">否则</span>${tools(r, { delTitle: '去掉「否则」（下面的内容并进上面那段）' })}</div>`;
      case 'nend': return `<div class="${cls}" ${at}><span class="bk-end">如果结束</span></div>`;
    }
    return `<div class="${cls}" ${at}><span class="bk-static">${esc(s)}</span></div>`;
  }
  function draw() {
    const hid = hiddenSet();
    host.innerHTML = rows.length && !(rows.length === 1 && rows[0].kind === 'blank')
      ? rows.map(r => rowHtml(r, hid.has(r.i))).join('')
      : '<div class="bk-empty">这一页还是空的：用上面的「插入 …」按钮加台词、选项、传送……</div>';
    hint();
    loadNeeds();
  }
  // 「新插的放在哪」
  function hint() {
    const h = ed.hintEl;
    if (!h) return;
    if (sel < 0 || !rows[sel]) { h.textContent = '新插的放在最后；点一块选中它，就插在它后面'; return; }
    const r = rows[sel];
    const what = r.kind === 'branch' ? `选项 ${r.n}「${blkLabel(r.body).text}」里面` : r.kind === 'khead' ? `选项 ${r.k} 里面` : ['if', 'nif'].includes(r.kind) ? '「如果」里面' : ['else', 'nelse'].includes(r.kind) ? '「否则」里面' : r.kind === 'cancel' ? '「按取消时」里面' : '选中的这一块后面';
    h.textContent = '新插的放在：' + what + (r.k && r.kind !== 'khead' ? `（选项 ${r.k} 里）` : '') + '　Esc 取消选中';
  }
  // 选项的条件：一次问服务端，回来再填
  let needsTimer = 0;
  function loadNeeds() {
    const want = [];
    for (const r of rows) {
      if (r.kind === 'branch') { const l = blkLabel(r.body); if (blkHasTag(l.tags) && condOpen.has(r.key) && !needs.has(l.tags + l.text)) want.push(l.tags + l.text); }
    }
    if (!want.length) return;
    clearTimeout(needsTimer);
    needsTimer = setTimeout(async () => {
      try {
        const r = await api('choice/needs?labels=' + enc(JSON.stringify(want)));
        want.forEach((l, k) => needs.set(l, r.needs[k]));
        draw();
      } catch (e) { toast(e.message, true); }
    }, 30);
  }

  // ---------- 插在哪 ----------
  function unitEnd(i) {
    // 台词连着它的「＋」行一起算一块
    let j = i + 1;
    if (rows[i] && rows[i].kind === 'say') while (j < rows.length && rows[j].kind === 'more' && rows[j].k === rows[i].k && rows[j].bars === rows[i].bars) j++;
    return j;
  }
  function insertPoint() {
    if (sel < 0 || !rows[sel]) return { at: lines.length, bars: 0, k: 0 };
    const r = rows[sel];
    if (['branch', 'if', 'else', 'cancel', 'loop'].includes(r.kind)) return { at: r.i + 1, bars: r.bars + 1, k: 0 };
    if (['nif', 'nelse'].includes(r.kind)) return { at: r.i + 1, bars: r.bars, k: 0 };
    if (r.kind === 'khead') return { at: r.end, bars: r.bars, k: r.k };
    if (r.kind === 'chead') return { at: r.endRow != null ? r.endRow + 1 : r.i + 1, bars: r.bars, k: 0 };
    if (r.kind === 'choice') { let j = r.i + 1; while (j < rows.length && rows[j].k && rows[j].choice === r.i) j++; return { at: j, bars: r.bars, k: 0 }; }
    if (r.kind === 'nend' || r.kind === 'end') return { at: r.i + 1, bars: r.bars, k: 0 };
    return { at: unitEnd(r.i), bars: r.bars, k: r.k };
  }
  function insert(text) {
    const add = String(text).split('\n');
    const p = insertPoint();
    if (p.k && add.some(l => /^[#＃]\s*(?:选项|如果|条件)[\s:：]/.test(l))) { toast('新写的选项里面不能再套选项 / 条件；先保存，再往里加', true); return; }
    const next = [...lines];
    // 文字最后是空行、又插在最后：插在空行前面
    let at = p.at;
    if (at === next.length && next.length && next[next.length - 1] === '' && sel < 0) at = next.length - 1;
    next.splice(at, 0, ...add.map(l => '│ '.repeat(p.bars) + (p.k ? '#' + p.k + ' ' : '') + l));
    // 选中刚插的第一行（插的是「#如果」「#选项」：选中它，接着插就进到它里面）
    commit(next, at);
    const r = rows[at];
    if (!r) return;
    const t = host.querySelector(`.bk[data-i="${at}"] .bk-text`);
    if (t && (r.kind === 'say' || r.kind === 'more') && !t.textContent) { focusEnd(t); } else scrollTo(at);
  }
  const scrollTo = i => { const el = host.querySelector(`.bk[data-i="${i}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); };
  function focusEnd(el, atStart) {
    el.focus();
    const rg = document.createRange();
    rg.selectNodeContents(el);
    rg.collapse(!!atStart);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
    el.scrollIntoView({ block: 'nearest' });
  }
  function select(i) {
    if (sel === i) return;
    const old = host.querySelector('.bk.sel');
    if (old) old.classList.remove('sel');
    sel = i;
    const el = host.querySelector(`.bk[data-i="${i}"]`);
    if (el) el.classList.add('sel');
    hint();
  }

  // ---------- 改 ----------
  function setRow(i, inner) { const next = [...lines]; next[i] = prefix(rows[i]) + inner; commit(next); }
  function removeRange(a, b, newSel) { const next = [...lines]; next.splice(a, b - a); commit(next, newSel != null ? newSel : Math.min(a, next.length - 1)); }
  function move(i, d) {
    const r = rows[i];
    const a = r.i, b = unitEnd(a);
    if (d < 0) {
      let p = a - 1;
      while (p >= 0 && rows[p].kind === 'more') p--;
      const q = rows[p];
      if (!q || !BLK_MOVABLE.has(q.kind) || q.bars !== r.bars || q.k !== r.k) { toast('挪不过去：上面是选项 / 条件的结构。要挪进挪出，删掉再插', true); return; }
      const next = [...lines];
      const unit = next.splice(a, b - a);
      next.splice(p, 0, ...unit);
      commit(next, p);
    } else {
      const q = rows[b];
      if (!q || !BLK_MOVABLE.has(q.kind) || q.bars !== r.bars || q.k !== r.k) { toast('挪不过去：下面是选项 / 条件的结构。要挪进挪出，删掉再插', true); return; }
      const qe = unitEnd(b);
      const next = [...lines];
      const unit = next.splice(a, b - a);
      next.splice(a + (qe - b), 0, ...unit);
      commit(next, a + (qe - b));
    }
  }
  async function del(i) {
    const r = rows[i];
    if (r.kind === 'choice') {
      let j = i + 1;
      while (j < rows.length && rows[j].k && rows[j].choice === i) j++;
      if (j - i > 1 + r.labels.length && !(await confirmDialog('删掉这组选项', '每个选项下面写的内容也一起删掉？', '删掉'))) return;
      return removeRange(i, j);
    }
    if (r.kind === 'nif') {
      // 找配对的 #结束
      let depth = 0, j = i;
      for (; j < rows.length; j++) { if (rows[j].kind === 'nif') depth++; if (rows[j].kind === 'nend' && --depth === 0) break; }
      if (j - i > 1 && !(await confirmDialog('删掉整个「如果」', '里面写的内容也一起删掉？', '删掉'))) return;
      return removeRange(i, Math.min(rows.length, j + 1));
    }
    if (r.kind === 'say') return removeRange(i, unitEnd(i));
    return removeRange(i, i + 1);
  }
  async function editChip(i, el) {
    const r = rows[i], c = chip(r.inner);
    const replace = inner => { if (inner) setRow(i, inner); };
    if (c.verb === '传送') {
      let item = null;
      try { const p = await api('line/parse?text=' + enc(r.inner)); item = p.items && p.items[0]; if (p.error) toast(p.error, true); } catch (e) { toast(e.message, true); }
      const t = await transferDialog(item && item.map ? item.map : ed.mapId, { scene: ed.scene, initial: item && item.map ? { x: item.x, y: item.y, who: item.who || '', dir: BLK_DIR[item.dir] || '', steps: item.steps || '' } : null });
      if (t) replace(transferLine(t));
      return;
    }
    const items = [];
    if (c.verb === '场景') items.push(['换一个场景…', async () => { const n = await scenePicker(); if (n) replace('#场景 ' + n); }], ['打开这个场景看看', async () => {
      try { const p = await api('line/parse?text=' + enc(r.inner)); const it = p.items && p.items[0]; if (it && it.id) location.hash = '#/ce/' + it.id; else toast(p.error || '找不到这个场景', true); } catch (e) { toast(e.message, true); }
    }]);
    if (c.verb === '扮演') items.push(['换一个人…', async () => { const l = await asDialog(); if (l) replace(l); }]);
    if (c.verb === '变量') items.push(['换一个变量…', async () => { const n = await pickDialog('换一个变量', 'lookup?kind=var'); if (!n) return; const op = /([=+\-*/%]\s*-?\d+)\s*$/.exec(c.rest); replace('#变量 ' + n + ' ' + (op ? op[1] : '= 0')); }]);
    if (c.verb === '开关') items.push(['换一个开关…', async () => { const n = await pickDialog('换一个开关', 'lookup?kind=switch'); if (n) replace('#开关 ' + n + (/关\s*$/.test(c.rest) ? ' 关' : ' 开')); }], [/关\s*$/.test(c.rest) ? '改成「开」' : '改成「关」', () => replace('#开关 ' + c.rest.replace(/\s*(开|关)\s*$/, '') + (/关\s*$/.test(c.rest) ? ' 开' : ' 关'))]);
    if (c.verb === '物品') items.push(['换一个物品…', async () => { const n = await pickDialog('换一个物品', 'lookup?kind=item'); if (!n) return; const k = /([+\-]\s*\d+)\s*$/.exec(c.rest); replace('#物品 ' + n + ' ' + (k ? k[1].replace(/\s+/g, '') : '+1')); }]);
    if (['图', 'CG', 'cg', '显示图片'].includes(c.verb)) items.push(['换一张图…', async () => { const n = await pickDialog('换一张图', 'images?sub=pictures', true); if (n) replace('#图 ' + n); }]);
    items.push(['改成文字（直接改这一行）', () => rawEdit(i)], ['删掉这一行', () => del(i)]);
    menu(el, items);
  }
  // 在按钮下面弹一个小菜单
  function menu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'bk-menu';
    m.innerHTML = items.map(([t], k) => `<button type="button" data-k="${k}">${esc(t)}</button>`).join('');
    document.body.appendChild(m);
    const rc = anchor.getBoundingClientRect();
    m.style.left = Math.min(rc.left, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = (rc.bottom + 4 + m.offsetHeight > innerHeight ? rc.top - m.offsetHeight - 4 : rc.bottom + 4) + 'px';
    m.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; closeMenu(); items[Number(b.dataset.k)][1](); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  const outside = e => { if (!e.target.closest('.bk-menu')) closeMenu(); };
  function closeMenu() { $$('.bk-menu').forEach(m => m.remove()); document.removeEventListener('mousedown', outside, true); }
  // ✎ 改成文字：这一行变成输入框
  function rawEdit(i) {
    const r = rows[i];
    const el = host.querySelector(`.bk[data-i="${i}"]`);
    if (!el) return;
    el.innerHTML = `<input class="bk-raw" value="${esc(r.inner)}" spellcheck="false"><span class="bk-note">回车 = 改好了，Esc = 不改</span>`;
    const inp = $('input', el);
    inp.focus(); inp.select();
    let done = false;
    const finish = ok => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value !== r.inner) setRow(i, inp.value.trim()); else draw(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); };
    inp.onblur = () => finish(true);
  }
  async function editCond(i) {
    const r = rows[i], l = blkLabel(r.body);
    let cur = { lockNeed: '', hideNeed: '' };
    if (blkHasTag(l.tags)) {
      try { const x = await api('choice/needs?labels=' + enc(JSON.stringify([l.tags + l.text]))); cur = x.needs[0]; } catch (e) { toast(e.message, true); return; }
    }
    const nd = await choiceCondDialog(null, null, l.text, cur, { local: true });
    if (!nd) return;
    try {
      const x = await api(`choice/relabel?label=${enc(l.text)}&lockNeed=${enc(nd.lockNeed)}&hideNeed=${enc(nd.hideNeed)}`);
      const nl = blkLabel('■ 选了「' + x.label + '」');
      condOpen.add('branch\u0001' + l.head + nl.tags + nl.text + '」\u00010');
      setRow(i, l.head + x.label + '」');
    } catch (e) { toast(e.message, true); }
  }
  async function editChoice(i) {
    const r = rows[i];
    const v = await promptDialog('改选项的字', '用 | 隔开，2~6 个（减少选项会删掉多出来那几个选项下面的内容）', r.labels.join(' | '));
    if (v == null) return;
    const labels = v.split(/[|｜]/).map(x => x.trim()).filter(Boolean).slice(0, 6);
    if (labels.length < 2) { toast('至少要两个选项', true); return; }
    const next = [...lines];
    // 去掉多出来的选项下面的行；新加的选项补一行「#N」
    const drop = new Set();
    let last = i;
    for (let j = i + 1; j < rows.length && rows[j].k && rows[j].choice === i; j++) { if (rows[j].k > labels.length) drop.add(j); last = j; }
    next[i] = '│ '.repeat(r.bars) + '#选项 ' + labels.join(' | ');
    const extra = [];
    for (let k = r.labels.length + 1; k <= labels.length; k++) extra.push('│ '.repeat(r.bars) + '#' + k);
    next.splice(last + 1, 0, ...extra);
    commit(next.filter((_, j) => !drop.has(j)), i);
  }
  function addOption(i) {
    const r = rows[i];
    const at = r.cancelRow != null ? r.cancelRow : r.endRow != null ? r.endRow : r.i + 1;
    const next = [...lines];
    next.splice(at, 0, '│ '.repeat(r.bars) + '■ 选了「新的选项」');
    commit(next, at);
    const t = host.querySelector(`.bk[data-i="${at}"] .bk-label`);
    if (t) { focusEnd(t); const rg = document.createRange(); rg.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
  }
  async function delOption(i) {
    const r = rows[i];
    if (r.end - i > 1 && !(await confirmDialog('删掉这个选项', `「${blkLabel(r.body).text}」下面写的内容也一起删掉？`, '删掉'))) return;
    removeRange(i, r.end, Math.max(0, i - 1));
  }
  // 点了选项里的某一个：只展开它，同一组的其它收起来
  function accordion(branchRows, keep) {
    for (const b of branchRows) { const x = rows[b]; if (b === keep) folded.delete(x.key); else folded.add(x.key); }
    sel = keep;
    draw();
    scrollTo(keep);
  }

  // ---------- 事件 ----------
  host.addEventListener('mousedown', e => {
    const row = e.target.closest('.bk');
    if (row && !e.target.closest('.bk-tools, .bk-fold')) select(Number(row.dataset.i));
  });
  host.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = b.closest('.bk');
    const i = row ? Number(row.dataset.i) : -1;
    const r = rows[i];
    const act = b.dataset.act;
    if (act === 'fold') { if (folded.has(r.key)) folded.delete(r.key); else folded.add(r.key); draw(); return; }
    if (act === 'up' || act === 'down') return move(i, act === 'up' ? -1 : 1);
    if (act === 'del') return del(i);
    if (act === 'raw') return rawEdit(i);
    if (act === 'chip') return editChip(i, b);
    if (act === 'keep') { toast('编辑框表达不了的指令：能删、能挪，不能改（要改去 RPG Maker 里）'); return; }
    if (act === 'who') {
      const p = sayParts(r.inner);
      const NARR = '旁白（没有名字）', MANUAL = '（手动输入…）';
      const pick = await chooseDialog('谁说的', [NARR, ...actors, MANUAL]);
      if (!pick) return;
      const name = pick === NARR ? '' : pick === MANUAL ? ((await promptDialog('谁说的', '名字（12 个字以内）', p.name)) || '').trim().slice(0, 12) : pick;
      if (pick === MANUAL && !name) return;
      return setRow(i, sayLine(name, p.text));
    }
    if (act === 'cond') { if (condOpen.has(r.key)) condOpen.delete(r.key); else condOpen.add(r.key); draw(); return; }
    if (act === 'condedit') return editCond(i);
    if (act === 'delopt') return delOption(i);
    if (act === 'addopt') return addOption(i);
    if (act === 'optall') { for (const x of r.branches || []) folded.delete(rows[x].key); draw(); return; }
    if (act === 'opt') return accordion(r.branches || [], Number(b.dataset.b));
    if (act === 'kopt') {
      const heads = rows.filter(x => x.kind === 'khead' && x.choice === i).map(x => x.i);
      const keep = heads.find(h => rows[h].k === Number(b.dataset.k));
      if (keep == null) { toast('这个选项下面还没有内容'); return; }
      return accordion(heads, keep);
    }
    if (act === 'kedit') return editChoice(i);
    if (act === 'nifedit') {
      const cur = r.inner.replace(/^[#＃]\s*(?:如果|条件)[\s:：]*/, '');
      const v = await ifBuilder(cur);
      if (v) setRow(i, '#如果 ' + v);
    }
  });
  // 打字
  host.addEventListener('input', e => {
    const t = e.target.closest('[data-edit]');
    if (!t) return;
    const i = Number(t.closest('.bk').dataset.i), r = rows[i];
    let text = t.textContent;
    // 粘贴进来好几行：第一行留在这里，后面的变成同一个对话框里的「＋」行（选项的字只要一行）
    if (/\n/.test(text)) {
      const parts = text.split(/\r?\n/);
      const next = [...lines];
      if (t.dataset.edit === 'label') { const l = blkLabel(r.body); next[i] = prefix(r) + l.head + l.tags + parts.join(' ').trim() + '」'; return commit(next, i); }
      next[i] = prefix(r) + (t.dataset.edit === 'say' ? sayLine(sayParts(r.inner).name, parts[0]) : '＋' + parts[0]);
      next.splice(i + 1, 0, ...parts.slice(1).map(p => prefix(r) + '＋' + p));
      return commit(next, i + parts.length - 1);
    }
    if (t.dataset.edit === 'say') typeLine(i, prefix(r) + sayLine(sayParts(r.inner).name, text));
    else if (t.dataset.edit === 'more') typeLine(i, prefix(r) + '＋' + text);
    else if (t.dataset.edit === 'label') { const l = blkLabel(r.body); typeLine(i, prefix(r) + l.head + l.tags + text + '」'); }
  });
  host.addEventListener('keydown', e => {
    const t = e.target.closest('[data-edit]');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.isComposing) { e.preventDefault(); undo(); return; }
    if (!t || e.isComposing) return;
    const i = Number(t.closest('.bk').dataset.i), r = rows[i];
    if (t.dataset.edit === 'label') { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } return; }
    const s = getSelection();
    const caret = s.rangeCount ? (() => { const rg = s.getRangeAt(0).cloneRange(); rg.selectNodeContents(t); rg.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); return rg.toString().length; })() : t.textContent.length;
    if (e.key === 'Enter') {
      // 回车：光标后面的字变成下一句（同一个人）；Shift+回车：同一个对话框里另起一行
      e.preventDefault();
      const text = t.textContent, before = text.slice(0, caret), after = text.slice(caret);
      const next = [...lines];
      const name = r.kind === 'say' ? sayParts(r.inner).name : '';
      next[i] = prefix(r) + (r.kind === 'say' ? sayLine(name, before) : '＋' + before);
      let nameForNew = name;
      if (r.kind === 'more') { let p = i - 1; while (p >= 0 && rows[p].kind === 'more') p--; nameForNew = rows[p] && rows[p].kind === 'say' ? sayParts(rows[p].inner).name : ''; }
      const at = e.shiftKey ? i + 1 : unitEnd(r.kind === 'more' ? (() => { let p = i - 1; while (p >= 0 && rows[p].kind === 'more') p--; return Math.max(0, p); })() : i);
      next.splice(at, 0, prefix(r) + (e.shiftKey ? '＋' + after : sayLine(nameForNew, after)));
      commit(next, at);
      const nt = host.querySelector(`.bk[data-i="${at}"] .bk-text`);
      if (nt) focusEnd(nt, true);
      return;
    }
    if (e.key === 'Backspace' && caret === 0 && !s.toString()) {
      // 字删空了再按退格：删掉这一句；「＋」行开头按退格：并回上一行
      if (t.textContent === '' || r.kind === 'more') {
        e.preventDefault();
        const next = [...lines];
        let prev = i - 1;
        while (prev >= 0 && !host.querySelector(`.bk[data-i="${prev}"] .bk-text`)) prev--;
        if (r.kind === 'more' && prev === i - 1 && t.textContent) {
          const pr = rows[prev];
          const keep = host.querySelector(`.bk[data-i="${prev}"] .bk-text`).textContent;
          next[prev] = prefix(pr) + (pr.kind === 'say' ? sayLine(sayParts(pr.inner).name, keep + t.textContent) : '＋' + keep + t.textContent);
          next.splice(i, 1);
          commit(next, prev);
          const pt = host.querySelector(`.bk[data-i="${prev}"] .bk-text`);
          if (pt) { focusEnd(pt); }
          return;
        }
        if (t.textContent !== '') return;
        next.splice(i, 1);
        commit(next, prev >= 0 ? prev : -1);
        const pt = prev >= 0 && host.querySelector(`.bk[data-i="${prev}"] .bk-text`);
        if (pt) focusEnd(pt);
      }
      return;
    }
    // 上下键：到头了就跳到上一句 / 下一句
    if ((e.key === 'ArrowUp' && caret === 0) || (e.key === 'ArrowDown' && caret === t.textContent.length)) {
      const all = $$('.bk:not([hidden]) .bk-text[data-edit]', host);
      const k = all.indexOf(t) + (e.key === 'ArrowUp' ? -1 : 1);
      if (all[k]) { e.preventDefault(); focusEnd(all[k], e.key === 'ArrowDown'); select(Number(all[k].closest('.bk').dataset.i)); }
    }
  });
  host.addEventListener('focusout', e => { if (e.target.closest('[data-edit]')) typing = -1; });
  host.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.target.closest('[data-edit]')) { select(-1); draw(); } });

  function reload() { lines = ed.get().split('\n'); analyze(); draw(); }
  // 插了台词又没写字（「林屿：」「＋」）：保存前去掉，不然存成一句只有名字的旁白
  function clean() {
    const drop = new Set();
    for (const r of rows) {
      if (r.kind === 'say' && !sayParts(r.inner).text.trim()) { drop.add(r.i); for (let j = r.i + 1; j < rows.length && rows[j].kind === 'more' && !rows[j].inner.slice(1).trim(); j++) drop.add(j); }
      if (r.kind === 'more' && !r.inner.slice(1).trim()) drop.add(r.i);
    }
    if (!drop.size) return;
    commit(lines.filter((_, j) => !drop.has(j)), -1);
  }
  // 保存报错里带了「…」：标出是哪一行
  function flag(msg) {
    $$('.bk.bad', host).forEach(x => x.classList.remove('bad'));
    const q = /「([^「」]{2,})」/.exec(String(msg || ''));
    if (!q) return;
    const r = rows.find(x => x.raw.includes(q[1]) || x.inner.includes(q[1]));
    if (!r) return;
    const el = host.querySelector(`.bk[data-i="${r.i}"]`);
    if (el) { el.hidden = false; el.classList.add('bad'); el.scrollIntoView({ block: 'center' }); }
  }
  reload();
  return { insert, reload, flag, undo, clean, destroy: closeMenu };
}
