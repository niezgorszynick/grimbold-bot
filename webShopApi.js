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
    vitals: vitalsViewFor(character, sheetData),
    // DEX + Alert + items; the sheet adds a changed DEX live.
    initiative: (() => {
      try {
        const classes = db.getCharacterClasses(characterId)
          .map(row => ({ className: row.class_name, subclassName: row.subclass_name, level: row.class_level }));
        return rules.initiativeOf({ classes, sheetData });
      } catch {
        return null;
      }
    })(),
    // Thaumaturge, Magician, Otherworldly Glamour: bonuses the skill list adds.
    checkBonuses: rules.featureCheckBonuses(sheetData, ability => rules.effectiveAbilityScore(sheetData, ability)),
    // Custom item bonuses, added on top (skills, checks, saves) and Advantage marks.
    itemBonuses: rules.itemBonusTotals(sheetData)
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

// Armor, weapons, tools and languages: { armor, weapons, tools, languages, canEdit }.
router.get('/characters/:id/proficiencies', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterProficiencies({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// DMs only: { armor, weapons, tools, languages } as lists of names.
router.post('/characters/:id/proficiencies', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    return res.json(db.setCharacterProficiencies({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), lists: body }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// Wild Shape: learned forms, beasts to learn, and each form's stat block.
router.get('/characters/:id/wild-shape', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterWildShape({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user) }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// { learn: 'Wolf' } or { forget: 'Wolf' }. Transforming is a vitals action.
router.post('/characters/:id/wild-shape', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    return res.json(db.changeCharacterWildShapeForms({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), change: body }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// Class choices the character hasn't made yet (Divine Order, Expertise, ...).
router.get('/characters/:id/feature-choices', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const who = { id: req.params.id, player_id: user.id, is_admin: isAdmin(user) };
    // Plus a species lineage never chosen (older characters), e.g. which Elf.
    return res.json({ missing: db.getMissingFeatureChoices(who), species: db.getMissingSpeciesChoice(who) });
  } catch (error) {
    return res.status(levelUpErrorStatus(error.message)).json({ error: error.message });
  }
});

// { picks: { [feature id]: choice }, species: { option, spellAbility } } — either or both.
router.post('/characters/:id/feature-choices', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const who = { id: req.params.id, player_id: user.id, is_admin: isAdmin(user) };
  try {
    if (body.species) db.chooseSpeciesOption({ ...who, choice: body.species });
    const picks = body.picks && typeof body.picks === 'object' ? body.picks : {};
    const pending = db.getMissingFeatureChoices(who);
    if (Object.keys(picks).length || pending.some(feature => feature.kind === 'grant')) db.chooseMissingFeatures({ ...who, picks });
    return res.json({ success: true, missing: db.getMissingFeatureChoices(who), species: db.getMissingSpeciesChoice(who) });
  } catch (error) {
    const status = levelUpErrorStatus(error.message);
    if (status === 400 && error instanceof TypeError) {
      console.error('Feature choices failed:', error);
      return res.status(500).json({ error: 'Could not save the choices.' });
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
// { action: 'land', land } (Circle of the Land, after a Long Rest)
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
    if (body.action === 'land') return res.json(db.setCharacterLand({ ...who, land: body.land }));
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
  // Magic items are flagged: adding one puts it in Magic Items.
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

// What a custom weapon would attack with, while its stats are being edited: { name, weapon }.
router.post('/characters/:id/inventory/preview-weapon', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    return res.json(db.previewCustomWeapon({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), name: body.name, weapon: body.weapon }));
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Weapon preview failed:', error);
      return res.status(500).json({ error: 'Could not work out the attack.' });
    }
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

// ─── Dice ───────────────────────────────────────────────────────────────────

function diceErrorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'Character not found.') return 404;
  return 400;
}

// { roll: 'skill:Stealth' } or { formula: '2d6+3', label }; mode; critical; private
router.post('/characters/:id/roll', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    const roll = db.rollForCharacter({ characterId: req.params.id, user, request: body });
    // Natural 1s and 20s also go to the nat-rolls channel, in the background.
    require('./naturalRolls').announcePanelRoll(roll);
    return res.json(roll);
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Roll failed:', error);
      return res.status(500).json({ error: 'Could not roll.' });
    }
    return res.status(diceErrorStatus(error.message)).json({ error: error.message });
  }
});

router.get('/characters/:id/rolls', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ rolls: db.getCharacterRolls({ characterId: req.params.id, user, limit: req.query.limit }) });
  } catch (error) {
    return res.status(diceErrorStatus(error.message)).json({ error: error.message });
  }
});

