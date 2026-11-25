'use strict';

async function choosePortraitImport(actor) {
  const { sources } = await api('layered-portrait/import/sources?actor=' + actor.id);
  if (!sources.length) throw new Error('这个工程的地图、公共事件和敌群里没有找到原生「显示图片」指令');
  const slots = Object.entries(RpgStudioLayered.slots);
  return openDialog(`<header><h3>为${esc(actor.name)}提取立绘</h3><button class="quiet small" type="button" data-cancel>关闭</button></header>
    <form class="portrait-extract"><div class="dbody">
      <div class="portrait-extract-search"><label>筛选事件或图片 <input type="search" data-source-query placeholder="例如 公共事件、角色名、body"></label>
        <label>原事件 <select data-source></select></label><label>原画面 <select data-frame></select></label></div>
      <p class="dim">选择同时显示的图层，确认它们在木偶里的部位。看不出用途的图层也可保留为附加图层。</p>
      <div class="portrait-extract-grid"><div><div data-parts-preview aria-label="选中图层的叠放预览"></div><p class="dim" data-summary></p></div>
      <section data-source-parts aria-label="原事件的图层"></section></div>
      <p class="dim" data-notice></p><p class="err" role="alert" data-error></p>
    </div><footer><a class="tag" data-open-source target="_blank" rel="noopener" hidden>查看原事件</a><span class="sp"></span><button class="primary" type="submit" disabled>载入木偶草稿</button></footer></form>`,
  (dialog, done) => {
    const form = $('form', dialog), query = $('[data-source-query]', form), source = $('[data-source]', form), frame = $('[data-frame]', form);
    const list = $('[data-source-parts]', form), preview = $('[data-parts-preview]', form), summary = $('[data-summary]', form), notice = $('[data-notice]', form);
    const save = $('[type=submit]', form), error = $('[data-error]', form), openSource = $('[data-open-source]', form);
    let frames = [], token = 0, busy = false, selected = null;
    const getLayer = id => selected?.layers.find(row => row.id === id);
    const mapping = () => $$('[data-part-choice]', list).filter(el => el.value).map(el => ({ id: Number(el.dataset.partChoice), slot: el.value }));
    function draw() {
      const chosen = mapping(), visible = chosen.map(row => getLayer(row.id));
      const duplicates = new Set(chosen.map(row => row.slot)).size !== chosen.length;
      save.disabled = busy || !chosen.length || duplicates;
      preview.style.width = ''; preview.style.height = '';
      if (!visible.length) {
        preview.textContent = '选择一个部位后预览'; summary.textContent = ''; return;
      }
      const left = Math.min(...visible.map(row => row.x)), top = Math.min(...visible.map(row => row.y));
      const width = Math.max(1, Math.max(...visible.map(row => row.x + row.w)) - left);
      const height = Math.max(1, Math.max(...visible.map(row => row.y + row.h)) - top);
      const zoom = Math.min(Math.min(340, preview.parentElement.clientWidth) / width, 300 / height, 1);
      preview.style.width = Math.ceil(width * zoom) + 'px'; preview.style.height = Math.ceil(height * zoom) + 'px';
      preview.innerHTML = visible.map(row => `<img alt="" src="${img('pictures', row.name)}" style="left:${(row.x - left) * zoom}px;top:${(row.y - top) * zoom}px;width:${row.w * zoom}px;height:${row.h * zoom}px;opacity:${row.alpha / 255};transform:scale(${row.flipX ? -1 : 1},${row.flipY ? -1 : 1})">`).join('');
      summary.textContent = duplicates ? '同一个部位只能选一张图。可把多余的图片放在附加图层。' : `已选 ${visible.length} 张图 · ${Math.ceil(width)} × ${Math.ceil(height)} 像素`;
    }
    function showFrame() {
      selected = frames.find(row => row.key === frame.value) || null;
      if (!selected) { list.innerHTML = ''; draw(); return; }
      const assigned = new Set();
      list.innerHTML = selected.layers.map(row => {
        const guess = !row.issue && !assigned.has(row.suggested) ? row.suggested : '';
        if (guess) assigned.add(guess);
        return `<div class="portrait-extract-part"><img src="${img('pictures', row.name)}" alt="" loading="lazy">
        <span><b>${esc(row.name)}</b><small>图片 ${row.id}${row.issue ? ' · ' + esc(row.issue) : ` · ${Math.round(row.w)} × ${Math.round(row.h)}`}</small></span>
        ${row.issue ? '<span class="dim">保留原指令</span>' : `<select data-part-choice="${row.id}" aria-label="${esc(row.name)} 的部位"><option value="">本次略过</option>${slots.map(([id, label]) => `<option value="${id}" ${id === guess ? 'selected' : ''}>${label}</option>`).join('')}</select>`}</div>`;
      }).join('');
      draw();
    }
    async function scan() {
      const sequence = ++token, item = source.value === '' ? null : sources[Number(source.value)];
      frames = []; frame.innerHTML = ''; showFrame(); error.textContent = ''; notice.textContent = '';
      openSource.hidden = !item || item.at.type === 'troop';
      if (!item) return;
      openSource.href = hrefOf(item.at);
      notice.textContent = '正在读取图片指令…';
      try {
        const result = await api('layered-portrait/import/scan?' + new URLSearchParams(item.at));
        if (sequence !== token || !dialog.open) return;
        frames = result.frames;
        frame.innerHTML = frames.map(row => `<option value="${row.key}">${row.trail.length ? `公共事件 ${row.trail.join(' → ')} · ` : ''}第 ${row.line} 条 · ${row.layers.length} 层${row.kind ? ' · ' + esc(row.kind) : ''}</option>`).join('');
        if (frames.length) {
          const score = row => row.layers.filter(layer => !layer.issue).reduce((n, layer) => n + (layer.suggested ? 3 : 1), 0);
          frame.value = frames.reduce((best, row) => score(row) >= score(best) ? row : best).key;
        }
        notice.textContent = [...(frames.length ? [] : ['这个事件没有可提取的固定位置 PNG。']), ...result.notices].join(' ');
        showFrame();
      } catch (e) {
        if (sequence === token && dialog.open) { notice.textContent = ''; error.textContent = e.message; }
      }
    }
    function filter() {
      const old = source.value, term = query.value.trim().toLowerCase();
      const choices = sources.map((row, i) => ({ row, i })).filter(({ row }) => !term || [row.label, ...row.pictures].some(s => s.toLowerCase().includes(term)));
      source.innerHTML = choices.map(({ row, i }) => `<option value="${i}">${esc(row.label)} · ${row.pictures.length} 张图${row.related ? ' · 匹配人物名' : ''}</option>`).join('');
      if (choices.some(({ i }) => String(i) === old)) { source.value = old; return; }
      scan();
    }
    $('[data-cancel]', dialog).onclick = () => done(null);
    source.onchange = scan; query.oninput = filter; frame.onchange = showFrame;
    list.onchange = draw;
    form.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled || !selected) return;
      busy = true; source.disabled = frame.disabled = query.disabled = true; error.textContent = ''; draw();
      try {
        const result = await api('layered-portrait/import', { actor: actor.id, at: sources[Number(source.value)].at, frame: selected.key, mapping: mapping() });
        done(result.layout);
      } catch (e) { error.textContent = e.message; }
      finally { busy = false; source.disabled = frame.disabled = query.disabled = false; draw(); }
    };
    filter();
  });
}
