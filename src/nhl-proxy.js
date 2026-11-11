import { fetchLines } from './dailyfaceoff.js';
// Shared proxy logic for the official NHL API (used by Cloudflare and Netlify).
// The browser cannot call api-web.nhle.com directly (no CORS headers), so every
// request goes through /api/nhl/<path>. Only known read-only paths are allowed.

const API = 'https://api-web.nhle.com/v1/';
const DAY = '20\\d{2}-\\d{2}-\\d{2}';
const TEAM = '[A-Z]{3}';

// [pattern, seconds of cache]. Short caches keep scores live, long ones spare the API.
const ROUTES = [
  [new RegExp(`^score/(now|${DAY})$`), 20],
  [new RegExp(`^schedule/(now|${DAY})$`), 300],
  [/^gamecenter\/\d{10}\/(play-by-play|boxscore)$/, 20],
  [/^gamecenter\/\d{10}\/(landing|right-rail)$/, 120],
  [new RegExp(`^club-stats/${TEAM}/now$`), 1800],
  [new RegExp(`^roster/${TEAM}/current$`), 21600],
  [new RegExp(`^club-schedule/${TEAM}/week/now$`), 1800],
  [/^standings\/now$/, 1800],
  [/^player\/\d{7}\/(landing|game-log\/now)$/, 1800],
  [/^player\/\d{7}\/game-log\/20\d{6}\/2$/, 86400],
];

export function cacheSeconds(path) {
  for (const [re, ttl] of ROUTES) if (re.test(path)) return ttl;
  return null;
}

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });

// Player headshots and team logos are proxied too, so the 3D rink can use them
// as WebGL textures (that needs CORS headers the NHL image server may not send).
const IMG = /^(mugs\/nhl\/\d{8}\/[A-Z]{3}\/\d{7}\.png|logos\/nhl\/svg\/[A-Z]{3}_(light|dark)\.svg)$/;

