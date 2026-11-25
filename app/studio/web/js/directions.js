'use strict';

async function diagonalSheetDialog(name, current) {
  const { sheets } = await api('sheets?sub=characters');
  const choices = sheets.filter(sheet => sheet.name !== name && sheet.big === isBigSheet(name));
  return openDialog(`<header><h3>斜向站姿</h3><button type="button" class="quiet small" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid"><label for="diagonalSheet">站姿图</label><select id="diagonalSheet">
      <option value="">沿用正方向</option>${choices.map(sheet => `<option value="${esc(sheet.name)}" ${sheet.name === current ? 'selected' : ''}>${esc(sheet.name)}</option>`).join('')}
    </select></div><p class="dim">先上传一张和「${esc(name)}」尺寸与排版相同的 PNG。每个小人的四行从上到下是左下、右下、左上、右上，使用中间一列。</p>
    <p class="dim">写 <code>#移动 守卫 转右上</code> 时显示对应站姿。沿地图走路仍用原行走图。</p><div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>取消</button><button type="button" class="primary" data-save>保存</button></footer>`, (d, done) => {
    $$('[data-x]', d).forEach(button => button.onclick = () => done(false));
    const save = $('[data-save]', d);
    save.onclick = async () => {
      save.disabled = true;
      try { await api('sheet/diagonal', { name, sheet: $('#diagonalSheet', d).value }); toast('已保存斜向站姿'); done(true); }
      catch (e) { $('[data-error]', d).textContent = e.message; }
      finally { save.disabled = false; }
    };
  });
}
