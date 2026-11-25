'use strict';
const { need } = require('../lib/util.js');

const MAX_STEPS = 9999999;
function encounterSteps(value) {
  const n = Number(value);
  need(Number.isInteger(n) && n >= 0 && n <= MAX_STEPS, `步数需为 0～${MAX_STEPS} 的整数`);
  return n;
}

const immunityCommand = steps => ({ code: 355, indent: 0, parameters: [`$gameSystem.rpgStudioSetEncounterImmunity(${steps});`] });
function immunitySteps(command) {
  if (command?.code !== 355 || command.parameters?.length !== 1) return null;
  const match = /^\$gameSystem\.rpgStudioSetEncounterImmunity\((0|[1-9]\d*)\);$/.exec(command.parameters[0]);
  const steps = Number(match?.[1]);
  return match && steps <= MAX_STEPS ? steps : null;
}
const isImmunityCommand = command => immunitySteps(command) !== null;

module.exports = { MAX_STEPS, encounterSteps, immunityCommand, immunitySteps, isImmunityCommand };
