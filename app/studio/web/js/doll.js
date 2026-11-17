'use strict';
// 纸娃娃部位图共享同一格画布和坐标。通过关节驱动部位，鞋和装备跟随对应的腿、手。
const DOLL_DIRECTIONS = ['正面', '左侧', '右侧', '背面'];
const DOLL_SLOTS = [
  ['wings', '翅膀'], ['tail', '尾巴'], ['cape', '披风'], ['hairBack', '后发'],
  ['legL', '左腿'], ['legR', '右腿'], ['shoeL', '左鞋'], ['shoeR', '右鞋'],
  ['body', '躯干'], ['clothes', '衣服'], ['belt', '腰带'],
  ['armL', '左臂和手'], ['armR', '右臂和手'], ['shoulder', '肩饰'],
  ['offhand', '副手'], ['weapon', '武器'], ['head', '头型'], ['face', '面饰'],
  ['hairFront', '前发'], ['hat', '帽子'],
];
const DOLL_DEMO = new Set(['legL', 'legR', 'shoeL', 'shoeR', 'body', 'clothes', 'belt', 'armL', 'armR', 'weapon', 'head', 'hairFront']);
const DOLL_ACTIONS = [
  ['idle', '站立'], ['walk', '行走'], ['swing', '挥砍'], ['thrust', '突刺'], ['guard', '防御'], ['damage', '受击'],
];
// MV/MZ 的 18 种战斗动作，每个动作三个姿势。先排六行，再向右排下一组三列。
const DOLL_BATTLE = ['walk', 'idle', 'cast', 'guard', 'damage', 'evade', 'thrust', 'swing', 'missile',
  'cast', 'cast', 'cast', 'evade', 'victory', 'damage', 'damage', 'sleep', 'dead'];

function dollCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function dollMetrics(width, height) {
  const scale = Math.min(width / 48, height / 64);
  return { scale, x: Math.floor(width / 2), y: height - Math.max(1, Math.round(4 * scale)) };
}

function dollRig(direction) {
  const profile = direction === 1 || direction === 2;
  const facing = direction === 1 ? -1 : 1;
  const near = direction === 1 ? 'L' : 'R';
  const lateral = side => direction === 0 ? (side === 'L' ? 1 : -1) : (side === 'L' ? -1 : 1);
  const joints = {};
  for (const side of ['L', 'R']) {
    const armX = profile ? (side === near ? -facing * 4 : facing * 4) : lateral(side) * 10;
    const legX = profile ? (side === near ? -facing * 2 : facing * 2) : lateral(side) * 5;
    joints['arm' + side] = [armX, -34];
    joints['leg' + side] = [legX, -21];
  }
  return { direction, profile, facing, near, joints, headX: profile ? facing * 2 : 0 };
}

function dollLayerOrder(rig) {
  const keys = DOLL_SLOTS.map(([key]) => key);
  if (rig.profile) {
    const far = rig.near === 'L' ? 'R' : 'L';
    const farHeld = far === 'L' ? 'offhand' : 'weapon';
    const behind = ['arm' + far, farHeld, 'leg' + far, 'shoe' + far];
    return [...keys.slice(0, 4), ...behind, ...keys.slice(4).filter(key => !behind.includes(key))];
  }
  if (rig.direction === 3) return keys.filter(key => key !== 'hairBack' && key !== 'cape')
    .flatMap(key => key === 'clothes' ? [key, 'cape'] : key === 'hairFront' ? [key, 'hairBack'] : [key]);
  return keys;
}

