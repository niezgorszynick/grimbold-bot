// vtt.js — The Owlbear Rodeo extension "Grimbold's Dice", served at /vtt:
// its manifest, its pages (vtt/*), and the roll feed its background page
// reads with a player's key. Public (no panel login), with CORS so Owlbear
// can load it; a key only reveals the rolls its own player made, and the
// running encounters (names and initiative) of the adventures they DM.

'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');

const router = express.Router();
const VERSION = '1.2.0';

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

router.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({
    name: "Grimbold's Dice",
    version: VERSION,
    manifest_version: 1,
    author: "Grimbold's Emporium",
    // Owlbear refuses descriptions over 128 characters (tests/dice.test.js checks it).
    description: 'Rolls from the Grimbold panel for the whole table, and initiative into the Owlbear tracker.',
    icon: '/vtt/icon.svg',
    action: {
      title: "Grimbold's Dice",
      icon: '/vtt/icon.svg',
      popover: '/vtt/popover.html',
      height: 600,
      width: 360
    },
    background_url: '/vtt/background.html'
  });
});

router.get('/rolls', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    return res.json(db.getVttRolls({ key: req.query.key, after: req.query.after, afterReveal: req.query.afterReveal }));
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

// The DM's running encounter, for the initiative tracker.
router.get('/encounter', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    return res.json(db.getVttEncounters({ key: req.query.key }));
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.use(express.static(path.join(__dirname, 'vtt'), { maxAge: '5m' }));

module.exports = router;
