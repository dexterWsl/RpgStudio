/*:
 * @target MZ
 * @plugindesc rpgStudio 分层立绘
 * @help 在 rpgStudio 的「人物 → 立绘」中制作，使用 #立绘 在剧情里显示。
 */
(function () {
  'use strict';
  var key = 'rpgStudioLayeredPortraits';
  var slots = {
    hairBack: '后发', armL: '左臂和手', legs: '腿部', body: '身体', clothes: '上衣', head: '头',
    eyes: '眉眼', mouth: '嘴', hairFront: '前发', armR: '右臂和手', hands: '手部', weapon: '武器',
  };
  for (var extra = 1; extra <= 10; extra++) slots['extra' + extra] = '附加图层' + extra;
  var actions = { still: '自然', idle: '呼吸', wave: '挥手', walk: '行走', attack: '攻击', hit: '受击' };
  var hudActions = { idle: 'idle', walk: 'walk', attack: 'attack', hit: 'hit' };
  var faceDefault = '默认';
  var partSub = 'rpgStudioPortraitParts';
  function emptyLayer() {
    return { file: '', x: 0, y: 0, scale: 100, scaleY: null, opacity: 255, z: null, flipX: false, flipY: false, pivotX: 50, pivotY: 12 };
  }
  var variantSlots = Object.assign({ 左手: 'armL', 右手: 'armR', 衣服: 'clothes' }, Object.keys(slots).reduce(function (map, slot) { map[slots[slot]] = slot; return map; }, {}));
  var builtInLabels = Object.keys(actions).reduce(function (map, action) { map[actions[action]] = action; return map; }, {});
  var has = function (obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); };

  function parseEdit(line) {
    var m = /^[#＃]\s*(\S+)\s+([^\s]+)$/.exec(line.trim());
    if (!m) return null;
    if (m[1] === '表情') return ['face', m[2]];
    if (has(variantSlots, m[1])) return ['part', variantSlots[m[1]], m[2]];
    if (m[1] === '等待' && /^(?:\d+|\d*\.\d+)(?:秒)?$/.test(m[2])) return ['wait', Number(m[2].replace(/秒$/, ''))];
    return null;
  }

  function applyEdit(selection, op) {
    if (op[0] === 'face') {
      selection.face = op[1];
      delete selection.parts.eyes;
      delete selection.parts.mouth;
    }
    else if (op[0] === 'part') selection.parts[op[1]] = op[2];
  }

  function programOf(layout, action) {
    var label = actions[action] || action;
    return has(layout.programs, label) ? layout.programs[label] : null;
  }

  function stateLook(layout, state, selection, face, action, elapsed) {
    var normal = has(layout.states, '正常') ? layout.states['正常'] : null;
    var baseState = state !== '正常' && has(layout.states, state) ? layout.states[state] : null;
    var changes = { parts: Object.assign({}, normal && normal.parts), face: normal && normal.face || faceDefault };
    if (baseState && baseState.face) applyEdit(changes, ['face', baseState.face]);
    Object.assign(changes.parts, baseState && baseState.parts);
    if (selection && selection.face || face && face !== faceDefault) applyEdit(changes, ['face', selection && selection.face || face]);
    Object.assign(changes.parts, selection && selection.parts);
    var program = programOf(layout, action);
    if (program && elapsed < program.frames) {
      var frame = 0;
      for (var i = 0; i < program.ops.length && frame <= elapsed; i++) {
        var op = program.ops[i];
        if (op[0] === 'wait') frame += op[1];
        else applyEdit(changes, op);
      }
    }
    var layers = Object.assign({}, layout.layers);
    var eyes = {};
    Object.keys(changes.parts).forEach(function (slot) {
      var name = changes.parts[slot], variants = layout.variants && layout.variants[slot];
      if (name === '无') layers[slot] = Object.assign({}, layers[slot], { file: '' });
      else if (has(variants, name)) layers[slot] = variants[name];
      if (name && name !== faceDefault && (slot === 'eyes' || slot === 'mouth')) eyes[slot] = true;
    });
    return { layout: { width: layout.width, height: layout.height, layers: layers, faces: layout.faces, faceOverrides: eyes,
      partKey: JSON.stringify(changes.parts) }, face: changes.face };
  }

  function pictureName(actor, who, face, action, screen) {
    var segments = ['rpgstudio-layered-view', actor, encodeURIComponent(who), encodeURIComponent(face), encodeURIComponent(action || 'still')];
    if (screen) segments.push(screen);
    return segments.join('/');
  }

  function readPicture(name) {
    var parts = /^rpgstudio-layered-view\/([1-9]\d*)\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(left|center|right))?$/.exec(name);
    if (!parts) return null;
    try { return { actor: Number(parts[1]), who: decodeURIComponent(parts[2]), face: decodeURIComponent(parts[3]), action: decodeURIComponent(parts[4]), screen: parts[5] }; }
    catch (_) { return null; }
  }

  function defaultRegion(side) {
    return { enabled: false, x: { left: 2, center: 29, right: 56 }[side] || 56, y: 8, width: 42, height: 92 };
  }

  function stagePose(layout, side, width, height) {
    var region = layout.region && layout.region.enabled ? layout.region : defaultRegion(side);
    var w = width * region.width / 100, h = height * region.height / 100;
    return { x: width * region.x / 100 + w / 2, y: height * region.y / 100 + h,
      scale: Math.min(w / layout.width, h / layout.height) };
  }

  function fileFor(layout, slot, face) {
    var expression = Object.prototype.hasOwnProperty.call(layout.faces, face) && layout.faces[face];
    return expression && !(layout.faceOverrides && layout.faceOverrides[slot]) && expression[slot] || (layout.layers[slot] && layout.layers[slot].file) || '';
  }

  function pose(action, frame) {
    var t = Math.max(0, frame), wave = Math.sin(t / 8), stride = Math.sin(t / 5);
    if (action === 'idle') return [0, wave * 0.008, 0, 0];
    if (action === 'walk') return [stride * 0.013, -Math.abs(stride) * 0.024, stride * 0.25, -stride * 0.25];
    if (action === 'wave' && t < 75) {
      var lift = Math.min(t / 12, (75 - t) / 12, 1);
      return [0, 0, 0, lift * (-2.1 + 0.22 * Math.sin(t / 3))];
    }
    if (action === 'attack' && t < 38) {
      var reach = t < 13 ? -0.6 * Math.sin(t / 13 * Math.PI / 2) : (t < 20 ? -0.6 + (t - 13) * 0.32 : 1.64 * (38 - t) / 18);
      return [reach * 0.045, -Math.abs(reach) * 0.015, -reach * 0.22, reach];
    }
    if (action === 'hit' && t < 28) {
      var jolt = Math.sin(t / 2.1) * (28 - t) / 28;
      return [jolt * 0.04, -Math.abs(jolt) * 0.03, -jolt * 0.3, jolt * 0.3];
    }
    return [0, 0, 0, 0];
  }

  function pivot(layer, image) {
    var px = layer.flipX ? 100 - layer.pivotX : layer.pivotX, py = layer.flipY ? 100 - layer.pivotY : layer.pivotY;
    return [layer.x + image.naturalWidth * layer.scale * px / 10000,
      layer.y + image.naturalHeight * (layer.scaleY || layer.scale) * py / 10000];
  }

  // 画布坐标是素材最终对齐的位置。缩放和关节均以每张原图为基准。
  function paint(ctx, layout, face, action, frame, getImage, width, height) {
    var motion = pose(action, frame);
    var hand = layout.layers.armR, handFile = fileFor(layout, 'armR', face), handImage = handFile && getImage(handFile);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(width / layout.width, height / layout.height);
    ctx.translate(motion[0] * layout.width, motion[1] * layout.height);
    var order = Object.keys(slots).map(function (slot, index) { return { slot: slot, z: layout.layers[slot] && layout.layers[slot].z || index + 1 }; });
    order.sort(function (a, b) { return a.z - b.z; }).forEach(function (row) {
      var slot = row.slot;
      var layer = layout.layers[slot], file = fileFor(layout, slot, face);
      if (!layer || !file) return;
      var image = getImage(file);
      if (!image) return;
      var angle = slot === 'armL' ? motion[2] : slot === 'armR' || slot === 'weapon' && handImage ? motion[3] : 0;
      ctx.save();
      if (angle) {
        var anchor = slot === 'weapon' ? pivot(hand, handImage) : pivot(layer, image);
        ctx.translate(anchor[0], anchor[1]);
        ctx.rotate(angle);
        ctx.translate(-anchor[0], -anchor[1]);
      }
      var w = image.naturalWidth * layer.scale / 100, h = image.naturalHeight * (layer.scaleY || layer.scale) / 100;
      ctx.globalAlpha = layer.opacity == null ? 1 : layer.opacity / 255;
      ctx.translate(layer.x + (layer.flipX ? w : 0), layer.y + (layer.flipY ? h : 0));
      ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      ctx.drawImage(image, 0, 0, w, h);
      ctx.restore();
    });
    ctx.restore();
  }

  function images(url) {
    var cache = new Map();
    var revision = 0;
    function getEntry(file) {
      if (!cache.has(file)) {
        if (cache.size >= 160) cache.delete(cache.keys().next().value);
        var entry = { image: new Image(), done: false, loaded: false };
        entry.image.onload = function () { entry.done = entry.loaded = true; revision++; };
        entry.image.onerror = function () { entry.done = true; revision++; };
        entry.image.src = url(file);
        cache.set(file, entry);
      }
      return cache.get(file);
    }
    return {
      get: function (file) {
        var item = getEntry(file);
        return item.loaded ? item.image : null;
      },
      ready: function (layout, face) {
        var complete = true;
        Object.keys(slots).forEach(function (slot) {
          var file = fileFor(layout, slot, face);
          if (file && !getEntry(file).done) complete = false;
        });
        return complete;
      },
      revision: function () { return revision; },
    };
  }

  function mount(canvas, read, url) {
    var assets = images(url), begin = performance.now(), last = -1, revision = -1, previous;
    var ctx = canvas.getContext('2d');
    function tick(now) {
      if (!canvas.isConnected) return;
      var value = read();
      if (value !== previous) { begin = now; previous = value; last = -1; }
      if (value) {
        var elapsed = Math.floor((now - begin) * 0.06);
        var look = stateLook(value.layout, value.state || '正常', value.selection, value.face, value.action, elapsed);
        if (!assets.ready(look.layout, look.face)) begin = now;
        else {
          var frame = actionFrame(value.layout, value.action, elapsed);
          if (frame !== last || assets.revision() !== revision) {
            paint(ctx, look.layout, look.face, value.action, frame, assets.get, canvas.width, canvas.height);
            revision = assets.revision();
            last = frame;
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var api = { key: key, slots: slots, actions: actions, builtInLabels: builtInLabels, faceDefault: faceDefault, partSub: partSub, emptyLayer: emptyLayer,
    defaultRegion: defaultRegion, stagePose: stagePose,
    pictureName: pictureName, readPicture: readPicture, fileFor: fileFor, parseEdit: parseEdit, applyEdit: applyEdit, selectCue: selectCue, stateLook: stateLook, programOf: programOf, mount: mount };
  if (typeof module === 'object' && module.exports && typeof Sprite_Picture === 'undefined') module.exports = api;
  if (typeof window === 'undefined') return;
  window.RpgStudioLayered = api;
  if (typeof Sprite_Picture === 'undefined') return;

  var assets = images(function (file) { return 'img/' + partSub + '/' + encodeURIComponent(file) + '.png'; });
  function layoutOf(actor) { return $dataSystem && $dataSystem[key] && $dataSystem[key][actor]; }

  function actionFrame(layout, action, elapsed) {
    var limit = { idle: Infinity, walk: Infinity, wave: 76, attack: 38, hit: 28 }[action] || 0;
    var program = programOf(layout, action);
    if (program) limit = Math.max(limit === Infinity ? 0 : limit, program.frames + 2);
    return Math.floor(Math.min(elapsed, limit) / 2) * 2;
  }

  function condition(p) {
    if (p[0] === 0) return $gameSwitches.value(p[1]) === (p[2] === 0);
    var value = $gameVariables.value(p[1]), expected = p[3];
    switch (p[4]) {
      case 0: return value === expected;
      case 1: return value >= expected;
      case 2: return value <= expected;
      case 3: return value > expected;
      case 4: return value < expected;
      case 5: return value !== expected;
    }
    return false;
  }

  function automatic(layout) {
    var states = layout.states || {};
    return Object.keys(states).find(function (name) {
      var groups = states[name].groups;
      return groups && groups.some(function (group) { return group.length && group.every(condition); });
    }) || '正常';
  }

  function createSurface(layout) {
    var ratio = Math.min(1, 960 / Math.max(layout.width, layout.height));
    var bitmap = new Bitmap(Math.max(1, Math.round(layout.width * ratio)), Math.max(1, Math.round(layout.height * ratio)));
    var last = '', rendered = false;
    return {
      bitmap: bitmap,
      ready: function (face, view) {
        if (!face) return rendered;
        return assets.ready(view || layout, face);
      },
      draw: function (face, action, elapsed, view) {
        var frame = actionFrame(layout, action, elapsed), look = view || layout;
        var stamp = [face, action, frame, assets.revision(), look.partKey].join('\t');
        if (stamp === last) return;
        last = stamp;
        paint(bitmap.context, look, face, action, frame, assets.get, bitmap.width, bitmap.height);
        if (bitmap._setDirty) bitmap._setDirty();
        else bitmap.baseTexture.update();
        rendered = true;
      },
      destroy: function () {
        if (bitmap.destroy) bitmap.destroy();
        else if (bitmap.baseTexture) bitmap.baseTexture.destroy();
      },
    };
  }
  api.layoutOf = layoutOf;
  api.createSurface = createSurface;
  api.hudActions = hudActions;
  api.automatic = automatic;

  function selectCue(selection, op, frame) {
    if (op[0] === 'state') {
      selection.state = op[1] === '自动' ? '' : op[1];
      selection.face = '';
      selection.parts = {};
      selection.action = 'still';
      selection.start = frame;
    } else if (op[0] === 'action') {
      selection.action = has(builtInLabels, op[1]) ? builtInLabels[op[1]] : op[1];
      selection.start = frame;
    } else applyEdit(selection, op);
    return selection;
  }
  var command231 = Game_Interpreter.prototype.command231;
  Game_Interpreter.prototype.command231 = function (params) {
    var args = params || this._params;
    var result = command231.apply(this, arguments);
    if (args && readPicture(args[1])) {
      var picture = $gameScreen.picture(args[0]);
      this._rsLayeredTarget = { id: args[0], serial: picture._rsLayeredSerial };
    }
    return result;
  };
  var setupChild = Game_Interpreter.prototype.setupChild;
  Game_Interpreter.prototype.setupChild = function () {
    setupChild.apply(this, arguments);
    if (this._childInterpreter && this._rsLayeredTarget) this._childInterpreter._rsLayeredTarget = this._rsLayeredTarget;
  };
  var clearInterpreter = Game_Interpreter.prototype.clear;
  Game_Interpreter.prototype.clear = function () {
    clearInterpreter.apply(this, arguments);
    this._rsLayeredTarget = null;
  };
  api.cue = function (interpreter, op) {
    var target = interpreter._rsLayeredTarget;
    var picture = target && $gameScreen.picture(target.id);
    if (!picture || picture._rsLayeredSerial !== target.serial) return;
    var tag = readPicture(picture.name());
    var layout = tag && layoutOf(tag.actor);
    if (!layout) return;
    if (op[0] === 'state' && op[1] !== '自动' && op[1] !== '正常' && !has(layout.states, op[1])) return;
    if (op[0] === 'part' && op[2] !== '默认' && op[2] !== '无' && !has(layout.variants && layout.variants[op[1]], op[2])) return;
    if (op[0] === 'face' && op[1] !== faceDefault && !has(layout.faces, op[1])) return;
    if (op[0] === 'action' && !has(builtInLabels, op[1]) && !programOf(layout, op[1])) return;
    var selection = picture._rsLayeredSelection || { parts: {} };
    picture._rsLayeredSelection = selectCue(selection, op, Graphics.frameCount);
  };

  // 公共事件会预读「显示图片」的资源。分层立绘预读各部位，虚拟名称不对应整张 PNG。
  ['loadPicture', 'requestPicture', 'reservePicture'].forEach(function (method) {
    var read = ImageManager[method];
    if (!read) return;
    ImageManager[method] = function (name) {
      var tag = readPicture(name);
      if (!tag) return read.apply(this, arguments);
      var layout = layoutOf(tag.actor);
      if (layout) assets.ready(layout, tag.face);
      return read.call(this, '');
    };
  });

  function clearSurface(sprite) {
    var surface = sprite._rsLayered;
    if (!surface) return;
    if (sprite.bitmap === surface.bitmap) sprite.bitmap = null;
    surface.destroy();
    sprite._rsLayered = null;
    sprite._rsLayeredPicture = null;
    sprite._rsStagePose = null;
  }

  var pictureShown = Game_Picture.prototype.show;
  Game_Picture.prototype.show = function (name) {
    pictureShown.apply(this, arguments);
    if (readPicture(name)) {
      this._rsLayeredStart = Graphics.frameCount;
      this._rsLayeredSelection = null;
      $gameScreen._rsLayeredSerial = ($gameScreen._rsLayeredSerial || 0) + 1;
      this._rsLayeredSerial = $gameScreen._rsLayeredSerial;
    }
  };
  var loadBitmap = Sprite_Picture.prototype.loadBitmap;
  Sprite_Picture.prototype.loadBitmap = function () {
    clearSurface(this);
    var tag = readPicture(this._pictureName);
    if (!tag) { loadBitmap.apply(this, arguments); return; }
    var layout = layoutOf(tag.actor);
    if (!layout) { this.bitmap = null; return; }
    this._rsLayered = createSurface(layout);
    this._rsLayeredTag = tag;
    this.bitmap = this._rsLayered.bitmap;
  };
  var updateBitmap = Sprite_Picture.prototype.updateBitmap;
  Sprite_Picture.prototype.updateBitmap = function () {
    updateBitmap.apply(this, arguments);
    if (!this._rsLayered) return;
    var picture = this.picture();
    if (!picture) { clearSurface(this); return; }
    var tag = this._rsLayeredTag;
    // 读档时引擎帧编号可能比存档记录的小，从首帧重新播对应动作。
    if (this._rsLayeredPicture !== picture) {
      this._rsLayeredPicture = picture;
      this._rsLayeredStart = Math.min(Graphics.frameCount, picture._rsLayeredStart || Graphics.frameCount);
      this._rsLayeredFrame = Graphics.frameCount;
      if (picture._rsLayeredSelection && picture._rsLayeredSelection.action) {
        picture._rsLayeredSelection.start = Math.min(Graphics.frameCount, picture._rsLayeredSelection.start);
      }
    }
    var layout = layoutOf(tag.actor), selection = picture._rsLayeredSelection;
    var action = selection && selection.action || tag.action;
    var start = selection && selection.action ? selection.start : this._rsLayeredStart;
    var elapsed = Math.max(0, Graphics.frameCount - start);
    var advance = Math.min(elapsed, Graphics.frameCount - this._rsLayeredFrame);
    this._rsLayeredFrame = Graphics.frameCount;
    var look = stateLook(layout, selection && selection.state || automatic(layout), selection, tag.face, action, elapsed);
    if (!this._rsLayered.ready(look.face, look.layout)) {
      if (selection && selection.action) selection.start += advance;
      else this._rsLayeredStart += advance;
      return;
    }
    this._rsLayered.draw(look.face, action, elapsed, look.layout);
  };
  var updateOrigin = Sprite_Picture.prototype.updateOrigin;
  Sprite_Picture.prototype.updateOrigin = function () {
    updateOrigin.apply(this, arguments);
    if (this._rsLayered && this.picture().origin() === 1) this.anchor.y = 1;
  };
  var updateScale = Sprite_Picture.prototype.updateScale;
  Sprite_Picture.prototype.updateScale = function () {
    updateScale.apply(this, arguments);
    if (this._rsLayered) {
      var layout = layoutOf(this._rsLayeredTag.actor);
      var fit = this._rsStagePose;
      this.scale.x = (fit ? fit.scale : this.scale.x) * layout.width / this.bitmap.width;
      this.scale.y = (fit ? fit.scale : this.scale.y) * layout.height / this.bitmap.height;
    }
  };
  var updatePosition = Sprite_Picture.prototype.updatePosition;
  Sprite_Picture.prototype.updatePosition = function () {
    updatePosition.apply(this, arguments);
    if (!this._rsLayered || !this._rsLayeredTag.screen) return;
    var pose = stagePose(layoutOf(this._rsLayeredTag.actor), this._rsLayeredTag.screen, Graphics.width, Graphics.height);
    this.x = pose.x;
    this.y = pose.y;
    this._rsStagePose = pose;
  };
  var destroy = Sprite_Picture.prototype.destroy;
  Sprite_Picture.prototype.destroy = function () {
    clearSurface(this);
    destroy.apply(this, arguments);
  };
})();
