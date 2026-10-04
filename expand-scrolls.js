// expand-scrolls.js — replaces generic spell scrolls (ID 85 & 86) with individual cantrips and 1st-level spells
const dbModule = require('./db');
const sqlite = dbModule.db || dbModule;

const cantrips = [
  { name: "Spell Scroll (Acid Splash)", school: "Evocation", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Blade Ward)", school: "Abjuration", classes: "Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "Self", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Chill Touch)", school: "Necromancy", classes: "Sorcerer, Warlock, Wizard", time: "Action", range: "Touch", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Dancing Lights)", school: "Illusion", classes: "Artificer, Bard, Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Druidcraft)", school: "Transmutation", classes: "Druid", time: "Action", range: "30 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Eldritch Blast)", school: "Evocation", classes: "Warlock", time: "Action", range: "120 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Elementalism)", school: "Transmutation", classes: "Artificer, Druid, Sorcerer, Wizard", time: "Action", range: "30 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Fire Bolt)", school: "Evocation", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Friends)", school: "Enchantment", classes: "Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "10 feet", comp: "S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Guidance)", school: "Divination", classes: "Artificer, Cleric, Druid", time: "Action", range: "Touch", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Light)", school: "Evocation", classes: "Artificer, Bard, Cleric, Sorcerer, Wizard", time: "Action", range: "Touch", comp: "V, M", dur: "1 hour" },
  { name: "Spell Scroll (Mage Hand)", school: "Conjuration", classes: "Artificer, Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "30 feet", comp: "V, S", dur: "1 minute" },
  { name: "Spell Scroll (Mending)", school: "Transmutation", classes: "Bard, Cleric, Druid, Sorcerer, Wizard", time: "1 minute", range: "Touch", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Message)", school: "Transmutation", classes: "Artificer, Bard, Druid, Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "S, M", dur: "1 round" },
  { name: "Spell Scroll (Mind Sliver)", school: "Enchantment", classes: "Sorcerer, Warlock, Wizard", time: "Action", range: "60 feet", comp: "V", dur: "1 round" },
  { name: "Spell Scroll (Minor Illusion)", school: "Illusion", classes: "Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "30 feet", comp: "S, M", dur: "1 minute" },
  { name: "Spell Scroll (Poison Spray)", school: "Necromancy", classes: "Artificer, Druid, Sorcerer, Warlock, Wizard", time: "Action", range: "30 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Prestidigitation)", school: "Transmutation", classes: "Artificer, Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "10 feet", comp: "V, S", dur: "Up to 1 hour" },
  { name: "Spell Scroll (Produce Flame)", school: "Conjuration", classes: "Druid", time: "Bonus Action", range: "Self", comp: "V, S", dur: "10 minutes" },
  { name: "Spell Scroll (Ray of Frost)", school: "Evocation", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Resistance)", school: "Abjuration", classes: "Artificer, Cleric, Druid", time: "Action", range: "Touch", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Sacred Flame)", school: "Evocation", classes: "Cleric", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Shillelagh)", school: "Transmutation", classes: "Druid", time: "Bonus Action", range: "Self", comp: "V, S, M", dur: "1 minute" },
  { name: "Spell Scroll (Shocking Grasp)", school: "Evocation", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "Touch", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Sorcerous Burst)", school: "Evocation", classes: "Sorcerer", time: "Action", range: "120 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Spare the Dying)", school: "Necromancy", classes: "Artificer, Cleric, Druid", time: "Action", range: "15 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Starry Wisp)", school: "Evocation", classes: "Bard, Druid", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Thaumaturgy)", school: "Transmutation", classes: "Cleric", time: "Action", range: "30 feet", comp: "V", dur: "Up to 1 minute" },
  { name: "Spell Scroll (Thorn Whip)", school: "Transmutation", classes: "Artificer, Druid", time: "Action", range: "30 feet", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Thunderclap)", school: "Evocation", classes: "Artificer, Bard, Druid, Sorcerer, Warlock, Wizard", time: "Action", range: "Self", comp: "S", dur: "Instantaneous" },
  { name: "Spell Scroll (Toll the Dead)", school: "Necromancy", classes: "Cleric, Warlock, Wizard", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (True Strike)", school: "Divination", classes: "Artificer, Bard, Sorcerer, Warlock, Wizard", time: "Action", range: "Self", comp: "S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Vicious Mockery)", school: "Enchantment", classes: "Bard", time: "Action", range: "60 feet", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Word of Radiance)", school: "Evocation", classes: "Cleric", time: "Action", range: "Self", comp: "V, M", dur: "Instantaneous" }
];

