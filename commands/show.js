// commands/show.js — /show [category] — ephemeral; each player sees their own prices

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getItems }                          = require('../sheets');
const { getUserRoll, getDiscount, applyModifier } = require('../rollTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('show')
    .setDescription("Browse Grimbold's Emporium — prices shown are YOUR personal prices")
    .addStringOption(opt =>
      opt.setName('category')
        .setDescription('Filter by category (e.g. Potions, Weapons)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Defer as ephemeral so only the requester sees their personalised price list
    await interaction.deferReply({ ephemeral: true });

    try {
      let items    = await getItems();
      const filter = interaction.options.getString('category');

      if (filter) {
        items = items.filter(i => i.category.toLowerCase() === filter.toLowerCase());
      }

      if (items.length === 0) {
        return interaction.editReply(
          `*Grimbold squints at you.* "Ain't got nothin' like that. Try /show without a filter."`
        );
      }

      // ── personalise prices for this specific player ───────────────────────
      const userRoll = getUserRoll(interaction.user.id);
      const modifier = userRoll !== null ? getDiscount(userRoll) : null;

      // ── group by category ─────────────────────────────────────────────────
      const grouped = items.reduce((acc, item) => {
        (acc[item.category] = acc[item.category] || []).push(item);
        return acc;
      }, {});

      // ── build embed ───────────────────────────────────────────────────────
      let headerNote;
      if (!modifier) {
        headerNote = '*No roll this week — prices shown are base prices.\nUse `/roll` for a personal modifier!*';
      } else if (modifier.percent < 0) {
        headerNote = `*Prices shown already include your **${Math.abs(modifier.percent)}% discount** from this week's roll.*`;
      } else if (modifier.percent > 0) {
        headerNote = `*⚠️ Your **Natural 1** raised prices by ${modifier.percent}% for you this week. Better luck next Monday.*`;
      } else {
        headerNote = `*Your roll this week gave no modifier — standard prices apply.*`;
      }

      const embed = new EmbedBuilder()
        .setTitle("⚗️  Grimbold's Emporium — Your Prices")
        .setDescription(
          `*"Welcome, traveler. These prices are between you and me."\n\n${headerNote}*`
        )
        .setColor(
          !modifier         ? 0x8B4513 :
          modifier.percent < 0 ? 0x2E8B57 :
          modifier.percent > 0 ? 0x8B0000 : 0x8B4513
        )
        .setFooter({ text: 'Only you can see this message • /buy <item> to purchase • /roll for your weekly modifier' });

      for (const [cat, catItems] of Object.entries(grouped)) {
        const lines = catItems.map(item => {
          const soldOut   = item.status === 'Sold Out' || item.stock === '0';
          const stockNote = soldOut
            ? ' 🚫 *(Sold Out)*'
            : item.stock === '∞' ? '' : ` *(${item.stock} left)*`;

          let priceStr;
          if (soldOut) {
            priceStr = '~~sold out~~';
          } else if (modifier && modifier.percent !== 0) {
            const adjusted = applyModifier(item.price, modifier);
            const arrow    = modifier.percent < 0 ? '→' : '→';
            priceStr       = `~~${item.price} gp~~ ${arrow} **${adjusted} gp**`;
          } else {
            priceStr = `**${item.price} gp**`;
          }

          return `**${item.name}**${stockNote} — ${priceStr}\n> *${item.description}*`;
        });

        embed.addFields({
          name:   `📦  ${cat}`,
          value:  lines.join('\n\n').slice(0, 1024),
          inline: false,
        });
      }

      // Modifier summary field
      if (modifier) {
        embed.addFields({
          name:  '🎲  Your Roll This Week',
          value: modifier.label,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/show]', err);
      await interaction.editReply('*Grimbold fumbles with his ledger.* "Give me a moment — something\'s wrong."');
    }
  },
};
