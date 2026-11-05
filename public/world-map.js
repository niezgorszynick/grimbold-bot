// public/world-map.js — The Map tab: the world map image with its hex grid
// ("column.row", columns 1, 3, 5… sitting half a hex higher), zoom and drag,
// and a side panel for the clicked hex. Players see the hexes their characters
// visited clearly and the rest dimmed, with the markers DMs have shown there.
// DMs see everything and have tools: markers, an adventure's route (revealed
// to its party), revealing a hex to one character, looking as a player, and
// the image and grid settings.

(function () {
  const root = document.getElementById('world-map');
  if (!root) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const SQ3 = Math.sqrt(3);
  const ICON_NAMES = { site: '▽ Site', town: '◉ Town', city: '◎ City', camp: '△ Camp', danger: '✕ Danger', star: '★ Point of interest' };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else if (key === 'onchange') node.addEventListener('change', value);
      else if (key === 'oninput') node.addEventListener('input', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).flat().forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  function svgEl(tag, attrs, children) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
    });
    [].concat(children || []).forEach(child => { if (child) node.append(child); });
    return node;
  }
  const button = (text, onclick, className = 'btn btn-small', extra = {}) => el('button', Object.assign({ type: 'button', className, text, onclick }, extra));
  const remember = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* no storage */ } return null; };

  let data = null;
  let message = '';
  let isError = false;
  let selected = null;          // "col.row"
  let mode = 'look';            // look | route | reveal
  let routeId = null;
  let characterId = null;
  let editingMarker = null;     // a marker's id, or 'new'
  let asPlayer = null;
  let gridDraft = null;         // the grid being lined up (settings open)
  let showGrid = remember('grimbold-map-grid') === 'on';
  let image = { url: null, width: 0, height: 0, fogUrl: null };
  let view = null;              // the visible part of the map: { x, y, w, h } in image pixels

  // ─── Geometry ─────────────────────────────────────────────────────────
  const grid = () => gridDraft || data.grid;
  function centre(col, row, g = grid()) {
    return { x: g.originX + (col - 1) * 1.5 * g.size, y: g.originY + (row - 1) * SQ3 * g.size + (col % 2 === 0 ? SQ3 * g.size / 2 : 0) };
  }
  function corners(hex, g = grid()) {
    const [col, row] = hex.split('.').map(Number);
    const c = centre(col, row, g);
    return [0, 1, 2, 3, 4, 5].map(i => {
      const angle = Math.PI / 3 * i;
      return (c.x + g.size * Math.cos(angle)).toFixed(1) + ',' + (c.y + g.size * Math.sin(angle)).toFixed(1);
    }).join(' ');
  }
  function allHexes(g = grid()) {
    const list = [];
    for (let col = 1; col <= g.cols; col += 1) for (let row = 1; row <= g.rows; row += 1) list.push(col + '.' + row);
    return list;
  }
  // The hex under an image point: the nearest centre, if inside it.
  function hexAt(x, y) {
    const g = grid();
    let best = null;
    let bestDistance = Infinity;
    allHexes(g).forEach(hex => {
      const [col, row] = hex.split('.').map(Number);
      const c = centre(col, row, g);
      const distance = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = hex; }
    });
    return best && Math.sqrt(bestDistance) <= g.size ? best : null;
  }
  function mapSize() {
    if (image.width) return { width: image.width, height: image.height };
    const g = grid();
    return { width: g.originX + (g.cols - 1) * 1.5 * g.size + g.size * 2, height: g.originY + g.rows * SQ3 * g.size + g.size };
  }

  // ─── Loading ──────────────────────────────────────────────────────────
  async function api(path, body, raw) {
    const query = asPlayer ? (path.includes('?') ? '&' : '?') + 'asPlayer=' + asPlayer : '';
    const response = await fetch('/api/map' + path + query, {
      method: body ? 'POST' : 'GET',
      headers: body && !raw ? { 'Content-Type': 'application/json' } : (raw ? { 'Content-Type': body.type || 'application/octet-stream' } : {}),
      body: body ? (raw ? body : JSON.stringify(body)) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the map.');
    return result;
  }
  async function act(path, body, done, raw) {
    try {
      data = await api(path, body, raw);
      message = done || '';
      isError = false;
      await loadImage();
    } catch (error) {
      message = error.message;
      isError = true;
    }
    render();
  }

  // The image's size, and a dimmed, blurred copy for the fog (made once).
  function loadImage() {
    if (!data.imageUrl || data.imageUrl === image.url) return Promise.resolve();
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        image = { url: data.imageUrl, width: img.naturalWidth, height: img.naturalHeight, fogUrl: null };
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 1600 / img.naturalWidth);
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const context = canvas.getContext('2d');
          if ('filter' in context) {
            context.filter = 'blur(' + Math.round(9 * scale) + 'px) grayscale(0.6) brightness(0.4)';
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            image.fogUrl = canvas.toDataURL('image/jpeg', 0.8);
          }
        } catch { /* the SVG filter below does it instead */ }
        resolve();
      };
      img.onerror = () => { image = { url: null, width: 0, height: 0, fogUrl: null }; resolve(); };
      img.src = data.imageUrl;
    });
  }

  async function load() {
    try {
      data = await api('');
      await loadImage();
    } catch (error) {
      root.replaceChildren(el('p', { className: 'alert red', text: error.message }));
      return;
    }
    render();
  }

  // ─── The map ──────────────────────────────────────────────────────────
  let svg = null;
  function fit() {
    const size = mapSize();
    view = { x: 0, y: 0, w: size.width, h: size.height };
  }
  function applyView() {
    if (svg) svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(n => n.toFixed(1)).join(' '));
  }
  function zoom(factor, centreX, centreY) {
    const size = mapSize();
    const w = Math.max(size.width / 12, Math.min(size.width * 1.5, view.w * factor));
    const ratio = w / view.w;
    const cx = centreX === undefined ? view.x + view.w / 2 : centreX;
    const cy = centreY === undefined ? view.y + view.h / 2 : centreY;
    view = { x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio, w, h: view.h * ratio };
    applyView();
  }
  function toImage(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function markerShape(icon, x, y, r) {
    const ring = { fill: '#1e1f22', stroke: '#efe3c0', 'stroke-width': r * 0.22 };
    if (icon === 'town') return [svgEl('circle', { cx: x, cy: y, r, ...ring }), svgEl('circle', { cx: x, cy: y, r: r * 0.38, fill: '#efe3c0' })];
    if (icon === 'city') return [svgEl('circle', { cx: x, cy: y, r: r * 1.25, ...ring }), svgEl('circle', { cx: x, cy: y, r: r * 0.7, fill: 'none', stroke: '#efe3c0', 'stroke-width': r * 0.18 }), svgEl('circle', { cx: x, cy: y, r: r * 0.3, fill: '#efe3c0' })];
    if (icon === 'danger') return [svgEl('circle', { cx: x, cy: y, r, ...ring }), svgEl('path', { d: `M${x - r * 0.45},${y - r * 0.45}L${x + r * 0.45},${y + r * 0.45}M${x + r * 0.45},${y - r * 0.45}L${x - r * 0.45},${y + r * 0.45}`, stroke: '#f26d6d', 'stroke-width': r * 0.25, 'stroke-linecap': 'round' })];
    if (icon === 'star') {
      const points = [];
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 ? r * 0.5 : r * 1.15;
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        points.push((x + radius * Math.cos(angle)).toFixed(1) + ',' + (y + radius * Math.sin(angle)).toFixed(1));
      }
      return [svgEl('polygon', { points: points.join(' '), ...ring, fill: '#d4af37', stroke: '#1e1f22' })];
    }
    const up = icon === 'camp' ? -1 : 1;
    return [svgEl('polygon', { points: `${x - r},${y - r * 0.75 * up} ${x + r},${y - r * 0.75 * up} ${x},${y + r * 0.95 * up}`, ...ring, 'stroke-linejoin': 'round' })];
  }

  // A player starts on the hexes they know (a few hexes around them).
  function focusRevealed() {
    const g = grid();
    const points = data.revealed.map(hex => { const [col, row] = hex.split('.').map(Number); return centre(col, row, g); });
    const pad = g.size * 4;
    const minX = Math.min(...points.map(p => p.x)) - pad;
    const minY = Math.min(...points.map(p => p.y)) - pad;
    view = { x: minX, y: minY, w: Math.max(...points.map(p => p.x)) + pad - minX, h: Math.max(...points.map(p => p.y)) + pad - minY };
  }

  function mapSvg() {
    const size = mapSize();
    if (!view) {
      if (Array.isArray(data.revealed) && data.revealed.length) focusRevealed();
      else fit();
    }
    const g = grid();
    svg = svgEl('svg', { class: 'world-map-svg', role: 'img', 'aria-label': 'World map', preserveAspectRatio: 'xMidYMid meet' });
    applyView();
    const fogged = data.revealed !== null && data.revealed !== undefined;
    const defs = svgEl('defs', {}, [
      svgEl('filter', { id: 'wm-fog', x: '-5%', y: '-5%', width: '110%', height: '110%' }, [
        svgEl('feGaussianBlur', { stdDeviation: '9' }),
        svgEl('feColorMatrix', { type: 'matrix', values: '0.2 0.15 0.05 0 0  0.12 0.22 0.06 0 0  0.1 0.12 0.2 0 0  0 0 0 1 0' })
      ]),
      svgEl('clipPath', { id: 'wm-revealed' }, fogged ? data.revealed.map(hex => svgEl('polygon', { points: corners(hex, g) })) : [])
    ]);
    svg.append(defs);
    svg.append(svgEl('rect', { x: 0, y: 0, width: size.width, height: size.height, fill: '#15171a' }));
    if (image.url) {
      if (fogged) {
        svg.append(image.fogUrl
          ? svgEl('image', { href: image.fogUrl, x: 0, y: 0, width: size.width, height: size.height, preserveAspectRatio: 'none' })
          : svgEl('image', { href: image.url, x: 0, y: 0, width: size.width, height: size.height, filter: 'url(#wm-fog)' }));
        svg.append(svgEl('image', { href: image.url, x: 0, y: 0, width: size.width, height: size.height, 'clip-path': 'url(#wm-revealed)' }));
      } else {
        svg.append(svgEl('image', { href: image.url, x: 0, y: 0, width: size.width, height: size.height }));
      }
    }
    // Our grid: while lining it up, when asked for, or with no image.
    if (gridDraft || showGrid || !image.url) {
      svg.append(svgEl('g', { class: 'wm-grid' + (gridDraft ? ' is-draft' : '') }, allHexes(g).map(hex => svgEl('polygon', { points: corners(hex, g) }))));
      if (gridDraft || !image.url) {
        svg.append(svgEl('g', { class: 'wm-labels' }, allHexes(g).map(hex => {
          const [col, row] = hex.split('.').map(Number);
          const c = centre(col, row, g);
          const label = svgEl('text', { x: c.x, y: c.y + g.size * 0.15, 'font-size': g.size * 0.38, 'text-anchor': 'middle' });
          label.textContent = hex;
          return label;
        })));
      }
    }
    // Highlights for the tool in use.
    let marked = [];
    let markClass = '';
    if (mode === 'route') {
      const route = (data.routes || []).find(entry => entry.id === routeId);
      marked = route ? route.hexes : [];
      markClass = 'wm-route';
    } else if (mode === 'reveal') {
      const character = (data.characters || []).find(entry => entry.id === characterId);
      marked = character ? character.hexes : [];
      markClass = 'wm-reveal';
    }
    if (marked.length) svg.append(svgEl('g', { class: markClass }, marked.map(hex => svgEl('polygon', { points: corners(hex, g) }))));
    // Markers (several in one hex sit side by side).
    const byHex = new Map();
    data.markers.forEach(marker => { if (!byHex.has(marker.hex)) byHex.set(marker.hex, []); byHex.get(marker.hex).push(marker); });
    const markerLayer = svgEl('g', { class: 'wm-markers' });
    byHex.forEach((list, hex) => {
      const [col, row] = hex.split('.').map(Number);
      const c = centre(col, row, g);
      const r = g.size * 0.26;
      list.forEach((marker, index) => {
        const x = c.x + (index - (list.length - 1) / 2) * r * 2.5;
        const group = svgEl('g', { class: 'wm-marker' + (marker.secret ? ' is-secret' : '') }, markerShape(marker.icon, x, c.y, r));
        const title = svgEl('title');
        title.textContent = marker.name + (marker.secret ? ' (secret)' : '');
        group.append(title);
        markerLayer.append(group);
      });
    });
    svg.append(markerLayer);
    if (selected) svg.append(svgEl('polygon', { class: 'wm-selected', points: corners(selected, g) }));
    wireMap(svg);
    return svg;
  }

  // Drag to move, wheel or pinch to zoom, click (without dragging) to pick a hex.
  function wireMap(node) {
    const pointers = new Map();
    let moved = 0;
    let pinch = null;
    node.addEventListener('wheel', event => {
      event.preventDefault();
      const point = toImage(event);
      zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, point.x, point.y);
    }, { passive: false });
    node.addEventListener('pointerdown', event => {
      try { node.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    node.addEventListener('pointermove', event => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const now = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, now);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const middle = toImage({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        zoom(pinch / distance, middle.x, middle.y);
        pinch = distance;
        moved += 10;
        return;
      }
      const scale = view.w / node.clientWidth;
      moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
      view.x -= (now.x - last.x) * scale;
      view.y -= (now.y - last.y) * scale;
      applyView();
    });
    const release = event => {
      const wasClick = pointers.size === 1 && moved < 6;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasClick && event.type === 'pointerup') pickHex(hexAt(toImage(event).x, toImage(event).y));
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
  }

  function pickHex(hex) {
    if (!hex) return;
    if (mode === 'route' && routeId) {
      const route = data.routes.find(entry => entry.id === routeId);
      const on = !route.hexes.includes(hex);
      selected = hex;
      act('/adventures/' + routeId + '/hexes', { hex, on }, (on ? hex + ' added to ' : hex + ' taken off ') + route.title + "'s route.");
      return;
    }
    if (mode === 'reveal' && characterId) {
      const character = data.characters.find(entry => entry.id === characterId);
      const on = !character.hexes.includes(hex);
      selected = hex;
      act('/characters/' + characterId + '/hexes', { hex, on }, (on ? hex + ' revealed to ' : hex + ' hidden again from ') + character.name + '.');
      return;
    }
    selected = selected === hex ? null : hex;
    editingMarker = null;
    render();
  }

  // ─── The side panel ───────────────────────────────────────────────────
  function hexPanel() {
    if (!selected) return el('p', { className: 'muted small', text: data.dm ? 'Click a hex to see or add markers.' : 'Click a hex to see what you know about it.' });
    const markers = data.markers.filter(marker => marker.hex === selected);
    const known = !data.revealed || data.revealed.includes(selected);
    const visits = (data.visits || []).filter(visit => visit.hex === selected);
    return el('div', { className: 'wm-hex' }, [
      el('h4', { text: 'Hex ' + selected }),
      !known ? el('p', { className: 'muted small', text: 'Not explored yet.' }) : null,
      visits.length ? el('ul', { className: 'small wm-visits' }, visits.map(visit => el('li', {
        text: (visit.character || 'You (as DM)') + (visit.via ? ' · ' + visit.via : ' · revealed by a DM')
      }))) : null,
      markers.length ? el('ul', { className: 'wm-marker-list' }, markers.map(marker => el('li', {}, [
        el('strong', { text: (ICON_NAMES[marker.icon] || '').split(' ')[0] + ' ' + marker.name }),
        data.dm ? el('span', { className: 'tag' + (marker.secret ? '' : ' green'), text: marker.secret ? 'secret' : 'shown' }) : null,
        data.dm && marker.adventure ? el('span', { className: 'muted small', text: ' · ' + marker.adventure }) : null,
        marker.note ? el('p', { className: 'small', text: marker.note }) : null,
        data.dm ? el('span', {}, [
          button('Edit', () => { editingMarker = marker.id; render(); }, 'link-button small'), ' ',
          button('Delete', () => { if (window.confirm('Delete the marker ' + marker.name + '?')) act('/markers/' + marker.id + '/delete', {}, marker.name + ' deleted.'); }, 'link-button small')
        ]) : null
      ]))) : (known ? el('p', { className: 'muted small', text: 'No markers here.' }) : null),
      data.dm ? (editingMarker ? markerForm() : button('+ Marker here', () => { editingMarker = 'new'; render(); }, 'btn btn-small btn-green')) : null
    ]);
  }

  function markerForm() {
    const marker = editingMarker === 'new' ? { hex: selected, name: '', icon: 'site', note: '', adventureId: null, secret: true } : data.markers.find(entry => entry.id === editingMarker);
    if (!marker) return null;
    const name = el('input', { type: 'text', maxlength: '80', value: marker.name, placeholder: 'Name', 'aria-label': 'Marker name' });
    const icon = el('select', { 'aria-label': 'Icon' }, data.icons.map(key => el('option', { value: key, text: ICON_NAMES[key] || key, selected: key === marker.icon })));
    const note = el('textarea', { rows: '3', maxlength: '1000', placeholder: 'Note (players see it when shown)', 'aria-label': 'Note' });
    note.value = marker.note || '';
    const adventure = el('select', { 'aria-label': 'Adventure' }, [el('option', { value: '', text: 'No adventure' }),
      ...(data.routes || []).map(entry => el('option', { value: String(entry.id), text: entry.title + (entry.status === 'active' ? ' (running)' : ''), selected: entry.id === marker.adventureId }))]);
    const shown = el('input', { type: 'checkbox', checked: !marker.secret });
    const save = () => {
      const body = { hex: selected, name: name.value, icon: icon.value, note: note.value, adventureId: adventure.value ? Number(adventure.value) : null, secret: !shown.checked };
      editingMarker = null;
      act(marker.id ? '/markers/' + marker.id : '/markers', body, 'Marker saved.');
    };
    return el('div', { className: 'wm-form' }, [
      name, icon, note, adventure,
      el('label', { className: 'small' }, [shown, " Shown to players who've been here"]),
      el('div', {}, [button('Save', save, 'btn btn-small btn-green'), ' ', button('Cancel', () => { editingMarker = null; render(); }, 'btn btn-small btn-secondary')])
    ]);
  }

  function toolsPanel() {
    const routes = data.routes || [];
    if (!data.dm && !routes.length) return null;
    const modeButton = (key, text) => button(text, () => { mode = key; render(); }, 'btn btn-small' + (mode === key ? '' : ' btn-secondary'));
    const routeSelect = el('select', { 'aria-label': 'Adventure', onchange: event => { routeId = Number(event.target.value) || null; render(); } }, [
      el('option', { value: '', text: 'Pick an adventure…' }),
      ...routes.map(entry => el('option', { value: String(entry.id), text: entry.title + ' (' + entry.hexes.length + ')', selected: entry.id === routeId }))]);
    const characterSelect = data.dm ? el('select', { 'aria-label': 'Character', onchange: event => { characterId = Number(event.target.value) || null; render(); } }, [
      el('option', { value: '', text: 'Pick a character…' }),
      ...data.characters.map(entry => el('option', { value: String(entry.id), text: entry.name + ' (' + entry.player + ')', selected: entry.id === characterId }))]) : null;
    return el('div', { className: 'wm-tools' }, [
      el('div', { className: 'wm-modes' }, [modeButton('look', '🔍 Look'), modeButton('route', '🧭 Adventure route'), data.dm ? modeButton('reveal', '👁 Reveal to a character') : null]),
      mode === 'route' ? el('div', {}, [routeSelect, el('p', { className: 'muted small', text: 'Click hexes to add them to the route or take them off. Everyone in the party sees them, and anyone added to the party later.' })]) : null,
      mode === 'reveal' && characterSelect ? el('div', {}, [characterSelect, el('p', { className: 'muted small', text: 'Click hexes to reveal them to this character (or hide them again). Hexes from adventures are on the routes.' })]) : null
    ]);
  }

  function dmPanel() {
    if (!data.dm && !data.asPlayerId) return null;
    const players = data.players || [];
    const asSelect = el('select', { 'aria-label': 'See the map as', onchange: event => { asPlayer = Number(event.target.value) || null; mode = 'look'; selected = null; reload(); } }, [
      el('option', { value: '', text: 'DM view (everything)' }),
      ...players.map(player => el('option', { value: String(player.id), text: 'As ' + player.name, selected: player.id === asPlayer }))]);
    return el('div', { className: 'wm-dm' }, [
      el('label', { className: 'small' }, ['See the map ', asSelect]),
      data.dm ? settingsPanel() : null
    ]);
  }

  function settingsPanel() {
    const g = gridDraft || data.grid;
    const field = (key, label, step) => el('label', { className: 'small' }, [label + ' ', el('input', {
      type: 'number', step, value: String(g[key]), className: 'inventory-qty',
      oninput: event => { gridDraft = Object.assign({}, gridDraft || data.grid, { [key]: Number(event.target.value) }); redrawMap(); }
    })]);
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Map image' });
    const details = el('details', { className: 'wm-settings', open: gridDraft ? true : null }, [
      el('summary', { text: '⚙ Map image and grid' }),
      el('div', { className: 'table-filter' }, [file, button('Upload', () => {
        if (!file.files[0]) { message = 'Choose the map image first.'; isError = true; render(); return; }
        image.url = null;
        act('/image', file.files[0], 'Map image uploaded.', true);
      }, 'btn btn-small btn-green')]),
      el('p', { className: 'muted small', text: 'Line the grid up with the map: hex 1.1 is the top-left hex; its centre is x, y in image pixels, and the size is from a hex’s centre to a corner. The grid shows while this is open.' }),
      el('div', { className: 'wm-grid-fields' }, [field('cols', 'Columns', '1'), field('rows', 'Rows', '1'), field('originX', 'Hex 1.1 x', '0.5'), field('originY', 'Hex 1.1 y', '0.5'), field('size', 'Size', '0.1')]),
      el('div', {}, [
        button('Save grid', () => { const draft = gridDraft; gridDraft = null; act('/grid', draft || data.grid, 'Grid saved.'); }, 'btn btn-small btn-green'), ' ',
        button('Undo changes', () => { gridDraft = null; render(); }, 'btn btn-small btn-secondary')
      ])
    ]);
    details.addEventListener('toggle', () => {
      if (details.open && !gridDraft) { gridDraft = Object.assign({}, data.grid); redrawMap(); }
      if (!details.open && gridDraft) { gridDraft = null; redrawMap(); }
    });
    return details;
  }

  async function reload() {
    try {
      data = await api('');
      await loadImage();
      message = '';
    } catch (error) {
      message = error.message;
      isError = true;
    }
    render();
  }

  let mapBox = null;
  function redrawMap() {
    if (mapBox) mapBox.replaceChildren(mapSvg());
  }

  function render() {
    if (!data) return;
    const fogged = Array.isArray(data.revealed);
    mapBox = el('div', { className: 'wm-viewport' }, [mapSvg()]);
    const controls = el('div', { className: 'wm-zoom' }, [
      button('+', () => zoom(1 / 1.4), 'btn btn-small btn-secondary', { 'aria-label': 'Zoom in' }),
      button('−', () => zoom(1.4), 'btn btn-small btn-secondary', { 'aria-label': 'Zoom out' }),
      button('Fit', () => { fit(); applyView(); }, 'btn btn-small btn-secondary'),
      el('label', { className: 'small' }, [el('input', { type: 'checkbox', checked: showGrid, onchange: event => { showGrid = event.target.checked; remember('grimbold-map-grid', showGrid ? 'on' : 'off'); redrawMap(); } }), ' Grid'])
    ]);
    root.replaceChildren(...[
      el('div', { className: 'wm-head' }, [
        el('h3', { text: '🗺 Map' }),
        el('p', { className: 'muted small', text: data.asPlayerId
          ? 'You are seeing what this player sees: the hexes their characters visited, and the markers shown there.'
          : fogged ? 'Clear hexes are the ones your characters have been to, from the adventures they took part in. Drag to move, scroll or pinch to zoom.'
            : 'DM view: the whole map and every marker. Secret markers are faded. Drag to move, scroll or pinch to zoom.' })
      ]),
      !data.imageUrl ? el('p', { className: 'alert', text: data.dm ? 'No map image yet: upload one under ⚙ Map image and grid.' : 'The DMs have not put the map up yet.' }) : null,
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      el('div', { className: 'wm-layout' }, [
        el('div', { className: 'wm-map' }, [mapBox, controls]),
        el('aside', { className: 'wm-side' }, [toolsPanel(), hexPanel(), dmPanel()])
      ])
    ].filter(Boolean));
  }

  load();
})();
