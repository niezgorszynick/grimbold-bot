// db/schedule.js — Scheduling adventure sessions. A DM proposes a few times
// in the adventure's Discord thread (or the panel); anyone answers each one
// ✅ can / 🤔 maybe / ❌ can't; the DM locks one in and it becomes a session
// (with a Discord server event and a reminder a day before). Clashes are
// warned about, never blocked: a person is "in" a session if they said ✅ to
// its time, are its DM, or have a character in its adventure's party.
//
// People are known by their Discord id (a vote needs no panel account);
// those with a players row are matched to it.

'use strict';

const crypto = require('crypto');
const { db } = require('./connection');
const { sessionsOverlap } = require('../rules/schedule');

const ANSWERS = ['yes', 'maybe', 'no'];
const MAX_OPTIONS = 4;
const DEFAULT_MINUTES = 240;

function loadAdventure(adventureId) {
  const adventure = db.prepare(`
    SELECT a.*, p.discord_id AS dm_discord_id, p.discord_tag AS dm_name FROM adventures a
    LEFT JOIN players p ON p.id = a.dm_player_id WHERE a.id = ?
  `).get(Number(adventureId));
  if (!adventure) throw new Error('Adventure not found.');
  return adventure;
}

function adventureForThread(threadId) {
  const row = db.prepare('SELECT id FROM adventures WHERE discord_thread_id = ?').get(String(threadId));
  return row ? loadAdventure(row.id) : null;
}

// May this Discord user schedule for the adventure? Its DM, or any DM (admin).
function canSchedule(adventure, discordId) {
  if (adventure.dm_discord_id && adventure.dm_discord_id === String(discordId)) return true;
  const player = db.prepare('SELECT role FROM players WHERE discord_id = ?').get(String(discordId));
  return Boolean(player && player.role === 'admin');
}

// Who acts: { discordId } (Discord) or { user } (the panel). The adventure's DM, or any DM.
function authorize(adventure, by) {
  const ok = by && (by.discordId !== undefined && by.discordId !== null
    ? canSchedule(adventure, by.discordId)
    : Boolean(by.user && (by.user.role === 'admin' || (adventure.dm_player_id !== null && adventure.dm_player_id === Number(by.user.id)))));
  if (!ok) throw new Error("Only this adventure's DM (or another DM) can schedule it.");
}
function actorDiscordId(by) {
  if (by.discordId !== undefined && by.discordId !== null) return String(by.discordId);
  const player = by.user && Number(by.user.id) > 0 ? db.prepare('SELECT discord_id FROM players WHERE id = ?').get(Number(by.user.id)) : null;
  return player && player.discord_id ? player.discord_id : null;
}

const playerNameOf = discordId => {
  const player = db.prepare('SELECT discord_tag FROM players WHERE discord_id = ?').get(String(discordId));
  return player ? player.discord_tag : null;
};

// Discord ids of the people in a session: ✅ to its time, its DM, its party's players.
function sessionPeople(session) {
  const ids = new Set();
  if (session.campaign_id) {
    const campaign = db.prepare('SELECT dm_discord_id FROM campaigns WHERE id = ?').get(session.campaign_id);
    if (campaign) ids.add(campaign.dm_discord_id);
    db.prepare('SELECT discord_id FROM campaign_members WHERE campaign_id = ?').all(session.campaign_id).forEach(row => ids.add(row.discord_id));
    return ids;
  }
  if (session.option_id) {
    db.prepare("SELECT discord_id FROM session_votes WHERE option_id = ? AND answer = 'yes'").all(session.option_id).forEach(row => ids.add(row.discord_id));
  }
  const adventure = loadAdventure(session.adventure_id);
  if (adventure.dm_discord_id) ids.add(adventure.dm_discord_id);
  db.prepare(`
    SELECT DISTINCT p.discord_id FROM adventure_party ap JOIN characters c ON c.id = ap.character_id JOIN players p ON p.id = c.player_id
    WHERE ap.adventure_id = ? AND p.discord_id IS NOT NULL
  `).all(session.adventure_id).forEach(row => ids.add(row.discord_id));
  return ids;
}

