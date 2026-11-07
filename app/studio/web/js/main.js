'use strict';
// 启动：绑定顶栏 / 左栏，然后读工程、画页面
// ---------- 启动 ----------
$$('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#navq').addEventListener('input', drawNav);
$('#setBtn').onclick = settingsDialog;
$('#navToggle').onclick = () => document.body.classList.toggle('navopen');
document.addEventListener('click', e => { if (document.body.classList.contains('navopen') && !e.target.closest('#nav') && !e.target.closest('#navToggle')) document.body.classList.remove('navopen'); });
// 启动失败时给出提示，别一直停在「正在读取工程…」
boot().catch(e => {
  const m = $('#main');
  if (m) m.innerHTML = `<div class="page"><div class="err">打不开：${esc(e && e.message || e)}</div><a href="#/projects">回到选择游戏</a></div>`;
  if (window.console) console.error(e);
});
