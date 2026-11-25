'use strict';
const animated = require('./animated-portrait.js');
const installed = [animated, require('./layered-portrait.js'), require('./stage.js'), require('./map-effects.js'), require('./map-enemies.js'), require('./shop.js'), require('./directions.js'), require('./world-time.js'), require('./quests.js'), require('./variable-rules.js'), require('./page-conditions.js')];
const library = [
  ['RpgStudio_AnimatedPortrait', '动态立绘', '在游戏画面内用画中画显示 Live2D 或视频，可框选范围、设置淡入淡出并随主角动作切换。', '#/plugins/market/RpgStudio_AnimatedPortrait'],
  ['RpgStudio_LayeredPortrait', '分层立绘', '在人物页拼接部位、组合表情，制作可用于剧情和画中画的立绘。', '#/people'],
  ['RpgStudio_Stage', '剧情演出', '移动、气泡、飘字和场景演出。', '#/scenes'],
  ['RpgStudio_MapEffects', '地图效果', '天气与地形高低差。', ''],
  ['RpgStudio_MapEnemies', '地图敌人', '游荡、追踪与随机遇敌条件。', '#/people/enemies'],
  ['RpgStudio_Shop', '条件商店', '购买条件、代币、限购和持有量。', '#/inventory'],
  ['RpgStudio_Directions', '斜向站姿', '为四方向走路补上斜向朝向。', '#/sprites'],
  ['RpgStudio_WorldTime', '世界时间', '游戏时钟和人物日程。', '#/people'],
  ['RpgStudio_Quests', '任务日志', '全局任务进度和游戏内日志。', '#/quests'],
  ['RpgStudio_VariableRules', '变量规则', '按步数或时间自动累计，以及变量组。', '#/names/var'],
  ['RpgStudio_PageConditions', '事件页条件', '同时判断多个变量、开关、持有物品等出现条件。', ''],
];

function cards(project) {
  const system = project.sys(), registered = project.plugins();
  return library.map(([id, name, description, href]) => {
    const extension = installed.find(item => item.ENTRY?.name === id);
    const entry = registered.find(item => item.name === id);
    return { id, name, description, href, managed: id === animated.ENTRY.name, enabled: id === animated.ENTRY.name ? animated.used(system) :
      (!!entry && entry.status !== false) || !!extension?.used?.(system) };
  });
}

module.exports = { cards };
