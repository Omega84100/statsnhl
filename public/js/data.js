// Loads one NHL night from the official API (through our /api proxy) and turns
// it into ready-to-display games, players, goalies and probabilities.
import { goalieRating, likelyStarter, skaterProbabilities, estimateLines } from './model.js';

const get = async (path) => {
  const r = await fetch('/api/nhl/' + path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Source NHL indisponible');
  return r.json();
};
const tryGet = (path) => get(path).catch(() => null);
const txt = (v) => (typeof v === 'string' ? v : v?.default ?? '');

export const TEAM_COLORS = {
  ANA: '#fc4c02', BOS: '#fcb514', BUF: '#2f6fd6', CAR: '#ce1126', CBJ: '#3b6fb6', CGY: '#d2001c', CHI: '#cf0a2c', COL: '#a2aaad',
  DAL: '#00a86b', DET: '#ce1126', EDM: '#ff4c00', FLA: '#c8102e', LAK: '#a2aaad', MIN: '#2e8b57', MTL: '#af1e2d', NJD: '#ce1126',
  NSH: '#ffb81c', NYI: '#f47d30', NYR: '#0038a8', OTT: '#c52032', PHI: '#f74902', PIT: '#fcb514', SEA: '#68a2b9', SJS: '#00a3b4',
  STL: '#2f6fd6', TBL: '#3d7fd8', TOR: '#3a6fd8', UTA: '#6cace4', VAN: '#00843d', VGK: '#b4975a', WPG: '#4b7bd8', WSH: '#c8102e',
};
export const teamColor = (abbr) => TEAM_COLORS[abbr] || '#90c4ff';

export function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

const POS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };

function normTeam(t) {
  return {
    abbr: t.abbrev,
    name: [txt(t.placeName), txt(t.commonName) || txt(t.name)].filter(Boolean).join(' '),
    short: txt(t.commonName) || txt(t.name) || t.abbrev,
    logo: t.darkLogo || t.logo || `https://assets.nhle.com/logos/nhl/svg/${t.abbrev}_dark.svg`,
    logoLight: t.logo || `https://assets.nhle.com/logos/nhl/svg/${t.abbrev}_light.svg`,
    score: t.score ?? null, sog: t.sog ?? null,
    color: teamColor(t.abbrev),
  };
}

function teamData(abbr, stats, roster) {
  const current = roster ? new Set([...(roster.forwards || []), ...(roster.defensemen || []), ...(roster.goalies || [])].map((p) => p.id)) : null;
  const numbers = new Map();
  if (roster) for (const p of [...(roster.forwards || []), ...(roster.defensemen || []), ...(roster.goalies || [])]) numbers.set(p.id, p.sweaterNumber);
  const keep = (id) => !current || current.has(id);
  const skaters = (stats?.skaters || []).filter((s) => keep(s.playerId)).map((s) => ({
    id: s.playerId, team: abbr,
    first: txt(s.firstName), last: txt(s.lastName),
    name: `${txt(s.firstName)} ${txt(s.lastName)}`.trim(),
    short: `${txt(s.firstName).charAt(0)}. ${txt(s.lastName)}`,
    posCode: s.positionCode, posLabel: POS[s.positionCode] || s.positionCode,
    pos: s.positionCode === 'D' ? 'D' : 'F',
    number: numbers.get(s.playerId) ?? null,
    headshot: s.headshot, gp: s.gamesPlayed || 0,
    goals: s.goals || 0, assists: s.assists || 0, points: s.points || 0, shots: s.shots || 0,
    ppg: s.powerPlayGoals || 0, plusMinus: s.plusMinus || 0, toi: s.avgTimeOnIcePerGame || 0,
  }));
  const goalies = (stats?.goalies || []).filter((g) => keep(g.playerId)).map((g) => ({
    id: g.playerId, team: abbr,
    name: `${txt(g.firstName)} ${txt(g.lastName)}`.trim(), last: txt(g.lastName),
    short: `${txt(g.firstName).charAt(0)}. ${txt(g.lastName)}`,
    number: numbers.get(g.playerId) ?? null, headshot: g.headshot,
    gp: g.gamesPlayed || 0, starts: g.gamesStarted || 0, wins: g.wins || 0, losses: g.losses || 0, otl: g.overtimeLosses || 0,
    gaa: g.goalsAgainstAverage, savePct: g.savePercentage, shutouts: g.shutouts || 0,
    rating: goalieRating({ savePct: g.savePercentage, gaa: g.goalsAgainstAverage, starts: g.gamesStarted }),
  }));
  return { skaters, goalies };
}

