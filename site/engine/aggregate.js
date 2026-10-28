// Aggregation: turn three criterion scores and a weight vector into a ranking,
// then report how fragile that ranking is.
//
// The weighted sum is the headline because it is the only method here a
// non-technical reader can check by hand. TOPSIS is computed alongside purely
// as a cross-check — if the two disagree, that is worth saying out loud rather
// than hiding behind whichever one flatters the leader.

const CRITERIA = ['regulatory', 'cost', 'community'];

export function weightedTotal(criterionScores, weights, mode = 'pessimistic') {
  let total = 0;
  for (const key of Object.keys(criterionScores)) {
    total += (weights[key] ?? 0) * criterionScores[key][mode];
  }
  return total;
}

/** Descending total, ties broken by ascending site_id so results are stable. */
function compare(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  return a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0;
}

export function rankSites(scored, weights) {
  const rows = scored.map((s) => ({
    site_id: s.site_id,
    name: s.name,
    total: weightedTotal(s.criteria, weights, 'pessimistic'),
    totalOptimistic: weightedTotal(s.criteria, weights, 'optimistic'),
    criteria: s.criteria,
  }));
  rows.sort(compare);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

function winnerUnder(scored, weights) {
  let best = null;
  for (const s of scored) {
    const total = weightedTotal(s.criteria, weights, 'pessimistic');
    const row = { site_id: s.site_id, total };
    if (best === null || compare(row, best) < 0) best = row;
  }
  return best ? best.site_id : null;
}

export function topsis(scored, weights) {
  const out = {};
  if (scored.length === 0) return out;
  if (scored.length === 1) {
    out[scored[0].site_id] = 1;
    return out;
  }

  const matrix = scored.map((s) => CRITERIA.map((k) => s.criteria[k]?.pessimistic ?? 0));
  const norms = CRITERIA.map((_, j) =>
    Math.sqrt(matrix.reduce((sum, row) => sum + row[j] * row[j], 0)),
  );
  const weighted = matrix.map((row) =>
    row.map((v, j) => (norms[j] === 0 ? 0 : (v / norms[j]) * (weights[CRITERIA[j]] ?? 0))),
  );
  // All three criteria are oriented so higher is better, so the ideal is the
  // column max throughout.
  const best = CRITERIA.map((_, j) => Math.max(...weighted.map((r) => r[j])));
  const worst = CRITERIA.map((_, j) => Math.min(...weighted.map((r) => r[j])));

  scored.forEach((s, i) => {
    const dBest = Math.sqrt(weighted[i].reduce((sum, v, j) => sum + (v - best[j]) ** 2, 0));
    const dWorst = Math.sqrt(weighted[i].reduce((sum, v, j) => sum + (v - worst[j]) ** 2, 0));
    out[s.site_id] = dBest + dWorst === 0 ? 1 : dWorst / (dBest + dWorst);
  });
  return out;
}

/** Non-dominated on the three pessimistic criterion scores. */
export function paretoFrontier(scored) {
  const vec = (s) => CRITERIA.map((k) => s.criteria[k]?.pessimistic ?? 0);
  return scored
    .filter((s) => {
      const a = vec(s);
      return !scored.some((other) => {
        if (other.site_id === s.site_id) return false;
        const b = vec(other);
        const everywhereAtLeast = b.every((v, i) => v >= a[i]);
        const somewhereBetter = b.some((v, i) => v > a[i]);
        return everywhereAtLeast && somewhereBetter;
      });
    })
    .map((s) => s.site_id);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perturb each weight by a uniform +/- `jitter` relative, renormalise, and see
 * who wins. Seeded, so the same inputs always give the same answer.
 *
 * @returns {object} share of runs at rank 1, keyed by site_id, including zeroes.
 */
export function monteCarlo(scored, weights, { runs = 2000, jitter = 0.2, seed = 42 } = {}) {
  const shares = Object.fromEntries(scored.map((s) => [s.site_id, 0]));
  if (scored.length === 0 || runs <= 0) return shares;

  const rand = mulberry32(seed);
  let counted = 0;

  for (let r = 0; r < runs; r++) {
    const perturbed = {};
    let sum = 0;
    for (const key of CRITERIA) {
      const base = weights[key] ?? 0;
      const w = Math.max(0, base * (1 + (rand() * 2 - 1) * jitter));
      perturbed[key] = w;
      sum += w;
    }
    if (sum <= 0) continue;
    for (const key of CRITERIA) perturbed[key] /= sum;

    const winner = winnerUnder(scored, perturbed);
    if (winner !== null) {
      shares[winner] += 1;
      counted += 1;
    }
  }

  if (counted > 0) {
    for (const key of Object.keys(shares)) shares[key] /= counted;
  }
  return shares;
}

/**
 * Smallest total weight shift that changes the top-ranked site.
 *
 * Reported as half the L1 distance between the current weight vector and the
 * nearest vector on the simplex with a different winner, which reads naturally
 * as "move this much weight from one criterion to another". Found by grid
 * search, so the answer is exact only to `step` — which is why the resolution
 * is returned alongside it and must be shown to the user.
 */
export function flipMargin(scored, weights, { step = 0.005 } = {}) {
  const result = { margin: null, resolution: step, challenger: null, incumbent: null };
  if (scored.length < 2) return result;

  const incumbent = winnerUnder(scored, weights);
  result.incumbent = incumbent;
  if (incumbent === null) return result;

  const steps = Math.round(1 / step);
  const base = CRITERIA.map((k) => weights[k] ?? 0);
  let bestDistance = Infinity;

  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const k = steps - i - j;
      const candidate = { regulatory: i / steps, cost: j / steps, community: k / steps };
      const distance =
        (Math.abs(candidate.regulatory - base[0]) +
          Math.abs(candidate.cost - base[1]) +
          Math.abs(candidate.community - base[2])) /
        2;
      if (distance >= bestDistance) continue;
      const winner = winnerUnder(scored, candidate);
      if (winner !== incumbent) {
        bestDistance = distance;
        result.margin = distance;
        result.challenger = winner;
      }
    }
  }
  return result;
}

export { CRITERIA };