// A session of an adventure (its thread) or of a campaign (its channel).
const SESSION_QUERY = `
  SELECT s.*, COALESCE(a.title, cp.name) AS adventure_title,
    COALESCE(a.discord_thread_id, cp.channel_id) AS discord_thread_id, COALESCE(a.discord_guild_id, cp.guild_id) AS discord_guild_id,
    COALESCE(p.discord_tag, cp.dm_name) AS dm_name
  FROM sessions s LEFT JOIN adventures a ON a.id = s.adventure_id LEFT JOIN players p ON p.id = a.dm_player_id
    LEFT JOIN campaigns cp ON cp.id = s.campaign_id
`;

function sessionView(row) {
  return {
    id: row.id,
    kind: row.campaign_id ? 'campaign' : 'adventure',
    adventureId: row.adventure_id || null,
    campaignId: row.campaign_id || null,
    adventure: row.adventure_title,
    dm: row.dm_name || null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    threadId: row.discord_thread_id || null,
    threadUrl: row.discord_thread_id && row.discord_guild_id ? `https://discord.com/channels/${row.discord_guild_id}/${row.discord_thread_id}` : null,
    eventId: row.discord_event_id || null,
    minutes: Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000),
    sequence: row.sequence || 0,
    updatedAt: row.updated_at || row.created_at
  };
}

// Scheduled sessions (other than in `exceptAdventureId`) that overlap the time and that this person is in.
function clashesFor(discordId, startsAt, endsAt, { exceptAdventureId = null, exceptCampaignId = null } = {}) {
  return db.prepare(`${SESSION_QUERY} WHERE s.status = 'scheduled' AND s.starts_at < ? AND s.ends_at > ?
    ${exceptAdventureId ? 'AND (s.adventure_id IS NULL OR s.adventure_id != ?)' : ''} ${exceptCampaignId ? 'AND (s.campaign_id IS NULL OR s.campaign_id != ?)' : ''}`)
    .all(...[endsAt, startsAt, ...(exceptAdventureId ? [Number(exceptAdventureId)] : []), ...(exceptCampaignId ? [Number(exceptCampaignId)] : [])])
    .filter(row => sessionPeople(row).has(String(discordId)))
    .map(sessionView);
}

// ─── Polls ─────────────────────────────────────────────────────────────────

// { adventureId, byDiscordId, times: [Date], minutes } — the DM proposes times.
function createSchedulePoll({ adventureId, byDiscordId, times, minutes = DEFAULT_MINUTES }) {
  const adventure = loadAdventure(adventureId);
  if (adventure.status !== 'active') throw new Error('This adventure is no longer running.');
  if (!canSchedule(adventure, byDiscordId)) throw new Error("Only this adventure's DM (or another DM) can schedule it.");
  if (!Array.isArray(times) || !times.length || times.length > MAX_OPTIONS) throw new Error(`Propose from 1 to ${MAX_OPTIONS} times.`);
  const length = Number(minutes);
  if (!Number.isInteger(length) || length < 30 || length > 12 * 60) throw new Error('A session lasts from half an hour to 12 hours.');
  const id = db.transaction(() => {
    // A new poll replaces an open one for the same adventure.
    db.prepare("UPDATE session_polls SET status = 'replaced' WHERE adventure_id = ? AND status = 'open'").run(adventure.id);
    const pollId = Number(db.prepare('INSERT INTO session_polls (adventure_id, created_by, minutes) VALUES (?, ?, ?)')
      .run(adventure.id, String(byDiscordId), length).lastInsertRowid);
    const insert = db.prepare('INSERT INTO session_options (poll_id, starts_at, ends_at) VALUES (?, ?, ?)');
    times.forEach(time => {
      const start = new Date(time);
      insert.run(pollId, start.toISOString(), new Date(start.getTime() + length * 60000).toISOString());
    });
    return pollId;
  })();
  return getSchedulePoll(id);
}

function setPollMessage(pollId, { channelId, messageId }) {
  db.prepare('UPDATE session_polls SET channel_id = ?, message_id = ? WHERE id = ?').run(String(channelId), String(messageId), Number(pollId));
}

