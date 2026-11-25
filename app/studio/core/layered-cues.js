'use strict';
const layered = require('./layered-portrait.js');
const { need } = require('../lib/util.js');

const PREFIX = 'RpgStudioLayered.cue(this, ';
const actions = { 攻击: '攻击', 受击: '受击' };
const matches = value => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,24}$/u.test(value);

function parse(line) {
  const state = /^[#＃]\s*立绘状态\s+(\S+)\s*$/.exec(line);
  if (state) return ['state', state[1]];
  const motion = /^[#＃]\s*(攻击|受击|立绘动作(?:\s+\S+))\s*$/.exec(line);
  if (motion) return ['action', actions[motion[1]] || motion[1].split(/\s+/)[1]];
  const qualified = /^[#＃]\s*立绘[\s:：]+(\S+\s+\S+)\s*$/.exec(line);
  const edit = layered.parseEdit(qualified ? '#' + qualified[1] : line);
  return edit && edit[0] !== 'wait' ? edit : null;
}

function textOf(op) {
  if (!Array.isArray(op)) return '';
  if (op.length === 3 && op[0] === 'part' && Object.hasOwn(layered.slots, op[1]) && matches(op[2])) return '#立绘 ' + layered.slots[op[1]] + ' ' + op[2];
  if (op.length !== 2 || !matches(op[1])) return '';
  if (op[0] === 'state') return '#立绘状态 ' + op[1];
  if (op[0] === 'face') return '#立绘 表情 ' + op[1];
  if (op[0] === 'action') return Object.hasOwn(actions, op[1]) ? '#' + op[1] : '#立绘动作 ' + op[1];
  return '';
}

function read(c) {
  const text = c?.code === 355 && c.parameters?.[0];
  if (typeof text !== 'string' || !text.startsWith(PREFIX) || !text.endsWith(')')) return null;
  try {
    const op = JSON.parse(text.slice(PREFIX.length, -1));
    return textOf(op) && PREFIX + JSON.stringify(op) + ')' === text ? op : null;
  } catch { return null; }
}

function command(project, op) {
  const layouts = Object.values(layered.layoutsOf(project.sys()));
  need(layouts.length && textOf(op), '请先给人物保存分层立绘，再使用这条写法');
  const exists = layout => {
    if (op[0] === 'state') return ['正常', '自动'].includes(op[1]) || Object.hasOwn(layout.states || {}, op[1]);
    if (op[0] === 'action') return layered.hasAction(layout, layered.builtInLabels[op[1]] || op[1]);
    try { layered.checkEdit(layout, op); return true; } catch { return false; }
  };
  need(layouts.some(exists), `找不到分层立绘的写法「${textOf(op)}」所引用的素材、状态或动作`);
  return { code: 355, indent: 0, parameters: [PREFIX + JSON.stringify(op) + ')'] };
}

module.exports = { parse, textOf, read, command };
