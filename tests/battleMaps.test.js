const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `grimbold-battle-maps-${process.pid}-${Date.now()}`);
const { db, createPlayer } = require('./helpers/tempDatabase');
const renderAdminPage = require('../views/adminPage');

process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const advDm = createPlayer('admin');
const otherDm = createPlayer('admin');
const player = createPlayer();
const users = {
  advDm: { id: advDm, discord_tag: 'advdm', role: 'admin' },
  otherDm: { id: otherDm, discord_tag: 'otherdm', role: 'admin' },
  player: { id: player, discord_tag: 'player', role: 'player' },
  root: { id: 0, discord_tag: 'Root DM', role: 'admin' }
};
const adventure = Number(db.prepare("INSERT INTO adventures (title, xp_awarded, dm_player_id, status) VALUES ('Sunken Keep', 100, ?, 'completed')").run(advDm).lastInsertRowid);
const other = Number(db.prepare("INSERT INTO adventures (title, xp_awarded, dm_player_id, status) VALUES ('Ashen Road', 100, ?, 'completed')").run(otherDm).lastInsertRowid);
const marker = Number(db.prepare("INSERT INTO map_markers (hex, name) VALUES ('4.7', 'The Keep')").run().lastInsertRowid);
db.prepare('INSERT INTO map_marker_adventures (marker_id, adventure_id) VALUES (?, ?)').run(marker, adventure);
const elsewhere = Number(db.prepare("INSERT INTO map_markers (hex, name) VALUES ('9.2', 'Far Tower')").run().lastInsertRowid);

// Uploads a map in pieces as the browser does. Returns its id.
function upload(user, buffer, fields) {
  const { uploadId, pieceBytes } = db.startBattleMapUpload({ user, size: buffer.length });
  for (let offset = 0; offset < buffer.length; offset += pieceBytes) db.addBattleMapPiece({ user, uploadId, offset, buffer: buffer.subarray(offset, offset + pieceBytes) });
  if (fields.thumb) db.addBattleMapThumb({ user, uploadId, buffer: fields.thumb });
  return db.finishBattleMapUpload({ user, uploadId, ...fields });
}

test('Owlbear maps: uploaded in pieces, tied to an adventure and one of its markers', () => {
  assert.throws(() => db.startBattleMapUpload({ user: users.player, size: 10 }), /Only DMs/);
  assert.throws(() => db.startBattleMapUpload({ user: users.advDm, size: 51 * 1024 * 1024 }), /50 MB/);
  assert.throws(() => upload(users.advDm, PNG, { adventureId: 9999 }), /Choose the adventure/);
  assert.throws(() => upload(users.advDm, PNG, { adventureId: adventure, markerId: elsewhere }), /not one of this adventure/);
  assert.throws(() => upload(users.advDm, Buffer.alloc(100, 3), { adventureId: adventure }), /PNG, JPG/);

  const big = Buffer.concat([PNG, Buffer.alloc(1200 * 1024, 5)]);
  const id = upload(users.advDm, big, { adventureId: adventure, markerId: marker, name: '  The ambush ', note: 'Floor 1', width: 4000, height: 3000, thumb: JPG });
  const map = db.getBattleMap(users.advDm, id);
  assert.equal(map.name, 'The ambush');
  assert.equal(map.markerName, 'The Keep');
  assert.equal(map.markerHex, '4.7');
  assert.equal(map.adventureTitle, 'Sunken Keep');
  assert.equal(map.width, 4000);
  assert.equal(map.hasThumb, true);
  assert.equal(fs.statSync(db.getBattleMapFile(users.advDm, id).file).size, big.length, 'joined whole');
  assert.match(db.getBattleMapFile(users.advDm, id, { size: 'thumb' }).file, /-thumb\.jpg$/);
  assert.equal(db.getBattleMapFile(users.advDm, id).downloadName, 'The ambush.png');
  assert.equal(fs.readdirSync(path.join(process.env.UPLOADS_DIR, 'battle-maps')).filter(name => /part$/.test(name)).length, 0, 'no parts left');

  // Every DM sees it; players never.
  assert.ok(db.getBattleMap(users.otherDm, id));
  assert.equal(db.getBattleMap(users.player, id), null);
  assert.equal(db.getBattleMapFile(users.player, id), null);

  // Hidden: the adventure's DM, the Root DM and the uploader.
  const secret = upload(users.otherDm, PNG, { adventureId: adventure, name: 'Secret lair', hidden: true });
  const third = createPlayer('admin');
  const thirdDm = { id: third, role: 'admin' };
  assert.ok(db.getBattleMap(users.otherDm, secret), 'the uploader');
  assert.ok(db.getBattleMap(users.advDm, secret), 'the adventure\'s DM');
  assert.ok(db.getBattleMap(users.root, secret));
  assert.equal(db.getBattleMap(thirdDm, secret), null);
  assert.ok(!db.listBattleMaps(thirdDm).some(entry => entry.id === secret));
  assert.throws(() => db.deleteBattleMap({ user: thirdDm, id: secret }), /not found/);
  db.updateBattleMap({ user: users.advDm, id: secret, hidden: false });
  assert.ok(db.getBattleMap(thirdDm, secret), 'shown again');

  // Moving to another adventure: its markers only.
  assert.throws(() => db.updateBattleMap({ user: users.advDm, id, adventureId: other, markerId: marker }), /not one of this adventure/);
  db.updateBattleMap({ user: users.advDm, id: secret, adventureId: other, markerId: '' });
  assert.equal(db.getBattleMap(users.advDm, secret).adventureTitle, 'Ashen Road');
  assert.deepEqual(db.listBattleMaps(users.advDm, { markerId: marker }).map(entry => entry.id), [id]);
  assert.deepEqual(db.listBattleMapAdventures(users.advDm).find(entry => entry.id === adventure).markers.map(entry => entry.name), ['The Keep']);

  const file = db.getBattleMapFile(users.advDm, secret).file;
  db.deleteBattleMap({ user: users.otherDm, id: secret });
  assert.equal(fs.existsSync(file), false);
});