// The player's key for the Owlbear Rodeo extension ({ regenerate: true } for a new one).
router.get('/vtt/key', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ key: db.getVttKey({ playerId: user.id }) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/vtt/key', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ key: db.getVttKey({ playerId: user.id, regenerate: true }) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// ─── Adventure table (running adventures) ───────────────────────────────────

function adventureErrorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'Adventure not found.' || message === 'Character not found.' || message === 'NPC not found.' || message === 'Encounter not found.') return 404;
  return 400;
}

function adventureRoute(handler) {
  return (req, res) => {
    const user = getSessionApiUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    try {
      return res.json(handler({ adventureId: Number(req.params.id), user, body }));
    } catch (error) {
      if (error instanceof TypeError) {
        console.error('Adventure action failed:', error);
        return res.status(500).json({ error: 'Could not update the adventure.' });
      }
      return res.status(adventureErrorStatus(error.message)).json({ error: error.message });
    }
  };
}

router.get('/adventures/:id/table', adventureRoute(({ adventureId, user }) => db.getAdventureTable({ adventureId, user })));

// ─── Auctions (db/auctions.js) ──────────────────────────────────────────────

function auctionError(res, error) {
  const status = /not found/i.test(error.message) ? 404 : /only|own/i.test(error.message) ? 403 : 400;
  return res.status(status).json({ error: error.message });
}

// Running and finished auctions, and the viewer's characters to bid or sell with.
router.get('/auctions', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { news, open, closed } = db.listAuctions();
  require('./auctionNews').postAuctionNews(news);
  const characters = Number(user.id) > 0
    ? db.prepare("SELECT id, name, gold_cp FROM characters WHERE player_id = ? AND status = 'alive' ORDER BY name").all(Number(user.id))
    : [];
  return res.json({ open, closed, characters, viewerId: Number(user.id), canManage: isAdmin(user), days: db.AUCTION_DAYS, commission: db.AUCTION_COMMISSION });
});

// The magic items one of your characters could sell.
router.get('/auctions/sellable/:characterId', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const character = db.prepare('SELECT player_id FROM characters WHERE id = ?').get(Number(req.params.characterId));
  if (!character) return res.status(404).json({ error: 'Character not found.' });
  if (!isAdmin(user) && character.player_id !== Number(user.id)) return res.status(403).json({ error: 'Forbidden.' });
  return res.json({ items: db.sellableItems(req.params.characterId) });
});

// { characterId, uid }: put one of a character's magic items up for auction.
router.post('/auctions', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const body = req.body || {};
    const auction = db.createAuction({ user, characterId: body.characterId, uid: String(body.uid || '') });
    require('./auctionNews').postAuctionNews([{ kind: 'listed', auctionId: auction.id, seller: auction.seller, item: auction.item, rarity: auction.rarity, openingBidCp: auction.openingBidCp, endsAt: auction.endsAt }]);
    return res.json({ auction });
  } catch (error) {
    return auctionError(res, error);
  }
});

// { characterId, amountGp }
router.post('/auctions/:id/bid', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const body = req.body || {};
    const amountCp = Math.round(Number(String(body.amountGp || '').replace(',', '.')) * 100);
    const auction = db.placeBid({ user, auctionId: req.params.id, characterId: body.characterId, amountCp });
    require('./auctionNews').postAuctionNews([{ kind: 'bid', auctionId: auction.id, item: auction.item, bidder: auction.highestBidder, amountCp: auction.currentBidCp }]);
    return res.json({ auction });
  } catch (error) {
    return auctionError(res, error);
  }
});

