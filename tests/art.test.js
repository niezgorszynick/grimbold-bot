const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `grimbold-art-${process.pid}-${Date.now()}`);
const { db, createPlayer } = require('./helpers/tempDatabase');
const art = require('../art');
const renderAdminPage = require('../views/adminPage');

process.on('exit', () => fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

function addCharacter(playerId, name, status = 'alive') {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Elf', 'Wizard', 'Evoker', 3, 0, ?, 0, '{}')
  `).run(playerId, name, status).lastInsertRowid);
}

function addAdventure(title, createdAt, characterIds, status = 'completed') {
  const id = Number(db.prepare('INSERT INTO adventures (title, xp_awarded, status, created_at) VALUES (?, 1, ?, ?)').run(title, status, createdAt).lastInsertRowid);
  for (const characterId of characterIds) db.prepare('INSERT INTO adventure_party (adventure_id, character_id) VALUES (?, ?)').run(id, characterId);
  return id;
}

const owner = createPlayer();
const ownerDiscord = db.prepare('SELECT discord_id FROM players WHERE id = ?').get(owner).discord_id;
const elara = addCharacter(owner, 'Elara Moonwhisper');
const thorin = addCharacter(owner, 'Thorin Ironfist');
const brom = addCharacter(owner, 'Brom', 'dead');
const keep = addAdventure('Sunken Keep', '2026-10-01 18:00:00', [elara, thorin]);
const wolves = addAdventure('Wilki z Doliny', '2026-11-01 18:00:00', [elara]);
addAdventure('Cancelled Trip', '2026-11-10 18:00:00', [elara, thorin], 'cancelled');

const image = (id, extra = {}) => ({ id, name: `${id}.png`, contentType: 'image/png', width: 1200, height: 800, size: 1000, url: `https://cdn.example/${id}.png`, proxyURL: `https://media.example/${id}.png?ex=1`, ...extra });
const message = (id, content, attachments, extra = {}) => ({
  id, content, channelId: 'art-chan', guildId: 'guild', createdAt: new Date('2026-11-20T12:00:00Z'),
  author: { id: ownerDiscord, username: 'owner', bot: false }, embeds: [],
  attachments: new Map(attachments.map(entry => [entry.id, entry])), ...extra
});

test('characters are found by full name, or by a first name only one of them has (declined too)', () => {
  const characters = [{ id: 1, name: 'Elara Moonwhisper' }, { id: 2, name: 'Thorin Ironfist' }, { id: 3, name: 'Thorin Oakenshield' }, { id: 4, name: 'Brom' }];
  assert.deepEqual(db.matchArtCharacters({ text: 'Elarze i Bromowi w karczmie', characters }).sort(), [1, 4]);
  assert.deepEqual(db.matchArtCharacters({ text: 'Thorin at the gate', characters }), [], 'two Thorins: nobody is guessed');
  assert.deepEqual(db.matchArtCharacters({ text: 'Thorin Ironfist and Elara', characters }).sort(), [1, 2]);
  assert.deepEqual(db.matchArtCharacters({ text: 'lol', characters }), []);
  assert.equal(db.matchArtAdventure({ text: 'Elara — the sunken keep!', adventures: [{ id: 7, title: 'Sunken Keep' }, { id: 8, title: 'Keep' }] }), 7);
});

test('the adventure is guessed: the latest one all the tagged characters were in before the post', () => {
  assert.equal(db.guessArtAdventure({ characterIds: [elara], postedAt: '2026-11-20T12:00:00.000Z' }), wolves);
  assert.equal(db.guessArtAdventure({ characterIds: [elara, thorin], postedAt: '2026-11-20T12:00:00.000Z' }), keep, 'the cancelled one is not counted');
  assert.equal(db.guessArtAdventure({ characterIds: [elara], postedAt: '2026-10-15T12:00:00.000Z' }), keep, 'not one opened after the post');
  assert.equal(db.guessArtAdventure({ characterIds: [brom], postedAt: '2026-11-20T12:00:00.000Z' }), null);
});

test('the channel is read, images copied and tagged from the post; memes wait to be sorted', async () => {
  const downloads = [];
  const realFetch = global.fetch;
  global.fetch = async url => { downloads.push(url); return new Response(PNG, { status: 200 }); };
  try {
    const pages = {
      chan: [
        message('m1', 'Elara i Thorin, fan art', [image('a1'), image('a2')]),
        message('m2', 'xD', [image('a3', { width: 300, height: 200 })]),
        message('m3', 'just text', []),
        message('m4', 'a video', [image('a4', { contentType: 'video/mp4', name: 'a4.mp4' })]),
        message('m5', 'by Grimbold', [image('a5')], { author: { id: 'bot', bot: true } })
      ]
    };
    const channel = { id: 'art-chan', messages: { fetch: async ({ before } = {}) => new Map(before ? [] : pages.chan.map(entry => [entry.id, entry])) }, threads: null };
    art.setClientForTests({ isReady: () => true, channels: { fetch: async () => channel } });
    const result = await art.scanChannel({ all: true });
    assert.equal(result.found, 3, 'two images of one post and the meme; no video, no bot');
    assert.equal(result.messages, 4);

    const [first, second] = db.getArtMessage('m1');
    assert.deepEqual(first.characters.map(character => character.id).sort(), [elara, thorin].sort());
    assert.equal(first.tagged_by, 'name');
    assert.equal(first.adventure_id, keep, 'guessed from the two of them');
    assert.equal(first.adventure_by, 'guess');
    assert.ok(first.file && first.thumb_file === null, 'a copy kept (the thumbnail was no smaller)');
    assert.equal(second.characters.length, 2);
    assert.ok(downloads.some(url => /width=480&height=320&format=webp/.test(url)), 'a smaller copy asked of the media proxy');
    assert.ok(db.getArtFile(first.id));

    const [meme] = db.getArtMessage('m2');
    assert.equal(meme.visible, false);
    assert.deepEqual(db.listArtImages({ view: 'unsorted' }).map(entry => entry.id), [meme.id]);
    assert.equal(db.listArtImages().length, 2);
    assert.equal(db.getArtImage(meme.id, { isAdmin: false }), null, 'players see only the gallery');

    const again = await art.scanChannel({ all: true });
    assert.equal(again.found, 0, 'each image once');

    // The post is edited to name someone: the untouched meme is tagged then.
    pages.chan[1] = { ...pages.chan[1], content: 'Brom, wiecznie żywy' };
    await art.scanChannel();
    assert.deepEqual(db.getArtMessage('m2')[0].characters.map(character => character.id), [brom]);
  } finally {
    global.fetch = realFetch;
  }
});

test('Tag art in Discord: characters per menu, the adventure, Not art; only for panel players', async () => {
  const view = art.tagView('m1');
  const menus = view.components.map(row => row.toJSON().components[0]);
  assert.equal(menus[0].custom_id, 'art:c:m1:0');
  assert.deepEqual(menus[0].options.filter(option => option.default).map(option => Number(option.value)).sort(), [elara, thorin].sort());
  assert.match(menus[0].options.at(-1).label, /Brom †/, 'the dead come last');
  assert.equal(menus[1].custom_id, 'art:a:m1');
  assert.equal(menus[1].options.find(option => option.default).value, 'guess');
  assert.ok(!menus[1].options.some(option => option.label === 'Cancelled Trip'));
  assert.match(view.content, /Sunken Keep \(guessed\)/);

  const replies = [];
  const interaction = (customId, values, options) => ({
    customId, values, user: { id: ownerDiscord },
    component: { options: (options || []).map(value => ({ value: String(value) })) },
    update: async payload => replies.push(['update', payload]),
    reply: async payload => replies.push(['reply', payload])
  });
  const offered = [elara, thorin, brom];
  await art.handleArtInteraction(interaction('art:c:m1:0', [String(elara)], offered));
  let [first] = db.getArtMessage('m1');
  assert.deepEqual(first.characters.map(character => character.id), [elara]);
  assert.equal(first.tagged_by, 'discord');
  assert.equal(first.adventure_id, wolves, 'the guess follows the tags');
  assert.deepEqual(db.getArtMessage('m1')[1].characters.map(character => character.id), [elara], 'every image of the post');

  await art.handleArtInteraction(interaction('art:a:m1', [String(keep)]));
  assert.equal(db.getArtMessage('m1')[0].adventure_by, 'discord');
  await art.handleArtInteraction(interaction('art:c:m1:0', [String(elara), String(brom)], offered));
  assert.equal(db.getArtMessage('m1')[0].adventure_id, keep, 'a chosen adventure stays');
  await art.handleArtInteraction(interaction('art:a:m1', ['none']));
  assert.equal(db.getArtMessage('m1')[0].adventure_id, null);

  await art.handleArtInteraction(interaction('art:x:m2', []));
  [first] = db.getArtMessage('m2');
  assert.equal(first.not_art, true);
  assert.equal(db.listArtImages({ view: 'not_art' }).length, 1);
  assert.match(replies.at(-1)[1].content, /Not art/);

  const stranger = { ...interaction('art:x:m2', []), user: { id: 'nobody' } };
  await art.handleArtInteraction(stranger);
  assert.equal(replies.at(-1)[0], 'reply');
  assert.equal(db.getArtMessage('m2')[0].not_art, true, 'a stranger changes nothing');
});

test('the Art tab, the sheet and the adventure show the gallery; DMs tag in the panel', () => {
  const [first] = db.getArtMessage('m1');
  db.updateArtImage(first.id, { characterIds: [String(thorin)], adventure: 'guess', notArt: false });
  const updated = db.getArtImage(first.id);
  assert.deepEqual(updated.characters.map(character => character.id), [thorin]);
  assert.equal(updated.adventure_id, keep);
  assert.equal(updated.tagged_by, 'dm');

  const admin = { id: 0, discord_tag: 'admin', role: 'admin' };
  const player = { id: owner, discord_tag: 'owner', role: 'player' };
  for (const user of [admin, player]) {
    const html = renderAdminPage({ session: { user }, query: { tab: 'art', art: String(first.id) } });
    assert.match(html, /🎨 Art/);
    assert.match(html, new RegExp(`/api/art/${first.id}/image\\?v=`));
    assert.equal(/Import past messages/.test(html), user === admin);
    assert.equal(/Tag this image/.test(html), user === admin);
  }
  const viewer = renderAdminPage({ session: { user: admin }, query: { tab: 'art', art: String(first.id) } });
  assert.match(viewer, new RegExp(`name="character_ids" value="${thorin}" checked`), 'ticked chips, not a multi-select');
  assert.match(viewer, /owner's characters/, "the poster's characters first");
  for (const [, code] of viewer.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  assert.match(renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'unsorted' } }), /Nothing to sort/);
  db.updateArtImage(first.id, { notArt: false, characterIds: [] });
  const unsorted = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'unsorted' } });
  assert.match(unsorted, new RegExp(`id="sort-${first.id}"`));
  assert.match(unsorted, /name="category" value="not_art"/);
  assert.match(unsorted, /name="category" value="meme"/);
  assert.match(unsorted, /name="adventure"/, 'the adventure is chosen while sorting');
  db.updateArtImage(first.id, { characterIds: [String(thorin)], adventure: 'guess' });
  const sheet = renderAdminPage({ session: { user: player }, query: { tab: 'character-sheet', edit_char: String(thorin) } });
  assert.match(sheet, /art-strip/);
  const table = renderAdminPage({ session: { user: player }, query: { tab: 'adventures', table: String(keep) } });
  assert.match(table, /Art from this adventure/);

  db.deleteCharacter(thorin);
  assert.equal(db.getArtImage(first.id, { isAdmin: true }).characters.length, 0, "a deleted character's art goes back to sorting");
});