function getSchedulePoll(pollId) {
  const poll = db.prepare('SELECT * FROM session_polls WHERE id = ?').get(Number(pollId));
  if (!poll) return null;
  const adventure = loadAdventure(poll.adventure_id);
  const options = db.prepare('SELECT * FROM session_options WHERE poll_id = ? ORDER BY starts_at').all(poll.id);
  return {
    id: poll.id,
    status: poll.status,
    minutes: poll.minutes,
    chosenOptionId: poll.chosen_option_id || null,
    channelId: poll.channel_id || null,
    messageId: poll.message_id || null,
    adventure: { id: adventure.id, title: adventure.title, dm: adventure.dm_name || null, dmDiscordId: adventure.dm_discord_id || null, threadId: adventure.discord_thread_id || null },
    options: options.map((option, index) => {
      const votes = db.prepare('SELECT * FROM session_votes WHERE option_id = ? ORDER BY updated_at').all(option.id);
      const of = answer => votes.filter(vote => vote.answer === answer).map(vote => ({ discordId: vote.discord_id, name: vote.name }));
      // Who said ✅ or 🤔 here but is booked elsewhere then.
      const clashes = votes.filter(vote => vote.answer !== 'no').flatMap(vote => clashesFor(vote.discord_id, option.starts_at, option.ends_at, { exceptAdventureId: adventure.id })
        .map(session => ({ discordId: vote.discord_id, name: vote.name, adventure: session.adventure, startsAt: session.startsAt })));
      return { id: option.id, letter: 'ABCD'[index], startsAt: option.starts_at, endsAt: option.ends_at, yes: of('yes'), maybe: of('maybe'), no: of('no'), clashes };
    })
  };
}

function openPollForAdventure(adventureId) {
  const row = db.prepare("SELECT id FROM session_polls WHERE adventure_id = ? AND status = 'open' ORDER BY id DESC").get(Number(adventureId));
  return row ? getSchedulePoll(row.id) : null;
}

// One person's answer to one time. Returns the poll, and what that person
// already has at that time (when they said ✅ or 🤔).
function voteOnSession({ optionId, discordId, name, answer }) {
  if (!ANSWERS.includes(answer)) throw new Error('Answer yes, maybe or no.');
  const option = db.prepare('SELECT o.*, p.status AS poll_status, p.adventure_id FROM session_options o JOIN session_polls p ON p.id = o.poll_id WHERE o.id = ?').get(Number(optionId));
  if (!option) throw new Error('That time is no longer in a poll.');
  if (option.poll_status !== 'open') throw new Error('This poll is closed.');
  const label = String(name || playerNameOf(discordId) || 'someone').slice(0, 80);
  db.prepare(`
    INSERT INTO session_votes (option_id, discord_id, name, answer) VALUES (?, ?, ?, ?)
    ON CONFLICT(option_id, discord_id) DO UPDATE SET answer = excluded.answer, name = excluded.name, updated_at = CURRENT_TIMESTAMP
  `).run(option.id, String(discordId), label, answer);
  const clashes = answer === 'no' ? [] : clashesFor(discordId, option.starts_at, option.ends_at, { exceptAdventureId: option.adventure_id });
  return { poll: getSchedulePoll(option.poll_id), clashes };
}

// The DM locks a time in: it becomes a session. Returns it, the people who
// said ✅ and 🤔 (to tag), and the DM's own clashes (a warning).
function confirmSessionOption({ pollId, optionId, byDiscordId }) {
  const poll = getSchedulePoll(pollId);
  if (!poll) throw new Error('That poll is gone.');
  if (poll.status !== 'open') throw new Error('This poll is closed.');
  const adventure = loadAdventure(poll.adventure.id);
  if (!canSchedule(adventure, byDiscordId)) throw new Error("Only this adventure's DM (or another DM) can lock in a time.");
  const option = poll.options.find(entry => entry.id === Number(optionId));
  if (!option) throw new Error('That time is not in this poll.');
  const sessionId = db.transaction(() => {
    db.prepare("UPDATE session_polls SET status = 'confirmed', chosen_option_id = ? WHERE id = ?").run(option.id, poll.id);
    return Number(db.prepare(`
      INSERT INTO sessions (adventure_id, poll_id, option_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
    `).run(adventure.id, poll.id, option.id, option.startsAt, option.endsAt, String(byDiscordId)).lastInsertRowid);
  })();
  const dmClashes = adventure.dm_discord_id ? clashesFor(adventure.dm_discord_id, option.startsAt, option.endsAt, { exceptAdventureId: adventure.id }) : [];
  return { session: getSession(sessionId), option, poll: getSchedulePoll(poll.id), dmClashes };
}