const level1Spells = [
  { name: "Spell Scroll (Alarm)", school: "Abjuration", classes: "Artificer, Ranger, Wizard", time: "1 minute or Ritual", range: "30 feet", comp: "V, S, M", dur: "8 hours" },
  { name: "Spell Scroll (Animal Friendship)", school: "Enchantment", classes: "Bard, Druid, Ranger", time: "Action", range: "30 feet", comp: "V, S, M", dur: "24 hours" },
  { name: "Spell Scroll (Armor of Agathys)", school: "Abjuration", classes: "Warlock", time: "Bonus Action", range: "Self", comp: "V, S, M", dur: "1 hour" },
  { name: "Spell Scroll (Arms of Hadar)", school: "Conjuration", classes: "Warlock", time: "Action", range: "Self", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Bane)", school: "Enchantment", classes: "Bard, Cleric, Warlock", time: "Action", range: "30 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Bless)", school: "Enchantment", classes: "Cleric, Paladin", time: "Action", range: "30 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Burning Hands)", school: "Evocation", classes: "Sorcerer, Wizard", time: "Action", range: "Self", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Buzzing Bee)", school: "Conjuration", classes: "Druid, Ranger, Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Charm Person)", school: "Enchantment", classes: "Bard, Druid, Sorcerer, Warlock, Wizard", time: "Action", range: "30 feet", comp: "V, S", dur: "1 hour" },
  { name: "Spell Scroll (Chromatic Orb)", school: "Evocation", classes: "Sorcerer, Wizard", time: "Action", range: "90 feet", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Color Spray)", school: "Illusion", classes: "Bard, Sorcerer, Wizard", time: "Action", range: "Self", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Command)", school: "Enchantment", classes: "Bard, Cleric, Paladin", time: "Action", range: "60 feet", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Compelled Duel)", school: "Enchantment", classes: "Paladin", time: "Bonus Action", range: "30 feet", comp: "V", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Comprehend Languages)", school: "Divination", classes: "Bard, Sorcerer, Warlock, Wizard", time: "Action or Ritual", range: "Self", comp: "V, S, M", dur: "1 hour" },
  { name: "Spell Scroll (Create or Destroy Water)", school: "Transmutation", classes: "Cleric, Druid", time: "Action", range: "30 feet", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Cure Wounds)", school: "Abjuration", classes: "Artificer, Bard, Cleric, Druid, Paladin, Ranger", time: "Action", range: "Touch", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Detect Evil and Good)", school: "Divination", classes: "Cleric, Paladin", time: "Action", range: "Self", comp: "V, S", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Detect Magic)", school: "Divination", classes: "Artificer, Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock, Wizard", time: "Action or Ritual", range: "Self", comp: "V, S", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Detect Poison and Disease)", school: "Divination", classes: "Cleric, Druid, Paladin, Ranger", time: "Action or Ritual", range: "Self", comp: "V, S, M", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Disguise Self)", school: "Illusion", classes: "Artificer, Bard, Sorcerer, Wizard", time: "Action", range: "Self", comp: "V, S", dur: "1 hour" },
  { name: "Spell Scroll (Dissonant Whispers)", school: "Enchantment", classes: "Bard", time: "Action", range: "60 feet", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Divine Favor)", school: "Transmutation", classes: "Paladin", time: "Bonus Action", range: "Self", comp: "V, S", dur: "1 minute" },
  { name: "Spell Scroll (Divine Smite)", school: "Evocation", classes: "Paladin", time: "Bonus Action", range: "Self", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Ensnaring Strike)", school: "Conjuration", classes: "Ranger", time: "Bonus Action", range: "Self", comp: "V", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Entangle)", school: "Conjuration", classes: "Druid, Ranger", time: "Action", range: "90 feet", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Expeditious Retreat)", school: "Transmutation", classes: "Artificer, Sorcerer, Warlock, Wizard", time: "Bonus Action", range: "Self", comp: "V, S", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Faerie Fire)", school: "Evocation", classes: "Artificer, Bard, Druid", time: "Action", range: "60 feet", comp: "V", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (False Life)", school: "Necromancy", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "Self", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Feather Fall)", school: "Transmutation", classes: "Artificer, Bard, Sorcerer, Wizard", time: "Reaction", range: "60 feet", comp: "V, M", dur: "1 minute" },
  { name: "Spell Scroll (Feign Interest)", school: "Illusion", classes: "Wizard", time: "Action", range: "Self", comp: "V", dur: "1 Hour" },
  { name: "Spell Scroll (Find Familiar)", school: "Conjuration", classes: "Wizard", time: "1 hour or Ritual", range: "10 feet", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Fog Cloud)", school: "Conjuration", classes: "Druid, Ranger, Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "V, S", dur: "Concentration, up to 1 hour" },
  { name: "Spell Scroll (Goodberry)", school: "Conjuration", classes: "Druid, Ranger", time: "Action", range: "Self", comp: "V, S, M", dur: "24 hours" },
  { name: "Spell Scroll (Grease)", school: "Conjuration", classes: "Artificer, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S, M", dur: "1 minute" },
  { name: "Spell Scroll (Guiding Bolt)", school: "Evocation", classes: "Cleric", time: "Action", range: "120 feet", comp: "V, S", dur: "1 round" },
  { name: "Spell Scroll (Hail of Thorns)", school: "Conjuration", classes: "Ranger", time: "Bonus Action", range: "Self", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Healing Word)", school: "Abjuration", classes: "Bard, Cleric, Druid", time: "Bonus Action", range: "60 feet", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Hellish Rebuke)", school: "Evocation", classes: "Warlock", time: "Reaction", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Heroism)", school: "Enchantment", classes: "Bard, Paladin", time: "Action", range: "Touch", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Hex)", school: "Enchantment", classes: "Warlock", time: "Bonus Action", range: "90 feet", comp: "V, S, M", dur: "Concentration, up to 1 hour" },
  { name: "Spell Scroll (Hunter's Mark)", school: "Divination", classes: "Ranger", time: "Bonus Action", range: "90 feet", comp: "V", dur: "Concentration, up to 1 hour" },
  { name: "Spell Scroll (Ice Knife)", school: "Conjuration", classes: "Druid, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Identify)", school: "Divination", classes: "Artificer, Bard, Wizard", time: "1 minute or Ritual", range: "Touch", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Illusory Script)", school: "Illusion", classes: "Bard, Warlock, Wizard", time: "1 minute or Ritual", range: "Touch", comp: "S, M", dur: "10 days" },
  { name: "Spell Scroll (Inflict Wounds)", school: "Necromancy", classes: "Cleric", time: "Action", range: "Touch", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Insidious Rhythm)", school: "Enchantment", classes: "Bard", time: "Action", range: "120 feet", comp: "V, S", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Jump)", school: "Transmutation", classes: "Artificer, Druid, Ranger, Sorcerer, Wizard", time: "Bonus Action", range: "Touch", comp: "V, S, M", dur: "1 minute" },
  { name: "Spell Scroll (Longstrider)", school: "Transmutation", classes: "Artificer, Bard, Druid, Ranger, Wizard", time: "Action", range: "Touch", comp: "V, S, M", dur: "1 hour" },
  { name: "Spell Scroll (Mage Armor)", school: "Abjuration", classes: "Sorcerer, Wizard", time: "Action", range: "Touch", comp: "V, S, M", dur: "8 hours" },
  { name: "Spell Scroll (Magic Missile)", school: "Evocation", classes: "Sorcerer, Wizard", time: "Action", range: "120 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Protection from Evil and Good)", school: "Abjuration", classes: "Cleric, Druid, Paladin, Warlock, Wizard", time: "Action", range: "Touch", comp: "V, S, M", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Purify Food and Drink)", school: "Transmutation", classes: "Artificer, Cleric, Druid, Paladin", time: "Action or Ritual", range: "10 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Quick Clothier)", school: "Transmutation", classes: "Artificer, Bard, Wizard", time: "Action", range: "Touch", comp: "V, S, M", dur: "24 Hours" },
  { name: "Spell Scroll (Ray of Sickness)", school: "Necromancy", classes: "Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Sanctuary)", school: "Abjuration", classes: "Artificer, Cleric", time: "Bonus Action", range: "30 feet", comp: "V, S, M", dur: "1 minute" },
  { name: "Spell Scroll (Searing Smite)", school: "Evocation", classes: "Paladin", time: "Bonus Action", range: "Self", comp: "V", dur: "1 minute" },
  { name: "Spell Scroll (Shield)", school: "Abjuration", classes: "Sorcerer, Wizard", time: "Reaction", range: "Self", comp: "V, S", dur: "1 round" },
  { name: "Spell Scroll (Shield of Faith)", school: "Abjuration", classes: "Cleric, Paladin", time: "Bonus Action", range: "60 feet", comp: "V, S, M", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Silent Image)", school: "Illusion", classes: "Bard, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S, M", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Sleep)", school: "Enchantment", classes: "Bard, Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S, M", dur: "Concentration, up to 10 minutes" },
  { name: "Spell Scroll (Speak with Animals)", school: "Divination", classes: "Bard, Druid, Ranger, Warlock", time: "Action or Ritual", range: "Self", comp: "V, S", dur: "10 minutes" },
  { name: "Spell Scroll (Spellfire Flare)", school: "Evocation", classes: "Sorcerer, Wizard", time: "Action", range: "60 feet", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Tasha's Hideous Laughter)", school: "Enchantment", classes: "Bard, Warlock, Wizard", time: "Action", range: "30 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Tenser's Floating Disk)", school: "Conjuration", classes: "Wizard", time: "Action or Ritual", range: "30 feet", comp: "V, S, M", dur: "1 hour" },
  { name: "Spell Scroll (Thunderous Smite)", school: "Evocation", classes: "Paladin", time: "Bonus Action", range: "Self", comp: "V", dur: "Instantaneous" },
  { name: "Spell Scroll (Thunderwave)", school: "Evocation", classes: "Bard, Druid, Sorcerer, Wizard", time: "Action", range: "Self", comp: "V, S", dur: "Instantaneous" },
  { name: "Spell Scroll (Unseen Servant)", school: "Conjuration", classes: "Bard, Warlock, Wizard", time: "Action or Ritual", range: "60 feet", comp: "V, S, M", dur: "1 hour" },
  { name: "Spell Scroll (Wardaway)", school: "Abjuration", classes: "Bard, Cleric, Paladin, Wizard", time: "Action", range: "60 feet", comp: "V, S, M", dur: "Instantaneous" },
  { name: "Spell Scroll (Witch Bolt)", school: "Evocation", classes: "Sorcerer, Warlock, Wizard", time: "Action", range: "60 feet", comp: "V, S, M", dur: "Concentration, up to 1 minute" },
  { name: "Spell Scroll (Wrathful Smite)", school: "Necromancy", classes: "Paladin", time: "Bonus Action", range: "Self", comp: "V", dur: "1 minute" }
];

