// art.js — Reads the Discord art channel, where players post art of their
// characters as images, and keeps a copy of each for the panel's Art tab
// (db/art.js): Discord's own image links expire after a day or so.
//
// Like Chronicles (chronicles.js) it reads the channel over the REST API: the
// latest posts every few minutes, the whole history (with threads) when a DM
// presses Import. Without the Message Content Intent Discord sends neither
// the text nor the images.
//
// "Tag art" (right-click a message → Apps → Tag art) lets anyone with a panel
// account say who is in a post's images, which adventure it is from, or that
// it is not art at all (a meme, a screenshot). Only they see the menu.

'use strict';

const {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const db = require('./db');

// The art channel — override with ART_CHANNEL_ID.
const DEFAULT_CHANNEL_ID = '1505852703845384314';
const POLL_MINUTES = 10;
const FETCH_TIMEOUT_MS = 30000;
const THUMB_WIDTH = 480;
const MENU_SIZE = 25;
const CHARACTER_MENUS = 3;

let client = null;
let running = false;

function channelId() {
  return process.env.ART_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

// ─── Images ─────────────────────────────────────────────────────────────────

function attachmentsOf(message) {
  const list = message.attachments ? [...(message.attachments.values ? message.attachments.values() : message.attachments)] : [];
  return list.map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    width: attachment.width,
    height: attachment.height,
    size: attachment.size,
    url: attachment.url,
    proxyURL: attachment.proxyURL
  }));
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Discord's media proxy makes a smaller copy for the gallery.
function thumbUrl(attachment) {
  if (!attachment.proxyURL || !attachment.width || !attachment.height || attachment.width <= THUMB_WIDTH * 1.25) return null;
  if (/\.gif($|\?)/i.test(attachment.proxyURL)) return null;
  const height = Math.max(1, Math.round(attachment.height * THUMB_WIDTH / attachment.width));
  return `${attachment.proxyURL}${attachment.proxyURL.includes('?') ? '&' : '?'}width=${THUMB_WIDTH}&height=${height}&format=webp`;
}

// Copies of the message's images Grimbold doesn't have yet.
async function keepCopies(message) {
  const attachments = new Map(attachmentsOf(message).map(attachment => [String(attachment.id), attachment]));
  for (const image of db.getArtMessage(message.id)) {
    if (image.file) continue;
    const attachment = attachments.get(String(image.attachment_id));
    if (!attachment) { db.saveArtFiles(image.id, { error: 'The image is gone from Discord.' }); continue; }
    if (attachment.size && attachment.size > db.ART_MAX_IMAGE_BYTES) { db.saveArtFiles(image.id, { error: 'Too large to keep (over 25 MB).' }); continue; }
    try {
      const buffer = await download(attachment.url);
      const small = thumbUrl(attachment);
      const thumb = small ? await download(small).catch(() => null) : null;
      db.saveArtFiles(image.id, { buffer, thumb });
    } catch (error) {
      db.saveArtFiles(image.id, { error: error.message });
    }
  }
}

function inArtChannel(message) {
  const channel = message.channel;
  return message.channelId === channelId() || Boolean(channel && channel.parentId === channelId());
}

// The post's text with <@id> mentions as the names they show.
function plainText(message) {
  const users = message.mentions && message.mentions.users;
  const members = message.mentions && message.mentions.members;
  return String(message.content || '').replace(/<@!?(\d+)>/g, (whole, id) => {
    const member = members && members.get ? members.get(id) : null;
    const user = users && users.get ? users.get(id) : null;
    const name = (member && member.displayName) || (user && (user.globalName || user.username));
    return name ? `@${name}` : whole;
  });
}

// One message: its images recorded and copied. Returns the new image ids.
async function recordMessage(message, threadName) {
  const author = message.author || {};
  if (author.bot) return [];
  const attachments = attachmentsOf(message);
  if (!attachments.some(db.isArtAttachment)) return [];
  const { created } = db.recordArtMessage({
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    threadName: threadName || (message.channel && message.channel.isThread && message.channel.isThread() ? message.channel.name : null),
    posterDiscordId: author.id,
    posterTag: (message.member && message.member.displayName) || author.globalName || author.username || null,
    postedAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
    text: plainText(message),
    attachments
  });
  await keepCopies(message);
  return created;
}

