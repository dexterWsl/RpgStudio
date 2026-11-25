'use strict';
const { need, int } = require('../lib/util.js');
const { KEY, profileOf, readProfile } = require('../core/relationships.js');

module.exports = function ({ project, opts }) {
  function actorId(value) {
    const id = int(value, '人物编号不对');
    need(project.has('actor', id), '找不到这个人物');
    return id;
  }
  return {
    get: {
      'person/relationships'(T, q) {
        const actor = actorId(q('actor')), system = project.sys();
        const people = project.rows('actor').filter(row => row.id !== actor);
        const incoming = people.flatMap(person => profileOf(system, person.id).links.filter(link => link.target === actor)
          .map(link => ({ ...link, actor: person.id, name: person.name })));
        return { profile: profileOf(system, actor), people, incoming, variables: project.rows('var'), canWrite: !opts.readOnly };
      },
    },
    post: {
      'person/relationships'(T, body) {
        const actor = actorId(body.actor), profile = readProfile(body, actor, project);
        const { result: variable } = T.store.edit(['System.json'], docs => {
          const system = docs['System.json'];
          if (profile.variable === -1) {
            const previous = profileOf(system, actor).variable;
            if (previous > 0 && previous < system.variables.length) profile.variable = previous;
            else {
              profile.variable = system.variables.length;
              system.variables.push(`${project.name('actor', actor)}·好感度`);
            }
          }
          (system[KEY] ||= {})[actor] = profile;
          return profile.variable;
        });
        return { variable };
      },
    },
  };
};
