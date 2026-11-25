'use strict';
const writingGroups = { text: '对话与事件', reward: '数值与奖励', quest: '任务', stage: '画面与演出', extra: '进阶' };
const writingRows = [
  ['text', '人物：台词', '一行一句。省略人物就是旁白。', true],
  ['text', '＋第二行', '接在同一个对话框里。'],
  ['text', '：旁白', '保留旁白里的冒号或指令符号。'],
  ['text', '#选项 1 2 3 / #选项 去 | 不去', '用 #1、#2、#3 写各自的内容，例如 #1 #场景 杂货店。'],
  ['text', '#如果 变量 好感度 >= 3', '用 #条件结束 收尾，中间可写 #否则。支持开关条件，以及「并且」「或者」。', true],
  ['text', '#传送 村口 5 8', '传到指定地图的格子。可加「朝上」或「前进2」。'],
  ['text', '#场景 初遇', '播放场景或公共事件。'],
  ['text', '#输入数字 密码 4', '把玩家输入的数字存入变量。位数可设 1～8。'],
  ['text', '#商店\n#物品 回复药\n#金币 100G\n#商店结束', '每件商品单独写。可加 #条件 开关 开业 开。#变量 100 读取变量作为金币价格，#变量 代币 100 则扣 100 代币。'],
  ['text', '#限购 1', '写在商店的一件商品下面。同一家商店累计最多买 1 个，随存档保存。购买还需有足够的钱和背包余量。'],
  ['reward', '#物品 药水 +1', '获得一个药水。减号表示扣除，可用名称或编号。', true],
  ['reward', '#变量 好感度 + 1', '提高好感度。支持 = + - * / %。', true],
  ['reward', '#开关 已交付 开', '写「关」关闭开关。', true],
  ['reward', '#金币 +100', '加钱。减号扣钱。', true],
  ['reward', '#结算 交付奖励', '执行已有的结算组。', true],
  ['reward', '#武器 铁剑 +1 / #防具 皮甲 -1', '增减背包里的装备。'],
  ['reward', '#恢复 全队', '完全恢复全队。写 #恢复 林屿 可指定角色。'],
  ['reward', '#队伍 林屿 加入 / #队伍 林屿 离队', '更改队伍成员。'],
  ['reward', '#经验 林屿 +20', '增减指定角色或全队的经验。'],
  ['reward', '#技能 林屿 | 治疗 学会', '也可写「忘记」，或指定全队。'],
  ['quest', '#任务 找钥匙 接取', '从事件或场景接取任务。可用名称或编号。'],
  ['quest', '#任务 找钥匙 推进 2', '从第 1 步推进到第 2 步。'],
  ['quest', '#任务 找钥匙 完成', '最后一步达成条件后交付，执行奖励组。'],
  ['quest', '#任务 找钥匙 失败', '把进行中的任务标为失败。'],
  ['quest', '#如果 任务 找钥匙 完成', '可判断未接取、已接取、完成、失败或第 N 步。用 #条件结束 收尾。'],
  ['stage', '#图 图片名 / #清图', '显示或关闭图片。可用 #清图 图片2 或 #清图 图片名 指定。'],
  ['stage', '#等待 1.5', '暂停 1.5 秒。'],
  ['stage', '#音乐 曲名 / #音效 铃声', '可追加音量。也可写 #停音乐 2、#环境音、#停环境音。'],
  ['stage', '#立绘 林屿 笑 左 / #退场 林屿', '显示或收起立绘。位置可写左、中、右。'],
  ['stage', '#立绘 林屿 笑 左 动作=挥手', '播人物页的分层立绘。还可写自然、呼吸、行走、攻击、受击。人物名字含空格或重名时可写 @角色编号。'],
  ['stage', '#立绘 林语 默认 原位', '把从事件提取的木偶放到源画面的位置。也可以选择左、中、右。'],
  ['stage', '#立绘 林语\n#立绘 受伤', '用立绘名称显示，默认靠右。人物立绘可框选显示区域。「受伤」是当前立绘里保存的自定义指令组。'],
  ['stage', '#立绘 表情 悲伤\n#立绘 上衣 破损', '对当前显示的立绘单独换表情或部位。普通换件按「#立绘 部位 素材名」填，部位可选身体、腿部、手部等。'],
  ['stage', '#如果 受伤变量\n#立绘 身体 身体受伤\n#结束', '变量非零时换当前立绘的身体。建立「受伤」自定义指令组时，可在组里逐行写 #身体 身体受伤、#腿部 受伤、#手部 伤口。'],
  ['stage', '#攻击 / #受击 / #立绘动作 拔剑', '播放当前木偶的动作组。临时换件和表情会在动作结束时恢复。'],
  ['stage', '#字幕 第一章', '居中显示字幕。用全角竖线「｜」换行。'],
  ['stage', '#淡出 / #淡入 / #色调 夜晚 2', '切换画面与色调。'],
  ['stage', '#天气 雨 / #震动 / #闪光 红', '天气可选雨、暴雨、雪和无，强度和过渡时间可用「天气」按钮设置。'],
  ['stage', '#移动 本事件 下3 左2', '可写转身、跳、等0.5、速度2或气泡。末尾加「不等」可并行。'],
  ['stage', '#移动 守卫 右2 转右上', '先走两格，再显示右上站姿。也可转左上、转左下、转右下。'],
  ['stage', '#面向主角 / #气泡 ：你好！', 'NPC 互动默认先面向主角。带冒号的文字气泡在 NPC 头顶显示。'],
  ['stage', '#气泡 ♥ 林屿 / #飘字 林屿：你好', '在人物头上显示气泡或文字。气泡省略人物时显示在主角头上。'],
  ['stage', '#扮演 林屿', '只在场景内使用，播完换回主角。'],
  ['stage', '#镜头 上 4 / #行走图 林屿 图名 0', '移动镜头或换行走图。'],
  ['extra', '#独立开关 A 开 / #消失', '独立开关随存档保存。临时消失会在重新进图时恢复。'],
  ['extra', '#遇敌 开 / #遇敌 关', '在游戏中允许或停止原生随机遇敌。地图仍须设置随机遇敌和敌群。'],
  ['extra', '#免遇敌 1000', '保护接下来的 1000 步，换地图或读档也会继续计数。写 0 取消保护。'],
  ['extra', '#透明 开 / #回到标题', '隐身或回到标题。'],
  ['extra', '#插件 插件名 指令名（参数…）', '参数按插件定义顺序，用逗号隔开。'],
  ['extra', '#插件 RpgStudio_AnimatedPortrait show\n#插件 RpgStudio_AnimatedPortrait hide', '按「动态立绘」插件的设定淡入或淡出画中画。隐藏状态随存档保留。'],
  ['extra', '■ 选了「…」 / 选项条件', '可编辑选项和分支。在阅读视图点「条件」设置锁定或隐藏条件。'],
  ['extra', '■ 结构 / #原样', '结构行由事件数据生成。原样行可以移动或删除。'],
];

