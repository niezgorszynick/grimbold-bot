const test = require('node:test');
const assert = require('node:assert/strict');
const { db, createPlayer } = require('./helpers/tempDatabase');
const voice = require('../npcVoice');
const threads = require('../adventureThreads');
const preview = require('../public/discord-preview');
const renderAdminPage = require('../views/adminPage');

const owner = createPlayer('admin');
const otherDm = createPlayer('admin');
const listener = createPlayer('player');
const closed = createPlayer('player');
const discordOf = id => db.prepare('SELECT discord_id FROM players WHERE id = ?').get(id).discord_id;
const tagOf = id => db.prepare('SELECT discord_tag FROM players WHERE id = ?').get(id).discord_tag;
const users = {
  owner: { id: owner, discord_tag: tagOf(owner), role: 'admin' },
  other: { id: otherDm, discord_tag: tagOf(otherDm), role: 'admin' },
  root: { id: 0, discord_tag: 'Root DM', role: 'admin' },
  player: { id: listener, discord_tag: tagOf(listener), role: 'player' }
};

const glos = db.saveNpc({ name: 'Głos', private: '1', created_by: owner, base_monster: '' });
const kevah = db.saveNpc({ name: 'Kevah', affiliation: 'Harpers' });

test('a private NPC with no owning DM chosen belongs to the DM who saved it', () => {
  assert.equal(db.getNpc(glos, { showStats: true, viewer: users.owner }).owner.id, owner);
  assert.equal(db.getNpc(glos, { showStats: true, viewer: users.owner }).private, true);
});

test('only its DM and the Root DM see a private NPC, anywhere', () => {
  const names = viewer => db.listNpcs({ showStats: true, viewer }).map(npc => npc.name);
  assert.deepEqual(names(users.owner), ['Głos', 'Kevah']);
  assert.deepEqual(names(users.root), ['Głos', 'Kevah']);
  assert.deepEqual(names(users.other), ['Kevah']);
  assert.deepEqual(db.listNpcs().map(npc => npc.name), ['Kevah'], 'players');
  assert.equal(db.getNpc(glos, { showStats: true, viewer: users.other }), null);
  assert.throws(() => db.requireVisibleNpc(glos, users.other), /NPC not found/);

  for (const [who, user] of Object.entries(users)) {
    const html = renderAdminPage({ session: { user }, query: { tab: 'npcs' } });
    assert.equal(html.includes('Głos'), who === 'owner' || who === 'root', `${who} on the NPCs tab`);
  }
  const page = renderAdminPage({ session: { user: users.other }, query: { tab: 'npcs', voice: String(glos) } });
  assert.match(page, /No such NPC/);
  assert.doesNotMatch(page, /Głos/);
});

test('on an adventure table: its DM sees it hidden; other DMs never; the party once revealed', () => {
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run('owner-discord', owner);
  const { adventure } = db.createAdventureFromThread({ threadId: 'voice-thread', title: 'Whispers', ownerDiscordId: 'owner-discord' });
  assert.throws(() => db.setAdventureNpc({ adventureId: adventure.id, user: users.root, npcId: 999999, inAdventure: true }), /NPC not found/);
  const table = db.getAdventureTable({ adventureId: adventure.id, user: users.owner });
  assert.ok(table.npcCandidates.some(npc => npc.name === 'Głos'), 'its DM can add it');
  db.setAdventureNpc({ adventureId: adventure.id, user: users.owner, npcId: glos, inAdventure: true, hidden: true });
  assert.deepEqual(db.getAdventureNpcs(adventure.id, { showStats: true, viewer: users.owner }).map(npc => npc.name), ['Głos']);
  assert.deepEqual(db.getAdventureNpcs(adventure.id, { showStats: true, viewer: users.other }), []);
  assert.deepEqual(db.getAdventureNpcs(adventure.id, { viewer: users.player }), [], 'hidden from the party');
  db.setAdventureNpcHidden({ adventureId: adventure.id, user: users.owner, npcId: glos, hidden: false });
  assert.deepEqual(db.getAdventureNpcs(adventure.id, { viewer: users.player }).map(npc => npc.name), ['Głos'], 'revealed');
  assert.deepEqual(db.getAdventureNpcs(adventure.id, { showStats: true, viewer: users.other }), [], 'other DMs still not');
});

