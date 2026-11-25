'use strict';
const { need } = require('../lib/util.js');
const Catalog = require('../core/plugin-catalog.js');
const Market = require('../core/plugin-market.js');
const Portrait = require('../core/animated-portrait.js');
const Layered = require('../core/layered-portrait.js');
const { screenOf } = require('../core/portrait-region.js');

module.exports = function (ctx) {
  const { project, where, opts } = ctx;
  return {
    get: {
      plugins(T) { return { engine: project.engine().name, rows: Catalog.catalog(project, T.xref.each), market: Market.cards(project) }; },
      'plugin/details'(T, q) {
        const plugin = Catalog.details(project, T.xref.each, q('id'));
        need(plugin, '找不到这个插件');
        for (const command of plugin.commands) command.refs = command.refs.map(ref => ({ ...ref, where: where(ref.at) }));
        return { plugin };
      },
      'plugin/animated-portrait'() {
        const system = project.sys();
        return { profile: Portrait.profileOf(system), clips: Portrait.clipsOf(project), models: Portrait.modelsOf(project), layered: Layered.choices(project),
          screen: screenOf(system),
          states: Portrait.STATES, canWrite: !opts.readOnly };
      },
    },
    post: {
      'plugin/animated-portrait'(T, b) {
        const profile = Portrait.parseProfile(b, project);
        T.store.edit(['System.json'], docs => {
          const system = docs['System.json'];
          if (profile.enabled && profile.mode === 'layered') Layered.ensure(ctx);
          if (profile.enabled || Portrait.used(system)) Portrait.setEnabled(ctx, profile.enabled);
          system[Portrait.KEY] = profile;
        });
        return { profile };
      },
    },
  };
};
