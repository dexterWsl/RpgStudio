'use strict';
// 游戏设置：标题、开始位置、标题画面、菜单、系统音效、窗口色调
async function viewSystem(main) {
  main.innerHTML = '<div class="loading">正在读取游戏设置…</div>';
  const v = await api('system');
  const opt = (list, sel, none = '（无）') => `<option value="">${none}</option>` + list.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  main.innerHTML = `<div class="page">
    <div class="titlebar"><h1>游戏设置</h1><span class="dim">标题、从哪开始、标题画面、菜单里有什么</span>
      <span class="sp"></span><button class="small" id="sysLaunch" title="在游戏文件夹里放一个「开始游戏.cmd」：不开编辑器，双击就能玩（用浏览器的单独窗口）">${v.launcher ? '更新双击启动器' : '做双击启动器'}</button><button class="small" id="sysPlay">▶ 试玩</button></div>
    <div class="card"><div class="fgrid">
      <label for="sTitle">游戏名</label><input id="sTitle" maxlength="60" value="${esc(v.title)}">
      <span>从哪开始</span><div class="folder-input"><select id="sMap">${v.maps.map(m => `<option value="${m.id}" ${m.id === v.start.map ? 'selected' : ''}>${m.id} ${esc(m.name)}</option>`).join('')}</select>
        <input id="sX" type="number" min="0" value="${v.start.x}" style="width:80px" aria-label="x"><input id="sY" type="number" min="0" value="${v.start.y}" style="width:80px" aria-label="y"></div>
      <label for="sT1">标题画面</label><div class="folder-input"><select id="sT1">${opt(v.images.titles1, v.title1)}</select><select id="sT2">${opt(v.images.titles2, v.title2, '（不叠图）')}</select></div>
      <label for="sBgm">标题音乐</label><select id="sBgm">${opt(v.audio.bgm, v.titleBgm, '（没有）')}</select>
      <span>标题上写游戏名</span><label class="switch"><input type="checkbox" id="sDraw" ${v.drawTitle ? 'checked' : ''}><span>标题图里已经画了字就关掉</span></label>
      <span>菜单里有</span><div class="imodes" style="flex-direction:row;flex-wrap:wrap;gap:4px 14px">${v.menu.map((m, i) => `<label class="switch"><input type="checkbox" data-menu="${i}" ${m.on ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('')}</div>
      <span>系统音效</span><div class="tsslots">${v.sounds.map((s, i) => `<label><span style="width:34px">${esc(s.label)}</span><select data-snd="${i}">${opt(v.audio.se, s.name, '（静音）')}</select></label>`).join('')}</div>
      <span>窗口色调</span><div class="folder-input">${['红', '绿', '蓝'].map((l, i) => `<label style="display:flex;gap:4px;align-items:center">${l}<input type="number" min="-255" max="255" data-tone="${i}" value="${v.windowTone[i]}" style="width:80px"></label>`).join('')}</div>
      <span>队伍跟在后面走</span><label class="switch"><input type="checkbox" id="sFol" ${v.followers ? 'checked' : ''}><span>队伍里的其他人跟着主角走</span></label>
    </div><div class="edbar"><button class="primary" id="sSave">保存</button></div></div>
  </div>`;
  $('#sysPlay').onclick = () => playGame({});
  $('#sysLaunch').onclick = async () => {
    try {
      const r = await api('system/launcher', {});
      toast(r.changed.length ? '已放好：' + r.cmd + '，双击就能玩' : '启动器已经是最新的：' + r.cmd);
      $('#sysLaunch').textContent = '更新双击启动器';
    } catch (e) { toast(e.message, true); }
  };
  $('#sSave').onclick = async () => {
    try {
      await api('system/update', {
        title: $('#sTitle').value,
        start: { map: Number($('#sMap').value), x: Number($('#sX').value), y: Number($('#sY').value) },
        title1: $('#sT1').value, title2: $('#sT2').value, titleBgm: $('#sBgm').value, drawTitle: $('#sDraw').checked,
        menu: $$('[data-menu]').map(c => c.checked),
        sounds: $$('[data-snd]').map(s => s.value),
        windowTone: $$('[data-tone]').map(i => Number(i.value) || 0),
        followers: $('#sFol').checked,
      });
      toast('游戏设置已保存');
      S.project = await api('project'); drawProjSwitch();
    } catch (e) { toast(e.message, true); }
  };
}
