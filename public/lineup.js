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
  // scales it to the character's height. Every part is a list of landmark
  // points joined by smooth curves (Catmull-Rom); a point with s: 1 stays a
  // sharp corner (toes, fur, blades). Masculine and feminine are two sets of
  // the same landmarks; neutral is halfway. Returns { shapes, left, right }
  // (how far it reaches, props included) to space the lineup.

  const P = (x, y, s) => ({ x, y, s: Boolean(s) });
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (aList, bList, t) => aList.map((a, i) => P(lerp(a.x, bList[i].x, t), lerp(a.y, bList[i].y, t), a.s || bList[i].s));
  const f2 = n => Math.round(n * 100) / 100;

  // A closed smooth path through the points.
  function smooth(points) {
    const n = points.length;
    const at = i => points[(i + n) % n];
    let d = `M ${f2(points[0].x)} ${f2(points[0].y)}`;
    for (let i = 0; i < n; i += 1) {
      const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
      const c1 = p1.s ? p1 : P(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6);
      const c2 = p2.s ? p2 : P(p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6);
      d += ` C ${f2(c1.x)} ${f2(c1.y)} ${f2(c2.x)} ${f2(c2.y)} ${f2(p2.x)} ${f2(p2.y)}`;
    }
    return d + ' Z';
  }
  // The right half (top centre → bottom centre) and its mirror: one outline.
  const mirrored = right => [...right, ...right.slice(1, -1).reverse().map(p => P(-p.x, p.y, p.s))];
  const flipX = points => points.map(p => P(-p.x, p.y, p.s));

  // Body, right half, from the neck to the crotch around the right leg.
  const BODY = {
    masculine: [P(0, 12.6), P(2.9, 13.2), P(3.2, 15), P(6.8, 16.6), P(10.4, 17.8), P(12.7, 19.6), P(13.1, 23), P(10.7, 25.6), P(10.6, 29.5), P(9.6, 34), P(8.4, 38.5), P(8.7, 43), P(9.6, 47.5), P(9.9, 51.5), P(9.3, 58), P(7.3, 70), P(7.7, 79), P(6, 88), P(4.6, 94.5), P(6.3, 99.6, 1), P(2, 99.6, 1), P(2.1, 94.5), P(2.6, 82), P(2.2, 71), P(1.5, 60), P(0, 53.5, 1)],
    feminine: [P(0, 12.6), P(2.5, 13.2), P(2.7, 15.2), P(5.8, 16.9), P(8.8, 18.2), P(10.9, 19.9), P(11.2, 23), P(9.6, 25.4), P(9.8, 28.8), P(8, 33.5), P(7, 38), P(8.6, 43.5), P(10.3, 48), P(10.4, 52), P(9.6, 58), P(7.1, 70), P(7, 79), P(5.4, 88), P(4.2, 94.5), P(5.6, 99.6, 1), P(1.9, 99.6, 1), P(1.9, 94.5), P(2.3, 82), P(1.9, 71), P(1.2, 60), P(0, 54, 1)]
  };
  // The right arm, all the way round.
  const ARM = {
    masculine: [P(11.2, 18.9), P(13.6, 21), P(14.3, 27), P(14.4, 34.5), P(15, 40), P(14.8, 47), P(15.5, 50.5), P(14.7, 54.5), P(12.8, 53.5), P(12.4, 47), P(12, 40.5), P(11.4, 34), P(10.9, 27.5), P(10.3, 24)],
    feminine: [P(9.8, 19.2), P(11.7, 21.3), P(12.4, 27), P(12.6, 34.5), P(13, 40), P(12.9, 47), P(13.5, 50.5), P(12.9, 54), P(11.3, 53), P(10.9, 47), P(10.6, 40.5), P(10, 34), P(9.6, 27.5), P(9.2, 24)]
  };
  const HEAD = [P(0, 0), P(3.4, 0.6), P(4.8, 2.8), P(5.2, 6), P(5, 8.6), P(4.2, 10.6), P(2.6, 12.2), P(0, 12.9)];
  // An orc's heavier jaw.
  const ORC_HEAD = [P(0, 0), P(3.6, 0.6), P(5, 2.8), P(5.4, 6), P(5.5, 8.8), P(5.1, 11.1), P(3.5, 12.7), P(0, 13.1)];
  // Hair behind the head (Appearance → Hair length).
  const HAIR = {
    short: [P(0, -1.1), P(2.2, -1.2, 1), P(3.8, -0.5), P(5.5, 1.2, 1), P(5.7, 4.2), P(5.5, 6.6), P(0, 6)],
    medium: [P(0, -0.7), P(4.1, 0), P(5.8, 3), P(6.1, 8.5), P(6.3, 13.2), P(5.4, 15.4), P(0, 14.6)],
    long: [P(0, -0.7), P(4.2, 0), P(5.9, 3), P(6.3, 8), P(6.9, 15), P(7.3, 21), P(5, 22.5), P(0, 22)],
    // Messy, to the chin: a soft, full shape; its loose strands are SHAGGY_STRANDS.
    shaggy: [P(0, -1.4), P(3.6, -1.2), P(5.9, 1), P(6.8, 4.5), P(6.9, 8.5), P(6.6, 12.2), P(5.2, 13.4), P(0, 12.6)]
  };
  // Shaggy hair's loose strands: [base x, base y, bend x, bend y, tip x, tip y],
  // curving out and falling; the two sides differ, as messy hair does.
  const SHAGGY_STRANDS = [
    [1.5, -0.8, 2.6, -4.2, 4.8, -3.6], [4.8, 0.2, 7.2, -0.8, 8.6, 1.6], [6.6, 6, 8.2, 7, 8.8, 10], [6.2, 11, 7.4, 13.2, 7, 15.6], [4.6, 12.6, 5.2, 14.6, 4.2, 16],
    [-0.6, -1, -1, -4.6, -3.2, -4.4], [-4.4, 0, -6.8, -1.4, -8, 0.4], [-6.6, 5, -8.4, 6.6, -8.6, 9.4], [-6, 11.4, -7, 13.6, -6.2, 15.8]
  ];
  // A strand: a narrow leaf from its base, bending, to a point.
  function strandPath([bx, by, cx, cy, tx, ty], scale, width = 1.5) {
    const s = value => f2(value * scale);
    const dx = cx - bx; const dy = cy - by; const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width / 2; const ny = dx / length * width / 2;
    return `M ${s(bx + nx)} ${s(by + ny)} Q ${s(cx + nx * 0.6)} ${s(cy + ny * 0.6)} ${s(tx)} ${s(ty)} Q ${s(cx - nx * 0.6)} ${s(cy - ny * 0.6)} ${s(bx - nx)} ${s(by - ny)} Z`;
  }
  // Without a hair length on the sheet: long for feminine, short otherwise.
  const DEFAULT_HAIR = { feminine: 'long', masculine: 'short', neutral: 'short' };
  // These show their species in the head (ears, tusks, crest, curls), so their
  // hood is drawn down, as a cowl.
  const HOOD_DOWN = ['Elf', 'Orc', 'Gnome', 'Halfling', 'Dragonborn'];
  // Neutral is a build of its own (not halfway, which reads feminine): the
  // shoulders between the two, a straight torso with no waist and narrow hips.
  const NEUTRAL_BODY = (() => {
    const base = mix(BODY.masculine, BODY.feminine, 0.4);
    const set = (index, x) => { base[index] = P(x, base[index].y, base[index].s); };
    set(8, 10.1); set(9, 9.4); set(10, 8.6); set(11, 8.6); set(12, 9.1); set(13, 9.5); set(14, 9.1);
    return base;
  })();
  // What each class wears when the sheet says nothing about armour.
  const OUTFIT = {
    Wizard: 'robe', Sorcerer: 'robe', Cleric: 'robe', Warlock: 'hoodedRobe', Druid: 'hoodedRobe',
    Ranger: 'leather', Rogue: 'leather', Bard: 'coat', Artificer: 'coat',
    Fighter: 'mail', Paladin: 'plate', Barbarian: 'fur', Monk: 'monk'
  };
  // The prop each class holds when no weapon is in hand.
  const CLASS_PROP = {
    Wizard: 'staff', Druid: 'staff', Sorcerer: 'orb', Warlock: 'tome', Cleric: 'mace', Fighter: 'sword', Paladin: 'sword',
    Barbarian: 'greataxe', Ranger: 'bow', Rogue: 'daggers', Monk: 'staff', Bard: 'lute', Artificer: 'hammer'
  };
  // A weapon (its base name) → how it is drawn.
  const WEAPON_PROP = {
    Longsword: 'sword', Shortsword: 'sword', Greatsword: 'greatsword', Scimitar: 'scimitar', Rapier: 'rapier',
    Handaxe: 'axe', Battleaxe: 'axe', Greataxe: 'greataxe', 'Light Hammer': 'hammer', Warhammer: 'hammer', Maul: 'maul',
    Mace: 'mace', Morningstar: 'mace', Flail: 'flail', Club: 'club', Greatclub: 'club', Quarterstaff: 'staff',
    Spear: 'spear', Javelin: 'spear', Pike: 'spear', Trident: 'spear', Lance: 'spear', Glaive: 'halberd', Halberd: 'halberd',
    Shortbow: 'bow', Longbow: 'bow', 'Light Crossbow': 'crossbow', 'Heavy Crossbow': 'crossbow', 'Hand Crossbow': 'crossbow',
    Dagger: 'dagger', Sickle: 'sickle', Whip: 'whip'
  };
  const ROBED = ['Wizard', 'Sorcerer', 'Cleric', 'Warlock', 'Druid'];
  const HOOD_UP_ROBE = ['Warlock', 'Druid'];

  // The outfit: from the armour worn (heavy: plate; medium: mail, or furs for
  // hide; light: leather), a robe when one is carried, else the class's.
  function outfitOf(character) {
    const gear = character.gear || {};
    const robe = HOOD_UP_ROBE.includes(character.className) ? 'hoodedRobe' : 'robe';
    if (gear.armor === 'heavy') return 'plate';
    if (gear.armor === 'medium') return /hide/i.test(gear.armorName || '') ? 'fur' : 'mail';
    if (gear.armor === 'light') return 'leather';
    if (gear.robe || ROBED.includes(character.className)) return robe;
    const known = gear.weapon || gear.shield;
    const outfit = OUTFIT[character.className] || null;
    // Known gear but no armour: travelling clothes for those who'd wear it.
    return known && ['mail', 'plate', 'leather'].includes(outfit) ? 'coat' : outfit;
  }

  function figure(character, fill) {
    const build = character.build || 'neutral';
    const t = build === 'feminine' ? 1 : build === 'masculine' ? 0 : 0.5;
    const species = character.species;
    // Proportions: head size (bigger for the small folk) and breadth.
    const headScale = species === 'Dwarf' ? 1.2 : species === 'Halfling' || species === 'Gnome' ? 1.3 : species === 'Goliath' ? 0.94 : 1;
    const breadth = species === 'Dwarf' ? 1.3 : species === 'Goliath' ? 1.14 : species === 'Orc' ? 1.18 : species === 'Halfling' || species === 'Gnome' ? 1.08 : species === 'Elf' ? 0.94 : 1;
    const headH = 12.9 * headScale;
    const mapY = y => (y <= 12.9 ? y * headScale : headH + (y - 12.9) * (100 - headH) / (100 - 12.9));
    const body = list => list.map(p => P(p.x * breadth, mapY(p.y), p.s));
    const head = list => list.map(p => P(p.x * headScale, p.y * headScale, p.s));

    const bodyHalf = body(build === 'neutral' ? NEUTRAL_BODY : mix(BODY.masculine, BODY.feminine, t));
    const armRight = body(mix(ARM.masculine, ARM.feminine, build === 'neutral' ? 0.4 : t));
    const L = name => bodyHalf[{ neck: 2, trap: 3, trapOut: 4, shoulder: 5, deltoid: 6, armpit: 7, chest: 8, waist: 10, hip: 12, thigh: 13, knee: 15, calf: 16, shin: 17, ankle: 18, foot: 19, sole: 20, ankleIn: 21, calfIn: 22, kneeIn: 23 }[name]];
    const hand = P((armRight[6].x + armRight[7].x) / 2, (armRight[6].y + armRight[7].y) / 2);
    const back = [];
    const shapes = [];
    const front = [];
    const shape = (list, d, extra = {}) => list.push(svg('path', Object.assign({ d, fill }, extra)));
    const stroke = (list, d, width) => list.push(svg('path', { d, fill: 'none', stroke: fill, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    let left = -hand.x - 3;
    let right = hand.x + 3;
    const reach = (l, r) => { left = Math.min(left, l); right = Math.max(right, r); };
    const outfit = outfitOf(character);
    const gear = character.gear || {};
    // Rangers and rogues wear a hooded cloak (not over plate).
    const cloak = ['Ranger', 'Rogue'].includes(character.className) && outfit !== 'plate';
    const hoodWorn = outfit === 'hoodedRobe' || cloak;
    const hooded = hoodWorn && !HOOD_DOWN.includes(species);
    const hairLength = character.hairLength || (['Goliath', 'Dragonborn'].includes(species) ? 'bald' : DEFAULT_HAIR[build]);

    // Hair (behind the head), unless under a hood; dragonborn have none.
    if (!hooded && species !== 'Dragonborn' && HAIR[hairLength]) {
      shape(back, smooth(mirrored(head(HAIR[hairLength]))));
      if (hairLength === 'shaggy') SHAGGY_STRANDS.forEach(strand => shape(back, strandPath(strand, headScale)));
    }
    // A cloak behind (rangers and rogues).
    if (cloak) {
      // To the knees, so the legs show below it.
      shape(back, smooth(mirrored([P(0, mapY(16)), P(L('trapOut').x, mapY(17.4)), P(L('shoulder').x + 1.2, mapY(19.5)), P(L('deltoid').x + 2, mapY(32)), P(L('hip').x + 3, mapY(58)), P(L('hip').x + 4.6, mapY(75), 1), P(L('hip').x + 1, mapY(75.6)), P(0, mapY(76.5), 1)])));
      reach(-(L('hip').x + 5), L('hip').x + 5);
    }

    // The body, the arms and the head.
    shape(shapes, smooth(mirrored(bodyHalf)));
    const armShape = outfit === 'robe' || outfit === 'hoodedRobe'
      // Bell sleeves; the hand shows below.
      ? [armRight[0], armRight[1], P(armRight[1].x + 1.6, mapY(32)), P(hand.x + 3.4, mapY(46)), P(hand.x + 4.8, mapY(52), 1), P(armRight[8].x - 0.6, mapY(51.5), 1), P(armRight[9].x - 0.8, mapY(44)), P(armRight[12].x - 0.3, mapY(30)), armRight[13]]
      : armRight;
    shape(shapes, smooth(armShape));
    shape(shapes, smooth(flipX(armShape)));
    if (armShape !== armRight) {
      // The hands, just out of the sleeve.
      const hemY = mapY(52);
      shapes.push(svg('ellipse', { cx: f2(hand.x + 1), cy: f2(hemY + 1), rx: 1.9, ry: 2.4, fill }));
      shapes.push(svg('ellipse', { cx: f2(-hand.x - 1), cy: f2(hemY + 1), rx: 1.9, ry: 2.4, fill }));
      reach(-hand.x - 5.5, hand.x + 5.5);
    }
    shape(shapes, smooth(mirrored(head(species === 'Orc' ? ORC_HEAD : HEAD))));

    // The outfit, over the body.
    const legShape = points => { shape(shapes, smooth(points)); shape(shapes, smooth(flipX(points))); };
    switch (outfit) {
      case 'robe':
      case 'hoodedRobe':
        shape(shapes, smooth(mirrored([P(0, mapY(14.6)), P(L('neck').x + 0.4, mapY(15)), P(L('trapOut').x, mapY(17.6)), P(L('shoulder').x + 0.6, mapY(19.5)), P(L('armpit').x + 0.8, mapY(26)), P(L('waist').x + 1, mapY(38)), P(L('hip').x + 1.6, mapY(50)), P(L('hip').x + 4, mapY(72)), P(L('hip').x + 6.4, mapY(96)), P(L('hip').x + 7, mapY(99.8), 1), P(0, 100.3, 1)])));
        reach(-(L('hip').x + 7), L('hip').x + 7);
        if (character.className === 'Cleric') {
          // A hood down, round the neck.
          shape(shapes, smooth(mirrored([P(0, mapY(14)), P(L('neck').x + 2.2, mapY(13.6)), P(L('trapOut').x + 0.4, mapY(17)), P(L('trapOut').x - 1, mapY(19.4)), P(0, mapY(20.5))])));
        }
        break;
      case 'coat':
        shape(shapes, smooth(mirrored([P(0, mapY(15)), P(L('neck').x + 0.3, mapY(15.2)), P(L('trapOut').x + 0.2, mapY(17.6)), P(L('shoulder').x + 0.5, mapY(19.6)), P(L('armpit').x + 0.5, mapY(26)), P(L('waist').x + 0.8, mapY(38.5)), P(L('hip').x + 1.3, mapY(48)), P(L('hip').x + 3.4, mapY(63)), P(L('hip').x + 4.8, mapY(75), 1), P(L('hip').x + 0.6, mapY(75.6)), P(2.2, mapY(74.5)), P(0, mapY(73), 1)])));
        reach(-(L('hip').x + 5), L('hip').x + 5);
        break;
      case 'leather':
        // A fitted jerkin flaring at the hips, bracers, knee boots.
        shape(shapes, smooth(mirrored([P(0, mapY(15)), P(L('trapOut').x + 0.2, mapY(17.6)), P(L('shoulder').x + 0.4, mapY(19.6)), P(L('armpit').x + 0.4, mapY(26)), P(L('waist').x + 0.6, mapY(38.5)), P(L('hip').x + 1.2, mapY(48)), P(L('hip').x + 2.2, mapY(57), 1), P(L('hip').x - 1.2, mapY(56.4)), P(3.2, mapY(58.4), 1), P(0, mapY(56.5), 1)])));
        legShape([P(armRight[4].x + 0.7, mapY(39)), P(armRight[5].x + 0.7, mapY(46.5), 1), P(armRight[9].x - 0.7, mapY(46.5), 1), P(armRight[10].x - 0.7, mapY(39.5))]);
        legShape([P(L('knee').x + 0.6, mapY(76)), P(L('calf').x + 0.9, mapY(81)), P(L('shin').x + 1, mapY(89)), P(L('ankle').x + 1.1, mapY(95)), P(L('foot').x + 0.6, 99.8, 1), P(L('sole').x - 0.4, 99.8, 1), P(L('ankleIn').x - 0.6, mapY(94)), P(L('calfIn').x - 0.6, mapY(82)), P(L('kneeIn').x - 0.5, mapY(76.5))]);
        break;
      case 'plate': {
        // Full plate: a gorget, layered pauldrons, a breastplate, tassets,
        // gauntlets, greaves with knee cops.
        const sh = L('shoulder').x;
        shape(shapes, smooth(mirrored([P(0, mapY(13.6)), P(L('neck').x + 1.6, mapY(13.9)), P(L('neck').x + 2.4, mapY(16.8)), P(0, mapY(17.6))])));
        shape(shapes, smooth(mirrored([P(0, mapY(16.4)), P(L('neck').x + 1.4, mapY(16.6)), P(L('trapOut').x + 0.4, mapY(18.4)), P(L('armpit').x + 1, mapY(26)), P(L('chest').x + 1.3, mapY(29.5)), P(L('waist').x + 1.3, mapY(38)), P(L('waist').x + 1.6, mapY(41.5), 1), P(0, mapY(43), 1)])));
        legShape([P(L('trapOut').x - 2, mapY(18.2)), P(sh + 0.2, mapY(15.8)), P(sh + 5, mapY(18.4)), P(sh + 5.8, mapY(23.8), 1), P(sh + 1.8, mapY(22.8)), P(sh + 4.4, mapY(27.4), 1), P(sh - 0.2, mapY(26.2)), P(sh - 1.8, mapY(24.6), 1), P(L('trapOut').x - 2.8, mapY(21.4))]);
        shape(shapes, smooth(mirrored([P(0, mapY(41)), P(L('waist').x + 1.8, mapY(41.2)), P(L('hip').x + 2.6, mapY(50)), P(L('hip').x + 3.4, mapY(58.6), 1), P(L('hip').x + 0.2, mapY(58)), P(L('hip').x - 0.4, mapY(61), 1), P(3, mapY(60.2), 1), P(0, mapY(58.6), 1)])));
        legShape([P(L('knee').x + 1, mapY(66)), P(L('calf').x + 1.4, mapY(80)), P(L('shin').x + 1.3, mapY(89)), P(L('ankle').x + 1.4, mapY(95)), P(L('foot').x + 1, 99.8, 1), P(L('sole').x - 0.6, 99.8, 1), P(L('ankleIn').x - 0.8, mapY(94)), P(L('calfIn').x - 0.9, mapY(82)), P(L('kneeIn').x - 0.8, mapY(66))]);
        [1, -1].forEach(side => {
          shapes.push(svg('circle', { cx: f2(side * (L('knee').x + L('kneeIn').x) / 2), cy: f2(mapY(70.5)), r: f2((L('knee').x - L('kneeIn').x) / 2 + 1.6), fill }));
          shapes.push(svg('ellipse', { cx: f2(side * (hand.x + 0.3)), cy: f2(hand.y), rx: 2.4, ry: 2.8, fill }));
        });
        reach(-(sh + 6), sh + 6);
        break;
      }
      case 'mail':
        // Pauldrons, a mail skirt and greaves.
        legShape([P(L('trapOut').x - 1.6, mapY(18.6)), P(L('shoulder').x + 0.6, mapY(16.8)), P(L('shoulder').x + 3.8, mapY(19.2)), P(L('shoulder').x + 4.2, mapY(23.4), 1), P(L('shoulder').x + 1, mapY(22.6)), P(L('shoulder').x - 1.2, mapY(24.8), 1), P(L('trapOut').x - 2.4, mapY(21.4))]);
        shape(shapes, smooth(mirrored([P(0, mapY(39.5)), P(L('waist').x + 1, mapY(39.5)), P(L('hip').x + 2, mapY(52)), P(L('hip').x + 3.2, mapY(63), 1), P(L('hip').x - 1, mapY(62.4)), P(4.2, mapY(63.6), 1), P(0, mapY(63), 1)])));
        legShape([P(L('knee').x + 0.7, mapY(73.5)), P(L('calf').x + 1.1, mapY(80)), P(L('shin').x + 1.1, mapY(89)), P(L('ankle').x + 1.2, mapY(95)), P(L('foot').x + 0.7, 99.8, 1), P(L('sole').x - 0.5, 99.8, 1), P(L('ankleIn').x - 0.7, mapY(94)), P(L('calfIn').x - 0.7, mapY(82)), P(L('kneeIn').x - 0.6, mapY(74))]);
        reach(-(L('shoulder').x + 4.4), L('shoulder').x + 4.4);
        break;
      case 'fur': {
        // A ragged fur mantle and kilt, fur-topped boots.
        const s = L('shoulder').x;
        shape(shapes, smooth(mirrored([P(0, mapY(14.8)), P(L('neck').x + 0.6, mapY(15.2)), P(L('trapOut').x, mapY(16.2)), P(s + 2.8, mapY(18.4)), P(s + 3.6, mapY(22)), P(s + 2.4, mapY(27.5), 1), P(s + 0.4, mapY(25.2), 1), P(s - 1.6, mapY(28.4), 1), P(s - 3.6, mapY(25.6), 1), P(5.2, mapY(28.6), 1), P(2.8, mapY(25.8), 1), P(0, mapY(27.8), 1)])));
        const h = L('hip').x;
        shape(shapes, smooth(mirrored([P(0, mapY(43.5)), P(L('waist').x + 0.8, mapY(43.5)), P(h + 1.4, mapY(50)), P(h + 2.2, mapY(58)), P(h + 2.6, mapY(65), 1), P(h + 0.4, mapY(61), 1), P(h - 1.8, mapY(66), 1), P(4.6, mapY(61.4), 1), P(2.8, mapY(66.4), 1), P(0, mapY(62), 1)])));
        legShape([P(L('knee').x + 1.4, mapY(76), 1), P(L('knee').x - 0.2, mapY(78.5), 1), P(L('calf').x + 1.4, mapY(81)), P(L('shin').x + 1, mapY(89)), P(L('ankle').x + 1.2, mapY(95)), P(L('foot').x + 0.6, 99.8, 1), P(L('sole').x - 0.4, 99.8, 1), P(L('ankleIn').x - 0.6, mapY(94)), P(L('calfIn').x - 0.8, mapY(82)), P(L('kneeIn').x - 1.2, mapY(76.5), 1), P(L('kneeIn').x + 0.8, mapY(79), 1)]);
        reach(-(s + 3.8), s + 3.8);
        break;
      }
      case 'monk':
        // Loose trousers and a sash.
        legShape([P(L('hip').x + 0.8, mapY(50)), P(L('thigh').x + 1.6, mapY(60)), P(L('knee').x + 2.4, mapY(72)), P(L('calf').x + 2.2, mapY(84)), P(L('ankle').x + 1.2, mapY(92), 1), P(L('ankleIn').x - 0.6, mapY(92), 1), P(L('calfIn').x - 1, mapY(84)), P(L('kneeIn').x - 0.8, mapY(72)), P(1, mapY(55))]);
        shape(shapes, smooth([P(L('waist').x + 0.4, mapY(41)), P(L('hip').x + 1.6, mapY(45)), P(L('hip').x + 3, mapY(60)), P(L('hip').x + 2, mapY(61), 1), P(L('hip').x + 0.6, mapY(48))]));
        break;
      default:
        break;
    }
    // A hood down, round the neck (species that show it in the head).
    if (hoodWorn && !hooded) {
      shape(shapes, smooth(mirrored([P(0, mapY(14)), P(L('neck').x + 2.4, mapY(13.4)), P(L('trapOut').x + 0.8, mapY(17)), P(L('shoulder').x + 0.6, mapY(20.5)), P(L('armpit').x - 0.4, mapY(23.5), 1), P(0, mapY(22), 1)])));
    }
    // Hoods, over the head.
    if (hooded) {
      shape(shapes, smooth(mirrored([P(0, -2.8 * headScale), P(4.8 * headScale, -1.4 * headScale), P(6.8 * headScale, 2.6 * headScale), P(7.2 * headScale, 8.6 * headScale), P(6.6 * headScale, 13.4 * headScale), P(L('trapOut').x + 0.4, mapY(17.6)), P(L('shoulder').x + 1.2, mapY(21)), P(L('armpit').x, mapY(25.5), 1), P(0, mapY(23), 1)])));
    }

    // Species.
    const hs = headScale;
    const ears = (size, rise) => {
      const ear = [P(4.6 * hs, 5.2 * hs), P((5.2 + size) * hs, (5.4 - rise) * hs, 1), P(5.1 * hs, 8.2 * hs)];
      shape(shapes, smooth(ear)); shape(shapes, smooth(flipX(ear)));
    };
    const tail = width => {
      const h = L('hip').x;
      const outer = [P(h * 0.3, mapY(49)), P(h + 4, mapY(56)), P(h + 9, mapY(72)), P(h + 9.6, mapY(86)), P(h + 14, mapY(91), 1)];
      const inner = [P(h + 8.2, mapY(87)), P(h + 7.6 - width, mapY(73)), P(h + 3 - width, mapY(59)), P(h * 0.3, mapY(52))];
      shape(back, smooth([...outer, ...inner]));
      reach(left, h + 14.5);
    };
    switch (species) {
      case 'Elf': if (!hooded) ears(3.6, 4.8); break;
      case 'Gnome': if (!hooded) ears(2.4, 3); break;
      case 'Orc': {
        if (!hooded) ears(1.8, 1.8);
        // Tusks out past the jaw.
        const tusk = [P(2.9 * hs, 11.7 * hs), P(6.9 * hs, 7.9 * hs, 1), P(4.7 * hs, 12.2 * hs)];
        shape(shapes, smooth(tusk)); shape(shapes, smooth(flipX(tusk)));
        break;
      }
      case 'Tiefling': {
        // Horns sweeping up and back, and a tail.
        const horn = [P(1.6 * hs, 1 * hs), P(3.2 * hs, -3.6 * hs), P(6.6 * hs, -5.4 * hs), P(8.8 * hs, -2.6 * hs, 1), P(6.4 * hs, -3.2 * hs), P(4.6 * hs, -0.6 * hs), P(3.8 * hs, 1.6 * hs)];
        shape(shapes, smooth(horn)); shape(shapes, smooth(flipX(horn)));
        tail(1.2);
        break;
      }
      case 'Dragonborn': {
        // A crest of spikes, a heavy tail.
        const crest = [P(-3.6 * hs, 2 * hs), P(-2.6 * hs, -2.6 * hs, 1), P(-1.2 * hs, 0.6 * hs), P(0, -3.8 * hs, 1), P(1.2 * hs, 0.6 * hs), P(2.6 * hs, -2.6 * hs, 1), P(3.6 * hs, 2 * hs)];
        shape(shapes, smooth(crest));
        tail(2.6);
        break;
      }
      case 'Dwarf':
        // A beard over the chest.
        shape(shapes, smooth(mirrored([P(0, 9.6 * hs), P(4.6 * hs, 9 * hs), P(5.4 * hs, mapY(19)), P(4 * hs, mapY(27)), P(1.6, mapY(31), 1), P(0, mapY(29.5), 1)])));
        break;
      case 'Aasimar':
        shapes.push(svg('ellipse', { cx: 0, cy: -3 * hs, rx: 5 * hs, ry: 1.4, fill: 'none', stroke: fill, 'stroke-width': 0.9 }));
        break;
      case 'Halfling':
        if (!hooded && hairLength !== 'bald') [-0.55, 0, 0.55].forEach(offset => shapes.push(svg('circle', { cx: f2(offset * 4.6 * hs), cy: f2(0.6 * hs), r: f2(2.3 * hs), fill })));
        break;
      default:
        break;
    }

    // Props: the weapon in hand (by kind), else the class's; a shield worn on
    // the left arm. Right hand (x > 0) unless said otherwise.
    const hx = hand.x;
    const hy = hand.y;
    const kind = WEAPON_PROP[gear.weapon] || CLASS_PROP[character.className] || null;
    const hasGear = Boolean(gear.weapon || gear.armor || gear.shield);
    const shield = gear.shield || (!hasGear && character.className === 'Paladin');
    const blade = (baseX, baseY, tipX, tipY, width) => {
      const dx = tipX - baseX; const dy = tipY - baseY; const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length * width / 2; const ny = dx / length * width / 2;
      shape(front, smooth([P(baseX + nx, baseY + ny, 1), P(tipX, tipY, 1), P(baseX - nx, baseY - ny, 1)]));
    };
    switch (kind) {
      case 'staff':
        if (character.className === 'Druid') {
          const x = hx + 2.2;
          stroke(front, `M ${f2(x)} 100 Q ${f2(x + 0.8)} 60 ${f2(x)} 14 Q ${f2(x - 0.4)} 4 ${f2(x + 4)} 3.6 Q ${f2(x + 7.4)} 5 ${f2(x + 5)} 9 Q ${f2(x + 3)} 10 ${f2(x + 3)} 7.6`, 1.4);
          [[x + 1, 15, -30], [x - 1.6, 20, 30], [x + 1.4, 24, -20]].forEach(([lx, ly, angle]) => front.push(svg('ellipse', { cx: f2(lx), cy: ly, rx: 1.8, ry: 0.8, fill, transform: `rotate(${angle} ${f2(lx)} ${ly})` })));
          reach(left, x + 7.6);
        } else if (character.className === 'Monk') {
          stroke(front, `M ${f2(-hx - 7)} 12 L ${f2(hx + 8)} 98`, 1.4);
          reach(-hx - 7.6, hx + 8.6);
        } else {
          // A gnarled staff; a wizard's holds a crystal in claws.
          const x = hx + 2.2;
          shape(front, smooth([P(x - 0.7, 100, 1), P(x + 0.3, 70), P(x - 0.6, 40), P(x + 0.2, 12), P(x - 0.5, 4, 1), P(x + 0.9, 4, 1), P(x + 1.1, 12), P(x + 0.5, 40), P(x + 1.2, 70), P(x + 0.7, 100, 1)]));
          if (character.className === 'Wizard') {
            shape(front, smooth([P(x + 0.2, -4.4, 1), P(x + 1.8, -0.4), P(x + 0.2, 3.4, 1), P(x - 1.4, -0.4)]));
            stroke(front, `M ${f2(x - 0.4)} 4.4 Q ${f2(x - 2.8)} 1 ${f2(x - 1.2)} -2.2 M ${f2(x + 0.8)} 4.4 Q ${f2(x + 3.2)} 1 ${f2(x + 1.6)} -2.2`, 0.7);
          }
          reach(left, x + 3.4);
        }
        break;
      case 'orb':
        front.push(svg('circle', { cx: f2(hx + 1.6), cy: f2(hy - 4.6), r: 3.2, fill }));
        shape(front, smooth([P(hx - 0.6, hy - 6.4), P(hx + 0.4, hy - 11, 1), P(hx + 1.6, hy - 8.2), P(hx + 2.4, hy - 12.6, 1), P(hx + 3.2, hy - 8.4), P(hx + 4.4, hy - 10.4, 1), P(hx + 4.2, hy - 6)]));
        reach(left, hx + 5);
        break;
      case 'tome':
        shape(front, smooth([P(-hx + 0.6, hy - 1.6), P(-hx - 4.4, hy - 4.4), P(-hx - 9.6, hy - 3.2, 1), P(-hx - 9.2, hy + 5.4, 1), P(-hx - 4.2, hy + 4.4), P(-hx + 0.8, hy + 6.6, 1), P(-hx + 5.6, hy + 3.4, 1), P(-hx + 5.2, hy - 4.6, 1)]));
        reach(-hx - 10, right);
        break;
      case 'lute': {
        const cx = -hx + 2.4;
        const cy = hy + 1;
        front.push(svg('ellipse', { cx: f2(cx), cy: f2(cy), rx: 4.4, ry: 5.6, fill, transform: `rotate(-38 ${f2(cx)} ${f2(cy)})` }));
        stroke(front, `M ${f2(cx + 2)} ${f2(cy - 3)} L ${f2(hx - 1)} ${f2(hy - 15)} L ${f2(hx + 1.6)} ${f2(hy - 14.4)}`, 1.1);
        reach(cx - 5.6, right);
        break;
      }
      case 'mace':
      case 'flail': {
        const cx = hx + 2.8;
        const cy = hy + 18;
        if (kind === 'mace') {
          stroke(front, `M ${f2(hx)} ${f2(hy - 1)} L ${f2(hx + 2.4)} ${f2(hy + 15)}`, 1.3);
        } else {
          // A short handle, a chain, a spiked ball.
          stroke(front, `M ${f2(hx)} ${f2(hy - 1)} L ${f2(hx + 0.8)} ${f2(hy + 7)}`, 1.3);
          stroke(front, `M ${f2(hx + 0.8)} ${f2(hy + 7)} Q ${f2(hx + 3.4)} ${f2(hy + 11)} ${f2(cx)} ${f2(cy - 3)}`, 0.5);
        }
        shape(front, smooth(Array.from({ length: 12 }, (_, i) => {
          const angle = (i / 12) * Math.PI * 2;
          const radius = i % 2 ? 2 : 3.6;
          return P(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 1.2, 1);
        })));
        reach(left, cx + 3.8);
        break;
      }
      case 'sword':
        blade(hx + 0.4, hy + 2.8, hx + 7.6, hy + 33, 1.9);
        stroke(front, `M ${f2(hx - 2.4)} ${f2(hy + 3.6)} L ${f2(hx + 3.4)} ${f2(hy + 2)}`, 1);
        stroke(front, `M ${f2(hx + 0.4)} ${f2(hy + 2.8)} L ${f2(hx - 0.4)} ${f2(hy - 1.8)}`, 1);
        front.push(svg('circle', { cx: f2(hx - 0.6), cy: f2(hy - 2.4), r: 1, fill }));
        reach(left, hx + 8);
        break;
      case 'greatsword':
        // Point down, nearly to the ground, both hands' grip above.
        blade(hx + 0.6, hy + 3.4, hx + 5.4, 98, 2.6);
        stroke(front, `M ${f2(hx - 3.4)} ${f2(hy + 4.2)} L ${f2(hx + 4.6)} ${f2(hy + 2.4)}`, 1.3);
        stroke(front, `M ${f2(hx + 0.6)} ${f2(hy + 3.4)} L ${f2(hx - 0.6)} ${f2(hy - 4.6)}`, 1.2);
        front.push(svg('circle', { cx: f2(hx - 0.8), cy: f2(hy - 5.4), r: 1.2, fill }));
        reach(left, hx + 6);
        break;
      case 'scimitar':
        shape(front, `M ${f2(hx)} ${f2(hy + 2.6)} Q ${f2(hx + 9)} ${f2(hy + 12)} ${f2(hx + 6)} ${f2(hy + 28)} Q ${f2(hx + 5.6)} ${f2(hy + 14)} ${f2(hx - 1)} ${f2(hy + 3.4)} Z`);
        stroke(front, `M ${f2(hx - 2)} ${f2(hy + 3.2)} L ${f2(hx + 2.6)} ${f2(hy + 2.2)}`, 1);
        reach(left, hx + 8.4);
        break;
      case 'rapier':
        stroke(front, `M ${f2(hx + 0.4)} ${f2(hy + 2.6)} L ${f2(hx + 6.4)} ${f2(hy + 34)}`, 0.6);
        front.push(svg('circle', { cx: f2(hx + 0.6), cy: f2(hy + 2.4), r: 2, fill }));
        reach(left, hx + 7);
        break;
      case 'axe':
        // One-handed, head down by the leg.
        stroke(front, `M ${f2(hx)} ${f2(hy - 1)} L ${f2(hx + 2)} ${f2(hy + 16)}`, 1.3);
        shape(front, smooth([P(hx + 1.4, hy + 11.4), P(hx + 6.4, hy + 9.6, 1), P(hx + 7.6, hy + 14), P(hx + 6.4, hy + 18.6, 1), P(hx + 1.8, hy + 16)]));
        reach(left, hx + 8);
        break;
      case 'greataxe': {
        // Double-bitted, over the right shoulder.
        const top = P(hx - 6, -9);
        stroke(front, `M ${f2(hx + 0.6)} ${f2(hy + 4)} L ${f2(top.x)} ${f2(top.y)}`, 1.7);
        const bit = side => [P(top.x + 0.4 * side, top.y - 2.6), P(top.x + 7 * side, top.y - 7.4, 1), P(top.x + 9.4 * side, top.y + 0.6), P(top.x + 7.6 * side, top.y + 8, 1), P(top.x + 0.6 * side, top.y + 4)];
        shape(front, smooth(bit(1)));
        shape(front, smooth(bit(-1)));
        reach(Math.min(left, top.x - 9.6), Math.max(right, top.x + 9.6, hx + 2));
        break;
      }
      case 'hammer':
        stroke(front, `M ${f2(hx)} ${f2(hy)} L ${f2(hx + 1.6)} ${f2(hy + 12)}`, 1.2);
        shape(front, smooth([P(hx - 1.6, hy + 10.6, 1), P(hx + 4.6, hy + 10, 1), P(hx + 4.8, hy + 13.6, 1), P(hx - 1.4, hy + 14.2, 1)]));
        reach(left, hx + 5.2);
        break;
      case 'maul':
        // A great hammer, head down beside the leg.
        stroke(front, `M ${f2(hx)} ${f2(hy - 2)} L ${f2(hx + 2.6)} ${f2(hy + 30)}`, 1.5);
        shape(front, smooth([P(hx - 1.6, hy + 28, 1), P(hx + 7, hy + 27, 1), P(hx + 7.4, hy + 34, 1), P(hx - 1.2, hy + 35, 1)]));
        reach(left, hx + 7.8);
        break;
      case 'club':
        shape(front, smooth([P(hx - 0.6, hy - 1, 1), P(hx + 0.8, hy - 1.2, 1), P(hx + 4.4, hy + 16), P(hx + 2.6, hy + 19), P(hx + 1.2, hy + 16)]));
        reach(left, hx + 5);
        break;
      case 'spear':
        // A long shaft, butt on the ground, a leaf blade above the head.
        stroke(front, `M ${f2(hx + 2)} 100 L ${f2(hx + 2)} 0`, 1.2);
        shape(front, smooth([P(hx + 2, -8, 1), P(hx + 3.6, -2.4), P(hx + 2, 1, 1), P(hx + 0.4, -2.4)]));
        reach(left, hx + 4);
        break;
      case 'halberd':
        stroke(front, `M ${f2(hx + 2)} 100 L ${f2(hx + 2)} -4`, 1.3);
        shape(front, smooth([P(hx + 2, -10, 1), P(hx + 3, -5), P(hx + 2, -3, 1), P(hx + 1, -5)]));
        shape(front, smooth([P(hx + 2.4, -4, 1), P(hx + 8, -6.4, 1), P(hx + 9, 0), P(hx + 7.6, 4.6, 1), P(hx + 2.4, 2, 1)]));
        shape(front, smooth([P(hx + 1.6, -2.6, 1), P(hx - 2.6, -0.6, 1), P(hx + 1.6, 1, 1)]));
        reach(hx - 3, hx + 9.4);
        break;
      case 'bow': {
        const x = -hx - 1;
        stroke(front, `M ${f2(x + 1.6)} ${f2(hy - 30)} Q ${f2(x - 1)} ${f2(hy - 27)} ${f2(x - 1.4)} ${f2(hy - 20)} Q ${f2(x - 7)} ${f2(hy)} ${f2(x - 1.4)} ${f2(hy + 20)} Q ${f2(x - 1)} ${f2(hy + 27)} ${f2(x + 1.6)} ${f2(hy + 29)}`, 1.3);
        stroke(front, `M ${f2(x + 1.2)} ${f2(hy - 29.4)} L ${f2(x + 1.2)} ${f2(hy + 28.4)}`, 0.3);
        reach(x - 6, right);
        break;
      }
      case 'crossbow':
        // Held at the hip, pointing out: stock, and the bow across.
        shape(front, smooth([P(hx - 2, hy - 1.6, 1), P(hx + 9, hy - 3.4, 1), P(hx + 9.2, hy - 1.8, 1), P(hx - 1.6, hy + 0.6, 1)]));
        stroke(front, `M ${f2(hx + 7.6)} ${f2(hy - 9)} Q ${f2(hx + 10.4)} ${f2(hy - 2.6)} ${f2(hx + 7.8)} ${f2(hy + 3.6)}`, 1.1);
        reach(left, hx + 10.6);
        break;
      case 'dagger':
        blade(hx + 0.4, hy + 2.6, hx + 1.8, hy + 12, 1.6);
        stroke(front, `M ${f2(hx - 1.4)} ${f2(hy + 2.8)} L ${f2(hx + 2.2)} ${f2(hy + 2.2)}`, 0.8);
        break;
      case 'daggers':
        [1, -1].forEach(side => {
          blade(side * (hx + 0.4), hy + 2.6, side * (hx + 1.8), hy + 12, 1.6);
          stroke(front, `M ${f2(side * (hx - 1.4))} ${f2(hy + 2.8)} L ${f2(side * (hx + 2.2))} ${f2(hy + 2.2)}`, 0.8);
        });
        break;
      case 'sickle':
        stroke(front, `M ${f2(hx)} ${f2(hy)} L ${f2(hx + 0.8)} ${f2(hy + 6)}`, 1.1);
        stroke(front, `M ${f2(hx + 0.8)} ${f2(hy + 6)} Q ${f2(hx + 7)} ${f2(hy + 6)} ${f2(hx + 6.4)} ${f2(hy + 12)}`, 1.1);
        reach(left, hx + 7.2);
        break;
      case 'whip':
        // Coiled at the hip.
        [0, 1.4].forEach(offset => shapes.push(svg('ellipse', { cx: f2(hx + 1.8), cy: f2(hy + 3 + offset), rx: 3, ry: 2, fill: 'none', stroke: fill, 'stroke-width': 0.7 })));
        reach(left, hx + 5);
        break;
      default:
        break;
    }
    if (shield) {
      // A kite shield on the left arm.
      shape(front, smooth([P(-hx + 3.4, hy - 24, 1), P(-hx - 3, hy - 25.4), P(-hx - 9, hy - 24, 1), P(-hx - 8.2, hy - 13), P(-hx - 3, hy - 2, 1), P(-hx + 2.6, hy - 13)]));
      reach(-hx - 9.4, right);
    }
    return { shapes: [...back, ...shapes, ...front], left, right };
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
      noBuild.length ? el('p', { className: 'muted small', text: 'No build chosen yet (drawn neutral): ' + noBuild.map(character => character.name).join(', ') + '.' }) : ''
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
