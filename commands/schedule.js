// commands/schedule.js — /schedule, in an adventure's thread (Polish time):
//   set      date + time picked from lists: book a known session at once
//   move     the next session to a new date + time
//   propose  up to 4 times ("22.11 20:00, 29.11 18:00"; the list shows how
//            they were read); Grimbrandt posts a poll with buttons
//   cancel   the open poll, or else the next session
//   calendar your personal calendar link (anywhere)
// Answers and locking a time in happen on the poll message (scheduleDiscord.js).

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { parseSessionTimes, parseDateAndTime, dateSuggestions, timeSuggestions, describeSessionTimes, discordTime } = require('../rules/schedule');
const { pollMessage, announceSessionChange, calendarMessage } = require('../scheduleDiscord');

const EXAMPLES = 'Examples: `22.11 20:00, 29.11 18:00` · `pt 20:00` · `jutro 19:30` (Polish time).';

const withDateTime = sub => sub
  .addStringOption(option => option.setName('date').setDescription('Pick a day (type 22, 22.11 or sob to narrow the list)').setRequired(true).setAutocomplete(true))
  .addStringOption(option => option.setName('time').setDescription('Start, Polish time (pick or type, e.g. 19:45)').setRequired(true).setAutocomplete(true))
  .addNumberOption(option => option.setName('hours').setDescription('How long (default 4)').setMinValue(0.5).setMaxValue(12));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription("Schedule this adventure's sessions (in its thread)")
    .addSubcommand(sub => withDateTime(sub.setName('set').setDescription('Book a session at a known date and time')))
    .addSubcommand(sub => withDateTime(sub.setName('move').setDescription('Move the next session to another date and time')))
    .addSubcommand(sub => sub
      .setName('propose')
      .setDescription('Propose up to 4 times; everyone answers with buttons')
      .addStringOption(option => option
        .setName('times')
        .setDescription('Comma-separated, Polish time: 22.11 20:00, 29.11 18:00 (the list shows how they read)')
        .setRequired(true)
        .setAutocomplete(true))
      .addNumberOption(option => option.setName('hours').setDescription('How long (default 4)').setMinValue(0.5).setMaxValue(12)))
    .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel the open poll, or else the next session'))
    .addSubcommand(sub => sub.setName('calendar').setDescription('Your sessions in your own calendar (a link only you see)')),

  // Date and time lists, and how a propose text was read.
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    let choices = [];
    if (focused.name === 'date') choices = dateSuggestions(focused.value);
    else if (focused.name === 'time') choices = timeSuggestions(focused.value);
    else if (focused.name === 'times') {
      const read = describeSessionTimes(focused.value);
      choices = read.value ? [read] : [];
    }
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'calendar') return interaction.reply({ ephemeral: true, content: calendarMessage(interaction.user.id) });

    const adventure = db.adventureForThread(interaction.channelId);
    if (!adventure) {
      return interaction.reply({ ephemeral: true, content: "Use /schedule in an adventure's thread (the one Grimbrandt opened for it)." });
    }
    if (!db.canScheduleAdventure(adventure, interaction.user.id)) {
      return interaction.reply({ ephemeral: true, content: `Only the DM of *${adventure.title}* (or another DM) can schedule it.` });
    }
    const by = { discordId: interaction.user.id };
    const hoursGiven = interaction.options.getNumber('hours');
    const minutes = hoursGiven ? Math.round(hoursGiven * 60) : null;
    const clashNote = clashes => (clashes.length ? `⚠️ You're also in ${clashes.map(session => `*${session.adventure}* (${discordTime(session.startsAt)})`).join(', ')} then.` : null);

    if (subcommand === 'set' || subcommand === 'move') {
      let startsAt;
      try {
        startsAt = parseDateAndTime(interaction.options.getString('date'), interaction.options.getString('time'));
      } catch (error) {
        return interaction.reply({ ephemeral: true, content: `${error.message} Pick the date and time from the lists.` });
      }
      let result;
      try {
        result = subcommand === 'set'
          ? db.bookSession({ adventureId: adventure.id, by, startsAt, minutes: minutes || db.SESSION_DEFAULT_MINUTES })
          : db.moveSession({ adventureId: adventure.id, by, startsAt, minutes });
      } catch (error) {
        return interaction.reply({ ephemeral: true, content: error.message });
      }
      await interaction.reply({ ephemeral: true, content: subcommand === 'set' ? '📅 Booked.' : '📅 Moved.' });
      const announced = await announceSessionChange(subcommand === 'set' ? 'booked' : 'moved', result.session, {
        previousStartsAt: result.previousStartsAt, channel: interaction.channel, guild: interaction.guild
      });
      const notes = [announced.eventProblem ? `📅 Server event: ${announced.eventProblem}.` : null, clashNote(result.dmClashes)].filter(Boolean);
      if (notes.length) await interaction.followUp({ ephemeral: true, content: notes.join('\n') });
      return undefined;
    }

    if (subcommand === 'cancel') {
      const poll = db.openPollForAdventure(adventure.id);
      if (poll) {
        const closed = db.cancelSchedulePoll({ pollId: poll.id, byDiscordId: interaction.user.id });
        await editPollMessage(interaction, closed);
        return interaction.reply({ content: '📅 *Grimbrandt rolls the calendar back up.* The poll is cancelled.' });
      }
      let session;
      try {
        session = db.cancelSession({ adventureId: adventure.id, by });
      } catch (error) {
        return interaction.reply({ ephemeral: true, content: error.message });
      }
      await interaction.reply({ ephemeral: true, content: '📅 Cancelled.' });
      await announceSessionChange('cancelled', session, { channel: interaction.channel, guild: interaction.guild });
      return undefined;
    }

    // propose
    let times;
    try {
      times = parseSessionTimes(interaction.options.getString('times'));
    } catch (error) {
      return interaction.reply({ ephemeral: true, content: `${error.message}\n${EXAMPLES}` });
    }
    const previous = db.openPollForAdventure(adventure.id);
    let poll;
    try {
      poll = db.createSchedulePoll({ adventureId: adventure.id, byDiscordId: interaction.user.id, times, minutes: minutes || db.SESSION_DEFAULT_MINUTES });
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
