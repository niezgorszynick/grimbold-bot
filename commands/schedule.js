// commands/schedule.js — /schedule in an adventure's thread: the DM proposes
// times (Polish time, typed loosely: "pt 20:00, sob 18:00") and Grimbrandt
// posts a poll with buttons; or cancels the open poll or next session.
// The rest (answers, locking a time in) happens on the poll message.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { parseSessionTimes, discordTime } = require('../rules/schedule');
const { pollMessage, deleteServerEvent } = require('../scheduleDiscord');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription("Schedule this adventure's next session (in its thread)")
    .addSubcommand(sub => sub
      .setName('propose')
      .setDescription('Propose up to 4 times; everyone answers with buttons')
      .addStringOption(option => option
        .setName('times')
        .setDescription('Polish time, comma-separated: "pt 20:00, sob 18:00", "jutro 19:30", "7.11 20:00"')
        .setRequired(true))
      .addNumberOption(option => option
        .setName('hours')
        .setDescription('How long the session lasts (default 4)')
        .setMinValue(0.5)
        .setMaxValue(12)))
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel the open poll, or else the next session')),

  async execute(interaction) {
    const adventure = db.adventureForThread(interaction.channelId);
    if (!adventure) {
      return interaction.reply({ ephemeral: true, content: "Use /schedule in an adventure's thread (the one Grimbrandt opened for it)." });
    }
    if (!db.canScheduleAdventure(adventure, interaction.user.id)) {
      return interaction.reply({ ephemeral: true, content: `Only the DM of *${adventure.title}* (or another DM) can schedule it.` });
    }

    if (interaction.options.getSubcommand() === 'cancel') {
      const poll = db.openPollForAdventure(adventure.id);
      if (poll) {
        const closed = db.cancelSchedulePoll({ pollId: poll.id, byDiscordId: interaction.user.id });
        await editPollMessage(interaction, closed);
        return interaction.reply({ content: '📅 *Grimbrandt rolls the calendar back up.* The poll is cancelled.' });
      }
      try {
        const session = db.cancelNextSession({ adventureId: adventure.id, byDiscordId: interaction.user.id });
        await deleteServerEvent(interaction.guild, session.eventId);
        return interaction.reply({ content: `📅 *Grimbrandt strikes the date out.* The session on ${discordTime(session.startsAt)} is cancelled.` });
      } catch (error) {
        return interaction.reply({ ephemeral: true, content: error.message });
      }
    }

    let times;
    try {
      times = parseSessionTimes(interaction.options.getString('times'));
    } catch (error) {
      return interaction.reply({ ephemeral: true, content: `${error.message}\nExamples: \`pt 20:00, sob 18:00\` · \`jutro 19:30\` · \`7.11 20:00\` (Polish time).` });
    }
    const minutes = Math.round((interaction.options.getNumber('hours') || 4) * 60);
    const previous = db.openPollForAdventure(adventure.id);
    let poll;
    try {
      poll = db.createSchedulePoll({ adventureId: adventure.id, byDiscordId: interaction.user.id, times, minutes });
    } catch (error) {
      return interaction.reply({ ephemeral: true, content: error.message });
    }
    // A newer poll replaces the open one.
    if (previous) await editPollMessage(interaction, db.getSchedulePoll(previous.id));
    await interaction.reply(pollMessage(poll));
    const message = await interaction.fetchReply();
    db.setPollMessage(poll.id, { channelId: message.channelId, messageId: message.id });
    // The DM's own clashes, privately.
    const clashes = poll.options.flatMap(option => db.sessionClashesFor(interaction.user.id, option.startsAt, option.endsAt, { exceptAdventureId: adventure.id })
      .map(session => `${option.letter}: you're in *${session.adventure}* (${discordTime(session.startsAt)})`));
    if (clashes.length) await interaction.followUp({ ephemeral: true, content: `⚠️ ${clashes.join('\n')}` });
    return undefined;
  }
};

// Shows an old poll as closed (best effort: it may have been deleted).
async function editPollMessage(interaction, poll) {
  if (!poll || !poll.messageId || !poll.channelId) return;
  try {
    const channel = await interaction.client.channels.fetch(poll.channelId);
    const message = await channel.messages.fetch(poll.messageId);
    await message.edit(pollMessage(poll));
  } catch (error) {
    // Gone or not reachable: nothing to update.
  }
}
