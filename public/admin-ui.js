// public/admin-ui.js — Shared admin panel behaviour (sortable tables and other
// page-wide helpers), loaded at the end of every panel page.

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('character-search');
  const groups = document.querySelectorAll('.player-group');
  const badgesContainer = document.getElementById('selected-badges-container');
  const countDisplay = document.getElementById('selected-count');
  const characterCheckboxes = document.querySelectorAll('.char-checkbox');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      groups.forEach(group => {
        let hasVisibleCharacter = false;
        group.querySelectorAll('.char-item').forEach(item => {
          const matches = item.dataset.name.includes(query) || item.dataset.player.includes(query);
          item.style.display = matches ? '' : 'none';
          if (matches) hasVisibleCharacter = true;
        });
        group.style.display = hasVisibleCharacter ? '' : 'none';
      });
    });
  }

  function updateSelectedBadges() {
    const checked = document.querySelectorAll('.char-checkbox:checked');
    if (countDisplay) countDisplay.textContent = 'Selected: ' + checked.length;
    if (!badgesContainer) return;

    badgesContainer.replaceChildren();
    const partyLabel = document.createElement('span');
    partyLabel.style.cssText = 'color: #949ba4; font-size: 12px;';
    partyLabel.textContent = 'Party:';
    badgesContainer.appendChild(partyLabel);

    if (checked.length === 0) {
      const noneLabel = document.createElement('span');
      noneLabel.style.cssText = 'color: #949ba4; font-size: 12px; font-style: italic;';
      noneLabel.textContent = 'None';
      badgesContainer.appendChild(noneLabel);
      return;
    }

    checked.forEach(checkbox => {
      const item = checkbox.closest('.char-item');
      const name = item.querySelector('strong').textContent;
      const badge = document.createElement('span');
      badge.className = 'party-badge';
      badge.appendChild(document.createTextNode(name));

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', 'Remove ' + name);
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        checkbox.checked = false;
        updateSelectedBadges();
      });
      badge.appendChild(removeButton);
      badgesContainer.appendChild(badge);
    });
  }

  characterCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', updateSelectedBadges);
  });
  updateSelectedBadges();

  document.querySelectorAll('th.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const table = header.closest('table');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const index = Array.from(header.parentNode.children).indexOf(header);
      const isAscending = !header.classList.contains('sort-asc');

      header.parentNode.querySelectorAll('th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
      });
      header.classList.add(isAscending ? 'sort-asc' : 'sort-desc');

      rows.sort((rowA, rowB) => {
        const cellA = rowA.children[index];
        const cellB = rowB.children[index];
        if (!cellA || !cellB) return 0;

        const rawA = cellA.hasAttribute('data-sort') ? cellA.getAttribute('data-sort') : cellA.innerText.trim();
        const rawB = cellB.hasAttribute('data-sort') ? cellB.getAttribute('data-sort') : cellB.innerText.trim();

        const numA = Number(rawA);
        const numB = Number(rawB);

        if (!isNaN(numA) && !isNaN(numB)) {
          return isAscending ? numA - numB : numB - numA;
        }

        return isAscending 
          ? rawA.localeCompare(rawB, undefined, { numeric: true, sensitivity: 'base' })
          : rawB.localeCompare(rawA, undefined, { numeric: true, sensitivity: 'base' });
      });

      rows.forEach(row => tbody.appendChild(row));
    });
  });
});
