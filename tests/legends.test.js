const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `grimbold-legends-${process.pid}-${Date.now()}`);
const { db, createPlayer } = require('./helpers/tempDatabase');
const legends = require('../legends');
const renderAdminPage = require('../views/adminPage');

process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const DOC_ID = 'A'.repeat(30);
const DOC_TWO = 'B'.repeat(30);

// A viewer (on the list), a DM who is not, and the Root DM.
const viewer = createPlayer();
db.prepare("UPDATE players SET discord_id = '1283501577893712003' WHERE id = ?").run(viewer);
const otherDm = createPlayer('admin');
const users = {
  viewer: { id: viewer, discord_tag: 'viewer', role: 'player' },
  otherDm: { id: otherDm, discord_tag: 'otherdm', role: 'admin' },
  root: { id: 0, discord_tag: 'Root DM', role: 'admin' }
};
const characterId = name => db.listLegendCharacters().find(character => character.name === name).id;

const image = (id, extra = {}) => ({ id, name: `${id}.png`, contentType: 'image/png', width: 1200, height: 800, size: 1000, url: `https://cdn.example/${id}.png`, proxyURL: `https://media.example/${id}.png?ex=1`, ...extra });
const message = (id, content, { attachments = [], channelId, embeds = [] } = {}) => ({
  id, content, channelId, guildId: 'guild', createdAt: new Date('2026-11-20T12:00:00Z'),
  author: { id: '507671376371646464', username: 'poster', bot: false }, embeds,
  attachments: new Map(attachments.map(entry => [entry.id, entry]))
});

function fakeChannel(id, messages) {
  return { id, messages: { fetch: async ({ before } = {}) => new Map(before ? [] : messages.map(entry => [entry.id, entry])) }, threads: null };
}

// Google answers for the shared doc (text, formatted, its page) and Discord for images.
async function withFakeWeb(run) {
  const realFetch = global.fetch;
  global.fetch = async url => {
    const text = String(url);
    if (text.includes(`/d/${DOC_ID}/export?format=txt`)) return new Response('Torak przy ognisku.\n\nKoniec.', { headers: { 'content-type': 'text/plain' } });
    if (text.includes(`/d/${DOC_ID}/export?format=html`)) return new Response('<html><body><p>Torak przy ognisku.</p></body></html>', { headers: { 'content-type': 'text/html' } });
    if (text.includes(`/d/${DOC_ID}/edit`)) return new Response('<meta property="og:title" content="Dziennik Toraka - Google Docs">', { headers: { 'content-type': 'text/html' } });
    if (text.includes(DOC_TWO)) return new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
    return new Response(PNG, { status: 200 });
  };
  try {
    return await run();
  } finally {
    global.fetch = realFetch;
  }
}

test('the migration lists the five who see it and the eight characters', () => {
  assert.deepEqual(db.getLegendsViewers(), ['210398055516602369', '1283501577893712003', '507671376371646464', '600030860950896670', '322015943075299330']);
  assert.deepEqual(db.listLegendCharacters().map(character => character.name), ['Aidan', 'Eris', 'Ilphas', 'Kaala', 'Opal', 'Rankor', 'Silv', 'Torak']);
});

