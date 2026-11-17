// views/loginBackdrop.js — The night scene behind the login and change
// password card: stars, a moon with a dragon crossing it, mountains, a castle
// on its wooded island with a drawbridge to the land, and Grimbold's shop
// with lit windows. Inline SVG (no images to
// load), drawn once at start; stars twinkle and windows flicker unless the
// viewer prefers reduced motion.

'use strict';

// A fixed seed: the same sky every time.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function stars() {
  const random = seeded(7);
  return Array.from({ length: 170 }, (_, index) => {
    const x = Math.round(random() * 1600);
    const y = Math.round(Math.pow(random(), 1.6) * 560);
    const r = (random() * 1.3 + 0.4).toFixed(2);
    const twinkle = index % 5 === 0 ? ` class="twinkle" style="animation-delay:${(random() * 4).toFixed(2)}s"` : '';
    return `<circle cx="${x}" cy="${y}" r="${r}" opacity="${(random() * 0.6 + 0.35).toFixed(2)}"${twinkle}/>`;
  }).join('');
}

// A pine: a trunk-less stack of three tiers, base at (x, y), height h.
const pine = (x, y, h) => {
  const w = h * 0.42;
  return `<path d="M${x} ${y - h} L${x + w * 0.55} ${y - h * 0.62} L${x + w * 0.3} ${y - h * 0.62} L${x + w * 0.8} ${y - h * 0.28} L${x + w * 0.45} ${y - h * 0.28} L${x + w} ${y} L${x - w} ${y} L${x - w * 0.45} ${y - h * 0.28} L${x - w * 0.8} ${y - h * 0.28} L${x - w * 0.3} ${y - h * 0.62} L${x - w * 0.55} ${y - h * 0.62} Z"/>`;
};

// A tower: walls from (x, top) to the ground at y, a pointed roof, a window.
const tower = (x, top, width, y, lit = true) => `
  <rect x="${x - width / 2}" y="${top}" width="${width}" height="${y - top}"/>
  <path d="M${x - width / 2 - 6} ${top} L${x} ${top - width * 1.3} L${x + width / 2 + 6} ${top} Z"/>
  ${lit ? `<rect class="window" x="${x - 3}" y="${top + 18}" width="6" height="10" rx="3"/>` : ''}`;

