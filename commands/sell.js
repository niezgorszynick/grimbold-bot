// commands/sell.js — /sell <character> <item>: puts one of your character's
// magic items up for Grimbold's auction (rules in db/auctions.js).

const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const shop = require('../shop');
const { formatCp } = require('../currency');
const { postAuctionNews } = require('../auctionNews');

function resolveCharacter(playerId, value) {
  const characters = shop.getShoppingCharacters(playerId);
  const needle = String(value || '').trim().toLowerCase();
  return characters.find(character => String(character.id) === String(value)) ||
    characters.find(character => character.name.toLowerCase() === needle) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription("Put one of your character's magic items up for auction (7 days)")
    .addStringOption(option => option.setName('character').setDescription('Who is selling').setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName('item').setDescription('The magic item to sell').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    try {
      const player = shop.findPlayerByDiscordId(interaction.user.id);
      if (!player) return interaction.respond([]);
      if (focused.name === 'character') {
        return interaction.respond(shop.getShoppingCharacters(player.id)
          .filter(character => character.name.toLowerCase().includes(query)).slice(0, 25)
          .map(character => ({ name: character.name, value: String(character.id) })));
      }
      const character = resolveCharacter(player.id, interaction.options.getString('character'));
      if (!character) return interaction.respond([]);
      return interaction.respond(db.sellableItems(character.id)
        .filter(item => item.name.toLowerCase().includes(query)).slice(0, 25)
        .map(item => ({ name: `${item.name} (${item.rarity}) — opening bid ${formatCp(Math.max(100, Math.round(item.valueCp / 200) * 100))}`.slice(0, 100), value: item.uid })));
    } catch {
      return interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const player = shop.findPlayerByDiscordId(interaction.user.id);
    if (!player) return interaction.editReply('*Grimbold squints at you.* "I don\'t know you. Ask the DM to add your Discord account to the campaign ledger."');
    const character = resolveCharacter(player.id, interaction.options.getString('character'));
    if (!character) return interaction.editReply('*Grimbold looks around.* "Whose item is this? Pick one of your living characters from the list."');
    try {
      const auction = db.createAuction({ user: { id: player.id, role: 'player' }, characterId: character.id, uid: interaction.options.getString('item') });
      postAuctionNews([{ kind: 'listed', auctionId: auction.id, seller: auction.seller, item: auction.item, rarity: auction.rarity, openingBidCp: auction.openingBidCp, endsAt: auction.endsAt }]);
      return interaction.editReply(`*Grimbold tags the ${auction.item} and sets it on the auction table.* Auction #${auction.id}: opening bid **${formatCp(auction.openingBidCp)}**, closes <t:${Math.floor(Date.parse(auction.endsAt) / 1000)}:R>. You get the winning bid less Grimbold's 10%.`);
    } catch (error) {
      return interaction.editReply(`*Grimbold shakes his head.* "${error.message}"`);
    }
  }
};
