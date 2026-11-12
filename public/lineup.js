// public/lineup.js — The Lineup tab: picked characters side by side on a
// height chart (cm on the left, feet on the right), each drawn as an outline
// from parts: the body by build (Appearance → Build), details by species
// (ears, horns, crest, beard, halo, tail) and a prop by class (staff, axe,
// mace, book, bow…), scaled to the height on their sheet (Appearance → Height).
// The picks are remembered in this browser.

(function () {
  const root = document.getElementById('lineup');
  if (!root) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const STORE = 'grimbold.lineup';
  const COLORS = ['#8fd694', '#b393d3', '#8a9bb0', '#a3a3a3', '#e5a46b', '#6fb7d6', '#d67a8f', '#c9b458', '#7fc8b4', '#d39ad3', '#9fb4e8', '#e08f6a'];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  function svg(tag, attrs, children) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => { if (value !== undefined && value !== null) node.setAttribute(key, String(value)); });
    [].concat(children || []).forEach(child => { if (child) node.append(child); });
    return node;
  }
  const button = (text, onclick, className = 'btn btn-small btn-secondary', extra = {}) => el('button', Object.assign({ type: 'button', className, text, onclick }, extra));

  let data = null;
  let error = '';
  let picked = [];
  let byHeight = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    picked = Array.isArray(saved.picked) ? saved.picked.map(Number) : [];
    byHeight = saved.byHeight !== false;
  } catch { /* nothing saved */ }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ picked, byHeight })); } catch { /* private window */ }
  }
  const colorOf = character => COLORS[character.id % COLORS.length];
  const feetText = cm => { const inches = Math.round(cm / 2.54); return Math.floor(inches / 12) + '′' + (inches % 12) + '″'; };

  // ─── The outline ──────────────────────────────────────────────────────────
  // Drawn 100 units tall (crown 0, soles 100), centred on x = 0; the caller
  // scales it to the character's height. Returns { shapes, left, right } (how
  // far it reaches, props included) to space the lineup.
  const ROBES = ['Wizard', 'Sorcerer', 'Warlock', 'Cleric', 'Druid'];

  function proportions(build, species) {
    const base = {
      masculine: { shoulders: 12.5, waist: 8.4, hips: 8.6 },
      feminine: { shoulders: 10.4, waist: 7, hips: 10.2 },
      neutral: { shoulders: 11.4, waist: 7.7, hips: 9.3 }
    }[build] || { shoulders: 11.4, waist: 7.7, hips: 9.3 };
    let head = 13;
    let width = 1;
    let hipY = 53;
    if (species === 'Dwarf') { head = 15.5; width = 1.28; hipY = 57; }
    else if (species === 'Halfling' || species === 'Gnome') { head = 17; width = 1.08; hipY = 58; }
    else if (species === 'Goliath') { head = 12; width = 1.14; }
    else if (species === 'Orc') { width = 1.1; }
    return {
      head, hipY,
      shoulders: base.shoulders * width, waist: base.waist * width, hips: base.hips * width,
      shoulderY: head + 4
    };
  }

  function figure(character, fill) {
    const p = proportions(character.build || 'neutral', character.species);
    const shapes = [];
    const add = (tag, attrs) => shapes.push(svg(tag, Object.assign({ fill }, attrs)));
    const line = (x1, y1, x2, y2, width) => shapes.push(svg('line', { x1, y1, x2, y2, stroke: fill, 'stroke-width': width, 'stroke-linecap': 'round' }));
    const path = (d, extra = {}) => shapes.push(svg('path', Object.assign({ d, fill }, extra)));
    const strokePath = (d, width) => shapes.push(svg('path', { d, fill: 'none', stroke: fill, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const headRx = p.head * 0.37;
    const headCy = p.head / 2;
    const sh = p.shoulders;
    const handY = p.hipY + 4;
    let left = -sh - 3;
    let right = sh + 3;
    const robe = ROBES.includes(character.className);
    const build = character.build || 'neutral';

    // Hair behind the head: long (feminine), to the chin (neutral), none (masculine).
    if (character.species !== 'Goliath' && character.species !== 'Dragonborn') {
      if (build === 'feminine') path(`M ${-headRx * 1.12} ${headCy} Q ${-headRx * 1.25} ${p.shoulderY + 7} ${-headRx * 1.3} ${p.shoulderY + 9} L ${headRx * 1.3} ${p.shoulderY + 9} Q ${headRx * 1.25} ${p.shoulderY + 7} ${headRx * 1.12} ${headCy} Z`);
      else if (build === 'neutral') path(`M ${-headRx * 1.08} ${headCy} L ${-headRx * 1.1} ${p.head * 0.95} L ${headRx * 1.1} ${p.head * 0.95} L ${headRx * 1.08} ${headCy} Z`);
    }
    // Head and neck.
    add('ellipse', { cx: 0, cy: headCy, rx: headRx, ry: p.head / 2 });
    add('rect', { x: -headRx * 0.45, y: p.head * 0.8, width: headRx * 0.9, height: p.shoulderY - p.head * 0.8 + 1 });
    // Torso: shoulders, waist, hips.
    path(`M ${-sh} ${p.shoulderY + 1.5} Q ${-sh} ${p.shoulderY - 0.5} ${-sh + 2.5} ${p.shoulderY - 0.8} L ${sh - 2.5} ${p.shoulderY - 0.8} Q ${sh} ${p.shoulderY - 0.5} ${sh} ${p.shoulderY + 1.5}
      L ${p.waist} ${p.hipY - 13} L ${p.hips} ${p.hipY} L ${-p.hips} ${p.hipY} L ${-p.waist} ${p.hipY - 13} Z`);
    // Arms (thick rounded strokes), slightly away from the body.
    line(-sh + 1.6, p.shoulderY + 1.5, -sh - 1.4, handY, 4.4);
    line(sh - 1.6, p.shoulderY + 1.5, sh + 1.4, handY, 4.4);
    // Legs, or a robe for the spellcasters.
    if (robe) {
      path(`M ${-p.waist} ${p.hipY - 13} L ${p.waist} ${p.hipY - 13} L ${p.hips * 1.55} 99 Q 0 101 ${-p.hips * 1.55} 99 Z`);
      add('ellipse', { cx: -p.hips * 0.6, cy: 99.2, rx: 3.2, ry: 1.1 });
      add('ellipse', { cx: p.hips * 0.6, cy: 99.2, rx: 3.2, ry: 1.1 });
    } else {
      const legW = Math.max(5.2, p.hips * 0.62);
      line(-p.hips + legW / 2, p.hipY - 1, -p.hips * 0.6, 97, legW);
      line(p.hips - legW / 2, p.hipY - 1, p.hips * 0.6, 97, legW);
      add('ellipse', { cx: -p.hips * 0.6 - 1.2, cy: 98.6, rx: 3.6, ry: 1.6 });
      add('ellipse', { cx: p.hips * 0.6 + 1.2, cy: 98.6, rx: 3.6, ry: 1.6 });
    }

    // Species.
    const ears = (size, tilt) => {
      path(`M ${-headRx + 0.6} ${headCy - 0.5} L ${-headRx - size} ${headCy - tilt} L ${-headRx + 0.4} ${headCy + 2} Z`);
      path(`M ${headRx - 0.6} ${headCy - 0.5} L ${headRx + size} ${headCy - tilt} L ${headRx - 0.4} ${headCy + 2} Z`);
    };
    const tail = (thick) => {
      strokePath(`M ${p.hips * 0.4} ${p.hipY - 2} Q ${p.hips + 10} ${p.hipY + 8} ${p.hips + 9} ${88} Q ${p.hips + 8} ${95} ${p.hips + 14} ${92}`, thick);
      right = Math.max(right, p.hips + 15);
    };
    switch (character.species) {
      case 'Elf': ears(3.2, 4.8); break;
      case 'Gnome': ears(2.2, 3.2); break;
      case 'Orc': ears(1.6, 2); break;
      case 'Tiefling':
        strokePath(`M ${-headRx * 0.45} ${p.head * 0.15} Q ${-headRx * 1.3} ${-p.head * 0.35} ${-headRx * 1.6} ${p.head * 0.12}`, 1.9);
        strokePath(`M ${headRx * 0.45} ${p.head * 0.15} Q ${headRx * 1.3} ${-p.head * 0.35} ${headRx * 1.6} ${p.head * 0.12}`, 1.9);
        tail(1.4);
        break;
      case 'Dragonborn':
        // A crest of spikes on the head, and a heavy tail.
        [-0.55, 0, 0.55].forEach(offset => path(`M ${offset * headRx - 1.2} ${p.head * 0.12} L ${offset * headRx} ${-p.head * 0.22} L ${offset * headRx + 1.2} ${p.head * 0.12} Z`));
        tail(3.2);
        break;
      case 'Dwarf':
        path(`M ${-headRx * 0.85} ${p.head * 0.62} L ${headRx * 0.85} ${p.head * 0.62} L ${headRx * 0.5} ${p.shoulderY + 13} Q 0 ${p.shoulderY + 16} ${-headRx * 0.5} ${p.shoulderY + 13} Z`);
        break;
      case 'Aasimar':
        shapes.push(svg('ellipse', { cx: 0, cy: -2.5, rx: headRx * 0.95, ry: 1.3, fill: 'none', stroke: fill, 'stroke-width': 0.9 }));
        break;
      case 'Halfling':
        [-0.5, 0, 0.5].forEach(offset => add('circle', { cx: offset * headRx, cy: p.head * 0.12, r: headRx * 0.42 }));
        break;
      default:
        break;
    }

    // Class props, in or by the right hand (x > 0) unless said otherwise.
    const rx = sh + 1.6;
    switch (character.className) {
      case 'Wizard':
        line(rx + 2.4, 4, rx + 2.4, 100, 1.5);
        add('circle', { cx: rx + 2.4, cy: 3.5, r: 2.4 });
        right = Math.max(right, rx + 5);
        break;
      case 'Druid':
        line(rx + 2.4, 10, rx + 2.4, 100, 1.5);
        strokePath(`M ${rx + 2.4} 10 Q ${rx + 2.4} 2 ${rx + 7} 4 Q ${rx + 9} 8 ${rx + 5} 9`, 1.5);
        right = Math.max(right, rx + 9);
        break;
      case 'Sorcerer':
        add('circle', { cx: rx + 1.5, cy: handY - 4.5, r: 3.3 });
        right = Math.max(right, rx + 5);
        break;
      case 'Warlock':
        // An open book in the left hand.
        path(`M ${-rx - 1} ${handY - 3} L ${-rx - 10} ${handY - 7} L ${-rx - 10} ${handY + 3} L ${-rx - 1} ${handY + 6} Z`);
        left = Math.min(left, -rx - 11);
        break;
      case 'Cleric': {
        line(rx, handY, rx + 2.5, handY + 17, 1.4);
        const cx = rx + 2.8;
        const cy = handY + 19;
        const spikes = Array.from({ length: 16 }, (_, i) => {
          const angle = (i / 16) * Math.PI * 2;
          const radius = i % 2 ? 2.2 : 3.8;
          return (cx + Math.cos(angle) * radius).toFixed(2) + ',' + (cy + Math.sin(angle) * radius).toFixed(2);
        }).join(' ');
        add('polygon', { points: spikes });
        right = Math.max(right, cx + 4);
        break;
      }
      case 'Fighter':
        line(rx + 0.5, handY + 1, rx + 7, handY + 32, 1.6);
        line(rx - 1.8, handY + 2.2, rx + 3.2, handY + 0.2, 1.3);
        right = Math.max(right, rx + 8);
        break;
      case 'Paladin':
        line(rx + 0.5, handY, rx + 3, handY - 28, 1.6);
        line(rx - 2, handY - 1.5, rx + 3, handY - 2.5, 1.3);
        // A shield on the left arm.
        path(`M ${-rx - 6} ${p.shoulderY + 10} L ${-rx + 4} ${p.shoulderY + 10} L ${-rx + 4} ${p.shoulderY + 20} Q ${-rx - 1} ${p.shoulderY + 28} ${-rx - 6} ${p.shoulderY + 20} Z`);
        left = Math.min(left, -rx - 7);
        right = Math.max(right, rx + 4);
        break;
      case 'Barbarian':
        // A great axe over the right shoulder.
        line(rx + 1, handY, sh + 1, -10, 1.8);
        // The head: a broad, curved blade facing out.
        path(`M ${sh + 1} ${-14} L ${sh + 5} ${-12.5} Q ${sh + 14} ${-12} ${sh + 15} ${-3} Q ${sh + 14} ${6} ${sh + 5} ${6.5} L ${sh + 1} ${8} Q ${sh + 4} ${-3} ${sh + 1} ${-14} Z`);
        right = Math.max(right, sh + 16);
        break;
      case 'Ranger':
        // A bow in the left hand.
        strokePath(`M ${-rx - 2} ${p.shoulderY - 4} Q ${-rx - 13} ${handY - 4} ${-rx - 2} ${handY + 14}`, 1.4);
        line(-rx - 2, p.shoulderY - 4, -rx - 2, handY + 14, 0.4);
        left = Math.min(left, -rx - 10);
        break;
      case 'Rogue':
        line(rx + 0.4, handY + 1, rx + 2.4, handY + 10, 1.2);
        line(-rx - 0.4, handY + 1, -rx - 2.4, handY + 10, 1.2);
        break;
      case 'Monk':
        line(-rx - 5, p.shoulderY - 8, rx + 6, 96, 1.4);
        left = Math.min(left, -rx - 6);
        right = Math.max(right, rx + 7);
        break;
      case 'Bard':
        add('ellipse', { cx: -rx + 1, cy: handY + 2, rx: 4, ry: 5.2, transform: `rotate(-30 ${-rx + 1} ${handY + 2})` });
        line(-rx + 3, handY - 2, rx - 2, p.shoulderY + 4, 1.2);
        left = Math.min(left, -rx - 4);
        break;
      case 'Artificer':
        line(rx, handY, rx + 1.5, handY + 12, 1.3);
        add('rect', { x: rx - 1.5, y: handY + 11, width: 6, height: 3.2, rx: 0.6 });
        right = Math.max(right, rx + 5);
        break;
      default:
        break;
    }
    return { shapes, left: Math.min(left, -headRx * 1.6), right: Math.max(right, headRx * 1.6) };
  }

  // ─── The chart ────────────────────────────────────────────────────────────
  function chart(characters) {
    const tallest = Math.max(...characters.map(character => character.heightCm));
    const top = Math.max(200, Math.ceil((tallest + 28) / 10) * 10);
    const axis = 30;
    const gap = 10;
    // Each figure's width in chart units (cm), props and label included.
    const placed = [];
    let x = axis + gap;
    for (const character of characters) {
      const fill = colorOf(character);
      const drawn = figure(character, fill);
      const scale = character.heightCm / 100;
      const label = Math.max(character.name.length * 3.6, 34);
      const width = Math.max((drawn.right - drawn.left) * scale, label);
      const centre = x + Math.max(-drawn.left * scale, width / 2 - (drawn.right + drawn.left) * scale / 2);
      placed.push({ character, drawn, scale, centre, fill });
      x += width + gap;
    }
    const total = x + axis;
    const chartSvg = svg('svg', {
      viewBox: `0 -6 ${total} ${top + 14}`, class: 'lineup-chart', role: 'img',
      'aria-label': 'Heights: ' + characters.map(character => character.name + ' ' + character.heightCm + ' cm').join(', '),
      style: `min-width: ${Math.round(characters.length * 80 + 100)}px`
    });
    const ground = top;
    // Grid: a line every 10 cm (cm on the left), feet marked on the right.
    for (let cm = 0; cm <= top; cm += 10) {
      const y = ground - cm;
      chartSvg.append(svg('line', { x1: axis, y1: y, x2: total - axis, y2: y, class: cm % 50 === 0 ? 'lineup-grid strong' : 'lineup-grid' }));
      chartSvg.append(svg('text', { x: axis - 3, y: y + 1.6, class: 'lineup-axis', 'text-anchor': 'end' }, [document.createTextNode(cm + (cm === top ? ' cm' : ''))]));
    }
    for (let feet = 1; feet * 30.48 <= top; feet += 1) {
      const y = ground - feet * 30.48;
      chartSvg.append(svg('line', { x1: total - axis, y1: y, x2: total - axis + 4, y2: y, class: 'lineup-grid strong' }));
      chartSvg.append(svg('text', { x: total - axis + 5, y: y + 1.6, class: 'lineup-axis' }, [document.createTextNode(feet + ' ft')]));
    }
    for (const entry of placed) {
      const { character, drawn, scale, centre, fill } = entry;
      const head = ground - character.heightCm;
      chartSvg.append(svg('g', { transform: `translate(${centre} ${head}) scale(${scale})`, class: 'lineup-figure' }, drawn.shapes));
      chartSvg.append(svg('text', { x: centre, y: head - 13, class: 'lineup-name', 'text-anchor': 'middle', fill }, [document.createTextNode(character.name)]));
      chartSvg.append(svg('text', { x: centre, y: head - 6.5, class: 'lineup-height', 'text-anchor': 'middle' }, [document.createTextNode(character.heightCm + ' cm · ' + feetText(character.heightCm))]));
    }
    return chartSvg;
  }

  // ─── The picker ───────────────────────────────────────────────────────────
  function pick(ids, on = true) {
    const set = new Set(picked);
    ids.forEach(id => (on ? set.add(id) : set.delete(id)));
    picked = data.characters.filter(character => set.has(character.id)).map(character => character.id);
    save();
    render();
  }

  function picker() {
    const withHeight = data.characters.filter(character => character.heightCm);
    const mine = data.characters.filter(character => character.mine && character.heightCm).map(character => character.id);
    const quick = el('div', { className: 'lineup-quick' }, [
      mine.length ? button('My characters', () => { picked = []; pick(mine); }) : null,
      ...data.parties.map(party => button('⚔ ' + party.title, () => { picked = []; pick(party.characterIds.filter(id => withHeight.some(character => character.id === id))); }, 'btn btn-small btn-secondary', { title: 'The party of this running adventure' })),
      button('Everyone', () => pick(withHeight.map(character => character.id))),
      button('Clear', () => { picked = []; save(); render(); })
    ]);
    // By player, then name.
    const groups = new Map();
    data.characters.forEach(character => {
      const key = character.player || 'No player';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(character);
    });
    const list = el('div', { className: 'lineup-list' }, [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([player, characters]) => el('div', { className: 'lineup-group' }, [
      el('strong', { className: 'small muted', text: player }),
      ...characters.map(character => {
        const box = el('input', { type: 'checkbox', disabled: character.heightCm ? null : true });
        box.checked = picked.includes(character.id);
        box.addEventListener('change', () => pick([character.id], box.checked));
        return el('label', { className: 'lineup-pick' + (character.heightCm ? '' : ' is-missing'), title: character.heightCm ? character.heightText : 'No height on the sheet yet (Appearance → Height)' }, [
          box,
          el('span', { className: 'lineup-swatch', style: 'background:' + colorOf(character) }),
          ' ' + character.name + ' ',
          el('span', { className: 'muted small', text: [character.species, character.className, character.heightCm ? character.heightCm + ' cm' : 'no height'].join(' · ') })
        ]);
      })
    ])));
    const sort = el('label', { className: 'small' }, [
      (() => { const box = el('input', { type: 'checkbox' }); box.checked = byHeight; box.addEventListener('change', () => { byHeight = box.checked; save(); render(); }); return box; })(),
      ' Shortest to tallest'
    ]);
    return el('details', { className: 'lineup-picker', open: true }, [
      el('summary', {}, [el('strong', { text: 'Characters' }), el('span', { className: 'muted small', text: ' · ' + picked.length + ' in the lineup' })]),
      quick, sort, list,
      el('p', { className: 'muted small', text: 'Height and build come from each character sheet: Appearance → Height (cm, m or feet and inches) and Build. The outline follows the species and class.' })
    ]);
  }

  function render() {
    if (error) { root.replaceChildren(el('p', { className: 'sheet-message is-error', text: error })); return; }
    if (!data) return;
    const characters = picked.map(id => data.characters.find(character => character.id === id)).filter(character => character && character.heightCm);
    if (byHeight) characters.sort((a, b) => a.heightCm - b.heightCm || a.name.localeCompare(b.name));
    const noBuild = characters.filter(character => !character.build);
    root.replaceChildren(
      el('div', { className: 'sheet-section-heading' }, [el('h3', { text: '📏 Lineup' })]),
      picker(),
      characters.length
        ? el('div', { className: 'lineup-scroll' }, [chart(characters)])
        : el('p', { className: 'muted', text: 'Pick characters above to line them up.' }),
      noBuild.length ? el('p', { className: 'muted small', text: 'No build chosen yet (drawn neutral): ' + noBuild.map(character => character.name).join(', ') + '.' }) : null
    );
  }

  async function load() {
    try {
      const response = await fetch('/api/lineup', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the lineup.');
      data = result;
      // A first visit: your own characters.
      if (!picked.length) picked = data.characters.filter(character => character.mine && character.heightCm).map(character => character.id);
    } catch (problem) {
      error = problem.message;
    }
    render();
  }
  load();
})();
