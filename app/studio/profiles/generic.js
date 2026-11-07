'use strict';
// 通用配置：不知道这个游戏有什么约定时用它
//   图片：新图从 1 号往上叠；只写「#清图」= 关掉这一页自己显示的图（不碰别的编号，免得关掉界面图）
module.exports = {
  id: 'generic',
  label: '通用',
  match: () => 1,
  pictures: { min: 1, max: 100, clearAll: 'shown' },
  notes: [],
  hints: {},
};
