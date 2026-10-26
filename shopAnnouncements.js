// shopAnnouncements.js — Grimbold's posts in the shop announcements channel
// (purchases, reservations), sent through Discord's REST API with the bot's
// token so they work whether or not the bot client is connected here.

'use strict';

const { formatCp } = require('./currency');

// The channel purchases are announced in (several names are in use).
function shopChannelId() {
  return process.env.ANNOUNCEMENT_CHANNEL ||
    process.env.ANNOUNCEMENT_CHANNEL_ID ||
    process.env.ANNOUNCMENT_CHANNEL ||
    process.env.DISCORD_SHOP_CHANNEL_ID ||
    process.env.CHANNEL_ID;
}

// Never throws: a missing token or a refusing Discord is only logged.
async function postShopEmbed(embed, channelId = shopChannelId()) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId) {
    console.warn('[Grimbold] Missing DISCORD_TOKEN or ANNOUNCEMENT_CHANNEL. Skipping Discord broadcast.');
    return false;
  }
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } })
    });
    if (!response.ok) console.error('[Grimbold] Discord API Error:', await response.text());
    return response.ok;
  } catch (error) {
    console.error('[Grimbold] Failed to send a Discord shop message:', error);
    return false;
  }
}

const restocks = n => `${n} restock${n === 1 ? '' : 's'}`;

// kind: reserved (with priceCp, the shelf price) | released (given up, or
// cancelled by a DM: the item is free again).
function reservationEmbed(kind, reservation, { priceCp = null, by = null } = {}) {
  if (kind === 'reserved') {
    return {
      title: '🔖 Reserved at Grimbold\'s',
      color: 0xd4af37,
      description: `*Grimbold ties a little paper tag to the **${reservation.item}** and scribbles ${reservation.character}'s name on it.*\n\n` +
        '"I\'ll keep it back for you. Mind, if someone walks in with the full price first, it\'s theirs."',
      fields: [
        { name: 'Item', value: `**${reservation.item}**${priceCp ? ` · ${formatCp(priceCp)}` : ''}`, inline: true },
        { name: 'Reserved for', value: `🛡️ **${reservation.character}**`, inline: true },
        { name: 'Held', value: `through the next ${restocks(reservation.restocksLeft)}`, inline: true },
        { name: 'Deposit', value: `${formatCp(reservation.depositCp)} (comes off the price)`, inline: true }
      ],
      footer: { text: `${by ? `Reserved by ${by} • ` : ''}Anyone may still buy it` },
      timestamp: new Date().toISOString()
    };
  }
  return {
    title: '🔖 Back on the open shelf',
    color: 0x949ba4,
    description: `*Grimbold snips the tag off the **${reservation.item}**.* "No longer spoken for. First come, first served."`,
    fields: [{ name: 'Was reserved for', value: reservation.character, inline: true }],
    timestamp: new Date().toISOString()
  };
}

function announceReservationInShop(kind, reservation, extra) {
  if (!reservation) return Promise.resolve(false);
  return postShopEmbed(reservationEmbed(kind, reservation, extra));
}

// Restock announcement fields: what is still held, and reservations that ran out.
function reservationRestockFields(reserved) {
  if (!reserved) return [];
  const list = (entries, line) => entries.slice(0, 10).map(line).join('\n') + (entries.length > 10 ? `\n…and ${entries.length - 10} more` : '');
  return [
    ...(reserved.held.length ? [{
      name: '🔖 Still reserved',
      value: list(reserved.held, entry => `**${entry.item}** for ${entry.character}${entry.restocksLeft ? ` (${restocks(entry.restocksLeft)} more)` : ' (last week)'}`).slice(0, 1000),
      inline: false
    }] : []),
    ...(reserved.expired.length ? [{
      name: '🔖 Reservations ended',
      value: list(reserved.expired, entry => `**${entry.item}** (was ${entry.character}'s)`).slice(0, 1000),
      inline: false
    }] : [])
  ];
}

module.exports = { shopChannelId, postShopEmbed, reservationEmbed, announceReservationInShop, reservationRestockFields };