// DM test tools: an adventurer bids now, or the auction ends now.
router.post('/auctions/:id/test', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(user)) return res.status(403).json({ error: 'Only a DM can do that.' });
  try {
    const action = (req.body || {}).action;
    if (!['npcBid', 'endNow'].includes(action)) return res.status(400).json({ error: 'Unknown test action.' });
    const news = action === 'npcBid' ? db.forceNpcBid({ auctionId: req.params.id }) : db.endAuctionNow({ auctionId: req.params.id });
    require('./auctionNews').postAuctionNews(news);
    return res.json({ news, auction: db.getAuction(req.params.id) });
  } catch (error) {
    return auctionError(res, error);
  }
});

router.post('/auctions/:id/cancel', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ auction: db.cancelAuction({ user, auctionId: req.params.id }) });
  } catch (error) {
    return auctionError(res, error);
  }
});

// Character portraits: everyone logged in sees them; the owner or a DM uploads.
router.get('/characters/:id/portrait', (req, res) => {
  if (!getSessionApiUser(req)) return res.status(401).json({ error: 'Unauthorized' });
  const found = db.getCharacterPortraitFile(req.params.id);
  if (!found) return res.status(404).json({ error: 'No portrait.' });
  res.set({ 'Content-Type': found.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(found.file);
});

router.post('/characters/:id/portrait', express.raw({ type: () => true, limit: db.NPC_FILE_MAX_BYTES }), (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.saveCharacterPortrait({ characterId: req.params.id, user, buffer: req.body }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

router.delete('/characters/:id/portrait', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.removeCharacterPortrait({ characterId: req.params.id, user }));
  } catch (error) {
    return res.status(magicItemErrorStatus(error.message)).json({ error: error.message });
  }
});

// NPC portraits as uploaded (everyone logged in).
router.get('/npcs/:id/files/:kind', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const found = db.getNpcFile({ npcId: req.params.id, kind: req.params.kind });
  if (!found) return res.status(404).json({ error: 'No such file.' });
  res.set({ 'Content-Type': found.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  return res.sendFile(found.file);
});

// Admins upload a portrait as the raw request body (5 MB at most).
router.post('/npcs/:id/files/:kind', express.raw({ type: () => true, limit: db.NPC_FILE_MAX_BYTES }), (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(user)) return res.status(403).json({ error: 'Only a DM can upload NPC files.' });
  try {
    return res.json(db.saveNpcFile({ npcId: req.params.id, kind: req.params.kind, buffer: req.body }));
  } catch (error) {
    return res.status(error.message === 'NPC not found.' ? 404 : 400).json({ error: error.message });
  }
});

router.delete('/npcs/:id/files/:kind', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(user)) return res.status(403).json({ error: 'Only a DM can remove NPC files.' });
  try {
    return res.json(db.removeNpcFile({ npcId: req.params.id, kind: req.params.kind }));
  } catch (error) {
    return res.status(error.message === 'NPC not found.' ? 404 : 400).json({ error: error.message });
  }
});

// Notable NPCs on the table: { npcId, inAdventure }, and their HP: { action, amount }.
router.post('/adventures/:id/npcs', adventureRoute(({ adventureId, user, body }) =>
  db.setAdventureNpc({ adventureId, user, npcId: body.npcId, inAdventure: body.inAdventure !== false, hidden: Boolean(body.hidden) })));
router.post('/adventures/:id/npcs/:npcId/hp', (req, res) => adventureRoute(({ adventureId, user, body }) =>
  db.changeNpcHp({ adventureId, user, npcId: req.params.npcId, action: body.action, amount: body.amount }))(req, res));

