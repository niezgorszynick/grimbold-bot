const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { db, createPlayer } = require('./helpers/tempDatabase');
const chronicles = require('../chronicles');
const renderAdminPage = require('../views/adminPage');

const DOC_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';
const DOC_B = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxw';

function addCharacter(playerId, name) {
  return Number(db.prepare(`
    INSERT INTO characters (player_id, name, race, class, subclass, level, xp, status, gold_cp, sheet_data)
    VALUES (?, ?, 'Elf', 'Wizard', 'Evoker', 3, 0, 'alive', 0, '{}')
  `).run(playerId, name).lastInsertRowid);
}

test('Google Docs links are found in a message, once each', () => {
  const links = db.extractDocLinks(`My diary: https://docs.google.com/document/d/${DOC_A}/edit?usp=sharing
    again https://docs.google.com/document/u/0/d/${DOC_A}/view and a published one
    https://docs.google.com/document/d/e/2PACX-1vTabcdefghijklmnopqrstuvwxyz/pub and a sheet https://docs.google.com/spreadsheets/d/${DOC_B}/edit`);
  assert.deepEqual(links.map(link => link.key), [DOC_A, 'pub:2PACX-1vTabcdefghijklmnopqrstuvwxyz']);
  assert.equal(links[0].url, `https://docs.google.com/document/d/${DOC_A}/edit`);
  assert.equal(db.docEmbedUrl(DOC_A), `https://docs.google.com/document/d/${DOC_A}/preview`);
  assert.match(db.docEmbedUrl(links[1].key), /\/d\/e\/2PACX-1vTabcdefghijklmnopqrstuvwxyz\/pub\?embedded=true$/);
});

test('the kind is guessed from the post and title, in Polish or English', () => {
  assert.equal(db.guessDocKind('Pamiętnik Elary, część 2'), 'diary');
  assert.equal(db.guessDocKind("Thorin's journal"), 'diary');
  assert.equal(db.guessDocKind('List do matki'), 'letter');
  assert.equal(db.guessDocKind('Letters from the front'), 'letter');
  assert.equal(db.guessDocKind('Krótkie opowiadanie o smoku'), 'story');
  assert.equal(db.guessDocKind('Notatki'), 'other');
});

test("a doc goes to the poster's character named in it, else their only character, else anyone's named", () => {
  const characters = [
    { id: 1, name: 'Elara Moonwhisper', discordId: 'A' },
    { id: 2, name: 'Thorin Ironfist', discordId: 'A' },
    { id: 3, name: 'Vex', discordId: 'B' },
    { id: 4, name: "Qual'danis Éversong", discordId: 'C' }
  ];
  const pick = (text, poster) => (db.matchDocCharacter({ text, characters, posterDiscordId: poster }) || {}).characterId || null;
  assert.equal(pick('Dziennik — Elara Moonwhisper', 'A'), 1, 'full name');
  assert.equal(pick('Thorin writes home', 'A'), 2, 'first name, own character');
  assert.equal(pick('A letter to Thorin', 'B'), 3, "the poster's only character, though it names another");
  assert.equal(pick("Qual'danis Eversong's tale", 'Z'), 4, 'someone else posting: the character named');
  assert.equal(pick('A story', 'A'), null, 'two characters, neither named: unsorted');
  assert.equal(pick('A story', 'Z'), null);
});