test('others in a picture: NPCs, familiars and names used before are reused, whatever the spacing or case', () => {
  const npc = Number(db.prepare("INSERT INTO npcs (name) VALUES ('Mistrz Głos')").run().lastInsertRowid);
  db.prepare("INSERT INTO npcs (name, private) VALUES ('Secret Villain', 1)").run();
  const companion = Number(db.prepare("INSERT INTO companions (character_id, kind, name) VALUES (?, 'familiar', 'Pazur')").run(elara).lastInsertRowid);

  const first = db.resolveArtFigure('  Old   Tom ');
  assert.equal(db.resolveArtFigure('old tom').figureId, first.figureId);
  assert.equal(db.resolveArtFigure('OLD TOM!').figureId, first.figureId, 'case, spaces and punctuation');
  assert.equal(db.prepare("SELECT name FROM art_figures WHERE id = ?").get(first.figureId).name, 'Old Tom');
  assert.deepEqual(db.resolveArtFigure('elara moonwhisper'), { characterId: elara }, 'a player character stays a character');
  const viaLabel = db.resolveArtFigure("Pazur (Elara Moonwhisper's familiar)");
  assert.equal(db.resolveArtFigure('pazur').figureId, viaLabel.figureId);
  assert.equal(db.prepare('SELECT kind, ref_id FROM art_figures WHERE id = ?').get(viaLabel.figureId).ref_id, companion);
  const npcFigure = db.resolveArtFigure('Mistrz Głos (NPC)');
  assert.equal(db.prepare('SELECT ref_id FROM art_figures WHERE id = ?').get(npcFigure.figureId).ref_id, npc);
  const suggestions = db.artFigureSuggestions();
  assert.ok(suggestions.includes('Mistrz Głos (NPC)') && suggestions.includes('Old Tom'));
  assert.ok(!suggestions.some(label => /Secret Villain/.test(label)), 'private NPCs are never suggested');
  assert.equal(db.prepare("SELECT kind FROM art_figures WHERE id = ?").get(db.resolveArtFigure('Secret Villain').figureId).kind, 'custom');

  // In the panel: a picture with only an NPC in it is art too.
  const [meme] = db.getArtMessage('m2');
  db.updateArtImage(meme.id, { notArt: false, characterIds: [], figureIds: [], others: ['mistrz  głos', 'Old Tom, Ktoś Nowy'] });
  const saved = db.getArtImage(meme.id);
  assert.deepEqual(saved.figures.map(figure => figure.label).sort(), ['Ktoś Nowy', 'Mistrz Głos (NPC)', 'Old Tom']);
  assert.equal(saved.visible, true);
  assert.ok(db.listArtImages({ figureId: npcFigure.figureId }).some(image => image.id === meme.id));
  db.updateArtImage(meme.id, { figureIds: [String(npcFigure.figureId)], others: [] });
  assert.deepEqual(db.getArtImage(meme.id).figures.map(figure => figure.label), ['Mistrz Głos (NPC)'], 'unticked ones go');
});

