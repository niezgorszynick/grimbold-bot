// views/statblock.js — A monster's statblock as HTML (rules/monsters.js data),
// for the Monsters tab and the NPCs based on a statblock. DMs only.

'use strict';

const { escapeHtml } = require('./helpers');

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const signed = n => (n >= 0 ? `+${n}` : String(n));
const modifier = score => Math.floor((score - 10) / 2);
const thousands = n => Number(n).toLocaleString('en-US');
// Text with its line breaks (spell lists) kept.
const lines = text => escapeHtml(text).replace(/\n/g, '<br>');

function challengeHtml(monster) {
  if (monster.summon) return 'Summoned (no CR)';
  const lair = monster.lairXp ? `, or ${thousands(monster.lairXp)} in its lair` : '';
  return `CR ${escapeHtml(monster.crText)} (${thousands(monster.xp)} XP${lair}; PB +${monster.pb})`;
}

function entriesHtml(title, entries, intro = '') {
  if (!entries.length && !intro) return '';
  return `
    <h4 class="statblock-section">${title}</h4>
    ${intro ? `<p class="statblock-entry">${lines(intro)}</p>` : ''}
    ${entries.map(entry => `<p class="statblock-entry${entry.sub ? ' is-sub' : ''}"><strong><em>${escapeHtml(entry.name)}.</em></strong> ${lines(entry.text)}</p>`).join('')}`;
}

function renderStatblock(monster) {
  const line = (label, value) => (value ? `<div><strong>${label}</strong> ${escapeHtml(value)}</div>` : '');
  const scores = ABILITIES.filter(ability => monster.abilities[ability]);
  return `
    <article class="statblock" data-monster="${escapeHtml(monster.name)}">
      <header>
        <h3>${escapeHtml(monster.name)}</h3>
        <div class="muted small"><em>${escapeHtml(monster.typeLine)}</em> · ${challengeHtml(monster)}</div>
      </header>
      <div class="statblock-core">
        <span><small>AC</small><strong>${escapeHtml(monster.armorClassText)}</strong></span>
        <span><small>HP</small><strong>${escapeHtml(monster.hitPointsText)}</strong></span>
        <span><small>Speed</small><strong>${escapeHtml(monster.speed)}</strong></span>
        ${monster.initiative !== null ? `<span><small>Initiative</small><strong>${signed(monster.initiative)}</strong></span>` : ''}
      </div>
      ${scores.length ? `<table class="statblock-abilities">
        <thead><tr><th></th>${scores.map(ability => `<th>${ability.toUpperCase()}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th>Score</th>${scores.map(ability => `<td>${monster.abilities[ability]} (${signed(modifier(monster.abilities[ability]))})</td>`).join('')}</tr>
          <tr><th>Save</th>${scores.map(ability => `<td>${signed(monster.saves[ability] ?? modifier(monster.abilities[ability]))}</td>`).join('')}</tr>
        </tbody>
      </table>` : ''}
      <div class="statblock-lines">
        ${line('Skills', monster.skillsText)}
        ${line('Vulnerabilities', monster.vulnerabilities)}
        ${line('Resistances', monster.resistances)}
        ${line('Immunities', monster.immunities)}
        ${line('Gear', monster.gear)}
        ${line('Senses', monster.senses)}
        ${line('Languages', monster.languages)}
      </div>
      ${entriesHtml('Traits', monster.traits)}
      ${entriesHtml('Actions', monster.actions)}
      ${entriesHtml('Bonus Actions', monster.bonusActions)}
      ${entriesHtml('Reactions', monster.reactions)}
      ${entriesHtml('Legendary Actions', monster.legendaryActions, monster.legendaryIntro)}
      ${monster.lore ? `<details class="statblock-lore"><summary>Lore</summary>${monster.lore.split(/\n{2,}/).map(paragraph => `<p>${lines(paragraph)}</p>`).join('')}</details>` : ''}
      <footer class="muted small">
        ${[['Habitat', monster.habitat], ['Treasure', monster.treasure], ['Source', monster.source]].filter(([, value]) => value).map(([label, value]) => `<span><strong>${label}:</strong> ${escapeHtml(value)}</span>`).join(' · ')}
      </footer>
    </article>`;
}

module.exports = { renderStatblock };
