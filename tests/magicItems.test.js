const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');
const shop = require('../shop');

const abilities = scores => Object.fromEntries(Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores })
  .map(([key, score]) => [key, { score }]));
const catalog = () => rules.getMagicItemCatalog();
const owner = (classes, sheetData = {}, extra = {}) => ({ classes, species: 'Human', sheetData, spellcaster: false, ...extra });
const give = (sheetData, name, extra = {}) => ({ ...sheetData, magicItems: rules.grantMagicItem(sheetData, { name, ...extra }) });
const last = sheetData => sheetData.magicItems[sheetData.magicItems.length - 1];

test('magic items are parsed with rarity, variants, price, attunement and charges', () => {
  const items = catalog();
  assert.equal(items['Cloak of Protection'].rarity, 'Uncommon');
  assert.equal(items['Cloak of Protection'].priceGp, 400);
  assert.equal(items['Amulet of Health'].description, 'Placeholder text: sets Constitution to 19.', 'image lines are dropped');

  const weapon = items.Weapon;
  assert.equal(weapon.contentName, 'Weapon, +1, +2, or +3');
  assert.equal(weapon.baseItem, 'Any Simple or Martial');
  assert.deepEqual(weapon.variants.map(v => [v.name, v.rarity, v.priceGp]), [
    ['Weapon +1', 'Uncommon', 400], ['Weapon +2', 'Rare', 4000], ['Weapon +3', 'Very Rare', 40000]
  ]);
  assert.deepEqual(items['Potions of Healing'].variants.map(v => [v.name, v.priceGp]), [
    ['Potion of Healing', 50], ['Potion of Healing (Greater)', 200], ['Potion of Healing (Superior)', 2000], ['Potion of Healing (Supreme)', 20000]
  ], 'potions are consumables at half price');
  assert.equal(items['Axe of the Dwarvish Lords'].priceGp, null, 'artifacts are priceless');

  assert.deepEqual(items['Hat of Wizardry'].attunement.classes, ['Wizard']);
  assert.equal(items['Dwarven Thrower'].attunement.dwarf, true);
  assert.equal(items['Bag of Holding'].attunement.required, false);
  assert.deepEqual(items['Wand of Magic Missiles'].charges, { max: 7, regain: '1d6 + 1', at: 'dawn' });
});

test('shop and DM names find the right item and version', () => {
  const name = raw => {
    const match = rules.matchMagicItem(raw);
    return match && (match.variant ? match.variant.name : match.item.name);
  };
  assert.equal(name('cloak of protection'), 'Cloak of Protection');
  assert.equal(name('+1 Longsword'), 'Weapon +1');
  assert.equal(name('Greataxe +2'), 'Weapon +2');
  assert.equal(name('Potion of Greater Healing'), 'Potion of Healing (Greater)');
  assert.equal(name('Rod of the Pact Keeper +3'), 'Rod of the Pact Keeper +3');
  assert.equal(name('Potion of Healing'), 'Potion of Healing');
  assert.equal(name('Rations'), null);
  // Names used in the live shop catalog.
  assert.equal(name('Mithral Splint'), 'Mithral Armor');
  assert.equal(name('Hide Armor of Resistance (Psychic)'), 'Armor of Resistance');
  assert.equal(name('Potion of Superior Healing'), 'Potion of Healing (Superior)');
  assert.equal(name('Potion of Resistance'), null, 'not every "of Resistance" item is armor');
});

test('a more specific shop name is kept on the sheet', () => {
  const sheet = give({}, '+1 Morningstar');
  assert.deepEqual([last(sheet).name, last(sheet).variant, last(sheet).label], ['Weapon', '+1', '+1 Morningstar']);
  assert.equal(rules.magicItemDisplayName(last(sheet)), '+1 Morningstar');
  assert.equal(rules.magicItemCatalogName(last(sheet)), 'Weapon +1');
  assert.equal(last(give({}, 'Weapon +1')).label, null);
});