test('a scan records the docs in the channel and its threads, and the tab shows them', async () => {
  const owner = createPlayer();
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('discord-owner', owner);
  const elara = addCharacter(owner, 'Elara Moonwhisper');
  addCharacter(owner, 'Brom');
  const message = (id, content, extra = {}) => ({
    id, content, channelId: 'chan', guildId: 'guild', createdAt: new Date('2026-10-01T10:00:00Z'),
    author: { id: 'discord-owner', username: 'owner', bot: false }, embeds: [], attachments: new Map(), ...extra
  });
  const pages = {
    chan: [
      message('3', `Pamiętnik https://docs.google.com/document/d/${DOC_A}/edit`, { embeds: [{ url: `https://docs.google.com/document/d/${DOC_A}/edit`, title: 'Pamiętnik Elary - Google Docs' }] }),
      message('2', 'no link here'),
      message('1', 'Grimbold posts', { author: { id: 'bot', bot: true } })
    ],
    thread: [message('5', `A story https://docs.google.com/document/d/${DOC_B}/edit`, { channelId: 'thread' })]
  };
  const fetcher = key => ({ fetch: async ({ before } = {}) => new Map(before ? [] : pages[key].map(entry => [entry.id, entry])) });
  const thread = { id: 'thread', parentId: 'chan', name: 'Opowiadania', messages: fetcher('thread') };
  const channel = {
    id: 'chan', messages: fetcher('chan'),
    threads: { fetchActive: async () => ({ threads: new Map([['thread', thread]]) }), fetchArchived: async () => ({ threads: new Map(), hasMore: false }) }
  };
  chronicles.setClientForTests({ isReady: () => true, channels: { fetch: async () => channel } });

  const result = await chronicles.scanChannel({ all: true });
  assert.equal(result.messages, 3, "Grimbold's own messages are skipped");
  assert.equal(result.contentMissing, false);
  assert.equal(result.docs.length, 2);
  const diary = db.getCharacterDocByKey(DOC_A);
  assert.equal(diary.title, 'Pamiętnik Elary', "the title from Discord's link preview");
  assert.equal(diary.kind, 'diary');
  assert.equal(diary.character_id, elara, 'named in the title');
  const story = db.getCharacterDocByKey(DOC_B);
  assert.equal(story.kind, 'story');
  assert.equal(story.character_id, null, 'two characters, neither named: unsorted');
  assert.equal(db.countUnsortedDocs(), 1);

  const again = await chronicles.scanChannel({ all: true });
  assert.equal(again.docs.length, 0, 'a doc is recorded once');

  db.saveCharacterDocCopy(diary.id, { access: 'public', text: 'Dzień pierwszy.\n\nDzień <drugi>.', title: 'Pamiętnik Elary' });
  db.updateCharacterDoc(story.id, { characterId: String(elara), kind: 'story' });
  assert.equal(db.listCharacterDocs({ characterId: elara }).length, 2);
  assert.equal(db.countUnsortedDocs(), 0);

  const admin = { id: 0, discord_tag: 'admin', role: 'admin' };
  const player = { id: owner, discord_tag: 'owner', role: 'player' };
  for (const user of [admin, player]) {
    const html = renderAdminPage({ session: { user }, query: { tab: 'chronicles', doc: String(diary.id) } });
    assert.match(html, /Pamiętnik Elary/);
    assert.match(html, new RegExp(`/document/d/${DOC_A}/preview`), 'the live doc inside the panel');
    assert.match(html, /Dzień &lt;drugi&gt;\./, 'the saved copy, escaped');
    assert.equal(/Import past messages/.test(html), user === admin, 'only DMs import');
    for (const [, code] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
  }
  const sheet = renderAdminPage({ session: { user: player }, query: { tab: 'character-sheet', edit_char: String(elara) } });
  assert.match(sheet, /📜 Chronicles/);

  db.updateCharacterDoc(story.id, { hidden: true });
  assert.equal(db.listCharacterDocs({ characterId: elara }).length, 1, 'hidden docs are left out');
  assert.equal(db.getCharacterDoc(story.id, { isAdmin: false }), null);

  db.deleteCharacter(elara);
  assert.equal(db.getCharacterDocByKey(DOC_A).character_id, null, "a deleted character's docs become unsorted");
});

test('without the Message Content intent the scan says so', async () => {
  const empty = { id: '9', content: '', embeds: [], attachments: new Map(), author: { id: 'x', bot: false }, createdAt: new Date() };
  const channel = { id: 'c2', messages: { fetch: async ({ before } = {}) => new Map(before ? [] : [['9', empty]]) } };
  chronicles.setClientForTests({ isReady: () => true, channels: { fetch: async () => channel } });
  const result = await chronicles.scanChannel();
  assert.equal(result.contentMissing, true);
});

test("a published doc's page becomes text and a title", () => {
  const html = '<html><head><title>Listy z frontu - Google Docs</title><style>p{}</style></head><body><div id="contents"><p>Droga Mamo,</p><p>tu jest zimno &amp; mokro.</p></div></body></html>';
  assert.equal(chronicles.titleFromHtml(html), 'Listy z frontu');
  assert.equal(chronicles.htmlToText(html), 'Droga Mamo,\ntu jest zimno & mokro.');
});
