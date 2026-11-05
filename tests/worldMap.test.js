const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const root = { id: 0, role: 'admin' };
const character = (playerId, name) => Number(db.prepare(`INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
  VALUES (?, ?, 'Human', 'Fighter', 'Champion', 3, 0, 'alive', 0, '{}')`).run(playerId, name).lastInsertRowid);

test('hexes are column.row inside the grid', () => {
  assert.equal(db.parseMapHex(' 9.6 '), '9.6');
  assert.equal(db.parseMapHex('21,16'), '21.16');
  assert.throws(() => db.parseMapHex('22.1'), /no hex/);
  assert.throws(() => db.parseMapHex('0.3'), /no hex/);
  assert.throws(() => db.parseMapHex('A1'), /no hex/);
});

test('fog of war: a player sees the routes of their parties, the adventures they DM, and hand reveals; markers only where shown', () => {
  const ola = createPlayer();
  const tom = createPlayer();
  const kael = character(ola, 'Kael');
  const brin = character(ola, 'Brin');
  const asOla = { id: ola, role: 'player' };
  const wolves = db.createAdventureFromThread({ threadId: `map-a-${ola}`, title: 'Wilki', ownerDiscordId: null }).adventure;
  const ruins = db.createAdventureFromThread({ threadId: `map-b-${ola}`, title: 'Ruiny', ownerDiscordId: null }).adventure;
  db.prepare('UPDATE adventures SET dm_player_id = ? WHERE id = ?').run(tom, ruins.id);

  ['9.6', '9.7'].forEach(hex => db.setAdventureHex({ user: root, adventureId: wolves.id, hex }));
  db.setAdventureHex({ user: { id: tom, role: 'player' }, adventureId: ruins.id, hex: '12.12' });
  assert.throws(() => db.setAdventureHex({ user: asOla, adventureId: ruins.id, hex: '1.1' }), /Only this adventure's DM/);
  assert.throws(() => db.setCharacterHex({ user: { id: tom, role: 'player' }, characterId: kael, hex: '1.1' }), /Only a DM/);
  db.setCharacterHex({ user: root, characterId: brin, hex: '6.7' });

  const shown = db.saveMapMarker({ user: root, hex: '9.6', name: 'Port', icon: 'city', note: 'Harbour', secret: false, adventureIds: [wolves.id, ruins.id] });
  db.saveMapMarker({ user: root, hex: '9.7', name: 'Den', icon: 'danger', secret: true });
  db.saveMapMarker({ user: root, hex: '12.12', name: 'Shrine', icon: 'star', secret: false });
  assert.throws(() => db.saveMapMarker({ user: asOla, hex: '1.1', name: 'Mine' }), /Only a DM/);
  assert.throws(() => db.saveMapMarker({ user: root, hex: '1.1', name: 'X', icon: 'castle' }), /icons/);

  // Not in the party yet: only Brin's hand reveal.
  let map = db.getWorldMap({ user: asOla });
  assert.deepEqual(map.revealed, ['6.7']);
  assert.deepEqual(map.markers, []);

  db.setPartyMember({ adventureId: wolves.id, user: root, characterId: kael, inParty: true });
  map = db.getWorldMap({ user: asOla });
  assert.deepEqual(map.revealed.sort(), ['6.7', '9.6', '9.7']);
  assert.deepEqual(map.markers, [{ id: shown, hex: '9.6', name: 'Port', icon: 'city', note: 'Harbour' }], 'shown, revealed, and no adventure link or secrecy flag');
  assert.deepEqual(map.visits.filter(visit => visit.hex === '9.6'), [{ hex: '9.6', character: 'Kael', via: 'Wilki' }]);

  // Tom DMs Ruiny: its route is his, and he can mark it.
  const tomMap = db.getWorldMap({ user: { id: tom, role: 'player' } });
  assert.deepEqual(tomMap.revealed, ['12.12']);
  assert.deepEqual(tomMap.markers.map(marker => marker.name), ['Shrine']);
  assert.deepEqual(tomMap.routes.map(route => route.title), ['Ruiny']);

  // Out of the party again: the route goes with it.
  db.setPartyMember({ adventureId: wolves.id, user: root, characterId: kael, inParty: false });
  assert.deepEqual(db.getWorldMap({ user: asOla }).revealed, ['6.7']);

  // DMs: everything, with the secrets; or through a player's eyes.
  const dmMap = db.getWorldMap({ user: root });
  assert.equal(dmMap.revealed, null);
  assert.deepEqual(dmMap.markers.map(marker => [marker.name, marker.secret]), [['Shrine', false], ['Port', false], ['Den', true]]);
  assert.deepEqual(dmMap.markers.find(marker => marker.name === 'Port').adventures.map(adventure => adventure.title), ['Wilki', 'Ruiny'], 'several adventures in one place');
  db.saveMapMarker({ user: root, id: shown, hex: '9.6', name: 'Port', icon: 'city', note: 'Harbour', secret: false, adventureIds: [ruins.id] });
  assert.deepEqual(db.getWorldMap({ user: root }).markers.find(marker => marker.name === 'Port').adventures.map(adventure => adventure.title), ['Ruiny']);
  assert.throws(() => db.saveMapMarker({ user: root, hex: '1.1', name: 'X', adventureIds: [99999] }), /not known/);
  const asPlayer = db.getWorldMap({ user: root, asPlayerId: ola });
  assert.deepEqual([asPlayer.revealed, asPlayer.asPlayerId], [['6.7'], ola]);
});

test('the map over HTTP: the image, the grid, and no secrets for players', async () => {
  const ola = createPlayer();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')), ...(req.get('x-user') === '0' ? { role: 'admin', username: 'root' } : {}) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/map`;
  const call = (userId, path, body, type) => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-user': String(userId), ...(body ? { 'Content-Type': type || 'application/json' } : {}) },
    body: body ? (type ? body : JSON.stringify(body)) : undefined
  });
  try {
    db.prepare("UPDATE players SET password_hash = 'x' WHERE id = ?").run(ola);
    assert.equal((await call(ola, '/image', PNG, 'image/png')).status, 403);
    let response = await call(0, '/image', PNG, 'image/png');
    assert.equal(response.status, 200);
    assert.match((await response.json()).imageUrl, /^\/api\/map\/image\?v=world-/);
    response = await call(ola, '/image');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');

    assert.equal((await call(0, '/grid', { cols: 21, rows: 16, originX: 90, originY: 55, size: 62 })).status, 200);
    assert.equal((await call(0, '/grid', { cols: 0, rows: 16, originX: 90, originY: 55, size: 62 })).status, 400);
    await call(0, '/markers', { hex: '3.3', name: 'Secret cave', icon: 'site', secret: true });
    const asPlayer = await (await call(ola, '')).json();
    assert.deepEqual([asPlayer.grid.originX, asPlayer.revealed, asPlayer.markers, asPlayer.characters], [90, [], [], undefined]);
    const asDm = await (await call(0, '')).json();
    const cave = asDm.markers.find(marker => marker.name === 'Secret cave');
    assert.equal(cave.secret, true);
    assert.equal((await call(ola, `/markers/${cave.id}/delete`, {})).status, 403);
    assert.equal((await call(0, `/markers/${cave.id}/delete`, {})).status, 200);
  } finally {
    server.close();
  }
});