test('consumables stack; items with versions need one chosen', () => {
  let sheet = give({}, 'Potion of Healing', { quantity: 2 });
  sheet = give(sheet, 'Potion of Healing');
  assert.equal(sheet.magicItems.length, 1);
  assert.equal(sheet.magicItems[0].quantity, 3);
  sheet = give(sheet, 'Potion of Greater Healing');
  assert.equal(sheet.magicItems.length, 2);
  assert.throws(() => give(sheet, 'Weapon'), /Choose which Weapon: \+1, \+2, \+3/);
  assert.equal(last(give(sheet, 'Weapon', { variant: '+2' })).variant, '+2');
  assert.throws(() => give(sheet, 'Vorpal Spoon'), /Unknown magic item/);

  const used = rules.changeMagicItem(owner([], sheet), 'consume', { uid: sheet.magicItems[0].uid });
  assert.equal(used.magicItems[0].quantity, 2);
});

test('attunement: at most three items, and class or species restrictions', () => {
  let sheet = {};
  for (const name of ['Cloak of Protection', 'Ring of Protection', 'Amulet of Health', 'Headband of Intellect', 'Hat of Wizardry', 'Dwarven Thrower']) {
    sheet = give(sheet, name);
  }
  const uid = name => sheet.magicItems.find(entry => entry.name === name).uid;
  const fighter = () => owner([{ className: 'Fighter', level: 5 }], sheet);
  const attune = (name, who = fighter()) => {
    sheet = { ...sheet, magicItems: rules.changeMagicItem(who, 'attune', { uid: uid(name) }).magicItems };
  };

  assert.throws(() => attune('Hat of Wizardry'), /Only a Wizard can attune/);
  assert.throws(() => attune('Dwarven Thrower'), /Only a Dwarf/);
  assert.doesNotThrow(() => attune('Dwarven Thrower', owner([{ className: 'Fighter', level: 5 }], sheet, { species: 'Dwarf' })));
  attune('Cloak of Protection');
  attune('Ring of Protection');
  assert.throws(() => attune('Amulet of Health'), /no more than 3 magic items/);
  assert.throws(() => rules.changeMagicItem(fighter(), 'attune', { uid: 'mi_missing' }), /does not have that magic item/);
  sheet = { ...sheet, magicItems: rules.changeMagicItem(fighter(), 'unattune', { uid: uid('Dwarven Thrower') }).magicItems };
  assert.doesNotThrow(() => attune('Amulet of Health'));
  assert.ok(sheet.magicItems.find(entry => entry.name === 'Amulet of Health').equipped, 'attuning puts the item on');
});

test('active items change ability scores, AC, saves and spellcasting', () => {
  let sheet = { abilities: abilities({ con: 14, int: 16, cha: 16 }) };
  for (const [name, variant] of [['Amulet of Health'], ['Cloak of Protection'], ['Headband of Intellect'], ['Rod of the Pact Keeper', '+1']]) {
    sheet = give(sheet, name, { variant });
  }
  const inactive = rules.magicItemEffects(sheet);
  assert.equal(inactive.scores.con, 14, 'items in the pack do nothing');

  const who = owner([{ className: 'Wizard', level: 4 }, { className: 'Warlock', level: 1 }], sheet, { spellcaster: true });
  for (const entry of sheet.magicItems.slice(0, 3)) {
    sheet = { ...sheet, magicItems: rules.changeMagicItem({ ...who, sheetData: sheet }, 'attune', { uid: entry.uid }).magicItems };
  }
  const effects = rules.magicItemEffects(sheet);
  assert.equal(effects.scores.con, 19);
  assert.equal(effects.scores.int, 19);
  assert.deepEqual(effects.changes.con, { from: 14, to: 19, items: ['Amulet of Health'] });
  assert.equal(effects.ac, 1);
  assert.equal(effects.saves, 1);

  // Constitution 19 raises maximum Hit Points: Wizard 4 + Warlock 1 with +4 instead of +2.
  const classRows = [{ className: 'Wizard', subclassName: 'Evoker', level: 4 }, { className: 'Warlock', subclassName: null, level: 1 }];
  const hp = sheetData => rules.deriveVitalsContext({ species: 'Human', sheetData, classRows }).hpMax;
  assert.equal(hp(sheet) - hp({ ...sheet, magicItems: [] }), 10);

  // Headband: Intelligence 19 for Wizard spells. Rod +1 needs attunement and only helps Warlock spells.
  const sources = sheetData => Object.fromEntries(rules.getSpellSources({ classes: classRows, species: 'Human', sheetData }).map(s => [s.key, s]));
  assert.equal(sources(sheet).Wizard.saveDc, 8 + 3 + 4);
  const rod = sheet.magicItems[3].uid;
  sheet = { ...sheet, magicItems: rules.changeMagicItem({ ...who, sheetData: sheet }, 'unattune', { uid: sheet.magicItems[0].uid }).magicItems };
  sheet = { ...sheet, magicItems: rules.changeMagicItem({ ...who, sheetData: sheet }, 'attune', { uid: rod }).magicItems };
  assert.equal(sources(sheet).Warlock.saveDc, 8 + 3 + 3 + 1);
  assert.equal(sources(sheet).Warlock.attackBonus, 3 + 3 + 1);
  assert.equal(sources(sheet).Wizard.saveDc, 8 + 3 + 4);
});