test('the tab, the adventure strip, the world-map marker and the routes', async () => {
  const id = upload(users.advDm, PNG, { adventureId: adventure, markerId: marker, name: 'Docks' });
  const page = (user, query) => renderAdminPage({ session: { user }, query });
  const tab = page(users.otherDm, { tab: 'battle-maps' });
  assert.match(tab, /🗺 Owlbear Maps/);
  assert.match(tab, /id="battle-map-upload-form"/);
  assert.match(tab, /Docks/);
  assert.match(tab, /📍 The Keep · 4\.7/);
  for (const match of tab.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(match[1]));
  assert.doesNotMatch(page(users.player, { tab: 'battle-maps' }), /battle-map-upload-form/);
  assert.match(page(users.advDm, { tab: 'adventures', table: String(adventure) }), /battle-map-strip[\s\S]*Docks/);
  assert.doesNotMatch(page(users.player, { tab: 'adventures', table: String(adventure) }), /battle-map-strip/);
  const world = db.getWorldMap({ user: users.otherDm });
  assert.deepEqual(world.markers.find(entry => entry.id === marker).maps.map(map => map.name), ['Docks', 'The ambush']);
  assert.equal(world.markers.find(entry => entry.id === elsewhere).maps.length, 0);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: req.get('x-user') ? JSON.parse(req.get('x-user')) : null }; next(); });
  app.use('/admin', require('../server'));
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => ({ 'x-user': JSON.stringify({ id: user.id, role: user.role }) });
  try {
    const call = (user, route, body, raw) => fetch(`${base}/api/battle-maps/uploads${route}`, {
      method: 'POST', headers: { ...as(user), 'content-type': raw ? 'application/octet-stream' : 'application/json' }, body: raw ? body : JSON.stringify(body)
    });
    assert.equal((await call(users.player, '', { size: PNG.length })).status, 403);
    const { uploadId } = await (await call(users.advDm, '', { size: PNG.length })).json();
    assert.equal((await call(users.advDm, `/${uploadId}/pieces?offset=0`, PNG, true)).status, 200);
    assert.equal((await call(users.advDm, `/${uploadId}/thumb`, JPG, true)).status, 200);
    const finished = await call(users.advDm, `/${uploadId}/finish`, { adventureId: adventure, name: 'Bridge', hidden: true });
    assert.equal(finished.status, 200);
    const { id: bridge } = await finished.json();
    assert.equal(db.getBattleMap(users.advDm, bridge).hidden, true);

    const image = (user, query = '') => fetch(`${base}/api/battle-maps/${bridge}/image${query}`, { headers: as(user) });
    assert.equal((await image(users.advDm)).status, 200);
    assert.equal((await image(users.advDm, '?size=thumb')).headers.get('content-type'), 'image/jpeg');
    assert.match((await image(users.advDm, '?download=1')).headers.get('content-disposition'), /Bridge\.png/);
    assert.equal((await image({ id: createPlayer('admin'), role: 'admin' })).status, 404, 'hidden from another DM');
    assert.equal((await image(users.player)).status, 404);

    const post = (user, route, body) => fetch(`${base}/admin${route}`, { method: 'POST', redirect: 'manual', headers: { ...as(user), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    assert.equal((await post(users.player, '/battle-maps/delete', { id: String(id) })).status, 403);
    const saved = await post(users.otherDm, '/battle-maps/update', { id: String(id), name: 'Docks at night', note: 'Fog', adventure_id: String(adventure), marker_id: String(marker), hidden: '0', return_to: `/admin?tab=battle-maps#battle-map-${id}` });
    assert.match(saved.headers.get('location'), new RegExp(`status=battle_map_saved#battle-map-${id}$`));
    assert.equal(db.getBattleMap(users.otherDm, id).name, 'Docks at night');
    const gone = await post(users.advDm, '/battle-maps/delete', { id: String(id), return_to: 'https://evil.example/' });
    assert.match(gone.headers.get('location'), /^\/admin\?tab=battle-maps&status=battle_map_deleted/);
  } finally {
    server.close();
  }
});
