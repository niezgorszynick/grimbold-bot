const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');
const scheduleDiscord = require('../scheduleDiscord');
const scheduleCommand = require('../commands/schedule');
const sessionsCommand = require('../commands/sessions');
const campaignCommand = require('../commands/campaign');

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
  const table = db.getAdventureTable({ adventureId: first.id, user: { id: 0, role: 'admin' }, now: NOW });
  assert.equal(table.schedule.nextSession.text, 'Fri 6 Nov, 20:00');

  // Cancelling the next session.
  const cancelled = db.cancelNextSession({ adventureId: first.id, byDiscordId: dmId, now: NOW });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(db.nextSessionForAdventure(first.id, NOW), null);
});

// ─── Discord, with a stand-in for its objects ──────────────────────────────

function fakeInteraction({ userId, channelId, customId, values, subcommand, strings = {}, numbers = {}, booleans = {}, users = {} }) {
  const calls = { replies: [], updates: [], followUps: [], sent: [], events: [] };
  const interaction = {
    user: { id: userId, username: 'user', globalName: null },
    member: { displayName: `Name-${userId}` },
    channelId,
    guildId: 'guild',
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
      getBoolean: name => booleans[name] ?? null,
      getUser: name => (users[name] ? { id: users[name], username: 'u', globalName: null, toString: () => `<@${users[name]}>` } : null),
      getMember: name => (users[name] ? { displayName: `Name-${users[name]}` } : null)
    },
    reply: async message => { interaction.replied = true; calls.replies.push(message); },
    fetchReply: async () => ({ id: 'message-1', channelId }),
    update: async message => { interaction.replied = true; calls.updates.push(message); },
    followUp: async message => { calls.followUps.push(message); },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async message => { calls.replies.push(typeof message === 'string' ? { content: message } : message); }
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

  // /schedule reads times against the real clock: "pt 20:00" is the coming Friday
  // (the poll lists times in order, so on a Saturday it isn't the first one).
  const friday = rules.parseSessionTime('pt 20:00');
  const fridayOption = poll.options.find(option => option.startsAt === friday.toISOString());

  // A button press answers and redraws the message.
  fake = fakeInteraction({ userId: olaId, customId: `sched:v:${fridayOption.id}:yes` });
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  const embed = fake.calls.updates[0].embeds[0].toJSON();
  assert.match(embed.fields[fridayOption.letter.charCodeAt(0) - 65].value, new RegExp(`✅ Name-${olaId}`));

  // Only the DM locks in Friday; then the announcement and the server event.
  fake = fakeInteraction({ userId: olaId, customId: `sched:lock:${poll.id}`, values: [String(fridayOption.id)] });
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Only this adventure's DM/);
  fake = fakeInteraction({ userId: dmId, customId: `sched:lock:${poll.id}`, values: [String(fridayOption.id)] });
  fake.interaction.channel = { send: async message => fake.calls.sent.push(message) };
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  assert.deepEqual(fake.calls.updates[0].components, [], 'the buttons go once a time is set');
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
  assert.match(fake.calls.replies[0].content, /Cancelled/);
  assert.match(fake.calls.sent[0].content, /Wilki z Doliny\*\* on <t:\d+:F> is cancelled/);
  assert.deepEqual(fake.calls.events, [{ deleted: 'event-1' }]);
});

