const fs = require('fs');
const os = require('os');
const path = require('path');
// Uploaded files go to a folder of their own for this test run.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grimbold-portraits-'));
process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('character portraits: the owner or a DM uploads real images; everyone sees them', () => {
  const owner = createPlayer();
  const other = createPlayer();
  const id = Number(db.prepare("INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data) VALUES (?, 'Ilsa', 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')").run(owner).lastInsertRowid);
  db.prepare('INSERT INTO character_classes (character_id, class_name, subclass_name, class_level, is_primary) VALUES (?, ?, ?, ?, 1)').run(id, 'Fighter', 'Champion', 3);

  assert.throws(() => db.saveCharacterPortrait({ characterId: id, user: { id: other, role: 'player' }, buffer: png }), /Forbidden/);
  assert.throws(() => db.saveCharacterPortrait({ characterId: id, user: { id: owner, role: 'player' }, buffer: Buffer.from('<svg onload=x>') }), /PNG, JPG, WebP or GIF/);

  const first = db.saveCharacterPortrait({ characterId: id, user: { id: owner, role: 'player' }, buffer: png });
  assert.ok(first.portraitUrl.startsWith('/api/characters/' + id + '/portrait?v='));
  assert.equal(db.getCharacterPortraitFile(id).contentType, 'image/png');
  assert.equal(db.getCharacterSnapshots([id])[0].portraitUrl, first.portraitUrl, 'the adventure table gets it');

  // A DM replaces it; the old file goes.
  db.saveCharacterPortrait({ characterId: id, user: { id: 0, role: 'admin' }, buffer: png });
  assert.equal(fs.readdirSync(path.join(process.env.UPLOADS_DIR, 'characters')).length, 1);
  db.removeCharacterPortrait({ characterId: id, user: { id: owner, role: 'player' } });
  assert.equal(db.getCharacterPortraitFile(id), null);
  assert.equal(fs.readdirSync(path.join(process.env.UPLOADS_DIR, 'characters')).length, 0);
});
