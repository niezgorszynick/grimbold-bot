// db/skillChallenges.js — Skill challenges of an adventure (rules in
// rules/skillChallenges.js). The adventure's DM (or the Root DM) prepares,
// runs, pauses and ends them and judges each turn: a roll counts at once,
// and the DM can raise its DC afterwards or void it. Players roll for their
// own characters on their turn, from the adventure table or Owlbear. Planned
// challenges and the DC are the DM's secret; while one runs the party sees
// the turn order, each roll and (unless hidden) the tally.

'use strict';

const { db } = require('./connection');
const rules = require('../rules');

const adventures = () => require('./activeAdventures');
const MAX_NAME = 100;
const MAX_TEXT = 2000;
const MODES = ['normal', 'advantage', 'disadvantage'];

const table = (adventure, user) => adventures().getAdventureTable({ adventureId: adventure.id, user });

// The adventure, if this user may run its challenges (its DM, the Root DM).
function secretAdventure(adventureId, user) {
  const { loadAdventureRow, requireAdventureSecret } = adventures();
  const adventure = loadAdventureRow(adventureId);
  requireAdventureSecret(adventure, user);
  return adventure;
}

function loadChallenge(adventure, challengeId) {
  const challenge = db.prepare('SELECT * FROM skill_challenges WHERE id = ? AND adventure_id = ?').get(Number(challengeId), adventure.id);
  if (!challenge) throw new Error('Skill challenge not found.');
  return challenge;
}

const participantsOf = challengeId => db.prepare(`
  SELECT p.character_id, p.initiative, c.name, c.player_id FROM skill_challenge_participants p JOIN characters c ON c.id = p.character_id
  WHERE p.challenge_id = ?
`).all(challengeId);
const attemptsOf = challengeId => db.prepare('SELECT * FROM skill_challenge_attempts WHERE challenge_id = ? ORDER BY id').all(challengeId);
const readSkills = json => { try { const list = JSON.parse(json || '[]'); return Array.isArray(list) ? list.filter(skill => rules.SKILLS[skill]) : []; } catch { return []; } };

// The DM's settings: { name, situation, successesNeeded, failuresAllowed, dc, skills, showTally }.
function cleanSettings(input, current = {}) {
  const value = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
  const whole = (raw, min, max, label) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    return number;
  };
  const name = String(value('name', current.name || '')).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!name) throw new Error('Give the skill challenge a name.');
  const skills = value('skills', readSkills(current.skills));
  if (!Array.isArray(skills) || skills.some(skill => !rules.SKILLS[skill])) throw new Error('Pick skills from the list.');
  return {
    name,
    situation: String(value('situation', current.situation || '')).trim().slice(0, MAX_TEXT),
    successes_needed: whole(value('successesNeeded', current.successes_needed ?? 6), 1, 20, 'Successes needed'),
    failures_allowed: whole(value('failuresAllowed', current.failures_allowed ?? 3), 1, 10, 'Failures allowed'),
    dc: whole(value('dc', current.dc ?? 15), 1, 40, 'The DC'),
    skills: JSON.stringify([...new Set(skills)]),
    show_tally: value('showTally', current.show_tally === undefined ? true : Boolean(current.show_tally)) ? 1 : 0
  };
}

// ─── Views ────────────────────────────────────────────────────────────────