function dollMovement(rig, action, frame, key) {
  const phase = [-1, 0, 1][frame], strike = [-0.28, 1, 0.4][frame];
  const part = { shoeL: 'legL', shoeR: 'legR', weapon: 'armR', offhand: 'armL' }[key] || key;
  const joint = rig.joints[part];
  if (!joint) return { x: 0, y: 0, angle: 0, sy: 1 };
  const left = part.endsWith('L'), arm = part.startsWith('arm');
  const lead = phase * (left === arm ? 1 : -1);
  let angle = 0, sy = 1;
  if (action === 'walk') {
    if (rig.profile) angle = -rig.facing * lead * (arm ? 0.23 : 0.29);
    else {
      angle = lead * (arm ? 0.13 : 0.07);
      sy = 1 - Math.max(0, lead) * (arm ? 0.08 : 0.18);
    }
  } else if (arm && action === 'swing') angle = -rig.facing * strike * (left ? 0.3 : 1.5);
  else if (arm && action === 'thrust') { angle = -rig.facing * (0.45 + strike * 0.85) * (left ? 0.3 : 1); sy = 1 + Math.max(0, strike) * 0.17; }
  else if (arm && (action === 'guard' || action === 'missile')) angle = -rig.facing * (left ? 0.9 : 1.12);
  else if (arm && (action === 'cast' || action === 'victory')) angle = (left ? -1 : 1) * (1.25 + phase * 0.13);
  return { x: joint[0], y: joint[1], angle, sy };
}

function drawDollDemo(g, key, rig) {
  const ink = '#3d2927', wood = '#d69b61', shade = '#ab7049', light = '#f3c087', cloth = '#37665d';
  const rect = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const piece = (x, y, w, h, fill) => { rect(x, y, w, h, ink); rect(x + 1, y + 1, w - 2, h - 2, fill); };
  const side = key.endsWith('L') ? 'L' : 'R';
  const before = rig.direction === 3, profile = rig.profile, faceX = rig.headX;
  const small = profile ? 2 : 0;
  if (key.startsWith('leg') || key.startsWith('shoe')) {
    const [x, y] = rig.joints['leg' + side];
    if (key.startsWith('leg')) { piece(x - 3, y, 6, 17, wood); rect(x - 2, y + 2, 2, 11, light); }
    else { piece(x - 4, -6, 8 + small, 6, '#604b3e'); rect(x - 3, -4, 5 + small, 1, '#9f7857'); }
  } else if (key.startsWith('arm') || key === 'weapon' || key === 'offhand') {
    const [x, y] = rig.joints['arm' + (key === 'offhand' ? 'L' : key === 'weapon' ? 'R' : side)];
    const far = profile && side !== rig.near;
    if (key.startsWith('arm')) { piece(x - 2, y, 5, 15, far ? shade : wood); rect(x - 1, y + 2, 3, 4, cloth); rect(x - 1, y + 10, 2, 3, light); }
    else if (key === 'weapon') {
      piece(x - 1, y + 13, 4, 15, '#c8d0c5'); rect(x, y + 17, 1, 9, '#edf1d6');
      piece(x - 3, y + 15, 8, 3, '#a57b48'); rect(x, y + 11, 2, 5, '#573b31');
    } else { piece(x - 4, y + 8, 8, 11, '#5c7680'); rect(x - 2, y + 10, 4, 6, '#8ba8a6'); }
  } else if (key === 'body') {
    piece(-8 + small, -37, 16 - small * 2, 20, shade);
    rect(-5 + small, -36, 10 - small * 2, 12, wood);
  } else if (key === 'clothes') {
    piece(-8 + small, -35, 16 - small * 2, 14, cloth);
    rect(-6 + small, -34, 4, 10, '#528579'); rect(-7 + small, -25, 14 - small * 2, 1, '#254843');
  } else if (key === 'belt') {
    piece(-8 + small, -24, 16 - small * 2, 4, '#83583c'); rect(-2, -23, 4, 2, '#f2c47b');
  } else if (key === 'head') {
    piece(faceX - 9, -54, 18, 16, wood); piece(faceX - 7, -39, 14, 3, shade);
    rect(faceX - 7, -51, 3, 9, light);
    if (!before) {
      if (profile) rect(faceX + rig.facing * 4, -46, 2, 3, ink);
      else { rect(-5, -46, 2, 3, ink); rect(3, -46, 2, 3, ink); }
      rect(faceX - 1, -42, 3, 1, '#915c42');
    }
  } else if (key === 'hairFront' || key === 'hairBack') {
    const x = faceX - 10, fill = '#85523e';
    if (key === 'hairFront') {
      piece(x, -55, 20, before ? 7 : 6, fill);
      rect(x + 2, -53, 11, 2, '#b77851');
      if (!before) rect(x + (rig.facing < 0 ? 15 : 2), -50, 3, 3, fill);
    } else {
      piece(x, -53, 20, 17, fill); rect(x + 2, -51, 3, 13, '#ac6e4b');
    }
  } else if (key === 'hat') {
    piece(faceX - 7, -59, 14, 8, '#64748d'); piece(faceX - 11, -53, 22, 3, '#a6a6df');
  } else if (key === 'cape') {
    piece(-11, -36, 22, 23, '#653c62'); rect(-8, -34, 3, 17, '#8c567e');
  } else if (key === 'wings') {
    piece(-19, -36, 12, 14, '#9dbcd0'); piece(7, -36, 12, 14, '#9dbcd0');
  } else if (key === 'tail') {
    piece(-3, -23, 6, 11, shade); piece(0, -18, 13, 5, wood);
  } else if (key === 'face' && !before) {
    rect(faceX - 7, -47, 14, 1, ink); piece(faceX - 6, -46, 5, 4, '#536d78'); piece(faceX + 2, -46, 5, 4, '#536d78');
  } else if (key === 'shoulder') {
    piece(-13 + small, -36, 7, 6, '#a3aab1'); piece(6 - small, -36, 7, 6, '#a3aab1');
  }
}