// Main loader: everything for one date (America/New_York calendar day).
export async function loadNight(date) {
  const [schedule, score, yesterday, standings] = await Promise.all([
    get(`schedule/${date}`), tryGet(`score/${date}`), tryGet(`score/${shiftDate(date, -1)}`), tryGet('standings/now'),
  ]);
  const day = schedule.gameWeek?.find((d) => d.date === date);
  const live = new Map((score?.games || []).map((g) => [g.id, g]));
  const playedYesterday = new Set((yesterday?.games || []).flatMap((g) => [g.awayTeam?.abbrev, g.homeTeam?.abbrev]));

  const table = new Map();
  let ga = 0, gp = 0;
  for (const s of standings?.standings || []) {
    const abbr = txt(s.teamAbbrev);
    table.set(abbr, {
      record: `${s.wins}-${s.losses}-${s.otLosses}`, points: s.points, gp: s.gamesPlayed,
      gfpg: s.gamesPlayed ? s.goalFor / s.gamesPlayed : null, gapg: s.gamesPlayed ? s.goalAgainst / s.gamesPlayed : null,
      l10: `${s.l10Wins}-${s.l10Losses}-${s.l10OtLosses}`, streak: s.streakCode ? `${s.streakCode}${s.streakCount}` : '',
      rank: s.leagueSequence,
    });
    ga += s.goalAgainst || 0; gp += s.gamesPlayed || 0;
  }
  const leagueGa = gp ? ga / gp : 3.0;

  const games = (day?.games || [])
    .filter((g) => !['PPD', 'CNCL'].includes(g.gameScheduleState))
    .map((g) => {
      const l = live.get(g.id) || {};
      return {
        id: g.id, start: g.startTimeUTC, state: l.gameState || g.gameState, venue: txt(g.venue),
        period: l.periodDescriptor?.number ?? null, periodType: l.periodDescriptor?.periodType ?? null,
        clock: l.clock?.timeRemaining ?? null, intermission: !!l.clock?.inIntermission,
        away: normTeam({ ...g.awayTeam, ...(l.awayTeam || {}) }), home: normTeam({ ...g.homeTeam, ...(l.homeTeam || {}) }),
        goals: l.goals || [],
      };
    });

  const abbrs = [...new Set(games.flatMap((g) => [g.away.abbr, g.home.abbr]))];
  const teams = Object.fromEntries(await Promise.all(abbrs.map(async (a) => {
    const [stats, roster] = await Promise.all([tryGet(`club-stats/${a}/now`), tryGet(`roster/${a}/current`)]);
    return [a, teamData(a, stats, roster)];
  })));

  const players = [];
  for (const g of games) {
    for (const side of ['away', 'home']) {
      const t = g[side], opp = g[side === 'home' ? 'away' : 'home'];
      const data = teams[t.abbr] || { skaters: [], goalies: [] };
      t.b2b = playedYesterday.has(t.abbr);
      t.standing = table.get(t.abbr) || null;
      t.goalies = [...data.goalies].sort((a, b) => b.starts - a.starts);
      t.starter = likelyStarter(data.goalies, t.b2b);
      t.lines = estimateLines(data.skaters);
      t.skaters = data.skaters;
    }
    players.push(...gamePlayers(g, leagueGa));
  }
  return { date, games, players, leagueGa, fetchedAt: new Date() };
}

// Probabilities for the dressed players of one game (projected lines + pairs).
export function gamePlayers(g, leagueGa) {
  const out = [];
  for (const side of ['away', 'home']) {
    const t = g[side], opp = g[side === 'home' ? 'away' : 'home'];
    const ctx = { oppGoalie: opp.starter?.rating ?? 50, oppGaPerGame: opp.standing?.gapg, leagueGaPerGame: leagueGa, home: side === 'home', backToBack: t.b2b };
    const roleOf = new Map();
    t.lines.lines.forEach((l, i) => l.forEach((p) => roleOf.set(p.id, 'L' + (i + 1))));
    t.lines.pairs.forEach((l, i) => l.forEach((p) => roleOf.set(p.id, 'D' + (i + 1))));
    const pp = new Map();
    (t.pp || []).forEach((u, i) => u.forEach((p) => pp.set(p.id, 'PP' + (i + 1))));
    for (const s of t.skaters) {
      if (!roleOf.has(s.id)) continue; // only the projected dressed players
      out.push({ ...s, gameId: g.id, opp: opp.abbr, home: side === 'home', oppGoalie: opp.starter, b2b: t.b2b, role: roleOf.get(s.id), pp: pp.get(s.id) || null, probs: skaterProbabilities(s, ctx) });
    }
  }
  return out;
}

