/*:
 * @target MZ
 * @plugindesc rpgStudio 变量累计与布尔条件组（MV / MZ）
 * @help 在 rpgStudio 的变量列表中设置自动累计和变量组。
 */
(() => {
  'use strict';

  const configKey = 'rpgStudioVariableRules';
  const saveKey = '_rpgStudioVariableProgress';
  const compare = [
    (a, b) => a === b, (a, b) => a >= b, (a, b) => a <= b,
    (a, b) => a > b, (a, b) => a < b, (a, b) => a !== b,
  ];
  let loaded = null;
  let steps = [], times = [], byVariable = new Map(), groups = new Map();

  function refreshRules() {
    if (loaded === $dataSystem) return;
    loaded = $dataSystem;
    const config = loaded && loaded[configKey];
    steps = []; times = []; byVariable = new Map(); groups = new Map();
    if (!config) return;
    for (const [key, rule] of Object.entries(config.passive || {})) {
      const id = Number(key);
      if (!(id > 0 && id < loaded.variables.length && Number.isInteger(id))) continue;
      if (!rule || !Number.isSafeInteger(rule.amount) || rule.amount <= 0 || !['steps', 'time'].includes(rule.type)) continue;
      const interval = rule.every * (rule.type === 'time' ? 60 : 1);
      if (!Number.isSafeInteger(interval) || interval <= 0) continue;
      (rule.type === 'time' ? times : steps).push({ id, interval, amount: rule.amount, signature: rule.type + ':' + interval + ':' + rule.amount });
    }
    for (const [key, group] of Object.entries(config.groups || {})) {
      const id = Number(key);
      if (!(id > 0 && id < loaded.switches.length && Number.isInteger(id))) continue;
      if (!group || !Array.isArray(group.terms) || !group.terms.length || !['all', 'any'].includes(group.mode)) continue;
      groups.set(id, group);
      for (const vid of new Set(group.terms.map(term => term.id))) {
        if (!byVariable.has(vid)) byVariable.set(vid, []);
        byVariable.get(vid).push(id);
      }
    }
  }

  function groupResult(group) {
    const meets = term => {
      const value = $gameVariables.value(term.id);
      const test = compare[term.op];
      return !!test && term.id > 0 && term.id < loaded.variables.length && Number.isFinite(value) && test(value, term.value);
    };
    return group.mode === 'any' ? group.terms.some(meets) : group.terms.every(meets);
  }

  const setSwitch = Game_Switches.prototype.setValue;
  function updateResult(id) {
    const next = groupResult(groups.get(id));
    if ($gameSwitches.value(id) !== next) setSwitch.call($gameSwitches, id, next);
  }
  function updateResults() {
    refreshRules();
    for (const id of groups.keys()) updateResult(id);
  }

  Game_Switches.prototype.setValue = function(id, value) {
    if (this === $gameSwitches) {
      refreshRules();
      if (groups.has(Number(id))) return updateResult(Number(id));
    }
    return setSwitch.apply(this, arguments);
  };
  const setVariable = Game_Variables.prototype.setValue;
  Game_Variables.prototype.setValue = function(id) {
    const result = setVariable.apply(this, arguments);
    if (this === $gameVariables && $gameSwitches) {
      refreshRules();
      const affected = byVariable.get(Number(id));
      if (affected) for (const sid of affected) updateResult(sid);
    }
    return result;
  };

  for (const method of ['createGameObjects', 'extractSaveContents']) {
    const previous = DataManager[method];
    DataManager[method] = function() {
      const result = previous.apply(this, arguments);
      updateResults();
      return result;
    };
  }

  function advance(rules) {
    if (!rules.length || !$gameSystem || !$gameVariables) return;
    const progress = $gameSystem[saveKey] || ($gameSystem[saveKey] = {});
    for (const rule of rules) {
      let state = progress[rule.id];
      if (!state || state.signature !== rule.signature) state = progress[rule.id] = { signature: rule.signature, count: 0 };
      if (++state.count < rule.interval) continue;
      state.count = 0;
      const value = $gameVariables.value(rule.id);
      if (Number.isSafeInteger(value) && Number.isSafeInteger(value + rule.amount)) $gameVariables.setValue(rule.id, value + rule.amount);
    }
  }

  const increaseSteps = Game_Party.prototype.increaseSteps;
  Game_Party.prototype.increaseSteps = function() {
    const previous = this.steps();
    const result = increaseSteps.apply(this, arguments);
    if (this === $gameParty && this.steps() > previous) { refreshRules(); advance(steps); }
    return result;
  };

  for (const Scene of [Scene_Map, Scene_Battle]) {
    const previous = Scene.prototype.update;
    Scene.prototype.update = function() {
      const counting = this.isActive() && !SceneManager.isSceneChanging() && (typeof document === 'undefined' || !document.hidden);
      const result = previous.apply(this, arguments);
      if (counting) { refreshRules(); advance(times); }
      return result;
    };
  }
})();
