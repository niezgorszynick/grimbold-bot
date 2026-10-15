// public/character-features.js — "Class choices" card on the character sheet:
// class and subclass choices the character never made (Divine Order,
// Expertise, Thieves' Cant, ...), for characters made before these were part
// of creation and level-ups. Hidden when nothing is missing.

(function () {
  const root = document.getElementById('cs_feature_choices');
  if (!root || !window.FeatureChoices) return;
  const characterId = Number(root.dataset.characterId);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  // A lineage (e.g. High Elf) and, if it gives spells, their spellcasting ability.
  function speciesWidget(species) {
    const option = document.createElement('select');
    option.setAttribute('aria-label', species.label);
    option.add(new Option('-- Choose --', ''));
    species.options.forEach(name => option.add(new Option(name, name)));
    if (species.current) option.value = species.current;
    let ability = null;
    const fields = [el('label', { className: 'weapon-field' }, [el('span', { className: 'muted small', text: species.label }), option])];
    if (species.spellAbilityChoice) {
      ability = document.createElement('select');
      ability.setAttribute('aria-label', 'Spellcasting ability');
      [['', '-- Choose --'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']].forEach(([value, label]) => ability.add(new Option(label, value)));
      fields.push(el('label', { className: 'weapon-field' }, [el('span', { className: 'muted small', text: 'Spellcasting ability for its spells' }), ability]));
    }
    return {
      element: el('div', { className: 'feature-choice' }, [
        el('div', {}, [el('strong', { text: species.label }), el('span', { className: 'muted small', text: ' — ' + species.species })]),
        el('div', { className: 'weapon-fields' }, fields)
      ]),
      value: () => (option.value ? { option: option.value, spellAbility: ability ? ability.value : undefined } : null)
    };
  }

  function render(missing, message, isError, species) {
    if (!missing.length && !species) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const speciesChoice = species ? speciesWidget(species) : null;
    const widgets = missing.map(feature => window.FeatureChoices.widget(feature));
    const save = el('button', { type: 'button', className: 'btn btn-green', text: 'Save Choices' });
    const status = el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message || '' });
    root.replaceChildren(
      el('div', { className: 'sheet-section-heading' }, [el('h4', { text: 'Class Choices to Make' })]),
      el('p', { className: 'muted small', text: 'Your class (and species) give you these choices, but they were never made for this character. Make them now; you can save them one at a time.' }),
      ...(speciesChoice ? [speciesChoice.element] : []),
      ...widgets.map(item => item.element),
      save,
      status
    );
    save.addEventListener('click', async () => {
      save.disabled = true;
      status.classList.remove('is-error');
      status.textContent = 'Saving...';
      try {
        const response = await fetch('/api/characters/' + characterId + '/feature-choices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ picks: window.FeatureChoices.collect(widgets), species: speciesChoice ? speciesChoice.value() : undefined })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save the choices.');
        // Skills, training and languages changed all over the sheet: reload it.
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('is-error');
        save.disabled = false;
      }
    });
  }

  fetch('/api/characters/' + characterId + '/feature-choices')
    .then(response => response.json().then(body => ({ ok: response.ok, body })))
    .then(({ ok, body }) => { if (ok) render(body.missing || [], '', false, body.species || null); })
    .catch(() => {});
})();
