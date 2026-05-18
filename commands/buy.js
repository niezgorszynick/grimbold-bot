// commands/buy.js — /buy <item> [quantity] — purchase; writes to Google Sheets

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getItems, decrementStock, logSale } = require('../sheets');
const { getUserRoll, getDiscount, applyModifier } = require('../rollTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription("Purchase an item from Grimbold's Emporium")
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Name of the item (as listed in /show)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('quantity')
        .setDescription('How many? (default: 1)')
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const itemQuery = interaction.options.getString('item').toLowerCase().trim();
      const quantity  = interaction.options.getInteger('quantity') ?? 1;
      const items     = await getItems();

      // Fuzzy match: exact -> startsWith -> includes
      const item =
        items.find(i => i.name.toLowerCase() === itemQuery) ||
        items.find(i => i.name.toLowerCase().startsWith(itemQuery)) ||
        items.find(i => i.name.toLowerCase().includes(itemQuery));

      // not found
      if (!item) {
        return interaction.editReply(
          `*Grimbold raises an eyebrow.*\n"**${interaction.options.getString('item')}**? Never heard of it. Use \`/show\` to see what I carry."`
        );
      }

      // sold out
      if (item.status === 'Sold Out' || item.stock === '0') {
        return interaction.editReply(
          `*Grimbold shakes his head.*\n"Fresh out of **${item.name}**. Come back when I've restocked."`
        );
      }

      // not enough stock
      if (item.stock !== 'inf') {
        const left = parseInt(item.stock) || 0;
        if (left < quantity) {
          return interaction.editReply(
            `*Grimbold holds up ${left} finger${left !== 1 ? 's' : ''}.*\n"I've only got **${left}** left -- not enough for ${quantity}. Take what I have or come back later."`
          );
        }
      }

      // apply this player's roll modifier
      const userRoll  = getUserRoll(interaction.user.id);
      const modifier  = userRoll !== null ? getDiscount(userRoll) : { percent: 0, label: 'No roll this week.' };
      const unitPrice = applyModifier(item.price, modifier);
      const totalPaid = unitPrice * quantity;

      // write to Google Sheets
      await decrementStock(item, quantity);
      await logSale({
        item,
        quantity,
        buyer:           interaction.user.username,
        buyerId:         interaction.user.id,
        basePrice:       item.price,
        discountPercent: modifier.percent,
        finalPrice:      unitPrice,
      });

      // receipt embed
      const hasMod  = modifier.percent !== 0;
      const isCheap = modifier.percent < 0;

      const embed = new EmbedBuilder()
        .setTitle('Purchase Receipt')
        .setColor(isCheap ? 0x2E8B57 : hasMod ? 0x8B0000 : 0x8B4513)
        .setDescription(
          `*Grimbold wraps up ${quantity > 1 ? `**${quantity}x** ` : ''}**${item.name}** and slides it across the counter.*`
        )
        .addFields(
          { name: 'Item',       value: quantity > 1 ? `${quantity}x ${item.name}` : item.name, inline: true },
          { name: 'Base Price', value: `${item.price} gp${quantity > 1 ? ' ea.' : ''}`,        inline: true },
        );

      if (hasMod) {
        const modLabel = isCheap
          ? `-${Math.abs(modifier.percent)}% discount`
          : `+${modifier.percent}% surcharge (Nat 1 penalty)`;
        embed.addFields(
          { name: 'Modifier',   value: modLabel,                   inline: true },
          { name: 'Your Price', value: `**${unitPrice} gp** ea.`,  inline: true },
        );
      }

      embed.addFields(
        { name: 'Total',      value: `**${totalPaid} gp**`,                                              inline: true },
        { name: 'Stock Left', value: item.stock === 'inf' ? 'Unlimited' : String(parseInt(item.stock) - quantity), inline: true },
      );

      if (!userRoll) {
        embed.addFields({
          name:  'Tip',
          value: 'Use `/roll` once a week for a personal price modifier!',
          inline: false,
        });
      }

      embed.setFooter({ text: "Grimbold's Emporium - Logged to the ledger - No refunds." });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[/buy]', err);
      await interaction.editReply("*Grimbold knocks over his inkwell.* \"Blast! Something went wrong. Try again.\"");
    }
  },
};
