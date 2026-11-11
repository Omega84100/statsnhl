// Simple, transparent betting model built only from official NHL stats.
// Every number shown on the site comes from these functions.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Probability that a Poisson variable with mean lambda is >= k.
export function atLeast(lambda, k) {
  if (!(lambda > 0)) return 0;
  let term = Math.exp(-lambda), below = 0;
  for (let i = 0; i < k; i++) { below += term; term *= lambda / (i + 1); }
  return clamp(1 - below, 0, 1);
}

// Goalie rating out of 100: save percentage (70 %) and goals against average (30 %),
// pulled towards 50 when the goalie has few starts (small samples lie).
export function goalieRating({ savePct, gaa, starts }) {
  if (savePct == null || gaa == null) return null;
  const sv = clamp((savePct - 0.875) / (0.93 - 0.875), 0, 1) * 100;
  const ga = clamp((3.8 - gaa) / (3.8 - 2.0), 0, 1) * 100;
  const raw = 0.7 * sv + 0.3 * ga;
  const n = Math.max(0, starts || 0);
  return Math.round((n * raw + 4 * 50) / (n + 4));
}

export function ratingLabel(r) {
  if (r == null) return 'Inconnu';
  if (r >= 75) return 'Mur';
  if (r >= 60) return 'Solide';
  if (r >= 45) return 'Moyen';
  if (r >= 30) return 'Fragile';
  return 'Passoire';
}

// League-average-ish priors per game, used to steady small samples.
const PRIOR = {
  F: { points: 0.55, goals: 0.2, assists: 0.35, shots: 2.2 },
  D: { points: 0.35, goals: 0.06, assists: 0.29, shots: 1.6 },
};
const PRIOR_GAMES = 6;

export function shrunkRate(total, games, pos, stat) {
  const prior = (PRIOR[pos === 'D' ? 'D' : 'F'])[stat];
  return (total + prior * PRIOR_GAMES) / ((games || 0) + PRIOR_GAMES);
}

// Context multiplier: opposing goalie, opposing defence, home ice, back-to-back.
export function contextFactor({ oppGoalie = 50, oppGaPerGame, leagueGaPerGame = 3.0, home = false, backToBack = false }) {
  const goalie = 1.2 - 0.004 * clamp(oppGoalie ?? 50, 0, 100);
  const defence = oppGaPerGame ? clamp(Math.sqrt(oppGaPerGame / leagueGaPerGame), 0.85, 1.15) : 1;
  return goalie * defence * (home ? 1.03 : 0.97) * (backToBack ? 0.95 : 1);
}

export const MARKETS = [
  { id: 'point', label: '1+ point', stat: 'points', k: 1 },
  { id: 'goal', label: 'Buteur', stat: 'goals', k: 1 },
  { id: 'assist', label: '1+ passe', stat: 'assists', k: 1 },
  { id: 'points2', label: '2+ points', stat: 'points', k: 2 },
  { id: 'shots3', label: '3+ tirs', stat: 'shots', k: 3 },
];

// Returns { [marketId]: probability } for one skater in one game.
export function skaterProbabilities(s, ctx) {
  const f = contextFactor(ctx);
  const out = {};
  for (const m of MARKETS) {
    // Shots depend far less on the goalie than points do.
    const factor = m.stat === 'shots' ? (ctx.home ? 1.02 : 0.98) : f;
    const lambda = shrunkRate(s[m.stat] || 0, s.gp, s.pos, m.stat) * factor;
    out[m.id] = atLeast(lambda, m.k);
  }
  return out;
}

export const fairOdds = (p) => (p > 0 ? 1 / p : null);
export const edge = (p, odds) => (odds > 1 ? p - 1 / odds : null);

// Projected lines from average ice time: 4 lines of 3 forwards, 3 pairs of D.
export function estimateLines(skaters) {
  const byToi = (a, b) => (b.toi || 0) - (a.toi || 0);
  const healthy = skaters.filter((s) => s.gp > 0);
  const fwd = healthy.filter((s) => s.pos !== 'D').sort(byToi).slice(0, 12);
  const def = healthy.filter((s) => s.pos === 'D').sort(byToi).slice(0, 6);
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push(fwd.slice(i * 3, i * 3 + 3));
  const pairs = [];
  for (let i = 0; i < 3; i++) pairs.push(def.slice(i * 2, i * 2 + 2));
  return { lines: lines.filter((l) => l.length), pairs: pairs.filter((p) => p.length) };
}

// Most likely starter: the goalie with the most starts, unless the team played
// last night, where the backup usually starts.
export function likelyStarter(goalies, backToBack) {
  const ranked = [...goalies].filter((g) => g.gp > 0).sort((a, b) => (b.starts || 0) - (a.starts || 0));
  if (!ranked.length) return null;
  return backToBack && ranked[1] && (ranked[1].starts || 0) >= 2 ? ranked[1] : ranked[0];
}

export const pct = (p) => (p == null ? '—' : Math.round(p * 100) + ' %');
export const odds2 = (o) => (o == null ? '—' : o.toFixed(2).replace('.', ','));
export const mmss = (sec) => {
  if (!(sec > 0)) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// US bookmakers pay more than French ones (no ARJEL/ANJ tax): keep 85 % of the profit part.
// Example: 2.00 in the US becomes 1.85 here.
export const FR_FACTOR = 0.85;
export const frenchOdds = (dec) => (dec > 1 ? Math.round((1 + (dec - 1) * FR_FACTOR) * 100) / 100 : null);
export const americanToDecimal = (us) => (us >= 100 ? 1 + us / 100 : us <= -100 ? 1 + 100 / -us : null);