function cancelSchedulePoll({ pollId, byDiscordId }) {
  const poll = getSchedulePoll(pollId);
  if (!poll || poll.status !== 'open') throw new Error('This poll is closed already.');
  if (!canSchedule(loadAdventure(poll.adventure.id), byDiscordId)) throw new Error("Only this adventure's DM (or another DM) can cancel it.");
  db.prepare("UPDATE session_polls SET status = 'cancelled' WHERE id = ?").run(poll.id);
  return getSchedulePoll(poll.id);
}

// ─── Sessions ──────────────────────────────────────────────────────────────

function getSession(id) {
  const row = db.prepare(`${SESSION_QUERY} WHERE s.id = ?`).get(Number(id));
  return row ? sessionView(row) : null;
}

function setSessionEvent(sessionId, eventId) {
  db.prepare('UPDATE sessions SET discord_event_id = ? WHERE id = ?').run(eventId ? String(eventId) : null, Number(sessionId));
}

function nextSessionForAdventure(adventureId, now = new Date()) {
  const row = db.prepare(`${SESSION_QUERY} WHERE s.adventure_id = ? AND s.status = 'scheduled' AND s.ends_at > ? ORDER BY s.starts_at`).get(Number(adventureId), now.toISOString());
  return row ? sessionView(row) : null;
}

function checkMinutes(minutes) {
  const length = Number(minutes);
  if (!Number.isInteger(length) || length < 30 || length > 12 * 60) throw new Error('A session lasts from half an hour to 12 hours.');
  return length;
}

function checkStart(startsAt, now) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) throw new Error('That is not a time.');
  if (start <= now) throw new Error('That time is in the past.');
  return start;
}

