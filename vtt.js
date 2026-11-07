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
const VERSION = '1.5.3';

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
    description: 'Rolls from the Grimbold panel for the whole table, initiative into the tracker, and skill challenges.',
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

// Skill challenges: the running ones this key's player is in (or DMs), and
// turns or the DM's rulings made from Owlbear with the key.
router.get('/challenges', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    return res.json(db.getVttChallenges({ key: req.query.key }));
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});
router.post('/challenges/:adventureId/:challengeId', express.json(), (req, res) => {
  const body = req.body || {};
  let user;
  try {
    user = db.vttUser(body.key);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
  const args = { adventureId: Number(req.params.adventureId), user, challengeId: req.params.challengeId };
  try {
    if (body.action === 'help') db.helpInChallenge({ ...args, characterId: body.characterId, skill: body.skill, override: Boolean(body.override) });
    else if (body.action === 'feature') db.featureSuccess({ ...args, characterId: body.characterId, what: body.what });
    else if (body.action === 'skip') db.skipChallengeTurn(args);
    else if (body.action === 'void') db.voidChallengeAttempt({ ...args, attemptId: body.attemptId });
    else if (body.action === 'raise') db.raiseChallengeAttemptDc({ ...args, attemptId: body.attemptId });
    else if (body.action === 'check') db.rollChallengeCheck({ ...args, characterId: body.characterId, skill: body.skill, mode: body.mode, override: Boolean(body.override) });
    else return res.status(400).json({ error: 'Unknown action.' });
    return res.json(db.getVttChallenges({ key: body.key }));
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Owlbear skill challenge action failed:', error);
      return res.status(500).json({ error: 'Something went wrong.' });
    }
    return res.status(error.message === 'Forbidden.' ? 403 : 400).json({ error: error.message });
  }
});

router.use(express.static(path.join(__dirname, 'vtt'), { maxAge: '5m' }));

module.exports = router;