test('the artist: read from the post, credited by hand under one spelling, shown on the art', async () => {
  const [byPoster] = db.getArtMessage('m1');
  assert.equal(byPoster.artist_name, 'tester1', 'nobody named in the post: the poster, by their player name');
  assert.equal(byPoster.artist_by, 'poster');
  assert.equal(db.parseArtist('Elara i Thorin, art by Selkie!'), 'Selkie');
  assert.equal(db.parseArtist('Autor: Kasia Nowak\nnowy szkic'), 'Kasia Nowak');
  assert.equal(db.parseArtist('rys. @Mira, dzięki'), 'Mira');
  assert.equal(db.parseArtist('fan art of Elara'), null);

  const [image] = db.getArtMessage('m2');
  db.updateArtImage(image.id, { artist: 'Selkie', artistUrl: 'https://example.com/selkie' });
  const [other] = db.getArtMessage('m1');
  db.updateArtImage(other.id, { artist: '  selkie ' });
  db.updateArtImage(image.id, { artist: '' });
  assert.equal(db.getArtImage(image.id, { isAdmin: true }).artist_by, 'dm', 'cleared by hand stays cleared');
  db.updateArtImage(image.id, { artist: 'Selkie', artistUrl: 'https://example.com/selkie' });
  assert.equal(db.getArtImage(other.id, { isAdmin: true }).artist_name, 'Selkie', 'the spelling already used');
  assert.throws(() => db.updateArtImage(other.id, { artist: 'Selkie', artistUrl: 'javascript:alert(1)' }), /http/);
  assert.deepEqual(db.listArtArtists().map(entry => entry.name).sort(), ['Selkie', 'tester1'], 'the other picture of m1 keeps its poster credit');
  assert.ok(db.listArtImages({ artist: 'Selkie' }).length >= 1);

  const admin = { id: 0, discord_tag: 'admin', role: 'admin' };
  const html = renderAdminPage({ session: { user: admin }, query: { tab: 'art', art: String(image.id) } });
  assert.match(html, /art-credit-banner">🖌 Art by/);
  assert.match(html, /href="https:\/\/example.com\/selkie"/);
  assert.match(html, /art-credit-badge">🖌 Selkie/);
  assert.match(html, /<datalist id="art-figure-list">/);
  for (const [, code] of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));

  // Tag art in Discord: the form for others and the artist.
  const modal = art.othersModal('m2').toJSON();
  assert.equal(modal.custom_id, 'art:m:m2');
  assert.equal(modal.components[1].components[0].value, 'Selkie');
  const replies = [];
  await art.handleArtInteraction({
    customId: 'art:m:m2', user: { id: ownerDiscord },
    fields: { getTextInputValue: name => ({ others: 'Old Tom\nPazur', artist: 'Mira', artist_url: '' })[name] },
    update: async payload => replies.push(payload), reply: async payload => replies.push(payload)
  });
  const tagged = db.getArtMessage('m2')[0];
  assert.deepEqual(tagged.figures.map(figure => figure.name).sort(), ['Old Tom', 'Pazur']);
  assert.equal(tagged.artist_name, 'Mira');
  assert.equal(tagged.artist_url, null);
  assert.match(replies.at(-1).content, /Artist:\*\* 🖌 Mira/);
});

test('memes: a category of their own, seen by everyone, tagged or not', async () => {
  const [image] = db.getArtMessage('m1');
  const replies = [];
  const press = customId => art.handleArtInteraction({
    customId, values: [], user: { id: ownerDiscord }, component: { options: [] },
    update: async payload => replies.push(payload), reply: async payload => replies.push(payload)
  });
  const buttons = () => replies.at(-1).components.at(-1).toJSON().components.map(button => button.custom_id).filter(Boolean);

  db.tagArtMessage('m1', { characterIds: [], among: [String(elara), String(brom)], others: [] });
  await press('art:k:m1:meme');
  const meme = db.getArtImage(image.id);
  assert.equal(meme.category, 'meme');
  assert.equal(meme.visible, true, 'a meme shows with nobody tagged');
  assert.match(replies.at(-1).content, /Memes/);
  assert.ok(buttons().includes('art:k:m1:art'), 'and can go back to art');
  assert.ok(db.listArtImages({ view: 'memes' }).some(entry => entry.id === image.id));
  assert.ok(!db.listArtImages().some(entry => entry.id === image.id), 'not in the art gallery');
  assert.ok(!db.listArtImages({ view: 'unsorted' }).some(entry => entry.id === image.id), 'nor waiting to be sorted');
  assert.equal(db.artCounts().memes, 2, 'both images of the post');

  db.tagArtMessage('m1', { characterIds: [String(elara)] });
  assert.equal(db.getArtImage(image.id).category, 'meme', 'tagging keeps it a meme');
  assert.ok(db.listArtImages({ view: 'memes' }).find(entry => entry.id === image.id).characters.length === 1);

  const player = { id: owner, discord_tag: 'owner', role: 'player' };
  const html = renderAdminPage({ session: { user: player }, query: { tab: 'art', view: 'memes' } });
  assert.match(html, /😂 Memes \(2\)/);
  assert.match(html, new RegExp(`art=${image.id}#art-viewer`), 'players see the memes');
  assert.doesNotMatch(html, /To sort/);

  db.updateArtImage(image.id, { category: 'not_art' });
  assert.equal(db.getArtImage(image.id, { isAdmin: true }).is_meme, false, 'one category at a time');
  db.updateArtImage(image.id, { category: 'art' });
  assert.equal(db.getArtImage(image.id).category, 'art');
  assert.throws(() => db.updateArtImage(image.id, { category: 'cat' }), /Unknown category/);
});

test('art editors: players the DMs list tag and sort art as DMs do; importing stays with the DMs', async () => {
  assert.deepEqual(db.getArtEditors(), ['1447629856870240471', '280626176341442570'], 'the first two are on the list');
  const editor = createPlayer();
  const plain = createPlayer();
  db.prepare("UPDATE players SET discord_id = '280626176341442570' WHERE id = ?").run(editor);
  const editorUser = { id: editor, discord_tag: 'editor', role: 'player' };
  const plainUser = { id: plain, discord_tag: 'plain', role: 'player' };
  assert.equal(db.canEditArt(editorUser), true);
  assert.equal(db.canEditArt(plainUser), false);
  assert.equal(db.canEditArt({ id: 0, role: 'admin' }), true);
  assert.throws(() => db.setArtEditors('280626176341442570\nSelkie'), /Not a Discord ID: Selkie/);

  const [image] = db.getArtMessage('m1');
  const page = user => renderAdminPage({ session: { user }, query: { tab: 'art', view: 'unsorted', art: String(image.id) } });
  const editorPage = page(editorUser);
  assert.match(editorPage, /Tag this image/);
  assert.match(editorPage, /To sort \(/);
  assert.doesNotMatch(editorPage, /Import past messages|Art editors/, 'not the import nor the list');
  assert.doesNotMatch(page(plainUser), /Tag this image|To sort \(/);
  const dmPage = page({ id: 0, discord_tag: 'admin', role: 'admin' });
  assert.match(dmPage, /🛡 Art editors/);
  assert.match(dmPage, /280626176341442570<\/code> tester\d+/, 'named when they have a panel account');

  // The panel's form posts: an editor may tag, not import; others may do neither.
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/admin', require('../server'));
  const server = app.listen(0);
  try {
    const post = (path, userId, body) => fetch(`http://127.0.0.1:${server.address().port}/admin${path}`, {
      method: 'POST', redirect: 'manual', headers: { 'x-user': String(userId), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
    });
    db.setPlayerCredentials(editor, 'test1234', 'player');
    const saved = await post('/art/update', editor, { id: String(image.id), category: 'meme' });
    assert.equal(saved.status, 302);
    assert.equal(db.getArtImage(image.id).category, 'meme');
    assert.equal((await post('/art/import', editor, {})).status, 403);
    assert.equal((await post('/art/editors', editor, { discord_ids: '' })).status, 403);
    assert.equal((await post('/art/update', plain, { id: String(image.id), category: 'art' })).status, 403);
    assert.equal(db.getArtImage(image.id).category, 'meme');
  } finally {
    server.close();
  }
});

test('reference material: any player uploads images; they, DMs and art editors tag and delete them', async () => {
  const uploader = createPlayer();
  const other = createPlayer();
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  app.use('/admin', require('../server'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const upload = (userId, body) => fetch(`${base}/api/art/upload`, {
      method: 'POST', body, headers: { 'x-user': String(userId), 'content-type': 'image/png', 'x-caption': encodeURIComponent('Strój Elary — szkic') }
    });
    assert.equal((await upload(uploader, Buffer.from('not an image'))).status, 400);
    const response = await upload(uploader, PNG);
    assert.equal(response.status, 200);
    const { id } = await response.json();
    const image = db.getArtImage(id);
    assert.equal(image.category, 'reference');
    assert.equal(image.uploaded, true);
    assert.equal(image.visible, true, 'seen by everyone, tagged or not');
    assert.equal(image.message_text, 'Strój Elary — szkic');
    assert.equal(image.posted_by_tag, db.prepare('SELECT discord_tag FROM players WHERE id = ?').get(uploader).discord_tag);
    assert.equal((await fetch(`${base}/api/art/${id}/image`, { headers: { 'x-user': String(other) } })).status, 200);
    assert.deepEqual(db.listArtImages({ view: 'references' }).map(entry => entry.id), [id]);
    assert.ok(!db.listArtImages().some(entry => entry.id === id), 'not in the art gallery');
    assert.equal(db.artCounts().references, 1);
    assert.equal(db.listArtMessagesWithoutFile(100).some(row => String(row.message_id).startsWith('upload:')), false);

    const post = (path, userId, body) => fetch(`${base}/admin${path}`, {
      method: 'POST', redirect: 'manual', headers: { 'x-user': String(userId), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
    });
    assert.equal((await post('/art/update', other, { id: String(id), caption: 'hacked' })).status, 403, "not someone else's upload");
    const saved = await post('/art/update', uploader, { id: String(id), character_ids: String(elara), figures_form: '1', others: 'Old Tom', adventure: 'none', category: 'reference', caption: 'Strój Elary, wersja 2' });
    assert.equal(saved.status, 302);
    const tagged = db.getArtImage(id);
    assert.deepEqual(tagged.characters.map(character => character.id), [elara]);
    assert.deepEqual(tagged.figures.map(figure => figure.name), ['Old Tom']);
    assert.equal(tagged.message_text, 'Strój Elary, wersja 2');
    assert.equal(tagged.category, 'reference', 'tagging keeps it a reference');
    assert.equal(image.adventure_by, 'none', 'an upload has no adventure by default');
    assert.equal(tagged.adventure_id, null);
    db.updateArtImage(id, { adventure: String(keep) });
    db.updateArtImage(id, { characterIds: [String(brom)] });
    assert.equal(db.getArtImage(id).adventure_id, keep, 'one chosen by hand stays');

    // A picture from the channel moved to Reference drops its guessed adventure.
    const [fromChannel] = db.getArtMessage('m1');
    db.updateArtImage(fromChannel.id, { category: 'art', characterIds: [String(elara)], adventure: 'guess' });
    assert.ok(db.getArtImage(fromChannel.id).adventure_id, 'guessed while art');
    db.updateArtImage(fromChannel.id, { category: 'reference', adventure: 'guess' });
    assert.equal(db.getArtImage(fromChannel.id).adventure_id, null);
    assert.equal(db.getArtImage(fromChannel.id).adventure_by, 'none');

    const uploaderUser = { id: uploader, discord_tag: 'u', role: 'player' };
    const page = renderAdminPage({ session: { user: uploaderUser }, query: { tab: 'art', view: 'references', art: String(id) } });
    assert.match(page, /📌 Add reference material/);
    assert.match(page, /Tag this image/, 'the uploader tags their own upload');
    assert.match(page, /Delete upload/);
    assert.match(page, /value="reference" checked/);
    for (const [, code] of page.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
    assert.doesNotMatch(renderAdminPage({ session: { user: { id: other, discord_tag: 'o', role: 'player' } }, query: { tab: 'art', view: 'references', art: String(id) } }), /Tag this image/);

    const [discordImage] = db.getArtMessage('m1');
    assert.throws(() => db.deleteArtUpload(discordImage.id, { id: 0, role: 'admin' }), /Only uploaded images/);
    assert.equal((await post('/art/delete', other, { id: String(id) })).status, 403);
    const file = db.getArtFile(id).file;
    assert.equal((await post('/art/delete', uploader, { id: String(id) })).status, 302);
    assert.equal(db.getArtImage(id, { isAdmin: true }), null);
    assert.equal(fs.existsSync(file), false, 'the file goes too');
  } finally {
    server.close();
  }
});

test('Memes and Reference filter by who is in them, adventure and artist, with their own counts', () => {
  const admin = { id: 0, discord_tag: 'admin', role: 'admin' };
  const [image] = db.getArtMessage('m1');
  db.updateArtImage(image.id, { category: 'reference', characterIds: [String(elara)], artist: 'Selkie' });
  const html = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'references' } });
  assert.ok(html.includes(`<option value="c${elara}">Elara Moonwhisper (1)</option>`), 'counted in Reference');
  assert.match(html, /🖌 Selkie \(1\)/);
  const filtered = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'references', who: `c${brom}` } });
  assert.doesNotMatch(filtered, new RegExp(`art=${image.id}#art-viewer`), 'someone else: not listed');
  const mine = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'references', who: `c${elara}`, art: String(image.id) } });
  assert.match(mine, new RegExp(`view=references&who=c${elara}&art=${image.id}#art-viewer`));
  assert.ok(mine.includes(`href="/admin?tab=art&view=references&who=c${elara}">Elara`), 'names link within Reference');
  const memes = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'memes' } });
  assert.match(memes, /name="who"/);
});