test('only the viewers and the Root DM see Legends; other DMs do not', () => {
  assert.equal(db.canSeeLegends(users.viewer), true);
  assert.equal(db.canSeeLegends(users.root), true);
  assert.equal(db.canSeeLegends(users.otherDm), false);
  assert.equal(db.canSeeLegends({ id: createPlayer(), role: 'player' }), false);
  assert.throws(() => db.setLegendsViewers('1283501577893712003\nSelkie'), /Not a Discord ID: Selkie/);

  const page = user => renderAdminPage({ session: { user }, query: { tab: 'legends' } });
  for (const user of [users.viewer, users.root]) {
    const html = page(user);
    assert.match(html, /href="\/admin\?tab=legends"/);
    assert.match(html, /🏛 Legends/);
    for (const [, code] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  }
  const dmPage = page(users.otherDm);
  assert.doesNotMatch(dmPage, /tab=legends|🏛 Legends/, 'not in the tab row, and the tab itself falls back to the shop');
  assert.doesNotMatch(page({ id: createPlayer(), discord_tag: 'x', role: 'player' }), /tab=legends/);
  assert.match(page(users.root), /Who sees Legends/);
  assert.doesNotMatch(page(users.viewer), /Who sees Legends/, 'only the Root DM changes the list');
});

test('names, Polish forms and aliases are matched; a word two characters share is not', () => {
  const characters = [{ id: 1, name: 'Torak', aliases: '' }, { id: 2, name: 'Ilphas', aliases: 'Ilph, Ilphas the Grey' }, { id: 3, name: 'Silv', aliases: 'Silvana' }, { id: 4, name: 'Silvana Moon', aliases: '' }];
  assert.deepEqual(db.matchLegendCharacters('Torakowi i Ilph w karczmie', characters).sort(), [1, 2]);
  assert.deepEqual(db.matchLegendCharacters('Silvana at dawn', characters), [], 'Silvana is an alias of one and the first name of another');
  assert.deepEqual(db.matchLegendCharacters('Silvana Moon at dawn', characters), [4]);
  assert.deepEqual(db.matchLegendCharacters('nothing here', characters), []);
});

test('both channels are read into Legends only; Chronicles and Art stay empty', async () => {
  const docsChannel = fakeChannel(legends.docsChannelId(), [
    message('d1', `Dziennik https://docs.google.com/document/d/${DOC_ID}/edit`, { channelId: legends.docsChannelId() }),
    message('d2', `Coś nowego https://docs.google.com/document/d/${DOC_TWO}/edit`, { channelId: legends.docsChannelId() })
  ]);
  const artChannel = fakeChannel(legends.artChannelId(), [
    message('a1', 'Eris i Opal', { attachments: [image('i1'), image('i2')], channelId: legends.artChannelId() }),
    message('a2', 'lol', { attachments: [image('i3')], channelId: legends.artChannelId() }),
    message('a3', 'just text', { channelId: legends.artChannelId() })
  ]);
  legends.setClientForTests({ isReady: () => true, channels: { fetch: async id => (id === docsChannel.id ? docsChannel : id === artChannel.id ? artChannel : null) } });
  const result = await withFakeWeb(() => legends.scanChannels({ all: true }));
  assert.equal(result.docs, 2);
  assert.equal(result.images, 3);
  assert.deepEqual(result.errors, []);

  const torakDoc = db.listLegendDocs({ characterId: characterId('Torak') });
  assert.equal(torakDoc.length, 1, "the doc's title (from Google) names Torak");
  assert.equal(torakDoc[0].title, 'Dziennik Toraka');
  assert.equal(torakDoc[0].kind, 'diary');
  assert.match(db.getLegendDoc(torakDoc[0].id).saved_text, /przy ognisku/);
  const [closed] = db.listLegendDocs({ view: 'unsorted' });
  assert.equal(closed.access, 'restricted');

  const tagged = db.listLegendImages();
  assert.equal(tagged.length, 2);
  assert.deepEqual(tagged[0].characters.map(character => character.name), ['Eris', 'Opal']);
  assert.ok(tagged.every(entry => entry.file), 'copies kept');
  assert.equal(db.listLegendImages({ view: 'unsorted' }).length, 1);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_docs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM art_images').get().n, 0);
  assert.doesNotMatch(renderAdminPage({ session: { user: users.root }, query: { tab: 'art' } }), /api\/legends/);

  // Read again: nothing new.
  const again = await withFakeWeb(() => legends.scanChannels({ all: true }));
  assert.equal(again.docs + again.images, 0);
});

test('a character added later (or an alias) sorts what names them; hand tags stay', () => {
  const [lol] = db.listLegendImages({ view: 'unsorted' });
  const eris = characterId('Eris');
  const [pair] = db.listLegendImages({ characterId: eris });
  db.updateLegendImage(pair.id, { characterIds: [String(eris)] });
  const id = db.saveLegendCharacter({ name: 'Lolek', aliases: 'lol' });
  assert.deepEqual(db.getLegendImage(lol.id).characters.map(character => character.id), [id], 'the alias names the unsorted image');
  assert.deepEqual(db.getLegendImage(pair.id).characters.map(character => character.id), [eris], 'tagged by hand: kept');
  assert.throws(() => db.saveLegendCharacter({ name: 'lolek' }), /already a character called/);
  db.deleteLegendCharacter(id);
  assert.equal(db.getLegendImage(lol.id).characters.length, 0, 'back to sorting');
  db.updateLegendImage(lol.id, { hidden: true });
  assert.equal(db.listLegendImages({ view: 'hidden' }).length, 1);
  assert.match(renderAdminPage({ session: { user: users.viewer }, query: { tab: 'legends', view: 'unsorted' } }), /sort-doc-/);
  const profile = renderAdminPage({ session: { user: users.viewer }, query: { tab: 'legends', who: String(eris), image: String(pair.id) } });
  assert.match(profile, /Edit Eris/);
  assert.match(profile, new RegExp(`name="character_ids" value="${eris}" checked`));
});

test('the forms and the images answer only those who see Legends', async () => {
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: JSON.parse(req.get('x-user')) }; next(); });
  app.use('/admin', require('../server'));
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => ({ 'x-user': JSON.stringify({ id: user.id, role: user.role }) });
  const post = (route, user, body) => fetch(`${base}/admin${route}`, {
    method: 'POST', redirect: 'manual', headers: { ...as(user), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
  });
  try {
    const [first] = db.listLegendImages();
    const opal = characterId('Opal');
    const saved = await post('/legends/images/update', users.viewer, { id: String(first.id), tag_form: '1', character_ids: String(opal), artist: 'Selkie' });
    assert.equal(saved.status, 302);
    assert.deepEqual(db.getLegendImage(first.id).characters.map(character => character.id), [opal]);
    assert.equal(db.getLegendImage(first.id).artist_name, 'Selkie');
    assert.equal((await post('/legends/images/update', users.otherDm, { id: String(first.id), hidden: '1' })).status, 403, 'a DM not on the list');
    assert.equal(db.getLegendImage(first.id).hidden, false);
    assert.equal((await post('/legends/characters/save', users.viewer, { name: 'Bryn' })).status, 302);
    assert.ok(db.listLegendCharacters().some(character => character.name === 'Bryn'));
    assert.equal((await post('/legends/viewers', users.viewer, { discord_ids: '' })).status, 403);
    assert.equal((await post('/legends/viewers', users.root, { discord_ids: '1283501577893712003\n600030860950896670' })).status, 302);
    assert.deepEqual(db.getLegendsViewers(), ['1283501577893712003', '600030860950896670']);

    const picture = user => fetch(`${base}/api/legends/images/${first.id}?size=thumb`, { headers: as(user) });
    assert.equal((await picture(users.viewer)).status, 200);
    assert.equal((await picture(users.otherDm)).status, 404);
    const refresh = await fetch(`${base}/api/legends/docs/1/refresh`, { method: 'POST', headers: as(users.otherDm) });
    assert.equal(refresh.status, 404);
  } finally {
    server.close();
  }
});

