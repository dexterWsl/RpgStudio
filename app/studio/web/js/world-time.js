'use strict';
const clockText = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
function clockMinutes(value, allowEnd = false) {
  const m = /^(\d\d?):(\d\d)$/.exec(String(value).trim());
  if (!m || Number(m[2]) >= 60 || Number(m[1]) > 24 || (Number(m[1]) === 24 && (!allowEnd || Number(m[2])))) throw new Error('时间请按 08:30 填写，结束时间可用 24:00');
  return Number(m[1]) * 60 + Number(m[2]);
}

async function worldClockDialog() {
  const r = await api('world-time');
  const c = r.clock;
  return openDialog(`<header><h3>世界时间</h3><button class="quiet small" type="button" data-x>关闭</button></header>
    <div class="dbody"><div class="fgrid">
      <label for="worldStart">新游戏开始时间</label><input id="worldStart" type="time" value="${clockText(c.start)}">
      <label for="worldRate">游戏内每分钟</label><div class="folder-input"><input id="worldRate" type="number" min="1" max="600" value="${c.secondsPerMinute}"><span>现实秒</span></div>
      <label for="worldDay">同步天数到变量</label><select id="worldDay">${valueOptions(r.variables, c.dayVariable, '不关联')}</select>
      <label for="worldMinute">同步当日分钟到变量</label><select id="worldMinute">${valueOptions(r.variables, c.minuteVariable, '不关联')}</select>
    </div><p class="dim">从第 1 天开始，地图上自由活动时计时，剧情、菜单和战斗中暂停。日程每天重复。08:00 对应当日第 480 分钟。</p>
    <div role="alert" data-error></div></div>
    <footer><span class="sp"></span><button type="button" data-x>关闭</button>${r.canWrite ? '<button type="button" class="primary" data-ok>保存世界时间</button>' : ''}</footer>`, (d, done) => {
    $$('[data-x]', d).forEach(b => b.onclick = () => done(false));
    const save = $('[data-ok]', d);
    if (!save) return;
    save.onclick = async () => {
      save.disabled = true;
      const error = $('[data-error]', d);
      error.textContent = '';
      try {
        await api('world-time/clock', { start: clockMinutes($('#worldStart', d).value), secondsPerMinute: Number($('#worldRate', d).value),
          dayVariable: Number($('#worldDay', d).value), minuteVariable: Number($('#worldMinute', d).value) });
        toast('已保存世界时间'); done(true);
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
  });
}

async function npcScheduleDialog(actor, name) {
  const r = await api('world-time?actor=' + actor);
  return openDialog(`<header><h3>${esc(name)}的日程</h3><button class="quiet small" type="button" data-x>关闭</button></header>
    <div class="dbody"><p class="dim">每个时段关联一个地图上的 NPC 事件。时段内沿用事件页原有的出现条件和台词。跨午夜可写 22:00 到 06:00。</p>
      <div class="folder-input"><button type="button" class="small" data-clock>世界时间</button><button type="button" class="small" data-add-slot>添加时段</button></div>
      <div class="npc-schedule"></div><div role="alert" data-error></div>
    </div><footer><span class="sp"></span><button type="button" data-x>取消</button>${r.canWrite ? '<button type="button" class="primary" data-ok>保存日程</button>' : ''}</footer>`, (d, done) => {
    const rows = $('.npc-schedule', d), add = $('[data-add-slot]', d), error = $('[data-error]', d);
    const events = new Map();
    const updateAdd = () => { add.disabled = !r.canWrite || rows.children.length >= 32; };
    const addSlot = row => {
      const el = document.createElement('div');
      el.className = 'schedule-slot';
      el.innerHTML = `<div class="fgrid"><label>开始时间</label><input data-start value="${clockText(row.start)}" maxlength="5" aria-label="开始时间">
        <label>结束时间</label><input data-end value="${clockText(row.end)}" maxlength="5" aria-label="结束时间">
        <label>地图</label><select data-map aria-label="地图">${valueOptions(r.maps, row.map, '选择地图')}</select>
        <label>地图上的事件</label><select data-event aria-label="地图上的事件"></select></div>
        ${r.canWrite ? '<button type="button" class="quiet small" data-remove-slot>移除时段</button>' : ''}`;
      rows.append(el);
      const map = $('[data-map]', el), select = $('[data-event]', el);
      const populate = async selected => {
        const id = Number(map.value);
        select.disabled = true;
        select.innerHTML = '<option value="0">' + (id ? '正在加载事件…' : '先选地图') + '</option>';
        if (!id) return;
        try {
          if (!events.has(id)) events.set(id, api('world-time/events?map=' + id).catch(e => { events.delete(id); throw e; }));
          const result = await events.get(id);
          if (!d.open || Number(map.value) !== id || !el.isConnected) return;
          const choices = result.events.map(e => ({ id: e.id, name: `${e.name} #${e.id}（${e.x}, ${e.y}）` }));
          select.innerHTML = valueOptions(choices, choices.some(e => e.id === selected) ? selected : 0, '选择事件');
          select.disabled = !r.canWrite;
          if (selected && !choices.some(e => e.id === selected)) error.textContent = '原日程地点的事件已移除，请重新选一个事件。';
        } catch (e) { if (d.open && Number(map.value) === id) error.textContent = e.message; }
      };
      map.onchange = () => populate(0);
      const remove = $('[data-remove-slot]', el);
      if (remove) remove.onclick = () => { el.remove(); updateAdd(); };
      if (!r.canWrite) $$('input, select', el).forEach(input => input.disabled = true);
      populate(row.event);
    };
    for (const row of r.schedules) addSlot(row);
    add.onclick = () => { addSlot({ start: 480, end: 1080, map: 0, event: 0 }); updateAdd(); };
    updateAdd();
    $$('[data-x]', d).forEach(b => b.onclick = () => done(false));
    $('[data-clock]', d).onclick = () => worldClockDialog().catch(e => { error.textContent = e.message; });
    const save = $('[data-ok]', d);
    if (!save) return;
    save.onclick = async () => {
      error.textContent = '';
      save.disabled = true;
      try {
        const schedule = [...rows.children].map(el => ({ start: clockMinutes($('[data-start]', el).value), end: clockMinutes($('[data-end]', el).value, true),
          map: Number($('[data-map]', el).value), event: Number($('[data-event]', el).value) }));
        await api('world-time/schedule', { actor, rows: schedule });
        toast('已保存人物日程'); done(true);
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
  });
}
