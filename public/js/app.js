import { loadNight, loadScores, loadPlayByPlay, loadGameLog, loadForm, loadGameOdds, shotsFromPbp, nyDate, shiftDate, normName, loadRightRail, loadNews, applyDailyFaceoff, gamePlayers } from './data.js';
import { MARKETS, pct, odds2, mmss, fairOdds, edge, frenchOdds, ratingLabel } from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const SVG = (d) => `<svg class="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = { x: SVG('<path d="M18 6L6 18M6 6l12 12"/>'), plus: SVG('<path d="M12 5v14M5 12h14"/>'), check: SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>') };
const addIcon = (on) => (on ? ICON.check : ICON.plus);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parisTime = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const longDate = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
const MK = Object.fromEntries(MARKETS.map((m) => [m.id, m]));
const isLive = (s) => s === 'LIVE' || s === 'CRIT';
const isDone = (s) => s === 'OFF' || s === 'FINAL';

const state = {
  date: new URLSearchParams(location.search).get('date') || nyDate(),
  night: null, error: null, market: 'point', sort: 'point', q: '', team: '',
  odds: new Map(), // gameId -> { enabled, players }
  rink: null, rinkGame: null, rinkMode: 'lineup', newsTeam: '', unit: 'L1', dfoLoaded: new Set(),
};

// ---------------- Slip (saved on this device only) ----------------
let slip = [];
try { slip = JSON.parse(localStorage.getItem('statsnhl-slip') || '[]'); } catch { slip = []; }
const saveSlip = () => { try { localStorage.setItem('statsnhl-slip', JSON.stringify(slip)); } catch {} $('#slip-count').textContent = slip.length; };

function addToSlip(p, marketId, odds) {
  const key = `${p.id}:${marketId}`;
  if (slip.some((s) => s.key === key)) { slip = slip.filter((s) => s.key !== key); }
  else slip.push({ key, id: p.id, name: p.name, team: p.team, opp: p.opp, gameId: p.gameId, home: p.home, market: marketId, prob: p.probs[marketId], odds: odds || +fairOdds(p.probs[marketId]).toFixed(2), date: state.date });
  saveSlip(); toast(slip.some((s) => s.key === key) ? 'Ajouté au combiné' : 'Retiré du combiné');
  if (route().name !== 'match') render();
}
const inSlip = (id, m) => slip.some((s) => s.key === `${id}:${m}`);

function renderSlip() {
  const body = $('#slip-body');
  if (!slip.length) { body.innerHTML = `<p class="empty">Ton combiné est vide. Clique sur <b>+</b> à côté d’un pari pour l’ajouter.</p>`; return; }
  const stake = +(localStorage.getItem('statsnhl-stake') || 10);
  const oddsTot = slip.reduce((a, s) => a * (s.odds || 1), 1);
  const probTot = slip.reduce((a, s) => a * (s.prob || 0), 1);
  const ev = probTot * oddsTot - 1;
  body.innerHTML = `<ul class="slip-list">${slip.map((s, i) => `<li>
      <div><b>${esc(s.name)}</b><small>${esc(MK[s.market]?.label)} · ${esc(s.team)} ${s.home ? 'vs' : '@'} ${esc(s.opp)} · modèle ${pct(s.prob)}</small></div>
      <label class="odds-in">Cote<input inputmode="decimal" data-i="${i}" value="${String(s.odds).replace('.', ',')}" aria-label="Cote pour ${esc(s.name)}"></label>
      <button class="icon-btn" data-del="${i}" aria-label="Retirer">${ICON.x}</button></li>`).join('')}</ul>
    <div class="slip-sum">
      <div><small>Cote totale</small><b>${odds2(oddsTot)}</b></div>
      <div><small>Chance estimée</small><b>${pct(probTot)}</b></div>
      <div><small>Valeur</small><b class="${ev >= 0 ? 'pos' : 'neg'}">${ev >= 0 ? '+' : ''}${Math.round(ev * 100)} %</b></div>
    </div>
    <label class="stake">Mise (€)<input id="stake" inputmode="decimal" value="${stake}"></label>
    <p class="gain">Gain possible : <b>${(stake * oddsTot).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</b></p>
    <p class="fine">Les joueurs d’un même match sont liés : la vraie chance d’un combiné sur le même match est un peu différente. Valeur positive = la cote paie plus que ce que le modèle estime.</p>
    <button class="ghost" id="slip-clear">Vider le combiné</button>`;
}
$('#slip-body').addEventListener('change', (e) => {
  if (e.target.dataset.i != null) { const v = parseFloat(e.target.value.replace(',', '.')); if (v > 1) slip[+e.target.dataset.i].odds = v; saveSlip(); renderSlip(); }
  if (e.target.id === 'stake') { try { localStorage.setItem('statsnhl-stake', String(parseFloat(e.target.value.replace(',', '.')) || 10)); } catch {} renderSlip(); }
});
$('#slip-body').addEventListener('click', (e) => {
  const d = e.target.closest('[data-del]'); if (d) { slip.splice(+d.dataset.del, 1); saveSlip(); renderSlip(); }
  if (e.target.id === 'slip-clear') { slip = []; saveSlip(); renderSlip(); }
});
$('#slip-btn').onclick = () => { renderSlip(); $('#slip').showModal(); };
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
});

let toastTimer;
function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1600);
}

// ---------------- Small building blocks ----------------
const logo = (t, size = 40) => `<img class="logo" src="${esc(t.logo)}" alt="${esc(t.abbr)}" width="${size}" height="${size}" loading="lazy">`;
const face = (p, cls = '') => `<img class="face ${cls}" src="${esc(p.headshot)}" alt="" width="64" height="64" loading="lazy" onerror="this.style.visibility='hidden'">`;
function ratingChip(g) {
  if (!g) return '<span class="rate na">?</span>';
  const r = g.rating;
  const tone = r >= 60 ? 'hi' : r >= 45 ? 'mid' : 'lo';
  return `<span class="rate ${tone}" title="Note du gardien : ${r}/100 (${ratingLabel(r)})">${r}</span>`;
}
function gameStatus(g) {
  if (isLive(g.state)) return `<span class="live-dot"></span>${g.intermission ? 'Pause' : `P${g.period ?? ''} · ${esc(g.clock ?? '')}`}`;
  if (isDone(g.state)) return `Terminé${g.periodType && g.periodType !== 'REG' ? ' (' + esc(g.periodType === 'OT' ? 'prol.' : 'TB') + ')' : ''}`;
  return `${parisTime(g.start)}`;
}
const scoreOrVs = (g) => (isLive(g.state) || isDone(g.state)) ? `<b class="score">${g.away.score ?? 0}<i>–</i>${g.home.score ?? 0}</b>` : '<span class="vs">@</span>';

function pickCard(p, m, rank) {
  const prob = p.probs[m];
  const o = state.odds.get(p.gameId)?.players?.[normName(p.name)]?.[m];
  const fr = frenchOdds(o);
  const e = fr ? edge(prob, fr) : null;
  return `<article class="pick" style="--tc:${state.night.games.find((g) => g.id === p.gameId)?.[p.home ? 'home' : 'away'].color}">
    <span class="rank">${rank}</span>
    <button class="pick-main" data-player="${p.id}" aria-label="Voir la fiche de ${esc(p.name)}">
      ${face(p)}<div><small>${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)} · ${esc(p.posLabel)}</small><h3>${esc(p.name)}</h3>
      <span class="meta">${p.points} pts en ${p.gp} m. · ${mmss(p.toi)} de glace</span></div>
    </button>
    <div class="pick-nums">
      <div><small>${esc(MK[m].label)}</small><b class="tick" data-v="${Math.round(prob * 100)}">${pct(prob)}</b></div>
      <div><small>Cote juste</small><b>${odds2(fairOdds(prob))}</b></div>
      <div><small>${fr ? 'Cote FR est.' : 'Gardien adv.'}</small><b>${fr ? odds2(fr) : (p.oppGoalie ? esc(p.oppGoalie.short.split(' ').pop()) + ' ' + ratingChip(p.oppGoalie) : '—')}</b></div>
    </div>
    <div class="bar"><i style="width:${Math.round(prob * 100)}%"></i></div>
    <div class="formline" data-form="${p.id}" data-opp="${esc(p.opp)}"><span class="form sk">Forme…</span></div>
    <div class="pick-foot">
      ${e != null ? `<span class="tag ${e > 0 ? 'good' : 'bad'}">${e > 0 ? 'Valeur +' : 'Valeur '}${Math.round(e * 100)}</span>` : ''}
      ${p.b2b ? '<span class="tag warn">a joué hier</span>' : ''}
      <button class="add ${inSlip(p.id, m) ? 'on' : ''}" data-add="${p.id}" data-m="${m}" aria-label="Ajouter au combiné">${addIcon(inSlip(p.id, m))}</button>
    </div>
  </article>`;
}

// ---------------- Form: hot/cold and history vs the opponent ----------------
function formTone(f) { return f.last5Hits >= 4 ? 'hot' : f.last5Hits <= 1 ? 'cold' : 'mid'; }
const FORM_LABEL = { hot: 'En feu', mid: 'Régulier', cold: 'En panne' };
function formLine(f, opp) {
  const t = formTone(f);
  return `<span class="form ${t}" title="Au moins 1 point dans ${f.last5Hits} des 5 derniers matchs">${FORM_LABEL[t]} ${f.last5Hits}/5</span>`
    + (f.vs.n ? `<span class="vsform" title="${f.vs.n} matchs contre ${esc(opp)} depuis ${f.since} : ${f.vs.goals} buts, ${f.vs.assists} passes">vs ${esc(opp)} ${f.vs.hits}/${f.vs.n} · ${f.vs.points} pts</span>` : `<span class="vsform none">jamais affronté ${esc(opp)}</span>`);
}
// Fill every [data-form] placeholder on screen, a few players at a time.
let formQueue = Promise.resolve();
function fillForms() {
  const els = [...document.querySelectorAll('[data-form]:not([data-done])')];
  els.forEach((el) => el.setAttribute('data-done', ''));
  formQueue = formQueue.then(async () => {
    for (let i = 0; i < els.length; i += 6) {
      await Promise.all(els.slice(i, i + 6).map(async (el) => {
        const f = await loadForm(+el.dataset.form, el.dataset.opp, state.date).catch(() => null);
        if (f && el.isConnected) el.innerHTML = formLine(f, el.dataset.opp);
      }));
    }
  });
}

// ---------------- Views ----------------
function homeGames() {
  const n = state.night;
  return n.games.map((g) => `
      <a class="game ${isLive(g.state) ? 'is-live beam' : ''}" href="#/match/${g.id}" style="--a:${g.away.color};--h:${g.home.color}">
        <div class="g-status">${gameStatus(g)}</div>
        <div class="g-teams">
          <div class="g-team">${logo(g.away, 56)}<b>${esc(g.away.abbr)}</b><small>${esc(g.away.standing?.record || '')}</small></div>
          ${scoreOrVs(g)}
          <div class="g-team">${logo(g.home, 56)}<b>${esc(g.home.abbr)}</b><small>${esc(g.home.standing?.record || '')}</small></div>
        </div>
        <div class="g-goalies">
          <span>${ratingChip(g.away.starter)} ${esc(g.away.starter?.short || '—')}</span>
          <span>${esc(g.home.starter?.short || '—')} ${ratingChip(g.home.starter)}</span>
        </div>
        ${g.away.b2b || g.home.b2b ? `<div class="g-warn">${[g.away, g.home].filter((t) => t.b2b).map((t) => esc(t.abbr)).join(', ')} a joué hier soir</div>` : ''}
      </a>`).join('');
}
function viewHome() {
  const n = state.night;
  if (!n.games.length) return `<section class="hero"><h1>Pas de match <span>${esc(longDate(n.date))}</span></h1><p class="lead">Utilise les flèches en haut pour changer de soirée.</p></section>`;
  const best = [...n.players].sort((a, b) => b.probs.point - a.probs.point).slice(0, 6);
  const liveN = n.games.filter((g) => isLive(g.state)).length;
  const f = featuredGame();
  return `<section class="hero hero3d" style="--a:${f.away.color};--h:${f.home.color}">
      <div id="rink" class="rink hero-rink" aria-label="Aréna 3D du match à la une"></div>
      <div class="hero-overlay">
        <h1>${n.games.length} match${n.games.length > 1 ? 's' : ''} <span>ce soir</span></h1>
        <p class="lead">${liveN ? `<span class="live-dot"></span>${liveN} en direct · ` : ''}<span class="cap">${esc(longDate(n.date))}</span>, heure de Paris. ${n.players.length} joueurs analysés, gardiens notés sur 100.</p>
        <a class="feature beam" href="#/match/${f.id}">${logo(f.away, 34)}<span><small>${isLive(f.state) ? 'En direct' : isDone(f.state) ? 'Terminé' : 'À la une'}</small>${esc(f.away.short)} @ ${esc(f.home.short)}</span>${logo(f.home, 34)}<b>Entrer dans l’aréna →</b></a>
      </div>
    </section>
    <section class="games" id="home-games">${homeGames()}</section>
    <section><div class="sec-head"><h2>Les plus probables ce soir</h2><a class="more" href="#/paris">Tous les paris →</a></div>
      <div class="grid">${best.map((p, i) => pickCard(p, 'point', i + 1)).join('')}</div></section>`;
}

function viewPicks() {
  const n = state.night, m = state.market;
  const list = [...n.players].sort((a, b) => b.probs[m] - a.probs[m]).slice(0, 24);
  const oddsOn = [...state.odds.values()].some((o) => o.enabled);
  return `<section><h1 class="h1s">Meilleurs paris</h1>
    <p class="lead">Classés par probabilité du modèle. La « cote juste » est la cote minimale pour que le pari vaille le coup.</p>
    <div class="chips" role="tablist">${MARKETS.map((x) => `<button role="tab" aria-selected="${x.id === m}" data-market="${x.id}">${esc(x.label)}</button>`).join('')}</div>
    <button class="ghost" id="load-all-odds">${oddsOn ? 'Cotes chargées' : 'Charger les cotes de tous les matchs'}</button>
    <div class="grid">${list.map((p, i) => pickCard(p, m, i + 1)).join('')}</div></section>`;
}

function goalieCard(g, team, opp) {
  if (!g) return `<div class="goalie-card"><p>Gardien inconnu</p></div>`;
  return `<div class="goalie-card" style="--tc:${team.color}">
    ${face(g, 'big')}
    <div class="gc-body"><small>${esc(team.abbr)}${opp ? ' vs ' + esc(opp.abbr) : ''} · ${team.b2b ? 'probable (2e soir de suite)' : 'titulaire probable'}</small>
      <h3>${esc(g.name)}</h3>
      <div class="gauge" role="img" aria-label="Note ${g.rating} sur 100"><i style="width:${g.rating}%"></i></div>
      <p class="gc-line"><b class="gc-rate tick" data-v="${g.rating}" data-unit="">${g.rating}</b><span>/100 · ${ratingLabel(g.rating)}</span></p>
      <dl><div><dt>Arrêts</dt><dd>${g.savePct != null ? (g.savePct * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</dd></div>
      <div><dt>Moy. buts</dt><dd>${g.gaa != null ? g.gaa.toFixed(2).replace('.', ',') : '—'}</dd></div>
      <div><dt>Bilan</dt><dd>${g.wins}-${g.losses}-${g.otl}</dd></div>
      <div><dt>Titu.</dt><dd>${g.starts}</dd></div></dl>
    </div></div>`;
}

function viewGoalies() {
  const n = state.night;
  const list = n.games.flatMap((g) => [[g.away.starter, g.away, g.home], [g.home.starter, g.home, g.away]]).filter((x) => x[0]).sort((a, b) => b[0].rating - a[0].rating);
  return `<section><h1 class="h1s">Gardiens du soir</h1>
    <p class="lead">Note sur 100 : 70 % pourcentage d’arrêts, 30 % moyenne de buts encaissés, ramenée vers 50 quand le gardien a peu joué. Plus la note est basse, plus c’est intéressant pour les attaquants d’en face.</p>
    <div class="goalie-grid">${list.map(([g, t, o]) => goalieCard(g, t, o)).join('')}</div></section>`;
}

function viewPlayers() {
  const n = state.night;
  const q = normName(state.q);
  const list = n.players.filter((p) => (!q || normName(p.name).includes(q)) && (!state.team || p.team === state.team))
    .sort((a, b) => (state.sort === 'name' ? a.name.localeCompare(b.name) : (b.probs[state.sort] ?? 0) - (a.probs[state.sort] ?? 0)));
  const teams = [...new Set(n.players.map((p) => p.team))].sort();
  return `<section><h1 class="h1s">Tous les joueurs</h1>
    <div class="filters"><input id="q" type="search" placeholder="Chercher un joueur" value="${esc(state.q)}" aria-label="Chercher un joueur">
      <select id="team" aria-label="Équipe"><option value="">Toutes les équipes</option>${teams.map((t) => `<option ${t === state.team ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="table-wrap"><table class="ptable"><thead><tr><th><button data-sort="name">Joueur</button></th><th>Match</th><th>Glace</th>
      ${MARKETS.map((m) => `<th><button data-sort="${m.id}" aria-sort="${state.sort === m.id ? 'descending' : 'none'}">${esc(m.label)}</button></th>`).join('')}</tr></thead>
    <tbody>${list.slice(0, 400).map((p) => `<tr><td><button class="link" data-player="${p.id}">${face(p, 'mini')}${esc(p.name)}</button><small>${esc(p.posLabel)}</small></td>
      <td>${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)}</td><td>${mmss(p.toi)}</td>
      ${MARKETS.map((m) => `<td class="num"><button class="cell ${inSlip(p.id, m.id) ? 'on' : ''}" data-add="${p.id}" data-m="${m.id}" title="Ajouter au combiné">${pct(p.probs[m.id])}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fine">Clique sur un pourcentage pour l’ajouter au combiné.</p></section>`;
}

function viewMethod() {
  return `<section class="prose"><h1 class="h1s">Méthode</h1>
  <h2>D’où viennent les données</h2><p>Tout vient de l’API officielle de la NHL, rechargée automatiquement : calendrier et scores toutes les 30 secondes pendant les matchs, statistiques et effectifs toutes les 30 minutes. Rien n’est écrit à la main dans la page.</p>
  <h2>Probabilité d’un pari</h2><p>Pour chaque joueur, on part de sa moyenne de la saison (points, buts, passes ou tirs par match), lissée avec une moyenne de la ligue quand il a peu joué. On l’ajuste avec la note du gardien adverse, la défense adverse (buts encaissés par match), le fait de jouer à domicile et un éventuel 2e match en 2 soirs. On en tire la probabilité avec une loi de Poisson.</p>
  <h2>Note du gardien</h2><p>Sur 100 : 70 % pourcentage d’arrêts (87,5 % = 0, 93 % = 100), 30 % moyenne de buts encaissés (3,8 = 0, 2,0 = 100), ramenée vers 50 tant qu’il a peu de titularisations.</p>
  <h2>Compositions</h2><p>Avant le match, la NHL ne publie pas les trios. Ils sont estimés à partir du temps de glace moyen : les 12 attaquants et 6 défenseurs qui jouent le plus. Le gardien probable est celui qui a le plus de titularisations, sauf si l’équipe a joué la veille.</p>
  <h2>Cotes</h2><p>Les cotes américaines (médiane des bookmakers US) sont converties en cotes décimales puis on retire 15 % sur le gain pour estimer la cote française : 2,00 aux US devient 1,85. La « valeur » compare cette cote à la probabilité du modèle.</p>
  <h2>Limites</h2><p>Les blessures de dernière minute et les changements de trios ne sont pas connus à l’avance. C’est une aide pour choisir, pas une garantie.</p></section>`;
}

function lineupBlock(t) {
  const row = (ps) => ps.map((p) => `<button class="lu" data-player="${p.id}">${face(p, 'mini')}<span>${esc(p.short)}</span><em>${mmss(p.toi)}</em></button>`).join('');
  const sel = (u) => (state.unit === u ? ' sel' : '');
  return `<div class="lineup" style="--tc:${t.color}"><h3>${logo(t, 28)} ${esc(t.short)}</h3>
    ${t.lines.lines.map((l, i) => `<div class="lu-row${sel('L' + (i + 1))}"><button class="unit-tag" data-unit="L${i + 1}" aria-label="Voir le trio ${i + 1} sur la glace">L${i + 1}</button>${row(l)}</div>`).join('')}
    ${t.lines.pairs.map((l, i) => `<div class="lu-row${sel('L' + (i + 1))}"><button class="unit-tag" data-unit="L${i + 1}" aria-label="Voir la paire ${i + 1} sur la glace">D${i + 1}</button>${row(l)}</div>`).join('')}
    ${(t.pp || []).map((l, i) => `<div class="lu-row${sel('PP' + (i + 1))}"><button class="unit-tag pp" data-unit="PP${i + 1}" aria-label="Voir l’avantage numérique ${i + 1}">PP${i + 1}</button>${row(l)}</div>`).join('')}
    <div class="lu-row"><span class="unit-tag g">G</span>${t.starter ? `<button class="lu" data-player="${t.starter.id}">${face(t.starter, 'mini')}<span>${esc(t.starter.short)}</span><em>${t.starter.rating}/100</em></button>` : '—'}</div>
    ${t.injured?.length ? `<p class="fine inj">Blessés / absents : ${t.injured.map(esc).join(', ')}</p>` : ''}</div>`;
}

// Which players stand on the ice for a unit (L1–L4 = trio + pair of the same rank, PP1/PP2 = power play).
function unitSlots(t, unit) {
  const dfo = t.linesSource === 'dailyfaceoff';
  if (unit.startsWith('PP')) {
    const u = (t.pp || [])[+unit.slice(2) - 1];
    if (u?.length) {
      const d = u.filter((p) => p.pos === 'D'), f = u.filter((p) => p.pos !== 'D');
      const C = f.find((p) => p.posCode === 'C') || f[0];
      const rest = f.filter((p) => p !== C);
      return { C, LW: rest[0], RW: rest[1], D1: d[0] || rest[2], D2: d[1] || rest[3] || rest[2], G: t.starter };
    }
    unit = 'L1';
  }
  const i = Math.max(0, +unit.slice(1) - 1);
  const f = t.lines.lines[Math.min(i, t.lines.lines.length - 1)] || [];
  const d = t.lines.pairs[Math.min(i, t.lines.pairs.length - 1)] || [];
  let C, LW, RW;
  if (dfo && f.length === 3) [LW, C, RW] = f;
  else { C = f.find((p) => p.posCode === 'C') || f[1]; const w = f.filter((p) => p !== C); LW = w.find((p) => p.posCode === 'L') || w[0]; RW = w.find((p) => p !== LW); }
  return { C, LW, RW, D1: d[0], D2: d[1], G: t.starter };
}
const UNIT_NAMES = { L1: '1re ligne', L2: '2e ligne', L3: '3e ligne', L4: '4e ligne', PP1: 'Avantage numérique 1', PP2: 'Avantage numérique 2' };
function unitPanel(g) {
  const col = (t) => {
    const s = unitSlots(t, state.unit);
    const order = [['LW', 'AG'], ['C', 'C'], ['RW', 'AD'], ['D1', 'D'], ['D2', 'D']];
    return `<div class="unit-col" style="--tc:${t.color}"><h3>${logo(t, 24)} ${esc(t.abbr)} <small>${t.linesSource === 'dailyfaceoff' ? 'Daily Faceoff' : 'estimation'}</small></h3>
      ${order.map(([k, lab]) => { const p = s[k]; if (!p) return ''; const pl = state.night.players.find((x) => x.id === p.id && x.gameId === g.id);
        return `<button class="u-row" data-player="${p.id}">${face(p, 'mini')}<span><b>${esc(p.name)}</b><small>${esc(p.posLabel || lab)} · ${p.points} pts en ${p.gp} m.</small><span class="formline" data-form="${p.id}" data-opp="${esc(t === g.away ? g.home.abbr : g.away.abbr)}"></span></span>
          <span class="u-stat"><b>${mmss(p.toi)}</b><small>glace / m.</small></span><span class="u-stat"><b>${pl ? pct(pl.probs.point) : '—'}</b><small>1+ point</small></span></button>`; }).join('')}
      ${s.G ? `<button class="u-row" data-player="${s.G.id}">${face(s.G, 'mini')}<span><b>${esc(s.G.name)}</b><small>Gardien · ${(s.G.savePct * 100 || 0).toFixed(1).replace('.', ',')} % d’arrêts</small></span><span class="u-stat"><b>${s.G.rating}</b><small>note /100</small></span></button>` : ''}</div>`;
  };
  return `<div class="unit-panel">${col(g.away)}${col(g.home)}</div>`;
}

function viewMatch(id) {
  const g = state.night.games.find((x) => x.id === id);
  if (!g) return `<section><p class="lead">Match introuvable pour cette date. <a href="#/">Retour aux matchs</a></p></section>`;
  const started = isLive(g.state) || isDone(g.state);
  const ps = state.night.players.filter((p) => p.gameId === id).sort((a, b) => b.probs.point - a.probs.point);
  const st = (t) => t.standing ? `${t.standing.record} · ${t.standing.points} pts · 10 derniers ${t.standing.l10}${t.standing.streak ? ' · série ' + t.standing.streak : ''}` : '';
  const odds = state.odds.get(id);
  return `<section class="match-head" style="--a:${g.away.color};--h:${g.home.color}">
      <a class="back" href="#/">← Tous les matchs</a>
      <div class="mh">
        <div class="mh-team">${logo(g.away, 84)}<h2>${esc(g.away.name)}</h2><small>${esc(st(g.away))}</small></div>
        <div class="mh-mid"><div id="mh-score">${scoreOrVs(g)}</div><div class="g-status" id="mh-status">${gameStatus(g)}</div><small>${esc(g.venue)}</small></div>
        <div class="mh-team">${logo(g.home, 84)}<h2>${esc(g.home.name)}</h2><small>${esc(st(g.home))}</small></div>
      </div>
    </section>
    <section id="ctx" class="ctx" style="--a:${g.away.color};--h:${g.home.color}"><div class="loading small"><span class="puck"></span>Chargement du contexte…</div></section>
    <section class="rink-wrap">
      <div class="rink-bar"><h2>Le stade en 3D</h2>
        <div class="units" role="group" aria-label="Choisir la ligne sur la glace">${['L1', 'L2', 'L3', 'L4', ...(g.away.pp?.length || g.home.pp?.length ? ['PP1', 'PP2'] : [])].map((u) => `<button data-unit="${u}" aria-pressed="${state.unit === u}" title="${UNIT_NAMES[u]}">${u}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="Affichage de la patinoire">
          <button data-rink="lineup" aria-pressed="${state.rinkMode === 'lineup'}">Composition</button>
          <button data-rink="shots" aria-pressed="${state.rinkMode === 'shots'}" ${started ? '' : 'disabled title="Disponible dès le début du match"'}>Tirs &amp; buts</button>
        </div></div>
      <div id="rink" class="rink"><p class="rink-hint">Fais glisser pour tourner, pince ou molette pour zoomer, touche un joueur pour sa fiche.</p></div>
      <p class="fine" id="rink-legend">${esc(UNIT_NAMES[state.unit])} sur la glace · lignes ${g.away.linesSource === 'dailyfaceoff' || g.home.linesSource === 'dailyfaceoff' ? 'pressenties par Daily Faceoff' : state.dfoLoaded.has(g.id) ? 'estimées au temps de glace (Daily Faceoff indisponible)' : 'en cours de chargement…'}</p>
      <div id="unit-panel">${unitPanel(g)}</div>
    </section>
    <section><h2>Duel de gardiens</h2><div class="goalie-grid two">${goalieCard(g.away.starter, g.away, g.home)}${goalieCard(g.home.starter, g.home, g.away)}</div></section>
    <section><h2>Compositions ${g.away.linesSource === 'dailyfaceoff' ? '<span class="src">Daily Faceoff</span>' : '<span class="src">estimées</span>'}</h2><div class="lineups">${lineupBlock(g.away)}${lineupBlock(g.home)}</div></section>
    <section><div class="sec-head"><h2>Paris joueurs</h2><span class="fine">${odds?.enabled ? (Object.keys(odds.players || {}).length ? 'Cotes US converties (−15 % sur le gain)' : odds.error || 'Pas encore de cotes pour ce match') : odds ? 'Cotes : ajoute ta clé The Odds API pour les voir' : 'Chargement des cotes…'}</span></div>
      <div class="table-wrap"><table class="ptable"><thead><tr><th>Joueur</th>${MARKETS.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr></thead><tbody>
      ${ps.map((p) => `<tr><td><button class="link" data-player="${p.id}">${face(p, 'mini')}${esc(p.name)}</button><small>${esc(p.team)} · ${esc(p.posLabel)}</small></td>
        ${MARKETS.map((m) => { const o = frenchOdds(odds?.players?.[normName(p.name)]?.[m.id]); const e = o ? edge(p.probs[m.id], o) : null;
          return `<td class="num"><button class="cell ${inSlip(p.id, m.id) ? 'on' : ''}" data-add="${p.id}" data-m="${m.id}">${pct(p.probs[m.id])}${o ? `<small class="${e > 0 ? 'pos' : ''}">${odds2(o)}</small>` : ''}</button></td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></section>`;
}

// ---------------- Articles ----------------
const ago = (iso) => {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600e3);
  return h < 1 ? 'à l’instant' : h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};
function articleCard(a, big = false) {
  return `<a class="article ${big ? 'big' : ''}" href="${esc(a.url)}" target="_blank" rel="noopener">
    ${a.img ? `<img src="${esc(a.img)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
    <div class="a-body"><small>${a.teams.slice(0, 3).map(esc).join(' · ') || 'NHL'} · ${esc(ago(a.date))}${a.preview ? ' · <b>Avant-match</b>' : ''}</small>
    <h3>${esc(a.title)}</h3>${a.summary ? `<p>${esc(a.summary)}</p>` : ''}</div></a>`;
}
function viewArticles() {
  const teams = [...new Set(state.night.games.flatMap((g) => [g.away.abbr, g.home.abbr]))];
  return `<section><h1 class="h1s">Articles</h1>
    <p class="lead">Les dernières actus NHL.com en français. Les équipes qui jouent ce soir sont en premier.</p>
    <div class="chips" id="news-chips"><button data-news="" aria-selected="${!state.newsTeam}">Tout</button><button data-news="soir" aria-selected="${state.newsTeam === 'soir'}">Matchs du soir</button>${teams.map((t) => `<button data-news="${t}" aria-selected="${state.newsTeam === t}">${t}</button>`).join('')}</div>
    <div id="news" class="articles"><div class="loading"><span class="puck"></span>Chargement des articles…</div></div></section>`;
}
async function fillArticles() {
  const el = $('#news'); if (!el) return;
  const all = await loadNews();
  const tonight = new Set(state.night.games.flatMap((g) => [g.away.abbr, g.home.abbr]));
  let list = all;
  if (state.newsTeam === 'soir') list = all.filter((a) => a.teams.some((t) => tonight.has(t)));
  else if (state.newsTeam) list = all.filter((a) => a.teams.includes(state.newsTeam));
  else list = [...all].sort((a, b) => (b.teams.some((t) => tonight.has(t)) - a.teams.some((t) => tonight.has(t))) || Date.parse(b.date) - Date.parse(a.date));
  if (!$('#news')) return;
  $('#news').innerHTML = list.length ? list.slice(0, 30).map((a, i) => articleCard(a, i === 0)).join('') : '<p class="empty">Aucun article récent pour ce filtre.</p>';
}

// ---------------- Match context ----------------
const RES = { W: 'V', L: 'D', OTW: 'VP', OTL: 'DP', SOW: 'VT', SOL: 'DT' };
function compareRow(label, a, h, fmt, rankA, rankH, higherBetter = true) {
  const tot = (a || 0) + (h || 0) || 1;
  const better = higherBetter ? a > h : a < h;
  return `<div class="cmp"><span class="${better ? 'win' : ''}">${fmt(a)}${rankA ? `<small>${rankA}e</small>` : ''}</span>
    <div class="cmp-bar"><i style="width:${(a / tot) * 100}%"></i><i style="width:${(h / tot) * 100}%"></i></div>
    <span class="${!better && a !== h ? 'win' : ''}">${fmt(h)}${rankH ? `<small>${rankH}e</small>` : ''}</span><em>${esc(label)}</em></div>`;
}
function insights(g, rr) {
  const out = [];
  const A = g.away, H = g.home, ts = rr?.teamSeasonStats;
  if (A.b2b) out.push(`${A.short} joue son 2e match en 2 soirs : fatigue possible et gardien remplaçant probable.`);
  if (H.b2b) out.push(`${H.short} joue son 2e match en 2 soirs : fatigue possible et gardien remplaçant probable.`);
  if (A.starter && H.starter && Math.abs(A.starter.rating - H.starter.rating) >= 20) {
    const [w, s] = A.starter.rating < H.starter.rating ? [A, H] : [H, A];
    out.push(`Gros écart dans les cages : ${w.starter.name} (${w.starter.rating}/100) contre ${s.starter.name} (${s.starter.rating}/100). Avantage aux attaquants de ${s.short}.`);
  }
  if (ts) {
    for (const [t, o, k] of [[A, H, 'awayTeam'], [H, A, 'homeTeam']]) {
      const me = ts[k], opp = ts[k === 'awayTeam' ? 'homeTeam' : 'awayTeam'];
      if (me.ppPctgRank <= 10 && opp.pkPctgRank >= 22) out.push(`Supériorité numérique de ${t.short} (${me.ppPctgRank}e de la ligue) contre une infériorité faible de ${o.short} (${opp.pkPctgRank}e) : bon signe pour les points en avantage numérique.`);
      if (me.goalsForPerGamePlayedRank <= 5) out.push(`${t.short} a l’une des meilleures attaques : ${me.goalsForPerGamePlayed.toFixed(2).replace('.', ',')} buts par match (${me.goalsForPerGamePlayedRank}e).`);
      if (me.goalsAgainstPerGamePlayedRank >= 28) out.push(`${t.short} encaisse beaucoup : ${me.goalsAgainstPerGamePlayed.toFixed(2).replace('.', ',')} buts par match (${me.goalsAgainstPerGamePlayedRank}e sur 32).`);
    }
  }
  const l10 = rr?.last10Record;
  for (const [t, k] of [[A, 'awayTeam'], [H, 'homeTeam']]) {
    const st = l10?.[k];
    if (st?.streak >= 3) out.push(`${t.short} reste sur ${st.streak} ${st.streakType === 'W' ? 'victoires' : 'défaites'} de suite.`);
  }
  const sw = rr?.seasonSeriesWins;
  if (sw && (sw.awayTeamWins || sw.homeTeamWins)) out.push(`Cette saison entre eux : ${A.abbr} ${sw.awayTeamWins} victoire${sw.awayTeamWins > 1 ? 's' : ''}, ${H.abbr} ${sw.homeTeamWins}.`);
  return out;
}
async function fillContext(g) {
  const el = $('#ctx'); if (!el) return;
  const [rr, news] = await Promise.all([loadRightRail(g.id), loadNews()]);
  if (!$('#ctx') || route().id !== g.id) return;
  const ts = rr?.teamSeasonStats, l10 = rr?.last10Record, info = rr?.gameInfo;
  const pctf = (x) => (x * 100).toFixed(1).replace('.', ',') + ' %', num = (x) => x.toFixed(2).replace('.', ',');
  const form = (k) => (l10?.[k]?.pastGameResults || []).slice(0, 10).map((r) => `<i class="r ${r.gameResult.endsWith('W') ? 'w' : r.gameResult === 'L' ? 'l' : 'o'}" title="${esc(r.gameResult)} contre ${esc(r.opponentAbbrev)}">${RES[r.gameResult] || esc(r.gameResult)}</i>`).join('');
  const tips = insights(g, rr);
  const officials = [...(info?.referees || []), ...(info?.linesmen || [])].map((x) => x.default || x).filter(Boolean);
  const scr = (k) => (info?.[k]?.scratches || []).map((x) => `${x.firstName?.default?.charAt(0) || ''}. ${x.lastName?.default || ''}`).join(', ');
  const arts = news.filter((a) => a.teams.includes(g.away.abbr) || a.teams.includes(g.home.abbr))
    .sort((a, b) => (b.teams.includes(g.away.abbr) && b.teams.includes(g.home.abbr)) - (a.teams.includes(g.away.abbr) && a.teams.includes(g.home.abbr)) || b.preview - a.preview || Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
  el.innerHTML = `<h2>Autour du match</h2>
    <div class="ctx-grid">
      <div class="ctx-card"><h3>La salle</h3><p class="venue">${esc(g.venue)}</p><p class="fine">${esc(g.home.name)} reçoit · coup d’envoi ${parisTime(g.start)} (Paris)</p>
        ${info ? `<dl class="mini"><div><dt>Coach ${esc(g.away.abbr)}</dt><dd>${esc(info.awayTeam?.headCoach?.default || '—')}</dd></div><div><dt>Coach ${esc(g.home.abbr)}</dt><dd>${esc(info.homeTeam?.headCoach?.default || '—')}</dd></div></dl>` : ''}
        ${officials.length ? `<p class="fine">Arbitres : ${officials.map(esc).join(', ')}</p>` : ''}
        ${scr('awayTeam') || scr('homeTeam') ? `<p class="fine">Absents : ${esc([scr('awayTeam'), scr('homeTeam')].filter(Boolean).join(' · '))}</p>` : ''}</div>
      ${l10 ? `<div class="ctx-card"><h3>Forme (10 derniers)</h3>
        <div class="form-row"><b>${esc(g.away.abbr)}</b><span>${esc(l10.awayTeam?.record || '')}</span><div class="pills">${form('awayTeam')}</div></div>
        <div class="form-row"><b>${esc(g.home.abbr)}</b><span>${esc(l10.homeTeam?.record || '')}</span><div class="pills">${form('homeTeam')}</div></div>
        <p class="fine">V = victoire, D = défaite, P = prolongation, T = tirs au but. Le plus récent à gauche.</p></div>` : ''}
      ${ts ? `<div class="ctx-card wide"><h3>Face à face statistique</h3><div class="cmp-head"><span>${logo(g.away, 26)} ${esc(g.away.abbr)}</span><span>${esc(g.home.abbr)} ${logo(g.home, 26)}</span></div>
        ${compareRow('Buts marqués / match', ts.awayTeam.goalsForPerGamePlayed, ts.homeTeam.goalsForPerGamePlayed, num, ts.awayTeam.goalsForPerGamePlayedRank, ts.homeTeam.goalsForPerGamePlayedRank)}
        ${compareRow('Buts encaissés / match', ts.awayTeam.goalsAgainstPerGamePlayed, ts.homeTeam.goalsAgainstPerGamePlayed, num, ts.awayTeam.goalsAgainstPerGamePlayedRank, ts.homeTeam.goalsAgainstPerGamePlayedRank, false)}
        ${compareRow('Supériorité numérique', ts.awayTeam.ppPctg, ts.homeTeam.ppPctg, pctf, ts.awayTeam.ppPctgRank, ts.homeTeam.ppPctgRank)}
        ${compareRow('Infériorité numérique', ts.awayTeam.pkPctg, ts.homeTeam.pkPctg, pctf, ts.awayTeam.pkPctgRank, ts.homeTeam.pkPctgRank)}
        ${compareRow('Mises en jeu gagnées', ts.awayTeam.faceoffWinningPctg, ts.homeTeam.faceoffWinningPctg, pctf, ts.awayTeam.faceoffWinningPctgRank, ts.homeTeam.faceoffWinningPctgRank)}
      </div>` : ''}
    </div>
    ${tips.length ? `<div class="tips"><h3>À savoir avant de parier</h3><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${arts.length ? `<h3 class="sub-h">Articles sur ce match</h3><div class="articles small">${arts.map((a) => articleCard(a)).join('')}</div>` : ''}`;
}

// ---------------- Rink wiring ----------------
const proxied = (u) => u ? u.replace('https://assets.nhle.com/', '/api/img/') : null;
const statusText = (g) => isLive(g.state) ? (g.intermission ? 'ENTRACTE' : `P${g.period ?? ''} · ${g.clock ?? ''}`) : isDone(g.state) ? 'FINAL' : `${parisTime(g.start)} HEURE DE PARIS`;
let logoCache = new Map();
async function updateScoreboard(g) {
  if (!state.rink || state.rinkGame !== g.id) return;
  const img = async (u) => { if (!logoCache.has(u)) logoCache.set(u, state.rink.loadImage(u)); return logoCache.get(u); };
  const started = isLive(g.state) || isDone(g.state);
  state.rink.setScoreboard({
    away: g.away.abbr, home: g.home.abbr, awayScore: started ? g.away.score ?? 0 : null, homeScore: started ? g.home.score ?? 0 : null,
    status: statusText(g), awayColor: g.away.color, homeColor: g.home.color,
    awayLogo: await img(proxied(g.away.logo)), homeLogo: await img(proxied(g.home.logo)),
  });
}
function featuredGame() {
  const gs = state.night?.games || [];
  return gs.find((g) => isLive(g.state)) || [...gs].filter((g) => !isDone(g.state)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || gs[0];
}
async function mountRink(g, { small = false, shiftX = 0 } = {}) {
  const el = $('#rink'); if (!el) return;
  let mod;
  try { mod = await import('./rink3d.js'); } catch { el.insertAdjacentHTML('beforeend', '<p class="rink-hint">La 3D n’a pas pu se charger sur cet appareil.</p>'); return; }
  if (!el.isConnected) return;
  if (state.rink) state.rink.dispose();
  try {
    state.rink = mod.createRink(el, { onPick: (p) => openPlayer(p.id), small, shiftX, autoRotateSpeed: small ? 0.6 : 0.35 });
  } catch { el.insertAdjacentHTML('beforeend', '<p class="rink-hint">Ton navigateur ne gère pas la 3D (WebGL).</p>'); return; }
  state.rinkGame = g.id;
  state.rink.setColors(g.home.color, g.away.color);
  updateScoreboard(g);
  state.rink.setCenterLogo(proxied(g.home.logoLight));
  const six = (t) => {
    const sl = unitSlots(t, state.unit), out = {};
    for (const [k, p] of Object.entries(sl)) if (p) out[k] = { ...p, headshot: proxied(p.headshot), label: `${p.short} · ${k === 'G' ? p.rating + '/100' : mmss(p.toi)}` };
    return out;
  };
  await state.rink.setLineups([{ side: -1, color: g.away.color, players: six(g.away) }, { side: 1, color: g.home.color, players: six(g.home) }]);
  if (!small && state.rinkMode === 'shots') await showShots(g);
}
async function relineup(g) {
  if (!state.rink || state.rinkGame !== g.id) return;
  const six = (t) => {
    const sl = unitSlots(t, state.unit), out = {};
    for (const [k, p] of Object.entries(sl)) if (p) out[k] = { ...p, headshot: proxied(p.headshot), label: `${p.short} · ${k === 'G' ? p.rating + '/100' : mmss(p.toi)}` };
    return out;
  };
  state.rink.setShots([]);
  await state.rink.setLineups([{ side: -1, color: g.away.color, players: six(g.away) }, { side: 1, color: g.home.color, players: six(g.home) }]);
}
async function ensureDfo(g) {
  if (state.dfoLoaded.has(g.id)) return;
  state.dfoLoaded.add(g.id);
  const changed = await applyDailyFaceoff(g, state.night.leagueGa);
  if (changed) state.night.players = state.night.players.filter((p) => p.gameId !== g.id).concat(gamePlayers(g, state.night.leagueGa));
  if (route().id === g.id) render();
}
async function showShots(g) {
  const pbp = await loadPlayByPlay(g.id);
  if (!pbp || !state.rink || state.rinkGame !== g.id) return;
  const homeId = pbp.homeTeam?.id;
  const shots = shotsFromPbp(pbp, homeId, { home: parseInt(g.home.color.slice(1), 16), away: parseInt(g.away.color.slice(1), 16) });
  state.rink.setShots(state.rinkMode === 'shots' ? shots : []);
  const goals = shots.filter((s) => s.goal).length;
  $('#rink-legend').textContent = state.rinkMode === 'shots'
    ? `${shots.length} tirs cadrés dont ${goals} but${goals > 1 ? 's' : ''} (en or). ${g.away.abbr} attaque vers la droite, ${g.home.abbr} vers la gauche.`
    : 'Sixième de départ estimé (trio 1, paire 1, gardien probable).';
}

// ---------------- Player sheet ----------------
async function openPlayer(id) {
  const p = state.night.players.find((x) => x.id === id);
  const goalie = !p && state.night.games.flatMap((g) => [g.away, g.home]).flatMap((t) => t.goalies.map((x) => ({ ...x, t }))).find((x) => x.id === id);
  const dlg = $('#player');
  if (goalie) {
    $('#player-title').textContent = goalie.name;
    $('#player-body').innerHTML = goalieCard(goalie, goalie.t, null);
    dlg.showModal(); return;
  }
  if (!p) return;
  const odds = state.odds.get(p.gameId)?.players?.[normName(p.name)] || {};
  $('#player-title').textContent = p.name;
  $('#player-body').innerHTML = `<div class="ps-head">${face(p, 'big')}<div><small>${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)} · ${esc(p.posLabel)}${p.number ? ' · #' + p.number : ''}</small>
      <p>${p.gp} matchs · ${p.goals} buts · ${p.assists} passes · ${p.points} pts · ${p.shots} tirs · ${mmss(p.toi)} de glace</p>
      ${p.oppGoalie ? `<p>Gardien adverse probable : <b>${esc(p.oppGoalie.name)}</b> ${ratingChip(p.oppGoalie)}</p>` : ''}</div></div>
    <table class="ptable compact"><thead><tr><th>Pari</th><th>Modèle</th><th>Cote juste</th><th>Cote FR est.</th><th></th></tr></thead><tbody>
    ${MARKETS.map((m) => { const fr = frenchOdds(odds[m.id]); return `<tr><td>${esc(m.label)}</td><td class="num">${pct(p.probs[m.id])}</td><td class="num">${odds2(fairOdds(p.probs[m.id]))}</td><td class="num">${fr ? odds2(fr) : '—'}</td>
      <td><button class="add ${inSlip(p.id, m.id) ? 'on' : ''}" data-add="${p.id}" data-m="${m.id}" aria-label="Ajouter ${esc(m.label)} au combiné">${addIcon(inSlip(p.id, m.id))}</button></td></tr>`; }).join('')}
    </tbody></table>
 <h3>Forme</h3><div id="pform" class="pform">Chargement…</div>
    <h3>Contre ${esc(p.opp)}</h3><div id="pvs" class="glog">Chargement…</div>
    <h3>5 derniers matchs</h3><div id="glog" class="glog">Chargement…</div>`;
  dlg.showModal();
  const f = await loadForm(id, p.opp, state.date);
  const games = f.last5;
  const cell = (x) => `<div class="glog-cell ${x.points ? 'hit' : ''}"><small>${esc((x.gameDate || '').replace(/^\d\d(\d\d)-(\d\d)-(\d\d)$/, '$3/$2/$1'))} ${x.homeRoadFlag === 'H' ? 'vs' : '@'} ${esc(x.opponentAbbrev)}</small><b>${x.goals}+${x.assists}</b><span>${x.shots} tirs · ${esc(x.toi)}</span></div>`;
  if (!$('#pform')) return;
  $('#pform').innerHTML = `<div class="pf-row">${formLine(f, p.opp)}</div><p class="fine">${f.last10Pts} points (${f.last10Goals} but${f.last10Goals > 1 ? "s" : ""}) sur ses ${f.last10N} derniers matchs, au moins 1 point dans ${f.last10Hits} d’entre eux.</p>`;
  $('#pvs').innerHTML = f.vs.n ? `<p class="fine">${f.vs.n} matchs depuis ${f.since} : ${f.vs.goals} buts, ${f.vs.assists} passes, ${f.vs.shots} tirs. Au moins 1 point dans ${f.vs.hits} sur ${f.vs.n}.</p><div class="glog-row">${f.vs.list.slice(0, 10).map(cell).join('')}</div>` : `<p class="fine">Aucun match contre ${esc(p.opp)} depuis ${f.since}.</p>`;
  $('#glog').innerHTML = games.length ? `<div class="glog-row">${games.map(cell).join('')}</div>` : 'Pas de match récent.';
}

// ---------------- Router & render ----------------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^match\/(\d+)/);
  return m ? { name: 'match', id: +m[1] } : { name: h || '' };
}

function render() {
  const r = route();
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === r.name ? 'page' : 'false'));
  const view = $('#view');
  if (state.error && !state.night) { view.innerHTML = `<div class="error"><h2>Données indisponibles</h2><p>${esc(state.error)}</p><button class="primary" id="retry">Réessayer</button></div>`; return; }
  if (!state.night) { view.innerHTML = '<div class="loading"><span class="puck"></span>Chargement des données NHL…</div>'; return; }
  if (state.rink) { state.rink.dispose(); state.rink = null; state.rinkGame = null; }
  const html = r.name === 'match' ? viewMatch(r.id) : r.name === 'paris' ? viewPicks() : r.name === 'gardiens' ? viewGoalies() : r.name === 'joueurs' ? viewPlayers() : r.name === 'methode' ? viewMethod() : r.name === 'articles' ? viewArticles() : viewHome();
  view.innerHTML = html;
  if (r.name === '' && state.night.games.length) mountRink(featuredGame(), { small: true, shiftX: 0.2 });
  if (r.name === 'articles') fillArticles();
  runTickers();
  fillForms();
  if (r.name === 'match') {
    const g = state.night.games.find((x) => x.id === r.id);
    if (g) {
      mountRink(g);
      fillContext(g);
      ensureDfo(g);
      if (!state.odds.has(g.id)) loadGameOdds(g).then((o) => { state.odds.set(g.id, o); if (route().id === g.id) refreshMatchTable(); });
    }
  }
}
// Magic UI-style number ticker: numbers count up once when they appear.
const ticked = new WeakSet();
function runTickers() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || ticked.has(e.target)) continue;
      ticked.add(e.target); io.unobserve(e.target);
      const el = e.target, to = +el.dataset.v, unit = el.dataset.unit ?? ' %', t0 = performance.now(), dur = 900;
      const step = (now) => { const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 4); el.textContent = Math.round(to * ease) + unit; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.4 });
  document.querySelectorAll('.tick').forEach((el) => io.observe(el));
}
// Re-render the match page without rebuilding the 3D scene.
function refreshMatchTable() {
  const r = route(); const g = state.night.games.find((x) => x.id === r.id); if (!g) return;
  const tmp = document.createElement('div'); tmp.innerHTML = viewMatch(r.id);
  const sections = $('#view').querySelectorAll('section'), fresh = tmp.querySelectorAll('section');
  sections[sections.length - 1].replaceWith(fresh[fresh.length - 1]);
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const p = state.night.players.find((x) => x.id === +add.dataset.add);
    const fr = frenchOdds(state.odds.get(p.gameId)?.players?.[normName(p.name)]?.[add.dataset.m]);
    addToSlip(p, add.dataset.m, fr);
    add.classList.toggle('on', inSlip(p.id, add.dataset.m));
    if (add.classList.contains('add')) add.innerHTML = addIcon(inSlip(p.id, add.dataset.m));
    return;
  }
  const pl = e.target.closest('[data-player]'); if (pl) { openPlayer(+pl.dataset.player); return; }
  const un = e.target.closest('[data-unit]');
  if (un) {
    state.unit = un.dataset.unit;
    const g = state.night.games.find((x) => x.id === route().id);
    if (g) {
      document.querySelectorAll('.units [data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
      $('#unit-panel').innerHTML = unitPanel(g);
      fillForms();
      $('#rink-legend').firstChild && ($('#rink-legend').textContent = $('#rink-legend').textContent.replace(/^[^·]+/, UNIT_NAMES[state.unit] + ' sur la glace '));
      document.querySelectorAll('.lu-row').forEach((r) => r.classList.toggle('sel', !!r.querySelector(`[data-unit="${state.unit}"]`)));
      if (state.rinkMode !== 'lineup') { state.rinkMode = 'lineup'; document.querySelectorAll('[data-rink]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rink === 'lineup'))); }
      relineup(g);
      if (!un.closest('.units')) $('#rink').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  const nw = e.target.closest('[data-news]'); if (nw) { state.newsTeam = nw.dataset.news; document.querySelectorAll('[data-news]').forEach((b) => b.setAttribute('aria-selected', String(b === nw))); fillArticles(); return; }
  const mk = e.target.closest('[data-market]'); if (mk) { state.market = mk.dataset.market; render(); return; }
  const so = e.target.closest('[data-sort]'); if (so) { state.sort = so.dataset.sort; render(); return; }
  const rk = e.target.closest('[data-rink]');
  if (rk && !rk.disabled) {
    state.rinkMode = rk.dataset.rink;
    document.querySelectorAll('[data-rink]').forEach((b) => b.setAttribute('aria-pressed', String(b === rk)));
    const g = state.night.games.find((x) => x.id === route().id);
    if (g) showShots(g);
    return;
  }
  if (e.target.id === 'retry') load();
  if (e.target.id === 'load-all-odds') {
    e.target.textContent = 'Chargement…';
    Promise.all(state.night.games.map((g) => state.odds.has(g.id) ? null : loadGameOdds(g).then((o) => state.odds.set(g.id, o)))).then(render);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
  if (e.target.id === 'team') { state.team = e.target.value; render(); }
});
addEventListener('hashchange', () => { render(); scrollTo({ top: 0 }); });

// ---------------- Loading & automatic updates ----------------
function setDateUi() {
  $('#day').value = state.date;
  const today = nyDate();
  $('#day-text').textContent = state.date === today ? 'Ce soir' : state.date === shiftDate(today, -1) ? 'Hier soir' : state.date === shiftDate(today, 1) ? 'Demain' : longDate(state.date);
}
async function load() {
  setDateUi();
  state.error = null;
  if (!state.night || state.night.date !== state.date) { state.night = null; state.odds.clear(); render(); }
  try {
    const keepRink = (route().name === 'match' || route().name === '') && state.night && state.rink;
    const n = await loadNight(state.date);
    state.night = n;
    state.dfoLoaded.clear();
    if (keepRink) { updateLive(); const r = route(); if (r.name === 'match') { const g = n.games.find((x) => x.id === r.id); if (g) ensureDfo(g); } } else render();
  } catch (err) { state.error = err.message; render(); }
  tickFresh();
}
function changeDate(d) {
  state.date = d;
  const u = new URL(location.href); if (d === nyDate()) u.searchParams.delete('date'); else u.searchParams.set('date', d);
  history.replaceState(null, '', u);
  if (route().name === 'match') location.hash = '#/';
  load();
}
$('#prev').onclick = () => changeDate(shiftDate(state.date, -1));
$('#next').onclick = () => changeDate(shiftDate(state.date, 1));
$('#day').onchange = (e) => e.target.value && changeDate(e.target.value);

function tickFresh() {
  const n = state.night; if (!n) return;
  const min = Math.floor((Date.now() - n.fetchedAt) / 60000);
  const live = n.games.some((g) => isLive(g.state));
  $('#fresh').innerHTML = `${live ? '<span class="live-dot"></span>Direct · ' : ''}à jour ${min < 1 ? 'à l’instant' : `il y a ${min} min`}`;
}

// Scores: every 30 s while a game is live (one cheap request).
async function updateLive() {
  const n = state.night; if (!n) return;
  const live = await loadScores(n.date);
  for (const g of n.games) {
    const l = live.get(g.id); if (!l) continue;
    g.state = l.gameState; g.period = l.periodDescriptor?.number ?? g.period; g.periodType = l.periodDescriptor?.periodType ?? g.periodType;
    g.clock = l.clock?.timeRemaining ?? g.clock; g.intermission = !!l.clock?.inIntermission;
    g.away.score = l.awayTeam?.score ?? g.away.score; g.home.score = l.homeTeam?.score ?? g.home.score;
  }
  const r = route();
  if (r.name === 'match') {
    const g = n.games.find((x) => x.id === r.id);
    if (g) {
      $('#mh-score') && ($('#mh-score').innerHTML = scoreOrVs(g));
      $('#mh-status') && ($('#mh-status').innerHTML = gameStatus(g));
      const sb = document.querySelector('[data-rink="shots"]'); if (sb && (isLive(g.state) || isDone(g.state))) sb.disabled = false;
      if (state.rinkMode === 'shots') showShots(g);
    }
  } else if (r.name === '' && $('#home-games')) $('#home-games').innerHTML = homeGames();
  const fg = n.games.find((x) => x.id === state.rinkGame); if (fg) updateScoreboard(fg);
  tickFresh();
}
setInterval(() => { if (document.hidden || !state.night) return; if (state.night.games.some((g) => isLive(g.state) || (Date.parse(g.start) < Date.now() && !isDone(g.state)))) updateLive(); }, 30000);
// Full refresh (stats, goalies, lineups) every 10 minutes, and when coming back to the tab.
setInterval(() => { if (!document.hidden) load(); }, 600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.night && Date.now() - state.night.fetchedAt > 300000) load(); });
setInterval(tickFresh, 30000);

saveSlip();
load();
