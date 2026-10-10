// commands/buy.js — /buy <item> <character> [quantity]
// Buys an item for one of your characters: the weekly roll sets the price, and
// the gold comes out of that character's purse (same rules as the web shop).

const { formatCp } = require('../currency');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const shop = require('../shop');

// The character option holds the character id; a typed name also works.
function resolveCharacter(playerId, value) {
  const characters = shop.getShoppingCharacters(playerId);
  const byId = characters.find(character => String(character.id) === String(value));
  if (byId) return byId;
  const needle = String(value || '').trim().toLowerCase();
  return characters.find(character => character.name.toLowerCase() === needle) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Purchase an item from Grimbold for one of your characters')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The item you want to buy (type to search)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('character')
        .setDescription('Which character pays and receives the item')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption(option =>
      option
        .setName('quantity')
        .setDescription('How many to buy (default: 1)')
        .setRequired(false)
        .setMinValue(1)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    try {
      if (focused.name === 'character') {
        const player = shop.findPlayerByDiscordId(interaction.user.id);
        const characters = player ? shop.getShoppingCharacters(player.id) : [];
        await interaction.respond(characters
          .filter(character => character.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map(character => ({
            name: `${character.name} (Lvl ${character.level}, ${formatCp(character.gold_cp)})`,
            value: String(character.id)
          })));
        return;
      }
      const items = db.getAllActiveItems()
        .filter(item => (item.stock === null || item.stock > 0) && item.name.toLowerCase().includes(query))
        .slice(0, 25);
      await interaction.respond(items.map(item => ({
        name: `${item.name} — ${formatCp(item.price)}${item.stock !== null ? ` (${item.stock} left)` : ''}`,
        value: item.name
      })));
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply();

    const itemName = interaction.options.getString('item');
    const characterValue = interaction.options.getString('character');
    const quantity = interaction.options.getInteger('quantity') || 1;

    const player = shop.findPlayerByDiscordId(interaction.user.id);
    if (!player) {
      return interaction.editReply({
        content: '*Grimbold squints at you.* "I don\'t know you. Ask the DM to add your Discord account to the campaign ledger."'
      });
    }
    const character = resolveCharacter(player.id, characterValue);
    if (!character) {
      return interaction.editReply({
        content: '*Grimbold looks around.* "Who\'s paying? Pick one of your living characters from the list."'
      });
    }

    try {
      const result = shop.purchaseItem({
        itemName,
        quantity,
        characterId: character.id,
        playerId: player.id,
        buyerTag: interaction.user.tag,
        buyerDiscordId: interaction.user.id
      });

      const discountNote = result.discountPercent === 0
        ? ''
        : result.discountPercent < 0
          ? ` (${Math.abs(result.discountPercent)}% weekly discount applied)`
          : ` (+${result.discountPercent}% surcharge applied — rolled a 1)`;
      const qtyStr = result.quantity > 1 ? ` × ${result.quantity}` : '';
      const unitStr = result.quantity > 1 ? ` (${formatCp(result.finalUnitPriceCp)} each)` : '';

      const embed = new EmbedBuilder()
        .setTitle('Grimbold slides your purchase across the counter.')
        .setColor(0x8B4513)
        .setDescription(
          `*"Pleasure doing business with you, ${interaction.user}."*\n\n` +
          `**Item:** ${result.item.name}${qtyStr}\n` +
          `**Total:** **${formatCp(result.totalCostCp)}**${unitStr}${discountNote}\n` +
          `**Paid by:** ${result.character.name} (purse now ${formatCp(result.character.gold_cp)})\n\n` +
          `*${result.item.description}*`
        )
        .setFooter({ text: "Grimbold's Emporium • All sales final • No refunds" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      if (error instanceof shop.PurchaseError) {
        return interaction.editReply({ content: `*Grimbold shakes his head.* "${error.message}"` });
      }
      console.error('Error in /buy:', error);
      return interaction.editReply({
        content: '*Grimbold pulls the item back across the counter.* "Something went wrong with the ledger. Keep your gold for now."'
      });
    }
  },
};
