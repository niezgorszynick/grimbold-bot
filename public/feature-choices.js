// public/feature-choices.js — Inputs for class and subclass feature choices
// (Divine Order, Expertise, Thieves' Cant, ...), shared by the character
// creator, the level-up panel and the sheet's "Class choices" card.
//
// A feature (from rules/featureChoices.js) is
//   { id, name, source, level, kind, count, options, grants }.
// FeatureChoices.widget(feature) returns { id, element, value() }; value() is
// what the server expects under picks[id], or null while incomplete.

(function () {
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

  const KIND_HINTS = {
    skills: count => 'Gain proficiency in ' + (count === 1 ? 'a skill' : count + ' skills') + '.',
    expertise: count => 'Expertise (double proficiency) in ' + (count === 1 ? 'a skill' : count + ' skills') + ' you are proficient in.',
    languages: count => 'Learn ' + (count === 1 ? 'a language' : count + ' languages') + '.',
    tools: count => 'Gain proficiency with ' + (count === 1 ? 'a tool' : count + ' tools') + '.'
  };

  function grantText(grants) {
    return [
      grants.skills.length ? 'Skills: ' + grants.skills.join(', ') : null,
      grants.tools.length ? 'Tools: ' + grants.tools.join(', ') : null,
      grants.languages.length ? 'Language: ' + grants.languages.join(', ') : null,
      grants.weapons.length ? grants.weapons.join(', ') : null,
      grants.armor.length ? grants.armor.join(', ') + ' training' : null
    ].filter(Boolean).join(' · ');
  }

  function widget(feature) {
    const title = el('strong', { text: feature.name });
    const where = el('span', { className: 'muted small', text: ' — ' + feature.source + ' level ' + feature.level });
    const box = el('div', { className: 'feature-choice', 'data-feature': feature.id }, [el('div', {}, [title, where])]);

    if (feature.kind === 'grant') {
      box.append(el('p', { className: 'muted small', text: 'Gained automatically. ' + grantText(feature.grants) }));
      return { id: feature.id, element: box, value: () => true, set: () => {} };
    }

    if (feature.kind === 'option') {
      const name = 'feature-' + feature.id.replace(/[^a-z0-9]+/gi, '-') + '-' + Math.random().toString(36).slice(2, 7);
      const radios = feature.options.map(option => {
        const input = el('input', { type: 'radio', name, value: option.name });
        box.append(el('label', { className: 'feature-option' }, [input, ' ', el('strong', { text: option.name }), el('span', { className: 'muted small', text: ' — ' + option.text })]));
        return input;
      });
      return {
        id: feature.id,
        element: box,
        value: () => { const checked = radios.find(input => input.checked); return checked ? checked.value : null; },
        set: value => radios.forEach(input => { input.checked = input.value === value; })
      };
    }

    box.append(el('p', { className: 'muted small', text: KIND_HINTS[feature.kind](feature.count) }));
    const selects = Array.from({ length: feature.count }, (_, index) => {
      const select = el('select', { 'aria-label': feature.name + ' choice ' + (index + 1) });
      select.append(new Option('-- Choose --', ''), ...feature.options.map(option => new Option(option, option)));
      return select;
    });
    box.append(el('div', { className: 'feature-selects' }, selects));
    return {
      id: feature.id,
      element: box,
      value: () => {
        const values = selects.map(select => select.value).filter(Boolean);
        return values.length === feature.count ? values : null;
      },
      set: values => selects.forEach((select, index) => {
        const value = Array.isArray(values) ? values[index] : '';
        if (value && feature.options.includes(value)) select.value = value;
      })
    };
  }

  // picks for every widget; incomplete ones are left out.
  function collect(widgets) {
    const picks = {};
    widgets.forEach(item => {
      const value = item.value();
      if (value !== null && value !== true) picks[item.id] = value;
    });
    return picks;
  }

  // Puts back earlier picks (by feature id) after the widgets were rebuilt.
  function restore(widgets, picks) {
    widgets.forEach(item => { if (picks && Object.hasOwn(picks, item.id)) item.set(picks[item.id]); });
  }

  window.FeatureChoices = { widget, collect, restore };
})();