// ─── The channel ────────────────────────────────────────────────────────────

function connected() {
  return client && !(typeof client.isReady === 'function' && !client.isReady());
}

// all: every message (Import), else the latest 50 of each place.
async function scanChannel({ all = false } = {}) {
  if (!connected()) throw new Error('The Discord bot is not connected right now.');
  const channel = await client.channels.fetch(channelId()).catch(() => null);
  if (!channel) throw new Error(`Grimbold cannot see the art channel (${channelId()}): give him View Channel and Read Message History there.`);
  const stats = { messages: 0, empty: 0, found: 0 };
  for (const { source, threadName } of await require('./chronicles').channelSources(channel, { archived: all })) {
    let before;
    for (;;) {
      const batch = await source.messages.fetch({ limit: all ? 100 : 50, before }).catch(() => null);
      if (!batch || !batch.size) break;
      for (const message of batch.values()) {
        if (message.author && message.author.bot) continue;
        stats.messages += 1;
        const hasAnything = message.content || (message.embeds && message.embeds.length) || (message.attachments && message.attachments.size);
        if (!hasAnything) stats.empty += 1;
        stats.found += (await recordMessage(message, threadName)).length;
      }
      if (!all || batch.size < 100) break;
      before = [...batch.values()].pop().id;
    }
  }
  // Copies that failed before: the message again, for fresh links.
  for (const { message_id: messageId, channel_id: where } of db.listArtMessagesWithoutFile(all ? 100 : 10)) {
    const place = await client.channels.fetch(where || channelId()).catch(() => null);
    const message = place && place.messages ? await place.messages.fetch(messageId).catch(() => null) : null;
    if (message) await keepCopies(message);
  }
  return { messages: stats.messages, found: stats.found, contentMissing: stats.messages > 0 && stats.empty === stats.messages };
}

function remember(field, value) {
  db.setArtScanStatus({ ...(db.getArtScanStatus() || {}), [field]: value });
}

async function runScan({ all = false, by = null } = {}) {
  if (running) return { busy: true };
  running = true;
  const field = all ? 'import' : 'poll';
  if (all) remember('import', { running: true, startedAt: new Date().toISOString(), by });
  try {
    const result = await scanChannel({ all });
    const status = { at: new Date().toISOString(), by, ...result, error: null };
    remember(field, status);
    return status;
  } catch (error) {
    const status = { at: new Date().toISOString(), by, error: error.message };
    remember(field, status);
    return status;
  } finally {
    running = false;
  }
}

function startImport(by) {
  if (running) return false;
  void runScan({ all: true, by }).catch(error => console.warn(`Art import failed: ${error.message}`));
  return true;
}

let timer = null;
function setArtClient(discordClient) {
  client = discordClient;
  if (timer || !discordClient || typeof discordClient.once !== 'function') return;
  discordClient.once('clientReady', () => {
    const poll = () => runScan().catch(error => console.warn(`Art: ${error.message}`));
    setTimeout(poll, 60 * 1000);
    timer = setInterval(poll, POLL_MINUTES * 60 * 1000);
    if (timer.unref) timer.unref();
  });
}

// ─── Tag art ────────────────────────────────────────────────────────────────

const isPlayer = discordId => Boolean(db.prepare('SELECT id FROM players WHERE discord_id = ?').get(String(discordId)));
const clip = (text, length = 100) => (String(text).length > length ? `${String(text).slice(0, length - 1)}…` : String(text));

// The characters to offer: the living by name, then the rest; those tagged
// always among them. The order doesn't follow the tags, so a menu keeps its own.
function characterChoices(tagged) {
  const all = db.prepare('SELECT id, name, status FROM characters ORDER BY (status = \'dead\'), name COLLATE NOCASE').all();
  const limit = MENU_SIZE * CHARACTER_MENUS;
  if (all.length <= limit) return { list: all, more: 0 };
  const taggedIds = new Set(tagged.map(tag => tag.id));
  const kept = all.filter(character => taggedIds.has(character.id));
  const rest = all.filter(character => !taggedIds.has(character.id)).slice(0, limit - kept.length);
  const keep = new Set([...kept, ...rest].map(character => character.id));
  return { list: all.filter(character => keep.has(character.id)), more: all.length - keep.size };
}

