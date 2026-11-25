'use strict';

const pluginStatuses = { on: '已启用', off: '已关闭', unregistered: '未登记', missing: '仅从事件识别' };
const portraitPluginId = 'RpgStudio_AnimatedPortrait';
const pluginHref = (tab, id) => '#/plugins/' + tab + (id ? '/' + enc(id) : '');
const formatPluginBytes = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';

function pluginPage(tab, body) {
  return `<div class="page wide"><div class="titlebar"><h1>插件</h1></div><div class="tabs plugin-tabs">
    ${[['game', '工程插件'], ['market', '插件市场']].map(([id, label]) => `<a class="tag ${tab === id ? 'acc' : ''}" href="${pluginHref(id)}" ${tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
    </div>${body}</div>`;
}

async function viewPlugins(main, tab, id) {
  main.innerHTML = '<div class="loading">正在读取插件…</div>';
  if (tab === 'market' && id === portraitPluginId) return viewAnimatedPortrait(main);
  if (tab === 'game' && id) return viewPluginDetails(main, id);
  const r = await api('plugins');
  if (route().name !== 'plugins' || route().a !== tab || route().b !== id) return;
  if (tab === 'market') {
    main.innerHTML = pluginPage('market', `<div class="plugin-market-grid">${r.market.map(card => `<article class="card plugin-card">
      <h2>${esc(card.name)}</h2><p class="dim">${esc(card.description)}</p>
      <div class="edit-section"><span class="dim">${card.enabled ? '已启用' : card.managed ? '未启用' : '随相关功能启用'}</span><span class="sp"></span>
      ${card.href ? `<a class="tag${card.managed ? ' acc' : ''}" href="${card.href}">${card.managed ? '配置插件' : '打开功能'}</a>` : ''}</div>
    </article>`).join('')}</div>`);
    return;
  }
  const enabled = r.rows.filter(row => row.status === 'on').length;
  main.innerHTML = pluginPage('game', `<div class="filters"><input type="search" id="pluginQuery" aria-label="搜索插件" placeholder="搜索插件名称">
    <select id="pluginStatus" aria-label="筛选插件状态"><option value="all">全部状态</option>${Object.entries(pluginStatuses).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
    <span class="dim">${esc(r.engine)} · ${enabled} 个已启用</span></div><div class="card rows" id="projectPlugins"></div>`);
  const query = $('#pluginQuery', main), status = $('#pluginStatus', main), list = $('#projectPlugins', main);
  const draw = () => {
    const q = query.value.trim().toLowerCase();
    list.innerHTML = r.rows.filter(row => (status.value === 'all' || status.value === row.status) && (!q || (row.name + ' ' + row.description).toLowerCase().includes(q)))
      .map(row => `<a class="rowlink" href="${pluginHref('game', row.key)}"><span><b>${esc(row.name)}</b>${row.description ? `<span class="plugin-description dim">${esc(row.description)}</span>` : ''}</span><span class="dim">${pluginStatuses[row.status]} · ${row.uses} 次调用</span></a>`).join('') || '<div class="empty">没有匹配的插件</div>';
  };
  query.oninput = status.onchange = draw;
  draw();
}

async function viewPluginDetails(main, id) {
  const { plugin } = await api('plugin/details?id=' + enc(id));
  if (route().name !== 'plugins' || route().a !== 'game' || route().b !== id) return;
  main.innerHTML = pluginPage('game', `<div class="crumbs"><a href="${pluginHref('game')}">工程插件</a><span>›</span><span>${esc(plugin.name)}</span></div>
    <div class="titlebar"><h2>${esc(plugin.name)}</h2><span class="dim">${pluginStatuses[plugin.status]}${(!plugin.file && plugin.order != null) ? ' · 找不到源文件' : ''}</span></div>
    ${plugin.description ? `<p class="dim">${esc(plugin.description)}</p>` : ''}
    <div class="filters"><input id="pluginCommandQuery" type="search" aria-label="搜索命令" placeholder="搜索命令"><label><input type="checkbox" id="pluginOnlyUsed"> 仅看已使用</label></div>
    <div class="card rows" id="pluginCommands"></div>`);
  const query = $('#pluginCommandQuery', main), only = $('#pluginOnlyUsed', main), target = $('#pluginCommands', main);
  const draw = () => {
    const q = query.value.trim().toLowerCase();
    target.innerHTML = plugin.commands.map((command, i) => ({ command, i })).filter(({ command }) =>
      (!only.checked || command.count) && (!q || (command.id + ' ' + command.text).toLowerCase().includes(q))).map(({ command, i }) => {
      const kind = command.declaration === 'header' ? '注释声明' : command.declaration === 'registration' ? '代码注册' : command.kinds.join(' / ') || '未声明';
      return `<details class="plugin-command" data-command="${i}"><summary><b>${esc(command.text)}</b>${command.id === command.text ? '' : `<code>${esc(command.id)}</code>`}<span class="dim">${esc(kind)} · ${command.count} 次调用</span></summary><div class="plugin-command-body"></div></details>`;
    }).join('') || '<div class="empty">没有匹配的命令</div>';
    $$('[data-command]', target).forEach(details => details.ontoggle = () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = 'yes';
      const command = plugin.commands[Number(details.dataset.command)], body = $('.plugin-command-body', details);
      body.innerHTML = `${command.declaration === 'header' ? `<p><code>#插件 ${esc(plugin.key)} ${esc(command.id)}</code></p>` : ''}
        ${command.args.length ? `<table class="plugin-args"><thead><tr><th>参数</th><th>键</th><th>默认值</th></tr></thead><tbody>${command.args.map(arg => `<tr><td>${esc(arg.label)}</td><td><code>${esc(arg.key)}</code></td><td>${esc(arg.def ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${command.refs.length ? `<div class="rows">${command.refs.map(ref => `<a class="rowlink" href="${hrefOf(ref.at)}"><span>${esc(ref.where)}</span><span class="dim">第 ${ref.line + 1} 条</span></a>`).join('')}</div>${command.count > command.refs.length ? `<p class="dim">显示前 ${command.refs.length} 次调用</p>` : ''}` : '<p class="dim">未在地图事件、公共事件或敌群事件中记录到调用。</p>'}`;
    });
  };
  query.oninput = only.onchange = draw;
  draw();
}

function portraitDisplayFields(profile, screen) {
  const notes = `<p class="dim" id="portraitVideoCrop">短片会填满选区，超出边界的部分会被裁掉。</p>
    <p class="dim" id="portraitLiveCrop">模型缩放为 100% 时自动适配选区。可以在「模型缩放」里放大，超出边界的部分会被裁掉。</p>`;
  return `<details class="edit-more" ${profile.region.enabled ? 'open' : ''}><summary>画中画范围与淡入淡出</summary>
    ${portraitRegionFields(profile.region, screen, '', notes)}
    <div class="fgrid portrait-fade"><label for="portraitFadeIn">淡入（秒）</label><input type="number" id="portraitFadeIn" min="0" max="10" step="any" required value="${esc(profile.fade.in)}">
    <label for="portraitFadeOut">淡出（秒）</label><input type="number" id="portraitFadeOut" min="0" max="10" step="any" required value="${esc(profile.fade.out)}"></div>
    <p class="dim">进入地图或战斗时淡入。填 0 立即显示或隐藏。也可以用这两条事件指令控制显示。</p>
    <div class="portrait-commands"><code>#插件 ${portraitPluginId} show</code><code>#插件 ${portraitPluginId} hide</code></div>
  </details>`;
}

async function viewAnimatedPortrait(main) {
  const r = await api('plugin/animated-portrait'), profile = r.profile;
  if (route().name !== 'plugins' || route().a !== 'market' || route().b !== portraitPluginId) return;
  const choices = (values, selected, empty = '沿用待机') => `<option value="">${empty}</option>${values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
  const fields = (kind, values, selected) => Object.entries(r.states).map(([key, label]) => `<label for="${kind}-${key}">${label}</label><select id="${kind}-${key}" data-${kind}="${key}">${choices(values, selected[key], key === 'idle' ? '选择待机素材' : undefined)}</select>`).join('');
  main.innerHTML = pluginPage('market', `<div class="crumbs"><a href="${pluginHref('market')}">插件市场</a><span>›</span><span>动态立绘</span></div>
    <div class="titlebar"><h2>动态立绘</h2><span class="dim">${profile.enabled ? '已启用' : '未启用'}</span></div>
    <form class="card plugin-config"><fieldset class="edit-fields" ${r.canWrite ? '' : 'disabled'}>
      <label class="edit-toggle"><input type="checkbox" id="animatedEnabled" ${profile.enabled ? 'checked' : ''}> 在地图和战斗画面中显示动态立绘</label>
      <div class="fgrid"><label for="animatedMode">素材方式</label><select id="animatedMode">
        <option value="video">压缩视频（WebM / MP4）</option><option value="live2d" ${profile.mode === 'live2d' || profile.mode === 'video' && r.models.length && !r.clips.length && !profile.enabled ? 'selected' : ''}>工程已有的 Live2D 模型</option>
        <option value="layered" ${profile.mode === 'layered' ? 'selected' : ''}>人物分层立绘</option></select>
        <label for="animatedPosition" data-default-position>显示位置</label><select id="animatedPosition" data-default-position><option value="bottom">右下</option><option value="top" ${profile.position === 'top' ? 'selected' : ''}>右上</option></select>
      </div>
      <div id="animatedVideo"><p class="dim">通过「导入素材」把短片放进视频目录。多个状态可以复用同一个文件。<a href="#/assets">导入视频</a></p>
        <div class="fgrid">${fields('clip', r.clips.map(clip => clip.name), profile.media)}</div>
        <p class="dim" data-clip-size></p></div>
      <div id="animatedLive"><p class="dim">复用已启用的 PictureLive2D 模型。待机、行走、攻击和受击切换同一个模型的动作。</p>
        ${r.models.length ? '' : '<p class="dim">当前工程未找到已登记的 PictureLive2D 模型。可以使用视频素材。</p>'}
        <div class="fgrid"><label for="animatedModel">模型</label><select id="animatedModel">${choices(r.models.map(model => model.id), profile.model, '选择模型')}</select>
        ${fields('motion', [], {})}<label for="animatedScale">模型缩放（%）</label><input type="number" id="animatedScale" min="10" max="200" required value="${esc(profile.scale)}"></div>
      </div>
      <div id="animatedParts"><p class="dim">使用在<a href="#/people">人物</a>中制作的分层立绘。画中画随主角行走、攻击和受击自动切换动作。</p>
        <div class="fgrid"><label for="animatedPartsActor">使用谁的立绘</label><select id="animatedPartsActor">
          <option value="0">当前主角</option>${r.layered.map(actor => `<option value="${actor.id}" ${actor.id === profile.layeredActor ? 'selected' : ''}>${esc(actor.name)}</option>`).join('')}</select></div>
        <div class="fgrid" id="animatedPartsFaces">${fields('partsface', [], {})}</div>
        ${r.layered.length ? '' : '<p class="dim">请先在人物页保存一套分层立绘。</p>'}
      </div>
      <div class="fgrid" id="animatedWidthFields"><label for="animatedWidth">显示宽度（%）</label><input type="number" id="animatedWidth" min="15" max="55" required value="${esc(profile.width)}"></div>
      ${portraitDisplayFields(profile, r.screen)}
      <details class="edit-more"><summary>地图自定义动作</summary><p>在攻击或受击事件中调用插件的 <code>motion</code> 命令。普通行走和回合制战斗会自动切换。</p><code>#插件 RpgStudio_AnimatedPortrait motion（attack，42）</code><p class="dim">参数依次是状态和帧数。状态可写 idle、walk、attack、hit。</p></details>
      ${r.canWrite ? '<div class="edit-section"><button class="primary small" type="submit">保存插件设置</button></div>' : ''}
    </fieldset><div role="alert" data-error></div></form>`);
  const form = $('form', main), mode = $('#animatedMode', form), model = $('#animatedModel', form);
  const error = $('[data-error]', form), fieldset = $('fieldset', form);
  const clips = $$('[data-clip]', form), motions = $$('[data-motion]', form);
  const partsActor = $('#animatedPartsActor', form), partFaces = $$('[data-partsface]', form);
  const sizes = new Map(r.clips.map(row => [row.name, row.bytes]));
  const getRegion = bindPortraitRegion(form);
  const restricted = $('#portraitRegionEnabled', form), width = $('#animatedWidth', form), scale = $('#animatedScale', form);
  const selectMode = () => {
    $('#animatedVideo', form).hidden = $('#portraitVideoCrop', form).hidden = mode.value !== 'video';
    $('#animatedLive', form).hidden = $('#portraitLiveCrop', form).hidden = mode.value !== 'live2d';
    $('#animatedParts', form).hidden = mode.value !== 'layered';
    $('#animatedWidthFields', form).hidden = width.disabled = mode.value === 'live2d' || restricted.checked;
    scale.disabled = mode.value !== 'live2d';
  };
  const selectModel = selected => {
    const motion = r.models.find(row => row.id === model.value)?.motions || [];
    motions.forEach(el => el.innerHTML = choices(motion, selected[el.dataset.motion], el.dataset.motion === 'idle' ? '选择待机动作' : undefined));
  };
  const selectPartsActor = selected => {
    const actor = r.layered.find(row => row.id === Number(partsActor.value));
    $('#animatedPartsFaces', form).hidden = !actor;
    partFaces.forEach(el => el.innerHTML = choices(actor?.faces || [], selected[el.dataset.partsface], el.dataset.partsface === 'idle' ? '默认表情' : '沿用待机表情'));
  };
  const sum = () => {
    const total = [...new Set(clips.map(el => el.value))].reduce((n, file) => n + (sizes.get(file) || 0), 0);
    $('[data-clip-size]', form).textContent = '已选文件合计 ' + formatPluginBytes(total);
  };
  clips.forEach(el => el.onchange = sum);
  mode.onchange = selectMode;
  restricted.addEventListener('change', selectMode);
  model.onchange = () => selectModel({});
  partsActor.onchange = () => selectPartsActor({});
  selectModel(profile.motions); selectPartsActor(profile.layeredFaces); selectMode(); sum();
  form.onsubmit = async event => {
    event.preventDefault();
    if (!r.canWrite) return;
    const body = { enabled: $('#animatedEnabled', form).checked, mode: mode.value, model: model.value,
      position: $('#animatedPosition', form).value, width: width.disabled ? profile.width : width.valueAsNumber, scale: scale.disabled ? profile.scale : scale.valueAsNumber,
      region: getRegion(), fade: { in: $('#portraitFadeIn', form).valueAsNumber, out: $('#portraitFadeOut', form).valueAsNumber },
      layeredActor: Number(partsActor.value), layeredFaces: Object.fromEntries(partFaces.map(el => [el.dataset.partsface, el.value])),
      media: Object.fromEntries(clips.map(el => [el.dataset.clip, el.value])), motions: Object.fromEntries(motions.map(el => [el.dataset.motion, el.value])) };
    fieldset.disabled = true;
    error.textContent = '';
    try { await api('plugin/animated-portrait', body); S.lookups = {}; toast('已保存插件设置'); go(pluginHref('market')); }
    catch (e) { error.textContent = e.message; }
    finally { fieldset.disabled = false; }
  };
}
