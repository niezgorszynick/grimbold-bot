// commands/campaign.js — /campaign: campaigns run apart from the panel's
// adventures (no thread). Their sessions join the same calendar as the
// one-shots, so clashes, /sessions, calendar feeds and reminders see both.
//   create  a campaign; Grimbrandt posts its news in this channel
//   add / remove  a player (they're tagged, and get its sessions in their calendar)
//   set     book a session (date + time picked from lists, Polish time)
//   move / cancel  one of its coming sessions
//   info    its DM, players and coming sessions
// Who may create one: DMs (panel admins) and the Discord ids in CAMPAIGN_DM_IDS.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { parseDateAndTime, dateSuggestions, timeSuggestions, discordTime, formatSessionTime } = require('../rules/schedule');
const { announceSessionChange } = require('../scheduleDiscord');

const campaignOption = option => option.setName('campaign').setDescription('Which campaign').setRequired(true).setAutocomplete(true);
const sessionOption = option => option.setName('session').setDescription('Which session').setRequired(true).setAutocomplete(true);
const withDateTime = (sub, required = true) => sub
  .addStringOption(option => option.setName('date').setDescription('Pick a day (type 22, 22.11 or sob to narrow the list)').setRequired(required).setAutocomplete(true))
  .addStringOption(option => option.setName('time').setDescription('Start, Polish time (pick or type, e.g. 19:45)').setRequired(required).setAutocomplete(true))
  .addNumberOption(option => option.setName('hours').setDescription('How long (default 4)').setMinValue(0.5).setMaxValue(12));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Campaigns outside the adventure threads: their sessions in the shared calendar')
    .addSubcommand(sub => sub.setName('create').setDescription('Start a campaign; its news is posted in this channel')
      .addStringOption(option => option.setName('name').setDescription("The campaign's name").setRequired(true).setMaxLength(100)))
    .addSubcommand(sub => sub.setName('add').setDescription('Add a player to a campaign')
      .addStringOption(campaignOption)
      .addUserOption(option => option.setName('player').setDescription('Who').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Take a player off a campaign')
      .addStringOption(campaignOption)
      .addUserOption(option => option.setName('player').setDescription('Who').setRequired(true)))
    .addSubcommand(sub => withDateTime(sub.setName('set').setDescription('Book a campaign session').addStringOption(campaignOption)))
    .addSubcommand(sub => withDateTime(sub.setName('move').setDescription('Move a campaign session').addStringOption(sessionOption)))
    .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel a campaign session').addStringOption(sessionOption))
    .addSubcommand(sub => sub.setName('info').setDescription("A campaign's DM, players and coming sessions").addStringOption(campaignOption)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    let choices = [];
    if (focused.name === 'date') choices = dateSuggestions(focused.value);
    else if (focused.name === 'time') choices = timeSuggestions(focused.value);
    else if (focused.name === 'campaign') {
      const subcommand = interaction.options.getSubcommand();
      choices = db.listCampaigns(subcommand === 'info' ? {} : { manageableBy: interaction.user.id })
        .filter(campaign => campaign.name.toLowerCase().includes(query))
        .map(campaign => ({ name: campaign.name.slice(0, 100), value: String(campaign.id) }));
    } else if (focused.name === 'session') {
      choices = db.campaignSessions({ manageableBy: interaction.user.id })
        .map(session => ({ name: `${session.adventure} · ${formatSessionTime(session.startsAt)}`.slice(0, 100), value: String(session.id) }))
        .filter(choice => choice.name.toLowerCase().includes(query));
    }
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const by = { discordId: interaction.user.id };
    const reply = content => interaction.reply({ ephemeral: true, content });
    const pickedTime = () => parseDateAndTime(interaction.options.getString('date'), interaction.options.getString('time'));
    const hours = interaction.options.getNumber('hours');
    const clashNote = clashes => (clashes && clashes.length ? `\n⚠️ You're also in ${clashes.map(session => `*${session.adventure}* (${discordTime(session.startsAt)})`).join(', ')} then.` : '');
    // Posted in the campaign's channel (fetched by the bot when it's elsewhere).
    const announce = async (kind, result) => {
      const here = result.session.threadId === interaction.channelId;
      const announced = await announceSessionChange(kind, result.session, {
        previousStartsAt: result.previousStartsAt || null, channel: here ? interaction.channel : null, guild: interaction.guild
      });
      return (announced.posted ? '' : "\n(Couldn't post in the campaign's channel.)") + (announced.eventProblem ? `\n📅 Server event: ${announced.eventProblem}.` : '');
    };

    try {
      if (subcommand === 'create') {
        const campaign = db.createCampaign({
          name: interaction.options.getString('name'),
          by,
          dmName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          channelId: interaction.channelId,
          guildId: interaction.guildId
        });
        return interaction.reply({
          content: `📜 *Grimbrandt opens a fresh ledger.* **${campaign.name}**, DM <@${campaign.dmDiscordId}>. Its sessions are posted here.\n` +
            '-# Add players with `/campaign add`, book with `/campaign set`. They show in `/sessions` and everyone\'s calendar link.',
          allowedMentions: { users: [] }
        });
      }

      if (subcommand === 'add' || subcommand === 'remove') {
        const user = interaction.options.getUser('player');
        const member = interaction.options.getMember('player');
        const campaign = db.setCampaignMember({
          campaignId: interaction.options.getString('campaign'),
          by,
          discordId: user.id,
          name: member?.displayName || user.globalName || user.username,
          member: subcommand === 'add'
        });
        return reply(subcommand === 'add'
          ? `✅ ${user} is in **${campaign.name}** (${campaign.members.length} players).`
          : `${user} is off **${campaign.name}**.`);
      }

      if (subcommand === 'info') {
        const campaign = db.getCampaign(interaction.options.getString('campaign'));
        const sessions = db.campaignSessions({ campaignId: campaign.id });
        return reply([
          `📜 **${campaign.name}**, DM ${campaign.dm || `<@${campaign.dmDiscordId}>`}${campaign.channelId ? ` · <#${campaign.channelId}>` : ''}`,
          `👥 ${campaign.members.length ? campaign.members.map(m => m.name).join(', ') : 'No players added yet.'}`,
          sessions.length ? sessions.map(session => `• ${discordTime(session.startsAt)} (${session.minutes / 60} h)`).join('\n') : 'No sessions booked.'
        ].join('\n'));
      }

      if (subcommand === 'set') {
        const result = db.bookCampaignSession({
          campaignId: interaction.options.getString('campaign'), by, startsAt: pickedTime(), minutes: hours ? Math.round(hours * 60) : db.SESSION_DEFAULT_MINUTES
        });
        await interaction.deferReply({ ephemeral: true });
        const notes = await announce('booked', result);
        return interaction.editReply(`📅 Booked: ${discordTime(result.session.startsAt)}.${clashNote(result.dmClashes)}${notes}`);
      }

      const sessionId = Number(interaction.options.getString('session'));
      const session = Number.isInteger(sessionId) ? db.getSession(sessionId) : null;
      if (!session || session.kind !== 'campaign') return reply('Pick the session from the list.');

      if (subcommand === 'move') {
        const result = db.moveSession({ sessionId, by, startsAt: pickedTime(), minutes: hours ? Math.round(hours * 60) : null });
        await interaction.deferReply({ ephemeral: true });
        const notes = await announce('moved', result);
        return interaction.editReply(`📅 Moved to ${discordTime(result.session.startsAt)}.${clashNote(result.dmClashes)}${notes}`);
      }

      // cancel
      const cancelled = db.cancelSession({ sessionId, by });
      await interaction.deferReply({ ephemeral: true });
      const notes = await announce('cancelled', { session: cancelled });
      return interaction.editReply(`📅 Cancelled.${notes}`);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (interaction.deferred) return interaction.editReply(error.message);
      return reply(error.message);
    }
  }
};