test('hexes revealed to everyone: every player sees them (and their shown markers), whatever adventures they went on', () => {
  const sam = createPlayer();
  character(sam, 'Sam');
  const asSam = { id: sam, role: 'player' };
  db.saveMapMarker({ user: root, hex: '15.3', name: 'Grimbold\'s Emporium', icon: 'city', secret: false });
  assert.deepEqual(db.getWorldMap({ user: asSam }).revealed, []);
  assert.throws(() => db.setPublicHex({ user: asSam, hex: '15.3' }), /Only a DM/);
  db.setPublicHex({ user: root, hex: '15.3' });
  const map = db.getWorldMap({ user: asSam });
  assert.deepEqual(map.revealed, ['15.3']);
  assert.deepEqual(map.visits, [{ hex: '15.3', character: null, via: null, everyone: true }]);
  assert.deepEqual(map.markers.map(marker => marker.name), ['Grimbold\'s Emporium']);
  assert.deepEqual(db.getWorldMap({ user: root }).publicHexes, ['15.3']);
  db.setPublicHex({ user: root, hex: '15.3', on: false });
  assert.deepEqual(db.getWorldMap({ user: asSam }).revealed, []);
});

test('a big map image goes up in pieces (the web server in front refuses big requests)', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(1200 * 1024, 7)]);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')), ...(req.get('x-user') === '0' ? { role: 'admin', username: 'root' } : {}) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/map`;
  const post = (path, body, raw) => fetch(base + path, {
    method: 'POST', headers: { 'x-user': '0', 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }, body: raw ? body : JSON.stringify(body)
  }).then(async response => ({ status: response.status, body: await response.json() }));
  try {
    assert.equal((await post('/uploads', { size: 30 * 1024 * 1024 })).status, 400, 'over 25 MB');
    const { uploadId, pieceBytes } = (await post('/uploads', { size: big.length })).body;
    assert.equal(pieceBytes, 512 * 1024);
    let offset = 0;
    for (; offset < big.length; offset += pieceBytes) {
      const piece = await post(`/uploads/${uploadId}/pieces?offset=${offset}`, big.subarray(offset, offset + pieceBytes), true);
      assert.equal(piece.status, 200);
    }
    assert.equal((await post(`/uploads/${uploadId}/pieces?offset=0`, big.subarray(0, 10), true)).status, 400, 'a repeated piece is caught');
    const done = await post(`/uploads/${uploadId}/finish`, {});
    assert.equal(done.status, 200);
    assert.match(done.body.imageUrl, /^\/api\/map\/image\?v=world-.+\.png$/);
    const image = await fetch(base + '/image', { headers: { 'x-user': '0' } });
    assert.equal(Buffer.from(await image.arrayBuffer()).length, big.length);
    assert.equal((await post(`/uploads/${uploadId}/finish`, {})).status, 400, 'the parts are gone');
  } finally {
    server.close();
  }
});

