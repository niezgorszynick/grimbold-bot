// views/shopItemDetails.js — What the shop shows when someone opens an item:
// a short line (rarity, attunement, weapon or armor stats, a scroll's spell)
// and the full text, in the light Markdown public/rules-text.js renders.
//
// Magic items come from the magic item list, spell scrolls from the spell
// list, weapons and armor from the rules tables; the shelf's own description
// is kept too when it says something the rules text does not.

'use strict';

const rules = require('../rules');

// seed-catalog.js puts this in when an item had no description.
const PLACEHOLDER = /^a fine item from grimbold\.?$/i;
const SCROLL = /^Spell Scroll \((?:Cantrip|Level \d+): (.+)\)$/i;

const findIn = (table, name) => {
  const lower = String(name || '').toLowerCase();
  const key = Object.keys(table).find(entry => entry.toLowerCase() === lower);
  return key ? table[key] : null;
};

function magicDetails(name) {
  const match = rules.matchMagicItem(name);
  if (!match) return null;
  const { item, variant } = match;
  const rarity = variant ? variant.rarity : item.rarity;
  const kind = item.baseItem ? `${item.kind} (${item.baseItem})` : item.kind;
  const attunement = item.attunement.required
    ? `requires attunement${item.attunement.by ? ` by a ${item.attunement.by.replace(/^an? /i, '')}` : ''}`
    : '';
  return {
    summary: [[kind, rarity && rarity !== 'Varies' ? rarity.toLowerCase() : ''].filter(Boolean).join(', '), attunement].filter(Boolean).join(', '),
    text: rules.variantDescription(item.description, variant && variant.name)
  };
}

function scrollDetails(name) {
  const match = String(name || '').match(SCROLL);
  const spell = match && rules.findSpell(match[1].trim());
  if (!spell) return null;
  const level = spell.level === 0 ? `${spell.school} cantrip` : `Level ${spell.level} ${spell.school}`;
  const facts = [
    spell.castingTime && `**Casting Time**: ${spell.castingTime}`,
    spell.range && `**Range**: ${spell.range}`,
    spell.components.text && `**Components**: ${spell.components.text}`,
    spell.duration && `**Duration**: ${spell.duration}`
  ].filter(Boolean).map(line => `- ${line}`);
  return {
    summary: `${spell.name}: ${level.trim()}`,
    text: [facts.join('\n'), spell.description, spell.higherLevels && `**Using a Higher-Level Spell Slot**. ${spell.higherLevels}`, spell.cantripUpgrade && `**Cantrip Upgrade**. ${spell.cantripUpgrade}`]
      .filter(Boolean).join('\n\n')
  };
}

function weaponDetails(name) {
  const weapon = findIn(rules.WEAPONS, name);
  if (!weapon) return null;
  const properties = weapon.properties.map(property => {
    if (property === 'Versatile' && weapon.versatile) return `Versatile (${weapon.versatile})`;
    if (property === 'Ammunition' && weapon.range) return `Ammunition (range ${weapon.range}; ${weapon.ammunition})`;
    if (property === 'Thrown' && weapon.range) return `Thrown (range ${weapon.range})`;
    return property;
  });
  return {
    summary: `${weapon.category} ${weapon.kind.toLowerCase()} weapon: ${weapon.damage} ${weapon.damageType.toLowerCase()}`,
    text: [properties.length && `- **Properties**: ${properties.join(', ')}`, weapon.mastery && `- **Mastery**: ${weapon.mastery}`].filter(Boolean).join('\n')
  };
}

function armorDetails(name) {
  if (/^shield$/i.test(String(name || '').trim())) {
    return { summary: `Shield: +${rules.SHIELD_BONUS || 2} AC`, text: 'Takes the Utilize action to don or doff. You gain the Armor Class benefit only if you have training with Shields.' };
  }
  const armor = findIn(rules.ARMOR, name);
  if (!armor) return null;
  const ac = armor.dexCap === null ? `${armor.base} + Dex modifier`
    : armor.dexCap === 0 ? `${armor.base}` : `${armor.base} + Dex modifier (max ${armor.dexCap})`;
  return {
    summary: `${armor.category}: AC ${ac}`,
    text: [armor.strength && `- **Strength**: ${armor.strength} (slower by 10 feet without it)`, armor.stealthDisadvantage && '- **Stealth**: Disadvantage'].filter(Boolean).join('\n')
  };
}

// Plain weapons and armor first: "Shield" is the mundane one, not Shield +1.
// item: a shop row { name, category, description } → { summary, text } or
// null when there is nothing to say.
function shopItemDetails(item) {
  let found = null;
  try {
    found = scrollDetails(item.name) || weaponDetails(item.name) || armorDetails(item.name) || magicDetails(item.name);
  } catch (error) {
    found = null; // missing rules content never breaks the shop
  }
  const own = String(item.description || '').trim();
  const ownUseful = own && !PLACEHOLDER.test(own) && !(found && found.text.includes(own));
  const summary = found ? found.summary : '';
  const text = [ownUseful ? own : '', found ? found.text : ''].filter(Boolean).join('\n\n');
  return summary || text ? { summary, text } : null;
}

module.exports = { shopItemDetails };