// A known time booked straight away (no poll). Returns the session and the DM's clashes.
function bookSession({ adventureId, by, startsAt, minutes = DEFAULT_MINUTES, now = new Date() }) {
  const adventure = loadAdventure(adventureId);
  if (adventure.status !== 'active') throw new Error('This adventure is no longer running.');
  authorize(adventure, by);
  const start = checkStart(startsAt, now);
  const end = new Date(start.getTime() + checkMinutes(minutes) * 60000);
  const id = Number(db.prepare(`
    INSERT INTO sessions (adventure_id, starts_at, ends_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(adventure.id, start.toISOString(), end.toISOString(), actorDiscordId(by), now.toISOString()).lastInsertRowid);
  const session = getSession(id);
  return { session, dmClashes: adventure.dm_discord_id ? clashesFor(adventure.dm_discord_id, session.startsAt, session.endsAt, { exceptAdventureId: adventure.id }) : [] };
}

function loadSessionFor(by, { sessionId, adventureId, now }) {
  const session = sessionId ? getSession(sessionId) : nextSessionForAdventure(adventureId, now);
  if (!session || (adventureId && session.adventureId !== Number(adventureId))) throw new Error(sessionId ? 'That session is not in this adventure.' : 'This adventure has no session coming up.');
  if (session.status !== 'scheduled') throw new Error('That session is cancelled.');
  if (session.campaignId) authorizeCampaign(loadCampaign(session.campaignId), by);
  else authorize(loadAdventure(session.adventureId), by);
  return session;
}

// A session to a new time (its length kept unless given). Calendars and the
// day-before reminder follow. Returns it, the time it had, and the DM's clashes.
function moveSession({ sessionId = null, adventureId = null, by, startsAt, minutes = null, now = new Date() }) {
  const session = loadSessionFor(by, { sessionId, adventureId, now });
  const start = checkStart(startsAt, now);
  const end = new Date(start.getTime() + checkMinutes(minutes === null || minutes === undefined ? session.minutes : minutes) * 60000);
  db.prepare(`UPDATE sessions SET starts_at = ?, ends_at = ?, sequence = sequence + 1, reminded = 0, updated_at = ? WHERE id = ?`)
    .run(start.toISOString(), end.toISOString(), now.toISOString(), session.id);
  const moved = getSession(session.id);
  const dmDiscordId = moved.campaignId ? loadCampaign(moved.campaignId).dm_discord_id : loadAdventure(moved.adventureId).dm_discord_id;
  return {
    session: moved,
    previousStartsAt: session.startsAt,
    dmClashes: dmDiscordId ? clashesFor(dmDiscordId, moved.startsAt, moved.endsAt, moved.campaignId ? { exceptCampaignId: moved.campaignId } : { exceptAdventureId: moved.adventureId }) : []
  };
}

// Calls a session off (calendars show it cancelled; its server event goes).
function cancelSession({ sessionId = null, adventureId = null, by, now = new Date() }) {
  const session = loadSessionFor(by, { sessionId, adventureId, now });
  db.prepare("UPDATE sessions SET status = 'cancelled', sequence = sequence + 1, updated_at = ? WHERE id = ?").run(now.toISOString(), session.id);
  return getSession(session.id);
}

// The DM calls off the adventure's next session (its server event goes too).
function cancelNextSession({ adventureId, byDiscordId, now = new Date() }) {
  return cancelSession({ adventureId, by: { discordId: byDiscordId }, now });
}

// ─── Campaigns (sessions outside adventure threads) ────────────────────────

// Who may start campaigns: DMs (panel admins), and the Discord ids in
// CAMPAIGN_DM_IDS (comma-separated) for DMs without a panel account.
function canRunCampaigns(discordId) {
  const extra = String(process.env.CAMPAIGN_DM_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (extra.includes(String(discordId))) return true;
  const player = db.prepare('SELECT role FROM players WHERE discord_id = ?').get(String(discordId));
  return Boolean(player && player.role === 'admin');
}

function loadCampaign(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(campaignId));
  if (!campaign) throw new Error('That campaign is not known.');
  return campaign;
}

// Its DM, or any DM (admin) — as for adventures.
function authorizeCampaign(campaign, by) {
  const discordId = by && by.discordId !== undefined && by.discordId !== null ? String(by.discordId) : actorDiscordId(by || {});
  const isAdmin = (by && by.user && by.user.role === 'admin') || (discordId && db.prepare("SELECT 1 FROM players WHERE discord_id = ? AND role = 'admin'").get(discordId));
  if (!(discordId && discordId === campaign.dm_discord_id) && !isAdmin) throw new Error(`Only the DM of ${campaign.name} (or another DM) can do that.`);
}

function campaignView(campaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    dmDiscordId: campaign.dm_discord_id,
    dm: campaign.dm_name || playerNameOf(campaign.dm_discord_id) || null,
    channelId: campaign.channel_id || null,
    channelUrl: campaign.channel_id && campaign.guild_id ? `https://discord.com/channels/${campaign.guild_id}/${campaign.channel_id}` : null,
    members: db.prepare('SELECT discord_id, name FROM campaign_members WHERE campaign_id = ? ORDER BY name COLLATE NOCASE').all(campaign.id)
      .map(row => ({ discordId: row.discord_id, name: row.name || playerNameOf(row.discord_id) || 'someone' }))
  };
}

function getCampaign(campaignId) {
  return campaignView(loadCampaign(campaignId));
}

// { name, by: { discordId }, dmName, channelId, guildId } — the one who runs it is its DM.
function createCampaign({ name, by, dmName = '', channelId = null, guildId = null }) {
  const discordId = String(by && by.discordId ? by.discordId : '');
  if (!discordId || !canRunCampaigns(discordId)) throw new Error('Only DMs can start a campaign (ask an admin to add you).');
  const title = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!title) throw new Error('Give the campaign a name.');
  if (db.prepare("SELECT 1 FROM campaigns WHERE name = ? COLLATE NOCASE AND status = 'active'").get(title)) throw new Error(`There is a campaign called ${title} already.`);
  const id = Number(db.prepare('INSERT INTO campaigns (name, dm_discord_id, dm_name, channel_id, guild_id) VALUES (?, ?, ?, ?, ?)')
    .run(title, discordId, String(dmName || '').slice(0, 80), channelId ? String(channelId) : null, guildId ? String(guildId) : null).lastInsertRowid);
  return getCampaign(id);
}

// Campaigns a person can manage (theirs; every one for a DM), or every active one.
// manageableBy: a Discord id, or a panel { user }.
function listCampaigns({ manageableBy = null } = {}) {
  const rows = db.prepare("SELECT * FROM campaigns WHERE status = 'active' ORDER BY name COLLATE NOCASE").all();
  const by = manageableBy && typeof manageableBy === 'object' ? manageableBy : { discordId: manageableBy };
  return rows.filter(row => {
    if (!manageableBy) return true;
    try { authorizeCampaign(row, by); return true; } catch { return false; }
  }).map(campaignView);
}

