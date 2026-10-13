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

  function render(missing, message, isError) {
    if (!missing.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const widgets = missing.map(feature => window.FeatureChoices.widget(feature));
    const save = el('button', { type: 'button', className: 'btn btn-green', text: 'Save Choices' });
    const status = el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message || '' });
    root.replaceChildren(
      el('div', { className: 'sheet-section-heading' }, [el('h4', { text: 'Class Choices to Make' })]),
      el('p', { className: 'muted small', text: 'Your class gives you these choices, but they were never made for this character. Make them now; you can save them one at a time.' }),
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
          body: JSON.stringify({ picks: window.FeatureChoices.collect(widgets) })
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
    .then(({ ok, body }) => { if (ok) render(body.missing || []); })
    .catch(() => {});
})();
