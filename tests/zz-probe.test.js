const test = require('node:test');
const { db, createPlayer } = require('./helpers/tempDatabase');
test('probe', () => {
  const p = createPlayer();
  const abil = JSON.stringify({ abilities: { str: { score: 16 }, dex: { score: 10 }, con: { score: 14 }, int: { score: 10 }, wis: { score: 16 }, cha: { score: 16 } } });
  const add = (cls, sub, level) => Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data) VALUES (?, ?, 'Human', ?, ?, ?, 0, 'alive', 0, ?)`).run(p, cls, cls, sub, level, abil).lastInsertRowid);
  for (const [cls, sub, lvl] of [['Ranger', 'Hunter', 3], ['Paladin', 'Oath of Devotion', 1]]) {
    const id = add(cls, sub, lvl);
    const view = db.getCharacterSpells({ id, player_id: p, is_admin: true });
    for (const s of view.sources) console.log(cls, s.key, 'always', s.alwaysPrepared, 'free', s.freeUses, s.freeUsesBySpell);
  }
});
