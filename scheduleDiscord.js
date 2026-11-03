// scheduleDiscord.js — Scheduling sessions in Discord (db/schedule.js holds
// the data): the poll message in an adventure's thread with ✅ / 🤔 / ❌
// buttons for each time and the DM's "lock in" menu, the announcement and the
// Discord server event when a time is locked in, and Grimbrandt's reminder a
// day before. Everything works from Discord alone; the panel shows the same.

'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType
} = require('discord.js');
const db = require('./db');
const { discordTime, discordRelative, formatSessionTime } = require('./rules/schedule');

const REMINDER_EVERY_MS = 5 * 60 * 1000;

const names = list => (list.length ? list.map(entry => entry.name).join(', ') : '—');
const hours = minutes => (minutes % 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes / 60} h`);

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

// A Discord server event for a locked-in session; its id, or null (and why).
async function createServerEvent(guild, session) {
  if (!guild) return { id: null, problem: 'not in a server' };
  try {
    const event = await guild.scheduledEvents.create({
      name: session.adventure.slice(0, 100),
      scheduledStartTime: new Date(session.startsAt),
      scheduledEndTime: new Date(session.endsAt),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: (session.threadUrl || 'Discord').slice(0, 100) },
      description: `An adventure session${session.dm ? ` with ${session.dm} as DM` : ''}.${session.threadUrl ? ` Thread: ${session.threadUrl}` : ''}`.slice(0, 1000)
    });
    db.setSessionEvent(session.id, event.id);
    return { id: event.id, problem: null };
  } catch (error) {
    console.warn('[Schedule] Could not create the server event:', error.message);
    return { id: null, problem: 'the bot needs the Manage Events permission' };
  }
}

async function deleteServerEvent(guild, eventId) {
  if (!guild || !eventId) return;
  await guild.scheduledEvents.delete(eventId).catch(error => console.warn('[Schedule] Could not delete the server event:', error.message));
}

const clashText = clashes => clashes.map(session => `*${session.adventure}* (${discordTime(session.startsAt)})`).join(', ');

// Buttons (sched:v:<optionId>:<answer>) and the DM's menu (sched:lock:<pollId>).
async function handleScheduleInteraction(interaction) {
  const parts = interaction.customId.split(':');
  try {
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
      const tagged = option.yes.map(entry => entry.discordId);
      await interaction.channel.send({
        content: `🗓️ *Grimbrandt circles the date twice.* **${session.adventure}**: ${discordTime(session.startsAt)} (${discordRelative(session.startsAt)}).` +
          `${tagged.length ? `\n✅ ${tagged.map(id => `<@${id}>`).join(' ')}` : ''}${option.maybe.length ? `\n🤔 maybe: ${names(option.maybe)}` : ''}`,
        allowedMentions: { users: tagged }
      });
      const event = await createServerEvent(interaction.guild, session);
      const notes = [
        event.id ? '📅 Added to the server\'s Events.' : `📅 No server event: ${event.problem}.`,
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

// The day-before note in each session's thread, tagging those who are in it.
async function sendDueReminders(client, now = new Date()) {
  for (const session of db.takeDueReminders(now)) {
    if (!session.threadId) continue;
    const thread = await client.channels.fetch(session.threadId).catch(() => null);
    if (!thread || typeof thread.send !== 'function') continue;
    await thread.send({
      content: `⏰ *Grimbrandt taps the calendar.* **${session.adventure}** starts ${discordRelative(session.startsAt)}, ${discordTime(session.startsAt)}.` +
        (session.people.length ? `\n${session.people.map(id => `<@${id}>`).join(' ')}` : ''),
      allowedMentions: { users: session.people }
    }).catch(error => console.warn('[Schedule] Reminder failed:', error.message));
  }
}

function startScheduleReminders(client) {
  const run = () => sendDueReminders(client).catch(error => console.warn('[Schedule] Reminders failed:', error.message));
  run();
  return setInterval(run, REMINDER_EVERY_MS);
}

module.exports = { pollMessage, handleScheduleInteraction, createServerEvent, deleteServerEvent, sendDueReminders, startScheduleReminders };
