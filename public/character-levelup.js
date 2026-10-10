// public/character-levelup.js — Guided level-up on the character sheet.
//
// Shows when the character has earned more levels (from adventure XP) than
// they have applied. The player picks a class and the choices that level
// needs; the server validates everything via /api/characters/:id/level-up.

(function () {
  const root = document.getElementById('cs_levelup');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  const CHOICE_LABELS = {
    subclass: 'Choose a subclass',
    abilityScoreImprovementOrFeat: 'Ability Score Improvement or feat',
    epicBoon: 'Epic Boon or feat',
    multiclassProficiencies: 'Multiclass proficiencies',
    fightingStyle: 'Fighting Style feat',
    cantrips: 'New cantrips',
    preparedSpells: 'More prepared spells'
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function selectBox(values, { placeholder, labels, disabledReasons } = {}) {
    const select = el('select');
    if (placeholder) select.add(new Option(placeholder, ''));
    values.forEach(value => {
      const reason = disabledReasons && disabledReasons[value];
      const option = new Option((labels ? labels(value) : value) + (reason ? ' — ' + reason : ''), value);
      option.disabled = Boolean(reason);
      select.add(option);
    });
    return select;
  }

  function field(label, control) {
    return el('label', { className: 'creator-field' }, [el('span', { text: label }), control]);
  }

  // Exactly `count` picks from `options`.
  function checkboxGroup(options, count, label) {
    const grid = el('div', { className: 'creator-choice-grid' });
    const status = el('small', { className: 'muted' });
    const inputs = options.map(option => {
      const input = el('input', { type: 'checkbox', value: option });
      grid.append(el('label', { className: 'creator-check' }, [input, el('span', { text: option })]));
      return input;
    });
    const value = () => inputs.filter(input => input.checked).map(input => input.value);
    const refresh = () => {
      const picked = value().length;
      inputs.forEach(input => { input.disabled = !input.checked && picked >= count; });
      status.textContent = label + ': ' + picked + ' / ' + count;
    };
    grid.addEventListener('change', refresh);
    refresh();
    return { element: el('div', { className: 'creator-choice' }, [status, grid]), value };
  }

  let data = null;
  let rulesData = null;
  let featTexts = {};
  let message = '';

  // Rules text for a feat, from the feats content file (if present), with
  // paragraphs, **bold** and *italic*.
  function featDescription(name) {
    const text = name && featTexts[name];
    if (!text) return null;
    const paragraphs = text.split(/\n{2,}/).map(block => {
      const p = el('p', { className: 'small' });
      block.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).forEach(part => {
        if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', { text: part.slice(2, -2) }));
        else if (/^\*[^*]+\*$/.test(part)) p.append(el('em', { text: part.slice(1, -1) }));
        else if (part) p.append(document.createTextNode(part));
      });
      return p;
    });
    return el('details', { className: 'feat-description', open: true }, [el('summary', { text: name }), ...paragraphs]);
  }

  async function loadFeatTexts() {
    try {
      const response = await fetch('/api/rules/feats');
      if (!response.ok) return;
      const result = await response.json();
      featTexts = Object.fromEntries((result.feats || []).map(feat => [feat.name, feat.description]));
    } catch {
      // Descriptions are optional; the level-up works without them.
    }
  }

  async function load() {
    try {
      const [optionsResponse, rulesResponse] = await Promise.all([
        fetch('/api/characters/' + characterId + '/level-up'),
        fetch('/api/rules/creation')
      ]);
      data = await optionsResponse.json();
      rulesData = await rulesResponse.json();
      if (!optionsResponse.ok) throw new Error(data.error || 'Could not load level-up options.');
      if (!rulesResponse.ok) throw new Error(rulesData.error || 'Could not load rules.');
      if (data.pendingLevels > 0) await loadFeatTexts();
    } catch (error) {
      root.hidden = false;
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
      return;
    }
    root.hidden = data.pendingLevels === 0;
    if (data.pendingLevels > 0) renderBanner();
  }

  function renderBanner() {
    const pending = data.pendingLevels;
    root.replaceChildren(
      el('div', { className: 'levelup-banner' }, [
        el('div', {}, [
          el('strong', { text: 'Level up available!' }),
          el('span', { className: 'muted', text: ' Level ' + data.currentLevel + ' → ' + (data.currentLevel + 1) +
            (pending > 1 ? ' (' + pending + ' levels waiting)' : '') })
        ]),
        el('button', { type: 'button', className: 'btn btn-gold', text: 'Level Up' })
      ])
    );
    root.querySelector('button').addEventListener('click', renderWizard);
  }

  function optionLabel(option) {
    return option.className + ' ' + option.classLevel + (option.isNewClass ? ' (new class)' : '') + ' · +' + option.hpGain + ' HP';
  }

  function renderWizard() {
    const own = data.options.filter(option => !option.isNewClass);
    const multiclass = data.options.filter(option => option.isNewClass);
    const classSelect = el('select');
    const addGroup = (label, options) => {
      if (!options.length) return;
      const group = el('optgroup', { label });
      options.forEach(option => group.append(new Option(optionLabel(option), option.className)));
      classSelect.append(group);
    };
    addGroup('Your classes', own);
    addGroup('Multiclass', multiclass);

    const detailBox = el('div', { className: 'levelup-details' });
    const status = el('p', { className: 'sheet-message', role: 'status', 'aria-live': 'polite', text: message });
    const confirm = el('button', { type: 'button', className: 'btn btn-green', text: 'Confirm Level Up' });
    const cancel = el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel' });
    let collect = () => ({});

    function renderOption() {
      const option = data.options.find(item => item.className === classSelect.value);
      const parts = [];
      const getters = {};

      parts.push(el('div', { className: 'species-traits' }, [
        el('p', {}, [el('strong', { text: 'Gains: ' }), option.features.length ? option.features.join(', ') : 'No new class features']),
        el('p', {}, [
          el('strong', { text: 'Hit Points: ' }), '+' + option.hpGain + ' (average rule)',
          ' · ', el('strong', { text: 'Proficiency Bonus: ' }), '+' + option.proficiencyBonus
        ]),
        option.spells.cantripsGained > 0 || option.spells.preparedGained > 0
          ? el('p', {}, [el('strong', { text: 'Spells: ' }),
            [option.spells.cantripsGained > 0 ? '+' + option.spells.cantripsGained + ' cantrips' : null,
              option.spells.preparedGained > 0 ? '+' + option.spells.preparedGained + ' prepared spells' : null].filter(Boolean).join(', ') +
            ' (chosen once spells are added to the sheet)'])
          : null,
        option.choices.length
          ? el('p', {}, [el('strong', { text: 'Choices: ' }), option.choices.map(choice => CHOICE_LABELS[choice] || choice).join(', ')])
          : null
      ]));

      if (option.subclassOptions) {
        const subclass = selectBox(option.subclassOptions, { placeholder: '-- Choose Subclass --' });
        parts.push(field(option.className + ' Subclass', subclass));
        getters.subclass = () => subclass.value;
      }

      if (option.fightingStyles) {
        const reasons = Object.fromEntries(option.fightingStyles.filter(s => s.unavailable).map(s => [s.name, s.unavailable]));
        const style = selectBox(option.fightingStyles.map(s => s.name), { placeholder: '-- Choose Fighting Style --', disabledReasons: reasons });
        const styleText = el('div');
        style.addEventListener('change', () => styleText.replaceChildren(featDescription(style.value) || ''));
        parts.push(el('h5', { text: 'Fighting Style' }), field('Fighting Style feat', style), styleText);
        getters.fightingStyle = () => style.value;
      }

      if (option.multiclassProficiencies) {
        const gains = option.multiclassProficiencies;
        const fixed = [].concat(gains.armor || [], gains.weapons || [], gains.tools || []);
        if (fixed.length) parts.push(el('p', { className: 'muted small', text: 'You gain: ' + fixed.join(', ') + '.' }));
        if (gains.skillChoices) {
          const known = new Set(data.knownSkills || []);
          const pool = (gains.skillChoices.options === 'class' ? option.classSkillOptions : rulesData.skills).filter(skill => !known.has(skill));
          const group = checkboxGroup(pool, gains.skillChoices.count, 'Skill');
          parts.push(group.element);
          getters.multiclassSkills = group.value;
        }
        if (gains.toolChoices) {
          const group = checkboxGroup(rulesData.toolCategories[gains.toolChoices.category], gains.toolChoices.count, 'Tool');
          parts.push(group.element);
          getters.multiclassTools = group.value;
        }
      }

      if (option.feats) {
        const improvement = renderImprovement(option);
        parts.push(improvement.element);
        getters.improvement = improvement.value;
      }

      detailBox.replaceChildren(...parts);
      collect = () => Object.fromEntries(Object.entries(getters).map(([key, get]) => [key, get()]));
    }

    classSelect.addEventListener('change', renderOption);
    renderOption();

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Applying level up...';
      try {
        const response = await fetch('/api/characters/' + characterId + '/level-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ className: classSelect.value }, collect()))
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not apply the level-up.');
        // Reload so the sheet, hit points and features all reflect the new level.
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('is-error');
        confirm.disabled = false;
      }
    });
    cancel.addEventListener('click', renderBanner);

    root.replaceChildren(el('div', { className: 'levelup-wizard' }, [
      el('h4', { text: 'Level ' + (data.currentLevel + 1) }),
      field('Class for this level', classSelect),
      data.unavailable.length
        ? el('details', { className: 'muted small' }, [
          el('summary', { text: 'Classes you cannot multiclass into yet' }),
          el('ul', {}, data.unavailable.map(item => el('li', { text: item.className + ': ' + item.reason })))
        ])
        : null,
      detailBox,
      el('div', { className: 'vitals-actions' }, [confirm, cancel]),
      status
    ]));
  }

  // ASI (+2 or +1/+1, max 20) or a feat the character qualifies for.
  function renderImprovement(option) {
    const scores = data.scores;
    const abilityLabel = ability => ABILITY_NAMES[ability] + ' (' + scores[ability] + ')';
    const typeSelect = el('select');
    typeSelect.add(new Option('Ability Score Improvement', 'asi'));
    typeSelect.add(new Option('Feat', 'feat'));
    const body = el('div', { className: 'creator-subchoice' });
    let read = () => ({});

    function renderAsi() {
      const mode = el('select');
      mode.add(new Option('+2 to one ability', 'two'));
      mode.add(new Option('+1 to two abilities', 'split'));
      const capped = gain => Object.fromEntries(Object.keys(scores).filter(a => scores[a] + gain > 20).map(a => [a, 'max 20']));
      const first = selectBox(Object.keys(scores), { placeholder: '-- Ability --', labels: abilityLabel, disabledReasons: capped(2) });
      const second = selectBox(Object.keys(scores), { placeholder: '-- Second ability --', labels: abilityLabel, disabledReasons: capped(1) });
      const secondField = field('Second ability (+1)', second);
      const firstField = field('Ability', first);
      const sync = () => {
        // .creator-field sets display: grid, which would override the hidden attribute.
        secondField.style.display = mode.value === 'split' ? '' : 'none';
        if (mode.value !== 'split') second.value = '';
        [...first.options].forEach(o => { if (o.value) o.disabled = Boolean(capped(mode.value === 'two' ? 2 : 1)[o.value]); });
      };
      mode.addEventListener('change', sync);
      sync();
      body.replaceChildren(el('div', { className: 'character-editor-fields' }, [field('Increase', mode), firstField, secondField]));
      read = () => {
        const increases = {};
        if (mode.value === 'two') {
          if (first.value) increases[first.value] = 2;
        } else {
          if (first.value) increases[first.value] = 1;
          if (second.value) increases[second.value] = (increases[second.value] || 0) + 1;
        }
        return { type: 'asi', increases };
      };
    }

    function renderFeat() {
      const feats = option.feats.filter(feat => feat.name !== 'Ability Score Improvement');
      const reasons = Object.fromEntries(feats.filter(f => f.unavailable).map(f => [f.name, f.unavailable]));
      const kindLabel = { general: 'General', origin: 'Origin', epicBoon: 'Epic Boon', fightingStyle: 'Fighting Style' };
      const featSelect = selectBox(feats.map(f => f.name), {
        placeholder: '-- Choose Feat --',
        labels: name => name + ' (' + kindLabel[feats.find(f => f.name === name).kind] + ')',
        disabledReasons: reasons
      });
      const extra = el('div');
      let readExtra = () => ({});
      featSelect.addEventListener('change', () => {
        const feat = feats.find(f => f.name === featSelect.value);
        const fields = [];
        const getters = {};
        if (feat && feat.abilityIncrease) {
          const allowed = feat.abilityIncrease === 'any' ? Object.keys(scores) : feat.abilityIncrease;
          const ability = selectBox(allowed, { placeholder: '-- Ability +1 --', labels: abilityLabel });
          fields.push(field('Ability increase', ability));
          getters.ability = () => ability.value;
        }
        if (feat && feat.skillExpert) {
          const known = data.knownSkills || [];
          const expert = data.knownExpertise || [];
          const newSkill = selectBox(rulesData.skills.filter(s => !known.includes(s)), { placeholder: '-- New skill proficiency --' });
          const expertise = el('select');
          const syncExpertise = () => {
            const previous = expertise.value;
            const pool = known.concat(newSkill.value ? [newSkill.value] : []).filter(s => !expert.includes(s)).sort();
            expertise.replaceChildren(new Option('-- Expertise skill --', ''), ...pool.map(s => new Option(s, s)));
            if (pool.includes(previous)) expertise.value = previous;
          };
          newSkill.addEventListener('change', syncExpertise);
          syncExpertise();
          fields.push(field('Skill proficiency', newSkill), field('Expertise', expertise));
          getters.skills = () => (newSkill.value ? [newSkill.value] : []);
          getters.expertise = () => (expertise.value ? [expertise.value] : []);
        }
        if (feat && feat.skillChoice) {
          const known = data.knownSkills || [];
          const expert = data.knownExpertise || [];
          const skill = selectBox(feat.skillChoice, {
            placeholder: '-- Skill --',
            labels: s => s + (known.includes(s) ? ' (gain Expertise)' : ''),
            disabledReasons: Object.fromEntries(feat.skillChoice.filter(s => expert.includes(s)).map(s => [s, 'already Expertise']))
          });
          fields.push(field('Skill proficiency or Expertise', skill));
          getters.skill = () => skill.value;
        }
        const origin = feat && rulesData.originFeats[feat.name];
        if (origin && origin.grants.spells) {
          const list = selectBox(origin.spellLists, { placeholder: '-- Spell list --' });
          const ability = selectBox(['int', 'wis', 'cha'], { placeholder: '-- Spellcasting ability --', labels: a => ABILITY_NAMES[a] });
          fields.push(field('Spell list', list), field('Spellcasting ability', ability));
          getters.spellList = () => list.value;
          getters.spellAbility = () => ability.value;
        }
        if (origin && origin.grants.toolChoices) {
          const group = checkboxGroup(rulesData.toolCategories[origin.grants.toolChoices.category], origin.grants.toolChoices.count, 'Tools');
          fields.push(group.element);
          getters.picks = group.value;
        }
        if (origin && origin.grants.skillOrToolChoices) {
          const group = checkboxGroup(rulesData.skills.concat(rulesData.toolCategories.any), origin.grants.skillOrToolChoices, 'Skills or tools');
          fields.push(group.element);
          getters.picks = group.value;
        }
        extra.replaceChildren(featDescription(feat && feat.name) || '', ...fields);
        readExtra = () => Object.fromEntries(Object.entries(getters).map(([key, get]) => [key, get()]));
      });
      body.replaceChildren(field('Feat', featSelect), extra);
      read = () => Object.assign({ type: 'feat', name: featSelect.value }, readExtra());
    }

    typeSelect.addEventListener('change', () => (typeSelect.value === 'asi' ? renderAsi() : renderFeat()));
    if (option.choices.includes('epicBoon')) {
      typeSelect.value = 'feat';
      renderFeat();
    } else {
      renderAsi();
    }
    return {
      element: el('div', {}, [el('h5', { text: option.choices.includes('epicBoon') ? 'Epic Boon' : 'Ability Score Improvement' }), field('Option', typeSelect), body]),
      value: () => read()
    };
  }

  load();
})();
