'use strict';
// 选配置：每个 profile 给自己打分（match），分最高的胜出；都不认识就用通用配置。
// 也可以手动指定（启动参数 --profile example，或界面里切换）。
const generic = require('./generic.js');
const PROFILES = [require('./example.js'), generic];

function pick(project, wanted) {
  if (wanted) {
    const p = PROFILES.find(x => x.id === wanted);
    if (p) return p;
  }
  let best = generic, score = 0;
  for (const p of PROFILES) {
    let s = 0;
    try { s = Number(p.match(project)) || 0; } catch { }
    if (p !== generic && s > score) { best = p; score = s; }
  }
  return best;
}
const list = () => PROFILES.map(p => ({ id: p.id, label: p.label }));

module.exports = { pick, list, PROFILES };