const transaction = sqlite.transaction(() => {
  // 1. Usunięcie starych, ogólnych pozycji z catalog i items
  sqlite.prepare("DELETE FROM items WHERE name IN ('Spell Scroll (Cantrip)', 'Spell Scroll (Level 1)')").run();
  sqlite.prepare("DELETE FROM catalog WHERE id IN (85, 86) OR name IN ('Spell Scroll (Cantrip)', 'Spell Scroll (Level 1)')").run();

  const insertStmt = sqlite.prepare(`
    INSERT INTO catalog (name, category, tier, base_price_cp, description, min_level, min_stock, max_stock)
    VALUES (?, 'Spell Scroll', ?, ?, ?, 1, 1, 2)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category,
      tier = excluded.tier,
      base_price_cp = excluded.base_price_cp,
      description = excluded.description,
      min_level = excluded.min_level,
      min_stock = excluded.min_stock,
      max_stock = excluded.max_stock
  `);

  let addedCantrips = 0;
  for (const s of cantrips) {
    const desc = `${s.school} cantrip (${s.classes}). Cast: ${s.time} | Range: ${s.range} | Comp: ${s.comp} | Dur: ${s.dur}. A creature that can read the scroll's language can cast this spell without material components.`;
    insertStmt.run(s.name, 'common', 3000, desc);
    addedCantrips++;
  }

  let addedLevel1 = 0;
  for (const s of level1Spells) {
    const desc = `1st-level ${s.school} (${s.classes}). Cast: ${s.time} | Range: ${s.range} | Comp: ${s.comp} | Dur: ${s.dur}. A creature that can read the scroll's language can cast this spell without material components.`;
    insertStmt.run(s.name, 'common', 5000, desc);
    addedLevel1++;
  }

  return { addedCantrips, addedLevel1 };
});

const result = transaction();
console.log(`✅ Pomyślnie zaktualizowano Master Catalog!`);
console.log(`📜 Dodano cantripów: ${result.addedCantrips}`);
console.log(`📜 Dodano zaklęć 1. poziomu: ${result.addedLevel1}`);

const count = sqlite.prepare("SELECT count(*) as total FROM catalog").get();
console.log(`📊 Łączna liczba przedmiotów w Master Catalog: ${count.total}`);