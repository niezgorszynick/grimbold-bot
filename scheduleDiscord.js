// scheduleDiscord.js — Scheduling sessions in Discord (db/schedule.js holds
// the data): the poll message in an adventure's thread with ✅ / 🤔 / ❌
// buttons for each time and the DM's "lock in" menu; the announcement and the
// Discord server event whenever a session is booked, moved or cancelled (from
// Discord or the panel); "📅 Add to my calendar" (a personal calendar feed);
// and Grimbrandt's reminder a day before.

'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType
} = require('discord.js');
const db = require('./db');
const { discordTime, discordRelative, formatSessionTime } = require('./rules/schedule');

const REMINDER_EVERY_MS = 5 * 60 * 1000;
let client = null;

const names = list => (list.length ? list.map(entry => entry.name).join(', ') : '—');
const hours = minutes => (minutes % 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes / 60} h`);

// "📅 Add to my calendar": a button under every session announcement.
const calendarRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('sched:cal').setLabel('📅 Add to my calendar').setStyle(ButtonStyle.Secondary)
);

// The poll message: one field and one row of buttons per time, and the DM's menu.
function pollMessage(poll) {
  const title = poll.adventure.title;
  const embed = new EmbedBuilder().setFooter({ text: `Times in your own clock · a session is about ${hours(poll.minutes)}` });
  if (poll.status === 'confirmed') {
    const chosen = poll.options.find(option => option.id === poll.chosenOptionId);
    embed.setTitle(`📅 ${title}: it's ${chosen ? chosen.letter : 'set'}!`).setColor(0x23a55a)
      .setDescription(chosen ? `**${discordTime(chosen.startsAt)}** (${discordRelative(chosen.startsAt)})\n✅ ${names(chosen.yes)}${chosen.maybe.length ? `\n🤔 ${names(chosen.maybe)}` : ''}` : 'The time is set.');
    return { embeds: [embed], components: [] };
  }
  if (poll.status !== 'open') {
    embed.setTitle(`📅 ${title}: poll ${poll.status === 'replaced' ? 'replaced by a newer one' : 'cancelled'}`).setColor(0x4e5058);
    return { embeds: [embed], components: [] };
  }
  embed.setTitle(`📅 When do we play ${title}?`).setColor(0xd4af37)
    .setDescription(`*Grimbrandt unrolls a well-thumbed calendar.* Click ✅ can, 🤔 maybe or ❌ can't for each time.${poll.adventure.dm ? ` The DM (${poll.adventure.dm}) locks one in.` : ''}`);
  poll.options.forEach(option => {
    const lines = [`${discordTime(option.startsAt)} (${discordRelative(option.startsAt)})`, `✅ ${names(option.yes)}`, `🤔 ${names(option.maybe)}`, `❌ ${names(option.no)}`];
    if (option.clashes.length) lines.push(`⚠️ ${option.clashes.map(clash => `${clash.name} is in *${clash.adventure}* then`).join('; ')}`);
    embed.addFields({ name: `${option.letter} · ${option.yes.length} ✅${option.maybe.length ? ` ${option.maybe.length} 🤔` : ''}`, value: lines.join('\n').slice(0, 1024) });
  });
  const rows = poll.options.map(option => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sched:v:${option.id}:yes`).setLabel(`✅ ${option.letter}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`sched:v:${option.id}:maybe`).setLabel(`🤔 ${option.letter}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sched:v:${option.id}:no`).setLabel(`❌ ${option.letter}`).setStyle(ButtonStyle.Danger)
  ));
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`sched:lock:${poll.id}`)
    .setPlaceholder('DM: lock in a time…')
    .addOptions(
      ...poll.options.map(option => ({
        label: `${option.letter}: ${formatSessionTime(option.startsAt)} (Polish time)`,
        description: `${option.yes.length} can, ${option.maybe.length} maybe, ${option.no.length} can't${option.clashes.length ? ' · clashes' : ''}`.slice(0, 100),
        value: String(option.id)
      })),
      { label: 'Cancel this poll', value: 'cancel' }
    )));
  return { embeds: [embed], components: rows };
}

// ─── Server events ─────────────────────────────────────────────────────────

