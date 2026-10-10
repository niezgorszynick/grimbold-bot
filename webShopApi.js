const express = require('express');
const db = require('./db');
const { formatCp } = require('./currency');
const { DND_DATA } = require('./dndData');
const rules = require('./rules');
const { loadSessionUser, isAdmin } = require('./auth');
const shop = require('./shop');

const router = express.Router();

// Any logged-in user, including the emergency admin (id 0).
function getSessionApiUser(req) {
  return loadSessionUser(req);
}

// A logged-in player account (excludes the emergency admin, who has no characters).
function getSessionPlayer(req) {
  const user = loadSessionUser(req);
  return user && user.id > 0 ? user : null;
}

async function sendGrimboldShopEmbed({
  channelId,
  item,
  character,
  quantity,
  buyerTag,
  discountPercent,
  finalUnitPriceCp,
  totalCostCp
}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId) {
    console.warn('[Grimbold] Missing DISCORD_TOKEN or ANNOUNCEMENT_CHANNEL. Skipping Discord broadcast.');
    return;
  }

  const embed = {
    title: "🪙 Transaction Sealed at Grimbold's Wares!",
    color: 0xd4af37,
    description:
      '*Grimbold gives an appreciative nod, sliding the goods across the heavy oak counter before noting the transaction in his ledger.*\n\n' +
      '"May this serve you well in the perils ahead."',
    fields: [
      { name: 'Item', value: `**${item.name}** \`${item.category}\``, inline: true },
      { name: 'Quantity', value: `${quantity}`, inline: true },
      {
        name: 'Recipient (Character)',
        value: `🛡️ **${character.name}** (Lvl ${character.level} ${character.class || 'Adventurer'})`,
        inline: false
      },
      { name: 'Purchased By', value: buyerTag, inline: true },
      {
        name: 'Discount',
        value: discountPercent < 0
          ? `${Math.abs(discountPercent)}% discount`
          : discountPercent > 0
            ? `${discountPercent}% surcharge`
            : 'None (0%)',
        inline: true
      },
      {
        name: 'Total Paid',
        value: `**${formatCp(totalCostCp)}** (${formatCp(finalUnitPriceCp)} each)`,
        inline: true
      },
      { name: 'Remaining Purse', value: formatCp(character.gold_cp), inline: true }
    ],
    footer: { text: "Grimbold's Emporium • Web Campaign Hub" },
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } })
    });
    if (!response.ok) {
      console.error('[Grimbold] Discord API Error:', await response.text());
    }
  } catch (error) {
    console.error('[Grimbold] Failed to send Discord purchase message:', error);
  }
}

router.get('/my-characters', (req, res) => {
  const player = getSessionPlayer(req);
  if (!player) return res.status(401).json({ error: 'Unauthorized' });

  return res.json({ characters: shop.getShoppingCharacters(player.id) });
});

router.get('/characters/:id', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const characterId = Number(req.params.id);
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return res.status(400).json({ error: 'Invalid character ID.' });
  }
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!character) return res.status(404).json({ error: 'Character not found.' });
  if (!isAdmin(user) && character.player_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  let sheetData = {};
  if (character.sheet_data) {
    try {
      sheetData = JSON.parse(character.sheet_data);
    } catch (error) {
      console.error(`Failed to parse sheet data for character ${characterId}:`, error);
      return res.status(500).json({ error: 'Could not read character sheet data.' });
    }
  }

  return res.json({
    character,
    sheetData,
    classes: db.getCharacterClasses(characterId),
    vitals: vitalsViewFor(character, sheetData)
  });
});

// Rule-derived values (max HP, hit dice, slots) for a stored character.
// Returns null when the character's classes are not in the rules (legacy data).
function vitalsContextFor(character, sheetData) {
  const rows = db.getCharacterClasses(character.id);
  const classRows = rows.length
    ? rows.map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }))
    : [{ className: character.class, subclassName: character.subclass, level: character.level }];
  try {
    return rules.deriveVitalsContext({ species: character.race, sheetData, classRows });
  } catch {
    return null;
  }
}

function vitalsViewFor(character, sheetData) {
  const context = vitalsContextFor(character, sheetData);
  if (!context) return null;
  return rules.buildVitalsView(rules.normalizeVitals(sheetData, context.hpMax), context);
}

function levelUpErrorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'Character not found.') return 404;
  return 400;
}

