'use strict';
const { need, int } = require('../lib/util.js');
const ItemUse = require('../core/item-use.js');
const { MAX_ITEMS, readCap, stripCap, writeCap } = require('../core/inventory-cap.js');
const Shop = require('../core/shop.js');

const files = { item: 'Items.json', weapon: 'Weapons.json', armor: 'Armors.json' };
const effectCodes = { hp: 11, mp: 12, event: 44 };
const plainEffect = (effect, key) => effect.code === effectCodes[key] && effect.dataId === 0 && effect.value1 === 0;

function field(value, min, max, label) {
  const n = int(value, label + '要填整数');
  need(n >= min && n <= max, `${label}需在 ${min}～${max} 内`);
  return n;
}

function newRecord(id, kind) {
  const base = { id, name: '', iconIndex: 0, description: '', note: '', price: 0 };
  if (kind === 'item') return { ...base, animationId: 0, consumable: true, damage: { type: 0, elementId: 0, formula: '0', variance: 0, critical: false }, effects: [], hitType: 0, itypeId: 1, occasion: 0, repeats: 1, scope: 7, speed: 0, successRate: 100, tpGain: 0 };
  return { ...base, etypeId: 1, params: [0, 0, 0, 0, 0, 0, 0, 0], traits: [], ...(kind === 'weapon' ? { animationId: 0, wtypeId: 1 } : { atypeId: 1 }) };
}

