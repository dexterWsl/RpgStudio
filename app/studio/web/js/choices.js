'use strict';
// 选项条件（阅读视图里「选了 …」旁边的「＋条件 / 条件」按钮）
//   填的是「要满足什么才能选 / 才显示」；服务端（routes/events.js choice/cond）取反存成插件写法：
//   <<[…]>> = 什么时候灰掉，(([…])) = 什么时候不显示（core/choicecond.js）
//   这里填的是「要满足什么」；存的时候服务端取反写成插件的标记（<<[…]>> = 什么时候灰掉，(([…])) = 什么时候不显示）
//   条件写法：s[3] 开关开 / !s[3] 开关关 / v[65]>=70 变量比较（右边也能写 v[4]、g 金币）/ i[5] 有物品 / p[3] 角色在队伍；
//   几条之间是「并且」（逗号）；「任意一个」用分号
function ccParse(cond) {
  const s = String(cond || '').trim();
  if (!s) return [];
  if (s.includes(';')) return [{ type: 'raw', text: s }];
  return s.split(',').map(x => x.trim()).filter(Boolean).map(x => {
    let m;
    if ((m = /^(!?)s\[(\d+)\]$/.exec(x))) return { type: 'switch', id: Number(m[2]), off: !!m[1] };
    if ((m = /^v\[(\d+)\](<=|>=|!=|=|<|>)(-?\d+|v\[\d+\]|g)$/.exec(x))) return { type: 'var', id: Number(m[1]), op: m[2], value: m[3] };
    if ((m = /^(!?)i\[(\d+)\]$/.exec(x))) return { type: 'item', id: Number(m[2]), off: !!m[1] };
    return { type: 'raw', text: x };
  });
}
function ccBuild(rows) {
  return rows.map(r => r.type === 'switch' ? (r.off ? '!' : '') + 's[' + r.id + ']'
    : r.type === 'var' ? 'v[' + r.id + ']' + r.op + String(r.value == null ? '' : r.value).replace(/\s+/g, '')
      : r.type === 'item' ? (r.off ? '!' : '') + 'i[' + r.id + ']'
        : String(r.text || '').replace(/\s+/g, '')).filter(Boolean).join(',');
}
const CC_CMP = { '<=': '≤', '>=': '≥', '!=': '≠' };

