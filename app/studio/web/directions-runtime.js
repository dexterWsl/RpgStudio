/*:
 * @plugindesc rpgStudio 斜向站姿
 * @help 斜向站姿图沿用原行走图的排版，四行依次是左下、右下、左上、右上。
 */
(function () {
  'use strict';
  var rows = { 1: 0, 3: 1, 7: 2, 9: 3 };
  var updateBitmap = Sprite_Character.prototype.updateBitmap;
  Sprite_Character.prototype.updateBitmap = function () {
    var character = this._character, sheet = character && character.characterName();
    var mapping = $dataSystem && $dataSystem.rpgStudioDiagonalSheets;
    var pose = mapping && Object.prototype.hasOwnProperty.call(mapping, sheet) && mapping[sheet];
    var diagonal = pose && !character.isMoving() && rows[character._rsDiagonal] != null;
    if (this._rsDiagonalFrame && diagonal && this._rsPose === pose && !this.isImageChanged()) return;
    if (this._rsDiagonalFrame) this.bitmap = this._rsCardinalBitmap;
    this._rsDiagonalFrame = false;
    updateBitmap.call(this);
    if (!diagonal || this._tileId > 0 || !this.bitmap) return;
    var bitmap = ImageManager.loadCharacter(pose);
    if (bitmap.isReady() && bitmap.width === this.bitmap.width && bitmap.height === this.bitmap.height) {
      this._rsCardinalBitmap = this.bitmap;
      this._rsPose = pose;
      this._rsDiagonalFrame = true;
      this.bitmap = bitmap;
    }
  };
  var patternX = Sprite_Character.prototype.characterPatternX;
  var patternY = Sprite_Character.prototype.characterPatternY;
  Sprite_Character.prototype.characterPatternX = function () { return this._rsDiagonalFrame ? 1 : patternX.call(this); };
  Sprite_Character.prototype.characterPatternY = function () { return this._rsDiagonalFrame ? rows[this._character._rsDiagonal] : patternY.call(this); };
})();