export async function handleApi(request, { cache, env = {} } = {}) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET' });
  if (url.pathname.startsWith('/api/odds')) return handleOdds(url, { cache, key: env.ODDS_API_KEY });
  const lm = url.pathname.match(/^\/api\/lines\/([A-Z]{3})$/);
  if (lm) {
    try {
      return await cached(cache, `https://lines.cache/${lm[1]}`, 1800, async () => {
        const lines = await fetchLines(lm[1]);
        if (!lines) throw new Error('parse');
        return { source: 'dailyfaceoff', ...lines };
      });
    } catch {
      return json({ source: null }, 200, { 'Cache-Control': 'public, max-age=300' });
    }
  }

  let upstream, ttl;
  if (url.pathname === '/api/news') {
    // Official NHL.com articles in French (same feed as nhl.com/fr/news).
    upstream = 'https://forge-dapi.d3.nhle.com/v2/content/fr-ca/stories?$limit=60';
    ttl = 900;
  } else if (url.pathname.startsWith('/api/img/')) {
    const path = url.pathname.slice('/api/img/'.length);
    if (!IMG.test(path)) return json({ error: 'Image inconnue' }, 404);
    upstream = 'https://assets.nhle.com/' + path;
    ttl = 86400;
  } else if (url.pathname.startsWith('/api/nhl/')) {
    const path = url.pathname.slice('/api/nhl/'.length);
    ttl = cacheSeconds(path);
    if (ttl == null) return json({ error: 'Chemin non autorisé' }, 404);
    upstream = API + path;
  } else {
    return json({ error: 'Introuvable' }, 404);
  }

  const key = new Request(upstream);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let res;
  try {
    res = await fetch(upstream, {
      headers: { Accept: '*/*', 'User-Agent': 'statsnhl-perso' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return json({ error: 'La NHL ne répond pas, réessaie dans un instant.' }, 502, { 'Cache-Control': 'no-store' });
  }
  if (!res.ok) {
    return json({ error: `Source NHL indisponible (${res.status})` }, res.status === 404 ? 404 : 502, { 'Cache-Control': 'no-store' });
  }
  const out = new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      'Cache-Control': `public, max-age=${Math.min(ttl, 60)}, s-maxage=${ttl}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
  if (cache) {
    const stored = out.clone();
    // Cache API needs a max-age matching the edge TTL.
    const h = new Headers(stored.headers);
    h.set('Cache-Control', `public, max-age=${ttl}`);
    await cache.put(key, new Response(stored.body, { status: 200, headers: h }));
  }
  return out;
}

// ---------- Player prop odds (The Odds API, free plan: 500 credits a month) ----------
// The key stays on the server (secret ODDS_API_KEY). The events list is free;
// one game's props cost 4 credits, so they are cached 24 hours and only loaded
// when someone opens that game.
const ODDS = 'https://api.the-odds-api.com/v4/sports/icehockey_nhl/';
const PROP_MARKETS = 'player_points,player_goal_scorer_anytime,player_assists,player_shots_on_goal';

export const normName = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Turns the bookmaker list into { normalisedName: { name, point, goal, assist, points2, shots3 } }
// using the median decimal price across US bookmakers.
export function summarizeProps(event) {
  const acc = {};
  const add = (player, market, price) => {
    const k = normName(player);
    if (!k || !(price > 1)) return;
    acc[k] ??= { name: player };
    (acc[k][market] ??= []).push(price);
  };
  for (const book of event?.bookmakers ?? []) {
    for (const m of book.markets ?? []) {
      for (const o of m.outcomes ?? []) {
        const who = o.description, over = o.name === 'Over', pt = o.point;
        if (m.key === 'player_goal_scorer_anytime' && o.name === 'Yes') add(who, 'goal', o.price);
        else if (m.key === 'player_points' && over && pt === 0.5) add(who, 'point', o.price);
        else if (m.key === 'player_points' && over && pt === 1.5) add(who, 'points2', o.price);
        else if (m.key === 'player_assists' && over && pt === 0.5) add(who, 'assist', o.price);
        else if (m.key === 'player_shots_on_goal' && over && pt === 2.5) add(who, 'shots3', o.price);
      }
    }
  }
  for (const p of Object.values(acc)) for (const k of Object.keys(p)) if (Array.isArray(p[k])) p[k] = Math.round(median(p[k]) * 100) / 100;
  return acc;
}

async function cached(cache, keyUrl, ttl, produce) {
  const key = new Request(keyUrl);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const body = await produce();
  const res = json(body, 200, { 'Cache-Control': `public, max-age=${Math.min(ttl, 300)}` });
  if (cache) await cache.put(key, json(body, 200, { 'Cache-Control': `public, max-age=${ttl}` }));
  return res;
}

async function handleOdds(url, { cache, key }) {
  if (!key) return json({ enabled: false }, 200, { 'Cache-Control': 'no-store' });
  const call = async (path) => {
    const r = await fetch(`${ODDS}${path}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  try {
    if (url.pathname === '/api/odds/events') {
      return await cached(cache, 'https://odds.cache/events', 3600, async () => ({
        enabled: true,
        events: (await call('events?dateFormat=iso')).map((e) => ({ id: e.id, home: e.home_team, away: e.away_team, start: e.commence_time })),
      }));
    }
    const m = url.pathname.match(/^\/api\/odds\/event\/([a-f0-9]{32})$/);
    if (m) {
      return await cached(cache, `https://odds.cache/event/${m[1]}`, 86400, async () => ({
        enabled: true,
        players: summarizeProps(await call(`events/${m[1]}/odds?regions=us&oddsFormat=decimal&markets=${PROP_MARKETS}`)),
      }));
    }
    return json({ error: 'Introuvable' }, 404);
  } catch {
    return json({ enabled: true, error: 'Cotes indisponibles pour le moment.' }, 502, { 'Cache-Control': 'no-store' });
  }
}
