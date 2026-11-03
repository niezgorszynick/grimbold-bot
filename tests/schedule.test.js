const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');
const scheduleDiscord = require('../scheduleDiscord');
const scheduleCommand = require('../commands/schedule');
const sessionsCommand = require('../commands/sessions');

// Tuesday 3 November 2026, 13:00 in Poland.
const NOW = new Date('2026-11-03T12:00:00Z');
const discordIdOf = playerId => db.prepare('SELECT discord_id FROM players WHERE id = ?').get(playerId).discord_id;

test('session times in Polish time: day names, dates, summer and winter time', () => {
  const at = text => rules.parseSessionTime(text, NOW).toISOString();
  assert.equal(at('pt 20:00'), '2026-11-06T19:00:00.000Z', 'Friday, winter time (UTC+1)');
  assert.equal(at('piątek 20'), '2026-11-06T19:00:00.000Z');
  assert.equal(at('fri 8pm'), '2026-11-06T19:00:00.000Z');
  assert.equal(at('sob 18'), '2026-11-07T17:00:00.000Z');
  assert.equal(at('jutro 19:30'), '2026-11-04T18:30:00.000Z');
  assert.equal(at('wt 14:00'), '2026-11-03T13:00:00.000Z', 'later today');
  assert.equal(at('wt 12:00'), '2026-11-10T11:00:00.000Z', 'already past today: next week');
  assert.equal(at('7.11 20:00'), '2026-11-07T19:00:00.000Z');
  assert.equal(at('2027-04-02 20:00'), '2027-04-02T18:00:00.000Z', 'summer time (UTC+2)');
  assert.equal(at('2.4 20:00'), '2027-04-02T18:00:00.000Z', 'a date already gone this year is next year');
  assert.throws(() => rules.parseSessionTime('pt', NOW), /add a time/);
  assert.throws(() => rules.parseSessionTime('someday 20:00', NOW), /can't read the day/);
  assert.throws(() => rules.parseSessionTime('31.2 20:00', NOW), /no such date/);
  assert.throws(() => rules.parseSessionTime('2026-11-01 20:00', NOW), /in the past/);
  assert.deepEqual(rules.parseSessionTimes('pt 20:00, sob 18;pt 20:00', NOW).map(rules.formatSessionTime), ['Fri 6 Nov, 20:00', 'Sat 7 Nov, 18:00']);
  assert.throws(() => rules.parseSessionTimes('pn 18, wt 18, sr 18, czw 18, pt 18', NOW), /At most 4/);
});

function setUp() {
  const dm = createPlayer('admin');
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Kael', 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')`).run(ola).lastInsertRowid);
  const first = db.createAdventureFromThread({ threadId: `thread-a-${dm}`, guildId: 'guild', title: 'Wilki z Doliny', ownerDiscordId: discordIdOf(dm) }).adventure;
  const second = db.createAdventureFromThread({ threadId: `thread-b-${dm}`, guildId: 'guild', title: 'Zniknęły dynie', ownerDiscordId: discordIdOf(dm) }).adventure;
  return { dm, ola, tom, kael, first, second };
}

test('a poll: answers, the DM locks a time in, clashes are warned about, reminders a day before', () => {
  const { dm, ola, tom, kael, first, second } = setUp();
  const [dmId, olaId, tomId] = [dm, ola, tom].map(discordIdOf);
  const friday = rules.parseSessionTime('pt 20:00', NOW);
  const saturday = rules.parseSessionTime('sob 18:00', NOW);

  assert.throws(() => db.createSchedulePoll({ adventureId: first.id, byDiscordId: olaId, times: [friday] }), /Only this adventure's DM/);
  let poll = db.createSchedulePoll({ adventureId: first.id, byDiscordId: dmId, times: [friday, saturday], minutes: 180 });
  assert.deepEqual(poll.options.map(option => [option.letter, option.startsAt, option.endsAt]),
    [['A', '2026-11-06T19:00:00.000Z', '2026-11-06T22:00:00.000Z'], ['B', '2026-11-07T17:00:00.000Z', '2026-11-07T20:00:00.000Z']]);

  db.voteOnSession({ optionId: poll.options[0].id, discordId: olaId, name: 'Ola', answer: 'yes' });
  db.voteOnSession({ optionId: poll.options[0].id, discordId: tomId, name: 'Tom', answer: 'maybe' });
  ({ poll } = db.voteOnSession({ optionId: poll.options[0].id, discordId: tomId, name: 'Tom', answer: 'no' }));
  assert.deepEqual([poll.options[0].yes.map(v => v.name), poll.options[0].maybe, poll.options[0].no.map(v => v.name)], [['Ola'], [], ['Tom']], 'a new answer replaces the old one');
  assert.throws(() => db.voteOnSession({ optionId: poll.options[0].id, discordId: olaId, answer: 'perhaps' }), /yes, maybe or no/);

  assert.throws(() => db.confirmSessionOption({ pollId: poll.id, optionId: poll.options[0].id, byDiscordId: olaId }), /Only this adventure's DM/);
  const locked = db.confirmSessionOption({ pollId: poll.id, optionId: poll.options[0].id, byDiscordId: dmId });
  assert.equal(locked.session.startsAt, '2026-11-06T19:00:00.000Z');
  assert.equal(locked.poll.status, 'confirmed');
  assert.throws(() => db.voteOnSession({ optionId: poll.options[1].id, discordId: olaId, answer: 'yes' }), /closed/);

  // Another adventure at an overlapping time: Ola (✅ above) and Kael's party place both count.
  db.setPartyMember({ adventureId: second.id, user: { id: 0, role: 'admin' }, characterId: kael, inParty: true });
  const clashPoll = db.createSchedulePoll({ adventureId: second.id, byDiscordId: dmId, times: [rules.parseSessionTime('pt 21:00', NOW)] });
  const { clashes } = db.voteOnSession({ optionId: clashPoll.options[0].id, discordId: olaId, name: 'Ola', answer: 'yes' });
  assert.deepEqual(clashes.map(session => session.adventure), ['Wilki z Doliny']);
  assert.equal(db.getSchedulePoll(clashPoll.id).options[0].clashes[0].name, 'Ola');
  const second_ = db.confirmSessionOption({ pollId: clashPoll.id, optionId: clashPoll.options[0].id, byDiscordId: dmId });
  assert.deepEqual(second_.dmClashes.map(session => session.adventure), ['Wilki z Doliny'], 'the DM is warned, not stopped');

  // The overview, everyone's or one person's, with the clash marked.
  const all = db.upcomingSessions({ now: NOW });
  assert.deepEqual(all.map(session => session.adventure), ['Wilki z Doliny', 'Zniknęły dynie']);
  assert.ok(all[0].clashes.some(clash => clash.adventure === 'Zniknęły dynie'));
  assert.deepEqual(db.upcomingSessions({ now: NOW, discordId: tomId }).map(session => session.adventure), [], 'Tom said no and has no character there');

  // Reminders: once, within a day of the start.
  assert.deepEqual(db.takeDueReminders(NOW), [], 'three days ahead: not yet');
  const dayBefore = new Date('2026-11-05T20:00:00Z');
  const due = db.takeDueReminders(dayBefore);
  assert.deepEqual(due.map(session => session.adventure), ['Wilki z Doliny', 'Zniknęły dynie']);
  assert.ok(due[0].people.includes(olaId) && due[0].people.includes(dmId));
  assert.deepEqual(db.takeDueReminders(dayBefore), [], 'only once');

  // The panel's adventure table shows it.
  const table = db.getAdventureTable({ adventureId: first.id, user: { id: 0, role: 'admin' } });
  assert.equal(table.schedule.nextSession.text, 'Fri 6 Nov, 20:00');

  // Cancelling the next session.
  const cancelled = db.cancelNextSession({ adventureId: first.id, byDiscordId: dmId, now: NOW });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(db.nextSessionForAdventure(first.id, NOW), null);
});

// ─── Discord, with a stand-in for its objects ──────────────────────────────

function fakeInteraction({ userId, channelId, customId, values, subcommand, strings = {}, numbers = {}, booleans = {} }) {
  const calls = { replies: [], updates: [], followUps: [], sent: [], events: [] };
  const interaction = {
    user: { id: userId, username: 'user', globalName: null },
    member: { displayName: `Name-${userId}` },
    channelId,
    customId,
    values,
    replied: false,
    deferred: false,
    guild: {
      scheduledEvents: {
        create: async options => { calls.events.push(options); return { id: 'event-1' }; },
        delete: async id => { calls.events.push({ deleted: id }); }
      }
    },
    channel: { send: async message => { calls.sent.push(message); } },
    client: { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async () => {} }) } }) } },
    options: {
      getSubcommand: () => subcommand,
      getString: name => strings[name] ?? null,
      getNumber: name => numbers[name] ?? null,
      getBoolean: name => booleans[name] ?? null
    },
    reply: async message => { interaction.replied = true; calls.replies.push(message); },
    fetchReply: async () => ({ id: 'message-1', channelId }),
    update: async message => { interaction.replied = true; calls.updates.push(message); },
    followUp: async message => { calls.followUps.push(message); }
  };
  return { interaction, calls };
}

test('in Discord: /schedule posts the poll, buttons answer it, the DM locks it in with a server event', async () => {
  const { dm, ola, first } = setUp();
  const [dmId, olaId] = [dm, ola].map(discordIdOf);

  // Outside an adventure thread, or not the DM: told politely.
  let fake = fakeInteraction({ userId: dmId, channelId: 'some-channel', subcommand: 'propose', strings: { times: 'pt 20:00' } });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /adventure's thread/);
  fake = fakeInteraction({ userId: olaId, channelId: first.discord_thread_id, subcommand: 'propose', strings: { times: 'pt 20:00' } });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Only the DM/);
  fake = fakeInteraction({ userId: dmId, channelId: first.discord_thread_id, subcommand: 'propose', strings: { times: 'someday' } });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /add a time|can't read/);

  // The poll: a row of ✅ 🤔 ❌ per time, and the DM's menu.
  fake = fakeInteraction({ userId: dmId, channelId: first.discord_thread_id, subcommand: 'propose', strings: { times: 'pt 20:00, sob 18:00' }, numbers: { hours: 3 } });
  await scheduleCommand.execute(fake.interaction);
  const posted = fake.calls.replies[0];
  const rows = posted.components.map(row => row.toJSON());
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].components.map(button => button.label), ['✅ A', '🤔 A', '❌ A']);
  assert.equal(rows[2].components[0].custom_id.startsWith('sched:lock:'), true);
  const poll = db.openPollForAdventure(first.id);
  assert.equal(poll.messageId, 'message-1');
  assert.equal(poll.minutes, 180);

  // A button press answers and redraws the message.
  fake = fakeInteraction({ userId: olaId, customId: `sched:v:${poll.options[0].id}:yes` });
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  const embed = fake.calls.updates[0].embeds[0].toJSON();
  assert.match(embed.fields[0].value, new RegExp(`✅ Name-${olaId}`));

  // Only the DM locks in; then the announcement and the server event.
  fake = fakeInteraction({ userId: olaId, customId: `sched:lock:${poll.id}`, values: [String(poll.options[0].id)] });
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Only this adventure's DM/);
  fake = fakeInteraction({ userId: dmId, customId: `sched:lock:${poll.id}`, values: [String(poll.options[0].id)] });
  fake.interaction.channel = { send: async message => fake.calls.sent.push(message) };
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  assert.deepEqual(fake.calls.updates[0].components, [], 'the buttons go once a time is set');
  // /schedule reads times against the real clock: "pt 20:00" is the coming Friday.
  const friday = rules.parseSessionTime('pt 20:00');
  assert.ok(fake.calls.sent[0].content.includes(`Wilki z Doliny**: <t:${friday.getTime() / 1000}:F>`));
  assert.deepEqual(fake.calls.sent[0].allowedMentions, { users: [olaId] });
  assert.equal(fake.calls.events[0].name, 'Wilki z Doliny');
  assert.equal(fake.calls.events[0].scheduledStartTime.toISOString(), friday.toISOString());
  assert.equal(db.nextSessionForAdventure(first.id).eventId, 'event-1');
  assert.match(fake.calls.followUps[0].content, /server's Events/);

  // /sessions lists it; /schedule cancel calls it off and deletes the event.
  fake = fakeInteraction({ userId: olaId, booleans: { mine: true } });
  await sessionsCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Wilki z Doliny/);
  assert.equal(fake.calls.replies[0].ephemeral, true);
  fake = fakeInteraction({ userId: dmId, channelId: first.discord_thread_id, subcommand: 'cancel' });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /cancelled/);
  assert.deepEqual(fake.calls.events, [{ deleted: 'event-1' }]);
});