function panelLink(images) {
  const base = String(process.env.PANEL_URL || '').replace(/\/+$/, '');
  return base && images[0] ? `${base}/admin?tab=art&art=${images[0].id}` : null;
}

// The menu for one message: { content, components }.
function tagView(messageId) {
  const images = db.getArtMessage(messageId);
  const first = images[0];
  const tagged = first.characters;
  const taggedIds = new Set(tagged.map(tag => String(tag.id)));
  const { list, more } = characterChoices(tagged);

  const adventure = first.adventure_by === 'none'
    ? 'none'
    : first.adventure_id && first.adventure_by !== 'guess' ? String(first.adventure_id) : 'guess';
  const lines = [
    `🎨 **${images.length === 1 ? 'An image' : `${images.length} images`}** posted by ${first.posted_by_tag || 'someone'}${first.posted_at ? ` on ${first.posted_at.slice(0, 10)}` : ''}`,
    `**In it:** ${tagged.length || first.figures.length ? [...tagged.map(tag => tag.name), ...first.figures.map(figure => figure.label)].join(', ') : '— nobody yet —'}`,
    `**Artist:** ${first.artist_name ? `🖌 ${first.artist_name}${first.artist_url ? ` (<${first.artist_url}>)` : ''}` : '— not credited —'}`,
    `**Adventure:** ${first.adventure_title ? `${first.adventure_title}${first.adventure_by === 'guess' ? ' (guessed)' : ''}` : first.adventure_by === 'none' ? 'none' : '— none found —'}`,
    first.not_art
      ? '🚫 Marked **Not art**: it stays out of the gallery.'
      : tagged.length || first.figures.length ? '✅ In the Art tab.' : '⏳ Waiting in “To sort” until somebody in it is tagged.'
  ];
  if (more) lines.push(`*${more} more characters didn't fit here: a DM can tag them in the panel.*`);

  const components = [];
  for (let start = 0, index = 0; start < list.length && index < CHARACTER_MENUS; start += MENU_SIZE, index += 1) {
    const chunk = list.slice(start, start + MENU_SIZE);
    const range = list.length > MENU_SIZE ? ` (${clip(chunk[0].name, 20)} – ${clip(chunk[chunk.length - 1].name, 20)})` : '';
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`art:c:${messageId}:${index}`)
      .setPlaceholder(clip(`Who is in it?${range}`, 150))
      .setMinValues(0)
      .setMaxValues(chunk.length)
      .addOptions(chunk.map(character => ({
        label: clip(`${character.name}${character.status === 'dead' ? ' †' : ''}`),
        value: String(character.id),
        default: taggedIds.has(String(character.id))
      })))));
  }

  const choices = db.listArtAdventureChoices({ characterIds: tagged.map(tag => tag.id), postedAt: first.posted_at, limit: 23 });
  if (adventure !== 'guess' && adventure !== 'none' && !choices.some(choice => String(choice.id) === adventure) && first.adventure_title) {
    choices.pop();
    choices.unshift({ id: first.adventure_id, title: first.adventure_title, fits: false });
  }
  const guessed = first.adventure_by === 'guess' && first.adventure_title;
  components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`art:a:${messageId}`)
    .setPlaceholder('Which adventure?')
    .addOptions([
      { label: 'Guess from the characters', value: 'guess', emoji: '🔮', description: clip(guessed ? `Now: ${first.adventure_title}` : 'The latest adventure they were all in'), default: adventure === 'guess' },
      { label: 'No adventure', value: 'none', default: adventure === 'none' },
      ...choices.map(choice => ({
        label: clip(choice.title),
        value: String(choice.id),
        description: choice.fits ? 'They were all in it' : undefined,
        default: adventure === String(choice.id)
      }))
    ])));

  const buttons = [
    first.not_art
      ? new ButtonBuilder().setCustomId(`art:x:${messageId}`).setLabel('It is art after all').setStyle(ButtonStyle.Success)
      : new ButtonBuilder().setCustomId(`art:x:${messageId}`).setLabel('Not art (meme, screenshot)').setEmoji('🚫').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`art:o:${messageId}`).setLabel('NPCs, others & artist').setEmoji('🖌').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`art:d:${messageId}`).setLabel('Done').setStyle(ButtonStyle.Secondary)
  ];
  const link = panelLink(images);
  if (link) buttons.push(new ButtonBuilder().setLabel('Open in the panel').setStyle(ButtonStyle.Link).setURL(link));
  components.push(new ActionRowBuilder().addComponents(buttons));
  return { content: lines.join('\n'), components };
}

