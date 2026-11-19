// scripts/town-templates.js — Starter artisans, weekly shop events and
// happening lines for Grimbold's town. Edit freely, then load them with
// `node scripts/seed-town.js` (see that file). Prices are in gold pieces and
// follow the 2024 Player's Handbook where the item is a standard one.
// Names: gear carries its maker's name ("Brandt Dagger", "Hollowell Leather
// Armor"). The sheet still recognises the Dagger or Leather Armor inside it,
// while an artisan good named exactly like a catalog item would replace that
// item's regular (unlimited) stock on the shelf.
//
// artisans  — resident ones supply every weekly restock (per_week of each
//             good, up to cap on the shelf); travelling ones only come with a
//             "merchant" event that names them.
// events    — the weekly event list (Restock Engine tab): merchant, shortage,
//             sale or news, picked by weight.
// happenings — lines for the twice-a-day happenings (not built yet): each
//             artisan's own voice, flash sales, passing peddlers, masterwork
//             one-offs, commissions, mishaps and rumours.

'use strict';

const artisans = [
  // ─── Resident artisans ────────────────────────────────────────────────────
  {
    name: 'Benet Hollowell',
    mode: 'resident',
    description: 'Leatherworker with a shop two doors down. Smells of tannin and pipe smoke, argues about stitching like other men argue about politics.',
    goods: [
      { name: 'Hollowell Leather Armor', category: 'Armor', price_gp: 10, per_week: 1, cap: 2, description: 'Boiled and oiled cuirass with soft shoulder pieces. Benet stamps a little hollow-tree mark inside the collar.' },
      { name: 'Hollowell Studded Leather Armor', category: 'Armor', price_gp: 45, per_week: 1, cap: 1, description: 'Tough leather set with close-spaced brass rivets. Takes Benet most of the week.' },
      { name: 'Hollowell Backpack', category: 'Adventuring Gear', price_gp: 2, per_week: 2, cap: 4, description: 'Double-stitched, with a flap that actually stays shut in the rain.' },
      { name: 'Hollowell Quiver', category: 'Adventuring Gear', price_gp: 1, per_week: 2, cap: 4, description: 'Holds 20 arrows; the strap is long enough for a dwarf or an elf, Benet insists.' },
      { name: "Benet's Map Case", category: 'Artisan Goods', price_gp: 3, per_week: 1, cap: 2, description: 'A waxed leather tube that keeps maps and scrolls dry through a river crossing.' }
    ]
  },
  {
    name: 'Marta Kessling',
    mode: 'resident',
    description: 'Bowyer and fletcher. Ex-militia, eagle-eyed, tests every bow on the target behind the smithy before she will sell it.',
    goods: [
      { name: 'Kessling Shortbow', category: 'Weapons', price_gp: 25, per_week: 1, cap: 2, description: 'Yew and horn, light enough for a halfling to draw all day.' },
      { name: 'Kessling Longbow', category: 'Weapons', price_gp: 50, per_week: 1, cap: 1, description: 'A tall ash bow. Marta will string it for you, once, and laugh while you try.' },
      { name: 'Kessling Arrows (20)', category: 'Ammunition', price_gp: 1, per_week: 3, cap: 8, description: 'Goose-fletched and straight. Bundled in twenties with twine.' },
      { name: 'Kessling Hunting Trap', category: 'Adventuring Gear', price_gp: 5, per_week: 1, cap: 2, description: 'A sprung-steel jaw trap with a chain and stake.' },
      { name: 'Whistling Arrows (5)', category: 'Artisan Goods', price_gp: 2, per_week: 1, cap: 3, description: 'Hollow bone heads that shriek in flight. Useless for hunting, perfect for signalling across a valley.' }
    ]
  },
  {
    name: 'Old Tobb Rennick',
    mode: 'resident',
    description: 'Herbalist who has been "about to retire" for twenty years. Keeps a jackdaw named Councillor that steals buttons.',
    goods: [
      { name: "Rennick's Healer's Kit", category: 'Adventuring Gear', price_gp: 5, per_week: 2, cap: 4, description: 'Bandages, salves and splints for ten uses, packed in a tin that smells of camphor.' },
      { name: "Rennick's Antitoxin", category: 'Adventuring Gear', price_gp: 50, per_week: 1, cap: 2, description: "Tobb's bitter green tincture. Advantage on saves against poison for an hour; tastes like a pond." },
      { name: "Rennick's Herbalism Kit", category: 'Tools', price_gp: 5, per_week: 1, cap: 2, description: 'Clippers, mortar and pestle, and little labelled pouches in Tobb\'s spidery hand.' },
      { name: "Tobb's Wakeful Tea (3 doses)", category: 'Artisan Goods', price_gp: 1, per_week: 2, cap: 4, description: 'A brew that keeps a night watch awake and twitchy. Tobb swears by it; Tobb has not slept since spring.' },
      { name: 'Smelling Salts', category: 'Artisan Goods', price_gp: 0.5, per_week: 2, cap: 5, description: 'Sharp enough to make the stones blink. Good for waking the faint-hearted.' }
    ]
  },
  {
    name: 'Ilsa Brandt',
    mode: 'resident',
    description: 'Blacksmith with forearms like hams and a laugh you can hear from the well. Mostly shoes horses; makes blades when the town is nervous.',
    goods: [
      { name: 'Brandt Dagger', category: 'Weapons', price_gp: 2, per_week: 2, cap: 5, description: 'Plain, sharp and balanced for throwing.' },
      { name: 'Brandt Handaxe', category: 'Weapons', price_gp: 5, per_week: 1, cap: 3, description: 'A short-hafted axe that splits kindling and skulls alike.' },
      { name: 'Brandt Light Hammer', category: 'Weapons', price_gp: 2, per_week: 1, cap: 3, description: "A smith's hammer with a better balance than it needs." },
      { name: 'Brandt Shield', category: 'Armor', price_gp: 10, per_week: 1, cap: 2, description: 'Oak boards under an iron rim, painted any colour you like (blue costs extra, Ilsa says, and never explains why).' },
      { name: 'Brandt Iron Spikes (10)', category: 'Adventuring Gear', price_gp: 1, per_week: 2, cap: 4, description: 'For jamming doors, climbing walls and hanging lanterns in caves.' },
      { name: 'Brandt Caltrops (bag of 20)', category: 'Adventuring Gear', price_gp: 1, per_week: 1, cap: 3, description: 'Four-pointed iron stars. Ilsa makes them from horseshoe offcuts.' }
    ]
  },
  {
    name: 'Vessa Quillmoth',
    mode: 'resident',
    description: 'Alchemist, gnome, perpetually singed eyebrows. Her shop window has been replaced four times this year.',
    goods: [
      { name: "Quillmoth Alchemist's Fire", category: 'Adventuring Gear', price_gp: 50, per_week: 1, cap: 2, description: 'A clay flask of sticky fire. Throw it, then step back.' },
      { name: 'Quillmoth Acid', category: 'Adventuring Gear', price_gp: 25, per_week: 1, cap: 2, description: 'A stoppered vial that eats through cloth, leather and patience.' },
      { name: 'Quillmoth Jasmine Perfume', category: 'Adventuring Gear', price_gp: 5, per_week: 1, cap: 3, description: 'Night-blooming jasmine with a hint of something Vessa will not name.' },
      { name: "Vessa's Smokestick", category: 'Artisan Goods', price_gp: 10, per_week: 1, cap: 3, description: 'Strike it and it pours thick grey smoke for a minute, heavily obscuring a 10-foot radius. Mostly safe.' },
      { name: 'Glowing Chalk (5 sticks)', category: 'Artisan Goods', price_gp: 1, per_week: 2, cap: 4, description: 'Marks that glow faintly green for a day. Never get lost in a dungeon again (the goblins may follow them, though).' }
    ]
  },

  // ─── Travelling artisans (come with a merchant event) ─────────────────────
  {
    name: 'Doro Fenwick',
    mode: 'travelling',
    description: 'Halfling tinker who arrives in a cart that ticks. Sells, mends and occasionally explodes small mechanisms.',
    goods: [
      { name: "Fenwick Tinker's Tools", category: 'Tools', price_gp: 50, per_week: 1, cap: 1, description: "A roll of tiny screwdrivers, tweezers and a jeweller's loupe." },
      { name: 'Fenwick Lock', category: 'Adventuring Gear', price_gp: 10, per_week: 2, cap: 2, description: 'A padlock with two keys. Doro keeps a third, "for emergencies".' },
      { name: 'Fenwick Manacles', category: 'Adventuring Gear', price_gp: 2, per_week: 1, cap: 1, description: 'Iron cuffs with a lock and key.' },
      { name: 'Clockwork Cricket', category: 'Artisan Goods', price_gp: 15, per_week: 1, cap: 1, description: 'Wind it up and it chirps for ten minutes, then hops toward the nearest warmth. Children love it; guards hate it.' },
      { name: 'Fenwick Hourglass', category: 'Adventuring Gear', price_gp: 25, per_week: 1, cap: 1, description: 'Runs one hour exactly, Doro swears, give or take.' }
    ]
  },
  {
    name: 'Sister Amarel',
    mode: 'travelling',
    description: 'A soft-spoken pilgrim of the Dawn Road, walking from shrine to shrine with a mule called Patience.',
    goods: [
      { name: 'Dawn Road Holy Water', category: 'Adventuring Gear', price_gp: 25, per_week: 2, cap: 2, description: 'Blessed at the Dawn shrine and sealed with white wax.' },
      { name: "Pilgrim's Healer's Kit", category: 'Adventuring Gear', price_gp: 5, per_week: 2, cap: 2, description: 'Clean linen, honey salve and a prayer tucked under the lid.' },
      { name: "Pilgrim's Sunstone", category: 'Artisan Goods', price_gp: 1, per_week: 3, cap: 3, description: 'A palm-sized amber pebble, warm to the touch at dawn. Brings comfort, if not luck.' },
      { name: 'Whitebrook Beeswax Candles (10)', category: 'Adventuring Gear', price_gp: 0.1, per_week: 2, cap: 2, description: 'Beeswax candles from the shrine at Whitebrook.' }
    ]
  },
  {
    name: 'Kazrik Emberhand',
    mode: 'travelling',
    description: 'Dwarven armourer on the long road between the mountain holds, pulling a forge-cart that smokes like a dragon.',
    goods: [
      { name: 'Emberhand Chain Shirt', category: 'Armor', price_gp: 50, per_week: 1, cap: 1, description: 'Riveted rings, light enough to wear under a coat.' },
      { name: 'Emberhand Scale Mail', category: 'Armor', price_gp: 50, per_week: 1, cap: 1, description: 'Overlapping steel scales on a leather coat; sounds like rain when you walk.' },
      { name: 'Emberhand Battleaxe', category: 'Weapons', price_gp: 10, per_week: 1, cap: 1, description: 'Mountain steel with knotwork on the cheeks of the blade.' },
      { name: 'Emberhand Warhammer', category: 'Weapons', price_gp: 15, per_week: 1, cap: 1, description: 'Kazrik calls it "the persuader". All of them.' },
      { name: 'Small Keg of Deepstone Ale', category: 'Food & Drink', price_gp: 4, per_week: 1, cap: 1, description: 'Dark, thick and strong enough to make a half-orc sing.' }
    ]
  }
];

