// Renders every admin panel page and checks that each inline <script> parses.
// Those scripts sit inside server-side template literals, where a single
// backslash (e.g. '\n') silently turns into something else and breaks the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');
const renderAdminPage = require('../views/adminPage');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
}

function assertScriptsParse(html, label) {
  const scripts = inlineScripts(html);
  scripts.forEach((code, index) => {
    assert.doesNotThrow(() => new vm.Script(code), `${label}: inline script ${index + 1} has a syntax error`);
  });
  return scripts.length;
}

const player = createPlayer();
const character = rules.buildStartingCharacter({
  name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
  background: 'Soldier', generationMethod: 'Standard Array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
  versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
  backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
});
const characterId = db.insertStartingCharacter(player, character);
db.prepare(`INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
  VALUES ('Odd </script> Item', 'Gear', 'common', 100, 'Has a \\ backslash and a </script> tag.', 1, 1, 1)`).run();

const users = {
  admin: { id: 0, discord_tag: 'admin', role: 'admin' },
  player: { id: player, discord_tag: 'tester', role: 'player' }
};
const tabs = ['items', 'catalog', 'restock', 'sales', 'rolls', 'players', 'adventures', 'analytics', 'auctions', 'character-sheet'];

for (const [role, user] of Object.entries(users)) {
  test(`every admin tab renders with valid inline scripts (${role})`, () => {
    for (const tab of tabs) {
      const html = renderAdminPage({ session: { user }, query: { tab } });
      assertScriptsParse(html, `${role} ${tab}`);
    }
  });
}

test('the character sheet editor and creator scripts parse', () => {
  for (const user of [users.admin, users.player]) {
    const html = renderAdminPage({ session: { user }, query: { tab: 'character-sheet', edit_char: String(characterId) } });
    assert.match(html, /id="cs_name"/, 'the editor is on the page');
    assert.ok(assertScriptsParse(html, `${user.role} sheet editor`) > 0);
  }
  const list = renderAdminPage({ session: { user: users.player }, query: { tab: 'character-sheet' } });
  assert.match(list, /id="open-character-creator"/);
  assertScriptsParse(list, 'character list');
});

test('browser scripts in public/ parse', () => {
  const dir = path.join(__dirname, '..', 'public');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, file), 'utf8')), file);
  }
});