module.exports = function (ctx) {
  const { project, where, opts } = ctx;
  const kindOf = value => { need(Object.hasOwn(files, value), '请选择物品、武器或防具'); return value; };
  const choices = key => (project.sys()[key] || []).flatMap((name, id) => id && name ? [{ id, name }] : []);
  return {
    get: {
      inventory(T, q) {
        const kind = kindOf(q('kind') || 'item');
        return { kind, rows: (project.read(files[kind]) || []).filter(row => row && row.id > 0).map(row => ({ id: row.id, name: row.name, iconIndex: row.iconIndex, price: row.price })), canWrite: !opts.readOnly };
      },
      'inventory/entry'(T, q) {
        const kind = kindOf(q('kind')), id = int(q('id') || 0);
        const entry = id ? (project.read(files[kind]) || [])[id] : newRecord(0, kind);
        need(entry, '找不到该条目');
        const events = project.read('CommonEvents.json') || [null];
        const nativeCalls = kind === 'item' ? (entry.effects || []).filter(effect => ItemUse.isOriginalCall(effect, entry, events)) : [];
        const use = kind === 'item' ? ItemUse.findUse(entry, events) : null;
        const analysis = use ? T.merger.analyzeList(use.list) : { text: '', editable: true };
        const effects = Object.fromEntries(Object.keys(effectCodes).map(key => {
          const matches = key === 'event' ? nativeCalls : (entry.effects || []).filter(e => plainEffect(e, key));
          return [key, { locked: matches.length > 1, value: key === 'event' ? matches[0]?.dataId || 0 : matches[0]?.value2 || 0 }];
        }));
        return { entry: { ...entry, note: stripCap(entry.note) }, maxItems: readCap(entry.note), maxItemsLimit: MAX_ITEMS, effects, engine: project.engine().name,
          useEffects: { text: analysis.text, editable: analysis.editable, event: use?.event.id || 0 },
          nativeCalls: nativeCalls.map(effect => ({ id: effect.dataId, name: project.name('ce', effect.dataId) })),
          types: kind === 'weapon' ? choices('weaponTypes') : choices('armorTypes'), slots: choices('equipTypes').filter(e => e.id !== 1),
          events: project.rows('ce').filter(r => r.name && !ItemUse.ownerOf(events[r.id])), animations: project.rows('animation').filter(r => r.name),
          uses: id ? T.xref.of(kind, id).map(r => ({ at: r.at, where: where(r.at), text: r.text })) : [],
          iconset: !!project.findImage('system', 'IconSet'), canWrite: !opts.readOnly };
      },
    },
    post: {
      'inventory/save'(T, b) {
        const kind = kindOf(b.kind), file = files[kind], id = int(b.id ?? 0);
        need(id >= 0, '编号不对');
        const name = String(b.name || '').trim(), description = String(b.description ?? ''), note = String(b.note ?? '');
        need(name && name.length <= 80 && !/[\r\n]/.test(name), '名称要在 1～80 字内');
        need(description.length <= 1000 && note.length <= 12000, '说明或备注太长');
        const price = field(b.price, 0, 99999999, '价格'), iconIndex = field(b.iconIndex, 0, 99999, '图标');
        const entries = kind === 'item' ? [file, 'CommonEvents.json'] : [file];
        const cap = b.maxItems === undefined ? readCap(project.read(file)?.[id]?.note) ?? readCap(note) : b.maxItems;
        const writeFiles = cap != null ? [...entries, 'System.json'] : entries;
        const output = T.store.edit(writeFiles, docs => {
          const db = docs[file] || [null];
          const newId = id || Math.max(db.length, 1);
          const entry = id ? db[id] : newRecord(newId, kind);
          need(entry, '找不到该条目');
          Object.assign(entry, { name, description, note: writeCap(note, cap), price, iconIndex });
          if (kind === 'item') {
            const events = docs['CommonEvents.json'] || [null];
            const use = ItemUse.findUse(entry, events);
            entry.itypeId = field(b.itypeId, 1, 4, '物品分类');
            entry.scope = field(b.scope, 0, project.engine().name === 'MV' ? 11 : 14, '使用目标');
            entry.occasion = field(b.occasion, 0, 3, '使用时机');
            need(typeof b.consumable === 'boolean', '请选择是否消耗');
            entry.consumable = b.consumable;
            const edits = b.effects || {};
            for (const key of Object.keys(effectCodes)) {
              if (edits[key] === undefined) continue;
              const value = field(edits[key], 0, 999999, key === 'event' ? '公共事件编号' : '回复量');
              if (key === 'event') need(!value || (project.has('ce', value) && !ItemUse.ownerOf(events[value])), '请选择已有的公共事件');
              const all = entry.effects ||= [];
              const matches = all.filter(e => key === 'event' ? ItemUse.isOriginalCall(e, entry, events) : plainEffect(e, key));
              need(matches.length <= 1, '已有多个同类效果，请保留原设定');
              if (matches.length && !value) all.splice(all.indexOf(matches[0]), 1);
              if (value) {
                const effect = { code: effectCodes[key], dataId: key === 'event' ? value : 0, value1: 0, value2: key === 'event' ? 0 : value };
                if (matches.length) all[all.indexOf(matches[0])] = effect;
                else all.push(effect);
              }
            }
            if (b.useEffects !== undefined || (use && edits.event !== undefined)) {
              ItemUse.saveUse(T, entry, events, use, b.useEffects, project.engine().name === 'MV');
              if (events.length > 1) docs['CommonEvents.json'] = events;
            }
          } else {
            const typeKey = kind === 'weapon' ? 'wtypeId' : 'atypeId';
            const typeList = choices(kind === 'weapon' ? 'weaponTypes' : 'armorTypes');
            const type = int(b.type);
            need(type === entry[typeKey] || typeList.some(r => r.id === type), '请选择装备分类');
            entry[typeKey] = type;
            if (kind === 'armor') {
              const slot = int(b.slot);
              need((id && entry.etypeId === slot) || choices('equipTypes').some(r => r.id === slot && slot !== 1), '请选择防具部位');
              entry.etypeId = slot;
            }
            need(Array.isArray(b.params) && b.params.length === 8, '装备要填写 8 项属性');
            entry.params = b.params.map(n => field(n, -999999, 999999, '装备属性'));
          }
          if (kind !== 'armor') {
            const animationId = int(b.animationId ?? 0);
            need(animationId === (entry.animationId || 0) || animationId === 0 || (kind === 'item' && animationId === -1) || project.has('animation', animationId), '找不到选中的动画');
            entry.animationId = animationId;
          }
          db[newId] = entry;
          docs[file] = db;
          if (cap !== null) Shop.activate(ctx, docs['System.json']);
          return newId;
        }, { create: entries });
        return { id: output.result };
      },
    },
  };
};
