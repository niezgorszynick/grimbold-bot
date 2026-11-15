// artisanDeliveries.js — Resident artisans' own deliveries (db/deliveries.js),
// checked every five minutes while the bot runs, each announced by Grimbold in
// the shop channel. Artisans without a delivery window still deliver silently
// with the weekly restock.

'use strict';

const db = require('./db');
const { formatCp } = require('./currency');
const { postShopEmbed } = require('./shopAnnouncements');

const CHECK_EVERY_MS = 5 * 60 * 1000;

// The Discord embed for one delivery (see deliverDueArtisans), or null when the
// artisan makes nothing.
function deliveryEmbed(delivery) {
  if (!delivery.delivered.length && !delivery.full.length) return null;
  const opening = delivery.note || `*${delivery.artisan} pushes open the back door with a laden handcart and starts unloading onto Grimbold's shelves.*`;
  const fields = [];
  if (delivery.delivered.length) {
    fields.push({
      name: '📦 Just delivered',
      value: delivery.delivered.slice(0, 15).map(good => `**${good.name}** +${good.added} (${good.stock} on the shelf) · ${formatCp(good.price_cp)}`).join('\n').slice(0, 1000),
      inline: false
    });
  } else {
    fields.push({ name: '📦 Nothing new', value: `"Shelf's still full from last time," Grimbold grunts. ${delivery.artisan} takes the cart home again.`, inline: false });
  }
  if (delivery.delivered.length && delivery.full.length) {
    fields.push({ name: 'Still plenty of', value: delivery.full.slice(0, 15).join(', ').slice(0, 1000), inline: false });
  }
  return {
    title: `🧺 A delivery from ${delivery.artisan}`,
    color: 0x8b5a2b,
    description: opening.slice(0, 2000),
    fields,
    footer: { text: 'Grimbold the Shopkeeper • /show to see the shelf' },
    timestamp: new Date().toISOString()
  };
}

async function checkDeliveries() {
  let deliveries = [];
  try {
    deliveries = db.deliverDueArtisans();
  } catch (error) {
    console.warn(`Artisan deliveries failed: ${error.message}`);
    return;
  }
  for (const delivery of deliveries) {
    console.log(`🧺 ${delivery.artisan} delivered ${delivery.delivered.map(good => `${good.name} +${good.added}`).join(', ') || 'nothing (shelf full)'}.`);
    const embed = deliveryEmbed(delivery);
    if (embed) await postShopEmbed(embed);
  }
}

function startArtisanDeliveries() {
  setInterval(checkDeliveries, CHECK_EVERY_MS).unref();
  checkDeliveries();
}

module.exports = { startArtisanDeliveries, deliveryEmbed, checkDeliveries };