const SVG = `
<svg class="backdrop" viewBox="0 0 1600 900" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070b1d"/>
      <stop offset="0.55" stop-color="#141c3d"/>
      <stop offset="0.85" stop-color="#2e2a4f"/>
      <stop offset="1" stop-color="#4a3555"/>
    </linearGradient>
    <radialGradient id="moonGlow">
      <stop offset="0" stop-color="#f6ecc8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#f6ecc8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="windowGlow">
      <stop offset="0" stop-color="#ffb347" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8f86b8" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#8f86b8" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#8f86b8" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <g fill="#fdf8e8">${stars()}</g>

  <!-- The moon, and a dragon crossing it. -->
  <circle cx="1240" cy="190" r="190" fill="url(#moonGlow)"/>
  <circle cx="1240" cy="190" r="72" fill="#f3e9c6"/>
  <circle cx="1214" cy="172" r="12" fill="#e2d6ad"/><circle cx="1262" cy="214" r="8" fill="#e2d6ad"/><circle cx="1258" cy="160" r="5" fill="#e2d6ad"/>
  <g class="dragon" fill="#0b0f22" transform="translate(1236 214) scale(0.82)">
    <!-- The far wing, lower. -->
    <path d="M6 10 Q-6 30 -30 44 L-66 58 Q-52 44 -50 34 Q-36 32 -26 22 Q-14 20 -4 12 Z"/>
    <!-- Body, neck and head (snout to the right), tail behind. -->
    <path d="M-112 22 Q-80 22 -50 10 Q-20 0 10 0 Q35 -2 52 -16 Q62 -26 74 -28 L92 -24 L97 -19 L80 -16 Q66 -14 58 -6 Q44 8 20 14 Q-10 22 -48 22 Q-80 30 -112 22 Z"/>
    <path d="M73 -27 L62 -42 L79 -29 Z M67 -25 L54 -36 L71 -26 Z"/>
    <path d="M-110 22 L-134 12 L-125 24 L-136 34 Z"/>
    <path d="M-40 20 L-48 36 L-36 33 Z M10 12 L6 26 L16 22 Z"/>
    <!-- The near wing, raised: arm to the wrist, three fingers, a scalloped edge. -->
    <path d="M22 2 Q18 -36 -2 -68 L-84 -88 Q-64 -70 -68 -48 Q-52 -42 -42 -24 Q-28 -16 -10 4 Z"/>
    <path d="M-2 -68 L-66 -46 M-2 -68 L-40 -23" stroke="#0b0f22" stroke-width="2.5"/>
  </g>

  <!-- Far and near mountains. -->
  <path fill="#1d2142" d="M0 560 L120 470 L210 520 L330 410 L450 500 L560 440 L700 530 L820 450 L960 520 L1080 430 L1200 500 L1330 420 L1460 510 L1600 450 L1600 900 L0 900 Z"/>
  <path fill="#161a35" d="M0 640 L140 560 L260 610 L400 540 L540 620 L680 570 L820 640 L980 560 L1120 630 L1280 570 L1430 640 L1600 590 L1600 900 L0 900 Z"/>
  <rect y="560" width="1600" height="160" fill="url(#mist)"/>

  <!-- The castle on its hill. -->
  <g fill="#10142b">
    <path d="M60 760 Q200 600 380 610 Q520 620 640 760 Z"/>
    <rect x="260" y="560" width="190" height="80"/>
    <path d="M260 560 h12 v-10 h12 v10 h12 v-10 h12 v10 h12 v-10 h12 v10 h12 v-10 h12 v10 h12 v-10 h12 v10 h12 v-10 h12 v10 h12 v-10 h12 v10 h22 v6 h-190 Z"/>
    ${tower(260, 520, 34, 640)}${tower(450, 530, 30, 640)}${tower(355, 470, 40, 600)}
  </g>
  <!-- Pines on the island's slopes, either side of the castle. -->
  <g fill="#0c1024">${[[100, 724, 40], [140, 694, 52], [178, 672, 44], [216, 654, 36], [492, 660, 40], [528, 668, 50], [566, 696, 54], [602, 728, 42], [628, 756, 30]].map(([x, y, h]) => pine(x, y, h)).join('')}</g>
  <!-- The gate, the path down to the shore and the drawbridge, lowered onto
       the land across the water, its chains running up to the gatehouse. -->
  <path d="M345 640 V624 Q355 612 365 624 V640 Z" fill="#05070f"/>
  <path d="M355 640 Q372 676 404 704 Q424 726 420 758" fill="none" stroke="#1a1f3a" stroke-width="9" stroke-linecap="round"/>
  <g fill="#232842">
    <rect x="394" y="728" width="9" height="34"/><rect x="437" y="728" width="9" height="34"/>
    <path d="M392 728 L398 718 L405 728 Z M435 728 L441 718 L448 728 Z"/>
  </g>
  <path d="M402 760 L438 760 L456 824 L384 824 Z" fill="#3a3046"/>
  <path d="M400 768 H440 M397 778 H443 M394 788 H446 M391 798 H449 M388 808 H452 M386 817 H454 M420 760 V824" stroke="#14111f" stroke-width="1.5"/>
  <path d="M386 822 L398 732 M454 822 L442 732" stroke="#5a5470" stroke-width="1.4" stroke-dasharray="3 2"/>
  <g class="lights" fill="#ffc266">
    <rect class="window" x="300" y="590" width="7" height="11" rx="3.5"/><rect class="window" x="400" y="596" width="7" height="11" rx="3.5" style="animation-delay:1.3s"/>
  </g>

  <!-- Pines on the land (their feet behind the ground drawn below). -->
  <g fill="#0c1024">${[[600, 842, 70], [645, 846, 92], [690, 844, 64], [1420, 845, 88], [1465, 848, 110], [1515, 852, 76], [1565, 860, 96], [30, 830, 90], [80, 826, 70]].map(([x, y, h]) => pine(x, y, h)).join('')}</g>

  <!-- Grimbold's shop: a timbered house with a hanging sign and smoke. -->
  <g class="smoke" fill="#b9b3d6" opacity="0.18">
    <circle cx="1252" cy="560" r="14"/><circle cx="1262" cy="530" r="18"/><circle cx="1276" cy="494" r="24"/><circle cx="1296" cy="452" r="30"/>
  </g>
  <circle cx="1170" cy="720" r="150" fill="url(#windowGlow)" opacity="0.6"/>
  <g fill="#0a0d1e">
    <rect x="1240" y="575" width="26" height="70"/>
    <path d="M1040 690 L1150 590 L1290 590 L1320 690 Z"/>
    <rect x="1060" y="690" width="250" height="140"/>
    <!-- The ground: rolling, and level under the shop and its sign (y 830). -->
    <path d="M0 900 L0 822 Q200 795 420 815 Q660 838 880 832 Q950 829 980 830 L1350 830 Q1470 833 1600 852 L1600 900 Z"/>
    <!-- The sign's post, planted in the ground, with a small mound at its foot. -->
    <rect x="1022" y="704" width="5" height="128"/><rect x="996" y="708" width="52" height="5"/>
    <path d="M1010 832 Q1024 822 1039 832 Z"/>
    <rect x="1000" y="720" width="44" height="30" rx="4"/>
  </g>
  <g class="lights" fill="#ffc266">
    <rect class="window" x="1090" y="720" width="34" height="40" rx="2"/>
    <rect class="window" x="1240" y="720" width="34" height="40" rx="2" style="animation-delay:0.8s"/>
    <rect x="1170" y="760" width="36" height="70" rx="17" fill="#e89a3c"/>
  </g>
  <g stroke="#0a0d1e" stroke-width="3">
    <path d="M1107 720 v40 M1090 740 h34 M1257 720 v40 M1240 740 h34"/>
  </g>
  <!-- A stone foundation along the base and a doorstep, catching the light. -->
  <g fill="#1a1f3a">
    <rect x="1054" y="824" width="262" height="7" rx="2"/>
    <rect x="1162" y="828" width="52" height="5" rx="2" fill="#3a3046"/>
  </g>
  <path d="M1066 824 v7 M1092 824 v7 M1120 824 v7 M1148 824 v7 M1228 824 v7 M1256 824 v7 M1284 824 v7" stroke="#0a0d1e" stroke-width="1.5"/>
  <!-- A coin on the sign. -->
  <circle cx="1022" cy="735" r="9" fill="#c9a34a"/>

  <rect width="1600" height="900" fill="url(#vignette)"/>
</svg>`;

