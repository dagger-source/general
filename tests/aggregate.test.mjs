// SPEC.md "Aggregation" + Module API `aggregate.js`.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weightedTotal,
  rankSites,
  topsis,
  paretoFrontier,
  monteCarlo,
  flipMargin,
} from '../site/engine/aggregate.js';
import { crit, scoredSite, EVEN_WEIGHTS } from './_fixtures.mjs';

const EPS = 1e-9;
const W = { regulatory: 0.5, cost: 0.3, community: 0.2 };

// --- weightedTotal ---------------------------------------------------------

test('weightedTotal is the weighted sum of the pessimistic criterion scores', () => {
  const scores = { regulatory: crit(80, 90), cost: crit(60, 100), community: crit(40, 40) };
  // 0.5*80 + 0.3*60 + 0.2*40 = 40 + 18 + 8 = 66
  assert.ok(Math.abs(weightedTotal(scores, W, 'pessimistic') - 66) < EPS);
});

test('weightedTotal in optimistic mode uses the optimistic scores', () => {
  const scores = { regulatory: crit(80, 90), cost: crit(60, 100), community: crit(40, 40) };
  // 0.5*90 + 0.3*100 + 0.2*40 = 45 + 30 + 8 = 83
  assert.ok(Math.abs(weightedTotal(scores, W, 'optimistic') - 83) < EPS);
});

test('weightedTotal stays within 0-100 for in-range criterion scores', () => {
  const lo = { regulatory: crit(0), cost: crit(0), community: crit(0) };
  const hi = { regulatory: crit(100), cost: crit(100), community: crit(100) };
  assert.ok(Math.abs(weightedTotal(lo, W, 'pessimistic') - 0) < EPS);
  assert.ok(Math.abs(weightedTotal(hi, W, 'pessimistic') - 100) < EPS);
});

test('weightedTotal ignores completeness', () => {
  const complete = { regulatory: crit(80, 80, 1), cost: crit(60, 60, 1), community: crit(40, 40, 1) };
  const sparse = { regulatory: crit(80, 100, 0.3), cost: crit(60, 100, 0.2), community: crit(40, 100, 0.1) };
  assert.equal(
    weightedTotal(complete, W, 'pessimistic'),
    weightedTotal(sparse, W, 'pessimistic'),
  );
});

// --- rankSites -------------------------------------------------------------