test('To sort in bulk: select many, tag them at once (adding to who is there) or hide them', async () => {
  const add = (id, poster) => db.recordLegendImages({ messageId: `bulk-${id}`, channelId: 'c', guildId: 'g', posterDiscordId: poster, posterTag: poster, postedAt: '2026-11-21T10:00:00Z', text: '', attachments: [image(`bulk-${id}`)] }).created[0];
  const ids = Array.from({ length: 130 }, (_, index) => add(index, index < 125 ? '600030860950896670' : '322015943075299330'));
  const [aidan, rankor] = [characterId('Aidan'), characterId('Rankor')];
  assert.equal(db.listLegendUnsortedPosters()[0].count, 125);
  assert.equal(db.listLegendImages({ view: 'unsorted', poster: '322015943075299330' }).length, 5);

  const page = query => renderAdminPage({ session: { user: users.viewer }, query: { tab: 'legends', view: 'unsorted', ...query } });
  const first = page({});
  assert.equal((first.match(/name="image_ids" value=/g) || []).length, 120, '120 to a page');
  assert.match(first, /page=2/);
  assert.match(first, /data-key="1"/);
  for (const [, code] of first.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  assert.equal((page({ poster: '322015943075299330' }).match(/name="image_ids" value=/g) || []).length, 5);

  assert.throws(() => db.tagLegendImages(ids.slice(0, 3), { characterIds: [] }), /Tick who/);
  assert.throws(() => db.tagLegendImages([], { characterIds: [aidan] }), /Select some/);
  db.updateLegendImage(ids[0], { characterIds: [rankor] });
  assert.equal(db.tagLegendImages(ids.slice(0, 100), { characterIds: [String(aidan)] }), 100);
  assert.deepEqual(db.getLegendImage(ids[0]).characters.map(character => character.name), ['Aidan', 'Rankor'], 'added to who was there');
  assert.equal(db.getLegendImage(ids[50]).tagged_by, 'hand');

  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: JSON.parse(req.get('x-user')) }; next(); });
  app.use('/admin', require('../server'));
  const server = app.listen(0);
  try {
    const post = (user, body) => fetch(`http://127.0.0.1:${server.address().port}/admin/legends/images/bulk`, {
      method: 'POST', redirect: 'manual', headers: { 'x-user': JSON.stringify({ id: user.id, role: user.role }), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([...ids.slice(100, 110).map(id => ['image_ids', String(id)]), ...Object.entries(body)])
    });
    assert.equal((await post(users.otherDm, { action: 'hide' })).status, 403);
    const hid = await post(users.viewer, { action: 'hide', return_to: '/admin?tab=legends&view=unsorted&poster=600030860950896670' });
    assert.equal(hid.status, 302);
    assert.match(hid.headers.get('location'), /poster=600030860950896670&status=legend_bulk_hidden&n=10/);
    assert.ok(ids.slice(100, 110).every(id => db.getLegendImage(id).hidden));
  } finally {
    server.close();
  }
});