// Weekly events (one may happen at a restock). kind: merchant (artisan: a
// travelling artisan above, or goods lines), shortage (target), sale (target,
// percent) or news. weight: how likely it is next to the others.
const events = [
  { title: "The Tinker's Caravan", kind: 'merchant', artisan: 'Doro Fenwick', min_goods: 2, max_goods: 4, weight: 3,
    announcement: 'A cart that ticks like a hundred clocks rolls into the square. Doro Fenwick is in town for the week, selling whatever has not exploded on the road.' },
  { title: 'Pilgrims on the Dawn Road', kind: 'merchant', artisan: 'Sister Amarel', min_goods: 2, max_goods: 3, weight: 2,
    announcement: 'A line of pilgrims rests at the well. Sister Amarel opens her mule\'s packs on Grimbold\'s porch: holy water, salves and quiet blessings.' },
  { title: "Kazrik's Forge-Cart", kind: 'merchant', artisan: 'Kazrik Emberhand', min_goods: 1, max_goods: 3, weight: 2,
    announcement: 'Smoke on the north road! The dwarven armourer Kazrik Emberhand parks his forge-cart behind the shop and starts hammering before breakfast.' },
  { title: 'A Sailor with Strange Wares', kind: 'merchant', min_goods: 1, max_goods: 2, weight: 1,
    announcement: 'A sunburnt sailor with one boot and a parrot that only swears in Elvish sets a sea chest on the counter. "Everything must go before my ship does."',
    goods: [
      "Sailor's Brass Spyglass | 1000 | Adventuring Gear | Brass and cracked leather. The lens is perfect; the story of how he got it changes every telling.",
      'Ship in a Bottle | 8 | Curios | The tiny crew seems to be in a different place every morning.',
      "Sailor's Compass | 15 | Curios | Points north, mostly. Points at treasure, says the sailor.",
      'Jar of Pickled Kraken | 3 | Food & Drink | Rubbery, salty and, the sailor insists, "an aphrodisiac".'
    ] },
  { title: 'Bandits on the Trade Road', kind: 'shortage', target: 'staple', weight: 2,
    announcement: 'The supply wagon came in empty and the drivers came in bandaged. No new potions, rations, rope or torches this week; whatever is on the shelf is all there is.' },
  { title: 'The Scribes\' Strike', kind: 'shortage', target: 'scroll', weight: 1,
    announcement: 'The copyists of the Inkwell Guild have laid down their quills over wages. No new spell scrolls this week.' },
  { title: 'Vault Inspection', kind: 'shortage', target: 'magic', weight: 1,
    announcement: 'Two grey-robed assessors from the Arcane Registry are counting every enchanted trinket in the vault. Nothing new comes in until they leave.' },
  { title: 'Spring Clearance', kind: 'sale', target: 'mundane', percent: 15, weight: 2,
    announcement: 'Grimbold has run out of room in the back. Everyday gear is 15% off all week, and he is not happy about it.' },
  { title: "Benet's Overstock", kind: 'sale', target: 'artisan', percent: 20, weight: 2,
    announcement: 'The craftsfolk overestimated the harvest-fair crowd. Artisan goods are 20% off this week; Benet asks that nobody tell his wife.' },
  { title: 'An Old Scribe Retires', kind: 'sale', target: 'scroll', percent: 25, weight: 1,
    announcement: 'Master Pellius is finally hanging up his quill and selling off his last scrolls cheap: 25% off the scroll case this week.' },
  { title: 'The Harvest Fair', kind: 'news', weight: 2,
    announcement: 'Ribbons on every door, pies on every sill. The Harvest Fair runs all week: a pig-catching contest on Thursday, archery with Marta Kessling on Saturday.' },
  { title: "The Mayor's Proclamation", kind: 'news', weight: 1,
    announcement: 'A crier reads the Mayor\'s new law from the steps: no weapons drawn inside the town walls, by order. Grimbold rolls his eyes so hard he has to sit down.' }
];

