/*:
 * @target MZ
 * @plugindesc rpgStudio 动态立绘
 * @help 可使用工具制作的分层立绘、工程已有的 PictureLive2D 模型，或 movies 下的 WebM / MP4。
 * 画中画范围和淡入淡出时间在 rpgStudio 的插件市场中设置。
 *
 * @command motion
 * @text 播放立绘状态
 * @arg state
 * @text 状态
 * @type select
 * @option 待机
 * @value idle
 * @option 行走
 * @value walk
 * @option 攻击
 * @value attack
 * @option 受击
 * @value hit
 * @default attack
 * @arg frames
 * @text 持续帧数
 * @type number
 * @min 1
 * @max 600
 * @default 42
 *
 * @command show
 * @text 淡入动态立绘
 *
 * @command hide
 * @text 淡出动态立绘
 */
(function () {
  'use strict';
  var name = 'RpgStudio_AnimatedPortrait';
  var context, actor, hp, hitUntil = 0, walkUntil = 0, swing = null;
  var video, videoFrame, videoPath, videoSignal;
  var layer, liveContent, liveMask, liveBounds, liveSprite, liveFit, model, liveSignal;
  var parts, partsLayout, partsSprite, partsSignal, partsState, partsStart, partsFrame;
  var opacity = 0, previousFrame, displayMotion;

  function settings() { return $dataSystem && $dataSystem.rpgStudioAnimatedPortrait; }
  function leader() { return $gameParty && $gameParty.leader(); }
  function request(state, frames) {
    if (!$gameTemp || ['idle', 'walk', 'attack', 'hit'].indexOf(state) < 0) return;
    var n = Math.max(1, Math.min(600, Math.floor(Number(frames) || 42)));
    $gameTemp._rsPortraitMotion = { state: state, until: Graphics.frameCount + n };
  }
  function setVisible(visible) { if ($gameSystem) $gameSystem._rsPortraitHidden = !visible; }
  if (PluginManager.registerCommand) {
    PluginManager.registerCommand(name, 'motion', function (a) { request(a.state, a.frames); });
    PluginManager.registerCommand(name, 'show', function () { setVisible(true); });
    PluginManager.registerCommand(name, 'hide', function () { setVisible(false); });
  }
  var pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function (command, args) {
    pluginCommand.apply(this, arguments);
    if (command !== name) return;
    if (args[0] === 'motion') request(args[1] || 'attack', args[2]);
    if (args[0] === 'show' || args[0] === 'hide') setVisible(args[0] === 'show');
  };

  function battleAttack(lead) {
    var action = BattleManager._action;
    if (BattleManager._phase !== 'action' || BattleManager._subject !== lead || !action) return null;
    var item = action.item();
    return action.isAttack() || action.isSkill() && item && item.damage && [1, 2, 5, 6].indexOf(item.damage.type) >= 0 ? action : null;
  }

  function stateOf(scene, lead) {
    var frame = Graphics.frameCount;
    if (actor !== lead) { actor = lead; hp = lead.hp; hitUntil = 0; walkUntil = 0; }
    if (lead.hp < hp) hitUntil = frame + 36;
    hp = lead.hp;
    if (frame < hitUntil) return { state: 'hit', until: hitUntil };
    var motion = $gameTemp && $gameTemp._rsPortraitMotion;
    if (motion && frame < motion.until) return motion;
    if (scene instanceof Scene_Battle) {
      var action = battleAttack(lead);
      if (action) {
        if (!swing || swing.action !== action) swing = { state: 'attack', action: action };
        return swing;
      }
      swing = null;
    } else {
      if ($gamePlayer.isMoving()) walkUntil = frame + 3;
      if (frame < walkUntil) return { state: 'walk' };
    }
    return { state: 'idle' };
  }

  function chosen(source, motion) {
    var state = source[motion.state] ? motion.state : 'idle';
    return { state: state, asset: source[state], signal: state === 'idle' || state === 'walk' ? state : (motion.action || motion.until || state),
      loop: state === 'idle' || state === 'walk' };
  }

  function screenRegion(config, width, height) {
    var region = config.region;
    return region && region.enabled ? { x: width * region.x / 100, y: height * region.y / 100,
      width: width * region.width / 100, height: height * region.height / 100 } : null;
  }

  function closeVideo() {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    videoFrame.remove();
    video = null;
    videoFrame = null;
    videoPath = null;
    videoSignal = null;
  }
  function showVideo(config, motion) {
    var current = chosen(config.media, motion);
    var canvas = Graphics._canvas;
    if (!current.asset || !canvas) return;
    if (!video) {
      videoFrame = document.createElement('div');
      videoFrame.id = 'rpgstudio-animated-portrait-frame';
      videoFrame.style.cssText = 'position:fixed;z-index:2;overflow:hidden;pointer-events:none;opacity:0;';
      video = document.createElement('video');
      video.id = 'rpgstudio-animated-portrait';
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'display:block;pointer-events:none;';
      videoFrame.appendChild(video);
      document.body.appendChild(videoFrame);
    }
    var rect = canvas.getBoundingClientRect(), region = screenRegion(config, rect.width, rect.height), gap = 12;
    var style = videoFrame.style;
    style.left = region ? rect.left + region.x + 'px' : '';
    style.right = region ? '' : Math.round(window.innerWidth - rect.right + gap) + 'px';
    style.top = region ? rect.top + region.y + 'px' : config.position === 'top' ? Math.round(rect.top + gap) + 'px' : '';
    style.bottom = !region && config.position === 'bottom' ? Math.round(window.innerHeight - rect.bottom + gap) + 'px' : '';
    style.width = (region ? region.width : Math.round(rect.width * config.width / 100)) + 'px';
    style.height = region ? region.height + 'px' : '';
    video.style.width = '100%';
    video.style.height = region ? '100%' : '';
    video.style.maxHeight = region ? '' : Math.round(rect.height * 0.6) + 'px';
    video.style.objectFit = region ? 'cover' : 'contain';
    video.style.objectPosition = region ? 'center bottom' : 'right bottom';
    video.loop = current.loop;
    if (current.asset !== videoPath || current.signal !== videoSignal) {
      video.hidden = false;
      if (current.asset !== videoPath) video.src = 'movies/' + current.asset.split('/').map(encodeURIComponent).join('/');
      else video.currentTime = 0;
      videoPath = current.asset;
      videoSignal = current.signal;
      var element = video, pending = video.play();
      if (pending && pending.catch) pending.catch(function (error) { if (element === video && error.name !== 'AbortError') element.hidden = true; });
    }
  }

  function closeLayer() {
    if (!layer) return;
    if (layer.parent) layer.parent.removeChild(layer);
    if (!layer.destroyed && !layer._destroyed) {
      if (liveMask) liveContent.mask = null;
      if (partsSprite) partsSprite.bitmap = null;
      layer.destroy({ children: true, texture: false, baseTexture: false });
    }
    if (parts) parts.destroy();
    parts = null;
    partsLayout = null;
    partsSprite = null;
    partsSignal = null;
    partsState = null;
    partsFrame = undefined;
    layer = null;
    liveContent = null;
    liveMask = null;
    liveBounds = null;
    liveSprite = null;
    liveFit = null;
    model = null;
    liveSignal = null;
  }
  function makeLayer(scene, region) {
    layer = new Sprite();
    liveContent = layer;
    if (region) {
      liveContent = new Sprite();
      liveMask = new PIXI.Graphics();
      layer.addChild(liveContent);
      layer.addChild(liveMask);
      liveContent.mask = liveMask;
    }
    scene.addChildAt(layer, scene._windowLayer ? scene.getChildIndex(scene._windowLayer) : scene.children.length);
  }
  function resizeMask(region) {
    var bounds = [region.x, region.y, region.width, region.height].join(',');
    if (bounds !== liveBounds) {
      liveMask.clear().beginFill(0xffffff).drawRect(region.x, region.y, region.width, region.height).endFill();
      liveBounds = bounds;
    }
  }
  function showLive(scene, config, motion) {
    if (!window.Game_Live2D || !window.Sprite_Live2D) return;
    var current = chosen(config.motions, motion);
    if (!current.asset) return;
    var region = screenRegion(config, Graphics.width, Graphics.height);
    if (!layer) {
      model = new window.Game_Live2D();
      model.setModel(config.model);
      makeLayer(scene, region);
      liveSprite = new window.Sprite_Live2D(model);
      liveContent.addChild(liveSprite);
    }
    var scale = config.scale / 100;
    if (region) {
      resizeMask(region);
      // Live2D 模型使用各自的画布原点和像素尺寸。只在加载时测量一次，避免随着动作缩放或跳动。
      if (!liveFit && liveSprite.children.length) {
        var box = liveSprite.getLocalBounds();
        if (box.width > 0 && box.height > 0) liveFit = { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
      }
      if (liveFit) scale *= Math.min(region.width / liveFit.width, region.height / liveFit.height);
      liveContent.x = region.x + region.width / 2 - (liveFit ? liveFit.x * scale : 0);
      liveContent.y = region.y + region.height / 2 - (liveFit ? liveFit.y * scale : 0);
    } else {
      liveContent.x = Math.round(Graphics.width * 0.82);
      liveContent.y = Math.round(Graphics.height * (config.position === 'top' ? 0.36 : 0.77));
    }
    liveContent.scale.set(scale);
    if (current.signal !== liveSignal) {
      model.setAnimation(0, current.asset, current.loop ? 'continue' : 'none', true);
      liveSignal = current.signal;
    }
  }

  function showParts(scene, config, motion, lead) {
    var engine = window.RpgStudioLayered;
    if (!engine) return;
    var layout = engine.layoutOf(config.layeredActor || lead.actorId());
    if (partsLayout !== layout) closeLayer();
    if (!layout) return;
    var rect = screenRegion(config, Graphics.width, Graphics.height), size;
    if (!layer) {
      makeLayer(scene, rect);
      parts = engine.createSurface(layout);
      partsLayout = layout;
      partsSprite = new Sprite(parts.bitmap);
      liveContent.addChild(partsSprite);
    }
    if (rect) {
      resizeMask(rect);
      size = rect;
    } else {
      var w = Graphics.width * config.width / 100, h = Graphics.height * 0.6;
      size = { x: Graphics.width - w - 12, y: config.position === 'top' ? 12 : Graphics.height - h - 12, width: w, height: h };
    }
    var scale = Math.min(size.width / parts.bitmap.width, size.height / parts.bitmap.height);
    partsSprite.scale.set(scale);
    partsSprite.x = size.x + (size.width - parts.bitmap.width * scale) / 2;
    partsSprite.y = config.position === 'top' && !rect ? size.y : size.y + size.height - parts.bitmap.height * scale;
    var state = motion.state, signal = motion.action || motion.until || state, frame = Graphics.frameCount;
    var delta = partsFrame === undefined ? 0 : frame - partsFrame;
    partsFrame = frame;
    var running = (partsState === 'attack' || partsState === 'hit') && engine.programOf(layout, partsState);
    if (running && (state === 'idle' || state === 'walk') && frame - partsStart < running.frames) {
      state = partsState;
      signal = partsSignal;
    }
    var face = config.layeredFaces && (config.layeredFaces[state] || config.layeredFaces.idle) || engine.faceDefault;
    if (signal !== partsSignal || state !== partsState) { partsStart = frame; partsSignal = signal; partsState = state; }
    var action = engine.hudActions[state], look = engine.stateLook(layout, engine.automatic(layout), null, face, action, frame - partsStart);
    if (parts.ready(look.face, look.layout)) parts.draw(look.face, action, frame - partsStart, look.layout);
    else partsStart = Math.min(frame, partsStart + delta);
  }

  var updateScene = SceneManager.updateScene;
  SceneManager.updateScene = function () {
    updateScene.apply(this, arguments);
    var scene = this._scene, config = settings(), lead = leader();
    var playingMovie = typeof Video !== 'undefined' && Video.isPlaying ? Video._element && Video.isPlaying() : Graphics.isVideoPlaying && Graphics.isVideoPlaying();
    var started = scene && (scene.isStarted ? scene.isStarted() : this.isCurrentSceneStarted());
    var active = config && config.enabled && lead && !playingMovie && started &&
      (scene instanceof Scene_Map || scene instanceof Scene_Battle);
    if (context !== scene || !active) {
      closeVideo();
      closeLayer();
      opacity = 0;
      previousFrame = undefined;
      actor = null;
      context = scene;
    }
    if (!active) return;
    var visible = !$gameSystem || !$gameSystem._rsPortraitHidden;
    var motion = stateOf(scene, lead);
    var frame = Graphics.frameCount, elapsed = previousFrame === undefined ? 1 : frame - previousFrame;
    previousFrame = frame;
    if (visible) displayMotion = motion;
    else if (!opacity) { closeVideo(); closeLayer(); return; }
    if (config.mode === 'live2d') showLive(scene, config, displayMotion);
    else if (config.mode === 'layered') showParts(scene, config, displayMotion, lead);
    else showVideo(config, displayMotion);

    var seconds = config.fade && config.fade[visible ? 'in' : 'out'];
    var ready = video ? video.readyState >= 2 : parts ? parts.ready() : liveSprite && liveSprite.children.length > 0;
    if (!seconds) opacity = visible ? 1 : 0;
    else if (!visible || opacity || ready) {
      var step = Math.max(0, elapsed) / (seconds * 60);
      opacity = Math.max(0, Math.min(1, opacity + (visible ? step : -step)));
    }
    if (videoFrame) videoFrame.style.opacity = String(opacity);
    if (layer) layer.alpha = opacity;
    if (!visible && !opacity) { closeVideo(); closeLayer(); }
  };
})();
