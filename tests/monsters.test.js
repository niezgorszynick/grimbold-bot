const path = require('path');
process.env.RULES_CONTENT_DIR = path.join(__dirname, 'fixtures', 'content');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers/tempDatabase');
const rules = require('../rules');
const renderAdminPage = require('../views/adminPage');

test('monsters.md statblocks: fields, XP spellings, sections and sub-entries', () => {
  const gazer = rules.getMonster('Practice Gazer');
  assert.equal(gazer.size, 'Large');
  assert.equal(gazer.type, 'Aberration');
  assert.equal(gazer.alignment, 'Lawful Evil');
  assert.equal(gazer.armorClass, 16);
  assert.equal(gazer.hitPoints, 90);
  assert.equal(gazer.hitDice, '12d10+24');
  assert.equal(gazer.initiative, 6);
  assert.deepEqual(gazer.abilities, { str: 12, dex: 14, con: 15, int: 13, wis: 12, cha: 8 });
  assert.equal(gazer.saves.cha, -1, 'en dash and minus signs read as minus');
  assert.equal(gazer.saves.con, 6);
  assert.deepEqual([gazer.cr, gazer.xp, gazer.lairXp, gazer.pb], [8, 3900, 5000, 3], 'narrow spaces inside XP numbers');
  assert.equal(gazer.actions[0].attack.bonus, 5);
  assert.equal(gazer.actions[0].attack.damage.formula, '2d6+1');
  assert.deepEqual(gazer.actions.map(action => [action.name, action.sub]), [['Bite', false], ['Practice Rays', false], ['1: Dull Ray', true], ['2: Slow Ray', true]]);
  assert.deepEqual(gazer.actions[2].save, { ability: 'Wisdom', dc: 14 });
  assert.match(gazer.legendaryIntro, /^Legendary Action Uses: 2\./);
  assert.deepEqual(gazer.legendaryActions.map(action => action.name), ['Stare']);
  assert.equal(gazer.lore, 'A made-up floating eye for the tests. It casts Light at will.', 'links and emphasis become plain text');
  assert.deepEqual([gazer.habitat, gazer.treasure, gazer.source], ['Underdark, Urban', 'Arcana', 'Test fixture']);

  const footpad = rules.getMonster('Practice Footpad');
  assert.deepEqual([footpad.size, footpad.type, footpad.crText, footpad.xp, footpad.pb], ['Small or Medium', 'Humanoid', '1/8', 25, 2]);
  assert.equal(footpad.actions[0].attack.kind, 'melee');

  const spirit = rules.getMonster('Practice Spirit');
  assert.equal(spirit.summon, true);
  assert.deepEqual([spirit.cr, spirit.crText, spirit.xp, spirit.armorClass, spirit.hitPoints], [null, '—', 0, null, null]);
  assert.equal(spirit.armorClassText, "11 + the spell's level");

  assert.deepEqual(rules.listMonsters().map(monster => monster.name), ['Practice Footpad', 'Practice Gazer', 'Practice Spirit']);
  assert.deepEqual(rules.parseChallenge('0 (PB +2)'), { cr: 0, xp: 10, lairXp: null, pb: 2 }, 'XP from the CR table when missing');
});

test('an NPC based on a statblock takes the stats left empty from it', () => {
  assert.throws(() => db.saveNpc({ name: 'Nobody', base_monster: 'Practice Dragon' }), /no monster called "Practice Dragon"/);
  const id = db.saveNpc({ name: 'Vex', base_monster: 'Practice Gazer', armor_class: '18', wis: '16' });
  const vex = db.getNpc(id, { showStats: true });
  assert.deepEqual(vex.stats.baseMonster, { name: 'Practice Gazer', crText: '8', found: true });
  assert.equal(vex.stats.armorClass, 18, 'what the DM typed wins');
  assert.equal(vex.stats.hpMax, 90);
  assert.equal(vex.stats.hpCurrent, 90);
  assert.equal(vex.stats.speed, '5 ft., Fly 30 ft. (hover)');
  assert.equal(vex.stats.abilities.wis.score, 16);
  assert.equal(vex.stats.abilities.con.score, 15);
  assert.deepEqual(db.listNpcsBasedOn('Practice Gazer'), [{ id, name: 'Vex' }]);
  assert.equal(db.listNpcs().find(npc => npc.id === id).stats, undefined, 'players never see the statblock');

  db.saveNpc({ id, name: 'Vex', base_monster: '', armor_class: '18' });
  assert.equal(db.getNpc(id, { showStats: true }).stats.baseMonster, null, 'the statblock can be dropped');
});

test('the Monsters tab is for DMs: list, statblock and a new NPC from it', () => {
  const admin = { id: 0, discord_tag: 'admin', role: 'admin' };
  const html = renderAdminPage({ session: { user: admin }, query: { tab: 'monsters', monster: 'Practice Gazer' } });
  assert.match(html, /3 statblocks/);
  assert.match(html, /class="statblock"/);
  assert.match(html, /Legendary Actions/);
  assert.match(html, /CR 8 \(3,900 XP, or 5,000 in its lair; PB \+3\)/);
  assert.match(html, /new_npc=1&base_monster=Practice%20Gazer/);

  const form = renderAdminPage({ session: { user: admin }, query: { tab: 'npcs', new_npc: '1', base_monster: 'Practice Gazer' } });
  assert.match(form, /name="base_monster"[^>]*value="Practice Gazer"/);
  assert.match(form, /name="hp_max"[^>]*value="90"/);

  const player = { id: 999, discord_tag: 'p', role: 'player' };
  const asPlayer = renderAdminPage({ session: { user: player }, query: { tab: 'monsters' } });
  assert.doesNotMatch(asPlayer, /class="statblock|monster-table/);
});
