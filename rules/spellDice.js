// rules/spellDice.js — The dice in a spell's text ("8d6 Fire damage", "2d8
// plus your spellcasting ability modifier"), scaled to how it is cast:
//   cantrips: one more die at character levels 5, 11 and 17, when the Cantrip
//     Upgrade says the damage "increases by one die" (or by 1dX);
//   leveled spells: "The damage increases by 1d6 for each spell slot level
//     above 3" adds dice of that size (and type, if named) per level above.
// The sheet makes each one clickable (public/rules-text.js numbers them in the
// same order), and the roll goes through db/dice.js as "spelldice:...".

'use strict';

// Same pattern as public/rules-text.js: "1d8", "1d4 + 1".
const DICE_PATTERN = /\b(\d+)d(\d+)\b(?:\s*\+\s*(\d+)\b)?/g;
const DAMAGE_TYPES = ['Acid', 'Bludgeoning', 'Cold', 'Fire', 'Force', 'Lightning', 'Necrotic', 'Piercing', 'Poison', 'Psychic', 'Radiant', 'Slashing', 'Thunder'];

function cantripTier(characterLevel) {
  const level = Number(characterLevel) || 1;
  return 1 + (level >= 5) + (level >= 11) + (level >= 17);
}

// "The Bludgeoning damage increases by 1d10 for each spell slot level above 4."
// Also "increase by", two sizes ("by 2d8 and ... by 2d6 for each ... above 5")
// and two types ("The Fire damage and the Radiant damage increase by 1d6").
// Returns { above, perLevel: { sides: count }, type } or null; type limits
// the extra dice to one damage type when only one is named.
function slotScaling(higherLevels) {
  const text = String(higherLevels || '');
  const above = text.match(/for (?:each|every) (?:spell )?slot level above (\d+)/i);
  if (!above) return null;
  const perLevel = {};
  for (const match of text.matchAll(/increases? by (\d+)d(\d+)/gi)) {
    if (!perLevel[match[2]]) perLevel[match[2]] = Number(match[1]);
  }
  if (!Object.keys(perLevel).length) return null;
  const before = text.slice(0, text.search(/increases? by/i));
  const types = DAMAGE_TYPES.filter(type => new RegExp(`\\b${type}\\b`).test(before));
  return { above: Number(above[1]), perLevel, type: types.length === 1 ? types[0] : null };
}

function cantripScales(cantripUpgrade) {
  return /increases by (?:one die|1d\d+)/i.test(String(cantripUpgrade || ''));
}

// [{ token, formula, type, plusModifier }] in the order they appear in the
// description. slotLevel: the slot the spell is cast with (cantrips: ignored);
// modifier: the caster's spellcasting ability modifier.
function spellDice(spell, { slotLevel, characterLevel = 1, modifier = 0 } = {}) {
  if (!spell) return [];
  const text = String(spell.description || '');
  const scaling = spell.level > 0 ? slotScaling(spell.higherLevels) : null;
  const extraLevels = scaling ? Math.max(0, (Number(slotLevel) || spell.level) - scaling.above) : 0;
  const tier = spell.level === 0 && cantripScales(spell.cantripUpgrade) ? cantripTier(characterLevel) : 1;
  const dice = [];
  for (const match of text.matchAll(DICE_PATTERN)) {
    const after = text.slice(match.index + match[0].length);
    const typeMatch = after.match(/^\s+(\w+) damage/);
    const type = typeMatch && DAMAGE_TYPES.includes(typeMatch[1]) ? typeMatch[1] : null;
    const plusModifier = /^\s+plus your spellcasting ability modifier/i.test(after);
    let count = Number(match[1]) * tier;
    const sides = Number(match[2]);
    if (scaling && extraLevels && scaling.perLevel[sides] && (!scaling.type || !type || scaling.type === type)) {
      count += scaling.perLevel[sides] * extraLevels;
    }
    const flat = Number(match[3] || 0) + (plusModifier ? Number(modifier) || 0 : 0);
    const formula = `${count}d${sides}${flat > 0 ? `+${flat}` : flat < 0 ? flat : ''}`;
    dice.push({ token: match[0], formula, type, plusModifier });
  }
  return dice;
}

// The slot levels a spell's dice can differ at: its own level up to 9 (cantrips: 0).
function spellDiceLevels(spell) {
  if (!spell || spell.level === 0) return [0];
  return Array.from({ length: 10 - spell.level }, (_, index) => spell.level + index);
}

module.exports = { spellDice, spellDiceLevels, cantripTier };