// secret: the DM's view (the DC, every number, the controls' data).
// viewerId: a player's id, to list what their characters may do.
function challengeView(challenge, { secret, viewerId = null }) {
  const attempts = attemptsOf(challenge.id);
  const order = rules.challengeTurnOrder(participantsOf(challenge.id));
  const counts = rules.challengeTally(attempts);
  const finishedBy = rules.challengeFinishedBy(challenge, attempts);
  const showTally = secret || Boolean(challenge.show_tally);
  const live = challenge.status === 'running' && !finishedBy;
  const participants = order.map(participant => {
    const mine = participant.player_id === Number(viewerId);
    const used = attempts.filter(attempt => !attempt.voided && attempt.character_id === participant.character_id && attempt.skill && attempt.kind !== 'feature').map(attempt => attempt.skill);
    return {
      characterId: participant.character_id,
      name: participant.name,
      initiative: participant.initiative,
      turn: participant.character_id === challenge.turn_character_id,
      usedSkills: used,
      usedFeature: rules.challengeUsedFeature(participant.character_id, attempts),
      mine,
      // What this character may do now (theirs, or anyone's for the DM).
      allowedSkills: live && (secret || mine)
        ? rules.challengeAllowedSkills({ characterId: participant.character_id, round: challenge.round, attempts })
        : []
    };
  });
  return {
    id: challenge.id,
    name: challenge.name,
    situation: challenge.situation,
    status: challenge.status,
    round: challenge.round,
    turnCharacterId: challenge.turn_character_id,
    helpBy: challenge.help_by ? (order.find(participant => participant.character_id === challenge.help_by) || {}).name || null : null,
    successesNeeded: showTally ? challenge.successes_needed : null,
    failuresAllowed: showTally ? challenge.failures_allowed : null,
    successes: showTally ? counts.successes : null,
    failures: showTally ? counts.failures : null,
    showTally: Boolean(challenge.show_tally),
    finishedBy: showTally ? finishedBy : (finishedBy ? 'done' : null),
    participants,
    attempts: attempts.map(attempt => ({
      id: attempt.id,
      round: attempt.round,
      character: attempt.character_name,
      characterId: attempt.character_id,
      kind: attempt.kind,
      skill: attempt.skill,
      detail: attempt.detail,
      total: attempt.total,
      natural: attempt.natural,
      mode: attempt.mode,
      success: showTally || attempt.kind !== 'check' ? attempt.success : null,
      voided: Boolean(attempt.voided),
      ...(secret ? { dc: attempt.dc } : {})
    })),
    outcome: challenge.outcome,
    outcomeText: challenge.outcome ? rules.SKILL_CHALLENGE_OUTCOMES[challenge.outcome] : null,
    outcomeNote: challenge.status === 'done' ? challenge.outcome_note : '',
    ...(secret ? {
      dc: challenge.dc,
      skills: readSkills(challenge.skills),
      successesNeededSet: challenge.successes_needed,
      failuresAllowedSet: challenge.failures_allowed,
      ending: rules.challengeSuggestedOutcome(challenge, attempts)
    } : {})
  };
}

// For the adventure table: the running challenge (everyone in the adventure),
// and every challenge with its settings (the DM).
function challengesForTable({ adventureId, secret, manage, viewerId }) {
  const rows = db.prepare(`SELECT * FROM skill_challenges WHERE adventure_id = ?
    ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END, id`).all(Number(adventureId));
  const running = rows.find(row => row.status === 'running');
  return {
    running: running ? challengeView(running, { secret, viewerId }) : null,
    list: secret ? rows.map(row => challengeView(row, { secret: true, viewerId })) : [],
    prepared: !secret && manage ? rows.filter(row => row.status === 'planned').length : 0,
    // The finished ones and how they ended, for everyone.
    finished: rows.filter(row => row.status === 'done').map(row => ({ id: row.id, name: row.name, outcome: row.outcome, outcomeText: rules.SKILL_CHALLENGE_OUTCOMES[row.outcome] || null, note: row.outcome_note }))
  };
}

// ─── The DM: preparing, running, ending ───────────────────────────────────