test('charges are spent and come back on a Long Rest', () => {
  let sheet = give({}, 'Wand of Magic Missiles');
  const uid = sheet.magicItems[0].uid;
  const use = count => { sheet = { ...sheet, magicItems: rules.changeMagicItem(owner([]), 'useCharges', { uid, count }).magicItems }; };
  // changeMagicItem reads the sheet from the owner, so pass it along.
  const useOn = count => { sheet = { ...sheet, magicItems: rules.changeMagicItem(owner([], sheet), 'useCharges', { uid, count }).magicItems }; };
  assert.throws(() => use(1), /does not have that magic item/);
  useOn(3);
  useOn(3);
  assert.throws(() => useOn(2), /only 1 charge left/);
  useOn(1);
  assert.equal(sheet.magicItems[0].chargesUsed, 7);

  const rolls = [0, 0.99]; // 1d6 → 1, then unused
  const { magicItems, regained } = rules.regainChargesOnLongRest(sheet, { rng: () => rolls.shift() });
  assert.deepEqual(regained, [{ uid, name: 'Wand of Magic Missiles', restored: 2, roll: '1d6 + 1' }]);
  assert.equal(magicItems[0].chargesUsed, 5);
});

function addCharacter(playerId, sheetData = {}) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, 'Tamsin', 'Human', 'Fighter', 'Champion', 5, 0, 'alive', 100000, ?)
  `).run(playerId, JSON.stringify(sheetData)).lastInsertRowid);
}

test('only a DM gives items; attuning an Amulet of Health updates stored max HP', () => {
  const player = createPlayer();
  const id = addCharacter(player, { abilities: abilities({ con: 12 }) });
  const asPlayer = { id, player_id: player, is_admin: false };
  assert.throws(() => db.changeCharacterMagicItems({ ...asPlayer, action: 'grant', params: { name: 'Amulet of Health' } }), /Only a DM/);

  const granted = db.changeCharacterMagicItems({ id, player_id: 0, is_admin: true, action: 'grant', params: { name: 'Amulet of Health' } });
  assert.match(granted.message, /Tamsin received Amulet of Health/);
  const uid = granted.magicItems.items[0].uid;
  assert.equal(granted.magicItems.items[0].rarity, 'Rare');

  const before = JSON.parse(db.getCharacterById(id).sheet_data).hpMax;
  const after = db.changeCharacterMagicItems({ ...asPlayer, action: 'attune', params: { uid } });
  assert.equal(after.magicItems.attuned, 1);
  assert.deepEqual(after.magicItems.effects.scores.map(s => [s.ability, s.from, s.to]), [['con', 12, 19]]);
  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  assert.ok(sheet.hpMax > (before || 0));
  assert.throws(() => db.changeCharacterMagicItems({ ...asPlayer, action: 'remove', params: { uid } }), /Only a DM/);

  const other = createPlayer();
  assert.throws(() => db.getCharacterMagicItems({ id, player_id: other, is_admin: false }), /Forbidden/);
});

test('buying a magic item in the shop puts it in the Magic Items list', () => {
  const player = createPlayer();
  const id = addCharacter(player);
  db.addItem({ name: '+1 Longsword', category: 'Weapon', price: 40000, stock: 1, description: 'Sharp.' });
  db.addItem({ name: 'Rations', category: 'Gear', price: 50, stock: null, description: 'Food.' });
  shop.purchaseItem({ itemName: '+1 Longsword', characterId: id, playerId: player });
  shop.purchaseItem({ itemName: 'Rations', characterId: id, playerId: player });
  const sheet = JSON.parse(db.getCharacterById(id).sheet_data);
  assert.deepEqual(sheet.magicItems.map(entry => [entry.name, entry.variant, entry.source]), [['Weapon', '+1', 'shop']]);
  assert.deepEqual(sheet.inventory.map(row => row.name), ['Rations']);
});
