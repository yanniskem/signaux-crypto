// Calculs purs : indicateurs, situations, statistiques historiques.
// Aucune requête réseau ici, pour pouvoir tout tester hors ligne.

export const DAY = 86400;
export const MIN_CASES = 8;          // en dessous : "trop peu de cas pour conclure"
export const COOLDOWN_DAYS = 10;     // deux épisodes d'une même situation sont séparés d'au moins 10 jours
export const HORIZONS = [7, 30];     // évolution du prix 7 et 30 jours après

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// RSI de Wilder sur n périodes
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  const val = () => (avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  out[n] = val();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

function pctChange(closes, k) {
  return closes.map((c, i) => (i >= k ? c / closes[i - k] - 1 : null));
}

function rollingExtreme(closes, k, pick) {
  return closes.map((c, i) => {
    if (i < k - 1) return null;
    let m = closes[i - k + 1];
    for (let j = i - k + 2; j <= i; j++) m = pick(m, closes[j]);
    return m;
  });
}

export function computeSeries(closes) {
  return {
    closes,
    rsi: rsi(closes, 14),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ret1: pctChange(closes, 1),
    ret7: pctChange(closes, 7),
    hi90: rollingExtreme(closes, 90, Math.max),
    lo90: rollingExtreme(closes, 90, Math.min),
  };
}

function crossed(s, i, dir, within = 3) {
  if (i < 1 || s.sma50[i] == null || s.sma200[i] == null) return false;
  const above = (j) => s.sma50[j] > s.sma200[j];
  if (dir > 0 ? !above(i) : above(i)) return false;
  for (let j = Math.max(1, i - within); j < i; j++) {
    if (s.sma50[j] == null || s.sma200[j] == null) continue;
    if (dir > 0 ? !above(j) : above(j)) return true;
  }
  return false;
}

const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')} %`;

// Chaque situation : un test sur le jour i, et un texte qui décrit la valeur actuelle.
export const EVENTS = [
  { id: 'chute_24h', label: 'Chute de plus de 7 % en 24 h', test: (s, i) => s.ret1[i] != null && s.ret1[i] <= -0.07, detail: (s, i) => `${pct(s.ret1[i])} en 24 h` },
  { id: 'envolee_24h', label: 'Hausse de plus de 7 % en 24 h', test: (s, i) => s.ret1[i] != null && s.ret1[i] >= 0.07, detail: (s, i) => `${pct(s.ret1[i])} en 24 h` },
  { id: 'chute_7j', label: 'Chute de plus de 15 % en 7 jours', test: (s, i) => s.ret7[i] != null && s.ret7[i] <= -0.15, detail: (s, i) => `${pct(s.ret7[i])} en 7 jours` },
  { id: 'envolee_7j', label: 'Hausse de plus de 15 % en 7 jours', test: (s, i) => s.ret7[i] != null && s.ret7[i] >= 0.15, detail: (s, i) => `${pct(s.ret7[i])} en 7 jours` },
  { id: 'rsi_bas', label: 'RSI sous 30 (zone de survente)', test: (s, i) => s.rsi[i] != null && s.rsi[i] < 30, detail: (s, i) => `RSI à ${Math.round(s.rsi[i])}` },
  { id: 'rsi_haut', label: 'RSI au-dessus de 70 (zone de surachat)', test: (s, i) => s.rsi[i] != null && s.rsi[i] > 70, detail: (s, i) => `RSI à ${Math.round(s.rsi[i])}` },
  { id: 'croix_or', label: 'La moyenne 50 jours passe au-dessus de la 200 jours', test: (s, i) => crossed(s, i, +1), detail: () => 'Croisement dans les 3 derniers jours' },
  { id: 'croix_mort', label: 'La moyenne 50 jours passe sous la 200 jours', test: (s, i) => crossed(s, i, -1), detail: () => 'Croisement dans les 3 derniers jours' },
  { id: 'haut_90j', label: 'Plus haut des 90 derniers jours', test: (s, i) => s.hi90[i] != null && s.closes[i] >= s.hi90[i], detail: () => 'Prix au plus haut depuis 90 jours' },
  { id: 'bas_90j', label: 'Plus bas des 90 derniers jours', test: (s, i) => s.lo90[i] != null && s.closes[i] <= s.lo90[i], detail: () => 'Prix au plus bas depuis 90 jours' },
];

// Débuts d'épisodes : la situation devient vraie (fausse la veille), avec un délai minimum entre deux épisodes.
export function episodes(s, ev, lastIndex = s.closes.length - 1, cooldown = COOLDOWN_DAYS) {
  const starts = [];
  let last = -Infinity;
  for (let i = 1; i <= lastIndex; i++) {
    if (ev.test(s, i) && !ev.test(s, i - 1) && i - last >= cooldown) {
      starts.push(i);
      last = i;
    }
  }
  return starts;
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function summarize(rets) {
  if (!rets.length) return { n: 0 };
  const up = rets.filter((r) => r > 0).length / rets.length;
  return {
    n: rets.length,
    up,
    median: median(rets),
    mean: rets.reduce((a, b) => a + b, 0) / rets.length,
    min: Math.min(...rets),
    max: Math.max(...rets),
  };
}

export function forwardReturns(closes, idxs, h) {
  return idxs.filter((i) => i + h < closes.length).map((i) => closes[i + h] / closes[i] - 1);
}

// "Jour normal" : tous les jours de l'historique, quelle que soit la situation.
export function baseline(closes, h) {
  const all = [];
  for (let i = 0; i + h < closes.length; i++) all.push(i);
  return summarize(forwardReturns(closes, all, h));
}

export function verdict(stats, base) {
  const h = stats.h30;
  if (!h || h.n < MIN_CASES) return 'peu';
  const diff = h.up - base.h30.up;
  if (diff >= 0.1) return 'hausse';
  if (diff <= -0.1) return 'baisse';
  return 'neutre';
}

/**
 * Analyse complète d'une crypto.
 * @param {number[]} days   timestamps (s, minuit UTC) des journées clôturées, consécutives
 * @param {number[]} closes cours de clôture correspondants
 * @param {object} live     { price, ch24h } cours actuel et variation sur 24 h glissantes
 */
export function analyseCoin(days, closes, live) {
  const hist = computeSeries(closes);
  const base = Object.fromEntries(HORIZONS.map((h) => [`h${h}`, baseline(closes, h)]));

  // Série "en direct" : historique + prix actuel comme point du jour
  const liveCloses = [...closes, live.price];
  const now = computeSeries(liveCloses);
  const L = liveCloses.length - 1;
  if (live.ch24h != null) now.ret1[L] = live.ch24h;

  const situations = EVENTS.map((ev) => {
    const idx = episodes(hist, ev);
    const stats = Object.fromEntries(HORIZONS.map((h) => [`h${h}`, summarize(forwardReturns(closes, idx, h))]));
    const active = ev.test(now, L);
    const last = idx.slice(-5).reverse().map((i) => ({
      date: new Date(days[i] * 1000).toISOString().slice(0, 10),
      r7: i + 7 < closes.length ? closes[i + 7] / closes[i] - 1 : null,
      r30: i + 30 < closes.length ? closes[i + 30] / closes[i] - 1 : null,
    }));
    return {
      id: ev.id,
      label: ev.label,
      active,
      detail: active ? ev.detail(now, L) : null,
      stats,
      verdict: verdict(stats, base),
      last,
    };
  });

  return {
    price: live.price,
    ch24h: live.ch24h,
    ch7d: now.ret7[L],
    rsi: now.rsi[L],
    vsSma200: now.sma200[L] != null ? live.price / now.sma200[L] - 1 : null,
    since: new Date(days[0] * 1000).toISOString().slice(0, 10),
    days: closes.length,
    baseline: base,
    spark: liveCloses.slice(-120).map((c) => +c.toPrecision(6)),
    situations,
  };
}

// Rend la série quotidienne continue : coupe avant le dernier trou de plus de 7 jours
// (ex. une crypto retirée puis remise en vente), et recopie le dernier cours pour les petits trous.
export function makeContiguous(candles) {
  const sorted = [...candles].sort((a, b) => a[0] - b[0]);
  let start = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] - sorted[i - 1][0] > 7 * DAY) start = i;
  }
  const kept = sorted.slice(start);
  const days = [], closes = [];
  for (let i = 0; i < kept.length; i++) {
    const [t, c] = kept[i];
    if (i > 0) {
      let prevT = days[days.length - 1];
      if (t <= prevT) continue; // doublon
      while (t - prevT > DAY) {
        prevT += DAY;
        days.push(prevT);
        closes.push(closes[closes.length - 1]);
      }
    }
    days.push(t);
    closes.push(c);
  }
  return { days, closes };
}

export function notificationText(coin, sit, siteUrl) {
  const s = sit.stats.h30;
  const b = coin.baseline.h30;
  const fr = (x) => Math.round(x * 100);
  let hist;
  if (!s || s.n < MIN_CASES) {
    hist = `Seulement ${s?.n ?? 0} cas depuis ${coin.since.slice(0, 4)} : trop peu pour en tirer une tendance.`;
  } else {
    hist = `Les ${s.n} fois précédentes depuis ${coin.since.slice(0, 4)}, le prix était plus haut 30 jours après dans ${fr(s.up)} % des cas (jour normal : ${fr(b.up)} %). Évolution médiane : ${pct(s.median)}.`;
  }
  return {
    title: `${coin.symbol} : ${sit.label.toLowerCase()}`,
    message: `${sit.detail}. ${hist}\nStatistiques passées, pas une prévision.`,
    click: siteUrl ? `${siteUrl}#${coin.symbol}` : undefined,
  };
}
