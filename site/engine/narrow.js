// The narrowing pipeline: four nested stages from every candidate down to one
// leading site.
//
//   1. Candidates  — everything handed to us.
//   2. Shortlist   — passes every hard constraint. Excluded and held sites are
//                    kept separately, with reasons, and are never ranked.
//   3. Narrowed    — on the Pareto frontier AND either close to the leader or
//                    winning a meaningful share of the sensitivity runs.
//   4. Leader      — top of the weighted sum, reported with how easily it flips.
//
// Stage 2 does not depend on weights, so moving a slider can never rescue an
// excluded site or quietly promote a held one. Only stages 3 and 4 move.

import { buildInputs } from './evidence.js';
import { evaluateConstraints, classify } from './constraints.js';
import { scoreSite, overallCompleteness, missingFactors, imageryBlindFactors } from './scoring.js';
import { rankSites, paretoFrontier, monteCarlo, flipMargin, topsis } from './aggregate.js';
import { containsMock } from './provenance.js';

export const DEFAULTS = {
  narrowWithinPoints: 10,
  narrowMinShare: 0.05,
  runs: 2000,
  jitter: 0.2,
  seed: 42,
  flipStep: 0.005,
};

export function normalizeWeights(raw) {
  const keys = ['regulatory', 'cost', 'community'];
  const vals = keys.map((k) => Math.max(0, Number(raw?.[k]) || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum === 0) return { regulatory: 1 / 3, cost: 1 / 3, community: 1 / 3 };
  return Object.fromEntries(keys.map((k, i) => [k, vals[i] / sum]));
}

/** Accepts either a flattened site or one wrapping a GeoJSON Feature as `parcel`. */
function identify(site) {
  const feature = site.parcel ?? site;
  const props = feature.properties ?? {};
  const site_id = site.site_id ?? props.site_id;
  return {
    site_id,
    name: site.name ?? props.name ?? site_id,
    geometry: site.geometry ?? feature.geometry ?? null,
  };
}

export function runPipeline({ sites, rubric, weights, providers, options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  // The documented signature carries providers in `options`; a top-level
  // `providers` is accepted too, since the dashboard reads more clearly that way.
  const activeProviders = providers ?? options.providers ?? [];
  const w = normalizeWeights(weights);

  const detail = {};
  let demo = false;

  for (const site of sites) {
    const { site_id, name, geometry } = identify(site);
    const inputs = buildInputs(site, activeProviders);
    const constraints = evaluateConstraints(inputs, rubric);
    const stage = classify(constraints);
    const criteria = scoreSite(rubric, inputs);
    if (containsMock(inputs)) demo = true;

    detail[site_id] = {
      site_id,
      name,
      geometry,
      buffer: inputs['evidence.buffer']?.value ?? null,
      inputs,
      constraints,
      stage,
      criteria,
      completeness: overallCompleteness(criteria, w),
      missing: missingFactors(criteria),
      imageryBlind: imageryBlindFactors(criteria),
      blockers: constraints.filter((c) => c.outcome === 'fail'),
      unverified: constraints.filter((c) => c.outcome === 'unknown'),
    };
  }

  const candidates = sites.map((s) => identify(s).site_id);
  const shortlistIds = candidates.filter((id) => detail[id].stage === 'shortlist');
  const excluded = candidates.filter((id) => detail[id].stage === 'excluded');
  const held = candidates.filter((id) => detail[id].stage === 'held');

  const scored = shortlistIds.map((id) => ({
    site_id: id,
    name: detail[id].name,
    criteria: detail[id].criteria,
  }));

  const ranked = rankSites(scored, w);
  const frontier = paretoFrontier(scored);
  const mc = monteCarlo(scored, w, opts);
  const flip = flipMargin(scored, w, { step: opts.flipStep });
  const closeness = topsis(scored, w);

  const leaderTotal = ranked.length ? ranked[0].total : 0;
  const narrowed = ranked
    .filter(
      (r) =>
        frontier.includes(r.site_id) &&
        (leaderTotal - r.total <= opts.narrowWithinPoints || (mc[r.site_id] ?? 0) >= opts.narrowMinShare),
    )
    .map((r) => r.site_id);

  for (const r of ranked) {
    const d = detail[r.site_id];
    d.rank = r.rank;
    d.total = r.total;
    d.totalOptimistic = r.totalOptimistic;
    d.onFrontier = frontier.includes(r.site_id);
    d.rank1Share = mc[r.site_id] ?? 0;
    d.topsis = closeness[r.site_id] ?? null;
    d.inNarrowed = narrowed.includes(r.site_id);
    d.gapToLeader = leaderTotal - r.total;
  }

  // TOPSIS is only a cross-check, but a disagreement is worth surfacing rather
  // than burying.
  const topsisLeader = Object.entries(closeness).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    rubricVersion: rubric.version,
    weights: w,
    options: opts,
    stages: { candidates, shortlist: shortlistIds, excluded, held, narrowed },
    sites: detail,
    ranked,
    frontier,
    monteCarlo: mc,
    topsis: closeness,
    topsisLeader,
    topsisAgrees: ranked.length === 0 ? null : topsisLeader === ranked[0].site_id,
    flip,
    leader: ranked.length ? detail[ranked[0].site_id] : null,
    demo,
  };
}
