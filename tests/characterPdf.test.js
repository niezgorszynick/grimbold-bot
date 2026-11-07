const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db, createPlayer } = require('./helpers/tempDatabase');
const rules = require('../rules');

const FIELDS = db.CHARACTER_SHEET_FIELDS;

function fighter(playerId) {
  return db.insertStartingCharacter(playerId, rules.buildStartingCharacter({
    name: 'Kael', species: 'Human', size: 'Medium', className: 'Fighter', subclass: 'Champion', fightingStyle: 'Great Weapon Fighting',
    background: 'Soldier', generationMethod: 'Standard Array',
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, backgroundBonuses: { str: 2, con: 1 },
    versatileFeat: { name: 'Alert' }, speciesSkills: ['Insight'], classSkills: ['Perception', 'Survival'],
    backgroundTool: 'Dice', languages: ['Dwarvish', 'Orc'], classEquipment: 'A', backgroundEquipment: 'A'
  }));
}

test('the sheet values come from what the panel works out', () => {
  const owner = createPlayer();
  const id = fighter(owner);
  const values = db.characterSheetValues(db.getCharacterById(id), { id: owner });
  assert.equal(values[FIELDS.name], 'Kael');
  assert.equal(values[FIELDS.className], 'Fighter');
  assert.equal(values[FIELDS.subclass], 'Champion');
  assert.equal(values[FIELDS.level], '3');
  assert.equal(values[FIELDS.proficiency], '+2');
  assert.equal(values[FIELDS.initiative], '+3', 'DEX +1 and Alert');
  const [strMod, strScore, strSaveBox, strSave] = FIELDS.abilities.str;
  assert.equal(values[strScore], '17');
  assert.equal(values[strMod], '+3');
  assert.equal(values[strSaveBox], true);
  assert.equal(values[strSave], '+5');
  const [athleticsBox, athletics] = FIELDS.skills.Athletics;
  assert.equal(values[athleticsBox], true);
  assert.equal(values[athletics], '+5');
  assert.equal(values[FIELDS.skills.Arcana[1]], '-1');
  assert.equal(values[FIELDS.passivePerception], '13');
  const [name, bonus, damage] = FIELDS.attacks[0];
  assert.equal(values[name], 'Greatsword');
  assert.equal(values[bonus], '+5');
  assert.equal(values[damage], '2d6+3 Slashing');
  assert.match(values[FIELDS.classFeatures[0]] + '\n' + values[FIELDS.classFeatures[1]], /Second Wind \(2 \/ Long Rest, 1 on Short\)/);
  assert.match(values[FIELDS.feats], /Alert/);
  assert.equal(values[FIELDS.armorTraining.Heavy], true);
  assert.match(values[FIELDS.languages], /Dwarvish/);
  assert.match(values[FIELDS.equipment], /Greatsword/);
});

test('only the owner or an admin may export, and the PDF is a filled form', async () => {
  const owner = createPlayer();
  const stranger = createPlayer();
  const admin = createPlayer('admin');
  const id = fighter(owner);
  const app = express();
  app.use((req, res, next) => { req.session = { user: { id: Number(req.get('x-user')) } }; next(); });
  app.use('/api', require('../webShopApi'));
  const server = app.listen(0);
  const get = userId => fetch(`http://127.0.0.1:${server.address().port}/api/characters/${id}/sheet.pdf`, { headers: { 'x-user': String(userId) } });
  try {
    assert.equal((await get(stranger)).status, 403);
    const response = await get(owner);
    if (!db.characterSheetTemplateAvailable()) {
      // The template is not in Git (Wizards of the Coast's PDF).
      assert.equal(response.status, 503);
      return;
    }
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /Kael\.pdf/);
    const { PDFDocument } = require('pdf-lib');
    const form = (await PDFDocument.load(await response.arrayBuffer())).getForm();
    assert.equal(form.getTextField(FIELDS.name).getText(), 'Kael');
    assert.equal(form.getCheckBox(FIELDS.skills.Athletics[0]).isChecked(), true);
    assert.equal(form.getCheckBox(FIELDS.skills.Arcana[0]).isChecked(), false);
    assert.equal((await get(admin)).status, 200);
  } finally {
    server.close();
  }
});