test('uploading pictures on the tab: tagged on the way in, or To sort; only the uploader or Root deletes', async () => {
  const opal = characterId('Opal');
  assert.throws(() => db.uploadLegendImage({ user: users.otherDm, buffer: PNG }), /Forbidden/);
  assert.throws(() => db.uploadLegendImage({ user: users.viewer, buffer: Buffer.from('not an image') }), /Only PNG/);
  const tagged = db.uploadLegendImage({ user: users.viewer, buffer: PNG, characterIds: [String(opal)], artist: 'Selkie', artistUrl: 'https://selkie.example', caption: 'Opal at the docks' });
  const shown = db.getLegendImage(tagged);
  assert.equal(shown.uploaded, true);
  assert.equal(shown.tagged_by, 'hand');
  assert.deepEqual(shown.characters.map(character => character.id), [opal]);
  assert.equal(shown.artist_name, 'Selkie');
  assert.ok(shown.imageUrl);
  const loose = db.uploadLegendImage({ user: users.root, buffer: PNG });
  assert.ok(db.listLegendImages({ view: 'unsorted' }).some(entry => entry.id === loose), 'nobody ticked: To sort');
  assert.equal(db.getLegendImage(loose).posted_by_tag, 'Root DM');

  assert.equal(db.canDeleteLegendImage(users.viewer, loose), false, 'not their upload');
  assert.equal(db.canDeleteLegendImage(users.root, tagged), true);
  const [posted] = db.listLegendImages().filter(entry => !entry.uploaded);
  assert.throws(() => db.deleteLegendUpload(posted.id, users.root), /Only uploaded/);

  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: JSON.parse(req.get('x-user')) }; next(); });
  app.use('/admin', require('../server'));
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => ({ 'x-user': JSON.stringify({ id: user.id, role: user.role }) });
  try {
    const upload = user => fetch(`${base}/api/legends/upload`, { method: 'POST', headers: { ...as(user), 'content-type': 'image/png', 'x-characters': String(opal), 'x-artist': encodeURIComponent('Zażółć') }, body: PNG });
    assert.equal((await upload(users.otherDm)).status, 403);
    const response = await upload(users.viewer);
    assert.equal(response.status, 200);
    const { id } = await response.json();
    assert.equal(db.getLegendImage(id).artist_name, 'Zażółć');
    const remove = await fetch(`${base}/admin/legends/images/delete`, { method: 'POST', redirect: 'manual', headers: { ...as(users.viewer), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: String(id) }) });
    assert.equal(remove.status, 302);
    assert.equal(db.getLegendImage(id), null);
  } finally {
    server.close();
  }
  db.deleteLegendUpload(tagged, users.viewer);
  assert.equal(db.getLegendImage(tagged), null);
});

