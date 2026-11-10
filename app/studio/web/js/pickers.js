'use strict';
// 插入用的选择器（编辑框、新建场景、剧情进度里的「插入 …」按钮）：
//   选图（mountPicturePicker / pickDialog）、在地图上点格子（mountMapPicker）、
//   传送到哪里（transferDialog → transferLine）、场景里换谁来演（asDialog）、谁（whoDialog）
// 通用的弹窗（openDialog / chooseDialog / promptDialog）、lookup 在 base.js
function pictureFolders(names) {
  const folders = new Set();
  for (const name of names) {
    let folder = '';
    for (const part of name.split('/').slice(0, -1)) {
      folder = folder ? folder + '/' + part : part;
      folders.add(folder);
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// 新建场景和改台词共用一套选图，插入时保留图片的完整相对路径。
function mountPicturePicker(box, names, onPick) {
  const rank = n => n.startsWith('导入/') ? 0 : n.includes('/') ? 2 : 1;
  const ordered = [...names].sort((a, b) => rank(a) - rank(b));
  const pageSize = 120;
  let page = 0;
  box.innerHTML = `<div class="picture-filters">
    <select aria-label="按文件夹筛选"><option value="">全部文件夹</option><option value="/">根目录</option>${pictureFolders(names).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
    <input type="search" aria-label="搜索图片" placeholder="搜索图片名称">
  </div><div class="picture-grid"></div>
  <div class="picture-pages" hidden>
    <button type="button" class="small" data-prev>上一页</button><span class="dim" aria-live="polite"></span><button type="button" class="small" data-next>下一页</button>
  </div>`;
  const folder = $('select', box), query = $('input', box);
  const grid = $('.picture-grid', box), pages = $('.picture-pages', box);
  const prev = $('[data-prev]', box), next = $('[data-next]', box);
  function draw() {
    const q = query.value.trim().toLowerCase();
    const dir = folder.value;
    const matches = ordered.filter(n => {
      const inFolder = !dir || (dir === '/' ? !n.includes('/') : n.startsWith(dir + '/'));
      return inFolder && n.toLowerCase().includes(q);
    });
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    const current = matches.slice(page * pageSize, (page + 1) * pageSize);
    grid.innerHTML = current.map(n => `<button type="button" data-picture="${esc(n)}" title="${esc(n)}"><img loading="lazy" src="${img('pictures', n)}" alt=""><span>${esc(n)}</span></button>`).join('') || '<div class="dim">没有符合的图片</div>';
    grid.scrollTop = 0;
    pages.hidden = totalPages === 1;
    $('span', pages).textContent = `第 ${page + 1} / ${totalPages} 页 · ${matches.length} 张`;
    prev.disabled = page === 0;
    next.disabled = page + 1 === totalPages;
  }
  folder.onchange = query.oninput = () => { page = 0; draw(); };
  prev.onclick = () => { page--; draw(); };
  next.onclick = () => { page++; draw(); };
  grid.onclick = e => {
    const button = e.target.closest('[data-picture]');
    if (button) onPick(button.dataset.picture);
  };
  draw();
  query.focus();
}

// 从列表里挑一个（图片名 / 角色名）
async function pickDialog(title, path, isImage = false) {
  let names;
  try { const r = await api(path); names = r.names || (r.rows || []).filter(x => x.name).map(x => x.name); } catch (e) { toast(e.message, true); return null; }
  if (isImage) {
    return openDialog(`<header><h3>${esc(title)}</h3><button class="quiet small" data-x>关闭</button></header><div class="dbody"><div class="picture-picker"></div></div>`,
      (d, done) => {
        $('[data-x]', d).onclick = () => done(null);
        mountPicturePicker($('.picture-picker', d), names, done);
      });
  }
  return chooseDialog(title, names);
}

// 把一张地图画进指定的框里：点一下拿格子坐标（传送选目的地用）
//   和地图页同一套画法（TM.drawSpot + 图块集），事件画成小方框，鼠标跟着走
async function mountMapPicker(box, mapId, onPick) {
  box.innerHTML = '<div class="loading">正在读取地图…</div>';
  const [m, tiles] = await Promise.all([api('map?id=' + mapId), api('maptiles?id=' + mapId)]);
  const names = (tiles.tileset && tiles.tileset.names) || [];
  const sheets = await Promise.all(names.map(loadTileSheet));
  const w = m.width, h = m.height;
  const data = tiles.data.slice(0, w * h * 6);
  while (data.length < w * h * 6) data.push(0);
  const flags = (tiles.tileset && tiles.tileset.flags) || [];
  const C = Math.max(8, Math.min(28, Math.floor(720 / Math.max(w, h))));
  const W = w * C, H = h * C;
  box.innerHTML = `<div class="mpkwrap"><div class="mpkstack" style="width:${W}px;height:${H}px">
      <canvas class="mpk" width="${W}" height="${H}"></canvas><canvas class="mpkover" width="${W}" height="${H}"></canvas>
    </div></div>`;
  const cv = $('.mpk', box), ov = $('.mpkover', box);
  const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x * C, dy = y * C;
    ctx.fillStyle = '#080b10'; ctx.fillRect(dx, dy, C, C);
    TM.drawSpot(ctx, sheets, flags, data, w, h, x, y, dx, dy, C);
  }
  let cur = null, hov = null;
  const paint = () => {
    octx.clearRect(0, 0, W, H);
    for (const e of (m.events || [])) {
      if (!e) continue;
      octx.strokeStyle = 'rgba(255,190,90,.55)'; octx.lineWidth = 1;
      octx.strokeRect(e.x * C + 1.5, e.y * C + 1.5, Math.max(1, C - 3), Math.max(1, C - 3));
    }
    if (hov) { octx.fillStyle = 'rgba(141,156,245,.16)'; octx.fillRect(hov.x * C, hov.y * C, C, C); }
    if (cur) {
      octx.fillStyle = 'rgba(141,156,245,.34)'; octx.fillRect(cur.x * C, cur.y * C, C, C);
      octx.strokeStyle = '#8d9cf5'; octx.lineWidth = 2; octx.strokeRect(cur.x * C + 1, cur.y * C + 1, C - 2, C - 2);
    }
  };
  paint();
  const at = e => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / w)), y = Math.floor((e.clientY - r.top) / (r.height / h));
    return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
  };
  cv.onmousemove = e => { hov = at(e); paint(); };
  cv.onmouseleave = () => { hov = null; paint(); };
  cv.onclick = e => { const c = at(e); if (!c) return; cur = c; paint(); onPick(c, false); };
  cv.ondblclick = e => { const c = at(e); if (!c) return; cur = c; paint(); onPick(c, true); };
}

