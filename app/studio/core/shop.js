'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { need } = require('../lib/util.js');
const { ensureRuntimePlugin } = require('./runtime-plugin.js');

const ENTRY = { name: 'RpgStudio_Shop', status: true, description: 'rpgStudio 条件商店和数量限制', parameters: {} };
const SOURCE = path.join(__dirname, '../web/shop-runtime.js');
const PLUGIN_FILE = `js/plugins/${ENTRY.name}.js`;
const KEY = 'rpgStudioShop';
const used = system => system?.[KEY] === true;
function activate(ctx, system) { ensureRuntimePlugin(ctx, { ENTRY, SOURCE }); system[KEY] = true; }

const titles = ['物品', '武器', '防具'], kinds = ['item', 'weapon', 'armor'];
const operators = ['=', '>=', '<=', '>', '<', '!='];
const shopStart = /^[#＃]\s*商店(?:\s+(只买))?\s*$/;
const shopEnd = /^[#＃]\s*(?:商店结束|结束商店|结束)\s*$/;
const scriptHead = 'RpgStudioShop.open(';
const command = (code, ...parameters) => ({ code, indent: 0, parameters });
const MAX_PURCHASES = 99999999;
const validLimit = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_PURCHASES;
function encodeShop({ buyOnly, goods, stockId }) {
  const rows = goods.map(({ kind, id, price, currency, conditions, purchaseLimit }) => ({ kind, id, price, currency, conditions, purchaseLimit }));
  return scriptHead + JSON.stringify({ buyOnly, goods: rows, stockId }) + ');';
}

function readShop(command) {
  const text = command?.parameters?.[0];
  if (command?.code !== 355 || typeof text !== 'string' || !text.startsWith(scriptHead) || !text.endsWith(');')) return null;
  try {
    const data = JSON.parse(text.slice(scriptHead.length, -2));
    if (!data || typeof data.buyOnly !== 'boolean' || !Array.isArray(data.goods)) return null;
    if (data.stockId !== undefined && (typeof data.stockId !== 'string' || !/^[\w:-]{1,120}$/.test(data.stockId))) return null;
    const id = value => Number.isSafeInteger(value) && value > 0;
    const validCondition = p => Array.isArray(p) && id(p[1]) && (p[0] === 0 && [0, 1].includes(p[2]) ||
      p[0] === 1 && p[2] === 0 && Number.isSafeInteger(p[3]) && operators[p[4]]);
    const valid = data.goods.length && data.goods.every(row => row && [0, 1, 2].includes(row.kind) && id(row.id) &&
      (row.currency === undefined || id(row.currency)) && (row.price === undefined || Number.isSafeInteger(row.price) && row.price >= 0 && row.price <= 99999999) &&
      (row.purchaseLimit === undefined || validLimit(row.purchaseLimit)) &&
      (row.conditions === undefined || Array.isArray(row.conditions) && row.conditions.length && row.conditions.every(g => Array.isArray(g) && g.length && g.every(validCondition))));
    return valid ? data : null;
  } catch { return null; }
}

function carryStockId(target, source) {
  const next = readShop(target), previous = readShop(source);
  if (next && previous?.stockId) target.parameters[0] = encodeShop({ ...next, stockId: previous.stockId });
}

function sameShop(a, b) {
  const left = readShop(a), right = readShop(b);
  return !!(left && right && encodeShop(left) === encodeShop(right));
}

function assignStockIds(list, scope, ids) {
  const prefix = scope + ':';
  for (const command of list || []) {
    const shop = readShop(command);
    if (!shop || (!shop.stockId && !shop.goods.some(row => row.purchaseLimit))) continue;
    if (!shop.stockId?.startsWith(prefix) || ids.has(shop.stockId)) {
      shop.stockId = prefix + randomUUID();
      command.parameters[0] = encodeShop(shop);
    }
    ids.add(shop.stockId);
  }
}

function readBlock(lines, { buyOnly, ref, conditions }) {
  const goods = [], seen = new Set();
  const amount = value => {
    const price = Number(value);
    need(Number.isSafeInteger(price) && price >= 0 && price <= 99999999, '商品价格需在 0～99999999 内');
    return price;
  };
  for (const line of lines) {
    const product = /^[#＃]?\s*(物品|武器|防具)\s*(.+)$/.exec(line);
    if (product) {
      const kind = titles.indexOf(product[1]), id = ref(product[2].trim(), kinds[kind]);
      const key = `${kind}:${id}`;
      need(!seen.has(key), '商店中同一个商品只能列一次');
      seen.add(key);
      goods.push({ kind, id });
      continue;
    }
    const row = goods.at(-1);
    need(row, '请先写商品，例如 #物品 回复药');
    const gold = /^[#＃]\s*金币\s*(\d+)\s*(?:[GgＧｇ])?$/.exec(line);
    const variable = /^[#＃]\s*变量\s*(.+)$/.exec(line);
    const limit = /^[#＃]\s*(?:限购|最多购买)\s*(\d+)\s*个?$/.exec(line);
    const condition = /^[#＃]\s*(?:条件|如果)(?=[\s:：（(\[【])[\s:：]*(.+)$/.exec(line);
    if (gold || variable) {
      need(row.price === undefined && row.currency === undefined, '每件商品只能设置一种价格');
      if (gold) row.price = amount(gold[1]);
      else {
        const value = variable[1].trim();
        const cost = /^(.+?)\s+(\d+)$/.exec(value);
        row.currency = ref(cost ? cost[1] : value, 'var');
        if (cost) row.price = amount(cost[2]);
      }
    } else if (limit) {
      need(row.purchaseLimit === undefined, '每件商品只能写一次限购数量');
      const count = Number(limit[1]);
      need(validLimit(count), `限购数量需在 1～${MAX_PURCHASES} 内`);
      row.purchaseLimit = count;
    } else if (condition) {
      need(!row.conditions, '同一商品的多个条件用「并且」「或者」连接');
      row.conditions = conditions(condition[1]);
    } else throw new Error('商店内可以写商品、#金币 100G、#变量 代币 100、#限购 1 或 #条件 开关 商店开放 开');
  }
  need(goods.length > 0 && goods.length <= 99, '商店要有 1～99 个商品');
  if (goods.some(row => row.conditions || row.currency || row.purchaseLimit)) return [command(355, encodeShop({ buyOnly, goods }))];
  return goods.map((row, i) => command(i ? 605 : 302, row.kind, row.id, row.price == null ? 0 : 1, row.price ?? 0, ...(!i ? [buyOnly] : [])));
}

function formatShop({ goods, buyOnly }, ref) {
  const out = ['#商店' + (buyOnly ? ' 只买' : '')];
  for (const row of goods) {
    if (!titles[row.kind]) return '';
    out.push('#' + titles[row.kind] + ' ' + ref(kinds[row.kind], row.id));
    if (row.currency) out.push('#变量 ' + row.currency + (row.price == null ? '' : ' ' + row.price));
    else if (row.price != null) out.push('#金币 ' + row.price + 'G');
    if (row.purchaseLimit) out.push('#限购 ' + row.purchaseLimit);
    if (row.conditions) {
      const text = row.conditions.map(group => group.map(p => p[0] === 0
        ? `开关 ${p[1]} ${p[2] ? '关' : '开'}` : `变量 ${p[1]} ${operators[p[4]]} ${p[3]}`).join(' 并且 ')).join(' 或者 ');
      out.push('#条件 ' + text);
    }
  }
  return [...out, '#商店结束'].join('\n');
}

module.exports = { ENTRY, PLUGIN_FILE, SOURCE, used, activate, shopStart, shopEnd, readShop, carryStockId, sameShop, assignStockIds, readBlock, formatShop };
