// update-scroll-names.js — updates scroll names to include level designation
const dbModule = require('./db');
const sqlite = dbModule.db || dbModule;

const cantripNames = [
  "Acid Splash", "Blade Ward", "Chill Touch", "Dancing Lights", "Druidcraft",
  "Eldritch Blast", "Elementalism", "Fire Bolt", "Friends", "Guidance",
  "Light", "Mage Hand", "Mending", "Message", "Mind Sliver",
  "Minor Illusion", "Poison Spray", "Prestidigitation", "Produce Flame", "Ray of Frost",
  "Resistance", "Sacred Flame", "Shillelagh", "Shocking Grasp", "Sorcerous Burst",
  "Spare the Dying", "Starry Wisp", "Thaumaturgy", "Thorn Whip", "Thunderclap",
  "Toll the Dead", "True Strike", "Vicious Mockery", "Word of Radiance"
];

const level1Names = [
  "Alarm", "Animal Friendship", "Armor of Agathys", "Arms of Hadar", "Bane",
  "Bless", "Burning Hands", "Buzzing Bee", "Charm Person", "Chromatic Orb",
  "Color Spray", "Command", "Compelled Duel", "Comprehend Languages", "Create or Destroy Water",
  "Cure Wounds", "Detect Evil and Good", "Detect Magic", "Detect Poison and Disease", "Disguise Self",
  "Dissonant Whispers", "Divine Favor", "Divine Smite", "Ensnaring Strike", "Entangle",
  "Expeditious Retreat", "Faerie Fire", "False Life", "Feather Fall", "Feign Interest",
  "Find Familiar", "Fog Cloud", "Goodberry", "Grease", "Guiding Bolt",
  "Hail of Thorns", "Healing Word", "Hellish Rebuke", "Heroism", "Hex",
  "Hunter's Mark", "Ice Knife", "Identify", "Illusory Script", "Inflict Wounds",
  "Insidious Rhythm", "Jump", "Longstrider", "Mage Armor", "Magic Missile",
  "Protection from Evil and Good", "Purify Food and Drink", "Quick Clothier", "Ray of Sickness", "Sanctuary",
  "Searing Smite", "Shield", "Shield of Faith", "Silent Image", "Sleep",
  "Speak with Animals", "Spellfire Flare", "Tasha's Hideous Laughter", "Tenser's Floating Disk", "Thunderous Smite",
  "Thunderwave", "Unseen Servant", "Wardaway", "Witch Bolt", "Wrathful Smite"
];

const updateTransaction = sqlite.transaction(() => {
  const updateCatalogStmt = sqlite.prepare("UPDATE catalog SET name = ? WHERE name = ?");
  const updateItemsStmt = sqlite.prepare("UPDATE items SET name = ? WHERE name = ?");

  let updatedCantrips = 0;
  let updatedLevel1 = 0;

  // 1. Aktualizacja Cantripów: "Spell Scroll (Nazwa)" -> "Spell Scroll (Cantrip: Nazwa)"
  for (const name of cantripNames) {
    const oldName = `Spell Scroll (${name})`;
    const newName = `Spell Scroll (Cantrip: ${name})`;

    const catResult = updateCatalogStmt.run(newName, oldName);
    updateItemsStmt.run(newName, oldName);

    if (catResult.changes > 0) updatedCantrips++;
  }

  // 2. Aktualizacja Zaklęć 1. poziomu: "Spell Scroll (Nazwa)" -> "Spell Scroll (Level 1: Nazwa)"
  for (const name of level1Names) {
    const oldName = `Spell Scroll (${name})`;
    const newName = `Spell Scroll (Level 1: ${name})`;

    const catResult = updateCatalogStmt.run(newName, oldName);
    updateItemsStmt.run(newName, oldName);

    if (catResult.changes > 0) updatedLevel1++;
  }

  return { updatedCantrips, updatedLevel1 };
});

try {
  const result = updateTransaction();
  console.log(`✅ Zaktualizowano nazwy zwojów:`);
  console.log(`   - Cantripy: ${result.updatedCantrips}`);
  console.log(`   - Poziom 1: ${result.updatedLevel1}`);
} catch (error) {
  console.error("❌ Błąd podczas aktualizacji bazy:", error);
}