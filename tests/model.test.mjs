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
