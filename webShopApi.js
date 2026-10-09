const express = require('express');
const db = require('./db');
const { formatCp } = require('./currency');
const {
  DND_DATA,
  validateCharacterOptions,
  validatePointBuy
} = require('./dndData');

const router = express.Router();

function getSessionPlayer(req) {
  const userId = req.session && req.session.user && req.session.user.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  return db.prepare(`
    SELECT id, discord_id, discord_tag
    FROM players
    WHERE id = ?
  `).get(userId) || null;
}

function getSessionApiUser(req) {
  const sessionUser = req.session && req.session.user;
  if (!sessionUser) return null;
  if (sessionUser.id === 0 && sessionUser.role === 'admin') {
    return { id: 0, role: 'admin' };
  }
  if (!Number.isSafeInteger(sessionUser.id) || sessionUser.id <= 0) return null;

  return db.prepare('SELECT id, role FROM players WHERE id = ?').get(sessionUser.id) || null;
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

  return res.json({ characters: db.getAliveCharactersByPlayerId(player.id) });
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
  if (user.role !== 'admin' && character.player_id !== user.id) {
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

  return res.json({ character, sheetData });
});

router.post('/characters/create', (req, res) => {
  const user = getSessionApiUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.id <= 0) return res.status(403).json({ error: 'A player account is required to create a character.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const {
    name,
    species,
    character_class,
    subclass,
    background,
    generationMethod,
    baseScores,
    backgroundBonuses
  } = body;
  if (
    typeof name !== 'string' || !name.trim() ||
    typeof species !== 'string' || !species.trim() ||
    typeof character_class !== 'string' || !character_class.trim()
  ) {
    return res.status(400).json({ error: 'Name, species, and class are required.' });
  }
  if (!['Point Buy', 'Standard Array', 'Manual/Rolled'].includes(generationMethod)) {
    return res.status(400).json({ error: 'Choose Point Buy, Standard Array, or Manual/Rolled.' });
  }

  let canonicalOptions;
  try {
    canonicalOptions = validateCharacterOptions(species, character_class, subclass || '');
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const abilityNames = DND_DATA.abilityScores;
  let finalAbilities;
  let generationData;
  if (generationMethod === 'Point Buy') {
    if (
      !backgroundBonuses ||
      typeof backgroundBonuses !== 'object' ||
      Array.isArray(backgroundBonuses) ||
      Object.keys(backgroundBonuses).some(ability => !abilityNames.includes(ability))
    ) {
      return res.status(400).json({ error: 'Background bonuses must be an ability-to-bonus object.' });
    }
    const normalizedBonuses = Object.fromEntries(abilityNames.map(ability => [
      ability,
      backgroundBonuses[ability] === undefined ? 0 : backgroundBonuses[ability]
    ]));
    try {
      const backgroundName = typeof background === 'string'
        ? Object.keys(DND_DATA.backgrounds).find(
          value => value.toLowerCase() === background.trim().toLowerCase()
        )
        : null;
      const bonusEntries = Object.entries(normalizedBonuses)
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1]);
      const bonusValues = bonusEntries.map(([, value]) => value);
      const bonusMode = bonusValues.length === 2 && bonusValues.includes(2) && bonusValues.includes(1)
        ? '2+1'
        : bonusValues.length === 3 && bonusValues.every(value => value === 1)
          ? '1+1+1'
          : '';
      const validated = validatePointBuy({
        baseScores,
        background: backgroundName,
        bonusMode,
        bonusAbilities: bonusEntries.map(([ability]) => ability)
      });
      abilityNames.forEach(ability => {
        if (
          !Number.isInteger(normalizedBonuses[ability]) ||
          normalizedBonuses[ability] < 0 ||
          normalizedBonuses[ability] > 2
        ) {
          throw new Error('Each background bonus must be a whole number from 0 to 2.');
        }
      });
      finalAbilities = Object.fromEntries(abilityNames.map(ability => [
        ability,
        {
          score: validated.abilities[ability],
          modifier: DND_DATA.getModifier(validated.abilities[ability])
        }
      ]));
      generationData = {
        pointBuy: {
          background: validated.background,
          bonusMode: validated.bonusMode,
          bonusAbilities: validated.bonusAbilities,
          baseScores: validated.baseScores,
          pointsSpent: validated.pointsSpent
        },
        backgroundBonuses: normalizedBonuses
      };
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  } else {
    if (!baseScores || typeof baseScores !== 'object' || Array.isArray(baseScores)) {
      return res.status(400).json({ error: 'Ability scores must be provided as an object.' });
    }
    const scores = Object.fromEntries(abilityNames.map(ability => [ability, baseScores[ability]]));
    if (generationMethod === 'Standard Array') {
      const validStandardArray = Object.values(scores).every(Number.isInteger) &&
        Object.values(scores).sort((a, b) => a - b).join(',') === '8,10,12,13,14,15';
      if (!validStandardArray) {
        return res.status(400).json({ error: 'Standard Array must use 15, 14, 13, 12, 10, and 8 once each.' });
      }
    } else if (Object.values(scores).some(score =>
      !Number.isInteger(score) || score < 1 || score > 30
    )) {
      return res.status(400).json({ error: 'Manual/Rolled ability scores must be whole numbers from 1 to 30.' });
    }
    finalAbilities = Object.fromEntries(abilityNames.map(ability => [
      ability,
      {
        score: scores[ability],
        modifier: DND_DATA.getModifier(scores[ability])
      }
    ]));
    generationData = { background: typeof background === 'string' ? background.trim() : '' };
  }

  const dexterityModifier = finalAbilities.dex.modifier;
  const classData = DND_DATA.classes[canonicalOptions.canonicalClass] ||
    DND_DATA.supplementalClasses[canonicalOptions.canonicalClass];
  const initialSheetData = {
    ...generationData,
    abilities: finalAbilities,
    generationMethod,
    armorClass: 10 + dexterityModifier,
    initiative: `${dexterityModifier >= 0 ? '+' : ''}${dexterityModifier}`,
    speed: `${DND_DATA.species[canonicalOptions.canonicalSpecies].speed} ft.`,
    hpMax: 20,
    hpCurrent: 20,
    hpTemp: 0,
    hitDice: `3${classData.hitDice.slice(1)}`,
    attacks: [],
    features: '',
    equipmentText: ''
  };
  const runTransaction = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO characters
        (player_id, name, race, class, subclass, level, xp, status, gold_gp, sheet_data)
      VALUES (?, ?, ?, ?, ?, 3, 0, 'alive', 0, ?)
    `).run(
      user.id,
      name.trim(),
      canonicalOptions.canonicalSpecies,
      canonicalOptions.canonicalClass,
      canonicalOptions.canonicalSubclass,
      JSON.stringify(initialSheetData)
    );
    db.prepare(`
      INSERT INTO character_classes
        (character_id, class_name, subclass_name, class_level, is_primary)
      VALUES (?, ?, ?, 3, 1)
    `).run(
      inserted.lastInsertRowid,
      canonicalOptions.canonicalClass,
      canonicalOptions.canonicalSubclass || null
    );
    return inserted.lastInsertRowid;
  });

  try {
    const characterId = runTransaction();
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
      if (user.role !== 'admin' && character.player_id !== user.id) {
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
      is_admin: user.role === 'admin',
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
  const user = req.session && req.session.user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. DM/Admin rights required.' });
  }

  if (user.id !== 0) {
    const admin = Number.isSafeInteger(user.id)
      ? db.prepare('SELECT role FROM players WHERE id = ?').get(user.id)
      : null;
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. DM/Admin rights required.' });
    }
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
      error.message === 'Gold amount must be non-negative and have no more than two decimal places.'
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
    const result = db.processWebPurchase({
      itemName: itemName.trim(),
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
    const clientErrorMessages = [
      "Character not found or doesn't belong to you.",
      'Item is not available in the shop.',
      'Invalid quantity.'
    ];
    if (
      clientErrorMessages.includes(error.message) ||
      error.message.startsWith('Insufficient stock.') ||
      error.message.startsWith('Insufficient funds.')
    ) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Web shop purchase failed:', error);
    return res.status(500).json({ error: 'Purchase failed.' });
  }
});

module.exports = router;