// Choices available for the character's next earned level.
router.get('/characters/:id/level-up', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterLevelUpOptions({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(levelUpErrorStatus(error.message)).json({ error: error.message });
  }
});

// Applies one level: { className, subclass, improvement, multiclassSkills, multiclassTools }.
router.post('/characters/:id/level-up', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const request = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    const result = db.levelUpCharacter({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), request });
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = levelUpErrorStatus(error.message);
    if (status === 400 && error instanceof TypeError) {
      console.error('Level-up failed:', error);
      return res.status(500).json({ error: 'Could not apply the level-up.' });
    }
    return res.status(status).json({ error: error.message });
  }
});

// The spell catalog for the spell picker (descriptions included). It only
// changes when rules/content/spells.md does, so browsers may cache it briefly.
router.get('/rules/spells', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'private, max-age=3600');
  return res.json({ spells: Object.values(rules.getSpellCatalog()) });
});

// Feat and invocation text for pickers (from rules/content, when present).
function contentEntries(category) {
  return Object.values(rules.loadContent(category)).map(entry => ({
    name: entry.name,
    category: entry.fields.category || '',
    prerequisite: entry.fields.prerequisite || '',
    description: entry.description
  }));
}

router.get('/rules/feats', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'private, max-age=3600');
  return res.json({ feats: contentEntries('feats') });
});

router.get('/rules/invocations', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'private, max-age=3600');
  return res.json({ invocations: contentEntries('invocations') });
});

function spellErrorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'Character not found.') return 404;
  return 400;
}

router.get('/characters/:id/spells', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterSpells({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(spellErrorStatus(error.message)).json({ error: error.message });
  }
});

// { action: 'choose', source, cantrips, prepared, addToSpellbook, copyAddedSpells }
// { action: 'cast', source, spell, slotLevel | pact | free | ritual }
// { action: 'endConcentration' }
// { action: 'invocations', invocations: [{ name, cantrip, feat }] }
router.post('/characters/:id/spells', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const who = { id: req.params.id, player_id: user.id, is_admin: isAdmin(user) };
  try {
    if (body.action === 'choose') return res.json(db.chooseCharacterSpells({ ...who, source: body.source, request: body }));
    if (body.action === 'cast') return res.json(db.castCharacterSpell({ ...who, request: body }));
    if (body.action === 'endConcentration') return res.json(db.endCharacterConcentration(who));
    if (body.action === 'invocations') return res.json(db.chooseCharacterInvocations({ ...who, choices: body.invocations }));
    return res.status(400).json({ error: 'Unknown spell action.' });
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Spell action failed:', error);
      return res.status(500).json({ error: 'Could not update spells.' });
    }
    return res.status(spellErrorStatus(error.message)).json({ error: error.message });
  }
});

function magicItemErrorStatus(message) {
  if (message === 'Forbidden.' || /^Only a DM/.test(message)) return 403;
  if (message === 'Character not found.') return 404;
  return 400;
}

router.get('/rules/magic-items', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.set('Cache-Control', 'private, max-age=3600');
  const items = Object.values(rules.getMagicItemCatalog()).map(item => ({
    name: item.name,
    kind: item.kind,
    baseItem: item.baseItem,
    rarity: item.rarity,
    variants: item.variants.map(variant => ({ label: variant.label, name: variant.name, rarity: variant.rarity, priceGp: variant.priceGp })),
    attunement: { required: item.attunement.required, by: item.attunement.by },
    consumable: item.consumable,
    charges: item.charges,
    priceGp: item.priceGp,
    description: item.description
  }));
  return res.json({ items });
});