test('art and reference at once: in the gallery and under Reference; Art + Reference shows all of someone', async () => {
  const [image] = db.getArtMessage('m1');
  db.updateArtImage(image.id, { category: 'art', characterIds: [elara], adventure: String(keep) });
  const replies = [];
  const press = customId => art.handleArtInteraction({
    customId, values: [], user: { id: ownerDiscord }, component: { options: [] },
    update: async payload => replies.push(payload), reply: async payload => replies.push(payload)
  });
  const buttons = () => replies.at(-1).components.at(-1).toJSON().components;

  // In Discord: "Also reference", and back.
  await press('art:k:m1:both');
  const both = db.getArtImage(image.id);
  assert.equal(both.category, 'both');
  assert.equal(both.adventure_id, keep, 'art from a session keeps its adventure');
  assert.match(replies.at(-1).content, /art and reference/);
  assert.ok(buttons().some(button => button.custom_id === 'art:k:m1:art' && /Reference ✓/.test(button.label)));
  assert.ok(buttons().length <= 5, 'one row holds five buttons');
  assert.ok(db.listArtImages().some(entry => entry.id === image.id), 'in the gallery');
  assert.ok(db.listArtImages({ view: 'references' }).some(entry => entry.id === image.id), 'and under Reference');
  assert.ok(db.listArtImages({ characterId: elara }).some(entry => entry.id === image.id), 'and on the character\'s strip');

  // A reference-only picture of Elara: not in the gallery, but in Art + Reference.
  const [other] = db.getArtMessage('m1').filter(entry => entry.id !== image.id);
  db.updateArtImage(other.id, { category: 'reference', characterIds: [elara] });
  const all = db.listArtImages({ view: 'all', characterId: elara }).map(entry => entry.id);
  assert.ok(all.includes(image.id) && all.includes(other.id));
  assert.ok(!db.listArtImages({ characterId: elara }).some(entry => entry.id === other.id));
  assert.equal(db.listArtImages({ view: 'all', characterId: elara }).filter(entry => entry.id === image.id).length, 1, 'once, not twice');

  const player = { id: owner, discord_tag: 'owner', role: 'player' };
  const page = query => renderAdminPage({ session: { user: player }, query: { tab: 'art', ...query } });
  const byCharacter = page({ character: String(elara) });
  assert.match(byCharacter, /<option value="all" selected>🎨📌 Art \+ Reference/, 'a character opens Art + Reference');
  assert.match(byCharacter, new RegExp(`art=${other.id}#art-viewer`));
  const galleryOnly = page({ view: 'gallery', who: `c${elara}` });
  assert.doesNotMatch(galleryOnly, new RegExp(`art=${other.id}#art-viewer`), 'Gallery stays the gallery');
  assert.match(galleryOnly, /view=gallery&who=c\d+&art=/, 'and its links keep it');
  const sheet = renderAdminPage({ session: { user: player }, query: { tab: 'character-sheet', edit_char: String(elara) } });
  assert.match(sheet, /tab=art&view=all&character=\d+">All their art and reference/);

  await press('art:k:m1:art');
  assert.equal(db.getArtImage(image.id).category, 'art');
  assert.ok(!db.listArtImages({ view: 'references' }).some(entry => entry.id === image.id));
});
