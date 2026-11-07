const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const addCharacter = (playerId, name) => Number(db.prepare(`
  INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')
`).run(playerId, name).lastInsertRowid);

function setUp() {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = addCharacter(ola, 'Kael');
  const brin = addCharacter(tom, 'Brin');
  const asDm = { id: dm, role: 'admin' };
  const adventureId = db.startAdventure({ title: 'Gnolls on the river', dmPlayerId: dm });
  db.setPartyMember({ adventureId, user: asDm, characterId: kael, inParty: true });
  db.setPartyMember({ adventureId, user: asDm, characterId: brin, inParty: true });
  return { dm, ola, tom, kael, brin, asDm, adventureId, asOla: { id: ola, role: 'player' }, asTom: { id: tom, role: 'player' } };
}
const running = table => table.challenges.running;

test('the rules: tally, outcome, skill limits, turn order, Help', () => {
  const attempts = [
    { character_id: 1, round: 1, kind: 'check', skill: 'Stealth', success: 1 },
    { character_id: 2, round: 1, kind: 'check', skill: 'Athletics', success: 0 },
    { character_id: 2, round: 1, kind: 'help', skill: 'Insight', success: null },
    { character_id: 1, round: 2, kind: 'feature', detail: 'Fly', success: 1 },
    { character_id: 1, round: 2, kind: 'check', skill: 'Arcana', success: 0, voided: 1 }
  ];
  assert.deepEqual(rules.challengeTally(attempts), { successes: 2, failures: 1 });
  assert.equal(rules.challengeSkillProblem({ characterId: 1, skill: 'Stealth', round: 3, attempts }), 'Stealth was already used by this character in this challenge.');
  assert.equal(rules.challengeSkillProblem({ characterId: 1, skill: 'Athletics', round: 1, attempts }), 'Athletics was already used this round.');
  assert.equal(rules.challengeSkillProblem({ characterId: 1, skill: 'Athletics', round: 2, attempts }), null, 'another round: fine');
  assert.equal(rules.challengeSkillProblem({ characterId: 1, skill: 'Arcana', round: 2, attempts }), null, 'a voided turn frees the skill');
  assert.equal(rules.challengeSkillProblem({ characterId: 2, skill: 'Insight', round: 3, attempts }), 'Insight was already used by this character in this challenge.', 'Help uses the skill');

  const challenge = { successes_needed: 3, failures_allowed: 2 };
  assert.equal(rules.challengeFinishedBy(challenge, attempts), null);
  const won = [...attempts, { character_id: 2, round: 2, kind: 'check', skill: 'History', success: 1 }];
  assert.deepEqual(rules.challengeSuggestedOutcome(challenge, won), { suggested: 'minor', choices: ['clean', 'minor', 'serious'] });
  const lost = [...attempts, { character_id: 2, round: 2, kind: 'check', skill: 'History', success: 0 }];
  assert.deepEqual(rules.challengeSuggestedOutcome(challenge, lost), { suggested: null, choices: ['grave', 'failed'] }, 'at the failure limit the DM decides');

  const order = rules.challengeTurnOrder([{ character_id: 1, name: 'B', initiative: 10 }, { character_id: 2, name: 'A', initiative: 18 }, { character_id: 3, name: 'C', initiative: null }]);
  assert.deepEqual(order.map(entry => entry.character_id), [2, 1, 3]);
  assert.deepEqual(rules.challengeNextTurn(order, 1, 1), { characterId: 3, round: 1 });
  assert.deepEqual(rules.challengeNextTurn(order, 3, 1), { characterId: 2, round: 2 }, 'after the last, a new round');
  assert.equal(rules.challengeModeWithHelp('normal', true), 'advantage');
  assert.equal(rules.challengeModeWithHelp('disadvantage', true), 'normal');
});