// Server-Sent Events: a message whenever a party member, the party or the
// adventure changes, so the table reloads at once instead of waiting to poll.
// data: { characters: [ids], adventure: bool, rolls: bool }
router.get('/adventures/:id/live', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  let scope;
  try {
    scope = db.getAdventureLiveScope({ adventureId: Number(req.params.id), user });
  } catch (error) {
    return res.status(adventureErrorStatus(error.message)).json({ error: error.message });
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx: send each message straight away.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const unsubscribe = require('./liveUpdates').subscribe(changes => {
    const party = scope.characterIds();
    const characters = changes.filter(change => change.kind === 'character' && party.has(change.refId)).map(change => change.refId);
    const rolls = changes.some(change => change.kind === 'roll' && party.has(change.refId));
    const adventure = changes.some(change => change.kind === 'adventure' && change.refId === scope.adventureId);
    const npcIds = scope.npcIds();
    const npcs = changes.some(change => change.kind === 'npc' && npcIds.has(change.refId));
    if (characters.length || rolls || adventure || npcs) {
      res.write('data: ' + JSON.stringify({ characters, adventure, rolls, npcs }) + '\n\n');
    }
  });
  // Keeps proxies from closing a quiet connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return undefined;
});

// { characterId, inParty }
router.post('/adventures/:id/party', adventureRoute(({ adventureId, user, body }) =>
  db.setPartyMember({ adventureId, user, characterId: body.characterId, inParty: Boolean(body.inParty) })));

// Grimbrandt tags the Discord thread and has his say (in the background).
function announceAdventureEnd(adventureId) {
  require('./adventureThreads').announceAdventureEnd(adventureId)
    .catch(error => console.error('[ERROR] Announcing the end of an adventure:', error));
}

// Open, unlinked threads to tie a panel-made adventure to; { threadId } links one.
router.get('/adventures/:id/threads', async (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json({ threads: await require('./adventureThreads').unlinkedAdventureThreads({ adventureId: req.params.id, user }) });
  } catch (error) {
    return res.status(adventureErrorStatus(error.message)).json({ error: error.message });
  }
});

router.post('/adventures/:id/thread', async (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(await require('./adventureThreads').linkAdventureThread({ adventureId: req.params.id, user, threadId: (req.body || {}).threadId }));
  } catch (error) {
    return res.status(adventureErrorStatus(error.message)).json({ error: error.message });
  }
});

// An admin becomes this adventure's DM (recorded on the adventure).
router.post('/adventures/:id/takeover', adventureRoute(({ adventureId, user }) => db.takeOverAdventure({ adventureId, user })));

// { npcId, hidden } — show an NPC to the party, or keep it the DM's secret.
router.post('/adventures/:id/npcs/:npcId/hidden', (req, res) => adventureRoute(({ adventureId, user, body }) =>
  db.setAdventureNpcHidden({ adventureId, user, npcId: req.params.npcId, hidden: Boolean(body.hidden) }))(req, res));

// Encounters (the adventure's DM): plan them, run them, track HP and roll
// from the statblocks. The monster list is for the builder.
router.get('/adventures/:id/monsters', adventureRoute(({ adventureId, user }) => {
  const adventure = db.loadAdventureRow(adventureId);
  if (!db.canSeeAdventureSecrets(adventure, user)) throw new Error('Forbidden.');
  return { monsters: require('./rules').listMonsters().filter(monster => !monster.summon) };
}));
router.post('/adventures/:id/encounters', adventureRoute(({ adventureId, user, body }) => db.createEncounter({ adventureId, user, name: body.name })));
const encounterRoute = handler => (req, res) => adventureRoute(args => handler({ ...args, encounterId: req.params.encounterId, combatantId: req.params.combatantId }))(req, res);
router.post('/adventures/:id/encounters/:encounterId', encounterRoute(({ adventureId, user, body, encounterId }) =>
  db.updateEncounter({ adventureId, user, encounterId, name: body.name, notes: body.notes })));