// Lines for the twice-a-day happenings (the feature that uses these is not
// built yet). {artisan} lines are spoken by that artisan; prices in gp.
const happenings = {
  // "Fresh from the workshop": an extra batch, in the artisan's own voice.
  workshop: {
    'Benet Hollowell': [
      'Benet drops a still-warm stack of leather on the counter. "Finished early. Don\'t get used to it."',
      'Benet leans in the doorway, chewing his pipe. "Had a quiet morning. Made too many. Your gain."'
    ],
    'Marta Kessling': [
      'Marta props a fresh bundle against the counter, still smelling of yew sap. "Tested every one. Two of them twice."',
      'A thunk at the door: an arrow, with a note tied on. "More stock. Come and get it. — M."'
    ],
    'Old Tobb Rennick': [
      'Old Tobb shuffles in with a basket. Councillor the jackdaw rides on top and tries to sell you a button.',
      'Tobb wheezes something about the full moon being good for roots, sets down a crate and leaves without being paid.'
    ],
    'Ilsa Brandt': [
      'Ilsa kicks the door open, arms full of fresh iron. "Town\'s nervous. Made extra."',
      'The ring of the forge stops; a minute later Ilsa appears, black to the elbows, with a crate. "Still warm. Mind your fingers."'
    ],
    'Vessa Quillmoth': [
      'A small explosion two streets away. Five minutes later Vessa arrives, eyebrows smoking, with a new batch. "Perfectly stable. Mostly."',
      'Vessa hands over a crate packed in straw and says, very seriously, "Do not shake it. Do not sing near it."'
    ]
  },
  // Masterwork one-offs: on the shelf until the next check, if nobody buys them.
  masterwork: [
    { artisan: 'Benet Hollowell', name: "Benet's Masterwork Riding Jacket", category: 'Artisan Goods', price_gp: 25, description: 'Supple oxblood leather lined with wool, a hidden pocket in each sleeve. Not armour, but nobody will believe you are poor.' },
    { artisan: 'Marta Kessling', name: "Marta's Prize Arrows (10)", category: 'Ammunition', price_gp: 5, description: 'Hand-matched shafts with grey-goose fletching; they fly true in a crosswind. Counts as Arrows.' },
    { artisan: 'Ilsa Brandt', name: 'Ilsa\'s Pattern-Welded Dagger', category: 'Weapons', price_gp: 20, description: 'A dagger with ripples in the steel like water. Mechanically a Dagger; socially, a conversation piece.' },
    { artisan: 'Vessa Quillmoth', name: 'Bottled Thunder', category: 'Artisan Goods', price_gp: 30, description: 'Uncork it and it booms like a thunderclap, audible 300 feet away. One use. Vessa denies all responsibility.' },
    { artisan: 'Old Tobb Rennick', name: "Tobb's Sleeping Draught", category: 'Artisan Goods', price_gp: 12, description: 'A drinker falls into deep, dreamless sleep for 8 hours unless shaken awake. Tastes of honey and regret.' }
  ],
  // Flash sales: until the next check (target as for weekly sales).
  flashSales: [
    { target: 'artisan', percent: 15, text: 'Benet and Ilsa had a bet on who sells more by sundown. Artisan goods are 15% off until evening; both of them are watching.' },
    { target: 'mundane', percent: 10, text: 'Grimbold stubbed his toe on a crate and wants it gone. Everyday gear is 10% off until the next bell.' },
    { target: 'scroll', percent: 10, text: 'A scroll case got damp in the night. "Still perfectly readable!" says Grimbold. 10% off scrolls until evening.' }
  ],
  // Passing peddlers: on the shelf until the next check.
  peddlers: [
    { name: 'Wenna the Ribbon-Seller', text: 'A girl with an armful of ribbons and a very large dog sets up on the porch.', goods: [
      'Silk Ribbon | 0.5 | Curios | Dyed every colour of a summer sunset.',
      'Lucky Rabbit\'s Foot | 2 | Curios | Wenna swears it worked for the rabbit, right up until it didn\'t.'
    ] },
    { name: 'Brother Hollis, Mendicant', text: 'A barefoot monk with a begging bowl and a surprisingly heavy sack.', goods: [
      'Prayer Beads | 1 | Curios | Worn smooth by a hundred years of worried fingers.',
      'Puddle-Blessed Holy Water | 25 | Adventuring Gear | Blessed this morning, he says, in a puddle he trusts.'
    ] },
    { name: 'Gilt-Tongue Pip', text: 'A gnome in a hat three sizes too large opens a coat lined with glittering things.', goods: [
      'Map to Somewhere | 5 | Curios | A genuine treasure map, Pip insists. To where, he could not possibly say.',
      "Pip's Vanity Mirror | 5 | Adventuring Gear | Small steel mirror, only slightly cursed with vanity."
    ] }
  ],
  // Commissions: hooks the players can answer in the thread; the DM settles them.
  commissions: [
    { artisan: 'Benet Hollowell', text: 'Benet pins a note to the board: "WANTED — 3 owlbear pelts, intact. 40 gp each. Ask for Benet. Do NOT bring the owlbear."' },
    { artisan: 'Marta Kessling', text: 'Marta needs griffon feathers for a noble\'s commission: "Ten clean flight feathers, 10 gp each. Bring the griffon\'s permission if you like."' },
    { artisan: 'Old Tobb Rennick', text: 'Tobb is after moonpetal, which only flowers in the ruins on the hill: "A full basket, 25 gp. Mind the things that live up there."' },
    { artisan: 'Vessa Quillmoth', text: 'Vessa will pay 60 gp for a jar of ankheg acid "and a reasonable bonus for not dying getting it".' }
  ],
  // Mishaps: a small loss (one item off the shelf) and a hook.
  mishaps: [
    'Grimbold finds the back window forced and one item missing. Muddy little footprints lead toward the old mill.',
    'A cart backs into the porch. Something on the shelf did not survive. The driver has already left town, at speed.',
    'Councillor, Tobb\'s jackdaw, was seen flying off with something shiny from the counter. Tobb denies everything.'
  ],
  // Rumours: flavour posts and adventure hooks.
  rumours: [
    'Fishermen swear the lights under the lake are back, and that this time they are moving toward the shore.',
    'The miller\'s son came home from the woods without his shadow. He seems fine. Everyone is very uneasy.',
    'A noble\'s coach was found on the east road this morning: horses calm, doors open, nobody inside.',
    'The well in the old quarter has started tasting of copper, and the children say they hear singing at the bottom.',
    'Someone has been buying every candle in town. Thirty pounds of wax, gone, and nobody will say who.',
    'A tall stranger in grey asked at the inn about "the people who went into the barrow last month". He left a silver coin and a name: Veyl.',
    'The bells at the shrine rang on their own last night, three times, exactly at midnight.',
    'Ilsa says the iron from the north mines has been coming in brittle, and the miners will not talk about what they found down there.',
    'A merchant swears he saw a dragon over the hills at dusk. The tavern is divided: dragon, or very large goose.',
    'Wolves have been seen in the square at night, sitting perfectly still and watching the shop.'
  ]
};

module.exports = { artisans, events, happenings };
