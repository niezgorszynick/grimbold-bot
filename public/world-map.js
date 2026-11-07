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
  let painting = null;          // { on, hexes } while dragging across hexes with a tool
  let fillArmed = false;        // the next click fills hexes that look alike
  let pendingFill = null;       // { hexes } found by a fill, waiting for Apply
  let paintLayer = null;

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
    let result;
    try {
      result = await response.json();
    } catch {
      // Not from Grimbold: the web server in front refused it (often for size).
      throw new Error(response.status === 413 ? 'The server refused the upload as too large.' : 'The server answered ' + response.status + '; try again.');
    }
    if (!response.ok) throw new Error(result.error || 'Could not load the map.');
    return result;
  }

  // The image in pieces (the web server in front refuses big requests).
  async function uploadImage(file) {
    const { uploadId, pieceBytes } = await api('/uploads', { size: file.size });
    for (let offset = 0; offset < file.size; offset += pieceBytes) {
      message = 'Uploading… ' + Math.round(offset / file.size * 100) + '%';
      isError = false;
      const status = root.querySelector('.sheet-message');
      if (status) status.textContent = message;
      await api('/uploads/' + uploadId + '/pieces?offset=' + offset, file.slice(offset, offset + pieceBytes), true);
    }
    return api('/uploads/' + uploadId + '/finish', {});
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
    const tool = target();
    if (tool && tool.hexes.length) svg.append(svgEl('g', { class: tool.className }, tool.hexes.map(hex => svgEl('polygon', { points: corners(hex, g) }))));
    // DMs see which hexes everyone knows.
    if (data.dm && (data.publicHexes || []).length) svg.append(svgEl('g', { class: 'wm-public' }, data.publicHexes.map(hex => svgEl('polygon', { points: corners(hex, g) }))));
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
    paintLayer = svgEl('g', { class: 'wm-paint' });
    svg.append(paintLayer);
    drawPaint();
    wireMap(svg);
    return svg;
  }

  // The tool in use: the hexes it marks and where changes go (null in Look).
  function target() {
    if (!data) return null;
    if (mode === 'route' && routeId) {
      const route = (data.routes || []).find(entry => entry.id === routeId);
      return route && { hexes: route.hexes, path: '/adventures/' + routeId + '/hexes', className: 'wm-route', on: n => n + ' added to ' + route.title + "'s route.", off: n => n + ' taken off ' + route.title + "'s route." };
    }
    if (mode === 'reveal' && characterId) {
      const character = (data.characters || []).find(entry => entry.id === characterId);
      return character && { hexes: character.hexes, path: '/characters/' + characterId + '/hexes', className: 'wm-reveal', on: n => n + ' revealed to ' + character.name + '.', off: n => n + ' hidden again from ' + character.name + '.' };
    }
    if (mode === 'everyone' && data.dm) {
      return { hexes: data.publicHexes || [], path: '/public-hexes', className: 'wm-everyone', on: n => n + ' revealed to everyone.', off: n => n + ' no longer revealed to everyone.' };
    }
    return null;
  }
  const hexCount = list => (list.length === 1 ? 'Hex ' + list[0] : list.length + ' hexes');
  function applyHexes(list, on) {
    const tool = target();
    if (!tool || !list.length) return;
    selected = list[list.length - 1];
    act(tool.path, { hexes: list, on }, on ? tool.on(hexCount(list)) : tool.off(hexCount(list)));
  }

  // Hexes being painted, or found by a fill.
  function drawPaint() {
    if (!paintLayer) return;
    const list = painting ? painting.hexes : pendingFill ? pendingFill.hexes : [];
    paintLayer.setAttribute('class', 'wm-paint' + (painting && !painting.on ? ' is-off' : ''));
    paintLayer.replaceChildren(...list.map(hex => svgEl('polygon', { points: corners(hex) })));
  }

  // Drag to move, wheel or pinch to zoom, click (without dragging) to pick a hex.
  // With a tool: click or drag across hexes to mark them (starting on a marked
  // hex takes them off); the right mouse button or two fingers move the map.
  function wireMap(node) {
    const pointers = new Map();
    let moved = 0;
    let pinch = null;
    node.addEventListener('contextmenu', event => { if (target()) event.preventDefault(); });
    node.addEventListener('wheel', event => {
      event.preventDefault();
      const point = toImage(event);
      zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, point.x, point.y);
    }, { passive: false });
    node.addEventListener('pointerdown', event => {
      try { node.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        moved = 0;
        const tool = target();
        const point = toImage(event);
        const hex = hexAt(point.x, point.y);
        if (tool && !fillArmed && event.button === 0 && hex) {
          painting = { on: !tool.hexes.includes(hex), hexes: [hex] };
          pendingFill = null;
          drawPaint();
        }
      }
      if (pointers.size === 2) {
        painting = null;
        drawPaint();
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const point = toImage({ clientX: middle.x, clientY: middle.y });
        zoom(pinch.distance / distance, point.x, point.y);
        view.x -= (middle.x - pinch.x) * view.w / node.clientWidth;
        view.y -= (middle.y - pinch.y) * view.w / node.clientWidth;
        applyView();
        pinch = { distance, x: middle.x, y: middle.y };
        moved += 10;
        return;
      }
      moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
      if (painting) {
        const point = toImage(event);
        const hex = hexAt(point.x, point.y);
        if (hex && !painting.hexes.includes(hex)) {
          painting.hexes.push(hex);
          drawPaint();
        }
        return;
      }
      const scale = view.w / node.clientWidth;
      view.x -= (now.x - last.x) * scale;
      view.y -= (now.y - last.y) * scale;
      applyView();
    });
    const release = event => {
      const wasClick = pointers.size === 1 && moved < 6;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (painting) {
        const done = painting;
        painting = null;
        if (event.type === 'pointerup') applyHexes(done.hexes, done.on);
        else drawPaint();
        return;
      }
      if (wasClick && event.type === 'pointerup') {
        const point = toImage(event);
        pickHex(hexAt(point.x, point.y));
      }
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
  }

  // ─── Fill: connected hexes that look like the clicked one ─────────────
  let pixels = null;
  function imagePixels() {
    if (pixels && pixels.url === image.url) return Promise.resolve(pixels);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(img, 0, 0);
        pixels = { url: image.url, width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
        resolve(pixels);
      };
      img.onerror = () => reject(new Error('Could not read the map image.'));
      img.src = image.url;
    });
  }
  // A hex's average colour, from points inside it (away from the grid lines).
  function hexColour(hex, px) {
    const g = grid();
    const [col, row] = hex.split('.').map(Number);
    const c = centre(col, row, g);
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dy = -3; dy <= 3; dy += 1) {
        const x = Math.round(c.x + dx * g.size * 0.17);
        const y = Math.round(c.y + dy * g.size * 0.17);
        if (x < 0 || y < 0 || x >= px.width || y >= px.height) continue;
        const i = (y * px.width + x) * 4;
        red += px.data[i];
        green += px.data[i + 1];
        blue += px.data[i + 2];
        count += 1;
      }
    }
    return count ? [red / count, green / count, blue / count] : null;
  }
  const colourDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  function neighbours(hex) {
    const g = grid();
    const [col, row] = hex.split('.').map(Number);
    const c = centre(col, row, g);
    return [30, 90, 150, 210, 270, 330]
      .map(degrees => hexAt(c.x + SQ3 * g.size * Math.cos(degrees * Math.PI / 180), c.y + SQ3 * g.size * Math.sin(degrees * Math.PI / 180)))
      .filter(Boolean);
  }
  // Spreads from hex to neighbour while the colour stays close (to the
  // neighbour it came from, and not too far from the first hex).
  async function similarHexes(start) {
    const px = await imagePixels();
    const first = hexColour(start, px);
    if (!first) return [start];
    const seen = new Set([start]);
    const found = [start];
    const queue = [[start, first]];
    while (queue.length) {
      const [hex, colour] = queue.shift();
      neighbours(hex).forEach(next => {
        if (seen.has(next)) return;
        seen.add(next);
        const nextColour = hexColour(next, px);
        if (nextColour && colourDistance(nextColour, colour) < 24 && colourDistance(nextColour, first) < 60) {
          found.push(next);
          queue.push([next, nextColour]);
        }
      });
    }
    return found;
  }

  function pickHex(hex) {
    if (!hex) return;
    if (fillArmed && target()) {
      fillArmed = false;
      selected = hex;
      similarHexes(hex).then(found => {
        const known = new Set(target().hexes);
        const fresh = found.filter(entry => !known.has(entry));
        pendingFill = fresh.length ? { hexes: fresh } : null;
        message = fresh.length ? '' : 'Every hex like ' + hex + ' is marked already.';
        isError = false;
        render();
      }).catch(error => { message = error.message; isError = true; render(); });
      return;
    }
    selected = selected === hex ? null : hex;
    editingMarker = null;
    render();
  }

  // ─── The side panel ───────────────────────────────────────────────────
  const adventureLink = adventure => el('a', { className: 'wm-chip', href: '/admin?tab=adventures&table=' + adventure.id, text: adventure.title, title: adventure.status === 'active' ? 'Running' : 'Finished' });

  function hexPanel() {
    if (!selected) return el('p', { className: 'wm-card muted small', text: data.dm ? 'Click a hex to see or add markers.' : 'Click a hex to see what you know about it.' });
    const markers = data.markers.filter(marker => marker.hex === selected);
    const known = !data.revealed || data.revealed.includes(selected);
    const visits = (data.visits || []).filter(visit => visit.hex === selected);
    const isPublic = (data.publicHexes || []).includes(selected);
    // DMs: every adventure here, by its route or a marker's link.
    const here = new Map();
    if (data.dm) {
      (data.routes || []).filter(route => route.hexes.includes(selected)).forEach(route => here.set(route.id, route));
      markers.forEach(marker => (marker.adventures || []).forEach(adventure => here.set(adventure.id, adventure)));
    }
    return el('div', { className: 'wm-card wm-hex' }, [
      el('div', { className: 'wm-card-head' }, [
        el('h4', { text: 'Hex ' + selected }),
        data.dm ? button(isPublic ? '🌍 Everyone sees it' : '🌍 Reveal to everyone', () => act('/public-hexes', { hex: selected, on: !isPublic }, isPublic ? selected + ' is no longer revealed to everyone.' : selected + ' is revealed to everyone.'),
          'wm-pill' + (isPublic ? ' is-on' : ''), { title: isPublic ? 'Every player sees this hex; click to undo' : 'Every player will see this hex (the main hub, the sea)' }) : null
      ]),
      !known ? el('p', { className: 'muted small', text: 'Not explored yet.' }) : null,
      visits.length ? el('ul', { className: 'small wm-visits' }, visits.map(visit => el('li', {
        text: visit.everyone ? 'Known to everyone' : (visit.character || 'You (as DM)') + (visit.via ? ' · ' + visit.via : ' · revealed by a DM')
      }))) : null,
      here.size ? el('div', { className: 'wm-chips' }, [el('span', { className: 'muted small', text: 'Adventures here:' }), ...[...here.values()].map(adventureLink)]) : null,
      markers.map(marker => editingMarker === marker.id ? markerForm() : el('div', { className: 'wm-marker-card' + (marker.secret ? ' is-secret' : '') }, [
        el('div', { className: 'wm-marker-head' }, [
          el('strong', { text: (ICON_NAMES[marker.icon] || '').split(' ')[0] + ' ' + marker.name }),
          data.dm ? el('span', { className: 'wm-icon-buttons' }, [
            button('✎', () => { editingMarker = marker.id; render(); }, 'wm-icon-button', { title: 'Edit ' + marker.name, 'aria-label': 'Edit ' + marker.name }),
            button('🗑', () => { if (window.confirm('Delete the marker ' + marker.name + '?')) act('/markers/' + marker.id + '/delete', {}, marker.name + ' deleted.'); }, 'wm-icon-button', { title: 'Delete ' + marker.name, 'aria-label': 'Delete ' + marker.name })
          ]) : null
        ]),
        data.dm ? el('div', { className: 'wm-chips' }, [
          el('span', { className: 'tag' + (marker.secret ? '' : ' green'), text: marker.secret ? 'secret' : 'shown' }),
          ...(marker.adventures || []).map(adventureLink)
        ]) : null,
        marker.note ? el('p', { className: 'small wm-note', text: marker.note }) : null
      ])),
      !markers.length && known && !data.dm ? el('p', { className: 'muted small', text: 'Nothing marked here.' }) : null,
      data.dm ? (editingMarker === 'new' ? markerForm() : button('+ Marker', () => { editingMarker = 'new'; render(); }, 'btn btn-small btn-secondary')) : null
    ]);
  }

  function markerForm() {
    const marker = editingMarker === 'new' ? { hex: selected, name: '', icon: 'site', note: '', adventures: [], secret: true } : data.markers.find(entry => entry.id === editingMarker);
    if (!marker) return null;
    const name = el('input', { type: 'text', maxlength: '80', value: marker.name, placeholder: 'Name', 'aria-label': 'Marker name' });
    const icon = el('select', { 'aria-label': 'Icon' }, data.icons.map(key => el('option', { value: key, text: ICON_NAMES[key] || key, selected: key === marker.icon })));
    const note = el('textarea', { rows: '2', maxlength: '1000', placeholder: 'Note (players see it when shown)', 'aria-label': 'Note' });
    note.value = marker.note || '';
    const linked = new Set((marker.adventures || []).map(adventure => adventure.id));
    const boxes = (data.routes || []).map(adventure => ({ id: adventure.id, input: el('input', { type: 'checkbox', checked: linked.has(adventure.id) }), adventure }));
    const shown = el('input', { type: 'checkbox', checked: !marker.secret });
    const save = () => {
      const body = { hex: selected, name: name.value, icon: icon.value, note: note.value, adventureIds: boxes.filter(box => box.input.checked).map(box => box.id), secret: !shown.checked };
      editingMarker = null;
      act(marker.id ? '/markers/' + marker.id : '/markers', body, 'Marker saved.');
    };
    return el('div', { className: 'wm-form' }, [
      el('div', { className: 'wm-form-row' }, [name, icon]),
      note,
      boxes.length ? el('details', { className: 'wm-adventure-picks', open: linked.size ? true : null }, [
        el('summary', { className: 'small', text: 'Adventures here' + (linked.size ? ' (' + linked.size + ')' : '') }),
        el('div', { className: 'wm-adventure-list' }, boxes.map(box => el('label', { className: 'small' }, [box.input, ' ' + box.adventure.title + (box.adventure.status === 'active' ? ' (running)' : '')])))
      ]) : null,
      el('label', { className: 'small' }, [shown, " Shown to players who've been here"]),
      el('div', { className: 'wm-form-row' }, [button('Save', save, 'btn btn-small btn-green'), button('Cancel', () => { editingMarker = null; render(); }, 'btn btn-small btn-secondary')])
    ]);
  }

  function toolsPanel() {
    const routes = data.routes || [];
    if (!data.dm && !routes.length) return null;
    const modes = [['look', '🔍', 'Look', 'Look around and edit markers'], ['route', '🧭', 'Route', "Mark an adventure's route (its party sees it)"]];
    if (data.dm) modes.push(['reveal', '👁', 'Character', 'Reveal hexes to one character'], ['everyone', '🌍', 'Everyone', 'Reveal hexes to every player']);
    const segment = el('div', { className: 'wm-seg', role: 'group', 'aria-label': 'Map tool' }, modes.map(([key, emoji, label, title]) => button(emoji + ' ' + label, () => {
      mode = key; fillArmed = false; pendingFill = null; render();
    }, mode === key ? 'is-on' : '', { title, 'aria-pressed': mode === key ? 'true' : 'false' })));
    const tool = target();
    const picker = mode === 'route'
      ? el('select', { 'aria-label': 'Adventure', onchange: event => { routeId = Number(event.target.value) || null; render(); } }, [
        el('option', { value: '', text: 'Pick an adventure…' }),
        ...routes.map(entry => el('option', { value: String(entry.id), text: entry.title + ' (' + entry.hexes.length + ')', selected: entry.id === routeId }))])
      : mode === 'reveal' && data.dm
        ? el('select', { 'aria-label': 'Character', onchange: event => { characterId = Number(event.target.value) || null; render(); } }, [
          el('option', { value: '', text: 'Pick a character…' }),
          ...data.characters.map(entry => el('option', { value: String(entry.id), text: entry.name + ' (' + entry.player + ')', selected: entry.id === characterId }))])
        : null;
    const fill = tool ? el('div', { className: 'wm-fill' }, pendingFill
      ? [el('span', { className: 'small', text: '🌊 ' + pendingFill.hexes.length + ' hexes found' }),
        button('Apply', () => { const list = pendingFill.hexes; pendingFill = null; applyHexes(list, true); }, 'btn btn-small btn-green'),
        button('Cancel', () => { pendingFill = null; render(); }, 'btn btn-small btn-secondary')]
      : [button(fillArmed ? '🌊 Click a hex…' : '🌊 Fill', () => { fillArmed = !fillArmed; render(); }, 'btn btn-small' + (fillArmed ? '' : ' btn-secondary'), { title: 'Click a hex next: every connected hex that looks like it (a sea, a forest) is found' })]) : null;
    return el('div', { className: 'wm-card wm-tools' }, [
      segment,
      picker,
      tool ? el('p', { className: 'muted small', text: 'Click or drag across hexes; drag from a marked hex to unmark. Right-drag moves the map.' }) : null,
      fill
    ]);
  }

  function dmPanel() {
    if (!data.dm && !data.asPlayerId) return null;
    const players = data.players || [];
    const asSelect = el('select', { 'aria-label': 'See the map as', onchange: event => { asPlayer = Number(event.target.value) || null; mode = 'look'; selected = null; reload(); } }, [
      el('option', { value: '', text: 'DM view (everything)' }),
      ...players.map(player => el('option', { value: String(player.id), text: 'As ' + player.name, selected: player.id === asPlayer }))]);
    return el('div', { className: 'wm-card wm-dm' }, [
      el('label', { className: 'small wm-form-row' }, [el('span', { text: 'View' }), asSelect]),
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
        const chosen = file.files[0];
        message = 'Uploading… 0%';
        isError = false;
        render();
        uploadImage(chosen).then(async result => {
          data = result;
          image.url = null;
          message = 'Map image uploaded.';
          await loadImage();
          render();
        }).catch(error => { message = error.message; isError = true; render(); });
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
      button(fullScreen ? '✕ Exit full screen' : '⛶ Full screen', toggleFullScreen, 'btn btn-small btn-secondary', { title: fullScreen ? 'Back to the page (Esc)' : 'The map and its panel fill the screen' }),
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

  // Full screen: the map card (map and side panel) fills the screen. The
  // browser's own full screen where it has one (Esc leaves it); otherwise the
  // card covers the page.
  let fullScreen = false;
  const card = root.closest('.world-map-card') || root;
  function setFullScreen(on) {
    fullScreen = on;
    card.classList.toggle('wm-fullscreen', on);
    document.body.classList.toggle('wm-no-scroll', on);
    render();
  }
  function toggleFullScreen() {
    if (!fullScreen) {
      if (card.requestFullscreen) card.requestFullscreen().catch(() => setFullScreen(true));
      else setFullScreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      setFullScreen(false);
    }
  }
  document.addEventListener('fullscreenchange', () => setFullScreen(document.fullscreenElement === card));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && fullScreen && !document.fullscreenElement) setFullScreen(false); });

  load();
})();