// 传送：挑地图（默认就是这张图），直接在地图上点要去的格子 → { id, name, x, y }
// 传送到哪里：选地图、在地图上点格子；返回 { id, name, x, y, dir, who, steps }，用 transferLine() 变成一行
//   o.scene = 在场景里：还能选「谁来演」和「到了以后」（场景播完自动回到原来的地方、换回主角）；场景外只有主角自己
async function transferDialog(defaultMapId, o = {}) {
  const [maps, actors] = await Promise.all([lookup('map').catch(() => []), o.scene ? lookup('actor').catch(() => []) : Promise.resolve([])]);
  if (!maps.length) { toast('这个工程里还没有地图', true); return null; }
  let mapId = Number(defaultMapId) || 0;
  if (!maps.some(m => m.id === mapId)) mapId = maps[0].id;
  let picked = null, name = '';
  // 编辑框里写地图名：名字唯一才写名字，不然写编号（跟服务端的 refText 一个规矩）
  const ref = id => {
    const m = maps.find(x => x.id === id), n = String((m && m.name) || '').trim();
    return n && !/^\d+$/.test(n) && maps.filter(x => String(x.name || '').trim() === n).length === 1 ? n : String(id);
  };
  const names = actors.map(a => String(a.name || '').trim()).filter(Boolean);
  return openDialog(`<header><h3>${o.scene ? '场景里传送到哪里' : '传送到哪里'}</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="fgrid">
        <label for="tpmap">地图</label><select id="tpmap">${maps.map(m => `<option value="${m.id}" ${m.id === mapId ? 'selected' : ''}>${m.id} ${esc(m.name || '（没名字）')}</option>`).join('')}</select>
        ${o.scene ? `<label for="tpwho">谁来演</label><select id="tpwho"><option value="">主角（不换人）</option>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select>` : ''}
        <label for="tpdir">到了朝</label><select id="tpdir"><option value="">不变</option>${['上', '下', '左', '右'].map(d => `<option>${d}</option>`).join('')}</select>
        ${o.scene ? '<label for="tpsteps">到了以后</label><input id="tpsteps" placeholder="可以不写；比如 前进3 或 下2 转身">' : ''}
      </div>
      <div class="fnote">${o.scene ? '场景里的传送只在这个场景里算数：场景播完，主角自动回到进场景前的地方、换回原来的样子。' : '主角传送过去（场景外的传送就是主角自己）。'}</div>
      <div class="tpbox" id="tpbox"></div>
    </div>
    <footer><span class="sp"></span><span class="dim" id="tphint">在地图上点一下要去的格子</span><button data-x>取消</button><button class="primary" data-ok disabled>就是这一格</button></footer>`,
    (d, done) => {
      d.classList.add('dlg-wide');
      d.addEventListener('close', () => d.classList.remove('dlg-wide'), { once: true });
      const sel = $('#tpmap', d), box = $('#tpbox', d), ok = $('[data-ok]', d), hint = $('#tphint', d);
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      const val = id => { const el = $(id, d); return el ? el.value.trim() : ''; };
      const fire = () => { if (picked) done({ id: mapId, name: ref(mapId), x: picked.x, y: picked.y, dir: val('#tpdir'), who: val('#tpwho'), steps: val('#tpsteps') }); };
      ok.onclick = fire;
      const load = async () => {
        mapId = Number(sel.value);
        name = (maps.find(m => m.id === mapId) || {}).name || '';
        picked = null; ok.disabled = true; hint.textContent = '在地图上点一下要去的格子';
        try {
          await mountMapPicker(box, mapId, (c, dbl) => {
            picked = c; ok.disabled = false;
            hint.textContent = (name || '地图 ' + mapId) + ' (' + c.x + ', ' + c.y + ')';
            if (dbl) fire();
          });
        } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      sel.onchange = load;
      load();
    }).then(v => v || null);
}
const transferLine = t => '#传送 ' + (t.who ? t.who + ' ' : '') + t.name + ' ' + t.x + ' ' + t.y + (t.dir ? ' 朝' + t.dir : '') + (t.steps ? ' ' + t.steps.replace(/\s+/g, ' ') : '');

// 场景里换谁来演（#扮演）：主角（换回来）/ 数据库里的角色 / 不是角色的人（要写行走图）
async function asDialog() {
  const actors = await lookup('actor').then(rows => rows.map(a => String(a.name || '').trim()).filter(Boolean)).catch(() => []);
  const BACK = '主角（换回来）', OTHER = '不是角色的人…';
  const pick = await chooseDialog('扮演：场景里主角的小人换成谁（场景播完自动换回）', [BACK, ...actors, OTHER]);
  if (!pick) return null;
  if (pick === BACK) return '#扮演 主角';
  if (pick !== OTHER) return '#扮演 ' + pick;
  const v = await promptDialog('扮演不是角色的人', '名字 行走图名 编号（比如：路人 People1 3）', '');
  return v ? '#扮演 ' + v.trim().replace(/\s+/g, ' ') : null;
}

// 谁：主角 / 本事件 /（飘字还有画面）/ 人物 / 手动输入
async function whoDialog(title, extra = []) {
  const actors = await lookup('actor').then(rows => rows.map(a => a.name).filter(Boolean)).catch(() => []);
  const MANUAL = '（手动输入…）';
  const pick = await chooseDialog(title, [...extra, '主角', '本事件', ...actors, MANUAL]);
  if (!pick) return null;
  if (pick !== MANUAL) return pick;
  return promptDialog(title, '名字（角色名 / 地图上事件的名字）', '');
}
