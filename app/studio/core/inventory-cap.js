'use strict';
const { int, need } = require('../lib/util.js');

const MAX_ITEMS = 9999;
const tag = /(?:\r?\n)?<RpgStudioMaxItems:\s*(\d+)\s*>/g;

function readCap(note) {
  const matches = [...String(note || '').matchAll(tag)];
  const value = Number(matches.at(-1)?.[1]);
  return value >= 1 && value <= MAX_ITEMS ? value : null;
}

const stripCap = note => String(note || '').replace(tag, '');
function writeCap(note, value) {
  const text = stripCap(note);
  if (value === null) return text;
  const n = int(value, '最大持有量要填整数');
  need(n >= 1 && n <= MAX_ITEMS, `最大持有量需在 1～${MAX_ITEMS} 内`);
  return [text, `<RpgStudioMaxItems:${n}>`].filter(Boolean).join('\n');
}

module.exports = { MAX_ITEMS, readCap, stripCap, writeCap };
