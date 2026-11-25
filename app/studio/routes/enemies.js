'use strict';
const { need, int } = require('../lib/util.js');
const { PARAMS, DROP_KINDS, defaultAction, emptyDrop, newEnemy, ensureTroop } = require('../core/enemies.js');

const ENEMIES = 'Enemies.json', TROOPS = 'Troops.json';
function field(value, min, max, label) {
  const n = int(value, label + '要填整数');
  need(n >= min && n <= max, `${label}需在 ${min}～${max} 内`);
  return n;
}

module.exports = function ({ project, opts }) {
  const records = file => project.read(file) || [null];
  const attack = () => project.has('skill', 1) ? 1 : project.rows('skill')[0]?.id;
  const spriteFolder = () => project.sys().optSideView ? 'sv_enemies' : 'enemies';
  return {
    get: {
      enemies() {
        return { rows: records(ENEMIES).filter(Boolean).map(e => ({ id: e.id, name: e.name, hp: e.params?.[0] ?? 0 })), canWrite: !opts.readOnly };
      },
      'enemy/entry'(T, q) {
        const id = int(q('id') || 0), enemy = id ? records(ENEMIES)[id] : newEnemy(0, attack());
        need(enemy, '找不到这个敌人');
        const folder = spriteFolder();
        return { enemy, stats: PARAMS, folder, graphics: project.listImages(folder),
          skills: project.rows('skill'), drops: DROP_KINDS.map(kind => kind ? project.rows(kind) : []),
          troops: records(TROOPS).filter(troop => troop?.members?.some(m => m.enemyId === id)).map(({ id, name }) => ({ id, name })), canWrite: !opts.readOnly };
      },
    },
    post: {
      'enemy/save'(T, body) {
        const id = int(body.id ?? 0, '敌人编号不对');
        const name = String(body.name ?? '').trim(), note = String(body.note ?? ''), battlerName = String(body.battlerName ?? '');
        need(id >= 0 && name && name.length <= 80 && !/[\r\n]/.test(name), '敌人名称要在 1～80 字内');
        need(note.length <= 12000, '备注太长');
        const battlerHue = field(body.battlerHue, 0, 360, '色相'), exp = field(body.exp, 0, 9999999, '经验'), gold = field(body.gold, 0, 9999999, '金币');
        need(Array.isArray(body.params) && body.params.length === PARAMS.length, '请填写 8 项战斗属性');
        const params = body.params.map((value, i) => field(value, i === 0 ? 1 : 0, 999999, PARAMS[i]));
        const { result } = T.store.edit([ENEMIES, TROOPS], docs => {
          const db = docs[ENEMIES] ||= [null], troops = docs[TROOPS] ||= [null];
          const enemyId = id || Math.max(db.length, 1);
          const enemy = id ? db[id] : newEnemy(enemyId, attack());
          need(enemy, '找不到这个敌人');
          need(!battlerName || battlerName === enemy.battlerName || project.findImage(spriteFolder(), battlerName), '战斗图像不存在');
          Object.assign(enemy, { name, note, battlerName, battlerHue, exp, gold, params });
          if (body.skill !== undefined) {
            const skill = int(body.skill, '请选择普通行动技能'), actions = enemy.actions ||= [];
            need(actions.length === 0 || (actions.length === 1 && actions[0].conditionType === 0), '这个敌人有多项行动或行动条件，请保留原行动设置');
            need(skill === 0 || project.has('skill', skill) || actions[0]?.skillId === skill, '技能不存在');
            enemy.actions = skill ? [{ ...(actions[0] || defaultAction(skill)), skillId: skill }] : [];
          }
          if (body.drops !== undefined) {
            need(Array.isArray(body.drops) && body.drops.length === 3, '请填写三个掉落栏');
            const drops = enemy.dropItems ||= [];
            body.drops.forEach((row, i) => {
              const kind = field(row.kind, 0, 3, '掉落类型');
              if (!kind) { drops[i] = emptyDrop(); return; }
              const dataId = field(row.dataId, 1, 999999, '掉落物编号');
              need(project.has(DROP_KINDS[kind], dataId) || (drops[i]?.kind === kind && drops[i].dataId === dataId), '找不到掉落物');
              drops[i] = { kind, dataId, denominator: field(row.denominator, 1, 999999, '掉落概率分母') };
            });
          }
          db[enemyId] = enemy;
          return { id: enemyId, troop: ensureTroop(troops, enemy, project.sys()) };
        }, { create: [ENEMIES, TROOPS] });
        return result;
      },
    },
  };
};