// o.local = 不直接存盘，返回 { lockNeed, hideNeed }（规范模式里改的是编辑框的文字，跟别的修改一起保存）
async function choiceCondDialog(at, line, label, cond, o = {}) {
  const [sws, vrs, its] = await Promise.all([lookup('switch'), lookup('var'), lookup('item')]);
  const cur = cond || {};
  // 两种条件可以同时有：这里一次改一种，另一种原样留着
  let mode = cur.lockNeed ? 'lock' : cur.hideNeed ? 'hide' : 'lock';
  const need = { lock: cur.lockNeed || '', hide: cur.hideNeed || '' };
  let rows = ccParse(need[mode]);
  const opt = (list, id) => (list || []).map(x => `<option value="${x.id}" ${Number(id) === x.id ? 'selected' : ''}>${x.id} ${esc(x.name || '')}</option>`).join('');
  const del = '<button type="button" class="quiet small" data-del title="去掉这条">×</button>';
  const rowHtml = (r, i) => {
    if (r.type === 'switch') return `<div class="ccrow" data-i="${i}"><span class="cct">开关</span><select data-f="id">${opt(sws, r.id)}</select>
      <select data-f="on"><option value="1" ${r.off ? '' : 'selected'}>是开的</option><option value="0" ${r.off ? 'selected' : ''}>是关的</option></select>${del}</div>`;
    if (r.type === 'var') return `<div class="ccrow" data-i="${i}"><span class="cct">变量</span><select data-f="id">${opt(vrs, r.id)}</select>
      <select data-f="op">${['>=', '>', '=', '!=', '<=', '<'].map(o => `<option value="${o}" ${r.op === o ? 'selected' : ''}>${CC_CMP[o] || o}</option>`).join('')}</select>
      <input data-f="value" value="${esc(r.value == null ? '' : r.value)}" placeholder="数字 / v[12] / g">${del}</div>`;
    if (r.type === 'item') return `<div class="ccrow" data-i="${i}"><span class="cct">物品</span><select data-f="id">${opt(its, r.id)}</select>
      <select data-f="on"><option value="1" ${r.off ? '' : 'selected'}>有</option><option value="0" ${r.off ? 'selected' : ''}>没有</option></select>${del}</div>`;
    return `<div class="ccrow" data-i="${i}"><span class="cct">自己写</span><input data-f="text" value="${esc(r.text || '')}" placeholder="比如 !s[12] 或 v[65]>=v[4]">${del}</div>`;
  };
  const r = await openDialog(`<header><h3>选项条件 — 「${esc(String(label || '').trim())}」</h3><button class="quiet small" data-x>关闭</button></header>
    <div class="dbody">
      <div class="seg" id="ccMode">
        <button type="button" data-cm="lock">满足才能选（不然是灰的）</button>
        <button type="button" data-cm="hide">满足才显示</button>
      </div>
      <div class="ccrows" id="ccRows"></div>
      <div class="scchips sctools">
        <button type="button" class="small" data-add="switch">＋ 开关</button>
        <button type="button" class="small" data-add="var">＋ 变量</button>
        <button type="button" class="small" data-add="item">＋ 物品</button>
        <button type="button" class="small" data-add="raw">＋ 自己写</button>
      </div>
      <div class="fnote" id="ccPrev"></div>
      <div id="ccErr"></div>
    </div>
    <footer><button type="button" class="quiet" data-clear>去掉这种条件</button><span class="sp"></span><button data-x>取消</button><button class="primary" data-ok>确定</button></footer>`,
    (d, done) => {
      const box = $('#ccRows', d), prev = $('#ccPrev', d);
      const sync = () => {
        need[mode] = ccBuild(rows);
        const other = mode === 'lock' ? need.hide : need.lock;
        prev.innerHTML = (rows.length ? `下面几条${rows.length > 1 ? '都' : ''}满足时，这个选项${mode === 'lock' ? '才能选；不满足时还在，但是灰的' : '才会出现；不满足时整个不显示'}。` : `<span class="dim">还没加条件：这个选项${mode === 'lock' ? '一直能选' : '一直显示'}。</span>`)
          + (other ? `<br><span class="dim">另外还设了「${mode === 'lock' ? '满足才显示' : '满足才能选'}」，保存时一起保留。</span>` : '');
      };
      const draw = () => {
        box.innerHTML = rows.map(rowHtml).join('') || '<div class="dim">点下面的「＋ 开关 / ＋ 变量 / ＋ 物品」加条件</div>';
        $$('#ccMode button', d).forEach(b => b.classList.toggle('on', b.dataset.cm === mode));
        $$('.ccrow', box).forEach(el => {
          const i = Number(el.dataset.i);
          $$('[data-f]', el).forEach(ctrl => ctrl.addEventListener(ctrl.tagName === 'SELECT' ? 'change' : 'input', () => {
            const f = ctrl.dataset.f;
            if (f === 'id') rows[i].id = Number(ctrl.value);
            else if (f === 'on') rows[i].off = ctrl.value === '0';
            else rows[i][f] = ctrl.value;
            sync();
          }));
          const x = $('[data-del]', el);
          if (x) x.onclick = () => { rows.splice(i, 1); draw(); };
        });
        sync();
      };
      $$('#ccMode button', d).forEach(b => b.onclick = () => { sync(); mode = b.dataset.cm; rows = ccParse(need[mode]); draw(); });
      $$('[data-add]', d).forEach(b => b.onclick = () => {
        const k = b.dataset.add;
        rows.push(k === 'switch' ? { type: 'switch', id: (sws[0] || {}).id || 1, off: false }
          : k === 'var' ? { type: 'var', id: (vrs[0] || {}).id || 1, op: '>=', value: '1' }
            : k === 'item' ? { type: 'item', id: (its[0] || {}).id || 1, off: false }
              : { type: 'raw', text: '' });
        draw();
      });
      $('[data-clear]', d).onclick = () => { rows = []; draw(); };
      $$('[data-x]', d).forEach(b => b.onclick = () => done(null));
      $('[data-ok]', d).onclick = async () => {
        sync();
        if (o.local) { done({ need: { lockNeed: need.lock, hideNeed: need.hide } }); return; }
        try { await api('choice/cond', { at, line, lockNeed: need.lock, hideNeed: need.hide }); done({ ok: '已保存选项条件' }); }
        catch (e) { $('#ccErr', d).innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
      draw();
    });
  if (o.local) return r && r.need ? r.need : null;
  if (r && r.ok) { toast(r.ok); render(); }
}
document.addEventListener('click', e => {
  const b = e.target.closest('.cndbtn');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { choiceCondDialog(JSON.parse(b.dataset.cat), Number(b.dataset.cline), b.dataset.clabel || '', JSON.parse(b.dataset.ccond || '{}')); } catch (err) { toast(err.message, true); }
});

