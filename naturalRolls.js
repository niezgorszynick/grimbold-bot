// naturalRolls.js — natural 1s and 20s on a d20, from every source, posted to
// one Discord channel (NAT_ROLLS_CHANNEL_ID): the weekly shop /roll and the
// rolls made in the panel (character sheet, adventure table, Owlbear).
//
// Without the channel ID or the bot nothing is posted. Private (GM only)
// rolls are never posted: that would give them away.

'use strict';

let client = null;

function channelId() {
  return process.env.NAT_ROLLS_CHANNEL_ID || '';
}

function headline(natural) {
  return natural === 20 ? '✨ **NATURAL 20!**' : '💀 **Natural 1...**';
}

// A panel roll as returned by db.rollForCharacter.
function panelRollMessage(roll) {
  const who = roll.player ? ` (${roll.player})` : ' (rolled by the DM)';
  return `${headline(roll.natural)} **${roll.character}**${who} — ${roll.label}: ${roll.text} = **${roll.total}**`;
}

function weeklyRollMessage(natural, userTag) {
  const outcome = natural === 20 ? 'Grimbold chokes on his pipe smoke: −20% all week.' : 'Prices go up 10% for the week.';
  return `${headline(natural)} **${userTag}** on the weekly shop roll. ${outcome}`;
}

function isNatural(value) {
  return value === 1 || value === 20;
}

// Never throws and never holds up the roll. Returns { ok, reason }.
async function post(content) {
  if (!channelId()) return { ok: false, reason: 'NAT_ROLLS_CHANNEL_ID is not set.' };
  if (!client || (typeof client.isReady === 'function' && !client.isReady())) return { ok: false, reason: 'The Discord bot is not connected.' };
  try {
    const channel = await client.channels.fetch(channelId());
    if (!channel || typeof channel.send !== 'function') return { ok: false, reason: `Channel ${channelId()} not found.` };
    await channel.send({ content, allowedMentions: { parse: [] } });
    return { ok: true };
  } catch (error) {
    console.warn(`Could not post a natural roll to channel ${channelId()}: ${error.message}`);
    return { ok: false, reason: error.message };
  }
}

function announcePanelRoll(roll) {
  if (!roll || roll.private || !isNatural(roll.natural)) return Promise.resolve({ ok: false, reason: 'Not a natural 1 or 20.' });
  return post(panelRollMessage(roll));
}

function announceWeeklyRoll(natural, userTag) {
  if (!isNatural(natural)) return Promise.resolve({ ok: false, reason: 'Not a natural 1 or 20.' });
  return post(weeklyRollMessage(natural, userTag));
}

function setNaturalRollsClient(discordClient) {
  client = discordClient;
}

module.exports = { setNaturalRollsClient, announcePanelRoll, announceWeeklyRoll, panelRollMessage, weeklyRollMessage };