test('a skill challenge on the adventure table: turns, checks against the hidden DC, Help, a spell, the DM\'s rulings, the end', () => {
  const { kael, brin, asDm, adventureId, asOla, asTom } = setUp();
  assert.throws(() => db.createSkillChallenge({ adventureId, user: asOla, settings: { name: 'Escape' } }), /Forbidden/);
  let table = db.createSkillChallenge({ adventureId, user: asDm, settings: { name: 'Escape the gnolls', successesNeeded: 3, failuresAllowed: 2, dc: 12, skills: ['Athletics', 'Stealth'] } });
  const id = table.challenges.list[0].id;
  assert.equal(db.getAdventureTable({ adventureId, user: asOla }).challenges.running, null, 'planned: the DM\'s secret');

  assert.throws(() => db.setChallengeInitiative({ adventureId, user: asDm, challengeId: id, characterId: kael, initiative: 5 }), /not in the skill challenge/, 'not joined yet');
  table = db.runSkillChallenge({ adventureId, user: asDm, challengeId: id });
  assert.deepEqual(running(table).participants.map(p => p.name).sort(), ['Brin', 'Kael'], 'the party joins');
  // Initiative rolled from the sheet sets the order.
  db.rollForCharacter({ characterId: brin, user: asTom, request: { roll: 'initiative' } });
  db.setChallengeInitiative({ adventureId, user: asDm, challengeId: id, characterId: kael, initiative: 30 });
  db.setChallengeInitiative({ adventureId, user: asDm, challengeId: id, characterId: brin, initiative: 2 });
  let view = running(db.getAdventureTable({ adventureId, user: asOla }));
  assert.equal(view.dc, undefined, 'players never see the DC');
  assert.deepEqual([view.successes, view.successesNeeded], [0, 3], 'the tally is shown');
  assert.equal(view.participants.find(p => p.characterId === kael).allowedSkills.length, 18);
  assert.deepEqual(view.participants.find(p => p.characterId === brin).allowedSkills, [], "not Ola's character");

  // Run order: the turn started with whoever was first when it began; the DM sets it to Kael by skipping as needed.
  table = db.getAdventureTable({ adventureId, user: asDm });
  if (running(table).turnCharacterId !== kael) db.skipChallengeTurn({ adventureId, user: asDm, challengeId: id });
  assert.throws(() => db.rollChallengeCheck({ adventureId, user: asTom, challengeId: id, characterId: brin, skill: 'Athletics' }), /not Brin's turn/);
  assert.throws(() => db.rollChallengeCheck({ adventureId, user: asTom, challengeId: id, characterId: kael, skill: 'Athletics' }), /Forbidden/);

  // Kael helps with Insight; Brin rolls Stealth with Advantage.
  const startRound = running(db.getAdventureTable({ adventureId, user: asDm })).round;
  db.helpInChallenge({ adventureId, user: asOla, challengeId: id, characterId: kael, skill: 'Insight' });
  view = running(db.getAdventureTable({ adventureId, user: asDm }));
  assert.deepEqual([view.helpBy, view.turnCharacterId], ['Kael', brin]);
  const first = db.rollChallengeCheck({ adventureId, user: asTom, challengeId: id, characterId: brin, skill: 'Stealth' });
  assert.equal(first.roll.mode, 'advantage', 'Helped');
  assert.match(first.roll.label, /^Skill challenge: Escape the gnolls: Stealth/);
  assert.equal(first.success, first.roll.total >= 12);
  view = running(first.table);
  assert.deepEqual([view.round, view.turnCharacterId, view.helpBy], [startRound + 1, kael, null], 'a new round, Help used up');
  // Kael can't use Insight again; a spell counts as a success (once).
  assert.throws(() => db.rollChallengeCheck({ adventureId, user: asOla, challengeId: id, characterId: kael, skill: 'Insight' }), /already used by this character/);
  assert.throws(() => db.featureSuccess({ adventureId, user: asOla, challengeId: id, characterId: kael, what: 'Fly' }), /Forbidden/);
  db.featureSuccess({ adventureId, user: asDm, challengeId: id, characterId: kael, what: 'Fly across the river' });
  assert.throws(() => db.featureSuccess({ adventureId, user: asDm, challengeId: id, characterId: kael, what: 'Again' }), /already had a spell/);
  // Brin's Stealth again is blocked; the DM can allow it.
  assert.throws(() => db.rollChallengeCheck({ adventureId, user: asTom, challengeId: id, characterId: brin, skill: 'Stealth' }), /already used by this character/);
  const allowed = db.rollChallengeCheck({ adventureId, user: asDm, challengeId: id, characterId: brin, skill: 'Stealth', override: true });

  // The DM rules on a roll: a stretch raises its DC by 5; a void takes it back.
  view = running(allowed.table);
  const last = view.attempts[view.attempts.length - 1];
  db.raiseChallengeAttemptDc({ adventureId, user: asDm, challengeId: id, attemptId: last.id });
  let raised = running(db.getAdventureTable({ adventureId, user: asDm })).attempts.find(attempt => attempt.id === last.id);
  assert.deepEqual([raised.dc, raised.success], [17, last.total >= 17 ? 1 : 0]);
  db.voidChallengeAttempt({ adventureId, user: asDm, challengeId: id, attemptId: last.id });
  raised = running(db.getAdventureTable({ adventureId, user: asDm })).attempts.find(attempt => attempt.id === last.id);
  assert.equal(raised.voided, true);

  // Ending: the choices follow the tally.
  assert.throws(() => db.endSkillChallenge({ adventureId, user: asDm, challengeId: id, outcome: 'nonsense' }), /Choose how it ended/);
  const ended = db.endSkillChallenge({ adventureId, user: asDm, challengeId: id, outcome: 'stopped', note: 'The river took them.' });
  assert.equal(ended.challenge.status, 'done');
  assert.equal(running(ended.table), null);
  assert.deepEqual(db.getAdventureTable({ adventureId, user: asOla }).challenges.finished.map(entry => [entry.outcome, entry.note]), [['stopped', 'The river took them.']]);
});

test('a decided challenge: no more rolls, and at the failure limit the DM picks failed or grave', () => {
  const { kael, brin, asDm, adventureId, asOla } = setUp();
  let table = db.createSkillChallenge({ adventureId, user: asDm, settings: { name: 'Hold the bridge', successesNeeded: 5, failuresAllowed: 1, dc: 40, showTally: false } });
  const id = table.challenges.list.find(entry => entry.name === 'Hold the bridge').id;
  db.runSkillChallenge({ adventureId, user: asDm, challengeId: id });
  const hidden = running(db.getAdventureTable({ adventureId, user: asOla }));
  assert.deepEqual([hidden.successes, hidden.failuresAllowed], [null, null], 'the DM hid the tally');
  const turn = running(db.getAdventureTable({ adventureId, user: asDm })).turnCharacterId;
  const result = db.rollChallengeCheck({ adventureId, user: asDm, challengeId: id, characterId: turn, skill: 'Athletics' });
  assert.equal(result.success, false, 'DC 40');
  const dmView = running(result.table);
  assert.equal(dmView.finishedBy, 'failures');
  assert.deepEqual(dmView.ending.choices, ['grave', 'failed']);
  const other = turn === kael ? brin : kael;
  assert.throws(() => db.rollChallengeCheck({ adventureId, user: asDm, challengeId: id, characterId: other, skill: 'Stealth' }), /decided/);
  assert.throws(() => db.endSkillChallenge({ adventureId, user: asDm, challengeId: id, outcome: 'clean' }), /Choose how it ended/);
  assert.equal(db.endSkillChallenge({ adventureId, user: asDm, challengeId: id, outcome: 'grave', note: 'They hold it, barely.' }).challenge.outcome, 'grave');
});

test('skill challenges over HTTP (the panel) and from Owlbear with a key', async () => {
  const express = require('express');
  const { dm, ola, tom, kael, brin, adventureId } = setUp();
  db.prepare("UPDATE players SET password_hash = 'x' WHERE id IN (?, ?, ?)").run(dm, ola, tom);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  app.use('/vtt', require('../vtt'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (userId, path, body) => {
    const response = await fetch(`${base}/api/adventures/${adventureId}${path}`, {
      method: 'POST', headers: { 'x-user': String(userId), 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call(ola, '/challenges', { name: 'Escape' })).status, 403);
    let result = await call(dm, '/challenges', { name: 'Escape the gnolls', successesNeeded: 2, failuresAllowed: 2, dc: 1, showTally: false });
    assert.equal(result.status, 200);
    const id = result.body.challenges.list[0].id;
    assert.equal((await call(dm, '/challenges/999999/run')).status, 404);
    result = await call(dm, `/challenges/${id}/run`);
    assert.equal(result.body.challenges.running.participants.length, 2, 'the whole party joins');
    await call(dm, `/challenges/${id}/initiative`, { characterId: kael, initiative: 20 });
    await call(dm, `/challenges/${id}/initiative`, { characterId: brin, initiative: 5 });

    // Brin's player can't act on Kael's turn; Kael's player can.
    assert.equal((await call(tom, `/challenges/${id}/turn`, { characterId: brin, action: 'check', skill: 'Athletics' })).status, 400);
    result = await call(ola, `/challenges/${id}/turn`, { characterId: kael, action: 'check', skill: 'Stealth' });
    assert.equal(result.status, 200);
    assert.equal(result.body.lastRoll.success, true, 'DC 1 always passes');
    assert.equal(result.body.challenges.running.successes, null, 'the tally is hidden from players');
    assert.ok(!('dc' in result.body.challenges.running), 'and so is the DC');

    // Owlbear: Brin's turn now, with Tom's key.
    const tomKey = db.getVttKey({ playerId: tom });
    const dmKey = db.getVttKey({ playerId: dm });
    let owlbear = await (await fetch(`${base}/vtt/challenges?key=${tomKey}`)).json();
    assert.equal(owlbear.challenges.length, 1);
    assert.equal(owlbear.challenges[0].dm, false);
    assert.equal(owlbear.challenges[0].participants.find(p => p.characterId === brin).turn, true);
    const post = (key, body) => fetch(`${base}/vtt/challenges/${adventureId}/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, ...body })
    });
    assert.equal((await post('nope-not-a-key', { action: 'skip' })).status, 401);
    assert.equal((await post(tomKey, { action: 'skip' })).status, 403, 'only the DM skips');
    let response = await post(tomKey, { action: 'check', characterId: brin, skill: 'Athletics' });
    assert.equal(response.status, 200);
    owlbear = await response.json();
    assert.equal(owlbear.challenges[0].finishedBy, 'done', 'two successes: decided');

    // The DM rules from Owlbear: void Brin's roll.
    const dmView = await (await fetch(`${base}/vtt/challenges?key=${dmKey}`)).json();
    assert.equal(dmView.challenges[0].dm, true);
    assert.equal(dmView.challenges[0].dc, 1);
    const brinRoll = dmView.challenges[0].attempts.find(attempt => attempt.characterId === brin);
    owlbear = await (await post(dmKey, { action: 'void', attemptId: brinRoll.id })).json();
    assert.equal(owlbear.challenges[0].successes, 1);

    // The end, without Discord.
    assert.equal((await call(ola, `/challenges/${id}/end`, { outcome: 'stopped' })).status, 403);
    result = await call(dm, `/challenges/${id}/end`, { outcome: 'stopped', note: 'The river rose.', post: false });
    assert.equal(result.status, 200);
    assert.equal(result.body.challenges.running, null);
    assert.equal(result.body.challenges.finished[0].note, 'The river rose.');
    assert.deepEqual((await (await fetch(`${base}/vtt/challenges?key=${tomKey}`)).json()).challenges, []);
  } finally {
    server.close();
  }
});

test('a skill roll from the character sheet counts as the challenge turn when the player says so', async () => {
  const express = require('express');
  const { dm, ola, tom, kael, brin, asDm, adventureId, asOla, asTom } = setUp();
  db.prepare("UPDATE players SET password_hash = 'x' WHERE id IN (?, ?, ?)").run(dm, ola, tom);
  let table = db.createSkillChallenge({ adventureId, user: asDm, settings: { name: 'Cross the bog', successesNeeded: 3, failuresAllowed: 3, dc: 1 } });
  const id = table.challenges.list[0].id;
  db.runSkillChallenge({ adventureId, user: asDm, challengeId: id });
  db.setChallengeInitiative({ adventureId, user: asDm, challengeId: id, characterId: kael, initiative: 15 });
  db.setChallengeInitiative({ adventureId, user: asDm, challengeId: id, characterId: brin, initiative: 3 });

  assert.equal(db.challengeTurnForCharacter({ characterId: brin, user: asTom }), null, 'not Brin\'s turn');
  assert.equal(db.challengeTurnForCharacter({ characterId: kael, user: asTom }), null, 'not Tom\'s character');
  const turn = db.challengeTurnForCharacter({ characterId: kael, user: asOla });
  assert.equal(turn.name, 'Cross the bog');
  assert.ok(turn.allowedSkills.includes('Survival'));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/characters`;
  const post = (userId, characterId, body) => fetch(`${base}/${characterId}/roll`, {
    method: 'POST', headers: { 'x-user': String(userId), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await (await fetch(`${base}/${kael}/challenge-turn`, { headers: { 'x-user': String(ola) } })).json()).turn.challengeId, id);
    // "Cancel" on the sheet: a normal roll, the challenge untouched.
    let response = await post(ola, kael, { roll: 'skill:Survival' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).challenge, undefined);
    assert.equal(db.getAdventureTable({ adventureId, user: asDm }).challenges.running.attempts.length, 0);
    // "OK": the challenge turn.
    response = await post(ola, kael, { roll: 'skill:Survival', challenge: true });
    const roll = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(roll.challenge, { name: 'Cross the bog', success: true });
    assert.match(roll.label, /Skill challenge: Cross the bog/);
    const running = db.getAdventureTable({ adventureId, user: asDm }).challenges.running;
    assert.equal(running.attempts.length, 1);
    assert.equal(running.participants.find(p => p.turn).characterId, brin, 'the turn moved on');
    // Too late now: it's Brin's turn.
    response = await post(ola, kael, { roll: 'skill:Nature', challenge: true });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});