router.post('/adventures/:id/encounters/:encounterId/delete', encounterRoute(({ adventureId, user, encounterId }) => db.deleteEncounter({ adventureId, user, encounterId })));
// { monster, count } or { npcId }
router.post('/adventures/:id/encounters/:encounterId/add', encounterRoute(({ adventureId, user, body, encounterId }) => (body.npcId
  ? db.addEncounterNpc({ adventureId, user, encounterId, npcId: body.npcId })
  : db.addEncounterMonster({ adventureId, user, encounterId, monster: body.monster, count: body.count }))));
router.post('/adventures/:id/encounters/:encounterId/run', encounterRoute(({ adventureId, user, encounterId }) => db.runEncounter({ adventureId, user, encounterId })));
router.post('/adventures/:id/encounters/:encounterId/end', encounterRoute(({ adventureId, user, encounterId }) => db.endEncounter({ adventureId, user, encounterId })));
router.post('/adventures/:id/encounters/:encounterId/initiative', encounterRoute(({ adventureId, user, encounterId }) => db.rollEncounterInitiative({ adventureId, user, encounterId })));
router.post('/adventures/:id/combatants/:combatantId/remove', encounterRoute(({ adventureId, user, combatantId }) => db.removeCombatant({ adventureId, user, combatantId })));
// { name, armorClass, hpMax, hpCurrent }: the DM's own name and numbers for a creature.
router.post('/adventures/:id/combatants/:combatantId', encounterRoute(({ adventureId, user, body, combatantId }) =>
  db.updateCombatant({ adventureId, user, combatantId, name: body.name, armorClass: body.armorClass, hpMax: body.hpMax, hpCurrent: body.hpCurrent })));
// { initiative } (empty clears it)
router.post('/adventures/:id/combatants/:combatantId/initiative', encounterRoute(({ adventureId, user, body, combatantId }) =>
  db.setCombatantInitiative({ adventureId, user, combatantId, initiative: body.initiative })));
// { action: damage | heal | tempHp, amount }
router.post('/adventures/:id/combatants/:combatantId/hp', encounterRoute(({ adventureId, user, body, combatantId }) =>
  db.changeCombatantHp({ adventureId, user, combatantId, action: body.action, amount: body.amount })));
// { roll, mode, critical }
router.post('/adventures/:id/combatants/:combatantId/roll', encounterRoute(({ adventureId, user, body, combatantId }) =>
  db.rollForCombatant({ adventureId, user, combatantId, request: body })));

// { npcId, text } — the DM speaks in the adventure's Discord thread.
router.post('/adventures/:id/message', async (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body || {};
  try {
    return res.json(await require('./adventureThreads').sayInAdventureThread({
      adventureId: req.params.id, user, npcId: body.npcId, text: body.text
    }));
  } catch (error) {
    return res.status(adventureErrorStatus(error.message)).json({ error: error.message });
  }
});

// { xp, dmCharacterId, notes, title }
router.post('/adventures/:id/finish', adventureRoute(({ adventureId, user, body }) => {
  const result = db.finishAdventure({ adventureId, user, xp: body.xp, dmCharacterId: body.dmCharacterId || null, notes: body.notes, title: body.title });
  announceAdventureEnd(adventureId);
  return result;
}));

router.post('/adventures/:id/cancel', adventureRoute(({ adventureId, user }) => {
  db.cancelAdventure({ adventureId, user });
  announceAdventureEnd(adventureId);
  return { cancelled: true };
}));

// Server-Sent Events for one character's sheet: a message whenever the
// character changes or rolls (e.g. the DM deals damage from the adventure
// table), so the sheet's HP, spells and items refresh at once.
// data: { character: bool, rolls: bool }
router.get('/characters/:id/live', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const character = db.getCharacterById(Number(req.params.id));
  if (!character) return res.status(404).json({ error: 'Character not found.' });
  if (!db.canRollFor(character, user)) return res.status(403).json({ error: 'Forbidden.' });
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx: send each message straight away.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const unsubscribe = require('./liveUpdates').subscribe(changes => {
    const changed = changes.some(change => change.kind === 'character' && change.refId === character.id);
    const rolls = changes.some(change => change.kind === 'roll' && change.refId === character.id);
    if (changed || rolls) res.write('data: ' + JSON.stringify({ character: changed, rolls }) + '\n\n');
  });
  // Keeps proxies from closing a quiet connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return undefined;
});