function drawDollFrame(g, width, height, parts, direction, action, frame, only) {
  const rig = dollRig(direction), target = dollMetrics(width, height);
  const lying = action === 'dead' || action === 'sleep';
  const lean = action === 'damage' || action === 'evade' ? rig.facing * 0.13 * [0.6, 1, 0.4][frame]
    : lying ? rig.facing * 1.25 : 0;
  const room = { swing: [0, 8, 2], thrust: [0, 10, 4], guard: [4, 4, 4], missile: [4, 4, 4] }[action];
  const bodyX = lying ? -rig.facing * 20 : rig.profile && room ? -rig.facing * room[frame] : 0;
  const scale = target.scale * (lying ? 0.78 : 1);
  g.save();
  g.beginPath(); g.rect(0, 0, width, height); g.clip();
  g.translate(target.x + bodyX * target.scale, target.y);
  g.scale(scale, scale);
  g.rotate(lean);
  g.imageSmoothingEnabled = false;
  for (const key of only ? [only] : dollLayerOrder(rig)) {
    const part = parts.get(key);
    if (!only && (part === null || (!part && !DOLL_DEMO.has(key)))) continue;
    const pose = dollMovement(rig, action, frame, key);
    g.save();
    g.translate(pose.x, pose.y); g.rotate(pose.angle); g.scale(1, pose.sy); g.translate(-pose.x, -pose.y);
    if (!part) drawDollDemo(g, key, rig);
    else {
      const source = dollMetrics(part.width, part.height);
      g.drawImage(part.image, part.dirs === 4 ? part.width * direction : 0, 0, part.width, part.height,
        -source.x / source.scale, -source.y / source.scale, part.width / source.scale, part.height / source.scale);
    }
    g.restore();
  }
  g.restore();
}

function dollSheet(parts, width, height, kind, slot) {
  const battle = kind === 'battle', template = kind === 'part';
  const cols = battle ? 9 : template ? 4 : 3, rows = battle ? 6 : template ? 1 : 4;
  const canvas = dollCanvas(width * cols, height * rows), g = canvas.getContext('2d');
  const paint = (col, row, dir, action, frame) => {
    g.save(); g.translate(col * width, row * height);
    drawDollFrame(g, width, height, parts, dir, action, frame, slot);
    g.restore();
  };
  if (battle) DOLL_BATTLE.forEach((action, motion) => {
    for (let frame = 0; frame < 3; frame++) paint(Math.floor(motion / 6) * 3 + frame, motion % 6, 1, action, frame);
  });
  else if (template) DOLL_DIRECTIONS.forEach((_, dir) => paint(dir, 0, dir, 'idle', 1));
  else DOLL_DIRECTIONS.forEach((_, dir) => {
    for (let frame = 0; frame < 3; frame++) paint(frame, dir, dir, kind === 'attack' ? 'swing' : 'walk', frame);
  });
  return canvas;
}