function setCampaignMember({ campaignId, by, discordId, name = '', member = true }) {
  const campaign = loadCampaign(campaignId);
  authorizeCampaign(campaign, by);
  if (member) {
    db.prepare(`INSERT INTO campaign_members (campaign_id, discord_id, name) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id, discord_id) DO UPDATE SET name = excluded.name`).run(campaign.id, String(discordId), String(name || '').slice(0, 80));
  } else {
    db.prepare('DELETE FROM campaign_members WHERE campaign_id = ? AND discord_id = ?').run(campaign.id, String(discordId));
  }
  return getCampaign(campaign.id);
}

// A campaign session at a known time; returns it and the DM's clashes.
function bookCampaignSession({ campaignId, by, startsAt, minutes = DEFAULT_MINUTES, now = new Date() }) {
  const campaign = loadCampaign(campaignId);
  authorizeCampaign(campaign, by);
  const start = checkStart(startsAt, now);
  const end = new Date(start.getTime() + checkMinutes(minutes) * 60000);
  const id = Number(db.prepare('INSERT INTO sessions (campaign_id, starts_at, ends_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(campaign.id, start.toISOString(), end.toISOString(), actorDiscordId(by), now.toISOString()).lastInsertRowid);
  const session = getSession(id);
  return { session, dmClashes: clashesFor(campaign.dm_discord_id, session.startsAt, session.endsAt, { exceptCampaignId: campaign.id }) };
}

// Coming campaign sessions: of one campaign, or the ones a person can manage.
function campaignSessions({ campaignId = null, manageableBy = null, now = new Date() } = {}) {
  const rows = db.prepare(`${SESSION_QUERY} WHERE s.campaign_id IS NOT NULL ${campaignId ? 'AND s.campaign_id = ?' : ''} AND s.status = 'scheduled' AND s.ends_at > ? ORDER BY s.starts_at`)
    .all(...[...(campaignId ? [Number(campaignId)] : []), now.toISOString()]);
  return rows.filter(row => {
    if (!manageableBy) return true;
    try { authorizeCampaign(loadCampaign(row.campaign_id), { discordId: manageableBy }); return true; } catch { return false; }
  }).map(sessionView);
}

// The panel's Campaigns card: the campaigns this account runs (every one for
// DMs, Root included), each with its coming sessions as the date and time
// inputs want them, and the players with a Discord account to add.
function campaignsForPanel(user, now = new Date()) {
  const { warsawInputs, formatSessionTime } = require('../rules/schedule');
  const by = { user };
  const campaigns = listCampaigns({ manageableBy: by }).map(campaign => ({
    ...campaign,
    sessions: campaignSessions({ campaignId: campaign.id, now })
      .map(session => ({ id: session.id, text: formatSessionTime(session.startsAt), ...warsawInputs(session.startsAt), hours: session.minutes / 60 }))
  }));
  const runs = user.role === 'admin' || canRunCampaigns(actorDiscordId(by) || '');
  return {
    campaigns,
    canCreate: runs,
    players: campaigns.length
      ? db.prepare("SELECT discord_id, discord_tag FROM players WHERE discord_id IS NOT NULL AND discord_id != '' ORDER BY discord_tag COLLATE NOCASE").all()
        .map(row => ({ discordId: row.discord_id, name: row.discord_tag || row.discord_id }))
      : []
  };
}

// The Discord ids of the people in a session (to tag them).
function sessionPeopleIds(sessionId) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(sessionId));
  return row ? [...sessionPeople(row)] : [];
}

// The adventure's coming sessions (the panel's adventure table).
function adventureSessions(adventureId, now = new Date()) {
  return db.prepare(`${SESSION_QUERY} WHERE s.adventure_id = ? AND s.status = 'scheduled' AND s.ends_at > ? ORDER BY s.starts_at`)
    .all(Number(adventureId), now.toISOString()).map(sessionView);
}

// ─── Personal calendar feeds ───────────────────────────────────────────────