test('top 4 picks: each viewer ranks four pictures, and everyone on the tab sees them', async () => {
  const pictures = Array.from({ length: 5 }, () => db.uploadLegendImage({ user: users.viewer, buffer: PNG, characterIds: [characterId('Eris')] }));
  const order = () => db.listLegendPicks().find(entry => entry.playerId === viewer).picks.map(image => image.id);
  assert.throws(() => db.setLegendPick(users.root, pictures[0], 1), /Only players/);
  assert.throws(() => db.setLegendPick(users.otherDm, pictures[0], 1), /Only players/);
  assert.throws(() => db.setLegendPick(users.viewer, pictures[0], 5), /from 1 to 4/);
  for (const [index, id] of pictures.slice(0, 4).entries()) db.setLegendPick(users.viewer, id, index + 1);
  assert.deepEqual(order(), pictures.slice(0, 4));
  const { rank, dropped } = db.setLegendPick(users.viewer, pictures[4], 2);
  assert.equal(rank, 2);
  assert.equal(dropped, pictures[3], 'the old #4 falls out');
  assert.deepEqual(order(), [pictures[0], pictures[4], pictures[1], pictures[2]]);
  db.setLegendPick(users.viewer, pictures[2], 1);
  assert.deepEqual(order(), [pictures[2], pictures[0], pictures[4], pictures[1]], 'moving one already picked drops nothing');
  db.moveLegendPick(users.viewer, pictures[1], -1);
  assert.deepEqual(order(), [pictures[2], pictures[0], pictures[1], pictures[4]]);
  db.removeLegendPick(users.viewer, pictures[0]);
  assert.deepEqual(order(), [pictures[2], pictures[1], pictures[4]]);
  db.updateLegendImage(pictures[3], { hidden: true });
  assert.throws(() => db.setLegendPick(users.viewer, pictures[3], 1), /hidden/);
  db.deleteLegendUpload(pictures[4], users.viewer);
  assert.deepEqual(order(), [pictures[2], pictures[1]], 'a deleted picture leaves the picks');

  // Root sees the picks page; the viewer gets the buttons.
  const page = (user, query) => renderAdminPage({ session: { user }, query: { tab: 'legends', ...query } });
  const rootPicks = page(users.root, { view: 'picks' });
  assert.match(rootPicks, /legend-picks-row/);
  assert.doesNotMatch(rootPicks, /value="up"/, 'Root only looks');
  const own = page(users.viewer, { view: 'picks' });
  assert.match(own, /Your picks/);
  assert.match(own, /value="down"/);
  const opened = page(users.viewer, { image: String(pictures[2]) });
  assert.match(opened, /name="rank" value="1" class="btn btn-small btn-gold" aria-pressed="true"/);
  assert.match(opened, /Delete upload/);
  assert.match(page(users.viewer, { view: 'art' }), /legend-pick-badge[^>]*>⭐1/);
  assert.match(page(users.viewer, {}), /id="legend-upload"/);
  for (const [, code] of page(users.viewer, {}).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));

  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: JSON.parse(req.get('x-user')) }; next(); });
  app.use('/admin', require('../server'));
  const server = app.listen(0);
  try {
    const post = (user, body) => fetch(`http://127.0.0.1:${server.address().port}/admin/legends/picks`, {
      method: 'POST', redirect: 'manual', headers: { 'x-user': JSON.stringify({ id: user.id, role: user.role }), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
    });
    assert.equal((await post(users.otherDm, { image_id: String(pictures[0]), rank: '1' })).status, 403);
    const done = await post(users.viewer, { image_id: String(pictures[0]), rank: '1', return_to: `/admin?tab=legends&image=${pictures[0]}#legend-viewer` });
    assert.equal(done.status, 302);
    assert.match(done.headers.get('location'), /status=legend_picked&rank=1#legend-viewer$/);
    assert.equal(order()[0], pictures[0]);
  } finally {
    server.close();
  }
});
