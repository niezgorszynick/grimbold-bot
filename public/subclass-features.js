// public/subclass-features.js — Fetches the text of the character's class and
// subclass features (rules/content/classes.md and subclasses.md, kept off Git)
// for the feature chips on the sheet: window.sheetFeatureTexts, announced with
// a "sheet-feature-texts" event. Features without text show as plain names.

(function () {
  const root = document.getElementById('cs_subclass_features');
  if (!root) return;
  const characterId = Number(root.dataset.characterId);
  fetch('/api/characters/' + characterId + '/subclass-features')
    .then(response => (response.ok ? response.json() : {}))
    .then(result => {
      window.sheetFeatureTexts = { classes: result.classes || [], subclasses: result.subclasses || [] };
      document.dispatchEvent(new CustomEvent('sheet-feature-texts'));
    })
    .catch(() => {});
})();
