const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');
const rules = require('../rules');
const { seedTown } = require('../scripts/seed-town');
const { artisans, events, happenings } = require('../scripts/town-templates');

test('the town templates load, reach the shelf, and a second run adds nothing', () => {
  assert.deepEqual(seedTown({ dry: true }).artisans.length, artisans.length, 'a dry run only reports');
  assert.equal(db.listArtisans().length, 0);

  const report = seedTown();
  assert.equal(report.artisans.length, artisans.length);
  assert.equal(report.events.length, events.length);
  const stored = db.listArtisans();
  assert.equal(stored.reduce((sum, artisan) => sum + artisan.goods.length, 0), artisans.reduce((sum, artisan) => sum + artisan.goods.length, 0));
  const tinker = db.listShopEvents().find(event => event.title === "The Tinker's Caravan");
  assert.equal(tinker.params.artisanId, stored.find(artisan => artisan.name === 'Doro Fenwick').id);
  assert.equal(db.listShopEvents().find(event => event.title === 'A Sailor with Strange Wares').params.goods.length, 4);

  // Resident goods go on the shelf at the restock; travelling ones wait for their event.
  db.runRestock({ random: () => 0.999 }); // no weekly event this time
  const shelf = db.prepare("SELECT name, source, stock FROM items WHERE source = 'artisan'").all();
  assert.ok(shelf.some(item => item.name === 'Brandt Dagger'));
  assert.ok(!shelf.some(item => item.name === 'Emberhand Chain Shirt'), 'travelling artisans only come with their event');

  const again = seedTown();
  assert.equal(again.artisans.length + again.events.length, 0);
  assert.equal(again.skipped.length, artisans.length + events.length);
});

test('artisan gear keeps its maker\'s name and still counts on the sheet', () => {
  const names = artisans.flatMap(artisan => artisan.goods.map(good => good.name));
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length, 'no two goods share a name');
  for (const name of ['Hollowell Studded Leather Armor', 'Brandt Shield', 'Kessling Longbow', 'Emberhand Warhammer']) {
    assert.ok(rules.identifyGear(name), `${name} is recognised`);
  }
  // Every happening line points at an artisan that exists.
  const known = new Set(artisans.map(artisan => artisan.name));
  Object.keys(happenings.workshop).forEach(name => assert.ok(known.has(name), name));
  [...happenings.masterwork, ...happenings.commissions].forEach(entry => assert.ok(known.has(entry.artisan), entry.artisan));
});