// The secret link of a Discord account (made the first time it's asked for).
function calendarTokenFor(discordId) {
  const id = String(discordId || '');
  if (!id) throw new Error('A calendar link needs a Discord account.');
  const existing = db.prepare('SELECT token FROM calendar_tokens WHERE discord_id = ?').get(id);
  if (existing) return existing.token;
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO calendar_tokens (discord_id, token) VALUES (?, ?)').run(id, token);
  return token;
}

// The sessions a feed shows: this person's, from a month ago on, cancelled ones
// included (so calendars mark them cancelled). null for an unknown link.
function calendarSessions(token, now = new Date()) {
  const owner = typeof token === 'string' && token.length >= 16 ? db.prepare('SELECT discord_id FROM calendar_tokens WHERE token = ?').get(token) : null;
  if (!owner) return null;
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const rows = db.prepare(`${SESSION_QUERY} WHERE s.ends_at > ? ORDER BY s.starts_at`).all(since);
  return {
    discordId: owner.discord_id,
    sessions: rows.filter(row => sessionPeople(row).has(owner.discord_id)).map(sessionView)
  };
}

// Upcoming sessions (the next `days`), each with who's in and any clashes
// between them; mine: only those this Discord user is in.
function upcomingSessions({ now = new Date(), days = 14, discordId = null } = {}) {
  const until = new Date(now.getTime() + days * 86400000).toISOString();
  const rows = db.prepare(`${SESSION_QUERY} WHERE s.status = 'scheduled' AND s.ends_at > ? AND s.starts_at < ? ORDER BY s.starts_at`)
    .all(now.toISOString(), until);
  const people = new Map(rows.map(row => [row.id, sessionPeople(row)]));
  const nameOf = id => {
    const vote = db.prepare('SELECT name FROM session_votes WHERE discord_id = ? ORDER BY updated_at DESC').get(id);
    return playerNameOf(id) || (vote && vote.name) || 'someone';
  };
  return rows
    .filter(row => !discordId || people.get(row.id).has(String(discordId)))
    .map(row => {
      const mine = people.get(row.id);
      const clashes = rows.filter(other => other.id !== row.id && sessionsOverlap(row.starts_at, row.ends_at, other.starts_at, other.ends_at))
        .flatMap(other => [...mine].filter(id => people.get(other.id).has(id)).map(id => ({ name: nameOf(id), adventure: other.adventure_title })));
      return { ...sessionView(row), people: [...mine].map(nameOf), clashes };
    });
}

// Sessions starting within a day that haven't had their reminder; marks them.
function takeDueReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600000).toISOString();
  const rows = db.prepare(`${SESSION_QUERY} WHERE s.status = 'scheduled' AND s.reminded = 0 AND s.starts_at > ? AND s.starts_at <= ?`).all(now.toISOString(), soon);
  const mark = db.prepare('UPDATE sessions SET reminded = 1 WHERE id = ?');
  return rows.map(row => {
    mark.run(row.id);
    return { ...sessionView(row), people: [...sessionPeople(row)] };
  });
}

// Every open poll (the panel's Sessions tab).
function listOpenPolls() {
  return db.prepare("SELECT p.id FROM session_polls p JOIN adventures a ON a.id = p.adventure_id WHERE p.status = 'open' AND a.status = 'active' ORDER BY p.id")
    .all().map(row => getSchedulePoll(row.id));
}

module.exports = {
  canRunCampaigns,
  createCampaign,
  getCampaign,
  listCampaigns,
  setCampaignMember,
  bookCampaignSession,
  campaignSessions,
  campaignsForPanel,
  SESSION_ANSWERS: ANSWERS,
  listOpenPolls,
  SESSION_POLL_MAX_OPTIONS: MAX_OPTIONS,
  SESSION_DEFAULT_MINUTES: DEFAULT_MINUTES,
  adventureForThread,
  canScheduleAdventure: canSchedule,
  createSchedulePoll,
  setPollMessage,
  getSchedulePoll,
  openPollForAdventure,
  voteOnSession,
  confirmSessionOption,
  cancelSchedulePoll,
  getSession,
  setSessionEvent,
  nextSessionForAdventure,
  cancelNextSession,
  bookSession,
  moveSession,
  cancelSession,
  adventureSessions,
  sessionPeopleIds,
  calendarTokenFor,
  calendarSessions,
  upcomingSessions,
  takeDueReminders,
  sessionClashesFor: clashesFor
};
