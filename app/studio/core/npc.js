'use strict';
const { END, UserError, need } = require('../lib/util.js');

function interactionList(T, text, extra = []) {
  need(typeof text === 'string' && text.length <= 30000, 'NPC 交互最多可写 30000 字');
  const source = text.trim();
  if (!source && !extra.length) return [END()];
  const firstFacesPlayer = /^[#＃]\s*面向主角\s*$/.test(source.split(/\r?\n/, 1)[0]);
  const writing = firstFacesPlayer ? source : ['#面向主角', source].filter(Boolean).join('\n');
  let list;
  try { list = T.merger.mergeList([END()], writing).list; }
  catch (error) { throw new UserError(error.message); }
  const result = [...list.slice(0, -1), ...extra, END()];
  const problems = T.validator.newProblems([END()], result).fresh;
  if (problems.length) throw new UserError(problems.slice(0, 6).map(problem => problem.msg).join('；'), { problems });
  return result;
}

module.exports = { interactionList };