const DOLL_MIN = 8, DOLL_MAX = 768;
function dollSize(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n >= DOLL_MIN && n <= DOLL_MAX)) {
    throw new Error('单帧宽和高各填 ' + DOLL_MIN + '～' + DOLL_MAX + ' 的整数');
  }
  return { width, height };
}

function downloadDoll(canvas, name) {
  canvas.toBlob(blob => {
    if (!blob) { toast('PNG 生成失败', true); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name + '.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}

function openDollSample(title, body, setup, save) {
  return openDialog(`<header><h3>${esc(title)}</h3></header><div class="dbody">${body}</div>
    <footer><span class="sp"></span><button type="button" class="small" data-save>下载 PNG</button><button type="button" class="primary" data-x>关闭</button></footer>`, (d, done) => {
    d.classList.add('dlg-doll-sample');
    d.addEventListener('close', () => d.classList.remove('dlg-doll-sample'), { once: true });
    $('[data-save]', d).onclick = save;
    const close = $('[data-x]', d);
    close.onclick = () => done();
    if (setup) setup(d);
    close.focus();
  });
}

function previewDollPart(key, label, width, height) {
  const sheet = dollSheet(new Map(), width, height, 'part', key);
  return openDollSample(label + '样图', `<div class="dim">单帧 ${width} × ${height} px · 四向整图 ${sheet.width} × ${sheet.height} px</div>
    <div class="doll-sample-grid">${DOLL_DIRECTIONS.map(direction => `<figure><div class="doll-sample-pixels"></div><figcaption>${direction}</figcaption></figure>`).join('')}</div>`, d => {
    const scale = Math.min(4, 164 / Math.max(width, height));
    $$('.doll-sample-pixels', d).forEach((frame, i) => {
      const canvas = dollCanvas(width, height);
      canvas.style.width = Math.max(1, Math.floor(width * scale)) + 'px';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.getContext('2d').drawImage(sheet, i * width, 0, width, height, 0, 0, width, height);
      frame.append(canvas);
    });
  }, () => downloadDoll(sheet, label + '_四向部位_' + width + 'x' + height));
}

function previewDollGameSample(sample) {
  const url = img('characters', sample.name);
  return openDollSample('游戏行走样图', `<div class="dim">${esc(sample.name)}</div>
    <div class="doll-sample-pixels doll-sample-sheet"><img src="${esc(url)}" alt="游戏行走图 ${esc(sample.name)}"></div>`, null, () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = sample.name.split('/').at(-1) + '.png';
    link.click();
  });
}

async function viewPaperDoll(main) {
  main.innerHTML = '<div class="loading">正在读取工程的小人尺寸…</div>';
  const loading = main.firstElementChild;
  const guide = await api('sprite-guide');
  if (!loading.isConnected) return;
  if (!guide.canWrite) {
    main.innerHTML = '<div class="page"><div class="err">只读模式下无法制作素材</div><a href="#/sprites">返回小人库</a></div>';
    return;
  }
  const { width: rw, height: rh } = guide.recommended;
  const recommendedOK = [rw, rh].every(n => n >= DOLL_MIN && n <= DOLL_MAX);
  const parts = new Map();
  let generated = null, saved = null, busy = false, step = 0, pending = null;
  main.innerHTML = '<div class="page wide doll-page">' +
    '<div class="crumbs"><a href="#/sprites">小人库</a><span>›</span><span>纸娃娃制作</span></div>' +
    '<div class="titlebar"><h1>纸娃娃制作</h1></div><div id="dollGuide"></div>' +
    '<div class="doll-editor"><section class="card doll-stage">' +
    '<div class="doll-toolbar"><label>朝向 <select id="dollDirection">' +
    DOLL_DIRECTIONS.map((label, i) => '<option value="' + i + '">' + label + '</option>').join('') +
    '</select></label><label>动作 <select id="dollAction">' +
    DOLL_ACTIONS.map(([key, label]) => '<option value="' + key + '"' + (key === 'walk' ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select></label><button class="small" id="dollPause">暂停</button></div>' +
    '<div class="doll-preview"><canvas id="dollCanvas" aria-label="纸娃娃动作预览"></canvas></div>' +
    '<div class="doll-toolbar doll-size"><label>单帧宽 <input type="number" id="dollWidth" min="' + DOLL_MIN + '" max="' + DOLL_MAX + '" value="' + (recommendedOK ? rw : 48) + '"></label>' +
    '<label>高 <input type="number" id="dollHeight" min="' + DOLL_MIN + '" max="' + DOLL_MAX + '" value="' + (recommendedOK ? rh : 48) + '"></label><span class="faint">px</span>' +
    '<button class="small" id="dollRecommended"' + (recommendedOK ? '' : ' disabled') + '>用推荐尺寸</button></div>' +
    '<div id="dollDimensions" class="dim"></div>' +
    '<div class="doll-toolbar"><button class="primary" id="dollGenerate">生成素材</button>' +
    '<button class="small" id="dollWalk" disabled>下载行走图</button><button class="small" id="dollBattle" disabled>下载战斗图</button>' +
    '<button class="small" id="dollAttack" disabled>下载四方向攻击图</button></div></section>' +
    '<section class="card doll-parts"><div class="doll-heading"><h2>身体与装备</h2><button class="quiet small" id="dollReset">恢复木偶</button></div>' +
    '<p class="dim" id="dollSpec"></p><input id="dollPartFile" type="file" accept="image/png" hidden><div class="doll-slots">' +
    DOLL_SLOTS.map(([key, label]) => '<div class="doll-slot" data-part="' + key + '"><strong>' + label + '</strong><span class="dim" data-part-status></span>' +
      '<button class="small" data-part-import aria-label="导入' + label + '">导入</button><button type="button" class="quiet small" data-part-template aria-haspopup="dialog" aria-label="查看' + label + '样图">样图</button>' +
      '<button class="quiet small" data-part-remove aria-label="移除' + label + '">移除</button></div>').join('') +
    '</div></section></div>' +
    '<section class="card doll-publish"><div class="doll-toolbar"><label>素材名称 <input id="dollName" maxlength="57" placeholder="木偶"></label>' +
    '<button class="primary" id="dollSave" disabled>保存到游戏</button><button id="dollLeader" disabled>套用到主角</button><button id="dollNpc" disabled>放到地图做 NPC</button></div>' +
    '<div id="dollResult" class="dim" aria-live="polite"></div><div id="dollError" role="alert" class="err" hidden></div></section></div>';

  const page = $('.doll-page', main), el = id => $('#' + id, page);
  showSpriteGuide(el('dollGuide'), guide, previewDollGameSample);
  const cv = el('dollCanvas'), g = cv.getContext('2d');
  const partInput = el('dollPartFile'), nameInput = el('dollName');
  const partRows = $$('[data-part]', page);
  let paused = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dimensions = () => dollSize(Number(el('dollWidth').value), Number(el('dollHeight').value));
  const fail = error => {
    const target = el('dollError');
    target.textContent = error ? error.message : '';
    target.hidden = !error;
  };
  const controls = () => {
    for (const id of ['dollWalk', 'dollBattle', 'dollAttack']) el(id).disabled = busy || !generated;
    el('dollSave').disabled = busy || !generated || !!saved;
    for (const id of ['dollLeader', 'dollNpc']) el(id).disabled = busy || !saved;
    for (const id of ['dollWidth', 'dollHeight', 'dollName', 'dollReset', 'dollGenerate']) el(id).disabled = busy;
    el('dollRecommended').disabled = busy || !recommendedOK;
    for (const row of partRows) for (const button of $$('button', row)) button.disabled = busy || (button.hasAttribute('data-part-remove') && button.hidden);
  };
  const paint = () => {
    let size;
    try { size = dimensions(); } catch { return; }
    const { width, height } = size;
    if (cv.width !== width || cv.height !== height) {
      cv.width = width; cv.height = height;
      const k = Math.min(246 / width, 248 / height, 5);
      cv.style.width = Math.max(8, Math.floor(width * k)) + 'px';
      cv.style.height = 'auto';
    }
    const action = el('dollAction').value, direction = Number(el('dollDirection').value);
    const pattern = action === 'idle' || paused ? 1 : [0, 1, 2, 1][step % 4];
    g.clearRect(0, 0, width, height);
    drawDollFrame(g, width, height, parts, direction, action, pattern);
  };
  const announceSize = () => {
    const { width, height } = dimensions();
    el('dollDimensions').textContent = '行走图 ' + width * 3 + ' × ' + height * 4 + ' px · 战斗图 ' + width * 9 + ' × ' + height * 6 + ' px';
    el('dollSpec').textContent = '部位 PNG 每格 ' + width + ' × ' + height + ' px。使用同一透明画布定位，可交一格通用图，或按正面、左侧、右侧、背面横排四格。';
  };
  const partStatus = () => {
    for (const row of partRows) {
      const key = row.dataset.part, part = parts.get(key);
      const show = !!part || (part !== null && DOLL_DEMO.has(key));
      const status = $('[data-part-status]', row), remove = $('[data-part-remove]', row);
      status.textContent = part ? part.name : show ? '木偶示例' : '空';
      status.title = part ? part.name : '';
      remove.hidden = !show;
    }
  };
  const changed = () => {
    generated = saved = null;
    el('dollResult').textContent = '';
    fail(null);
    try { announceSize(); } catch (error) { fail(error); }
    partStatus(); paint(); controls();
    S.dirty = true;
  };

  partRows.forEach(row => {
    const key = row.dataset.part;
    $('[data-part-import]', row).onclick = () => {
      try { pending = { key, ...dimensions() }; partInput.click(); } catch (error) { fail(error); }
    };
    $('[data-part-template]', row).onclick = () => {
      try {
        const { width, height } = dimensions();
        const label = DOLL_SLOTS.find(([id]) => id === key)[1];
        previewDollPart(key, label, width, height);
      } catch (error) { fail(error); }
    };
    $('[data-part-remove]', row).onclick = () => { parts.set(key, null); changed(); };
  });
  partInput.onchange = async () => {
    const file = partInput.files[0], request = pending;
    partInput.value = ''; pending = null;
    if (!file || !request || busy) return;
    busy = true; controls(); fail(null);
    try {
      const im = await loadFileImage(file), { width, height, key } = request;
      const dirs = im.naturalWidth / width;
      if (im.naturalHeight !== height || ![1, 4].includes(dirs)) {
        throw new Error('此部位应为 ' + width + ' × ' + height + ' px 或 ' + width * 4 + ' × ' + height + ' px 的 PNG');
      }
      if (page.isConnected) {
        parts.set(key, { image: im, width, height, dirs, name: file.name });
        changed();
      }
    } catch (error) { if (page.isConnected) fail(error); }
    finally { busy = false; if (page.isConnected) controls(); }
  };

  el('dollReset').onclick = () => { parts.clear(); changed(); };
  el('dollRecommended').onclick = () => { el('dollWidth').value = rw; el('dollHeight').value = rh; changed(); };
  for (const id of ['dollWidth', 'dollHeight']) el(id).onchange = changed;
  for (const id of ['dollAction', 'dollDirection']) el(id).onchange = () => { step = 0; paint(); };
  el('dollPause').onclick = () => {
    paused = !paused; el('dollPause').textContent = paused ? '播放' : '暂停'; paint();
  };
  el('dollPause').textContent = paused ? '播放' : '暂停';
  for (const [id, kind, suffix] of [['dollWalk', 'walk', ''], ['dollBattle', 'battle', '_战斗'], ['dollAttack', 'attack', '_攻击']]) {
    el(id).onclick = () => {
      if (!generated || busy) return;
      const name = nameInput.value.trim() || '木偶';
      downloadDoll(generated[kind], (kind === 'battle' ? '' : '$') + name + suffix);
    };
  }
  el('dollGenerate').onclick = () => {
    try {
      const { width, height } = dimensions();
      generated = Object.fromEntries(['walk', 'battle', 'attack'].map(kind => [kind, dollSheet(parts, width, height, kind)]));
      if (!saved) el('dollResult').textContent = '行走图、四方向攻击图和侧视战斗图已生成。';
      fail(null); controls();
    } catch (error) { fail(error); }
  };
  nameInput.oninput = () => {
    if (!saved || nameInput.value.trim() === saved.battle) return;
    saved = null;
    el('dollResult').textContent = '可以用新名称保存已生成的素材。';
    controls();
  };
  el('dollSave').onclick = async () => {
    if (!generated || saved || busy) return;
    const name = nameInput.value.trim();
    if (!name) { fail(new Error('请填写素材名称')); nameInput.focus(); return; }
    busy = true; fail(null); controls();
    try {
      const { walk, battle, attack } = generated;
      const images = { walk: canvasPng(walk), battle: canvasPng(battle), attack: canvasPng(attack) };
      if (Object.values(images).reduce((n, data) => n + data.length, 0) > 15e6) throw new Error('生成图片合计太大，请调小单帧尺寸后重新生成');
      saved = await api('doll/save', { name, ...images });
      if (page.isConnected) {
        for (const name of [saved.walk, saved.attack]) forgetImage('characters', name);
        S.dirty = false;
        el('dollResult').textContent = '已保存 ' + saved.walk + '、' + saved.attack + ' 和侧视战斗图 ' + saved.battle + '。';
      }
    } catch (error) { if (page.isConnected) fail(error); }
    finally { busy = false; if (page.isConnected) controls(); }
  };
  el('dollLeader').onclick = async () => {
    if (!saved || busy) return;
    const result = await applyDollLeader(saved, guide);
    if (result && page.isConnected) {
      guide.leader = result.id;
      if (!guide.actors.some(actor => actor.id === result.id)) guide.actors.push({ id: result.id, name: result.name });
      guide.sideView ||= result.enableSideView;
      el('dollResult').textContent = '已给主角「' + result.name + '」换装。';
    }
  };
  el('dollNpc').onclick = async () => {
    if (!saved || busy) return;
    const npc = await placeDollNpc(saved, guide.startMap);
    if (npc && page.isConnected) {
      const link = document.createElement('a');
      link.href = '#/event/' + npc.map + '/' + npc.id;
      link.textContent = '打开 NPC 事件';
      el('dollResult').replaceChildren('NPC 已放到地图。', link);
      await refreshMaps();
    }
  };
  announceSize(); partStatus(); controls(); paint();
  const timer = setInterval(() => {
    if (!page.isConnected) { clearInterval(timer); return; }
    if (!paused) { step++; paint(); }
  }, 175);
}

function applyDollLeader(saved, guide) {
  const actor = guide.actors.find(a => a.id === guide.leader);
  return openDialog('<header><h3>套用到主角</h3></header><div class="dbody">' +
    (actor ? '<p>给当前主角「' + esc(actor.name) + '」换用这套行走图和战斗图。</p>'
      : '<label for="dollActorName">主角名字</label><input id="dollActorName" maxlength="40" value="' + esc(saved.battle) + '">') +
    (guide.sideView ? '' : '<label><input type="checkbox" id="dollSideView"> 将本工程的战斗切换为侧视，显示角色攻击动作</label>') +
    '<div role="alert" id="dollBindError"></div></div><footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>应用</button></footer>', (d, done) => {
    const ok = $('[data-ok]', d), cancel = $('[data-x]', d), generation = d._gen;
    const cancelSubmission = event => { if (ok.disabled) event.preventDefault(); };
    d.addEventListener('cancel', cancelSubmission);
    d.addEventListener('close', () => d.removeEventListener('cancel', cancelSubmission), { once: true });
    d.onclick = event => { if (event.target === d && !ok.disabled) done(null); };
    cancel.onclick = () => done(null);
    ok.onclick = async () => {
      const active = () => d.open && d._gen === generation;
      const name = actor ? actor.name : $('#dollActorName', d).value.trim();
      const enableSideView = !!$('#dollSideView', d)?.checked;
      const asset = { characterName: saved.walk, characterIndex: 0, battlerName: saved.battle, enableSideView };
      ok.disabled = cancel.disabled = true;
      try {
        const r = actor ? await api('actor/update', { id: actor.id, ...asset }) : await api('actor/create', { name, makeLeader: true, ...asset });
        if (active()) done({ id: actor ? actor.id : r.id, name, enableSideView });
      } catch (error) { if (active()) $('#dollBindError', d).textContent = error.message; }
      finally { if (active()) ok.disabled = cancel.disabled = false; }
    };
  });
}

async function placeDollNpc(saved, defaultMap) {
  let maps;
  try { maps = await lookup('map'); } catch (error) { toast(error.message, true); return; }
  if (!maps.length) { toast('这个工程还没有地图', true); return; }
  return openDialog('<header><h3>放到地图做 NPC</h3></header><div class="dbody">' +
    '<div class="fgrid"><label for="dollNpcName">名字</label><input id="dollNpcName" maxlength="40" value="' + esc(saved.battle) + '">' +
    '<label for="dollNpcMap">地图</label><select id="dollNpcMap">' + maps.map(m => '<option value="' + m.id + '"' + (m.id === defaultMap ? ' selected' : '') + '>' + esc(m.name || '地图 ' + m.id) + '</option>').join('') +
    '</select><label for="dollNpcMove">移动方式</label><select id="dollNpcMove"><option value="0">站立</option><option value="1">随机走动</option></select></div>' +
    '<label><input type="checkbox" id="dollNpcAttack"> 按互动键时播放挥砍动作</label>' +
    '<div id="dollNpcMapBox"></div><div id="dollNpcPoint" class="dim">在地图上选一格</div><div role="alert" id="dollNpcError"></div></div>' +
    '<footer><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok disabled>放置 NPC</button></footer>', (d, done) => {
    const map = $('#dollNpcMap', d), holder = $('#dollNpcMapBox', d), ok = $('[data-ok]', d), cancel = $('[data-x]', d), generation = d._gen;
    let point = null, box = null, submitting = false;
    const active = () => d.open && d._gen === generation;
    d.classList.add('dlg-wide');
    d.addEventListener('close', () => d.classList.remove('dlg-wide'), { once: true });
    const cancelSubmission = event => { if (submitting) event.preventDefault(); };
    d.addEventListener('cancel', cancelSubmission);
    d.addEventListener('close', () => d.removeEventListener('cancel', cancelSubmission), { once: true });
    d.onclick = event => { if (event.target === d && !submitting) done(null); };
    cancel.onclick = () => done(null);
    const load = async () => {
      const id = Number(map.value), target = document.createElement('div');
      box = target; point = null; ok.disabled = true; holder.replaceChildren(target);
      $('#dollNpcPoint', d).textContent = '在地图上选一格';
      $('#dollNpcError', d).textContent = '';
      try {
        await mountMapPicker(target, id, p => {
          if (!active() || box !== target || submitting) return;
          point = { map: id, ...p }; ok.disabled = false;
          $('#dollNpcPoint', d).textContent = '坐标 ' + p.x + ', ' + p.y;
        });
      } catch (error) { if (active() && box === target) target.textContent = error.message; }
    };
    map.onchange = load;
    ok.onclick = async () => {
      if (!point || submitting) return;
      submitting = ok.disabled = map.disabled = cancel.disabled = true;
      try {
        const r = await api('event/create', {
          ...point, name: $('#dollNpcName', d).value, moveType: Number($('#dollNpcMove', d).value),
          attackName: $('#dollNpcAttack', d).checked ? saved.attack : '',
          image: { characterName: saved.walk, characterIndex: 0, direction: 2, pattern: 1 },
        });
        if (active()) done({ map: point.map, id: r.id });
      } catch (error) { if (active()) $('#dollNpcError', d).textContent = error.message; }
      finally { if (active()) submitting = ok.disabled = map.disabled = cancel.disabled = false; }
    };
    load();
  });
}