const writingRow = ([, sample, help], attributes = '') => `<tr ${attributes}><td><code>${esc(sample)}</code></td><td>${esc(help)}</td></tr>`;

function gameplayGuideRows(group) {
  return writingRows.filter(row => row[0] === group).map(row => writingRow(row)).join('');
}

function writingHelp({ settlement = false, scene = false } = {}) {
  const rows = writingRows.filter(([group, sample]) => {
    if (settlement) return (group === 'reward' && !sample.startsWith('#结算')) || sample.startsWith('#如果');
    return scene || !sample.startsWith('#扮演');
  });
  const groups = [...new Set(rows.map(row => row[0]))];
  return `<details class="helpbox writing-help"><summary>写法</summary>
    <div class="filters"><select aria-label="写法分类" data-writing-group><option value="common">常用</option>
      ${groups.map(group => `<option value="${group}">${writingGroups[group]}</option>`).join('')}<option value="all">全部</option></select>
      <input type="search" aria-label="搜索写法" placeholder="搜索全部写法" data-writing-search></div>
    <table><tbody>${rows.map(row => writingRow(row, `data-writing-row="${row[0]}" ${row[3] ? 'data-common' : 'hidden'}`)).join('')}</tbody></table>
    <p class="dim" data-writing-empty hidden>没有匹配的写法</p></details>`;
}

function bindWritingHelp(root) {
  const guide = $('.writing-help', root);
  if (!guide) return;
  const select = $('[data-writing-group]', guide), search = $('[data-writing-search]', guide);
  const rows = $$('[data-writing-row]', guide), empty = $('[data-writing-empty]', guide);
  const update = () => {
    const q = search.value.trim().toLowerCase();
    const group = select.value;
    let count = 0;
    for (const row of rows) {
      const show = q ? row.textContent.toLowerCase().includes(q) : group === 'all' || row.dataset.writingRow === group || (group === 'common' && row.hasAttribute('data-common'));
      row.hidden = !show;
      if (show) count++;
    }
    empty.hidden = count > 0;
  };
  search.oninput = update;
  select.onchange = () => { search.value = ''; update(); };
}

function writingToolGroup(label, buttons) {
  return `<details class="mmenu writing-tools"><summary>${esc(label)}<span aria-hidden="true">▾</span></summary><div class="mlist">${buttons}</div></details>`;
}

async function shopWritingBlock() {
  const item = await pickDialog('添加商店的第一件商品', 'lookup?kind=item');
  return item ? '#商店\n#物品 ' + item + '\n#商店结束' : '';
}
