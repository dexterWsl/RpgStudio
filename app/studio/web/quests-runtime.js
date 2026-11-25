/*:
 * @target MZ
 * @plugindesc rpgStudio 任务与任务日志
 * @command progress
 * @text 任务进度
 * @arg id
 * @type number
 * @arg action
 * @type select
 * @option 接取
 * @option 推进
 * @option 完成
 * @option 失败
 * @arg step
 * @type number
 */
(() => {
  'use strict';
  const plugin = 'RpgStudio_Quests';
  const completed = 10000, failed = -1;
  const mz = typeof PluginManager.registerCommand === 'function';
  const quests = () => $dataSystem.rpgStudioQuests || [];
  const statusOf = quest => Number($gameVariables.value(quest.variable)) || 0;

  function change(interpreter, id, action, step) {
    const quest = quests().find(q => q.id === Number(id));
    if (!quest) return;
    const current = statusOf(quest), active = current > 0 && current < completed;
    let next;
    if (action === '接取' && current === 0 && (!quest.acceptSwitch || $gameSwitches.value(quest.acceptSwitch))) next = 1;
    if (action === '推进' && active && Number(step) === current + 1 && Number(step) <= quest.steps.length) next = Number(step);
    if (action === '失败' && active) next = failed;
    if (action === '完成' && active && current === quest.steps.length && (!quest.finishSwitch || $gameSwitches.value(quest.finishSwitch))) next = completed;
    if (next === undefined) return;
    $gameVariables.setValue(quest.variable, next);
    if (next === completed && quest.reward && !$gameTemp._rpgStudioRecall && $dataCommonEvents[quest.reward]) {
      interpreter.setupChild($dataCommonEvents[quest.reward].list, interpreter.isOnCurrentMap() ? interpreter.eventId() : 0);
    }
  }

  if (mz) PluginManager.registerCommand(plugin, 'progress', function(args) { change(this, args.id, args.action, args.step); });
  else {
    const original = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
      if (command === plugin) change(this, args[0], args[1], args[2]);
      else original.apply(this, arguments);
    };
  }

  const statusText = state => state === completed ? '已完成' : state === failed ? '已失败' : '进行中';
  const initWindow = (win, proto, x, y, width, height) => {
    if (mz) proto.initialize.call(win, new Rectangle(x, y, width, height));
    else proto.initialize.call(win, x, y, width, height);
  };

  class QuestList extends Window_Selectable {
    initialize(x, y, width, height) {
      this.entries = quests().filter(q => statusOf(q) !== 0);
      initWindow(this, Window_Selectable.prototype, x, y, width, height);
      this.refresh();
      this.select(this.entries.length ? 0 : -1);
    }
    maxItems() { return this.entries.length; }
    drawItem(index) {
      const quest = this.entries[index], r = this.itemRect(index);
      this.drawText(quest.name, r.x + 6, r.y, r.width - 12);
    }
    setDetail(detail) { this.detail = detail; this.updateHelp(); }
    updateHelp() { if (this.detail) this.detail.showQuest(this.entries[this.index()]); }
    select(index) { super.select(index); this.updateHelp(); }
  }

  class QuestDetail extends Window_Base {
    initialize(x, y, width, height) { initWindow(this, Window_Base.prototype, x, y, width, height); }
    showQuest(quest) {
      if (this.quest === quest && this.lines) return;
      this.quest = quest;
      this.page = 0;
      this.lines = [];
      if (!quest) { this.lines.push('还没有接取任务'); this.drawPage(); return; }
      const state = statusOf(quest);
      this.lines.push(quest.name + ' · ' + statusText(state));
      const active = state > 0 && state < completed;
      const blocks = [];
      if (active) {
        const step = Math.min(state, quest.steps.length);
        blocks.push('目标 ' + step + ' / ' + quest.steps.length, quest.steps[step - 1]);
      }
      if (quest.description) blocks.push('', ...quest.description.split('\n'));
      const width = this.contentsWidth();
      for (const block of blocks) {
        let value = '';
        for (const ch of block) {
          if (value && this.textWidth(value + ch) > width) { this.lines.push(value); value = ''; }
          value += ch;
        }
        this.lines.push(value);
      }
      this.drawPage();
    }
    pageSize() { return Math.max(1, Math.floor(this.contents.height / this.lineHeight()) - 1); }
    drawPage() {
      this.contents.clear();
      const size = this.pageSize(), width = this.contentsWidth(), height = this.lineHeight();
      this.lines.slice(this.page * size, (this.page + 1) * size).forEach((line, index) => this.drawText(line, 0, index * height, width));
      const pages = Math.ceil(this.lines.length / size);
      if (pages > 1) this.drawText(`${this.page + 1} / ${pages} · 确定键翻页`, 0, size * height, width, 'right');
    }
    nextPage() {
      this.page = (this.page + 1) % Math.ceil(this.lines.length / this.pageSize());
      this.drawPage();
    }
  }

  class QuestJournal extends Scene_MenuBase {
    create() {
      super.create();
      const y = mz ? this.mainAreaTop() : 0;
      const height = Graphics.boxHeight - y, width = Math.floor(Graphics.boxWidth * 0.35);
      const list = new QuestList(0, y, width, height);
      const detail = new QuestDetail(width, y, Graphics.boxWidth - width, height);
      list.setDetail(detail);
      list.setHandler('cancel', this.popScene.bind(this));
      list.setHandler('ok', () => { detail.nextPage(); list.activate(); });
      this.addWindow(detail);
      this.addWindow(list);
      list.activate();
    }
  }

  const menuAdd = Window_MenuCommand.prototype.addOriginalCommands;
  Window_MenuCommand.prototype.addOriginalCommands = function() {
    menuAdd.apply(this, arguments);
    if (quests().length) this.addCommand('任务日志', plugin, true);
  };
  const createMenu = Scene_Menu.prototype.createCommandWindow;
  Scene_Menu.prototype.createCommandWindow = function() {
    createMenu.apply(this, arguments);
    this._commandWindow.setHandler(plugin, () => SceneManager.push(QuestJournal));
  };
})();