const eventFields = session => ({
  name: session.adventure.slice(0, 100),
  scheduledStartTime: new Date(session.startsAt),
  scheduledEndTime: new Date(session.endsAt),
  privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
  entityType: GuildScheduledEventEntityType.External,
  entityMetadata: { location: (session.threadUrl || 'Discord').slice(0, 100) },
  description: `${session.kind === 'campaign' ? 'A campaign session' : 'An adventure session'}${session.dm ? ` with ${session.dm} as DM` : ''}.${session.threadUrl ? ` ${session.kind === 'campaign' ? 'Channel' : 'Thread'}: ${session.threadUrl}` : ''}`.slice(0, 1000)
});

// The session's server event made, moved or deleted. Returns a problem, or null.
async function syncServerEvent(guild, session, kind) {
  if (!guild) return 'not in a server';
  try {
    if (kind === 'cancelled') {
      if (session.eventId) await guild.scheduledEvents.delete(session.eventId);
      db.setSessionEvent(session.id, null);
      return null;
    }
    if (kind === 'moved' && session.eventId) {
      const { name, scheduledStartTime, scheduledEndTime } = eventFields(session);
      await guild.scheduledEvents.edit(session.eventId, { name, scheduledStartTime, scheduledEndTime });
      return null;
    }
    const event = await guild.scheduledEvents.create(eventFields(session));
    db.setSessionEvent(session.id, event.id);
    return null;
  } catch (error) {
    console.warn('[Schedule] Server event:', error.message);
    return 'the bot needs the Manage Events permission';
  }
}

// ─── Announcing changes (from Discord or the panel) ─────────────────────────

const clashText = clashes => clashes.map(session => `*${session.adventure}* (${discordTime(session.startsAt)})`).join(', ');

// kind: booked | moved | cancelled. In the adventure's thread (with the
// calendar button), and its server event. channel/guild: from the interaction,
// or found by the bot (panel changes). Returns { posted, eventProblem }.
async function announceSessionChange(kind, session, { previousStartsAt = null, tagged = [], maybe = [], channel = null, guild = null } = {}) {
  let thread = channel;
  if (!thread && client && session.threadId) thread = await client.channels.fetch(session.threadId).catch(() => null);
  const server = guild || (thread && thread.guild) || null;
  const lines = {
    booked: `🗓️ *Grimbrandt circles the date twice.* **${session.adventure}**: ${discordTime(session.startsAt)} (${discordRelative(session.startsAt)}).`,
    moved: `🗓️ *Grimbrandt scratches out a date and writes a new one.* **${session.adventure}** moves${previousStartsAt ? ` from ${discordTime(previousStartsAt)}` : ''} to **${discordTime(session.startsAt)}** (${discordRelative(session.startsAt)}).`,
    cancelled: `🗓️ *Grimbrandt strikes the date out.* **${session.adventure}** on ${discordTime(session.startsAt)} is cancelled.`
  };
  let posted = false;
  if (thread && typeof thread.send === 'function') {
    // A poll's ✅ when locked in; otherwise everyone in the session (✅, DM, party).
    const people = tagged.length ? tagged : db.sessionPeopleIds(session.id);
    await thread.send({
      content: lines[kind] + (people.length ? `\n✅ ${people.map(id => `<@${id}>`).join(' ')}` : '') + (maybe.length ? `\n🤔 maybe: ${names(maybe)}` : ''),
      components: kind === 'cancelled' ? [] : [calendarRow()],
      allowedMentions: { users: people }
    }).then(() => { posted = true; }).catch(error => console.warn('[Schedule] Announcement failed:', error.message));
  }
  const eventProblem = await syncServerEvent(server, session, kind);
  return { posted, eventProblem };
}

// ─── Calendar links ────────────────────────────────────────────────────────

// The personal feed of a Discord account, and one-click links to subscribe.
function calendarLinks(discordId) {
  const base = String(process.env.PANEL_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const https = `${base}/calendar/${db.calendarTokenFor(discordId)}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent("Grimbold's sessions")}`
  };
}

function calendarMessage(discordId) {
  const links = calendarLinks(discordId);
  if (!links) return '📅 Calendar links need the panel address (PANEL_URL) set on the server; ask an admin.';
  return [
    '📅 **Your sessions as a calendar**: the ones you said ✅ to, DM, or have a character in. Changes and cancellations follow by themselves.',
    `• Google Calendar: [subscribe](${links.google})`,
    `• Outlook: [subscribe](${links.outlook})`,
    `• Apple Calendar / iPhone: [subscribe](${links.webcal})`,
    `• Other apps: add this address as a subscription: <${links.https}>`,
    '-# Keep the link to yourself. Google can take some hours to pick up a change; Grimbrandt\'s reminder and the server event are instant.'
  ].join('\n');
}

