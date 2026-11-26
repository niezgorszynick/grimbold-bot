const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `grimbold-tokens-${process.pid}-${Date.now()}`);
const { db, createPlayer } = require('./helpers/tempDatabase');
const renderAdminPage = require('../views/adminPage');

process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const dm = createPlayer('admin');
const otherDm = createPlayer('admin');
const player = createPlayer();
const users = {
  dm: { id: dm, discord_tag: 'dm', role: 'admin' },
  otherDm: { id: otherDm, discord_tag: 'otherdm', role: 'admin' },
  player: { id: player, discord_tag: 'player', role: 'player' },
  root: { id: 0, discord_tag: 'Root DM', role: 'admin' }
};
const monsterExists = name => ['Goblin Warrior', 'Owlbear'].includes(name);
const characterId = Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, 'Iskra', 'Human', 'Rogue', '', 1, 0, 'alive', 0, '{}')`).run(player).lastInsertRowid);
const npcId = Number(db.prepare("INSERT INTO npcs (name) VALUES ('Kevah')").run().lastInsertRowid);
const secretNpc = Number(db.prepare("INSERT INTO npcs (name, private, owner_player_id) VALUES ('Głos', 1, ?)").run(dm).lastInsertRowid);
const upload = (user, subject, extra = {}) => db.uploadToken({ user, buffer: PNG, subject, monsterExists, ...extra });

test('DMs upload tokens of characters, NPCs, monster types and custom names; one main per subject', () => {
  assert.throws(() => upload(users.player, { kind: 'custom', name: 'X' }), /Only DMs/);
  assert.throws(() => upload(users.dm, { kind: 'monster', monster: 'Goblin King' }), /no monster called/);
  assert.throws(() => upload(users.dm, { kind: 'character' }), /Choose a character/);
  assert.throws(() => db.uploadToken({ user: users.dm, buffer: Buffer.from('nope'), subject: { kind: 'custom', name: 'X' }, monsterExists }), /PNG, JPG/);

  const first = upload(users.dm, { kind: 'character', characterId });
  const second = upload(users.dm, { kind: 'character', characterId }, { label: 'Disguised' });
  const list = () => db.listTokens(users.dm, { characterId });
  assert.deepEqual(list().map(token => [token.id, token.main]), [[first, true], [second, false]], 'the first is main');
  const third = upload(users.dm, { kind: 'character', characterId }, { label: 'Wild shape', main: true });
  assert.equal(list().find(token => token.main).id, third, 'asked to be main');
  assert.equal(list().filter(token => token.main).length, 1);
  db.deleteToken({ user: users.dm, id: third });
  assert.equal(list().filter(token => token.main).length, 1, 'another becomes main');

  const goblin = upload(users.dm, { kind: 'monster', monster: 'Goblin Warrior' });
  assert.equal(db.getToken(users.otherDm, goblin).name, 'Goblin Warrior', 'every DM sees it');
  assert.equal(db.getToken(users.player, goblin), null);
  const parrot = upload(users.dm, { kind: 'custom', name: "  Captain  Ruvo's parrot " });
  assert.equal(db.getToken(users.dm, parrot).name, "Captain Ruvo's parrot");
  assert.equal(db.getToken(users.dm, upload(users.dm, { kind: 'custom', name: "captain ruvo's PARROT" }, { label: 'Flying' })).main, false, 'same custom name, same subject');
  assert.ok(db.listTokenSubjects(users.dm).customNames.includes("Captain Ruvo's parrot"));

  // A private NPC's tokens follow the NPC.
  const secret = upload(users.dm, { kind: 'npc', npcId: secretNpc });
  assert.throws(() => upload(users.otherDm, { kind: 'npc', npcId: secretNpc }), /Choose a Notable NPC/);
  assert.equal(db.getToken(users.otherDm, secret), null);
  assert.ok(db.getToken(users.root, secret));
  assert.ok(!db.listTokens(users.otherDm).some(token => token.id === secret));
  assert.throws(() => db.deleteToken({ user: users.otherDm, id: secret }), /not found/);

  // Relinking and relabelling.
  const kevah = upload(users.dm, { kind: 'npc', npcId });
  db.updateToken({ user: users.dm, id: second, label: 'Hooded', subject: { kind: 'character', characterId }, monsterExists });
  assert.equal(db.getToken(users.dm, second).label, 'Hooded');
  db.updateToken({ user: users.dm, id: second, subject: { kind: 'npc', npcId }, monsterExists });
  assert.equal(db.getToken(users.dm, second).npcId, npcId);
  assert.equal(db.getToken(users.dm, second).main, false, 'Kevah already had a main token');
  assert.equal(db.getToken(users.dm, kevah).main, true);
  assert.equal(list().length, 1);

  // The file is public by its random name; a deleted NPC leaves its tokens.
  const token = db.getToken(users.dm, kevah);
  assert.match(token.url, /^\/tokens\/token-[a-f0-9]{24}\.png$/);
  assert.ok(db.getTokenFileByName(token.file));
  assert.equal(db.getTokenFileByName('../data.sqlite'), null);
  db.deleteNpc(npcId);
  const orphan = db.getToken(users.dm, kevah);
  assert.equal(orphan.name, 'Kevah');
  assert.equal(orphan.orphaned, true);
  db.updateToken({ user: users.dm, id: kevah, label: 'Old', subject: { kind: 'npc', npcId: '' }, monsterExists });
  assert.equal(db.getToken(users.dm, kevah).label, 'Old', 'relabelled without relinking');
  db.deleteToken({ user: users.dm, id: kevah });
  assert.equal(db.getTokenFileByName(token.file), null, 'the file goes with it');
});

test('the Tokens tab, the strips on subjects, and the routes', async () => {
  const page = (user, query) => renderAdminPage({ session: { user }, query });
  const tab = page(users.dm, { tab: 'tokens' });
  assert.match(tab, /🎭 Tokens/);
  assert.match(tab, /id="token-upload-form"/);
  assert.match(tab, /Iskra/);
  assert.match(tab, /Głos/, 'their own private NPC');
  assert.doesNotMatch(page(users.otherDm, { tab: 'tokens' }), /Głos/, 'another DM\'s private NPC');
  for (const [, code] of tab.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  assert.match(page(users.root, { tab: 'tokens' }), /Głos/);
  assert.doesNotMatch(page(users.player, { tab: 'tokens' }), /token-upload-form/);
  assert.match(page(users.dm, { tab: 'tokens', kind: 'monster', monster: 'Owlbear' }), /name="monster"[^>]*value="Owlbear"/);
  assert.match(page(users.dm, { tab: 'character-sheet', edit_char: String(characterId) }), /sheet-tokens/);
  const npcForm = page(users.dm, { tab: 'npcs', edit_npc: String(secretNpc) });
  assert.match(npcForm, /class="token-strip"/);
  assert.match(npcForm, /kind=npc&amp;npc=\d+&amp;name=G%C5%82os#token-upload/);
  assert.doesNotMatch(page(users.player, { tab: 'character-sheet', edit_char: String(characterId) }), /sheet-tokens/);

  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: req.get('x-user') ? JSON.parse(req.get('x-user')) : null }; next(); });
  app.use('/admin', require('../server'));
  app.use('/api', require('../webShopApi'));
  app.get('/tokens/:file', (req, res) => {
    const found = db.getTokenFileByName(req.params.file);
    return found ? res.sendFile(found.file) : res.status(404).end();
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => ({ 'x-user': JSON.stringify({ id: user.id, role: user.role }) });
  try {
    const send = (user, meta) => fetch(`${base}/api/tokens/upload`, { method: 'POST', headers: { ...as(user), 'content-type': 'application/octet-stream', 'x-token': encodeURIComponent(JSON.stringify(meta)) }, body: PNG });
    assert.equal((await send(users.player, { kind: 'custom', name: 'X' })).status, 403);
    const response = await send(users.dm, { kind: 'custom', name: 'Żmija', label: 'Coiled' });
    assert.equal(response.status, 200);
    const { id, url } = await response.json();
    assert.equal(db.getToken(users.dm, id).name, 'Żmija');
    assert.equal((await fetch(`${base}${url}`)).status, 200, 'the link works without a login');

    const post = (user, route, body) => fetch(`${base}/admin${route}`, { method: 'POST', redirect: 'manual', headers: { ...as(user), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    assert.equal((await post(users.player, '/tokens/delete', { id: String(id) })).status, 403);
    const saved = await post(users.dm, '/tokens/update', { id: String(id), label: 'Striking', kind: 'custom', name: 'Żmija', main: '1', return_to: '/admin?tab=tokens#token-1' });
    assert.match(saved.headers.get('location'), /status=token_saved#token-1$/);
    assert.equal(db.getToken(users.dm, id).label, 'Striking');
    const gone = await post(users.dm, '/tokens/delete', { id: String(id), return_to: 'https://evil.example/' });
    assert.match(gone.headers.get('location'), /^\/admin\?tab=tokens&status=token_deleted/);
    assert.equal((await fetch(`${base}${url}`)).status, 404);
  } finally {
    server.close();
  }
});