const STYLE = `
  /* Covers the screen at its own shape, the ground at the bottom. On narrow
     screens it centres on the shop and the moon (70% across), never leaving
     a gap at either side. */
  .backdrop {
    --w: max(100vw, 177.78vh);
    position: fixed; bottom: 0; z-index: -1;
    width: var(--w); height: calc(var(--w) * 0.5625);
    left: clamp(calc(100vw - var(--w)), calc(50vw - var(--w) * 0.7), 0px);
  }
  .backdrop .twinkle { animation: twinkle 4s ease-in-out infinite; }
  .backdrop .window { animation: flicker 5s ease-in-out infinite; }
  .backdrop .smoke { animation: drift 9s ease-in-out infinite alternate; }
  @keyframes twinkle { 0%, 100% { opacity: 0.9; } 50% { opacity: 0.2; } }
  @keyframes flicker { 0%, 100% { opacity: 1; } 45% { opacity: 0.85; } 50% { opacity: 0.7; } 55% { opacity: 0.92; } }
  @keyframes drift { from { transform: translate(0, 0); } to { transform: translate(-14px, -6px); } }
  @media (prefers-reduced-motion: reduce) { .backdrop * { animation: none !important; } }
`;

module.exports = { LOGIN_BACKDROP: SVG, LOGIN_BACKDROP_STYLE: STYLE };
