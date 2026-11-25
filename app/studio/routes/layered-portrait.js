'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { need } = require('../lib/util.js');
const Layered = require('../core/layered-portrait.js');
const Dynamic = require('../core/animated-portrait.js');
const Import = require('../core/portrait-import.js');
const { screenOf } = require('../core/portrait-region.js');

module.exports = function (ctx) {
  const { project } = ctx;
  function actorOf(id) {
    const actor = (project.read('Actors.json') || [])[Number(id)];
    need(actor, '找不到这个人物');
    return { id: actor.id, name: actor.name };
  }

  return {
    get: {
      'layered-portrait'(T, q) {
        const actor = actorOf(q('actor'));
        const system = project.sys();
        return { actor, canWrite: !ctx.opts.readOnly, screen: screenOf(system), layout: Layered.layoutsOf(system)[actor.id] || Layered.empty() };
      },
      'layered-portrait/import/sources'(T, q) {
        const actor = q('actor') ? actorOf(q('actor')) : null;
        if (actor) actor.portrait = Layered.layoutsOf(project.sys())[actor.id]?.name;
        return { sources: Import.sources(T.xref.each, ctx.where, actor, project.read('CommonEvents.json') || []) };
      },
      'layered-portrait/import/scan'(T, q) {
        const at = Object.fromEntries(['type', 'map', 'ev', 'page', 'ce', 'troop'].map(key => [key, q(key)]));
        return Import.inspect(project, Import.locate(ctx, at));
      },
    },
    post: {
      'layered-portrait'(T, b) {
        const actor = actorOf(b.actor);
        const previous = Layered.layoutsOf(project.sys())[actor.id];
        const layout = Layered.parseLayout(project, { ...b.layout, region: b.layout?.region ?? previous?.region }, T.script.condGroups);
        T.store.edit(['System.json'], docs => {
          const system = docs['System.json'];
          if (layout.name) {
            const actors = project.read('Actors.json') || [];
            const layouts = Layered.layoutsOf(system);
            need(!actors.some(row => row && row.id !== actor.id && (row.name === layout.name || layouts[row.id]?.name === layout.name)), '这套立绘的名称与其他角色或立绘重名');
          }
          Layered.ensure(ctx);
          if (Dynamic.used(system) && Dynamic.profileOf(system).mode === 'layered') Dynamic.setEnabled(ctx, true);
          system[Layered.key] = { ...Layered.layoutsOf(system), [actor.id]: layout };
        });
        return { layout };
      },
      'layered-portrait/demo'(T, b) {
        actorOf(b.actor);
        return { layout: Layered.demo(project, ctx.uploadRoot()) };
      },
      'layered-portrait/import'(T, b) {
        actorOf(b.actor);
        const result = Import.inspect(project, Import.locate(ctx, b.at));
        const frame = result.frames.find(frame => frame.key === b.frame);
        need(frame, '原事件图片已修改，请重新读取并选择画面');
        return { layout: Import.draft(project, frame, b.mapping, ctx.uploadRoot()) };
      },
    },
    upload: {
      async 'upload/layered-portrait'(req) {
        const key = ctx.projectKey(), file = path.join(os.tmpdir(), 'rpgstudio-portrait-' + randomUUID());
        try {
          await ctx.saveUpload(req, file, 8 * 1048576);
          need(key === ctx.projectKey(), '工程已切换，请刷新页面后继续');
          return Layered.importPart(project, fs.readFileSync(file), ctx.uploadRoot());
        } finally { fs.rmSync(file, { force: true }); }
      },
    },
  };
};
