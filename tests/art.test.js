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
  for (const [, code] of viewer.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  assert.match(renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'unsorted' } }), /Nothing to sort/);
  db.updateArtImage(first.id, { notArt: false, characterIds: [] });
  const unsorted = renderAdminPage({ session: { user: admin }, query: { tab: 'art', view: 'unsorted' } });
  assert.match(unsorted, new RegExp(`id="sort-${first.id}"`));
  assert.match(unsorted, /name="not_art" value="1"/);
  assert.match(unsorted, /name="adventure"/, 'the adventure is chosen while sorting');
  db.updateArtImage(first.id, { characterIds: [String(thorin)], adventure: 'guess' });
  const sheet = renderAdminPage({ session: { user: player }, query: { tab: 'character-sheet', edit_char: String(thorin) } });
  assert.match(sheet, /art-strip/);
  const table = renderAdminPage({ session: { user: player }, query: { tab: 'adventures', table: String(keep) } });
  assert.match(table, /Art from this adventure/);

  db.deleteCharacter(thorin);
  assert.equal(db.getArtImage(first.id, { isAdmin: true }).characters.length, 0, "a deleted character's art goes back to sorting");
});