test('speaking in DMs: an embed under the NPC\'s name in its colour; closed DMs are kept as not delivered', async () => {
  const sent = {};
  voice.setNpcVoiceClient({
    isReady: () => true,
    users: {
      fetch: async id => ({
        send: async payload => {
          if (id === discordOf(closed)) throw Object.assign(new Error('Cannot send'), { code: 50007 });
          sent[id] = payload;
          return { id: 'm1' };
        }
      })
    }
  });
  await assert.rejects(voice.sendNpcVoice({ npcId: glos, user: users.other, target: 'dm', playerIds: [listener], text: 'hi' }), /NPC not found/);
  await assert.rejects(voice.sendNpcVoice({ npcId: kevah, user: users.player, target: 'dm', playerIds: [listener], text: 'hi' }), /Only a DM/);
  await assert.rejects(voice.sendNpcVoice({ npcId: glos, user: users.owner, target: 'dm', playerIds: [], text: 'hi' }), /Choose who/);

  const { results } = await voice.sendNpcVoice({ npcId: glos, user: users.owner, target: 'dm', playerIds: [listener, closed], text: 'They **know**.', color: '#112233' });
  assert.deepEqual(results.map(entry => entry.ok), [true, false]);
  assert.equal(results[1].error, 'their DMs are closed to Grimbold');
  const embed = sent[discordOf(listener)].embeds[0];
  assert.deepEqual([embed.author.name, embed.description, embed.color], ['Głos', 'They **know**.', 0x112233]);
  assert.equal(db.getNpc(glos, { showStats: true, viewer: users.owner }).voiceColor, '#112233', 'the colour is remembered');
});

test('speaking in a channel goes through the webhook post and is recorded', async () => {
  const original = threads.sayAsNpc;
  const calls = [];
  threads.sayAsNpc = async args => { calls.push(args); return { sent: true, webhook: true }; };
  try {
    const { results } = await voice.sendNpcVoice({ npcId: kevah, user: users.other, target: 'channel', text: 'Well met.' });
    assert.deepEqual(results, [{ label: 'speak channel', ok: true, webhook: true }]);
    assert.equal(calls[0].npcId, kevah);
    await assert.rejects(voice.sendNpcVoice({ npcId: kevah, user: users.other, target: 'channel', text: 'x'.repeat(2001) }), /Too long/);
  } finally {
    threads.sayAsNpc = original;
  }
  const said = db.getNpcVoiceMessages(kevah);
  assert.deepEqual(said.map(message => [message.target, message.place_label, message.text]), [['channel', 'speak channel', 'Well met.']]);
});

test('a player\'s DM reply goes to the last NPC that wrote to them; others are ignored', async () => {
  const dm = (authorId, content, extra = {}) => ({ id: 'r', guild: null, guildId: null, author: { id: authorId, bot: false }, content, ...extra });
  assert.equal(voice.handleDirectMessage(dm(discordOf(listener), 'Who are you?')), true);
  assert.equal(voice.handleDirectMessage(dm(discordOf(closed), 'hello?')), false, 'never reached');
  assert.equal(voice.handleDirectMessage(dm('stranger', 'hi')), false);
  assert.equal(voice.handleDirectMessage(dm(discordOf(listener), 'in a server', { guildId: 'g' })), false);
  const replies = db.getNpcVoiceMessages(glos).filter(message => message.direction === 'in');
  assert.deepEqual(replies.map(message => [message.player_id, message.text]), [[listener, 'Who are you?']]);

  const page = await voice.voicePage({ npcId: glos, user: users.owner });
  assert.equal(page.npc.name, 'Głos');
  assert.ok(page.recipients.some(entry => entry.id === listener));
  await assert.rejects(voice.voicePage({ npcId: glos, user: users.other }), /NPC not found/);
});

test('the preview shows Discord Markdown and escapes everything else', () => {
  const html = preview.render('**bold** *it* __under__ ~~gone~~ ||secret|| `x<y`\n> quoted\n-# small\n# Big\n- one\n- two\n<script>alert(1)</script>');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<u>under<\/u>/);
  assert.match(html, /<s>gone<\/s>/);
  assert.match(html, /class="dp-spoiler"[^>]*>secret</);
  assert.match(html, /<code class="dp-code">x&lt;y<\/code>/);
  assert.match(html, /class="dp-quote"><div class="dp-line">quoted/);
  assert.match(html, /class="dp-subtext">small/);
  assert.match(html, /class="dp-h1">Big/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(preview.render('```\n**not bold**\n```'), /<pre class="dp-codeblock">\*\*not bold\*\*<\/pre>/);
  assert.match(preview.render('[map](https://example.com/a)'), /<a class="dp-link" href="https:\/\/example.com\/a"[^>]*>map<\/a>/);
});