test('many hexes at once (painted or filled): to everyone, a route, or one character', () => {
  const kit = createPlayer();
  const hero = character(kit, 'Hero');
  const asKit = { id: kit, role: 'player' };
  const sea = ['10.1', '11.1', '12.1', '12.2'];
  db.setPublicHex({ user: root, hexes: sea });
  assert.deepEqual(db.getWorldMap({ user: asKit }).revealed.sort(), [...sea].sort());
  db.setPublicHex({ user: root, hexes: ['11.1', '12.2'], on: false });
  assert.deepEqual(db.getWorldMap({ user: asKit }).revealed.sort(), ['10.1', '12.1']);
  assert.throws(() => db.setPublicHex({ user: root, hexes: ['1.1', '99.1'] }), /no hex "99.1"/);
  assert.deepEqual(db.getWorldMap({ user: asKit }).revealed.sort(), ['10.1', '12.1'], 'a bad hex changes nothing');
  assert.throws(() => db.setPublicHex({ user: root, hexes: [] }), /Pick the hexes/);

  db.setCharacterHex({ user: root, characterId: hero, hexes: ['2.2', '2.3'] });
  const trip = db.createAdventureFromThread({ threadId: `map-c-${kit}`, title: 'Trip', ownerDiscordId: null }).adventure;
  db.setAdventureHex({ user: root, adventureId: trip.id, hexes: ['3.3', '3.4'] });
  db.setPartyMember({ adventureId: trip.id, user: root, characterId: hero, inParty: true });
  assert.deepEqual(db.getWorldMap({ user: asKit }).revealed.sort(), ['10.1', '12.1', '2.2', '2.3', '3.3', '3.4']);
  db.setPublicHex({ user: root, hexes: ['10.1', '12.1'], on: false });
});
