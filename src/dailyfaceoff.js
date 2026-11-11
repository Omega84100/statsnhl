// Projected line combinations from Daily Faceoff (dailyfaceoff.com/teams/<slug>/line-combinations).
// Daily Faceoff has no public API, so the page is read and parsed. Two strategies:
// 1. the Next.js __NEXT_DATA__ JSON, if present (players with group/position identifiers);
// 2. otherwise, player links in page order: 12 forwards, 6 defensemen, PP1 (5), PP2 (5), PK1 (4), PK2 (4), 2 goalies, then injuries.

export const DFO_SLUGS = {
  ANA: 'anaheim-ducks', BOS: 'boston-bruins', BUF: 'buffalo-sabres', CAR: 'carolina-hurricanes', CBJ: 'columbus-blue-jackets',
  CGY: 'calgary-flames', CHI: 'chicago-blackhawks', COL: 'colorado-avalanche', DAL: 'dallas-stars', DET: 'detroit-red-wings',
  EDM: 'edmonton-oilers', FLA: 'florida-panthers', LAK: 'los-angeles-kings', MIN: 'minnesota-wild', MTL: 'montreal-canadiens',
  NJD: 'new-jersey-devils', NSH: 'nashville-predators', NYI: 'new-york-islanders', NYR: 'new-york-rangers', OTT: 'ottawa-senators',
  PHI: 'philadelphia-flyers', PIT: 'pittsburgh-penguins', SEA: 'seattle-kraken', SJS: 'san-jose-sharks', STL: 'st-louis-blues',
  TBL: 'tampa-bay-lightning', TOR: 'toronto-maple-leafs', UTA: 'utah-mammoth', VAN: 'vancouver-canucks', VGK: 'vegas-golden-knights',
  WPG: 'winnipeg-jets', WSH: 'washington-capitals',
};

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function fromNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  // Find the largest array of player-like objects carrying a group identifier.
  let best = null;
  const walk = (v, depth) => {
    if (!v || depth > 12) return;
    if (Array.isArray(v)) {
      if (v.length >= 10 && v.every((x) => x && typeof x === 'object' && ('groupIdentifier' in x || 'positionIdentifier' in x))) {
        if (!best || v.length > best.length) best = v;
      }
      for (const x of v) walk(x, depth + 1);
    } else if (typeof v === 'object') for (const k in v) walk(v[k], depth + 1);
  };
  walk(data, 0);
  if (!best) return null;
  const groups = {}, injuries = [];
  for (const p of best) {
    const name = decode(p.name || p.playerName || [p.firstName, p.lastName].filter(Boolean).join(' '));
    if (!name) continue;
    const g = String(p.groupIdentifier || '').toLowerCase() || 'other';
    const entry = { name, pos: String(p.positionIdentifier || '').toLowerCase(), number: p.jerseyNumber ?? p.sweaterNumber ?? null, injury: p.injuryStatus || null };
    if (/^(ir|inj|injur)/.test(g)) injuries.push(entry); else (groups[g] ??= []).push(entry);
  }
  // Normalise group names: forwards f1..f4, defence d1..d3, pp1/pp2, pk1/pk2, goalies g
  const out = {};
  for (const [g, list] of Object.entries(groups)) {
    const key = /^f\d$|^d\d$|^pp\d$|^pk\d$/.test(g) ? g : /^g/.test(g) ? 'g' : g;
    (out[key] ??= []).push(...list);
  }
  return out.f1 ? { groups: out, injuries } : null;
}

function fromLinks(html) {
  const re = /<a[^>]+href="\/players\/news\/([a-z0-9-]+)\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  const seq = [];
  let m;
  while ((m = re.exec(html))) {
    const text = decode(m[3].replace(/<[^>]+>/g, ' '));
    const last = seq[seq.length - 1];
    if (last && last.id === m[2]) { if (!last.name && text) last.name = text; continue; }
    seq.push({ id: m[2], name: text, idx: m.index });
  }
  const named = seq.filter((p) => p.name);
  if (named.length < 18) return null;
  const take = (n) => named.splice(0, n);
  const fw = take(12), d = take(6);
  const groups = { f1: fw.slice(0, 3), f2: fw.slice(3, 6), f3: fw.slice(6, 9), f4: fw.slice(9, 12), d1: d.slice(0, 2), d2: d.slice(2, 4), d3: d.slice(4, 6) };
  const pos = ['lw', 'c', 'rw'];
  for (let i = 1; i <= 4; i++) groups['f' + i] = groups['f' + i].map((p, k) => ({ name: p.name, pos: pos[k] + i }));
  for (let i = 1; i <= 3; i++) groups['d' + i] = groups['d' + i].map((p, k) => ({ name: p.name, pos: (k ? 'rd' : 'ld') + i }));
  if (named.length >= 18) {
    groups.pp1 = take(5).map((p) => ({ name: p.name })); groups.pp2 = take(5).map((p) => ({ name: p.name }));
    take(8); // penalty kill units
    groups.g = take(2).map((p) => ({ name: p.name }));
  }
  // Injury badges ("ir", "out", "dtd") that follow a link in the remaining part of the page.
  const injuries = named.map((p) => ({ name: p.name }));
  return { groups, injuries };
}

export function parseLines(html) {
  const updated = (html.match(/Last updated:?\s*(?:<!-- -->)?\s*([0-9T:.\-]+Z)/) || [])[1] || null;
  const res = fromNextData(html) || fromLinks(html);
  return res ? { ...res, updated } : null;
}

export async function fetchLines(abbr) {
  const slug = DFO_SLUGS[abbr];
  if (!slug) return null;
  const r = await fetch(`https://www.dailyfaceoff.com/teams/${slug}/line-combinations`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('dfo ' + r.status);
  return parseLines(await r.text());
}