const NOT_A_PLAYER = '*Grimbold squints.* "I don\'t know you. Only those with an account in the panel tag art."';

// Right-click → Apps → Tag art.
async function handleTagArt(interaction) {
  const message = interaction.targetMessage;
  if (!isPlayer(interaction.user.id)) return interaction.reply({ content: NOT_A_PLAYER, flags: MessageFlags.Ephemeral });
  if (!inArtChannel(message)) return interaction.reply({ content: `Tag art works on posts in <#${channelId()}>.`, flags: MessageFlags.Ephemeral });
  if (!attachmentsOf(message).some(db.isArtAttachment)) return interaction.reply({ content: 'That post has no images to tag.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!db.getArtMessage(message.id).length) await recordMessage(message);
  else await keepCopies(message);
  return interaction.editReply(tagView(message.id));
}

// The form for everyone else in it and the artist, filled with what is set.
function othersModal(messageId) {
  const [first] = db.getArtMessage(messageId);
  const others = new TextInputBuilder().setCustomId('others').setLabel('Who else is in it? (one per line)')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
    .setPlaceholder('An NPC, a familiar or anyone else: names used before are reused');
  const current = first.figures.map(figure => figure.label).join('\n');
  if (current) others.setValue(current);
  const artist = new TextInputBuilder().setCustomId('artist').setLabel('Artist').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(100)
    .setPlaceholder(first.posted_by_tag ? `Who drew it? (posted by ${first.posted_by_tag})`.slice(0, 100) : 'Who drew it?');
  if (first.artist_name) artist.setValue(first.artist_name);
  const link = new TextInputBuilder().setCustomId('artist_url').setLabel('Artist\'s link (optional)').setStyle(TextInputStyle.Short)
    .setRequired(false).setMaxLength(300).setPlaceholder('https://…');
  if (first.artist_url) link.setValue(first.artist_url);
  return new ModalBuilder().setCustomId(`art:m:${messageId}`).setTitle('Others in it, and the artist')
    .addComponents([others, artist, link].map(input => new ActionRowBuilder().addComponents(input)));
}

// The menu's selects and buttons (customId art:<what>:<messageId>[:<menu>]).
async function handleArtInteraction(interaction) {
  if (!isPlayer(interaction.user.id)) return interaction.reply({ content: NOT_A_PLAYER, flags: MessageFlags.Ephemeral });
  const [, what, messageId] = interaction.customId.split(':');
  try {
    if (what === 'd') return interaction.update({ content: '🎨 Thanks! Grimbold hangs it in the gallery.', components: [] });
    if (what === 'o') return interaction.showModal(othersModal(messageId));
    if (what === 'm') {
      const field = name => interaction.fields.getTextInputValue(name) || '';
      db.tagArtMessage(messageId, { others: field('others').split('\n'), artist: field('artist'), artistUrl: field('artist_url') });
      return interaction.update(tagView(messageId));
    }
    if (what === 'c') {
      const among = (interaction.component && interaction.component.options || []).map(option => option.value);
      db.tagArtMessage(messageId, { characterIds: interaction.values, among });
    } else if (what === 'a') {
      db.tagArtMessage(messageId, { adventure: interaction.values[0] });
    } else if (what === 'x') {
      const [first] = db.getArtMessage(messageId);
      db.tagArtMessage(messageId, { notArt: !(first && first.not_art) });
    }
    return interaction.update(tagView(messageId));
  } catch (error) {
    return interaction.reply({ content: `⚠️ ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}

function setClientForTests(fake) {
  client = fake;
}

module.exports = {
  setArtClient,
  setClientForTests,
  channelId,
  scanChannel,
  runScan,
  startImport,
  recordMessage,
  tagView,
  othersModal,
  handleTagArt,
  handleArtInteraction,
  isRunning: () => running
};
