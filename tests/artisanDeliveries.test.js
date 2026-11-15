const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');
const { pickDeliveryTime, weekStart, describeWindow, describeMoment } = require('../rules/deliveryWindow');
const { deliveryEmbed } = require('../artisanDeliveries');

// Wednesday 18 Nov 2026, 12:00 in Poland (UTC+1 in winter).
const wednesdayNoon = new Date('2026-11-18T11:00:00Z');
const leather = { name: 'Treated Leather Armor', category: 'Armor', price_gp: '25', description: 'Benet.', per_week: 1, cap: 3 };

test('a delivery moment falls inside the window, Polish time, this week if any of it is left', () => {
  const window = { dayFrom: 2, dayTo: 4, hourFrom: 10, hourTo: 16 };
  assert.equal(weekStart(wednesdayNoon).toISOString(), '2026-11-15T23:00:00.000Z', 'Monday midnight in Poland');
  // The earliest moment left: Wednesday 12:01; the latest: Thursday 16:00.
  assert.equal(describeMoment(pickDeliveryTime(window, wednesdayNoon, () => 0)), 'Wed 18 Nov, 12:01');
  assert.equal(describeMoment(pickDeliveryTime(window, wednesdayNoon, () => 0.999999)), 'Thu 19 Nov, 16:00');
  // Past this week's window: next week's Monday.
  assert.equal(describeMoment(pickDeliveryTime({ dayFrom: 1, dayTo: 2, hourFrom: 9, hourTo: 10 }, wednesdayNoon, () => 0)), 'Mon 23 Nov, 09:00');
  for (let i = 0; i < 50; i += 1) {
    const moment = describeMoment(pickDeliveryTime(window, new Date('2026-11-16T00:00:00Z')));
    assert.match(moment, /^(Tue|Wed|Thu) .*, (1[0-5]:\d\d|16:00)$/);
  }
  // Summer time: Tuesday 10:00 in July is 08:00 UTC.
  assert.equal(pickDeliveryTime({ dayFrom: 2, dayTo: 2, hourFrom: 10, hourTo: 11 }, new Date('2026-07-06T00:00:00Z'), () => 0).toISOString(), '2026-07-07T08:00:00.000Z');
  assert.equal(describeWindow(window), 'Tue–Thu, 10:00–16:00');
  assert.equal(describeWindow(null), 'With the weekly restock');
});

test('the window is checked when saved, and saving picks this week\'s moment', () => {
  assert.throws(() => db.saveArtisan({ name: 'Bad', delivery_day_from: '4', delivery_day_to: '2' }), /before the first/);
  assert.throws(() => db.saveArtisan({ name: 'Bad', delivery_day_from: '1', delivery_hour_from: '12', delivery_hour_to: '12' }), /later hour/);
  const id = db.saveArtisan({ name: 'Benet', active: true, delivery_day_from: '3', delivery_day_to: '5', delivery_hour_from: '10', delivery_hour_to: '16', delivery_note: 'Benet arrives.' }, { now: wednesdayNoon, random: () => 0 });
  let benet = db.listArtisans().find(artisan => artisan.id === id);
  assert.deepEqual(benet.delivery, { dayFrom: 3, dayTo: 5, hourFrom: 10, hourTo: 16 });
  assert.equal(describeMoment(new Date(benet.next_delivery_at)), 'Wed 18 Nov, 12:01');
  // Saving the name only keeps the moment; a script without delivery fields keeps the window.
  db.saveArtisan({ id, name: 'Benet the Leatherworker', active: true }, { now: wednesdayNoon, random: () => 0.5 });
  benet = db.listArtisans().find(artisan => artisan.id === id);
  assert.equal(describeMoment(new Date(benet.next_delivery_at)), 'Wed 18 Nov, 12:01');
  assert.equal(benet.delivery_note, 'Benet arrives.');
  // Away: no moment. Back to the restock: none either.
  db.saveArtisan({ id, name: 'Benet', active: false }, { now: wednesdayNoon });
  assert.equal(db.listArtisans().find(artisan => artisan.id === id).next_delivery_at, null);
  db.saveArtisan({ id, name: 'Benet', active: true, delivery_day_from: '' }, { now: wednesdayNoon });
  benet = db.listArtisans().find(artisan => artisan.id === id);
  assert.equal(benet.delivery, null);
  assert.equal(benet.next_delivery_at, null);
  db.deleteArtisan(id);
});

