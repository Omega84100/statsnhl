import test from 'node:test';
import assert from 'node:assert/strict';
import { atLeast, goalieRating, frenchOdds, americanToDecimal, skaterProbabilities, likelyStarter, estimateLines } from '../public/js/model.js';
import { cacheSeconds, summarizeProps, normName } from '../src/nhl-proxy.js';

test('poisson', () => { assert.ok(Math.abs(atLeast(1, 1) - (1 - Math.exp(-1))) < 1e-9); assert.equal(atLeast(0, 1), 0); });
test('goalie rating bounds and shrinkage', () => {
  assert.equal(goalieRating({ savePct: 0.95, gaa: 1.5, starts: 1000 }), 100);
  assert.equal(goalieRating({ savePct: 0.86, gaa: 4.5, starts: 0 }), 50);
  assert.ok(goalieRating({ savePct: 0.86, gaa: 4.5, starts: 20 }) < 15);
});
test('french odds keep 85 % of the profit', () => {
  assert.equal(frenchOdds(2), 1.85); assert.equal(frenchOdds(1.5), 1.43); assert.equal(frenchOdds(1), null);
  assert.equal(americanToDecimal(150), 2.5); assert.equal(americanToDecimal(-200), 1.5);
});
test('better opposing goalie lowers probability', () => {
  const s = { gp: 20, points: 20, goals: 8, assists: 12, shots: 60, pos: 'F' };
  assert.ok(skaterProbabilities(s, { oppGoalie: 90 }).point < skaterProbabilities(s, { oppGoalie: 20 }).point);
});
test('backup starts on back-to-back', () => {
  const gs = [{ id: 1, gp: 10, starts: 10 }, { id: 2, gp: 4, starts: 4 }];
  assert.equal(likelyStarter(gs, false).id, 1); assert.equal(likelyStarter(gs, true).id, 2);
});
test('lines from ice time', () => {
  const sk = Array.from({ length: 20 }, (_, i) => ({ id: i, gp: 5, pos: i < 13 ? 'F' : 'D', toi: 1000 - i }));
  const { lines, pairs } = estimateLines(sk);
  assert.equal(lines.length, 4); assert.equal(pairs.length, 3); assert.deepEqual(lines[0].map((p) => p.id), [0, 1, 2]);
});
test('proxy only allows known paths', () => {
  assert.equal(cacheSeconds('score/now'), 20); assert.equal(cacheSeconds('club-stats/TOR/now'), 1800);
  assert.equal(cacheSeconds('../secret'), null); assert.equal(cacheSeconds('player/8478402/game-log/now'), 1800);
});
test('props summary uses median price', () => {
  const r = summarizeProps({ bookmakers: [
    { markets: [{ key: 'player_points', outcomes: [{ name: 'Over', description: 'Léon Draisaitl', price: 1.5, point: 0.5 }] }] },
    { markets: [{ key: 'player_points', outcomes: [{ name: 'Over', description: 'Léon Draisaitl', price: 1.7, point: 0.5 }] }] }] });
  assert.equal(r[normName('Leon Draisaitl')].point, 1.6);
});

import { parseLines } from '../src/dailyfaceoff.js';
test('daily faceoff: __NEXT_DATA__ groups', () => {
  const players = [];
  const ids = ['f1', 'f2', 'f3', 'f4'];
  ids.forEach((g, i) => ['lw', 'c', 'rw'].forEach((p) => players.push({ name: `${p}${i}`, groupIdentifier: g, positionIdentifier: p + (i + 1) })));
  ['d1', 'd2', 'd3'].forEach((g, i) => ['ld', 'rd'].forEach((p) => players.push({ name: `${p}${i}`, groupIdentifier: g, positionIdentifier: p + (i + 1) })));
  players.push({ name: 'Goalie A', groupIdentifier: 'g', positionIdentifier: 'g1' });
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { combinations: { players } } } })}</script></html>`;
  const r = parseLines(html);
  assert.deepEqual(r.groups.f1.map((p) => p.name), ['lw0', 'c0', 'rw0']);
  assert.equal(r.groups.d3.length, 2); assert.equal(r.groups.g[0].name, 'Goalie A');
});
test('daily faceoff: fallback on player links in page order', () => {
  let html = '<p>Last updated: 2026-11-10T15:45:58.375Z</p>';
  for (let i = 0; i < 40; i++) html += `<a href="/players/news/p-${i}/${1000 + i}"><img src="x.png"></a><a href="/players/news/p-${i}/${1000 + i}">Player ${i}</a>`;
  const r = parseLines(html);
  assert.deepEqual(r.groups.f1.map((p) => p.name), ['Player 0', 'Player 1', 'Player 2']);
  assert.deepEqual(r.groups.d1.map((p) => p.name), ['Player 12', 'Player 13']);
  assert.equal(r.groups.pp1.length, 5); assert.equal(r.groups.g[0].name, 'Player 36');
  assert.equal(r.updated, '2026-11-10T15:45:58.375Z');
});