// ----- Daily Faceoff projected lines, mapped onto NHL players -----
const lastName = (n) => norm(String(n).split(' ').slice(1).join(' ') || n);
function matcher(list) {
  const full = new Map(list.map((p) => [norm(p.name), p]));
  return (name) => {
    if (!name) return null;
    const hit = full.get(norm(name));
    if (hit) return hit;
    const ln = lastName(name), cands = list.filter((p) => norm(p.last) === ln);
    return cands.length === 1 ? cands[0] : null;
  };
}
export async function applyDailyFaceoff(g, leagueGa) {
  const res = await Promise.all([g.away, g.home].map((t) => fetch('/api/lines/' + t.abbr).then((r) => r.json()).catch(() => null)));
  let changed = false;
  [g.away, g.home].forEach((t, i) => {
    const d = res[i];
    if (!d?.groups?.f1) { t.linesSource = 'estimate'; return; }
    const find = matcher(t.skaters), findG = matcher(t.goalies);
    const unit = (k) => (d.groups[k] || []).map((x) => find(x.name)).filter(Boolean);
    const lines = ['f1', 'f2', 'f3', 'f4'].map(unit).filter((l) => l.length);
    const pairs = ['d1', 'd2', 'd3'].map(unit).filter((l) => l.length);
    if (lines.length < 3 || pairs.length < 2) { t.linesSource = 'estimate'; return; }
    // Daily Faceoff lists LW, C, RW: keep that order for the rink.
    t.lines = { lines, pairs };
    t.pp = ['pp1', 'pp2'].map(unit).filter((l) => l.length);
    const g1 = (d.groups.g || []).map((x) => findG(x.name)).filter(Boolean)[0];
    if (g1) t.starter = g1;
    t.injured = (d.injuries || []).map((x) => x.name);
    t.linesSource = 'dailyfaceoff'; t.linesUpdated = d.updated || null;
    changed = true;
  });
  return changed;
}

// Live score refresh (cheap: one request).
export async function loadScores(date) {
  const score = await tryGet(`score/${date}`);
  return new Map((score?.games || []).map((g) => [g.id, g]));
}

export async function loadPlayByPlay(gameId) {
  return tryGet(`gamecenter/${gameId}/play-by-play`);
}
export async function loadBoxscore(gameId) {
  return tryGet(`gamecenter/${gameId}/boxscore`);
}
export async function loadGameLog(playerId) {
  return tryGet(`player/${playerId}/game-log/now`);
}

// Shots and goals for the 3D rink, oriented so the away team always shoots at
// the right-hand net and the home team at the left-hand net (each team defends
// its own half, like on the lineup view).
export function shotsFromPbp(pbp, homeId, colors) {
  const out = [];
  for (const p of pbp?.plays || []) {
    if (!['shot-on-goal', 'goal'].includes(p.typeDescKey)) continue;
    const d = p.details || {};
    if (d.xCoord == null || d.yCoord == null) continue;
    const isHome = d.eventOwnerTeamId === homeId;
    const want = isHome ? -1 : 1;
    const flip = Math.sign(d.xCoord || 1) !== want;
    out.push({ x: flip ? -d.xCoord : d.xCoord, y: flip ? -d.yCoord : d.yCoord, goal: p.typeDescKey === 'goal', color: isHome ? colors.home : colors.away, home: isHome });
  }
  return out;
}

// ----- Odds (optional, needs the ODDS_API_KEY secret on the server) -----
let eventsPromise = null;
export function loadOddsEvents() {
  eventsPromise ??= fetch('/api/odds/events').then((r) => r.json()).catch(() => ({ enabled: false }));
  return eventsPromise;
}
const norm = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const normName = norm;
export async function loadGameOdds(game) {
  const ev = await loadOddsEvents();
  if (!ev?.enabled) return { enabled: false };
  const t = Date.parse(game.start);
  const match = (ev.events || []).find((e) => norm(e.home) === norm(game.home.name) && Math.abs(Date.parse(e.start) - t) < 12 * 3600e3);
  if (!match) return { enabled: true, players: {} };
  const r = await fetch(`/api/odds/event/${match.id}`).then((x) => x.json()).catch(() => null);
  return r?.players ? { enabled: true, players: r.players } : { enabled: true, players: {}, error: r?.error };
}

// ----- Match context (head-to-head, special teams, last 10, coaches, officials) -----
export const loadRightRail = (gameId) => tryGet(`gamecenter/${gameId}/right-rail`);

// ----- Official NHL.com news in French -----
let newsPromise = null;
export function loadNews() {
  newsPromise ??= fetch('/api/news').then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })).then((d) =>
    (d.items || []).map((it) => {
      const tags = it.tags || [];
      const img = it.thumbnail?.templateUrl ? it.thumbnail.templateUrl.replace('{formatInstructions}', 't_ratio16_9-size40') : it.thumbnail?.thumbnailUrl;
      return {
        id: it._entityId || it.slug, title: it.headline || it.title, summary: it.fields?.description || String(it.summary || '').split('\n')[0],
        url: `https://www.nhl.com/fr/news/${it.slug}`, img, date: it.contentDate, author: it.createdBy || '',
        teams: tags.map((t) => t.extraData?.abbreviation).filter(Boolean),
        players: tags.map((t) => Number(t.extraData?.playerId)).filter(Boolean),
        preview: tags.some((t) => t.slug === 'game-preview'),
      };
    }).filter((a) => a.title));
  return newsPromise;
}
