// public/character-creator.js — D&D 2024 character creator for the admin panel.
//
// Renders every creation choice from /api/rules/creation, asks the server to
// validate the draft via /api/characters/preview for the live summary, and
// submits to /api/characters/create. All rules are enforced server-side.

(function () {
  const root = document.getElementById('character-creator-root');
  if (!root) return;

  const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  const SPELL_ABILITIES = ['int', 'wis', 'cha'];

  // ─── DOM helpers ───────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function selectBox(options, { placeholder, value, required, labels } = {}) {
    const select = el('select', { required });
    if (placeholder) select.add(new Option(placeholder, ''));
    options.forEach(option => select.add(new Option(labels ? labels(option) : option, option)));
    if (value !== undefined && options.includes(value)) select.value = value;
    return select;
  }

  function field(label, control, hint) {
    return el('label', { className: 'creator-field' }, [
      el('span', { text: label }),
      control,
      hint ? el('small', { className: 'muted', text: hint }) : null
    ]);
  }

  function section(title, intro) {
    const body = el('div', { className: 'creator-section-body' });
    const node = el('section', { className: 'creator-section' }, [
      el('h4', { text: title }),
      intro ? el('p', { className: 'muted small', text: intro }) : null,
      body
    ]);
    return { node, body };
  }

  // A checkbox group that allows exactly `count` picks. `locked` maps an option
  // to the reason it is already granted (shown checked and disabled).
  function checkboxGroup(options, count, { locked = {}, previous = [], label } = {}) {
    const inputs = [];
    const status = el('small', { className: 'muted' });
    const grid = el('div', { className: 'creator-choice-grid' });
    options.forEach(option => {
      const isLocked = Object.prototype.hasOwnProperty.call(locked, option);
      const input = el('input', { type: 'checkbox', value: option });
      input.checked = isLocked || previous.includes(option);
      input.disabled = isLocked;
      inputs.push({ input, isLocked });
      grid.append(el('label', { className: 'creator-check' + (isLocked ? ' is-locked' : '') }, [
        input,
        el('span', { text: option }),
        isLocked ? el('small', { className: 'muted', text: '(' + locked[option] + ')' }) : null
      ]));
    });
    function selected() {
      return inputs.filter(item => !item.isLocked && item.input.checked).map(item => item.input.value);
    }
    function refresh() {
      const picked = selected().length;
      inputs.forEach(item => {
        if (!item.isLocked) item.input.disabled = !item.input.checked && picked >= count;
      });
      status.textContent = (label || 'Choose') + ': ' + picked + ' / ' + count + ' selected';
    }
    // Drop stale picks beyond the allowed count (e.g. after switching class).
    const extra = selected().slice(count);
    inputs.forEach(item => { if (extra.includes(item.input.value)) item.input.checked = false; });
    grid.addEventListener('change', refresh);
    refresh();
    return { element: el('div', { className: 'creator-choice' }, [status, grid]), value: selected };
  }

  function itemLabel(item) {
    const name = item.fromToolChoice ? item.name + ' (your tool choice)' : item.choose ? item.name + ' (choose)' : item.name;
    return item.quantity > 1 ? name + ' ×' + item.quantity : name;
  }

  function signed(value) {
    return (value >= 0 ? '+' : '') + value;
  }

  // ─── Main ──────────────────────────────────────────────────────────────────
  async function init() {
    root.textContent = 'Loading character rules...';
    let R;
    try {
      const response = await fetch('/api/rules/creation');
      R = await response.json();
      if (!response.ok) throw new Error(R.error || 'Could not load character rules.');
    } catch (error) {
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
      return;
    }

    const categoryOptions = category => [].concat(category).flatMap(key => R.toolCategories[key] || []);
    const widgets = {};

    const form = el('form', { className: 'character-creator', novalidate: true });
    const nameInput = el('input', { type: 'text', maxlength: '100', required: true });

    // ── Class ──
    const classSection = section('1. Class', 'Characters start at level ' + R.startingLevel + ', so a subclass is required.');
    const classSelect = selectBox(Object.keys(R.classes), { placeholder: '-- Choose Class --', required: true });
    const subclassSelect = selectBox([], { placeholder: '-- Choose Subclass --', required: true });
    const classDetails = el('div', { className: 'species-traits' });
    const classSkillsBox = el('div');
    const classToolsBox = el('div');
    const classEquipmentBox = el('div');
    classSection.body.append(
      el('div', { className: 'character-editor-fields' }, [field('Class', classSelect), field('Subclass', subclassSelect)]),
      classDetails, classSkillsBox, classToolsBox, classEquipmentBox
    );

    // ── Background ──
    const backgroundSection = section('2. Background', 'Your background grants ability increases, an Origin feat, two skills, a tool, and starting equipment.');
    const backgroundSelect = selectBox(Object.keys(R.backgrounds), { placeholder: '-- Choose Background --', required: true });
    const backgroundDetails = el('div', { className: 'species-traits' });
    const backgroundToolBox = el('div');
    const backgroundFeatBox = el('div');
    const backgroundEquipmentBox = el('div');
    backgroundSection.body.append(field('Background', backgroundSelect), backgroundDetails, backgroundToolBox, backgroundFeatBox, backgroundEquipmentBox);

    // ── Species ──
    const speciesSection = section('3. Species');
    const speciesSelect = selectBox(Object.keys(R.species), { placeholder: '-- Choose Species --', required: true });
    const speciesDetails = el('div', { className: 'species-traits' });
    const speciesChoicesBox = el('div');
    const versatileBox = el('div');
    speciesSection.body.append(field('Species', speciesSelect), speciesDetails, speciesChoicesBox, versatileBox);

    // ── Languages ──
    const languageSection = section('4. Languages', 'You know Common plus ' + R.languageChoices + ' standard languages of your choice.');
    widgets.languages = checkboxGroup(R.languages, R.languageChoices, { label: 'Languages' });
    languageSection.body.append(widgets.languages.element);

    // ── Ability scores ──
    const abilitySection = section('5. Ability Scores', 'Your background increases one score by 2 and another by 1, or three scores by 1, whichever generation method you use. No score can exceed 20.');
    const methodSelect = selectBox(R.generationMethods, { value: 'Point Buy' });
    const suggestionButton = el('button', { type: 'button', className: 'btn btn-small', text: 'Use class suggestion (Standard Array)' });
    const pointsDisplay = el('p', { className: 'muted small', 'aria-live': 'polite' });
    const scoreGrid = el('div', { className: 'character-creation-score-grid' });
    const scoreInputs = {};
    const bonusSelects = {};
    const finalScores = {};
    R.abilities.forEach(ability => {
      scoreInputs[ability] = el('input', { type: 'number', min: '8', max: '15', value: '8', 'aria-label': ABILITY_NAMES[ability] + ' base score' });
      bonusSelects[ability] = selectBox(['0', '1', '2'], { labels: value => '+' + value });
      bonusSelects[ability].setAttribute('aria-label', ABILITY_NAMES[ability] + ' background bonus');
      finalScores[ability] = el('strong', { className: 'creator-final-score' });
      scoreGrid.append(el('div', { className: 'creator-score' }, [
        el('span', { text: ability.toUpperCase() }),
        scoreInputs[ability],
        bonusSelects[ability],
        finalScores[ability]
      ]));
    });
    abilitySection.body.append(
      el('div', { className: 'character-editor-fields' }, [field('Method', methodSelect), el('div', { className: 'creator-field' }, [el('span', { text: ' ' }), suggestionButton])]),
      pointsDisplay,
      el('p', { className: 'muted small', text: 'Each column: base score, background bonus, final score.' }),
      scoreGrid
    );

    // ── Equipment choices and summary ──
    const choiceSection = section('6. Equipment Choices');
    const equipmentChoicesBox = el('div');
    choiceSection.body.append(equipmentChoicesBox);

    const summarySection = section('Summary');
    const summaryBox = el('div', { className: 'creator-summary', 'aria-live': 'polite' });
    summarySection.body.append(summaryBox);

    const submitButton = el('button', { type: 'submit', className: 'btn btn-green', text: 'Create Character' });
    const message = el('p', { className: 'sheet-message', role: 'status', 'aria-live': 'polite' });

    form.append(
      field('Character Name', nameInput),
      classSection.node, backgroundSection.node, speciesSection.node,
      languageSection.node, abilitySection.node, choiceSection.node, summarySection.node,
      submitButton, message
    );
    root.replaceChildren(form);

    // ─── Section renderers ─────────────────────────────────────────────────
    function grantedSkills() {
      const granted = {};
      const background = R.backgrounds[backgroundSelect.value];
      if (background) background.skillProficiencies.forEach(skill => { granted[skill] = backgroundSelect.value; });
      const species = R.species[speciesSelect.value];
      if (species && species.skillProficiencies) species.skillProficiencies.forEach(skill => { granted[skill] = speciesSelect.value; });
      return granted;
    }

    function packageList(pack) {
      if (!pack.items.length) return el('span', { text: pack.gp + ' GP' });
      return el('span', { text: pack.items.map(itemLabel).join(', ') + (pack.gp ? ', ' + pack.gp + ' GP' : '') });
    }

    function equipmentRadios(name, packages, previous) {
      const group = el('fieldset', { className: 'creator-equipment' });
      const selected = packages[previous] ? previous : Object.keys(packages)[0];
      Object.entries(packages).forEach(([option, pack]) => {
        const radio = el('input', { type: 'radio', name, value: option });
        radio.checked = option === selected;
        group.append(el('label', { className: 'creator-check' }, [radio, el('strong', { text: option + ': ' }), packageList(pack)]));
      });
      return group;
    }

    function renderClass() {
      const className = classSelect.value;
      const data = R.classes[className];
      const previousSubclass = subclassSelect.value;
      subclassSelect.replaceChildren(new Option('-- Choose Subclass --', ''));
      (R.subclasses[className] || []).forEach(subclass => subclassSelect.add(new Option(subclass, subclass)));
      if ((R.subclasses[className] || []).includes(previousSubclass)) subclassSelect.value = previousSubclass;

      if (!data) {
        classDetails.replaceChildren();
        classSkillsBox.replaceChildren();
        classToolsBox.replaceChildren();
        classEquipmentBox.replaceChildren();
        widgets.classSkills = widgets.classTools = null;
        return;
      }
      const features = Object.entries(data.featuresByLevel)
        .map(([level, names]) => 'Level ' + level + ': ' + names.join(', '));
      classDetails.replaceChildren(
        el('p', {}, [el('strong', { text: 'Hit Die: ' }), 'd' + data.hitDie, ' · ', el('strong', { text: 'Saves: ' }), data.savingThrows.map(a => a.toUpperCase()).join(', ')]),
        el('p', {}, [el('strong', { text: 'Armor: ' }), data.armorTraining.join(', ') || 'None', ' · ', el('strong', { text: 'Weapons: ' }), data.weaponProficiencies.join(', ')]),
        el('ul', {}, features.map(text => el('li', { text })))
      );
      renderClassSkills();

      const previousTools = widgets.classTools ? widgets.classTools.value() : [];
      const toolChoice = data.toolProficiencies.choose;
      if (toolChoice) {
        widgets.classTools = checkboxGroup(categoryOptions(toolChoice.category), toolChoice.count, { previous: previousTools, label: className + ' tools' });
        classToolsBox.replaceChildren(el('h5', { text: 'Tool Proficiencies' }), widgets.classTools.element);
      } else {
        widgets.classTools = null;
        classToolsBox.replaceChildren();
      }

      const previousEquipment = (form.querySelector('[name="classEquipment"]:checked') || {}).value;
      classEquipmentBox.replaceChildren(el('h5', { text: 'Starting Equipment' }), equipmentRadios('classEquipment', data.startingEquipment, previousEquipment));
    }

    function renderClassSkills() {
      const data = R.classes[classSelect.value];
      if (!data) return;
      const options = data.skillChoices.options === 'any' ? R.skills : data.skillChoices.options;
      const previous = widgets.classSkills ? widgets.classSkills.value() : [];
      const granted = grantedSkills();
      const locked = {};
      options.forEach(skill => { if (granted[skill]) locked[skill] = granted[skill]; });
      widgets.classSkills = checkboxGroup(options, data.skillChoices.count, { locked, previous, label: 'Class skills' });
      classSkillsBox.replaceChildren(el('h5', { text: 'Skill Proficiencies' }), widgets.classSkills.element);
    }

    // Choices for one Origin feat. fixedSpellList comes from the background (e.g. Sage → Wizard).
    function featChoices(featName, fixedSpellList, previous) {
      const feat = R.originFeats[featName];
      const parts = [];
      const getters = {};
      if (!feat) return { element: el('div'), value: () => ({}) };
      if (feat.grants.spells) {
        if (!fixedSpellList) {
          const list = selectBox(feat.spellLists, { placeholder: '-- Spell list --', value: previous.spellList });
          parts.push(field('Spell list', list));
          getters.spellList = () => list.value;
        }
        const ability = selectBox(SPELL_ABILITIES, { placeholder: '-- Ability --', value: previous.spellAbility, labels: a => ABILITY_NAMES[a] });
        parts.push(field('Spellcasting ability', ability, 'You will pick the cantrips and spell once spells are added to the sheet.'));
        getters.spellAbility = () => ability.value;
      }
      if (feat.grants.toolChoices) {
        const group = checkboxGroup(categoryOptions(feat.grants.toolChoices.category), feat.grants.toolChoices.count, { previous: previous.picks || [], label: featName + ' tools' });
        parts.push(group.element);
        getters.picks = group.value;
      }
      if (feat.grants.skillOrToolChoices) {
        const group = checkboxGroup(R.skills.concat(R.toolCategories.any), feat.grants.skillOrToolChoices, { previous: previous.picks || [], label: featName + ' skills or tools' });
        parts.push(group.element);
        getters.picks = group.value;
      }
      return {
        element: el('div', { className: 'creator-subchoice' }, parts),
        value: () => Object.fromEntries(Object.entries(getters).map(([key, get]) => [key, get()]))
      };
    }

    function renderBackground() {
      const name = backgroundSelect.value;
      const data = R.backgrounds[name];
      const previousTool = widgets.backgroundTool ? widgets.backgroundTool.value : '';
      const previousFeat = widgets.backgroundFeat ? widgets.backgroundFeat.value() : {};
      if (!data) {
        [backgroundDetails, backgroundToolBox, backgroundFeatBox, backgroundEquipmentBox].forEach(box => box.replaceChildren());
        widgets.backgroundTool = widgets.backgroundFeat = null;
        renderBonuses();
        return;
      }
      const featLabel = data.originFeat.name + (data.originFeat.spellList ? ' (' + data.originFeat.spellList + ')' : '');
      const toolLabel = typeof data.toolProficiency === 'string' ? data.toolProficiency : 'one of your choice';
      backgroundDetails.replaceChildren(
        el('p', {}, [el('strong', { text: 'Ability Scores: ' }), data.abilityBoosts.map(a => ABILITY_NAMES[a]).join(', ')]),
        el('p', {}, [el('strong', { text: 'Origin Feat: ' }), featLabel]),
        el('p', {}, [el('strong', { text: 'Skills: ' }), data.skillProficiencies.join(', '), ' · ', el('strong', { text: 'Tool: ' }), toolLabel])
      );

      if (typeof data.toolProficiency === 'object') {
        widgets.backgroundTool = selectBox(categoryOptions(data.toolProficiency.choose), { placeholder: '-- Choose Tool --', value: previousTool });
        backgroundToolBox.replaceChildren(field('Tool Proficiency', widgets.backgroundTool));
      } else {
        widgets.backgroundTool = null;
        backgroundToolBox.replaceChildren();
      }

      widgets.backgroundFeat = featChoices(data.originFeat.name, data.originFeat.spellList, previousFeat);
      backgroundFeatBox.replaceChildren(el('h5', { text: featLabel + ' choices' }), widgets.backgroundFeat.element);

      const previousEquipment = (form.querySelector('[name="backgroundEquipment"]:checked') || {}).value;
      backgroundEquipmentBox.replaceChildren(el('h5', { text: 'Background Equipment' }), equipmentRadios('backgroundEquipment', data.equipmentOptions, previousEquipment));
      renderBonuses();
    }

    function renderSpecies() {
      const name = speciesSelect.value;
      const data = R.species[name];
      const previous = {
        size: widgets.size ? widgets.size.value : undefined,
        option: widgets.speciesOption ? widgets.speciesOption.value : undefined,
        ability: widgets.speciesAbility ? widgets.speciesAbility.value : undefined,
        skills: widgets.speciesSkills ? widgets.speciesSkills.value() : []
      };
      widgets.size = widgets.speciesOption = widgets.speciesAbility = widgets.speciesSkills = null;
      if (!data) {
        [speciesDetails, speciesChoicesBox, versatileBox].forEach(box => box.replaceChildren());
        widgets.versatile = null;
        return;
      }
      speciesDetails.replaceChildren(
        el('p', {}, [el('strong', { text: 'Size: ' }), data.size, ' · ', el('strong', { text: 'Speed: ' }), data.speed + ' ft.']),
        el('ul', {}, data.traits.map(trait => el('li', {}, [el('strong', { text: trait.name }), ' — ' + trait.description])))
      );

      const parts = [];
      const sizes = R.sizeOptions[name] || [];
      if (sizes.length > 1) {
        widgets.size = selectBox(sizes, { placeholder: '-- Size --', value: previous.size });
        parts.push(field('Size', widgets.size));
      }
      const option = R.speciesOptions[name];
      if (option) {
        widgets.speciesOption = selectBox(option.options, { placeholder: '-- Choose --', value: previous.option });
        parts.push(field(option.label, widgets.speciesOption));
        if (option.spellAbilityChoice) {
          widgets.speciesAbility = selectBox(SPELL_ABILITIES, { placeholder: '-- Ability --', value: previous.ability, labels: a => ABILITY_NAMES[a] });
          parts.push(field(option.label + ' spellcasting ability', widgets.speciesAbility));
        }
      }
      if (data.skillChoiceCount) {
        const options = data.skillChoiceOptions || R.skills;
        widgets.speciesSkills = checkboxGroup(options, data.skillChoiceCount, { previous: previous.skills, label: name + ' skill' });
        parts.push(el('h5', { text: name + ' Skill Proficiency' }), widgets.speciesSkills.element);
      }
      speciesChoicesBox.replaceChildren(...(parts.length ? [el('div', { className: 'character-editor-fields' }, parts.filter(p => p.tagName === 'LABEL')), ...parts.filter(p => p.tagName !== 'LABEL')] : []));
      renderVersatile();
    }

    function renderVersatile() {
      if (speciesSelect.value !== 'Human') {
        widgets.versatile = null;
        versatileBox.replaceChildren();
        return;
      }
      const previousName = widgets.versatile ? widgets.versatile.select.value : '';
      const previousChoices = widgets.versatile ? widgets.versatile.choices.value() : {};
      const select = selectBox(Object.keys(R.originFeats), { placeholder: '-- Choose Origin Feat --', value: previousName });
      const choicesBox = el('div');
      widgets.versatile = { select, choices: { value: () => ({}) } };
      function renderChoices() {
        widgets.versatile.choices = featChoices(select.value, null, select.value === previousName ? previousChoices : {});
        choicesBox.replaceChildren(widgets.versatile.choices.element);
      }
      select.addEventListener('change', renderChoices);
      renderChoices();
      versatileBox.replaceChildren(el('h5', { text: 'Versatile: Origin Feat' }), field('Origin feat', select), choicesBox);
    }

    function renderBonuses() {
      const background = R.backgrounds[backgroundSelect.value];
      const allowed = background ? background.abilityBoosts : [];
      R.abilities.forEach(ability => {
        bonusSelects[ability].disabled = !allowed.includes(ability);
        if (bonusSelects[ability].disabled) bonusSelects[ability].value = '0';
      });
      renderScores();
    }

    function renderScores() {
      const method = methodSelect.value;
      const [min, max] = method === 'Point Buy' ? [8, 15] : method === 'Standard Array' ? [8, 15] : [3, 18];
      let spent = 0;
      R.abilities.forEach(ability => {
        const input = scoreInputs[ability];
        input.min = String(min);
        input.max = String(max);
        const base = Number(input.value);
        const total = base + Number(bonusSelects[ability].value);
        spent += R.pointBuyCosts[base] === undefined ? Infinity : R.pointBuyCosts[base];
        finalScores[ability].textContent = Number.isFinite(total) ? total + ' (' + signed(Math.floor((total - 10) / 2)) + ')' : '—';
      });
      pointsDisplay.textContent = method === 'Point Buy'
        ? (Number.isFinite(spent) ? 'Point Buy: ' + (R.totalPointBuyPoints - spent) + ' of ' + R.totalPointBuyPoints + ' points remaining.' : 'Point Buy scores must be between 8 and 15.')
        : method === 'Standard Array'
          ? 'Assign ' + R.standardArray.join(', ') + ' once each.'
          : 'Enter rolled scores (4d6, drop the lowest): 3 to 18.';
    }

    // Selects for equipment items marked "choose" (e.g. a Bard's instrument).
    function renderEquipmentChoices() {
      const previous = Object.fromEntries(Object.entries(widgets.equipmentChoices || {}).map(([key, select]) => [key, select.value]));
      const packs = [];
      const classData = R.classes[classSelect.value];
      const classOption = (form.querySelector('[name="classEquipment"]:checked') || {}).value;
      if (classData && classData.startingEquipment[classOption]) packs.push(classData.startingEquipment[classOption]);
      const background = R.backgrounds[backgroundSelect.value];
      const backgroundOption = (form.querySelector('[name="backgroundEquipment"]:checked') || {}).value;
      if (background && background.equipmentOptions[backgroundOption]) packs.push(background.equipmentOptions[backgroundOption]);

      widgets.equipmentChoices = {};
      const fields = [];
      packs.flatMap(pack => pack.items).filter(item => item.choose).forEach(item => {
        if (widgets.equipmentChoices[item.choose]) return;
        const select = selectBox(categoryOptions(item.choose), { placeholder: '-- Choose --', value: previous[item.choose] });
        widgets.equipmentChoices[item.choose] = select;
        fields.push(field(item.name, select));
      });
      equipmentChoicesBox.replaceChildren(fields.length
        ? el('div', { className: 'character-editor-fields' }, fields)
        : el('p', { className: 'muted small', text: 'Nothing to choose for your selected equipment.' }));
      choiceSection.node.hidden = fields.length === 0;
    }

    // ─── Request, preview and submit ───────────────────────────────────────
    function buildRequest() {
      const value = widget => (widget ? widget.value : undefined);
      return {
        name: nameInput.value,
        className: classSelect.value,
        subclass: subclassSelect.value,
        background: backgroundSelect.value,
        species: speciesSelect.value,
        size: value(widgets.size),
        speciesOption: value(widgets.speciesOption),
        speciesSpellAbility: value(widgets.speciesAbility),
        speciesSkills: widgets.speciesSkills ? widgets.speciesSkills.value() : [],
        classSkills: widgets.classSkills ? widgets.classSkills.value() : [],
        classTools: widgets.classTools ? widgets.classTools.value() : [],
        backgroundTool: value(widgets.backgroundTool),
        originFeatChoices: widgets.backgroundFeat ? widgets.backgroundFeat.value() : {},
        versatileFeat: widgets.versatile
          ? Object.assign({ name: widgets.versatile.select.value }, widgets.versatile.choices.value())
          : undefined,
        languages: widgets.languages.value(),
        generationMethod: methodSelect.value,
        baseScores: Object.fromEntries(R.abilities.map(ability => [ability, Number(scoreInputs[ability].value)])),
        backgroundBonuses: Object.fromEntries(R.abilities.map(ability => [ability, Number(bonusSelects[ability].value)])),
        classEquipment: (form.querySelector('[name="classEquipment"]:checked') || {}).value,
        backgroundEquipment: (form.querySelector('[name="backgroundEquipment"]:checked') || {}).value,
        equipmentChoices: Object.fromEntries(Object.entries(widgets.equipmentChoices || {}).map(([key, select]) => [key, select.value]))
      };
    }

    function summaryRow(label, value) {
      return el('div', {}, [el('dt', { text: label }), el('dd', { text: value || '—' })]);
    }

    function renderSummary(character) {
      const sheet = character.sheetData;
      const slots = sheet.spellSlots.slots.length
        ? sheet.spellSlots.slots.map((count, index) => 'L' + (index + 1) + '×' + count).join(', ')
        : '';
      const pact = sheet.spellSlots.pact ? sheet.spellSlots.pact.count + ' × level ' + sheet.spellSlots.pact.slotLevel + ' (Pact Magic)' : '';
      const pending = [];
      if (sheet.pendingChoices.cantrips) pending.push(sheet.pendingChoices.cantrips + ' cantrips');
      if (sheet.pendingChoices.preparedSpells) pending.push(sheet.pendingChoices.preparedSpells + ' prepared spells');
      summaryBox.replaceChildren(
        el('p', {}, [el('strong', { text: character.name || 'Unnamed' }), ' — Level ' + character.level + ' ' + character.species + ' ' + character.className + ' (' + character.subclass + '), ' + sheet.background]),
        el('dl', { className: 'character-sheet-details creator-summary-grid' }, [
          summaryRow('Hit Points', String(sheet.hpMax)),
          summaryRow('Armor Class', sheet.armorClass + ' (' + sheet.armorClassSource + ')'),
          summaryRow('Initiative', sheet.initiative),
          summaryRow('Speed', sheet.speed),
          summaryRow('Hit Dice', sheet.hitDice),
          summaryRow('Gold', character.goldGp + ' GP'),
          summaryRow('Abilities', R.abilities.map(a => a.toUpperCase() + ' ' + sheet.abilities[a].score).join(' · ')),
          summaryRow('Saving Throws', sheet.savingProficiencies.map(a => a.toUpperCase()).join(', ')),
          summaryRow('Skills', sheet.skillProficiencies.join(', ')),
          summaryRow('Tools', sheet.toolProficiencies.join(', ')),
          summaryRow('Languages', sheet.languages.join(', ')),
          summaryRow('Origin Feats', sheet.originFeats.map(feat => feat.name + (feat.spellList ? ' (' + feat.spellList + ')' : '')).join(', ')),
          summaryRow('Spell Slots', [slots, pact].filter(Boolean).join('; ')),
          summaryRow('Spells to choose', pending.join(', ')),
          summaryRow('Equipment', sheet.inventory.map(item => item.quantity > 1 ? item.name + ' ×' + item.quantity : item.name).join(', '))
        ])
      );
    }

    let previewTimer = null;
    let previewSequence = 0;
    function schedulePreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(runPreview, 350);
    }

    async function runPreview() {
      const sequence = ++previewSequence;
      try {
        const response = await fetch('/api/characters/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequest())
        });
        const result = await response.json();
        if (sequence !== previewSequence) return;
        if (!response.ok) {
          summaryBox.replaceChildren(el('p', { className: 'muted', text: 'Still to do: ' + (result.error || 'complete the choices above.') }));
          submitButton.disabled = true;
          return;
        }
        renderSummary(result.character);
        submitButton.disabled = false;
      } catch (error) {
        if (sequence === previewSequence) summaryBox.replaceChildren(el('p', { className: 'muted', text: 'Could not preview the character.' }));
      }
    }

    // ─── Wiring ────────────────────────────────────────────────────────────
    classSelect.addEventListener('change', () => { renderClass(); renderEquipmentChoices(); });
    backgroundSelect.addEventListener('change', () => { renderBackground(); renderClassSkills(); renderEquipmentChoices(); });
    speciesSelect.addEventListener('change', () => { renderSpecies(); renderClassSkills(); });
    methodSelect.addEventListener('change', renderScores);
    scoreGrid.addEventListener('input', renderScores);
    scoreGrid.addEventListener('change', renderScores);
    form.addEventListener('change', event => {
      if (event.target.name === 'classEquipment' || event.target.name === 'backgroundEquipment') renderEquipmentChoices();
    });
    form.addEventListener('input', schedulePreview);
    form.addEventListener('change', schedulePreview);
    suggestionButton.addEventListener('click', () => {
      const suggestion = R.standardArraySuggestions[classSelect.value];
      if (!suggestion) {
        message.textContent = 'Choose a class first to use its suggested scores.';
        return;
      }
      methodSelect.value = 'Standard Array';
      R.abilities.forEach(ability => { scoreInputs[ability].value = suggestion[ability]; });
      renderScores();
      schedulePreview();
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      submitButton.disabled = true;
      message.classList.remove('is-error');
      message.textContent = 'Creating character...';
      try {
        const response = await fetch('/api/characters/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequest())
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not create character.');
        window.location.href = '/admin?tab=character-sheet&edit_char=' + result.characterId;
      } catch (error) {
        message.textContent = error.message;
        message.classList.add('is-error');
        submitButton.disabled = false;
      }
    });

    renderClass();
    renderBackground();
    renderSpecies();
    renderEquipmentChoices();
    submitButton.disabled = true;
    schedulePreview();
  }

  init();
})();