test('book, move and cancel straight away (Discord or panel); calendars follow with a change count', async () => {
  const { dm, ola, tom, kael, first } = setUp();
  const [dmId, olaId] = [dm, ola].map(discordIdOf);
  db.setPartyMember({ adventureId: first.id, user: { id: 0, role: 'admin' }, characterId: kael, inParty: true });
  const asPanelPlayer = { user: { id: tom, role: 'player' } };
  const sunday = rules.parseDateAndTime('2026-11-22', '20:00', NOW);
  assert.equal(sunday.toISOString(), '2026-11-22T19:00:00.000Z');

  assert.throws(() => db.bookSession({ adventureId: first.id, by: asPanelPlayer, startsAt: sunday, now: NOW }), /Only this adventure's DM/);
  assert.throws(() => db.bookSession({ adventureId: first.id, by: { discordId: dmId }, startsAt: new Date('2026-11-01T19:00:00Z'), now: NOW }), /in the past/);
  const { session } = db.bookSession({ adventureId: first.id, by: { discordId: dmId }, startsAt: sunday, minutes: 180, now: NOW });
  assert.deepEqual([session.startsAt, session.endsAt, session.sequence], ['2026-11-22T19:00:00.000Z', '2026-11-22T22:00:00.000Z', 0]);
  assert.deepEqual(db.sessionPeopleIds(session.id).sort(), [dmId, olaId].sort(), 'its DM and the party');

  // Moved from the panel (the DM's account): length kept, the reminder will go out again.
  const moved = db.moveSession({ adventureId: first.id, by: { user: { id: dm, role: 'admin' } }, startsAt: rules.parseDateAndTime('2026-11-29', '18:00', NOW), now: NOW });
  assert.deepEqual([moved.session.startsAt, moved.session.minutes, moved.session.sequence, moved.previousStartsAt], ['2026-11-29T17:00:00.000Z', 180, 1, '2026-11-22T19:00:00.000Z']);
  assert.deepEqual(db.adventureSessions(first.id, NOW).map(entry => entry.id), [session.id]);

  // Ola's calendar feed: the session, then marked cancelled.
  const token = db.calendarTokenFor(olaId);
  assert.equal(db.calendarTokenFor(olaId), token, 'one link per person');
  assert.equal(db.calendarSessions('not-a-real-token-xyz', NOW), null);
  assert.deepEqual(db.calendarSessions(token, NOW).sessions.map(entry => entry.adventure), ['Wilki z Doliny']);
  assert.deepEqual(db.calendarSessions(db.calendarTokenFor('stranger'), NOW).sessions, [], "someone not in it doesn't get it");
  const cancelled = db.cancelSession({ sessionId: session.id, by: { discordId: dmId }, now: NOW });
  assert.deepEqual([cancelled.status, cancelled.sequence], ['cancelled', 2]);
  const ics = rules.sessionsCalendar(db.calendarSessions(token, NOW).sessions, { now: NOW });
  assert.match(ics, new RegExp(`UID:grimbold-session-${session.id}@grimbold`));
  assert.match(ics, /SEQUENCE:2\r\n/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:\[Cancelled\] Wilki z Doliny/);
  assert.throws(() => db.moveSession({ sessionId: session.id, by: { discordId: dmId }, startsAt: sunday, now: NOW }), /cancelled/);

  // The feed over HTTP, as a calendar app fetches it.
  const express = require('express');
  const app = express();
  app.use('/calendar', require('../calendar'));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/calendar/${token}.ics`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/calendar/);
    assert.match(await response.text(), /BEGIN:VCALENDAR[\s\S]*Wilki z Doliny/);
    assert.equal((await fetch(`${base}/calendar/nope-nope-nope-nope.ics`)).status, 404);
  } finally {
    server.close();
  }
});

test('in Discord: date and time pickers, set and move, and the calendar button', async () => {
  const { dm, ola, first } = setUp();
  const [dmId, olaId] = [dm, ola].map(discordIdOf);
  process.env.PANEL_URL = 'https://panel.example/';

  // The pickers.
  const responses = [];
  const picker = (name, value, subcommand = 'set') => ({
    options: { getFocused: () => ({ name, value }), getSubcommand: () => subcommand },
    respond: async choices => responses.push(choices)
  });
  await scheduleCommand.autocomplete(picker('date', '22.11'));
  assert.ok(responses[0].length >= 1 && /^\w{3} 22 \w{3} \d{4}/.test(responses[0][0].name));
  await scheduleCommand.autocomplete(picker('time', '19'));
  assert.deepEqual(responses[1].map(choice => choice.value), ['19:00', '19:30']);
  await scheduleCommand.autocomplete(picker('times', 'pt 20:00, 31.11 18', 'propose'));
  assert.match(responses[2][0].name, /^⚠ "31.11 18": there is no such date/);

  // /schedule set with picked values: announced in the thread with the calendar button, a server event.
  const date = rules.dateSuggestions('', new Date())[10].value;
  let fake = fakeInteraction({ userId: dmId, channelId: first.discord_thread_id, subcommand: 'set', strings: { date, time: '20:00' } });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Booked/);
  assert.match(fake.calls.sent[0].content, /circles the date twice/);
  assert.equal(fake.calls.sent[0].components[0].toJSON().components[0].custom_id, 'sched:cal');
  assert.equal(fake.calls.events.length, 1);
  const booked = db.nextSessionForAdventure(first.id);
  assert.equal(rules.warsawInputs(booked.startsAt).date, date);

  // /schedule move edits the same server event.
  const later = rules.dateSuggestions('', new Date())[12].value;
  fake = fakeInteraction({ userId: dmId, channelId: first.discord_thread_id, subcommand: 'move', strings: { date: later, time: '18:30' } });
  fake.interaction.guild.scheduledEvents.edit = async (id, changes) => fake.calls.events.push({ edited: id, start: changes.scheduledStartTime.toISOString() });
  await scheduleCommand.execute(fake.interaction);
  assert.match(fake.calls.sent[0].content, /moves from <t:\d+:F> to \*\*<t:\d+:F>\*\*/);
  assert.deepEqual(fake.calls.events.map(entry => entry.edited), ['event-1']);

  // The calendar button: personal links, only for the one who pressed it.
  fake = fakeInteraction({ userId: olaId, customId: 'sched:cal' });
  await scheduleDiscord.handleScheduleInteraction(fake.interaction);
  assert.equal(fake.calls.replies[0].ephemeral, true);
  const feed = `panel.example%2Fcalendar%2F${db.calendarTokenFor(olaId)}.ics`;
  assert.ok(fake.calls.replies[0].content.includes(`https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F${feed}`), 'Google subscribes to the webcal feed');
  assert.ok(fake.calls.replies[0].content.includes(`webcal://panel.example/calendar/${db.calendarTokenFor(olaId)}.ics`), 'Apple opens the webcal link');
});

test('campaigns: sessions outside adventure threads, in the same calendar (clashes, feeds, /sessions)', async () => {
  const { dm, ola, tom, kael, first } = setUp();
  const [dmId, olaId, tomId] = [dm, ola, tom].map(discordIdOf);
  db.setPartyMember({ adventureId: first.id, user: { id: 0, role: 'admin' }, characterId: kael, inParty: true });
  const outsider = `campaign-dm-${dm}`;
  const sunday = rules.parseDateAndTime('2026-11-22', '20:00', NOW);

  // Only DMs, or those named in CAMPAIGN_DM_IDS, start campaigns.
  assert.throws(() => db.createCampaign({ name: 'Klątwa Strahda', by: { discordId: outsider } }), /Only DMs/);
  process.env.CAMPAIGN_DM_IDS = `123, ${outsider}`;
  let fake = fakeInteraction({ userId: outsider, channelId: `campaign-channel-${dm}`, subcommand: 'create', strings: { name: 'Klątwa  Strahda' } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /\*\*Klątwa Strahda\*\*, DM <@/);
  const campaign = db.listCampaigns({ manageableBy: outsider }).find(entry => entry.name === 'Klątwa Strahda');
  assert.ok(campaign);
  assert.throws(() => db.createCampaign({ name: 'klątwa strahda', by: { discordId: outsider } }), /already/);

  // Players: only its DM (or another DM) adds them.
  fake = fakeInteraction({ userId: olaId, subcommand: 'add', strings: { campaign: String(campaign.id) }, users: { player: olaId } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Only the DM of Klątwa Strahda/);
  fake = fakeInteraction({ userId: outsider, subcommand: 'add', strings: { campaign: String(campaign.id) }, users: { player: olaId } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /is in \*\*Klątwa Strahda\*\* \(1 players\)/);
  db.setCampaignMember({ campaignId: campaign.id, by: { discordId: dmId }, discordId: tomId, name: 'Tom' });
  db.setCampaignMember({ campaignId: campaign.id, by: { discordId: outsider }, discordId: tomId, member: false });
  assert.deepEqual(db.getCampaign(campaign.id).members.map(m => m.discordId), [olaId]);

  // The one-shot Ola is in, then a campaign session at the same time: a clash.
  db.bookSession({ adventureId: first.id, by: { discordId: dmId }, startsAt: sunday, now: NOW });
  // About ten days ahead, but never the Sunday booked below (that would be a second clash).
  const date = rules.dateSuggestions('', new Date()).slice(10).find(suggestion => suggestion.value !== '2026-11-22').value;
  fake = fakeInteraction({ userId: outsider, channelId: 'elsewhere', subcommand: 'set', strings: { campaign: String(campaign.id), date, time: '20:00' }, numbers: { hours: 3 } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Booked/);
  assert.equal(fake.calls.events.length, 1, 'a server event');
  assert.match(fake.calls.events[0].description, /^A campaign session/);
  const [booked] = db.campaignSessions({ campaignId: campaign.id });
  assert.deepEqual([booked.kind, booked.adventure, booked.minutes, booked.threadId], ['campaign', 'Klątwa Strahda', 180, `campaign-channel-${dm}`]);
  assert.deepEqual(db.sessionPeopleIds(booked.id).sort(), [outsider, olaId].sort());

  const { session: atSunday } = db.bookCampaignSession({ campaignId: campaign.id, by: { discordId: outsider }, startsAt: sunday, now: NOW });
  const listed = db.upcomingSessions({ now: NOW, days: 30, discordId: olaId });
  assert.deepEqual(listed.filter(entry => entry.startsAt === sunday.toISOString()).map(entry => [entry.kind, entry.clashes.map(c => c.adventure)]),
    [['adventure', ['Klątwa Strahda']], ['campaign', ['Wilki z Doliny']]]);
  assert.deepEqual(db.calendarSessions(db.calendarTokenFor(olaId), NOW).sessions.map(entry => entry.adventure).sort(), ['Klątwa Strahda', 'Klątwa Strahda', 'Wilki z Doliny']);
  assert.deepEqual(db.calendarSessions(db.calendarTokenFor(tomId), NOW).sessions, [], 'Tom left');

  // Move and cancel, picked from the list of its sessions.
  const responses = [];
  await campaignCommand.autocomplete({ user: { id: outsider }, options: { getFocused: () => ({ name: 'session', value: 'strahd' }), getSubcommand: () => 'move' }, respond: async choices => responses.push(choices) });
  assert.deepEqual(responses[0].map(choice => choice.value), [String(booked.id), String(atSunday.id)].sort((a, b) => (db.getSession(a).startsAt < db.getSession(b).startsAt ? -1 : 1)));
  fake = fakeInteraction({ userId: olaId, subcommand: 'cancel', strings: { session: String(atSunday.id) } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Only the DM/);
  fake = fakeInteraction({ userId: outsider, channelId: `campaign-channel-${dm}`, subcommand: 'move', strings: { session: String(atSunday.id), date: '2026-11-29', time: '18:00' } });
  fake.interaction.guild.scheduledEvents.edit = async () => {};
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Moved/);
  assert.match(fake.calls.sent[0].content, /Klątwa Strahda\*\* moves/);
  fake = fakeInteraction({ userId: dmId, channelId: `campaign-channel-${dm}`, subcommand: 'cancel', strings: { session: String(atSunday.id) } });
  await campaignCommand.execute(fake.interaction);
  assert.equal(db.getSession(atSunday.id).status, 'cancelled', 'another DM can too');
  fake = fakeInteraction({ userId: outsider, subcommand: 'cancel', strings: { session: String(db.nextSessionForAdventure(first.id).id) } });
  await campaignCommand.execute(fake.interaction);
  assert.match(fake.calls.replies[0].content, /Pick the session/, "an adventure's session is not a campaign's");
  delete process.env.CAMPAIGN_DM_IDS;
});

test('campaigns in the panel: their DM (a player account) and Root book, move, cancel and add players', async () => {
  const { dm, ola, tom } = setUp();
  const [olaId, tomId] = [ola, tom].map(discordIdOf);
  const campaignDm = createPlayer();
  for (const id of [campaignDm, ola]) db.prepare("UPDATE players SET password_hash = 'x' WHERE id = ?").run(id);
  const campaignDmId = discordIdOf(campaignDm);
  process.env.CAMPAIGN_DM_IDS = campaignDmId;
  const campaign = db.createCampaign({ name: `Rime ${dm}`, by: { discordId: campaignDmId } });

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')), ...(req.get('x-user') === '0' ? { role: 'admin', username: 'root' } : {}) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const call = (userId, path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/campaigns${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-user': String(userId) }, body: body ? JSON.stringify(body) : undefined
  }).then(async response => ({ status: response.status, body: await response.json() }));
  try {
    const mine = (await call(campaignDm, '')).body;
    assert.deepEqual(mine.campaigns.map(entry => entry.name), [campaign.name]);
    assert.ok(mine.players.some(player => player.discordId === olaId), 'players to add');
    assert.deepEqual((await call(ola, '')).body.campaigns, [], "a player sees no one's campaigns");
    assert.ok((await call(0, '')).body.campaigns.some(entry => entry.id === campaign.id), 'Root sees every campaign');

    assert.equal((await call(ola, `/${campaign.id}/members`, { discordId: olaId })).status, 403);
    let result = await call(campaignDm, `/${campaign.id}/members`, { discordId: olaId });
    assert.deepEqual(result.body.campaigns.find(entry => entry.id === campaign.id).members.map(m => m.discordId), [olaId]);
    await call(0, `/${campaign.id}/members`, { discordId: tomId });
    await call(0, `/${campaign.id}/members`, { discordId: tomId, member: false });

    const date = rules.dateSuggestions('', new Date())[10].value;
    result = await call(campaignDm, `/${campaign.id}/sessions`, { date, time: '19:00', hours: 3 });
    assert.equal(result.status, 200);
    const [session] = result.body.campaigns.find(entry => entry.id === campaign.id).sessions;
    assert.deepEqual([session.date, session.time, session.hours], [date, '19:00', 3]);
    assert.equal(result.body.note.posted, false, 'no Discord here');
    assert.deepEqual(db.sessionPeopleIds(session.id).sort(), [campaignDmId, olaId].sort());

    result = await call(0, `/${campaign.id}/sessions/${session.id}`, { date, time: '20:30' });
    assert.equal(result.body.campaigns.find(entry => entry.id === campaign.id).sessions[0].time, '20:30', 'Root moves it; the length stays');
    assert.equal((await call(campaignDm, `/${campaign.id + 999}/sessions/${session.id}/cancel`, {})).status, 400, 'the session must be in that campaign');
    result = await call(campaignDm, `/${campaign.id}/sessions/${session.id}/cancel`, {});
    assert.deepEqual(result.body.campaigns.find(entry => entry.id === campaign.id).sessions, []);
    assert.equal(db.getSession(session.id).status, 'cancelled');
  } finally {
    server.close();
    delete process.env.CAMPAIGN_DM_IDS;
  }
});
