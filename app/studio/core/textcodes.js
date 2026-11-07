'use strict';
// 台词里的文字代码 → 游戏里实际显示的样子（阅读视图、预览播放用；改台词的编辑框里保持原样，不然存回去就丢了）
//   RPG Maker 自带：\N[n] 角色名  \P[n] 队伍成员  \V[n] 变量  \G 货币单位  \C[n] 颜色  \I[n] 图标  \{ \} 字号
//                   \$ 金钱窗口  \. \| 等一下  \! 等按键  \> \< 一口气显示  \^ 不等按键  \\ 反斜杠
//   VisuMZ_1_MessageCore（很多游戏装了）：<center> <left> <right> 对齐  <b> <i> 粗体斜体  <br> 换行  <WordWrap> 自动换行
//                   \Item[n] \ItemName[n] \Weapon[n] \Armor[n] \Skill[n] \State[n] \Class[n] \Enemy[n] 名字
//                   \LastGainObj \LastGainObjName 刚得到的东西  \LastGainObjQuantity 刚得到几个
//                   \FS[n] \PX[n] \PY[n] \HexColor<…> \FontChange<…> \Wait[n] … 排版用的，阅读时去掉
// 「刚得到的东西」要看这句台词前面最近一条「增减物品 / 武器 / 防具 / 金钱」（调用方把它传进来）
const DB = { item: 'Items.json', weapon: 'Weapons.json', armor: 'Armors.json', skill: 'Skills.json', state: 'States.json', class: 'Classes.json', enemy: 'Enemies.json' };
const GAIN = { 125: 'gold', 126: 'item', 127: 'weapon', 128: 'armor' };
// 去掉的：带 [参数] 的、带 <参数> 的、不带参数的、单个符号的
const STRIP_ARG = /\\(?:C|I|PX|PY|FS|OutlineColor|OutlineWidth|Wait|CommonEvent|ActorFace|PartyFace|FaceIndex|TroopMember|TroopNameMember)\[[^\]]*\]/gi;
const STRIP_ANGLE = /\\(?:FontChange|HexColor|OutlineHexColor|WindowMoveTo|WindowMoveBy|ChangeFace|Picture|CenterPicture)<[^>]*>/gi;
const STRIP_WORD = /\\(?:ResetFont|ResetColor|WindowReset|NormalBG|DimBG|TransparentBG)(?![A-Za-z])/gi;
const STRIP_SYM = /\\[{}$.|!><^]/g;
const STRIP_TAG = /<\/?(?:b|i|ColorLock|WordWrap|Caps|Upper|Lower|Alt|Chaos)>|<Auto(?:[^>]*)>|<(?:Position|Coordinates|Dimensions|Offset):[^>]*>|<Next Page>/gi;
const ALIGN = /<(\/?)(left|center|right)>/gi;
const BREAK = /<(?:br|line break)>/gi;

function createTextCodes(project) {
  const P = project;
  const nameOf = (kind, id) => {
    const r = (P.read(DB[kind]) || [])[id];
    return r && r.name ? String(r.name) : '';
  };
  const currency = () => String((P.read('System.json') || {}).currencyUnit || '金钱');

  // 一条「增减物品 / 武器 / 防具 / 金钱」→ 刚得到的东西 { name, n }（减少的、用变量算的数量也认，数量写成〔变量〕）
  function gainOf(c) {
    const kind = c && GAIN[c.code];
    if (!kind) return null;
    const p = c.parameters || [];
    const [op, type, val] = kind === 'gold' ? [p[0], p[1], p[2]] : [p[1], p[2], p[3]];
    if (op !== 0) return null;   // 减少不算「得到」
    const n = type === 0 ? String(val) : `〔${P.name('var', val) || '变量 ' + val}〕`;
    const name = kind === 'gold' ? currency() : (nameOf(kind, p[0]) || `${{ item: '物品', weapon: '武器', armor: '防具' }[kind]} ${p[0]}`);
    return { name, n };
  }
  // 往前找这句台词之前最近的「得到」（同一页里）
  function gainBefore(list, i) {
    for (let k = i - 1; k >= 0; k--) { const g = gainOf(list[k]); if (g) return g; }
    return null;
  }

  function word(s, gain) {
    return String(s)
      .replace(/\\\\/g, '\u0000')
      .replace(/\\LastGainObjQuantity/gi, () => (gain ? gain.n : '〔数量〕'))
      .replace(/\\LastGainObj(?:Name)?(?![A-Za-z])/gi, () => (gain ? gain.name : '〔刚得到的东西〕'))
      .replace(/\\(Item|Weapon|Armor)Quantity\[(\d+)\]/gi, (m, k, id) => `〔${nameOf(k.toLowerCase(), Number(id)) || k + ' ' + id}的数量〕`)
      .replace(/\\(Item|Weapon|Armor|Skill|State|Class|Enemy)(?:Name)?\[(\d+)\]/gi, (m, k, id) => nameOf(k.toLowerCase(), Number(id)) || m)
      .replace(/\\V\[(\d+)\]/gi, (m, id) => `〔${P.name('var', Number(id)) || '变量 ' + id}〕`)
      .replace(/\\P\[(\d+)\]/gi, (m, n) => `〔队伍第 ${n} 人〕`)
      .replace(/\\G(?![A-Za-z])/g, () => currency())
      .replace(STRIP_ARG, '').replace(STRIP_ANGLE, '').replace(STRIP_WORD, '').replace(STRIP_SYM, '').replace(STRIP_TAG, '');
  }

  // 一个对话框的几行 → [{ text, align }]（只剩代码的行去掉；<br> 拆成两行；对齐跟着往后走）
  function render(lines, o = {}) {
    const out = [];
    let align = 'left';
    for (const raw0 of lines || []) {
      const raw = P.expandN(String(raw0 ?? ''));
      const segs = raw.split(BREAK);
      for (const seg of segs) {
        let lineAlign = null, text = '';
        let last = 0;
        const parts = [];
        seg.replace(ALIGN, (m, close, a, at) => { parts.push([seg.slice(last, at), close ? 'left' : a.toLowerCase()]); last = at + m.length; return m; });
        parts.push([seg.slice(last), null]);
        for (const [chunk, next] of parts) {
          const t = word(chunk, o.gain);
          if (t.trim() && lineAlign == null) lineAlign = align;
          text += t;
          if (next) align = next;
        }
        text = text.replace(/\u0000/g, '\\');
        // 原来就是空行：留着（排版用的空行）；只有代码的行：去掉
        if (!text.trim() && seg.trim()) continue;
        out.push({ text, align: lineAlign || align });
      }
    }
    return out;
  }
  return { render, gainOf, gainBefore, word: (s, gain) => word(P.expandN(String(s ?? '')), gain).replace(/\u0000/g, '\\') };
}

module.exports = { createTextCodes };
