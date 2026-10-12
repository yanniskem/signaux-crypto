// Tests hors ligne des calculs : node scripts/test.mjs
import assert from 'node:assert/strict';
import { sma, rsi, computeSeries, EVENTS, episodes, summarize, forwardReturns, baseline, makeContiguous, analyseCoin, notificationText, DAY } from './analyse.mjs';

const close = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// Moyenne mobile
assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);

// RSI : exemple de référence de Wilder (StockCharts)
const ref = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22];
const r = rsi(ref, 14);
assert.ok(close(r[14], 70.46, 0.15), `RSI[14] = ${r[14]}`);
assert.ok(close(r[15], 66.25, 0.15), `RSI[15] = ${r[15]}`);
assert.ok(close(r[17], 69.33, 0.15), `RSI[17] = ${r[17]}`);
assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14)[15], 100);

// Épisodes : deux chutes à 3 jours d'écart = un seul épisode (délai de 10 jours)
const series = [100, 100, 90, 90, 90, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 70, 70];
const s = computeSeries(series);
const chute = EVENTS.find((e) => e.id === 'chute_24h');
assert.deepEqual(episodes(s, chute), [2, 15]);

// Rendements à horizon et statistiques
assert.deepEqual(forwardReturns([100, 110, 121], [0, 1, 2], 1).map((x) => +x.toFixed(4)), [0.1, 0.1]);
const st = summarize([0.1, -0.2, 0.3]);
assert.equal(st.n, 3);
assert.ok(close(st.up, 2 / 3, 1e-9));
assert.ok(close(st.median, 0.1, 1e-9));
assert.equal(baseline([100, 110, 121, 100], 1).n, 3);

// Série continue : petit trou rempli, grand trou coupé
const d0 = 1_600_000_000 - (1_600_000_000 % DAY);
const gappy = [[d0, 1], [d0 + DAY, 2], [d0 + 3 * DAY, 4], [d0 + 20 * DAY, 10], [d0 + 21 * DAY, 11], [d0 + 23 * DAY, 13]];
const cont = makeContiguous(gappy);
assert.deepEqual(cont.closes, [10, 11, 11, 13]);
assert.equal(cont.days[1] - cont.days[0], DAY);

// Analyse complète sur une marche aléatoire reproductible
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const days = [], closes = [];
let p = 1000;
for (let i = 0; i < 1500; i++) {
  p *= 1 + (rand() - 0.495) * 0.18;
  days.push(d0 + i * DAY);
  closes.push(p);
}
const last = closes[closes.length - 1];
const a = analyseCoin(days, closes, { price: last * 0.9, ch24h: -0.1 });
const sit = Object.fromEntries(a.situations.map((x) => [x.id, x]));
assert.equal(sit.chute_24h.active, true, 'une baisse de 10 % en 24 h doit être détectée');
assert.equal(sit.envolee_24h.active, false);
assert.equal(sit.chute_24h.detail, '-10,0 % en 24 h');
assert.ok(sit.chute_24h.stats.h30.n > 0, 'des chutes passées doivent être trouvées');
assert.ok(['hausse', 'baisse', 'neutre', 'peu'].includes(sit.chute_24h.verdict));
assert.equal(a.spark.length, 120);
assert.ok(a.baseline.h30.n === 1500 - 30);

// Vérification indépendante d'une statistique : on recompte les chutes à la main
const manual = [];
let lastEp = -Infinity;
for (let i = 1; i < closes.length; i++) {
  const r1 = closes[i] / closes[i - 1] - 1;
  const prev = i >= 2 ? closes[i - 1] / closes[i - 2] - 1 : 0;
  if (r1 <= -0.07 && !(prev <= -0.07) && i - lastEp >= 10) { manual.push(i); lastEp = i; }
}
const manual30 = manual.filter((i) => i + 30 < closes.length).map((i) => closes[i + 30] / closes[i] - 1);
assert.equal(sit.chute_24h.stats.h30.n, manual30.length);
assert.ok(close(sit.chute_24h.stats.h30.up, manual30.filter((x) => x > 0).length / manual30.length, 1e-9));

const n = notificationText({ symbol: 'BTC', since: '2015-07-20', baseline: a.baseline }, sit.chute_24h, 'https://exemple.github.io/signaux-crypto/');
console.log('\nExemple de notification :\n' + n.title + '\n' + n.message + '\n');
console.log('Situations en cours sur la série de test :', a.situations.filter((x) => x.active).map((x) => x.id).join(', '));
console.log('Tous les tests passent.');