// What an adventure's DM may do to a party member's Hit Points.
const DM_VITALS_ACTIONS = ['damage', 'heal', 'tempHp', 'clearTempHp', 'setHp', 'resetHp', 'deathSave', 'stabilize', 'inspiration', 'revertWildShape', 'dismissStarryForm'];

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
      // The owner and admins; the DM of a running adventure with this character
      // in the party can change Hit Points from the adventure table.
      const ownsOrAdmin = isAdmin(user) || character.player_id === user.id;
      if (!ownsOrAdmin && !(DM_VITALS_ACTIONS.includes(body.action) && db.canRollFor(character, user))) {
        return { status: 403, error: 'Forbidden.' };
      }

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
    // Blessed Warrior (Paladin), Druidic Warrior (Ranger): instead of a Fighting Style feat.
    classFightingStyles: rules.CLASS_FIGHTING_STYLE_OPTIONS,
    // Choices from class features up to the starting level, and the subclass's at level 3.
    classFeatureChoices: Object.fromEntries(Object.keys(rules.ALL_CLASSES).map(name => [name,
      Array.from({ length: rules.STARTING_LEVEL }, (_, index) => rules.featuresAtLevel(name, null, index + 1)).flat()])),
    subclassFeatureChoices: Object.fromEntries(Object.entries(rules.DND_CLASSES_AND_SUBCLASSES).flatMap(([name, subclasses]) =>
      subclasses.map(subclass => [subclass, rules.featuresAtLevel(name, subclass, rules.STARTING_LEVEL).filter(feature => feature.source === subclass)]))),
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

// Resets an existing character to a new build from the creator (owner or admin).
router.post('/characters/:id/rebuild', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let character;
  try {
    character = buildCharacterFromBody(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const characterId = db.rebuildCharacter({ id: req.params.id, player_id: user.id, is_admin: isAdmin(user), character });
    return res.json({ success: true, characterId });
  } catch (error) {
    if (error.message === 'Forbidden.') return res.status(403).json({ error: error.message });
    if (error.message === 'Character not found.') return res.status(404).json({ error: error.message });
    if (error.message === 'Invalid character ID.') return res.status(400).json({ error: error.message });
    console.error('Character reset failed:', error);
    return res.status(500).json({ error: 'Could not reset the character.' });
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

// ─── Purses ─────────────────────────────────────────────────────────────────
// The owner or an admin edits a purse in gold, silver and copper; each change
// is logged and Grimbold notes it in the character's thread.

function goldErrorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'Character not found.') return 404;
  return 400;
}

router.get('/characters/:id/gold', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(db.getCharacterPurse({ characterId: req.params.id, user }));
  } catch (error) {
    return res.status(goldErrorStatus(error.message)).json({ error: error.message });
  }
});

// { gp, sp, cp, reason }
router.post('/characters/:id/gold', async (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  try {
    const change = db.setCharacterPurse({ characterId: req.params.id, user, coins: { gp: body.gp, sp: body.sp, cp: body.cp }, reason: body.reason });
    // Wait a moment for Grimbold's note, so the panel can say whether it went out.
    const threads = require('./characterThreads');
    const note = await threads.withinTime(threads.announceGoldChange(change));
    return res.json({ ...db.getCharacterPurse({ characterId: req.params.id, user }), formatted: formatCp(change.new_cp), note });
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Purse update failed:', error);
      return res.status(500).json({ error: 'Could not update the purse.' });
    }
    return res.status(goldErrorStatus(error.message)).json({ error: error.message });
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
    // Grimbold's receipt in the character's own thread.
    require('./characterThreads').announcePurchase(result, { buyerTag: player.discord_tag });
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
