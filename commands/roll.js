// commands/roll.js — /roll — one d20 per player per week; sets personal price modifier

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserRoll, setUserRoll, getDiscount } = require('../rollTracker');

function rollColor(roll) {
  if (roll === 20)  return 0xFFD700;   // gold
  if (roll >= 17)   return 0x2E8B57;   // green
  if (roll >= 14)   return 0x4169E1;   // blue
  if (roll >= 11)   return 0x9370DB;   // purple
  if (roll >= 2)    return 0x8B4513;   // brown / neutral
  /* nat 1 */       return 0x8B0000;   // dark red
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription("Roll a d20 to set your personal price modifier for the week (once per week)"),

  async execute(interaction) {
    const existing = getUserRoll(interaction.user.id);

    // already rolled this week
    if (existing !== null) {
      const modifier = getDiscount(existing);
      const modDesc  = modifier.percent === 0
        ? 'No price modifier — standard prices apply.'
        : modifier.percent < 0
          ? `**${Math.abs(modifier.percent)}% discount** on all purchases.`
          : `**+${modifier.percent}% surcharge** — you rolled a 1. Rough week.`;

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Already Rolled This Week')
            .setColor(rollColor(existing))
            .setDescription(
              `*Grimbold waves you off.*\n"You already tried your luck this week, ${interaction.user}. Come back Monday."\n\n` +
              `Your roll: **${existing}** — ${modifier.label}\n${modDesc}`
            )
            .setFooter({ text: 'Resets every Monday at midnight UTC' }),
        ],
        ephemeral: true,
      });
    }

    // fresh roll
    const roll     = Math.floor(Math.random() * 20) + 1;
    setUserRoll(interaction.user.id, roll);
    const modifier = getDiscount(roll);

    const isNat20 = roll === 20;
    const isNat1  = roll === 1;

    // ASCII die face
    const face = `\`\`\`\n  +------+\n  |      |\n  |  ${String(roll).padStart(2)}  |\n  |      |\n  +------+\n\`\`\``;

    const modLine = modifier.percent === 0
      ? 'No price modifier this week — standard prices apply.'
      : modifier.percent < 0
        ? `Your prices are **${Math.abs(modifier.percent)}% lower** on all purchases until Monday.`
        : `Your prices are **${modifier.percent}% higher** this week. You really blew it.`;

    const embed = new EmbedBuilder()
      .setTitle(isNat20 ? 'NATURAL 20!' : isNat1 ? 'Natural 1...' : 'Fortune\'s Favor')
      .setColor(rollColor(roll))
      .setDescription(
        `*Grimbold slides a battered d20 across the counter with a crooked grin...*\n\n` +
        `${interaction.user} rolls:\n${face}`
      )
      .addFields(
        { name: 'Result',               value: modifier.label, inline: false },
        { name: 'Your Modifier This Week', value: modLine,     inline: false },
      )
      .addFields({
        name: 'Discount Table',
        value:
          '`20` → −20%  •  `17–19` → −15%  •  `14–16` → −10%\n' +
          '`11–13` → −5%  •  `2–10` → 0%  •  `1` → **+10%**',
        inline: false,
      })
      .setFooter({ text: 'One roll per week • Resets Monday midnight UTC • Use /show to see your personal prices' });

    await interaction.reply({ embeds: [embed] });
  },
};
