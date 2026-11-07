'use strict';
// 工程设置：游戏配置、剧情图片编号段
async function settingsDialog() {
  const P = S.project = await api('project');
  const can = P.canConfigure;
  const r = await openDialog(`<header><h3>工程设置</h3></header>
    <div class="dbody">
      <div class="fgrid">
        <span class="dim">游戏</span><span>${esc(P.title)}（${esc(P.engine)}${P.engineVersion ? ' ' + esc(P.engineVersion) : ''}，从 ${esc(P.engineFrom || '数据')} 认出来的）</span>
        <span class="dim">数据目录</span><span style="word-break:break-all">${esc(P.dataDir)}</span>
        <span class="dim">对话框样式</span><span>新对话框用「${['窗口', '暗化', '透明'][P.messageStyle.background]} / ${['上', '中', '下'][P.messageStyle.position]}」，跟原作里最常见的一样</span>
        <label for="s_prof">游戏配置</label>
        <select id="s_prof" ${can ? '' : 'disabled'}><option value="">自动识别（现在是：${esc(P.profile.label)}）</option>${P.profiles.map(p => `<option value="${p.id}" ${P.profile.chosen === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
      </div>
      <div class="fnote">配置决定这个游戏的约定：新图片用哪段编号、「#清图」怎么关，以及界面上的提示。认不出来的游戏用「通用」。</div>
      <div class="fgrid">
        <span>新图片编号</span><span class="ins" style="display:flex;gap:6px;align-items:center"><input id="s_min" type="number" class="num" style="width:90px" value="${P.pictures.min}" ${can ? '' : 'disabled'}><span>~</span><input id="s_max" type="number" class="num" style="width:90px" value="${P.pictures.max}" ${can ? '' : 'disabled'}></span>
        <span>只写 #清图</span><select id="s_clear" ${can ? '' : 'disabled'}>
          <option value="shown" ${P.pictures.clearAll === 'shown' ? 'selected' : ''}>关掉这一页自己显示的图（不碰别的编号）</option>
          <option value="script" ${P.pictures.clearAll === 'script' ? 'selected' : ''}>用一条脚本关掉整段编号的图</option>
        </select>
      </div>
      <div class="fnote">${P.pictures.custom ? '现在用的是自定义的图片设置。' : `现在用的是「${esc(P.profile.label)}」配置的默认值（${P.pictures.fromProfile.min}~${P.pictures.fromProfile.max}）。`}界面图（菜单图标、遮罩等）占用的编号不要放进这个范围。</div>
      ${can ? '' : '<div class="locked">只有管理员能改工程设置。</div>'}
      <div id="sErr"></div>
    </div>
    <footer>${can && P.pictures.custom ? '<button class="quiet" data-reset>恢复配置默认值</button>' : ''}<span class="sp"></span><button data-x>关闭</button>${can ? '<button class="primary" data-ok>保存设置</button>' : ''}</footer>`,
    (d, done) => {
      $('[data-x]', d).onclick = () => done(null);
      const send = async body => { try { await api('settings', body); done(true); } catch (e) { $('#sErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
      if ($('[data-ok]', d)) $('[data-ok]', d).onclick = () => {
        const body = { profile: $('#s_prof', d).value };
        const pic = { min: Number($('#s_min', d).value), max: Number($('#s_max', d).value), clearAll: $('#s_clear', d).value };
        const same = pic.min === P.pictures.min && pic.max === P.pictures.max && pic.clearAll === P.pictures.clearAll;
        if (!same) body.pictures = pic;
        send(body);
      };
      if ($('[data-reset]', d)) $('[data-reset]', d).onclick = () => send({ pictures: null });
    });
  if (r) { toast('已保存设置'); location.reload(); }
}
