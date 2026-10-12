// Passage horaire : récupère les cours, analyse, écrit docs/data.json, envoie les notifications.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { analyseCoin, makeContiguous, notificationText, DAY } from './analyse.mjs';

const COINS = [
  { symbol: 'BTC', name: 'Bitcoin', product: 'BTC-USD' },
  { symbol: 'ETH', name: 'Ethereum', product: 'ETH-USD' },
  { symbol: 'SOL', name: 'Solana', product: 'SOL-USD' },
  { symbol: 'XRP', name: 'XRP', product: 'XRP-USD' },
  { symbol: 'DOGE', name: 'Dogecoin', product: 'DOGE-USD' },
  { symbol: 'ADA', name: 'Cardano', product: 'ADA-USD' },
  { symbol: 'AVAX', name: 'Avalanche', product: 'AVAX-USD' },
  { symbol: 'LINK', name: 'Chainlink', product: 'LINK-USD' },
  { symbol: 'DOT', name: 'Polkadot', product: 'DOT-USD' },
  { symbol: 'LTC', name: 'Litecoin', product: 'LTC-USD' },
];

const API = 'https://api.exchange.coinbase.com';
const HISTORY_START = Date.UTC(2015, 0, 1) / 1000;
const NTFY_TOPIC = (process.env.NTFY_TOPIC || '').trim();
const SITE_URL = (process.env.SITE_URL || '').trim();
const TEST_NOTIFICATION = process.env.TEST_NOTIFICATION === 'true';
const RENOTIFY_AFTER = 24 * 3600 * 1000; // une situation qui disparaît puis revient moins de 24 h après n'est pas renotifiée

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'signaux-crypto (github.com/yanniskem/signaux-crypto)', Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(`${res.status} ${await res.text()}`.slice(0, 200));
  }
  throw new Error(`Échec après 4 tentatives : ${url}`);
}

// Bougies Coinbase : [time, low, high, open, close, volume], 300 maximum par requête
async function candles(product, granularity, start, end) {
  let url = `${API}/products/${product}/candles?granularity=${granularity}`;
  if (start != null) url += `&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const rows = await getJSON(url);
  await sleep(150);
  return Array.isArray(rows) ? rows : [];
}

async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function dailyHistory(coin, todayMidnight) {
  const path = `data/history/${coin.symbol}.json`;
  const cached = await readJSON(path, []); // [[t, close], ...]
  const from = cached.length ? cached[cached.length - 1][0] + DAY : HISTORY_START;
  const fresh = [];
  let failed = false;
  for (let s = from; s < todayMidnight; s += 300 * DAY) {
    const e = Math.min(s + 299 * DAY, todayMidnight); // la journée en cours est écartée plus bas
    try {
      for (const r of await candles(coin.product, 86400, s, e)) fresh.push([r[0], r[4]]);
    } catch (err) {
      failed = true;
      console.warn(`${coin.symbol} ${new Date(s * 1000).toISOString().slice(0, 10)} : ${err.message}`);
    }
  }
  const byDay = new Map(cached.map((r) => [r[0], r[1]]));
  for (const [t, c] of fresh) if (t < todayMidnight) byDay.set(t, c);
  const merged = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  // En cas d'échec partiel, on n'enregistre pas : le prochain passage retentera la période manquante.
  if (!failed && merged.length !== cached.length) await writeFile(path, JSON.stringify(merged));
  return merged;
}

async function live(coin) {
  const rows = (await candles(coin.product, 3600)).sort((a, b) => a[0] - b[0]);
  if (!rows.length) throw new Error('aucune bougie horaire');
  const lastRow = rows[rows.length - 1];
  const target = lastRow[0] - 24 * 3600;
  const ref = rows.find((r) => r[0] === target) || rows.find((r) => r[0] >= target);
  return { price: lastRow[4], ch24h: ref ? lastRow[4] / ref[4] - 1 : null, at: lastRow[0] };
}

async function ntfy(payload) {
  if (!NTFY_TOPIC) return;
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: NTFY_TOPIC, tags: ['chart_with_upwards_trend'], ...payload }),
  });
  if (!res.ok) console.warn(`ntfy : ${res.status} ${await res.text()}`);
}

async function main() {
  await mkdir('data/history', { recursive: true });
  const nowMs = Date.now();
  const todayMidnight = Math.floor(nowMs / 1000 / DAY) * DAY;
  const previous = await readJSON('docs/data.json', { coins: [] });
  const state = await readJSON('data/state.json', null);
  const firstRun = state === null;
  const seen = state?.seen ?? {}; // "BTC:rsi_bas" -> { since, lastActive }

  const coins = [];
  const toNotify = [];
  for (const coin of COINS) {
    try {
      const raw = await dailyHistory(coin, todayMidnight);
      const { days, closes } = makeContiguous(raw);
      if (closes.length < 250) throw new Error(`historique trop court (${closes.length} jours)`);
      const lv = await live(coin);
      const a = analyseCoin(days, closes, lv);
      const out = { symbol: coin.symbol, name: coin.name, ...a, priceAt: new Date(lv.at * 1000).toISOString() };
      coins.push(out);
      for (const sit of a.situations) {
        const key = `${coin.symbol}:${sit.id}`;
        if (sit.active) {
          if (!seen[key]) {
            seen[key] = { since: nowMs };
            if (!firstRun) toNotify.push(notificationText(out, sit, SITE_URL));
          }
          seen[key].lastActive = nowMs;
        } else if (seen[key] && nowMs - seen[key].lastActive > RENOTIFY_AFTER) {
          delete seen[key];
        }
      }
      console.log(`${coin.symbol} : ${closes.length} jours depuis ${a.since}, ${a.situations.filter((s) => s.active).length} situation(s) en cours`);
    } catch (err) {
      console.error(`${coin.symbol} : ${err.message}`);
      const old = previous.coins.find((c) => c.symbol === coin.symbol);
      if (old) coins.push({ ...old, stale: true });
    }
  }

  if (!coins.length) throw new Error('Aucune crypto analysée');

  await writeFile('docs/data.json', JSON.stringify({ generatedAt: new Date(nowMs).toISOString(), ntfyTopic: NTFY_TOPIC || null, coins }));
  await writeFile('data/state.json', JSON.stringify({ seen }, null, 1));

  if (firstRun) console.log('Premier passage : situations en cours enregistrées sans notification.');
  for (const n of toNotify) {
    await ntfy(n);
    console.log(`Notification : ${n.title}`);
  }
  if (TEST_NOTIFICATION) {
    await ntfy({
      title: 'Signaux crypto : notification de test',
      message: 'Les notifications fonctionnent. Tu recevras un message ici dès qu\'une situation notable apparaît sur une des cryptos suivies.',
      click: SITE_URL || undefined,
    });
    console.log('Notification de test envoyée');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