router.get('/characters/:id/magic-items', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterMagicItems({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// { action: 'grant', name, variant, quantity } (DM) | { action: 'remove', uid } (DM)
// { action: 'equip' | 'unequip' | 'attune' | 'unattune' | 'consume', uid }
// { action: 'useCharges' | 'restoreCharges', uid, count }
router.post('/characters/:id/magic-items', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    return res.json(db.changeCharacterMagicItems({
      id: req.params.id, player_id: user.id, is_admin: isAdmin(user), action: body.action, params: body
    }));
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Magic item action failed:', error);
      return res.status(500).json({ error: 'Could not update magic items.' });
    }
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// Shop catalog items that can be put on a character sheet.
router.get('/catalog/sheet-items', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  // Magic items are flagged: only a DM can add them this way.
  const items = db.getCatalogForSheets().map(item => {
    const magic = rules.matchMagicItem(item.name);
    return { ...item, magic: Boolean(magic && (magic.variant || !magic.item.variants.length)) };
  });
  return res.json({ items });
});

router.get('/characters/:id/inventory', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterInventory({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// { action: 'add', catalogId | name, quantity, description }
// { action: 'update', index, name, quantity } | { action: 'remove', index, name }
router.post('/characters/:id/inventory', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    return res.json(db.changeCharacterInventory({
      id: req.params.id, player_id: user.id, is_admin: isAdmin(user), action: body.action, params: body
    }));
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Inventory action failed:', error);
      return res.status(500).json({ error: 'Could not update items.' });
    }
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// Armor Class and attacks from worn armor and wielded weapons.
router.get('/characters/:id/combat', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterCombat({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// { action: 'adjustAc', value }
router.post('/characters/:id/combat', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (body.action !== 'adjustAc') return res.status(400).json({ error: 'Unknown combat action.' });
  try {
    return res.json(db.setCharacterAcAdjustment({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), value: body.value }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// HP, rests, death saves, exhaustion and spell slot usage.
router.post('/characters/:id/vitals', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const characterId = Number(req.params.id);
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return res.status(400).json({ error: 'Invalid character ID.' });
  }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (!rules.VITALS_ACTIONS.includes(body.action)) {
    return res.status(400).json({ error: 'Unknown vitals action.' });
  }

  try {
    const result = db.transaction(() => {
      const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      if (!character) return { status: 404, error: 'Character not found.' };
      if (!isAdmin(user) && character.player_id !== user.id) return { status: 403, error: 'Forbidden.' };

      let sheetData = {};
      try {
        sheetData = JSON.parse(character.sheet_data || '{}') || {};
      } catch {
        return { status: 500, error: 'Could not read character sheet data.' };
      }
      const context = vitalsContextFor(character, sheetData);
      if (!context) return { status: 400, error: 'This character has no valid class levels to calculate Hit Points from.' };

      const outcome = rules.applyVitalsAction(
        rules.normalizeVitals(sheetData, context.hpMax),
        body.action,
        body,
        context
      );
      const spellEffects = db.spellEffectsOfVitals(character, sheetData, body.action, body, outcome);
      const itemEffects = db.magicItemEffectsOfVitals(sheetData, body.action);
      const nextSheet = {
        ...sheetData, ...outcome.vitals, hpMax: outcome.hpMax, spellcasting: spellEffects.spellcasting, magicItems: itemEffects.magicItems
      };
      db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(nextSheet), characterId);
      return {
        vitals: rules.buildVitalsView(outcome.vitals, context, outcome.hpMax),
        events: outcome.events,
        rolls: outcome.rolls || (outcome.roll ? [{ die: 'd20', roll: outcome.roll }] : []),
        healed: outcome.healed,
        concentration: spellEffects.concentration,
        magicItemsRegained: itemEffects.regained
      };
    })();
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Rules data the character creator needs to render its choices.
router.get('/rules/creation', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });

  const classes = Object.fromEntries(Object.entries(rules.ALL_CLASSES).map(([name, data]) => [name, {
    hitDie: data.hitDie,
    primaryAbilities: data.primaryAbilities,
    savingThrows: data.savingThrows,
    skillChoices: data.skillChoices,
    toolProficiencies: data.toolProficiencies,
    armorTraining: data.armorTraining,
    weaponProficiencies: data.weaponProficiencies,
    startingEquipment: data.startingEquipment,
    featuresByLevel: Object.fromEntries(Object.entries(data.featuresByLevel)
      .filter(([level]) => Number(level) <= rules.STARTING_LEVEL))
  }]));
  return res.json({
    startingLevel: rules.STARTING_LEVEL,
    abilities: rules.ABILITIES,
    skills: rules.SKILL_NAMES,
    languages: rules.STANDARD_LANGUAGES.filter(language => language !== 'Common'),
    languageChoices: rules.STARTING_LANGUAGE_CHOICES,
    classes,
    subclasses: rules.DND_CLASSES_AND_SUBCLASSES,
    backgrounds: rules.BACKGROUNDS,
    species: rules.DND_SPECIES_DATA,
    speciesOptions: rules.SPECIES_OPTIONS,
    sizeOptions: Object.fromEntries(rules.DND_SPECIES.map(name => [name, rules.sizeOptions(name)])),
    originFeats: rules.ORIGIN_FEATS,
    toolCategories: rules.TOOL_CATEGORIES,
    generationMethods: rules.GENERATION_METHODS,
    pointBuyCosts: rules.POINT_BUY_COSTS,
    totalPointBuyPoints: rules.TOTAL_POINT_BUY_POINTS,
    standardArray: rules.STANDARD_ARRAY,
    standardArraySuggestions: rules.STANDARD_ARRAY_SUGGESTIONS,
    fightingStyles: rules.FIGHTING_STYLE_NAMES,
    fightingStyleClasses: rules.FIGHTING_STYLE_FEATURE_LEVELS
  });
});

function buildCharacterFromBody(body) {
  const request = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  return rules.buildStartingCharacter({
    ...request,
    className: request.className === undefined ? request.character_class : request.className
  });
}

// Validates a creation request without saving it; the creator uses this for its live summary.
router.post('/characters/preview', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ character: buildCharacterFromBody(req.body) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/characters/create', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.id <= 0) return res.status(403).json({ error: 'A player account is required to create a character.' });

  let character;
  try {
    character = buildCharacterFromBody(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const characterId = db.insertStartingCharacter(user.id, character);
    return res.json({ success: true, characterId });
  } catch (error) {
    console.error('Character creation failed:', error);
    return res.status(500).json({ error: 'Could not create character.' });
  }
});

router.post('/characters/:id/abilities', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const characterId = Number(req.params.id);
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return res.status(400).json({ error: 'Invalid character ID.' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const abilityScores = body.abilities || body.scores;
  const abilities = DND_DATA.abilityScores;
  if (
    !abilityScores ||
    typeof abilityScores !== 'object' ||
    Array.isArray(abilityScores) ||
    abilities.some(ability => !Number.isInteger(abilityScores[ability]) ||
      abilityScores[ability] < 1 || abilityScores[ability] > 30)
  ) {
    return res.status(400).json({ error: 'Ability scores must be whole numbers from 1 to 30.' });
  }

  try {
    const update = db.transaction(() => {
      const character = db.prepare(
        'SELECT id, player_id, sheet_data FROM characters WHERE id = ?'
      ).get(characterId);
      if (!character) return { error: 'not_found' };
      if (!isAdmin(user) && character.player_id !== user.id) {
        return { error: 'forbidden' };
      }

      let sheetData = {};
      if (character.sheet_data) {
        try {
          sheetData = JSON.parse(character.sheet_data);
        } catch {
          throw new Error('Stored character sheet data is invalid JSON.');
        }
        if (!sheetData || typeof sheetData !== 'object' || Array.isArray(sheetData)) {
          throw new Error('Stored character sheet data must be an object.');
        }
      }
      sheetData.abilities = Object.fromEntries(abilities.map(ability => [
        ability, abilityScores[ability]
      ]));
      sheetData.generationMethod = 'Manual/Rolled';
      delete sheetData.pointBuy;
      db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?')
        .run(JSON.stringify(sheetData), characterId);
      return { abilities: sheetData.abilities };
    });
    const result = update();
    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'Character not found.' });
    }
    if (result.error === 'forbidden') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return res.json({ success: true, abilities: result.abilities });
  } catch (error) {
    if (
      error.message === 'Stored character sheet data is invalid JSON.' ||
      error.message === 'Stored character sheet data must be an object.'
    ) {
      console.error(`Unable to update abilities for character ${characterId}:`, error);
      return res.status(500).json({ error: 'Could not read stored character sheet data.' });
    }
    console.error(`Unable to save abilities for character ${characterId}:`, error);
    return res.status(500).json({ error: 'Could not save character abilities.' });
  }
});

router.post('/characters/:id/sheet', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const characterId = Number(req.params.id);
  if (!Number.isSafeInteger(characterId) || characterId <= 0) {
    return res.status(400).json({ error: 'Invalid character ID.' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const { name, species, character_class, subclass } = body;
  for (const [field, value] of Object.entries({ name, species, character_class, subclass })) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return res.status(400).json({ error: `${field} must be a string.` });
    }
  }
  const sheetData = body.sheetData === undefined || body.sheetData === null
    ? {}
    : body.sheetData;
  if (typeof sheetData !== 'object' || Array.isArray(sheetData)) {
    return res.status(400).json({ error: 'sheetData must be an object.' });
  }

  try {
    const updated = db.updateCharacterSheet({
      id: characterId,
      player_id: user.id,
      is_admin: isAdmin(user),
      name,
      race: species,
      class_name: character_class,
      subclass,
      sheet_data: JSON.stringify(sheetData)
    });
    if (updated.changes !== 1) {
      return res.status(404).json({ error: 'Character not found.' });
    }
    return res.json({ success: true, message: 'Character sheet saved successfully.' });
  } catch (error) {
    if (error.message === 'Character not found.') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Forbidden.') {
      return res.status(403).json({ error: error.message });
    }
    if (
      error.message === 'Invalid character ID.' ||
      error.message === 'Character name cannot be empty.' ||
      error.message === 'Character sheet data must be an object.' ||
      error.message === 'Invalid character sheet data.' ||
      error.message === 'Ability scores must be whole numbers from 1 to 30.' ||
      error.message.startsWith('Species, class and subclass') ||
      error.message.startsWith('Invalid species ') ||
      error.message.startsWith('Invalid class ') ||
      error.message.startsWith('Invalid subclass ')
    ) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Character sheet update failed:', error);
    return res.status(500).json({ error: 'Could not save character sheet.' });
  }
});

router.post('/admin/character-gold', (req, res) => {
  if (!isAdmin(getSessionApiUser(req))) {
    return res.status(403).json({ error: 'Access denied. DM/Admin rights required.' });
  }

  const { characterId, gold } = req.body || {};
  if (characterId === undefined || characterId === null || characterId === '' || gold === undefined) {
    return res.status(400).json({ error: 'Missing characterId or gold parameter.' });
  }

  try {
    const updated = db.updateCharacterGold(characterId, gold);
    return res.json({ success: true, updated });
  } catch (error) {
    if (
      error.message === 'Invalid character ID.' ||
      error.message.startsWith('Gold ')
    ) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message === 'Character not found.') {
      return res.status(404).json({ error: error.message });
    }

    console.error('Character gold update failed:', error);
    return res.status(500).json({ error: 'Could not update character gold.' });
  }
});

router.post('/shop/buy', async (req, res) => {
  const player = getSessionPlayer(req);
  if (!player) return res.status(401).json({ error: 'Unauthorized' });

  const { itemName, characterId, quantity } = req.body || {};
  if (typeof itemName !== 'string' || !itemName.trim() ||
      characterId === undefined || characterId === null || characterId === '') {
    return res.status(400).json({ error: 'Missing item name or character.' });
  }

  const parsedCharacterId = Number(characterId);
  if (!Number.isSafeInteger(parsedCharacterId) || parsedCharacterId <= 0) {
    return res.status(400).json({ error: 'Invalid character.' });
  }
  if (quantity !== undefined &&
      (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0)) {
    return res.status(400).json({ error: 'Invalid quantity.' });
  }

  try {
    const result = shop.purchaseItem({
      itemName,
      quantity: quantity === undefined ? 1 : Number(quantity),
      buyerTag: player.discord_tag,
      buyerDiscordId: player.discord_id,
      characterId: parsedCharacterId,
      playerId: player.id
    });

    const channelId = process.env.ANNOUNCEMENT_CHANNEL ||
      process.env.ANNOUNCEMENT_CHANNEL_ID ||
      process.env.ANNOUNCMENT_CHANNEL ||
      process.env.DISCORD_SHOP_CHANNEL_ID ||
      process.env.CHANNEL_ID;
    void sendGrimboldShopEmbed({
      channelId,
      item: result.item,
      character: result.character,
      quantity: result.quantity,
      buyerTag: player.discord_tag,
      discountPercent: result.discountPercent,
      finalUnitPriceCp: result.finalUnitPriceCp,
      totalCostCp: result.totalCostCp
    });

    return res.json({
      success: true,
      transaction: {
        ...result,
        totalCostFormatted: formatCp(result.totalCostCp),
        remainingPurseFormatted: formatCp(result.character.gold_cp)
      }
    });
  } catch (error) {
    if (error instanceof shop.PurchaseError) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Web shop purchase failed:', error);
    return res.status(500).json({ error: 'Purchase failed.' });
  }
});

module.exports = router;