test('the restock leaves a scheduled artisan\'s stock alone and only resets the price', () => {
  const config = { ...db.RESTOCK_DEFAULTS, scroll_count: 0, magic_common_count: 0, magic_uncommon_count: 0 };
  const good = { name: 'Treated Leather Armor', category: 'Armor', price_cp: 2500, description: '', per_week: 1, cap: 3, scheduled: true };
  const plan = shelf => db.planRestock({ shelf, catalog: [], spells: [], config, level: 3, artisanGoods: [good], random: () => 0 });
  let result = plan([]);
  assert.equal(result.insert.length, 0, 'nothing appears before the first delivery');
  result = plan([{ id: 4, name: 'Treated Leather Armor', source: 'artisan', stock: 1, price: 2000 }]);
  assert.deepEqual(result.update, [{ id: 4, stock: 1, price: 2500, source: 'artisan' }]);
  assert.equal(result.remove.length, 0);
});

test('a due artisan delivers up to the cap, once, follows the week\'s sale, and gets next week\'s moment', () => {
  const id = db.saveArtisan({ name: 'Marta the Chandler', active: true, delivery_day_from: '3', delivery_day_to: '3', delivery_hour_from: '12', delivery_hour_to: '14' }, { now: wednesdayNoon, random: () => 0 });
  db.saveArtisanGood({ artisan_id: id, ...leather });
  db.saveArtisanGood({ artisan_id: id, name: 'Candle', category: 'Gear', price_gp: '0.1', per_week: 2, cap: 2 });
  db.prepare("INSERT INTO items (name, category, price, stock, description, is_active, source, rarity, weeks) VALUES ('Candle', 'Gear', 10, 2, '', 1, 'artisan', '', 0)").run();
  db.prepare("INSERT INTO config (key, value) VALUES ('last_shop_event', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ title: 'Market day', at: '2026-11-16T00:00:00Z', kind: 'sale', params: { target: 'artisan', percent: 20 } }));

  assert.deepEqual(db.deliverDueArtisans({ now: wednesdayNoon }), [], 'not yet');
  const later = new Date('2026-11-18T11:30:00Z');
  const [delivery] = db.deliverDueArtisans({ now: later, random: () => 0 });
  assert.equal(delivery.artisan, 'Marta the Chandler');
  assert.deepEqual(delivery.delivered, [{ name: 'Treated Leather Armor', added: 1, stock: 1, price_cp: 2000 }], '20% off this week');
  assert.deepEqual(delivery.full, ['Candle']);
  assert.equal(db.prepare("SELECT stock FROM items WHERE name = 'Treated Leather Armor'").get().stock, 1);
  assert.deepEqual(db.deliverDueArtisans({ now: later }), [], 'once a week');
  const marta = db.listArtisans().find(artisan => artisan.id === id);
  assert.equal(describeMoment(new Date(marta.next_delivery_at)), 'Wed 25 Nov, 12:00');

  const embed = deliveryEmbed(delivery);
  assert.match(embed.title, /Marta the Chandler/);
  assert.match(embed.fields[0].value, /Treated Leather Armor\*\* \+1 \(1 on the shelf\)/);
  assert.equal(embed.fields[1].value, 'Candle');
  assert.equal(deliveryEmbed({ artisan: 'Nobody', note: '', delivered: [], full: [] }), null);
});

test('a delivery skips reserved items, other sources\' names, and a short category', () => {
  const goods = [
    { name: 'Rope', category: 'Gear', price_cp: 100, per_week: 1, cap: 2 },
    { name: 'Held Boots', category: 'Gear', price_cp: 100, per_week: 1, cap: 2 },
    { name: 'Iron Helm', category: 'Armor', price_cp: 1000, per_week: 1, cap: 2 }
  ];
  const shelf = [{ id: 1, name: 'Rope', source: 'mundane', stock: null }, { id: 2, name: 'Held Boots', source: 'artisan', stock: 0, price: 100 }];
  const changes = db.planArtisanDelivery({ goods, shelf, heldIds: [2], event: { kind: 'shortage', params: { target: 'category:Armor' } } });
  assert.deepEqual(changes, []);
});