// ─── Buttons and the DM's menu ─────────────────────────────────────────────

// Buttons (sched:v:<optionId>:<answer>, sched:cal) and the DM's menu (sched:lock:<pollId>).
async function handleScheduleInteraction(interaction) {
  const parts = interaction.customId.split(':');
  try {
    if (parts[1] === 'cal') {
      await interaction.reply({ ephemeral: true, content: calendarMessage(interaction.user.id) });
      return;
    }
    if (parts[1] === 'v') {
      const name = (interaction.member && interaction.member.displayName) || interaction.user.globalName || interaction.user.username;
      const { poll, clashes } = db.voteOnSession({ optionId: Number(parts[2]), discordId: interaction.user.id, name, answer: parts[3] });
      await interaction.update(pollMessage(poll));
      if (clashes.length) {
        await interaction.followUp({ ephemeral: true, content: `⚠️ Heads up: at that time you're already in ${clashText(clashes)}. Your answer still counts; tell the DMs if you'd rather swap.` });
      }
      return;
    }
    if (parts[1] === 'lock') {
      const pollId = Number(parts[2]);
      const choice = interaction.values[0];
      if (choice === 'cancel') {
        const poll = db.cancelSchedulePoll({ pollId, byDiscordId: interaction.user.id });
        await interaction.update(pollMessage(poll));
        return;
      }
      const { session, option, poll, dmClashes } = db.confirmSessionOption({ pollId, optionId: Number(choice), byDiscordId: interaction.user.id });
      await interaction.update(pollMessage(poll));
      const result = await announceSessionChange('booked', session, {
        tagged: option.yes.map(entry => entry.discordId), maybe: option.maybe, channel: interaction.channel, guild: interaction.guild
      });
      const notes = [
        result.eventProblem ? `📅 No server event: ${result.eventProblem}.` : '📅 Added to the server\'s Events.',
        dmClashes.length ? `⚠️ You're also in ${clashText(dmClashes)} then.` : null
      ].filter(Boolean);
      await interaction.followUp({ ephemeral: true, content: notes.join('\n') });
    }
  } catch (error) {
    const content = `*Grimbrandt shakes his head.* ${error.message}`;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ ephemeral: true, content }).catch(() => {});
    else await interaction.reply({ ephemeral: true, content }).catch(() => {});
  }
}

// ─── Reminders ─────────────────────────────────────────────────────────────

// The day-before note in each session's thread, tagging those who are in it.
async function sendDueReminders(discordClient, now = new Date()) {
  for (const session of db.takeDueReminders(now)) {
    if (!session.threadId) continue;
    const thread = await discordClient.channels.fetch(session.threadId).catch(() => null);
    if (!thread || typeof thread.send !== 'function') continue;
    await thread.send({
      content: `⏰ *Grimbrandt taps the calendar.* **${session.adventure}** starts ${discordRelative(session.startsAt)}, ${discordTime(session.startsAt)}.` +
        (session.people.length ? `\n${session.people.map(id => `<@${id}>`).join(' ')}` : ''),
      allowedMentions: { users: session.people }
    }).catch(error => console.warn('[Schedule] Reminder failed:', error.message));
  }
}

function startScheduleReminders(discordClient) {
  client = discordClient;
  const run = () => sendDueReminders(discordClient).catch(error => console.warn('[Schedule] Reminders failed:', error.message));
  run();
  return setInterval(run, REMINDER_EVERY_MS);
}

function setScheduleClient(discordClient) {
  client = discordClient;
}

// Kept for /schedule cancel: the server event of a cancelled session.
const deleteServerEvent = (guild, eventId) => syncServerEvent(guild, { id: null, eventId }, 'cancelled').then(() => undefined);

module.exports = {
  pollMessage,
  calendarRow,
  calendarLinks,
  calendarMessage,
  announceSessionChange,
  handleScheduleInteraction,
  deleteServerEvent,
  sendDueReminders,
  startScheduleReminders,
  setScheduleClient
};
