/*:
 * @target MV MZ
 * @plugindesc rpgStudio 事件页追加条件
 * @help 在原生事件页条件通过后，检查工作台添加的其余条件。
 */
(function() {
  'use strict';

  function meetsTerm(event, term) {
    switch (term.kind) {
      case 'switch': return $gameSwitches.value(term.id);
      case 'var': return !($gameVariables.value(term.id) < term.value);
      case 'selfSwitch': return $gameSelfSwitches.value([event._mapId, event._eventId, term.channel]) === true;
      case 'item': return $gameParty.hasItem($dataItems[term.id]);
      case 'actor': return $gameParty.members().indexOf($gameActors.actor(term.id)) >= 0;
      default: return false;
    }
  }

  var meetsConditions = Game_Event.prototype.meetsConditions;
  Game_Event.prototype.meetsConditions = function(page) {
    if (!meetsConditions.apply(this, arguments)) return false;
    var extra = page.conditions.rpgStudioExtraConditions;
    if (!Array.isArray(extra)) return true;
    for (var i = 0; i < extra.length; i++) {
      if (!extra[i] || !meetsTerm(this, extra[i])) return false;
    }
    return true;
  };
})();
