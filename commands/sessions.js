// commands/sessions.js — /sessions: the coming two weeks of adventure sessions
// across all threads (or only yours), with clashes marked, and the polls still
// open. Only you see the answer.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { discordTime, discordRelative } = require('../rules/schedule');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('Upcoming adventure sessions (the next two weeks)')
    .addBooleanOption(option => option
      .setName('mine')
      .setDescription("Only the ones you're in (said ✅, DM, or in the party)")),

  async execute(interaction) {
    const mine = Boolean(interaction.options.getBoolean('mine'));
    const sessions = db.upcomingSessions({ discordId: mine ? interaction.user.id : null });
    const lines = sessions.map(session => {
      const link = session.threadUrl ? `[${session.adventure}](${session.threadUrl})` : `**${session.adventure}**`;
      const clash = session.clashes.length ? `\n   ⚠️ ${[...new Set(session.clashes.map(c => `${c.name} is also in ${c.adventure}`))].join('; ')}` : '';
      return `• ${discordTime(session.startsAt)} (${discordRelative(session.startsAt)}) — ${link}${session.dm ? ` · DM ${session.dm}` : ''}` +
        `${session.people.length ? `\n   👥 ${session.people.join(', ')}` : ''}${clash}`;
    });
    const header = mine ? '📅 **Your sessions, the next two weeks**' : '📅 **Sessions, the next two weeks**';
    const body = lines.length ? lines.join('\n') : (mine ? "Nothing booked for you yet. Answer a poll in an adventure's thread." : 'Nothing booked yet.');
    const text = `${header}\n${body}`;
    return interaction.reply({ ephemeral: true, content: text.length > 1990 ? `${text.slice(0, 1980)}\n…` : text, allowedMentions: { parse: [] } });
  }
};