test('rankSites sorts by descending pessimistic total and assigns ranks from 1', () => {
  const scored = [
    scoredSite('b', 50, 50, 50),
    scoredSite('a', 90, 90, 90),
    scoredSite('c', 70, 70, 70),
  ];
  const ranked = rankSites(scored, W);
  assert.deepEqual(ranked.map((r) => r.site_id), ['a', 'c', 'b']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('rankSites reports the pessimistic total and carries the optimistic total alongside', () => {
  const scored = [scoredSite('a', crit(80, 90), crit(60, 100), crit(40, 40))];
  const [row] = rankSites(scored, W);
  assert.ok(Math.abs(row.total - 66) < EPS, `total ${row.total}`);
  assert.ok(Math.abs(row.totalOptimistic - 83) < EPS, `totalOptimistic ${row.totalOptimistic}`);
});

test('rankSites breaks ties by ascending site_id', () => {
  const scored = [
    scoredSite('zulu', 70, 70, 70),
    scoredSite('alpha', 70, 70, 70),
    scoredSite('mike', 70, 70, 70),
  ];
  const ranked = rankSites(scored, W);
  assert.deepEqual(ranked.map((r) => r.site_id), ['alpha', 'mike', 'zulu']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('rankSites tie-break does not depend on input order', () => {
  const a = scoredSite('alpha', 70, 70, 70);
  const z = scoredSite('zulu', 70, 70, 70);
  assert.equal(rankSites([a, z], W)[0].site_id, 'alpha');
  assert.equal(rankSites([z, a], W)[0].site_id, 'alpha');
});

test('rankSites preserves the site id on every row', () => {
  const scored = [scoredSite('a', 10, 20, 30), scoredSite('b', 30, 20, 10)];
  for (const row of rankSites(scored, W)) {
    assert.ok(typeof row.site_id === 'string' && row.site_id.length > 0);
  }
});

test('only shortlist sites get a rank', () => {
  const scored = [
    scoredSite('shortlisted', 50, 50, 50, { classification: 'shortlist' }),
    scoredSite('heldsite', 99, 99, 99, { classification: 'held' }),
    scoredSite('excludedsite', 99, 99, 99, { classification: 'excluded' }),
  ];
  const ranked = rankSites(scored, W);
  const rankOf = (id) => ranked.find((r) => r.site_id === id);
  assert.equal(rankOf('shortlisted').rank, 1);
  // Non-shortlist sites are never assigned a rank, whether or not they are
  // returned in the array at all.
  for (const id of ['heldsite', 'excludedsite']) {
    const row = rankOf(id);
    if (row !== undefined) {
      assert.ok(row.rank == null, `${id} must not carry a rank, got ${row.rank}`);
    }
  }
});

test('ranks are a contiguous 1..n sequence over the ranked sites', () => {
  const scored = ['a', 'b', 'c', 'd'].map((id, i) => scoredSite(id, 10 * (i + 1), 50, 50));
  const ranks = rankSites(scored, W).map((r) => r.rank).filter((r) => r != null);
  assert.deepEqual([...ranks].sort((x, y) => x - y), [1, 2, 3, 4]);
});

// --- integrity requirement 2 at the ranking level --------------------------

test('a site with a missing factor never outranks an otherwise identical complete site', () => {
  // Identical present data; `sparse` is missing its cost input entirely.
  const complete = scoredSite('aaa_complete', crit(80, 80, 1), crit(70, 70, 1), crit(60, 60, 1));
  const sparse = scoredSite('bbb_sparse', crit(80, 80, 1), crit(0, 100, 0), crit(60, 60, 1));
  const ranked = rankSites([sparse, complete], W);
  const c = ranked.find((r) => r.site_id === 'aaa_complete');
  const s = ranked.find((r) => r.site_id === 'bbb_sparse');
  assert.ok(c.total >= s.total, `complete ${c.total} must not trail sparse ${s.total}`);
  assert.ok(c.rank < s.rank, `complete ranked ${c.rank}, sparse ranked ${s.rank}`);
});

test('a fully unknown site cannot lead a site with real, mediocre data', () => {
  const unknown = scoredSite('aaa_unknown', crit(0, 100, 0), crit(0, 100, 0), crit(0, 100, 0));
  const mediocre = scoredSite('zzz_known', crit(40, 40, 1), crit(40, 40, 1), crit(40, 40, 1));
  const ranked = rankSites([unknown, mediocre], W);
  assert.equal(ranked[0].site_id, 'zzz_known');
});

// --- paretoFrontier --------------------------------------------------------

test('paretoFrontier excludes a site beaten on all three criteria', () => {
  const scored = [
    scoredSite('strong', 90, 90, 90),
    scoredSite('weak', 10, 10, 10),
  ];
  assert.deepEqual(paretoFrontier(scored).sort(), ['strong']);
});

test('paretoFrontier keeps sites that each lead on a different criterion', () => {
  const scored = [
    scoredSite('a', 90, 10, 10),
    scoredSite('b', 10, 90, 10),
    scoredSite('c', 10, 10, 90),
  ];
  assert.deepEqual(paretoFrontier(scored).sort(), ['a', 'b', 'c']);
});

test('dominance requires >= on all three and > on at least one', () => {
  // b is equal on two criteria and better on one, so it dominates a.
  const scored = [scoredSite('a', 50, 50, 50), scoredSite('b', 50, 50, 60)];
  assert.deepEqual(paretoFrontier(scored), ['b']);
});

test('a site better on one criterion and worse on another is not dominated', () => {
  const scored = [scoredSite('a', 60, 40, 50), scoredSite('b', 40, 60, 50)];
  assert.deepEqual(paretoFrontier(scored).sort(), ['a', 'b']);
});

test('identical sites do not dominate each other and both stay on the frontier', () => {
  const scored = [scoredSite('a', 50, 50, 50), scoredSite('b', 50, 50, 50)];
  assert.deepEqual(paretoFrontier(scored).sort(), ['a', 'b']);
});

test('paretoFrontier uses pessimistic scores, not optimistic ones', () => {
  // `optimist` looks better optimistically but is beaten pessimistically.
  const scored = [
    scoredSite('solid', crit(60, 60, 1), crit(60, 60, 1), crit(60, 60, 1)),
    scoredSite('optimist', crit(10, 100, 0.1), crit(10, 100, 0.1), crit(10, 100, 0.1)),
  ];
  assert.deepEqual(paretoFrontier(scored), ['solid']);
});

test('paretoFrontier of a single site is that site', () => {
  assert.deepEqual(paretoFrontier([scoredSite('only', 1, 2, 3)]), ['only']);
});

test('paretoFrontier of no sites is empty', () => {
  assert.deepEqual(paretoFrontier([]), []);
});

// --- monteCarlo ------------------------------------------------------------

const MC_SITES = [
  scoredSite('a', 80, 40, 60),
  scoredSite('b', 50, 85, 55),
  scoredSite('c', 30, 30, 95),
];

test('monteCarlo is deterministic for a fixed seed', () => {
  const opts = { runs: 200, jitter: 0.2, seed: 1234 };
  const first = monteCarlo(MC_SITES, EVEN_WEIGHTS, opts);
  const second = monteCarlo(MC_SITES, EVEN_WEIGHTS, opts);
  assert.deepEqual(first, second);
});

test('monteCarlo repeats across many calls with the same seed', () => {
  const opts = { runs: 100, jitter: 0.2, seed: 7 };
  const baseline = monteCarlo(MC_SITES, EVEN_WEIGHTS, opts);
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(monteCarlo(MC_SITES, EVEN_WEIGHTS, opts), baseline);
  }
});

test('monteCarlo shares sum to 1', () => {
  const shares = monteCarlo(MC_SITES, EVEN_WEIGHTS, { runs: 200, jitter: 0.2, seed: 99 });
  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `shares sum to ${sum}`);
});

test('monteCarlo shares are in 0..1 and keyed by site id', () => {
  const shares = monteCarlo(MC_SITES, EVEN_WEIGHTS, { runs: 200, jitter: 0.2, seed: 5 });
  const ids = MC_SITES.map((s) => s.site_id);
  for (const [id, share] of Object.entries(shares)) {
    assert.ok(ids.includes(id), `unexpected key ${id}`);
    assert.ok(share >= 0 && share <= 1, `share ${share} out of range for ${id}`);
  }
});

test('monteCarlo gives a dominating site the whole share', () => {
  const scored = [scoredSite('winner', 100, 100, 100), scoredSite('loser', 1, 1, 1)];
  const shares = monteCarlo(scored, EVEN_WEIGHTS, { runs: 100, jitter: 0.2, seed: 42 });
  assert.ok(Math.abs(shares.winner - 1) < 1e-9, `winner share ${shares.winner}`);
  assert.ok(!shares.loser, `loser share ${shares.loser}`);
});

test('monteCarlo with a single site gives it a share of 1', () => {
  const shares = monteCarlo([scoredSite('only', 10, 20, 30)], EVEN_WEIGHTS, {
    runs: 50,
    jitter: 0.2,
    seed: 3,
  });
  assert.ok(Math.abs(shares.only - 1) < 1e-9);
});

test('monteCarlo with zero jitter puts the whole share on the current winner', () => {
  const shares = monteCarlo(MC_SITES, EVEN_WEIGHTS, { runs: 50, jitter: 0, seed: 11 });
  const winner = rankSites(MC_SITES, EVEN_WEIGHTS)[0].site_id;
  assert.ok(Math.abs(shares[winner] - 1) < 1e-9, `expected ${winner} to take every run`);
});

// --- topsis ----------------------------------------------------------------

test('topsis returns a closeness per site in 0..1', () => {
  const out = topsis(MC_SITES, EVEN_WEIGHTS);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c']);
  for (const [id, closeness] of Object.entries(out)) {
    assert.ok(closeness >= 0 && closeness <= 1, `${id} closeness ${closeness}`);
  }
});

test('topsis ranks a dominating site above a dominated one', () => {
  const out = topsis([scoredSite('strong', 90, 90, 90), scoredSite('weak', 10, 10, 10)], EVEN_WEIGHTS);
  assert.ok(out.strong > out.weak, `${out.strong} should exceed ${out.weak}`);
});

// --- flipMargin ------------------------------------------------------------

test('flipMargin reports a null margin when no grid point changes the winner', () => {
  // `winner` is best on every criterion, so no weight vector can unseat it.
  const scored = [scoredSite('winner', 90, 90, 90), scoredSite('other', 10, 20, 30)];
  const out = flipMargin(scored, EVEN_WEIGHTS, { step: 0.05 });
  assert.equal(out.margin, null);
  assert.ok(Object.hasOwn(out, 'resolution'), 'resolution must be reported');
});

test('flipMargin reports a null margin for a single site', () => {
  const out = flipMargin([scoredSite('only', 50, 50, 50)], EVEN_WEIGHTS, { step: 0.05 });
  assert.equal(out.margin, null);
});

test('flipMargin reports a positive margin and the challenger when the winner can be unseated', () => {
  // Under W (0.5/0.3/0.2): a = 0.5*100 = 50, b = 0.3*100 = 30. Shifting weight
  // from regulatory to cost flips the winner to b.
  const scored = [scoredSite('a', 100, 0, 0), scoredSite('b', 0, 100, 0)];
  const out = flipMargin(scored, W, { step: 0.05 });
  assert.notEqual(out.margin, null, 'a flip exists on this grid');
  assert.ok(out.margin > 0, `margin ${out.margin} must be positive`);
  assert.ok(out.margin <= 1, `margin ${out.margin} must be at most 1 (half L1 on the simplex)`);
  assert.equal(out.challenger, 'b');
});

test('flipMargin reports the grid resolution it used', () => {
  const scored = [scoredSite('a', 100, 0, 0), scoredSite('b', 0, 100, 0)];
  const out = flipMargin(scored, W, { step: 0.05 });
  assert.equal(out.resolution, 0.05);
});

test('a nearly tied runner-up gives a smaller flip margin than a distant one', () => {
  const close = flipMargin(
    [scoredSite('a', 100, 0, 0), scoredSite('b', 0, 98, 0)],
    W,
    { step: 0.01 },
  );
  const distant = flipMargin(
    [scoredSite('a', 100, 0, 0), scoredSite('b', 0, 30, 0)],
    W,
    { step: 0.01 },
  );
  assert.notEqual(close.margin, null);
  assert.notEqual(distant.margin, null);
  assert.ok(
    close.margin <= distant.margin,
    `close margin ${close.margin} should not exceed distant margin ${distant.margin}`,
  );
});

test('flipMargin is deterministic', () => {
  const scored = [scoredSite('a', 100, 0, 0), scoredSite('b', 0, 100, 0)];
  const first = flipMargin(scored, W, { step: 0.05 });
  const second = flipMargin(scored, W, { step: 0.05 });
  assert.deepEqual(first, second);
});
