/*:
 * @plugindesc rpgStudio 条件商店、购买限额和背包上限
 */
(function () {
  'use strict';

  function StudioShop() { this.initialize.apply(this, arguments); }
  StudioShop.prototype = Object.create(Scene_Shop.prototype);
  StudioShop.prototype.constructor = StudioShop;

  function product(row) {
    var table = [$dataItems, $dataWeapons, $dataArmors][row.kind];
    return table && table[row.id];
  }
  function balance(id) {
    return id ? Math.max(0, Math.floor(Number($gameVariables.value(id)) || 0)) : $gameParty.gold();
  }
  function matches(p) {
    if (p[0] === 0) return $gameSwitches.value(p[1]) === (p[2] === 0);
    var a = $gameVariables.value(p[1]), b = p[3];
    switch (p[4]) {
      case 0: return a === b;
      case 1: return a >= b;
      case 2: return a <= b;
      case 3: return a > b;
      case 4: return a < b;
      case 5: return a !== b;
      default: return false;
    }
  }
  function available(row) { return !row.conditions || row.conditions.some(function (g) { return g.every(matches); }); }
  function currency(row) { return row.currency && row.price != null ? row.currency : 0; }
  function unit(id) { return id ? ($dataSystem.variables[id] || ('变量 ' + id)) : TextManager.currencyUnit; }

  function customCap(item) {
    var n = Number(item && item.meta && item.meta.RpgStudioMaxItems);
    return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : 0;
  }
  var lossCaps = new WeakMap();
  var maxItems = Game_Party.prototype.maxItems;
  Game_Party.prototype.maxItems = function (item) {
    var loss = lossCaps.get(this);
    if (loss && loss.item === item) return loss.count;
    return customCap(item) || maxItems.call(this, item);
  };
  var gainItem = Game_Party.prototype.gainItem;
  Game_Party.prototype.gainItem = function (item, amount) {
    if (!customCap(item)) return gainItem.apply(this, arguments);
    var count = this.numItems(item);
    if (count <= this.maxItems(item)) return gainItem.apply(this, arguments);
    // 旧存档可能已经超过新上限。消费或卖出时只扣实际数量。
    if (amount >= 0) return;
    var previous = lossCaps.get(this);
    lossCaps.set(this, { item: item, count: count });
    try { return gainItem.apply(this, arguments); }
    finally { if (previous) lossCaps.set(this, previous); else lossCaps.delete(this); }
  };
  var nativeBuy = Scene_Shop.prototype.doBuy;
  Scene_Shop.prototype.doBuy = function (number) {
    var item = this._item;
    if (customCap(item) && (!Number.isInteger(number) || number < 1 || number + $gameParty.numItems(item) > $gameParty.maxItems(item))) return;
    return nativeBuy.call(this, number);
  };

  var maxDigits = Window_ShopNumber.prototype.maxDigits;
  Window_ShopNumber.prototype.maxDigits = function () {
    return Math.max(maxDigits.call(this), String(this._max || 0).length);
  };
  var numberWidth = Window_ItemList.prototype.numberWidth;
  if (numberWidth) Window_ItemList.prototype.numberWidth = function () {
    var digits = (this._data || []).reduce(function (max, item) { return Math.max(max, String($gameParty.numItems(item)).length); }, 2);
    return Math.max(numberWidth.call(this), this.textWidth(new Array(digits + 2).join('0')));
  };
  var drawItemNumber = Window_ItemList.prototype.drawItemNumber;
  Window_ItemList.prototype.drawItemNumber = function (item, x, y, width) {
    var count = $gameParty.numItems(item);
    if (count < 100 || !this.needsNumber()) return drawItemNumber.call(this, item, x, y, width);
    this.drawText(':', x, y, width - this.textWidth(String(count)), 'right');
    this.drawText(count, x, y, width, 'right');
  };

  function purchaseLog(shop) {
    if (!shop._stockId) return shop._localPurchases;
    var saved = $gameSystem._rpgStudioShopPurchases;
    return saved && saved[shop._stockId];
  }
  function productKey(row) { return row.kind + ':' + row.id; }
  function remaining(shop, row) {
    if (row.purchaseLimit == null) return Infinity;
    var log = purchaseLog(shop), bought = log ? log[productKey(row)] || 0 : 0;
    return Math.max(0, row.purchaseLimit - bought);
  }
  function record(shop, row, number) {
    if (row.purchaseLimit == null) return;
    var log = purchaseLog(shop);
    if (!log) {
      var saved = $gameSystem._rpgStudioShopPurchases || ($gameSystem._rpgStudioShopPurchases = {});
      log = saved[shop._stockId] = {};
    }
    var key = productKey(row);
    log[key] = (log[key] || 0) + number;
  }

  StudioShop.prototype.prepare = function (spec) {
    this._stockId = spec.stockId;
    this._localPurchases = {};
    this._offers = new Map();
    var goods = [];
    for (var i = 0; i < spec.goods.length; ++i) {
      var row = spec.goods[i], item = product(row);
      if (!item || this._offers.has(item)) continue;
      this._offers.set(item, row);
      goods.push([row.kind, row.id, 0, 0]);
    }
    Scene_Shop.prototype.prepare.call(this, goods, spec.buyOnly);
  };

  StudioShop.prototype.offerPrice = function (item, row) {
    if (!row || !item) return 0;
    if (row.price != null) return row.price;
    return row.currency ? Math.min(99999999, balance(row.currency)) : item.price;
  };

  StudioShop.prototype.limit = function (item) {
    var row = this._offers.get(item);
    if (!row || !available(row)) return 0;
    var capacity = Math.max(0, $gameParty.maxItems(item) - $gameParty.numItems(item));
    var max = Math.min(capacity, remaining(this, row));
    var price = this.offerPrice(item, row);
    return price > 0 ? Math.min(max, Math.floor(balance(currency(row)) / price)) : max;
  };

  StudioShop.prototype.createBuyWindow = function () {
    Scene_Shop.prototype.createBuyWindow.call(this);
    var shop = this, win = this._buyWindow;
    win.isEnabled = function (item) { return !!item && shop.limit(item) > 0; };
    win.drawItem = function (index) {
      var item = this.itemAt ? this.itemAt(index) : this._data[index], row = shop._offers.get(item);
      if (!row) return;
      var rect = this.itemLineRect ? this.itemLineRect(index) : this.itemRectForText(index);
      var width = Math.min(180, Math.floor(rect.width / 2));
      var left = remaining(shop, row);
      var price = shop.offerPrice(item, row) + ' ' + unit(currency(row));
      if (!available(row)) price = '未满足条件';
      else if (left === 0) price = '限购已满';
      else if (left !== Infinity) price += ' · 剩 ' + left;
      this.changePaintOpacity(this.isEnabled(item));
      this.drawItemName(item, rect.x, rect.y, rect.width - width);
      this.drawText(price, rect.x + rect.width - width, rect.y, width, 'right');
      this.changePaintOpacity(true);
    };
    win.refresh();
  };

  StudioShop.prototype.buyingPrice = function () { return this.offerPrice(this._item, this._offers.get(this._item)); };
  StudioShop.prototype.maxBuy = function () { return this.limit(this._item); };
  StudioShop.prototype.currencyUnit = function () {
    var row = this._offers.get(this._item);
    return row && this._commandWindow.currentSymbol() === 'buy' ? unit(currency(row)) : TextManager.currencyUnit;
  };

  StudioShop.prototype.doBuy = function (number) {
    var row = this._offers.get(this._item);
    if (!Number.isInteger(number) || number < 1 || number > this.limit(this._item)) return;
    var id = currency(row), price = this.buyingPrice(), before = $gameParty.numItems(this._item);
    $gameParty.gainItem(this._item, number);
    var delivered = Math.min(number, $gameParty.numItems(this._item) - before);
    if (delivered <= 0) return;
    var total = delivered * price;
    if (id) $gameVariables.setValue(id, balance(id) - total);
    else $gameParty.loseGold(total);
    record(this, row, delivered);
  };

  window.RpgStudioShop = {
    open: function (spec) {
      if ($gameParty.inBattle()) return;
      SceneManager.push(StudioShop);
      SceneManager.prepareNextScene(spec);
    },
  };
})();
