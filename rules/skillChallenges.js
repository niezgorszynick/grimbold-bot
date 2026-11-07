// rules/skillChallenges.js — Skill challenges (after the 4e skill challenge
// as adapted for 5e by The DM Lair, with the table's own rulings):
//
// - The DM sets the successes needed (6 standard, 9 hard, 12 very hard), the
//   failures allowed (3 unless changed) and a hidden base DC.
// - Characters act in initiative order, one turn each per round.
// - A character can't use the same skill twice in a challenge, and no two
//   characters use the same skill in one round (the DM can allow it anyway).
// - A turn is a skill check against the DC; or Help (the next roller gets
//   Advantage; the helper's skill counts as used); or a fitting spell, feature
//   or item the DM counts as one success without a roll (once per character).
// - It ends at the success target or the failure limit. The outcome follows the
//   failures: 0 a clean success, 1 a minor cost, 2+ a serious cost; at the
//   failure limit the DM decides: failed, or the goal reached at a grave cost.
//
// These functions work on plain rows: the challenge, its participants (in
// initiative order) and its attempts. db/skillChallenges.js stores them.

const { SKILLS } = require('./util');

const SKILL_NAMES = Object.keys(SKILLS);
const DIFFICULTY = { standard: 6, hard: 9, veryHard: 12 };
const DC_PRESETS = { Easy: 10, Moderate: 15, Hard: 20, 'Very Hard': 25 };
const RAISE_DC_BY = 5;
const OUTCOMES = {
  clean: 'Complete success, no cost',
  minor: 'Success with a minor cost',
  serious: 'Success with a serious cost',
  grave: 'The goal reached at a grave cost',
  failed: 'Failed',
  stopped: 'Stopped before the end'
};

const counted = attempts => (attempts || []).filter(attempt => !attempt.voided);

// { successes, failures } from the attempts that still count.
function tally(attempts) {
  const live = counted(attempts);
  return {
    successes: live.filter(attempt => attempt.kind !== 'help' && attempt.success === 1).length,
    failures: live.filter(attempt => attempt.kind === 'check' && attempt.success === 0).length
  };
}

// 'successes' | 'failures' | null — what ended it (nothing more can be rolled).
function finishedBy(challenge, attempts) {
  const { successes, failures } = tally(attempts);
  if (successes >= challenge.successes_needed) return 'successes';
  if (failures >= challenge.failures_allowed) return 'failures';
  return null;
}

// The outcome a finished challenge suggests; at the failure limit the DM
// chooses between 'failed' and 'grave' (both are returned as choices).
function suggestedOutcome(challenge, attempts) {
  const by = finishedBy(challenge, attempts);
  const { failures } = tally(attempts);
  if (by === 'successes') return { suggested: failures === 0 ? 'clean' : failures === 1 ? 'minor' : 'serious', choices: ['clean', 'minor', 'serious'] };
  if (by === 'failures') return { suggested: null, choices: ['grave', 'failed'] };
  return { suggested: 'stopped', choices: Object.keys(OUTCOMES) };
}

// Why this character can't use this skill now, or null. Help uses a skill too.
function skillProblem({ characterId, skill, round, attempts }) {
  if (!SKILL_NAMES.includes(skill)) return 'Choose a skill.';
  const live = counted(attempts).filter(attempt => attempt.skill === skill && attempt.kind !== 'feature');
  if (live.some(attempt => attempt.character_id === Number(characterId))) return `${skill} was already used by this character in this challenge.`;
  if (live.some(attempt => attempt.round === round)) return `${skill} was already used this round.`;
  return null;
}

// Skills a character may still use this round.
function allowedSkills({ characterId, round, attempts }) {
  return SKILL_NAMES.filter(skill => !skillProblem({ characterId, skill, round, attempts }));
}

// Participants in turn order: initiative high to low (none last), then name.
function turnOrder(participants) {
  return [...(participants || [])].sort((a, b) =>
    (b.initiative ?? -999) - (a.initiative ?? -999) || String(a.name || '').localeCompare(String(b.name || '')));
}

// The turn after this character's: { characterId, round } (a new round after the last).
function nextTurn(order, currentId, round) {
  if (!order.length) return { characterId: null, round };
  const index = order.findIndex(participant => participant.character_id === Number(currentId));
  if (index === -1) return { characterId: order[0].character_id, round };
  if (index + 1 < order.length) return { characterId: order[index + 1].character_id, round };
  return { characterId: order[0].character_id, round: round + 1 };
}

// Whether a character has already had their spell/feature/item success.
function usedFeature(characterId, attempts) {
  return counted(attempts).some(attempt => attempt.kind === 'feature' && attempt.character_id === Number(characterId));
}

// The Advantage a Help gives, combined with the roller's own choice.
function modeWithHelp(mode, helped) {
  if (!helped) return mode;
  return mode === 'disadvantage' ? 'normal' : 'advantage';
}

module.exports = {
  SKILL_CHALLENGE_DIFFICULTY: DIFFICULTY,
  SKILL_CHALLENGE_DC_PRESETS: DC_PRESETS,
  SKILL_CHALLENGE_RAISE_DC_BY: RAISE_DC_BY,
  SKILL_CHALLENGE_OUTCOMES: OUTCOMES,
  challengeTally: tally,
  challengeFinishedBy: finishedBy,
  challengeSuggestedOutcome: suggestedOutcome,
  challengeSkillProblem: skillProblem,
  challengeAllowedSkills: allowedSkills,
  challengeTurnOrder: turnOrder,
  challengeNextTurn: nextTurn,
  challengeUsedFeature: usedFeature,
  challengeModeWithHelp: modeWithHelp
};
