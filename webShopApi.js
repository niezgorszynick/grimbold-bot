const express = require('express');
const db = require('./db');

const router = express.Router();

function getSessionPlayer(req) {
  const userId = req.session && req.session.user && req.session.user.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  return db.prepare(`
    SELECT id, discord_id, discord_tag
    FROM players
    WHERE id = ?
  `).get(userId) || null;
}

async function sendGrimboldShopEmbed({
  channelId,
  item,
  character,
  quantity,
  buyerTag,
  discountPercent,
  finalUnitPrice,
  totalPaid
}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId) return;

  const embed = {
    title: "🪙 Transaction Complete at Grimbold's Wares!",
    color: 0xd4af37,
    description:
      '*Grimbold stamps the parchment ledger and slides the wrapped goods across the weathered oak counter with a nod.*\n\n' +
      '"A fine acquisition indeed! May it serve you well in the trials ahead."',
    fields: [
      { name: 'Item', value: `**${item.name}** (${item.category})`, inline: true },
      { name: 'Quantity', value: `${quantity}`, inline: true },
      {
        name: 'Character (Recipient)',
        value: `🛡️ **${character.name}** (Lvl ${character.level} ${character.class || 'Adventurer'})`,
        inline: false
      },
      { name: 'Buyer (Discord)', value: buyerTag, inline: true },
      {
        name: 'Discount Applied',
        value: discountPercent < 0
          ? `${Math.abs(discountPercent)}%`
          : discountPercent > 0
            ? `${discountPercent}% surcharge`
            : 'None (0%)',
        inline: true
      },
      {
        name: 'Total Paid',
        value: `**${totalPaid} gp** (${finalUnitPrice} gp each)`,
        inline: true
      }
    ],
    footer: { text: "Grimbold's Emporium • Web Purchase" },
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } })
    });
    if (!response.ok) {
      console.error('Failed to post shop notification to Discord:', await response.text());
    }
  } catch (error) {
    console.error('Error sending Discord notification:', error);
  }
}

router.get('/my-characters', (req, res) => {
  const player = getSessionPlayer(req);
  if (!player) return res.status(401).json({ error: 'Unauthorized' });

  return res.json({ characters: db.getAliveCharactersByPlayerId(player.id) });
});

router.post('/shop/buy', async (req, res) => {
  const player = getSessionPlayer(req);
  if (!player) return res.status(401).json({ error: 'Unauthorized' });

  const { itemName, characterId, quantity } = req.body || {};
  if (typeof itemName !== 'string' || !itemName.trim() ||
      characterId === undefined || characterId === null || characterId === '') {
    return res.status(400).json({ error: 'Missing item name or character.' });
  }

  const parsedCharacterId = Number(characterId);
  if (!Number.isSafeInteger(parsedCharacterId) || parsedCharacterId <= 0) {
    return res.status(400).json({ error: 'Invalid character.' });
  }
  if (quantity !== undefined &&
      (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0)) {
    return res.status(400).json({ error: 'Invalid quantity.' });
  }

  try {
    const result = db.processWebPurchase({
      itemName: itemName.trim(),
      quantity: quantity === undefined ? 1 : Number(quantity),
      buyerTag: player.discord_tag,
      buyerDiscordId: player.discord_id,
      characterId: parsedCharacterId,
      playerId: player.id
    });

    const channelId = process.env.ANNOUNCMENT_CHANNEL ||
      process.env.DISCORD_SHOP_CHANNEL_ID ||
      process.env.CHANNEL_ID;
    if (channelId) {
      await sendGrimboldShopEmbed({
        channelId,
        item: result.item,
        character: result.character,
        quantity: result.quantity,
        buyerTag: player.discord_tag,
        discountPercent: result.discountPercent,
        finalUnitPrice: result.finalUnitPrice,
        totalPaid: result.totalPaid
      });
    }

    return res.json({ success: true, transaction: result });
  } catch (error) {
    const clientErrorMessages = [
      "Character not found or doesn't belong to you.",
      'Item is not available in the shop.',
      'Invalid quantity.'
    ];
    if (clientErrorMessages.includes(error.message) || error.message.startsWith('Insufficient stock.')) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Web shop purchase failed:', error);
    return res.status(500).json({ error: 'Purchase failed.' });
  }
});

module.exports = router;
