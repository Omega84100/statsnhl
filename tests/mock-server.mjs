// Local test server: serves public/ and fakes the NHL API with data shaped like
// the real api-web.nhle.com responses (checked 11/11/2026). Usage: node tests/mock-server.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { summarizeProps } from '../src/nhl-proxy.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = +process.argv[2] || 8787;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const TEAMS = [['TOR', 'Toronto', 'Maple Leafs'], ['MTL', 'Montréal', 'Canadiens'], ['EDM', 'Edmonton', 'Oilers'], ['VGK', 'Vegas', 'Golden Knights']];
const today = process.env.MOCK_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const svgLogo = (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#1d4ed8"/><text x="50" y="62" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">${a}</text></svg>`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const team = (i) => ({ id: i + 1, abbrev: TEAMS[i][0], placeName: { default: TEAMS[i][1] }, commonName: { default: TEAMS[i][2] }, logo: `https://assets.nhle.com/logos/nhl/svg/${TEAMS[i][0]}_light.svg`, darkLogo: `https://assets.nhle.com/logos/nhl/svg/${TEAMS[i][0]}_dark.svg` });
const games = [
  { id: 2026020300, startTimeUTC: `${today}T23:00:00Z`, gameState: 'LIVE', gameScheduleState: 'OK', venue: { default: 'Scotiabank Arena' }, awayTeam: team(1), homeTeam: team(0) },
  { id: 2026020301, startTimeUTC: `${today}T23:59:00Z`.replace('T23:59', 'T23:59'), gameState: 'FUT', gameScheduleState: 'OK', venue: { default: 'T-Mobile Arena' }, awayTeam: team(2), homeTeam: team(3) },
];
const FIRST = ['Auston', 'Mitch', 'William', 'Nick', 'Cole', 'Juraj', 'Leon', 'Connor', 'Jack', 'Mark', 'Alex', 'Ivan', 'Tomas', 'Shea', 'Noah', 'Jake', 'Owen', 'Ryan', 'Erik', 'Samuel'];
const LAST = ['Matthews', 'Marner', 'Nylander', 'Suzuki', 'Caufield', 'Slafkovsky', 'Draisaitl', 'McDavid', 'Eichel', 'Stone', 'Pietrangelo', 'Barbashev', 'Hertl', 'Theodore', 'Hanifin', 'Sanderson', 'Power', 'Nugent-Hopkins', 'Karlsson', 'Montembeault'];
const clubStats = {}, rosters = {};
TEAMS.forEach(([abbr], t) => {
  const skaters = [], goalies = [], fw = [], df = [], gl = [];
  for (let k = 0; k < 20; k++) {
    const id = 8470000 + t * 100 + k, pos = k < 13 ? ['C', 'L', 'R'][k % 3] : k < 20 ? 'D' : 'D';
    const gp = 15, pts = Math.round(rnd() * (k < 6 ? 24 : 10));
    const g = Math.round(pts * 0.4);
    skaters.push({ playerId: id, headshot: `https://assets.nhle.com/mugs/nhl/20262027/${abbr}/${id}.png`, firstName: { default: FIRST[k] }, lastName: { default: LAST[(k + t * 5) % 20] + (t ? '' : '') }, positionCode: pos, gamesPlayed: gp, goals: g, assists: pts - g, points: pts, plusMinus: 0, shots: 20 + Math.round(rnd() * 40), powerPlayGoals: 1, avgTimeOnIcePerGame: 1400 - k * 40 + Math.round(rnd() * 60) });
    (pos === 'D' ? df : fw).push({ id, sweaterNumber: 10 + k });
  }
  for (let k = 0; k < 2; k++) {
    const id = 8470090 + t * 100 + k;
    goalies.push({ playerId: id, headshot: `https://assets.nhle.com/mugs/nhl/20262027/${abbr}/${id}.png`, firstName: { default: k ? 'Backup' : 'Starter' }, lastName: { default: `${abbr}G${k}` }, gamesPlayed: k ? 4 : 12, gamesStarted: k ? 3 : 12, wins: 7, losses: 4, overtimeLosses: 1, goalsAgainstAverage: 2.4 + t * 0.4, savePercentage: 0.918 - t * 0.012, shutouts: 1 });
    gl.push({ id, sweaterNumber: 30 + k });
  }
  clubStats[abbr] = { season: '20262027', gameType: 2, skaters, goalies };
  rosters[abbr] = { forwards: fw, defensemen: df, goalies: gl };
});

const nhl = (p) => {
  if (p.startsWith('schedule/')) return { gameWeek: [{ date: today, games }] };
  if (p.startsWith('score/')) return p.endsWith(today) ? { games: [{ ...games[0], awayTeam: { ...games[0].awayTeam, score: 2, sog: 18 }, homeTeam: { ...games[0].homeTeam, score: 3, sog: 21 }, periodDescriptor: { number: 2, periodType: 'REG' }, clock: { timeRemaining: '07:42', inIntermission: false } }, games[1]] } : { games: [{ awayTeam: { abbrev: 'EDM' }, homeTeam: { abbrev: 'CAR' } }] };
  if (p === 'standings/now') return { standings: TEAMS.map(([a], i) => ({ teamAbbrev: { default: a }, wins: 9 - i, losses: 5 + i, otLosses: 1, points: 19 - i * 2, gamesPlayed: 15, goalFor: 50 - i * 3, goalAgainst: 40 + i * 4, l10Wins: 6, l10Losses: 3, l10OtLosses: 1, streakCode: 'W', streakCount: 2, leagueSequence: i + 1 })) };
  let m;
  if ((m = p.match(/^club-stats\/(\w+)\/now$/))) return clubStats[m[1]];
  if ((m = p.match(/^roster\/(\w+)\/current$/))) return rosters[m[1]];
  if (p.endsWith('/play-by-play')) {
    const plays = [];
    for (let i = 0; i < 39; i++) plays.push({ typeDescKey: i % 9 === 0 ? 'goal' : 'shot-on-goal', homeTeamDefendingSide: 'right', details: { xCoord: Math.round((rnd() * 70 + 15) * (i % 2 ? 1 : -1)), yCoord: Math.round(rnd() * 70 - 35), eventOwnerTeamId: i % 2 ? 1 : 2 } });
    return { homeTeam: { id: 1 }, awayTeam: { id: 2 }, plays };
  }
  if (p.includes('/game-log/')) return { gameLog: [1, 2, 3, 4, 5].map((d) => ({ gameDate: `2026-11-0${d}`, homeRoadFlag: d % 2 ? 'H' : 'R', opponentAbbrev: 'BOS', goals: d % 3 === 0 ? 1 : 0, assists: d % 2, points: (d % 3 === 0 ? 1 : 0) + (d % 2), shots: d + 1, toi: '19:2' + d })) };
  return null;
};

const oddsEvent = { bookmakers: [{ markets: [
  { key: 'player_points', outcomes: [{ name: 'Over', description: 'Auston Matthews', price: 1.6, point: 0.5 }, { name: 'Over', description: 'Mitch Marner', price: 1.7, point: 0.5 }] },
  { key: 'player_goal_scorer_anytime', outcomes: [{ name: 'Yes', description: 'Auston Matthews', price: 2.4 }] },
] }, { markets: [{ key: 'player_points', outcomes: [{ name: 'Over', description: 'Auston Matthews', price: 1.7, point: 0.5 }] }] }] };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (url.pathname.startsWith('/api/nhl/')) { const d = nhl(url.pathname.slice(9)); return d ? send(200, d) : send(404, { error: 'introuvable' }); }
  if (url.pathname.startsWith('/api/img/')) return url.pathname.endsWith('.svg') ? send(200, svgLogo(url.pathname.match(/([A-Z]{3})_/)[1]), 'image/svg+xml') : send(200, png, 'image/png');
  if (url.pathname === '/api/odds/events') return send(200, { enabled: true, events: [{ id: 'a'.repeat(32), home: 'Toronto Maple Leafs', away: 'Montreal Canadiens', start: games[0].startTimeUTC }] });
  if (url.pathname.startsWith('/api/odds/event/')) return send(200, { enabled: true, players: summarizeProps(oddsEvent) });
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  try { const body = await readFile(join(ROOT, path)); send(200, body, TYPES[extname(path)] || 'application/octet-stream'); }
  catch { send(200, await readFile(join(ROOT, 'index.html')), 'text/html'); }
}).listen(PORT, () => console.log('mock on', PORT));
