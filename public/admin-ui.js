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
      if (table.refreshFilter) table.refreshFilter();
    });
  });

  document.querySelectorAll('table[data-filter]').forEach(setupTableFilter);
});

// Filter bar for long tables: <table id="…" data-filter="category,tier"
// data-filter-level data-page-size="50">. Rows carry data-search (lower-case
// text to search), one data-<field> per filter and data-level. Shows the first
// page of matches with "Show more"; the filters survive a page reload.
function setupTableFilter(table) {
  const tbody = table.querySelector('tbody');
  const fields = table.dataset.filter.split(',').map(field => field.trim()).filter(Boolean);
  const pageSize = Number(table.dataset.pageSize) || 50;
  const storageKey = 'table-filter:' + (table.id || location.pathname);
  const rows = () => Array.from(tbody.querySelectorAll('tr'));
  let limit = pageSize;

  const make = (tag, props) => Object.assign(document.createElement(tag), props || {});
  const bar = make('div', { className: 'table-filter' });
  const search = make('input', { type: 'search', placeholder: 'Search name, category or description…' });
  search.setAttribute('aria-label', 'Search the table');
  bar.appendChild(search);

  const selects = {};
  fields.forEach(field => {
    const values = [...new Set(rows().map(row => row.dataset[field]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const select = make('select');
    select.setAttribute('aria-label', 'Filter by ' + field);
    select.add(new Option('All ' + (field === 'category' ? 'categories' : field + 's'), ''));
    values.forEach(value => select.add(new Option(value, value)));
    selects[field] = select;
    bar.appendChild(select);
  });

  let level = null;
  if (table.hasAttribute('data-filter-level')) {
    level = make('input', { type: 'number', min: '1', max: '20', placeholder: 'Any' });
    level.setAttribute('aria-label', 'Up to level');
    const label = make('label', { className: 'table-filter-level', textContent: 'Up to level ' });
    label.appendChild(level);
    bar.appendChild(label);
  }

  const reset = make('button', { type: 'button', className: 'btn btn-small btn-secondary', textContent: 'Clear' });
  const count = make('span', { className: 'muted small table-filter-count' });
  bar.append(reset, count);
  table.parentNode.insertBefore(bar, table);

  const more = make('div', { className: 'table-filter-more' });
  const showMore = make('button', { type: 'button', className: 'btn btn-small' });
  const showAll = make('button', { type: 'button', className: 'btn btn-small btn-secondary', textContent: 'Show all' });
  more.append(showMore, showAll);
  table.parentNode.insertBefore(more, table.nextSibling);

  function save() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        search: search.value,
        level: level ? level.value : '',
        selects: Object.fromEntries(Object.entries(selects).map(([field, select]) => [field, select.value]))
      }));
    } catch {
      // Storage can be unavailable (private windows); filters then just reset.
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!saved) return;
      search.value = saved.search || '';
      if (level) level.value = saved.level || '';
      Object.entries(saved.selects || {}).forEach(([field, value]) => {
        if (selects[field] && [...selects[field].options].some(option => option.value === value)) selects[field].value = value;
      });
    } catch {
      // Ignore unreadable saved filters.
    }
  }

  function refresh() {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const maxLevel = level && level.value !== '' ? Number(level.value) : null;
    let matches = 0;
    rows().forEach(row => {
      const text = row.dataset.search || row.textContent.toLowerCase();
      const ok = words.every(word => text.includes(word)) &&
        Object.entries(selects).every(([field, select]) => !select.value || row.dataset[field] === select.value) &&
        (maxLevel === null || Number(row.dataset.level) <= maxLevel);
      if (ok) matches += 1;
      row.hidden = !ok || matches > limit;
    });
    const total = rows().length;
    const shown = Math.min(matches, limit);
    count.textContent = matches === total
      ? (shown < total ? 'Showing ' + shown + ' of ' + total : total + ' items')
      : matches + ' of ' + total + ' match' + (shown < matches ? ' · showing ' + shown : '');
    more.hidden = matches <= limit;
    showMore.textContent = 'Show ' + Math.min(pageSize, matches - limit) + ' more';
  }

  const changed = () => { limit = pageSize; save(); refresh(); };
  search.addEventListener('input', changed);
  Object.values(selects).forEach(select => select.addEventListener('change', changed));
  if (level) level.addEventListener('input', changed);
  reset.addEventListener('click', () => {
    search.value = '';
    if (level) level.value = '';
    Object.values(selects).forEach(select => { select.value = ''; });
    changed();
    search.focus();
  });
  showMore.addEventListener('click', () => { limit += pageSize; refresh(); });
  showAll.addEventListener('click', () => { limit = Infinity; refresh(); });

  table.refreshFilter = refresh;
  restore();
  refresh();
}
