// views/tabs/analytics.js — "analytics" tab of the admin panel.

'use strict';

const db = require('../../db');
const { escapeHtml } = require('../helpers');

module.exports = function renderAnalyticsTab(ctx) {
  const { status } = ctx;
  let contentHtml = '';
  const analytics = db.getCharacterAnalytics();
  const analyticsJson = JSON.stringify(analytics).replace(/</g, '\\u003c');
  const diceStats = db.getDiceAnalytics();
  // d4–d12 and d100 rolled in the panel, one chart each.
  const otherDice = db.getOtherDiceAnalytics();
  const otherDiceJson = JSON.stringify(otherDice).replace(/</g, '\\u003c');
  const diceStatsJson = JSON.stringify(diceStats.distribution).replace(/</g, '\\u003c');
  const levelEntries = Object.entries(analytics.levelCount)
    .sort((left, right) => Number(left[0].replace(/\D/g, '')) - Number(right[0].replace(/\D/g, '')));
  const classEntries = Object.entries(analytics.classCount)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  contentHtml = `
    <div class="analytics-grid">
      <section class="card analytics-card">
        <div class="analytics-card-header">
          <strong>Roster Composition</strong>
          <div class="metric-toggle" role="group" aria-label="Roster chart metric">
            <input type="radio" name="metricRadio" id="metricSpecies" value="species" checked>
            <label for="metricSpecies">Species</label>
            <input type="radio" name="metricRadio" id="metricClasses" value="classes">
            <label for="metricClasses">Classes</label>
            <input type="radio" name="metricRadio" id="metricStatus" value="status">
            <label for="metricStatus">Status</label>
          </div>
        </div>
        <div class="analytics-chart-wrap">
          <canvas id="rosterPieChart" aria-label="Roster composition pie chart" role="img"></canvas>
        </div>
      </section>

      <section class="card analytics-card">
        <div class="analytics-card-header">
          <strong>Roster Breakdown</strong>
          <span class="muted small">Total Adventurers: ${analytics.total}</span>
        </div>
        <div class="analytics-breakdown">
          <div>
            <h4>Level Distribution</h4>
            <ul class="analytics-list">
              ${levelEntries.length ? levelEntries.map(([level, count]) => `
                <li><span>${escapeHtml(level)}</span><span class="analytics-badge">${count}</span></li>
              `).join('') : '<li class="muted">No characters yet.</li>'}
            </ul>
          </div>
          <div>
            <h4>Class Popularity</h4>
            <div class="analytics-class-list">
              <ul class="analytics-list">
                ${classEntries.length ? classEntries.map(([className, count]) => `
                  <li><span>${escapeHtml(className)}</span><span class="analytics-badge primary">${count}</span></li>
                `).join('') : '<li class="muted">No characters yet.</li>'}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="card analytics-dice">
      <div class="analytics-card-header">
        <strong>d20 Dice Roll Distribution &amp; Fairness</strong>
        <div class="analytics-dice-stats">
          <span class="analytics-badge">Total Rolls: ${diceStats.totalRolls}</span>
          <span class="analytics-badge primary">Avg Roll: ${diceStats.averageRoll} (Exp: 10.5)</span>
          <span class="analytics-badge dice-success">Nat 20: ${diceStats.nat20Count}</span>
          <span class="analytics-badge fallen">Nat 1: ${diceStats.nat1Count}</span>
        </div>
      </div>
      <p class="muted small">${diceStats.weeklyRolls} weekly shop rolls and ${diceStats.sheetRolls} d20s rolled on character sheets (both dice of advantage and disadvantage count).</p>
      <div class="analytics-dice-chart-wrap">
        <canvas id="diceBarChart" aria-label="d20 roll distribution bar chart" role="img"></canvas>
      </div>
    </section>

    <section class="analytics-other-dice" aria-label="Other dice">
      ${otherDice.map(die => `
        <div class="card analytics-dice">
          <div class="analytics-card-header">
            <strong>d${die.sides} Distribution</strong>
            <div class="analytics-dice-stats">
              <span class="analytics-badge">Dice: ${die.totalRolls}</span>
              <span class="analytics-badge primary">Avg: ${die.averageRoll} (Exp: ${die.expectedAverage})</span>
              <span class="analytics-badge dice-success">${die.sides}s: ${die.maxCount}</span>
              <span class="analytics-badge fallen">1s: ${die.minCount}</span>
            </div>
          </div>
          ${die.totalRolls
            ? `<div class="analytics-dice-chart-wrap small-chart"><canvas id="diceChart-d${die.sides}" aria-label="d${die.sides} roll distribution bar chart" role="img"></canvas></div>`
            : `<p class="muted small">No d${die.sides} rolled on character sheets yet. <a href="/admin?tab=rolls&die=${die.sides}">See d${die.sides} rolls</a></p>`}
        </div>`).join('')}
    </section>

    <section class="card analytics-graveyard">
      <div class="analytics-card-header">
        <strong>Hall of the Fallen (Graveyard)</strong>
        <span class="analytics-badge fallen">${analytics.graveyard.length} Fallen</span>
      </div>
      <div class="analytics-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable">Character</th>
              <th class="sortable">Player</th>
              <th class="sortable">Class &amp; Level</th>
              <th class="sortable">Fateful Adventure</th>
              <th class="sortable">Presiding DM</th>
              <th>Demise Circumstances</th>
            </tr>
          </thead>
          <tbody>
            ${analytics.graveyard.length === 0 ? `
              <tr><td colspan="6" class="analytics-empty">No heroes have fallen yet. The realm remains fortunate.</td></tr>
            ` : analytics.graveyard.map(character => `
              <tr>
                <td><strong>${escapeHtml(character.name)}</strong></td>
                <td class="muted">${escapeHtml(character.player_tag || 'Unknown')}</td>
                <td><span class="analytics-badge">${escapeHtml(character.class || 'Class')} (Lvl ${character.level || 3})</span></td>
                <td>${character.death_adv_title ? `<span class="gold">#${character.death_adventure_id} ${escapeHtml(character.death_adv_title)}</span>` : '<span class="muted">Off-screen / Unknown</span>'}</td>
                <td class="muted">${escapeHtml(character.death_dm_name || '—')}</td>
                <td class="muted italic">${escapeHtml(character.death_notes || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const statusSelect = document.getElementById('char-status-select');
        const deathBox = document.getElementById('cause-of-death-box');
        if (statusSelect && deathBox) {
          statusSelect.addEventListener('change', () => {
            deathBox.style.display = statusSelect.value.toLowerCase() === 'dead' ? 'block' : 'none';
          });
        }

        const canvas = document.getElementById('rosterPieChart');
        const dataPayload = ${analyticsJson};
        const palette = [
          '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
          '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#a855f7'
        ];

        function buildDataset(metric) {
          let source = {};
          if (metric === 'species') source = dataPayload.speciesCount;
          if (metric === 'classes') source = dataPayload.classCount;
          if (metric === 'status') source = dataPayload.statusCount;

          const labels = Object.keys(source);
          const values = Object.values(source);

          return {
            labels,
            datasets: [{
              data: values,
              backgroundColor: labels.map((_, index) => palette[index % palette.length]),
              borderColor: '#1e293b',
              borderWidth: 2
            }]
          };
        }

        if (!window.Chart) {
          console.error('Chart.js failed to load; analytics charts are unavailable.');
          return;
        }

        if (canvas) {
          const pieChart = new Chart(canvas, {
            type: 'pie',
            data: buildDataset('species'),
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'right',
                  labels: { color: '#cbd5e1', font: { size: 11 } }
                }
              }
            }
          });

          document.querySelectorAll('input[name="metricRadio"]').forEach(radio => {
            radio.addEventListener('change', event => {
              pieChart.data = buildDataset(event.target.value);
              pieChart.update();
            });
          });
        }

        const diceCanvas = document.getElementById('diceBarChart');
        if (diceCanvas) {
          const diceData = ${diceStatsJson};
          const labels = Object.keys(diceData);
          const values = Object.values(diceData);
          const backgroundColors = labels.map(num => {
            if (num === '1') return '#ef4444';
            if (num === '20') return '#10b981';
            return '#3b82f6';
          });

          new Chart(diceCanvas, {
            type: 'bar',
            data: {
              labels,
              datasets: [{
                label: 'Roll Count',
                data: values,
                backgroundColor: backgroundColors,
                borderRadius: 4,
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  grid: { color: '#334155' },
                  ticks: { color: '#94a3b8', font: { weight: 'bold' } },
                  title: { display: true, text: 'd20 Face Value', color: '#cbd5e1' }
                },
                y: {
                  grid: { color: '#334155' },
                  ticks: { color: '#94a3b8', stepSize: 1 },
                  beginAtZero: true,
                  title: { display: true, text: 'Frequency', color: '#cbd5e1' }
                }
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: items => 'Natural ' + items[0].label,
                    label: context => 'Rolled ' + context.parsed.y + ' times'
                  }
                }
              }
            }
          });
        }

        // One bar chart per other die: the highest face green, 1 red.
        const otherDice = ${otherDiceJson};
        otherDice.forEach(die => {
          const chartCanvas = document.getElementById('diceChart-d' + die.sides);
          if (!chartCanvas) return;
          let faceLabels = Object.keys(die.distribution);
          let counts = Object.values(die.distribution);
          let colors = faceLabels.map(face => (face === '1' ? '#ef4444' : face === String(die.sides) ? '#10b981' : '#3b82f6'));
          // A d100 reads better in ranges of ten: 1–10, 11–20, ...
          if (die.sides === 100) {
            faceLabels = Array.from({ length: 10 }, (_, index) => (index * 10 + 1) + '–' + (index * 10 + 10));
            counts = faceLabels.map((_, index) => counts.slice(index * 10, index * 10 + 10).reduce((sum, value) => sum + value, 0));
            colors = faceLabels.map(() => '#3b82f6');
          }
          new Chart(chartCanvas, {
            type: 'bar',
            data: {
              labels: faceLabels,
              datasets: [{
                label: 'Roll Count',
                data: counts,
                backgroundColor: colors,
                borderRadius: 3,
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  grid: { color: '#334155' },
                  ticks: { color: '#94a3b8' },
                  title: { display: true, text: die.sides === 100 ? 'd100 result (in ranges of ten)' : 'd' + die.sides + ' Face Value', color: '#cbd5e1' }
                },
                y: {
                  grid: { color: '#334155' },
                  ticks: { color: '#94a3b8', precision: 0 },
                  beginAtZero: true,
                  title: { display: true, text: 'Frequency', color: '#cbd5e1' }
                }
              },
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: items => 'd' + die.sides + ': ' + items[0].label,
                    label: context => 'Rolled ' + context.parsed.y + ' times'
                  }
                }
              }
            }
          });
        });
      });
    </script>
  `;
  return contentHtml;
};
