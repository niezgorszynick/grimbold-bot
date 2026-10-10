// rules/armor.js — Armor table and Armor Class calculation (2024 PHB).

const ARMOR = {
  'Padded Armor': { category: 'Light armor', base: 11, dexCap: null },
  'Leather Armor': { category: 'Light armor', base: 11, dexCap: null },
  'Studded Leather Armor': { category: 'Light armor', base: 12, dexCap: null },
  'Hide Armor': { category: 'Medium armor', base: 12, dexCap: 2 },
  'Chain Shirt': { category: 'Medium armor', base: 13, dexCap: 2 },
  'Scale Mail': { category: 'Medium armor', base: 14, dexCap: 2 },
  Breastplate: { category: 'Medium armor', base: 14, dexCap: 2 },
  'Half Plate Armor': { category: 'Medium armor', base: 15, dexCap: 2 },
  'Ring Mail': { category: 'Heavy armor', base: 14, dexCap: 0 },
  'Chain Mail': { category: 'Heavy armor', base: 16, dexCap: 0 },
  'Splint Armor': { category: 'Heavy armor', base: 17, dexCap: 0 },
  'Plate Armor': { category: 'Heavy armor', base: 18, dexCap: 0 }
};
const SHIELD_BONUS = 2;

// Picks the best AC the character can get from the items they carry.
// itemNames: names in the inventory; armorTraining: e.g. ['Light armor', 'Shields'].
// armoredBonus: extra AC while wearing armor (the Defense Fighting Style).
function calculateArmorClass({ itemNames, modifiers, armorTraining, classNames = [], armoredBonus = 0 }) {
  const trained = category => armorTraining.includes(category);
  const hasShield = itemNames.includes('Shield') && trained('Shields');
  const options = [{ ac: 10 + modifiers.dex, source: 'Unarmored', allowsShield: true }];

  if (classNames.includes('Barbarian')) {
    options.push({ ac: 10 + modifiers.dex + modifiers.con, source: 'Unarmored Defense', allowsShield: true });
  }
  if (classNames.includes('Monk')) {
    options.push({ ac: 10 + modifiers.dex + modifiers.wis, source: 'Unarmored Defense', allowsShield: false });
  }
  for (const name of itemNames) {
    const armor = ARMOR[name];
    if (!armor || !trained(armor.category)) continue;
    const dex = armor.dexCap === null ? modifiers.dex : Math.min(modifiers.dex, armor.dexCap);
    options.push({ ac: armor.base + dex + armoredBonus, source: armoredBonus ? `${name} + Defense` : name, allowsShield: true });
  }

  const withShield = options.map(option => {
    const shield = hasShield && option.allowsShield;
    return { ac: option.ac + (shield ? SHIELD_BONUS : 0), source: shield ? `${option.source} + Shield` : option.source };
  });
  return withShield.reduce((best, option) => (option.ac > best.ac ? option : best));
}

module.exports = { ARMOR, SHIELD_BONUS, calculateArmorClass };
