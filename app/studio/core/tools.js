'use strict';
// 一次请求要用的全部「工具」，按当前工程现组装（工程可能刚切换、数据目录可能换成了另一个用户的工作区）
//
//   const T = createTools({ project, profile, picOptions, settings, backupsDir, onWrite, where })
//   T.script     编辑框写法 ↔ 指令（core/script.js）
//   T.merger     整页文字 ↔ 指令的无损合并（core/merge.js）
//   T.describer  指令 → 人话、阅读视图（core/commands.js）
//   T.player     预览播放的步骤（core/play.js）
//   T.store      写盘（读最新 → 改 → 校验 → 备份 → 原子替换；core/store.js）
//   T.xref / people / gallery / progress / scenes / validator   各功能的计算
//   T.pics       剧情图片的编号规则（profile 给的）；T.prof 当前配置；T.nameBox 有没有名字框（MZ 有）
//
// 写盘以后（afterWrite）：存的剧情里用到了演出插件（#飘字 #动作 #扮演、带人的 #传送、选项条件），
// 游戏里还没有就装上、旧了就更新（core/stage.js）
const { createDescriber } = require('./commands.js');
const { createScript } = require('./script.js');
const { createMerger, pictureRules } = require('./merge.js');
const { createXref } = require('./xref.js');
const { createValidator } = require('./validate.js');
const { createStore } = require('./store.js');
const { createPeople } = require('./people.js');
const { createGallery } = require('./gallery.js');
const { createProgress } = require('./progress.js');
const { createScenes } = require('./scenes.js');
const { createPlayer } = require('./play.js');
const { createPluginArgs } = require('./pluginargs.js');
const stagePlugin = require('./stage.js');

// 编辑框里「■」结构行的文字（不能改的指令：选项开头、条件、循环、脚本、插件……）
function anchorTextOf(describer) {
  return (c, cmds) => {
    const p = c.parameters || [];
    switch (c.code) {
      case 102: return '选项：' + (p[0] || []).join(' / ');
      case 402: return '选了「' + (p[1] ?? '') + '」';
      case 403: return '按取消时';
      case 404: return '选项结束';
      // 条件（如果 / 否则 / 结束）写成 # 开头，和别的内容行一样能在改台词里改；
      //   条件认不出来（脚本、独立开关…）时退回 ■，只读
      case 411: return '否则';
      case 412: return '条件结束';
      case 111: return '如果 ' + describer.condText(p);
      case 112: return '循环';
      case 413: return '循环结束';
      case 355: return '脚本：' + p[0] + (cmds.length > 1 ? ` …（共 ${cmds.length} 行）` : '');
      case 357: {
        const args = Object.values(p[3] || {}).filter(v => typeof v === 'string' && v).slice(0, 2).join('，');
        return '插件：' + (p[0] || '') + ' ' + (p[1] || '') + (args ? '（' + args + '）' : '');
      }
      case 108: return '注释：' + p[0];
    }
    return describer.describe(c);
  };
}

// 改过的文件里有没有用到演出插件的指令
function listsOf(project, files) {
  const lists = [];
  for (const f of files) {
    const d = project.read(f);
    if (/^Map\d+\.json$/.test(f) && d) for (const e of d.events || []) for (const pg of (e && e.pages) || []) lists.push(pg.list);
    if (f === 'CommonEvents.json' && Array.isArray(d)) for (const ce of d) if (ce) lists.push(ce.list);
    if (f === 'Troops.json' && Array.isArray(d)) for (const t of d) for (const pg of (t && t.pages) || []) lists.push(pg.list);
  }
  return lists;
}

function createTools(o) {
  const { project, where } = o;
  const prof = o.profile();
  const picOptions = o.picOptions();
  const nameBox = project.engine().name !== 'MV';
  // 插件指令（#插件）：参数表从 js/plugins 里的插件文件读
  const pluginArgs = createPluginArgs(project, { mz: nameBox });
  const isPluginCmd = c => pluginArgs.can(c);
  const pics = pictureRules({ ...picOptions, isPlugin: isPluginCmd });
  const describer = createDescriber(project, { isClearAll: pics.isClearAll });
  const script = createScript(project, { pics, nameBox, engine: project.engine().name, picSize: n => project.imageSize('pictures', n), pluginArgs });
  const style = project.messageStyle();
  const merger = createMerger({
    pics, nameBox, isPluginCmd,
    actorName: s => project.expandN(s),
    actorIdByName: project.actorIdByName,
    refText: script.refText,
    describe: describer.describe,
    anchorText: anchorTextOf(describer),
    parseScript: script.parseScript,
    scriptCommands: script.scriptCommands,
    stagingLine: script.stagingLine, stagingCommand: script.stagingCommand,
    bustCommands: script.bustCommands, unbustCommands: script.unbustCommands,
    picExists: n => !!project.findImage('pictures', n),
    exists: script.exists,
    defaultStyle: ['', 0, style.background, style.position],
  });
  const xref = createXref(project, describer);
  let aliases = null;
  try { aliases = prof.actorAliases ? prof.actorAliases(project) : null; } catch { }
  const people = createPeople(project, xref, aliases);
  const gallery = createGallery(project, xref, { pictures: o.picOptions });
  const progress = createProgress(project, xref, { saved: () => o.settings().progress || null, profile: o.profile, where });
  const validator = createValidator(project);
  const afterWrite = files => {
    try {
      if (listsOf(project, files).some(stagePlugin.wants)) stagePlugin.ensure(project.gameRoot());
    } catch (e) { console.error('[studio] 演出插件：' + e.message); }
    if (o.onWrite) o.onWrite(files);
  };
  const store = createStore(project, { backupsDir: o.backupsDir, onWrite: afterWrite });
  const scenes = createScenes(project, xref, { where, progress });
  const player = createPlayer(project, describer);
  return { prof, pics, nameBox, describer, script, merger, xref, validator, store, people, gallery, progress, scenes, player };
}

module.exports = { createTools };