function createSkillChallenge({ adventureId, user, settings }) {
  const adventure = secretAdventure(adventureId, user);
  const clean = cleanSettings(settings || {});
  db.prepare(`INSERT INTO skill_challenges (adventure_id, name, situation, successes_needed, failures_allowed, dc, skills, show_tally)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(adventure.id, clean.name, clean.situation, clean.successes_needed, clean.failures_allowed, clean.dc, clean.skills, clean.show_tally);
  return table(adventure, user);
}

function updateSkillChallenge({ adventureId, user, challengeId, settings }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status === 'done') throw new Error('That skill challenge is over.');
  const clean = cleanSettings(settings || {}, challenge);
  db.prepare(`UPDATE skill_challenges SET name = ?, situation = ?, successes_needed = ?, failures_allowed = ?, dc = ?, skills = ?, show_tally = ? WHERE id = ?`)
    .run(clean.name, clean.situation, clean.successes_needed, clean.failures_allowed, clean.dc, clean.skills, clean.show_tally, challenge.id);
  return table(adventure, user);
}

function deleteSkillChallenge({ adventureId, user, challengeId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status === 'running') throw new Error('Pause or end the skill challenge first.');
  db.prepare('DELETE FROM skill_challenges WHERE id = ?').run(challenge.id);
  return table(adventure, user);
}

function requireNoOtherRunning(adventure, challengeId) {
  const running = db.prepare("SELECT name FROM skill_challenges WHERE adventure_id = ? AND status = 'running' AND id != ?").get(adventure.id, challengeId);
  if (running) throw new Error(`Pause or end "${running.name}" first.`);
}

// The party joins (everyone, unless the DM already picked who); the first in
// initiative order starts.
function runSkillChallenge({ adventureId, user, challengeId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status !== 'planned') throw new Error(`"${challenge.name}" has already been run.`);
  requireNoOtherRunning(adventure, challenge.id);
  db.transaction(() => {
    if (!participantsOf(challenge.id).length) {
      const party = db.prepare('SELECT character_id FROM adventure_party WHERE adventure_id = ?').all(adventure.id);
      if (!party.length) throw new Error('There is no one in the party yet.');
      const add = db.prepare('INSERT OR IGNORE INTO skill_challenge_participants (challenge_id, character_id) VALUES (?, ?)');
      party.forEach(row => add.run(challenge.id, row.character_id));
    }
    const first = rules.challengeTurnOrder(participantsOf(challenge.id))[0];
    db.prepare("UPDATE skill_challenges SET status = 'running', started_at = CURRENT_TIMESTAMP, round = 1, turn_character_id = ? WHERE id = ?")
      .run(first ? first.character_id : null, challenge.id);
  })();
  return table(adventure, user);
}

function pauseSkillChallenge({ adventureId, user, challengeId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status !== 'running') throw new Error(`"${challenge.name}" is not running.`);
  db.prepare("UPDATE skill_challenges SET status = 'paused' WHERE id = ?").run(challenge.id);
  return table(adventure, user);
}

function resumeSkillChallenge({ adventureId, user, challengeId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status !== 'paused') throw new Error(`"${challenge.name}" is not paused.`);
  requireNoOtherRunning(adventure, challenge.id);
  db.prepare("UPDATE skill_challenges SET status = 'running' WHERE id = ?").run(challenge.id);
  return table(adventure, user);
}

// outcome: one of rules.SKILL_CHALLENGE_OUTCOMES' keys the ending allows.
// Returns the table and the finished challenge (for the Discord post).
function endSkillChallenge({ adventureId, user, challengeId, outcome, note = '' }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status !== 'running' && challenge.status !== 'paused') throw new Error(`"${challenge.name}" is not running.`);
  const ending = rules.challengeSuggestedOutcome(challenge, attemptsOf(challenge.id));
  if (!ending.choices.includes(outcome)) {
    throw new Error(`Choose how it ended: ${ending.choices.map(choice => rules.SKILL_CHALLENGE_OUTCOMES[choice]).join(' / ')}.`);
  }
  db.prepare("UPDATE skill_challenges SET status = 'done', ended_at = CURRENT_TIMESTAMP, outcome = ?, outcome_note = ?, help_by = NULL WHERE id = ?")
    .run(outcome, String(note || '').trim().slice(0, MAX_TEXT), challenge.id);
  return { table: table(adventure, user), challenge: loadChallenge(adventure, challenge.id) };
}

// Who takes part: the DM adds a party member or takes one out.
function setChallengeParticipant({ adventureId, user, challengeId, characterId, join = true }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status === 'done') throw new Error('That skill challenge is over.');
  const id = Number(characterId);
  if (join) {
    if (!db.prepare('SELECT 1 FROM adventure_party WHERE adventure_id = ? AND character_id = ?').get(adventure.id, id)) throw new Error('Only party members can take part.');
    db.prepare('INSERT OR IGNORE INTO skill_challenge_participants (challenge_id, character_id) VALUES (?, ?)').run(challenge.id, id);
  } else {
    db.transaction(() => {
      if (challenge.turn_character_id === id) advance(challenge, id);
      db.prepare('DELETE FROM skill_challenge_participants WHERE challenge_id = ? AND character_id = ?').run(challenge.id, id);
    })();
  }
  restartOrder(challenge.id);
  return table(adventure, user);
}

// initiative: a number, or '' / null to clear it.
function setChallengeInitiative({ adventureId, user, challengeId, characterId, initiative }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  const empty = initiative === null || initiative === undefined || String(initiative).trim() === '';
  const value = empty ? null : Number(initiative);
  if (!empty && (!Number.isInteger(value) || value < -10 || value > 50)) throw new Error('Initiative must be a whole number from -10 to 50.');
  const changed = db.prepare('UPDATE skill_challenge_participants SET initiative = ? WHERE challenge_id = ? AND character_id = ?').run(value, challenge.id, Number(characterId)).changes;
  if (!changed) throw new Error('That character is not in the skill challenge.');
  restartOrder(challenge.id);
  return table(adventure, user);
}

// Before anyone has acted in round 1, the turn follows the initiative order
// as it fills in (the first turn goes to the highest initiative).
function restartOrder(challengeId) {
  const challenge = db.prepare('SELECT * FROM skill_challenges WHERE id = ?').get(Number(challengeId));
  if (!challenge || challenge.status !== 'running') return;
  const order = rules.challengeTurnOrder(participantsOf(challenge.id));
  const first = order[0];
  // Nobody's turn (everyone had left), or the turn-holder is gone: the top of the order.
  const lost = !order.some(participant => participant.character_id === challenge.turn_character_id);
  const fresh = challenge.round === 1 && !db.prepare('SELECT 1 FROM skill_challenge_attempts WHERE challenge_id = ? LIMIT 1').get(challenge.id);
  if (!lost && !fresh) return;
  db.prepare('UPDATE skill_challenges SET turn_character_id = ? WHERE id = ?').run(first ? first.character_id : null, challenge.id);
}

// A character rolled initiative: in a running skill challenge of their
// adventure it sets their place in the turn order (joining it if needed).
function recordChallengeInitiative(characterId, total) {
  const rows = db.prepare(`
    SELECT s.id FROM skill_challenges s JOIN adventures a ON a.id = s.adventure_id
    JOIN adventure_party ap ON ap.adventure_id = a.id AND ap.character_id = ?
    WHERE s.status = 'running' AND a.status = 'active'
  `).all(Number(characterId));
  for (const row of rows) {
    db.prepare(`INSERT INTO skill_challenge_participants (challenge_id, character_id, initiative) VALUES (?, ?, ?)
      ON CONFLICT(challenge_id, character_id) DO UPDATE SET initiative = excluded.initiative`).run(row.id, Number(characterId), total);
    restartOrder(row.id);
  }
  return rows.length;
}

// Moves the turn on from this character (nothing if it wasn't theirs).
function advance(challenge, fromCharacterId) {
  if (challenge.turn_character_id !== Number(fromCharacterId)) return;
  const order = rules.challengeTurnOrder(participantsOf(challenge.id));
  const next = rules.challengeNextTurn(order, fromCharacterId, challenge.round);
  db.prepare('UPDATE skill_challenges SET turn_character_id = ?, round = ? WHERE id = ?').run(next.characterId, next.round, challenge.id);
}

function skipChallengeTurn({ adventureId, user, challengeId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = runningChallenge(adventure, challengeId);
  advance(challenge, challenge.turn_character_id);
  return table(adventure, user);
}

// ─── Turns: a check, Help, or a spell / feature / item ────────────────────

function runningChallenge(adventure, challengeId) {
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status !== 'running') throw new Error(`"${challenge.name}" is not running.`);
  if (rules.challengeFinishedBy(challenge, attemptsOf(challenge.id))) throw new Error('The skill challenge is decided: the DM ends it.');
  return challenge;
}

// The adventure, challenge and character for a turn, and whether the user is
// the DM. Players act for their own characters, on their turn.
function turnFor({ adventureId, user, challengeId, characterId }) {
  const { loadAdventureRow, canSeeAdventureSecrets } = adventures();
  const adventure = loadAdventureRow(adventureId);
  if (adventure.status !== 'active') throw new Error('This adventure is no longer running.');
  const dm = canSeeAdventureSecrets(adventure, user);
  const challenge = runningChallenge(adventure, challengeId);
  const participant = participantsOf(challenge.id).find(row => row.character_id === Number(characterId));
  if (!participant) throw new Error('That character is not in the skill challenge.');
  if (!dm && participant.player_id !== Number(user && user.id)) throw new Error('Forbidden.');
  if (!dm && challenge.turn_character_id !== participant.character_id) throw new Error(`It is not ${participant.name}'s turn.`);
  return { adventure, challenge, participant, dm };
}

// override (the DM only): use a skill the rules would block this round.
function checkSkill({ challenge, participant, skill, dm, override }) {
  const problem = rules.challengeSkillProblem({ characterId: participant.character_id, skill, round: challenge.round, attempts: attemptsOf(challenge.id) });
  if (problem && !(dm && override && rules.SKILLS[skill])) throw new Error(problem);
}

// A skill check: rolled from the sheet (logged, to Owlbear), against the DC.
function rollChallengeCheck({ adventureId, user, challengeId, characterId, skill, mode = 'normal', override = false }) {
  const { adventure, challenge, participant, dm } = turnFor({ adventureId, user, challengeId, characterId });
  checkSkill({ challenge, participant, skill, dm, override });
  const helped = Boolean(challenge.help_by);
  const rollMode = rules.challengeModeWithHelp(MODES.includes(mode) ? mode : 'normal', helped);
  const roll = require('./dice').rollForCharacter({
    characterId: participant.character_id, user, request: { roll: `skill:${skill}`, mode: rollMode, context: `Skill challenge: ${challenge.name}` }
  });
  const success = roll.total >= challenge.dc ? 1 : 0;
  db.transaction(() => {
    db.prepare(`INSERT INTO skill_challenge_attempts (challenge_id, character_id, character_name, round, kind, skill, roll_id, total, natural, mode, dc, success, detail)
      VALUES (?, ?, ?, ?, 'check', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(challenge.id, participant.character_id, participant.name, challenge.round, skill, roll.id, roll.total, roll.natural, rollMode, challenge.dc, success, helped ? 'Helped' : '');
    db.prepare('UPDATE skill_challenges SET help_by = NULL WHERE id = ?').run(challenge.id);
    advance(challenge, participant.character_id);
  })();
  return { table: table(adventure, user), roll, success: Boolean(success) };
}

// The character sheet asks this before a skill roll: is it this character's
// turn in a running skill challenge (one this user may roll for)? Returns
// { adventureId, challengeId, name, allowedSkills, helped } or null.
function challengeTurnForCharacter({ characterId, user }) {
  const id = Number(characterId);
  const rows = db.prepare(`
    SELECT s.* FROM skill_challenges s JOIN adventures a ON a.id = s.adventure_id
    WHERE s.status = 'running' AND a.status = 'active' AND s.turn_character_id = ?
    ORDER BY s.started_at
  `).all(id);
  for (const challenge of rows) {
    try {
      turnFor({ adventureId: challenge.adventure_id, user, challengeId: challenge.id, characterId: id });
    } catch {
      continue;
    }
    const attempts = attemptsOf(challenge.id);
    if (rules.challengeFinishedBy(challenge, attempts)) continue;
    return {
      adventureId: challenge.adventure_id,
      challengeId: challenge.id,
      name: challenge.name,
      allowedSkills: rules.challengeAllowedSkills({ characterId: id, round: challenge.round, attempts }),
      helped: Boolean(challenge.help_by)
    };
  }
  return null;
}

// A skill roll from the character sheet, counted as the challenge turn (the
// player said yes on the sheet). Returns the roll, with how it went when the
// tally is shown to this user.
function sheetChallengeRoll({ characterId, user, skill, mode }) {
  const turn = challengeTurnForCharacter({ characterId, user });
  if (!turn) throw new Error("It is no longer this character's turn in a skill challenge.");
  const result = rollChallengeCheck({ adventureId: turn.adventureId, user, challengeId: turn.challengeId, characterId, skill, mode });
  const running = result.table.challenges.running;
  return {
    ...result.roll,
    challenge: { name: turn.name, success: running && running.successes !== null ? result.success : null }
  };
}

// Help: the next roller gets Advantage; the helper's skill counts as used.
function helpInChallenge({ adventureId, user, challengeId, characterId, skill, override = false }) {
  const { adventure, challenge, participant, dm } = turnFor({ adventureId, user, challengeId, characterId });
  checkSkill({ challenge, participant, skill, dm, override });
  db.transaction(() => {
    db.prepare(`INSERT INTO skill_challenge_attempts (challenge_id, character_id, character_name, round, kind, skill)
      VALUES (?, ?, ?, ?, 'help', ?)`).run(challenge.id, participant.character_id, participant.name, challenge.round, skill);
    db.prepare('UPDATE skill_challenges SET help_by = ? WHERE id = ?').run(participant.character_id, challenge.id);
    advance(challenge, participant.character_id);
  })();
  return table(adventure, user);
}

// A fitting spell, feature or item (the DM's call): one success, no roll,
// once per character per challenge. what: e.g. "Fly across the chasm".
function featureSuccess({ adventureId, user, challengeId, characterId, what }) {
  const adventure = secretAdventure(adventureId, user);
  const { challenge, participant } = turnFor({ adventureId, user, challengeId, characterId });
  if (rules.challengeUsedFeature(participant.character_id, attemptsOf(challenge.id))) {
    throw new Error(`${participant.name} has already had a spell, feature or item counted in this challenge.`);
  }
  const text = String(what || '').trim().slice(0, 200);
  if (!text) throw new Error('Say which spell, feature or item it was.');
  db.transaction(() => {
    db.prepare(`INSERT INTO skill_challenge_attempts (challenge_id, character_id, character_name, round, kind, detail, success)
      VALUES (?, ?, ?, ?, 'feature', ?, 1)`).run(challenge.id, participant.character_id, participant.name, challenge.round, text);
    advance(challenge, participant.character_id);
  })();
  return table(adventure, user);
}

function loadAttempt(challenge, attemptId) {
  const attempt = db.prepare('SELECT * FROM skill_challenge_attempts WHERE id = ? AND challenge_id = ?').get(Number(attemptId), challenge.id);
  if (!attempt) throw new Error('That turn is not in this skill challenge.');
  return attempt;
}

// The DM takes a turn back: it no longer counts and its skill is free again.
function voidChallengeAttempt({ adventureId, user, challengeId, attemptId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status === 'done') throw new Error('That skill challenge is over.');
  const attempt = loadAttempt(challenge, attemptId);
  db.transaction(() => {
    db.prepare('UPDATE skill_challenge_attempts SET voided = 1 WHERE id = ?').run(attempt.id);
    if (attempt.kind === 'help' && challenge.help_by === attempt.character_id) db.prepare('UPDATE skill_challenges SET help_by = NULL WHERE id = ?').run(challenge.id);
  })();
  return table(adventure, user);
}

// A stretch of a skill: the DC for that roll goes up by 5 (it may now fail).
function raiseChallengeAttemptDc({ adventureId, user, challengeId, attemptId }) {
  const adventure = secretAdventure(adventureId, user);
  const challenge = loadChallenge(adventure, challengeId);
  if (challenge.status === 'done') throw new Error('That skill challenge is over.');
  const attempt = loadAttempt(challenge, attemptId);
  if (attempt.kind !== 'check' || attempt.voided) throw new Error('Only a skill check that counts has a DC to raise.');
  const dc = attempt.dc + rules.SKILL_CHALLENGE_RAISE_DC_BY;
  db.prepare('UPDATE skill_challenge_attempts SET dc = ?, success = ? WHERE id = ?').run(dc, attempt.total >= dc ? 1 : 0, attempt.id);
  return table(adventure, user);
}

// ─── Owlbear ──────────────────────────────────────────────────────────────

// The running skill challenges this key's player is in (or DMs).
function getVttChallenges({ key }) {
  const player = require('./dice').vttPlayerForKey(key);
  const user = db.prepare('SELECT id, role FROM players WHERE id = ?').get(player.player_id);
  const rows = db.prepare(`
    SELECT DISTINCT s.*, a.title AS adventure_title FROM skill_challenges s JOIN adventures a ON a.id = s.adventure_id
    WHERE s.status = 'running' AND a.status = 'active' AND (a.dm_player_id = ? OR EXISTS (
      SELECT 1 FROM adventure_party ap JOIN characters c ON c.id = ap.character_id WHERE ap.adventure_id = a.id AND c.player_id = ?))
    ORDER BY s.started_at
  `).all(player.player_id, player.player_id);
  const { loadAdventureRow, canSeeAdventureSecrets } = adventures();
  return {
    player: player.discord_tag,
    challenges: rows.map(row => {
      const secret = canSeeAdventureSecrets(loadAdventureRow(row.adventure_id), user);
      return { adventureId: row.adventure_id, adventure: row.adventure_title, dm: secret, ...challengeView(row, { secret, viewerId: player.player_id }) };
    })
  };
}

// The user a key acts as (for rolls and the DM's controls from Owlbear).
function vttUser(key) {
  const player = require('./dice').vttPlayerForKey(key);
  return db.prepare('SELECT id, role, discord_tag FROM players WHERE id = ?').get(player.player_id);
}

module.exports = {
  challengeTurnForCharacter,
  sheetChallengeRoll,
  challengesForTable,
  createSkillChallenge,
  updateSkillChallenge,
  deleteSkillChallenge,
  runSkillChallenge,
  pauseSkillChallenge,
  resumeSkillChallenge,
  endSkillChallenge,
  setChallengeParticipant,
  setChallengeInitiative,
  recordChallengeInitiative,
  skipChallengeTurn,
  rollChallengeCheck,
  helpInChallenge,
  featureSuccess,
  voidChallengeAttempt,
  raiseChallengeAttemptDc,
  getVttChallenges,
  vttUser
};
