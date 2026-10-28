// Shared, inline fixtures for the Earthshaker V1.0 engine tests.
//
// Everything here is built by hand from SPEC.md. Nothing is loaded from
// site/data/*.json on purpose: those fixtures are authored in parallel and
// their numbers may move.
//
// SPEC.md documents the *function* API exactly but not the *rubric JSON*
// shape, so the shapes below are an interpretation (see QUESTIONS in the
// report). They are centralised here so that a shape disagreement with the
// implementation is a one-file fix rather than a suite-wide rewrite.

/** A Value record as described in SPEC.md "Profiles" / `val()`. */
export function v(value, provenance = 'profile_reported', source = 'fixture') {
  return { value, provenance, source, observed: '2026-01-01' };
}

/** An explicitly missing input. */
export const MISSING = { value: null, provenance: 'unknown', source: 'fixture', observed: null };

// ---------------------------------------------------------------------------
// Scorer configs
// ---------------------------------------------------------------------------

export const ZONING_SCORER = {
  type: 'categorical',
  map: {
    by_right: 100,
    special_use_permit: 60,
    rezoning_required: 20,
    denied: 0,
  },
};

/** 12 months -> 100, 60 months -> 0. */
export const TIMELINE_SCORER = { type: 'linear_decay', best: 12, worst: 60 };

/** 0 pct -> 0, 100 pct -> 100. */
export const INCENTIVE_SCORER = { type: 'linear_gain', best: 100, worst: 0 };

// ---------------------------------------------------------------------------
// Criterion definitions
// ---------------------------------------------------------------------------

export function factor(id, weight, input, scorer, label = id) {
  return { id, label, weight, input, scorer };
}

export function criterion(id, factors, label = id) {
  return { id, label, factors };
}

/**
 * Hand-computable two-factor criterion.
 *   zoning (w 0.6, categorical)  +  timeline (w 0.4, linear_decay 12..60)
 */
export function twoFactorCriterion() {
  return criterion('regulatory', [
    factor('zoning', 0.6, 'profile.zoning_status', ZONING_SCORER),
    factor('timeline', 0.4, 'profile.interconnection_timeline_months', TIMELINE_SCORER),
  ]);
}

/** Three-factor criterion with weights 0.5 / 0.3 / 0.2. */
export function threeFactorCriterion() {
  return criterion('cost', [
    factor('zoning', 0.5, 'profile.zoning_status', ZONING_SCORER),
    factor('timeline', 0.3, 'profile.interconnection_timeline_months', TIMELINE_SCORER),
    factor('incentive', 0.2, 'profile.tax_incentive_pct_capex', INCENTIVE_SCORER),
  ]);
}

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

/**
 * A full rubric with all three criteria. Each criterion reuses a single
 * factor so that site scores are easy to reason about.
 */
export function simpleRubric(constraints = []) {
  return {
    version: 'test-0.1',
    criteria: {
      regulatory: criterion('regulatory', [
        factor('zoning', 1.0, 'profile.zoning_status', ZONING_SCORER),
      ]),
      cost: criterion('cost', [
        factor('incentive', 1.0, 'profile.tax_incentive_pct_capex', INCENTIVE_SCORER),
      ]),
      community: criterion('community', [
        factor('timeline', 1.0, 'profile.interconnection_timeline_months', TIMELINE_SCORER),
      ]),
    },
    hard_constraints: constraints,
  };
}

/** Zoning must not be `denied`. */
export const ZONING_CONSTRAINT = {
  id: 'zoning_not_denied',
  label: 'Zoning not denied',
  input: 'profile.zoning_status',
  test: { type: 'not_in', values: ['denied'] },
  rationale: 'A denied rezoning cannot be screened into a shortlist.',
};

/** Floodway overlap must stay at or below 10 pct. */
export const FLOODWAY_CONSTRAINT = {
  id: 'floodway_overlap',
  label: 'FEMA floodway overlap within limit',
  input: 'evidence.fema_floodway_overlap_pct',
  test: { type: 'max', value: 10 },
  rationale: 'Floodway construction is not permittable.',
};

// ---------------------------------------------------------------------------
// Scored-site records (input to aggregate.js)
// ---------------------------------------------------------------------------

/** One criterion result as returned by `scoreCriterion`. */
export function crit(pessimistic, optimistic = pessimistic, completeness = 1, factors = []) {
  return { pessimistic, optimistic, completeness, factors };
}

/**
 * A scored site: `{site_id}` spread with a `scoreSite` result.
 * `reg`/`cost`/`comm` may be numbers (treated as complete) or crit objects.
 */
export function scoredSite(site_id, reg, cost, comm, extra = {}) {
  const asCrit = (x) => (typeof x === 'number' ? crit(x) : x);
  return {
    site_id,
    name: `Site ${site_id}`,
    regulatory: asCrit(reg),
    cost: asCrit(cost),
    community: asCrit(comm),
    ...extra,
  };
}

export const EVEN_WEIGHTS = { regulatory: 1 / 3, cost: 1 / 3, community: 1 / 3 };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Closed CCW lon/lat ring for a lon/lat rectangle. */
export function ring(lon1, lat1, lon2, lat2) {
  return [
    [lon1, lat1],
    [lon2, lat1],
    [lon2, lat2],
    [lon1, lat2],
    [lon1, lat1],
  ];
}

export function polygon(rings) {
  return { type: 'Polygon', coordinates: rings };
}

export function multiPolygon(polys) {
  return { type: 'MultiPolygon', coordinates: polys };
}

const R = 6371008.8; // IUGG mean Earth radius, metres
const ACRE_M2 = 4046.8564224;

/**
 * Exact spherical area of a lon/lat rectangle, in acres. Independent of the
 * implementation under test, so expectations stay hand-checkable.
 */
export function rectAreaAcres(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const m2 =
    R * R * Math.abs(lon2 - lon1) * rad * Math.abs(Math.sin(lat2 * rad) - Math.sin(lat1 * rad));
  return m2 / ACRE_M2;
}

/** Relative-difference assertion helper. */
export function closeTo(actual, expected, relTolerance) {
  return Math.abs(actual - expected) <= Math.abs(expected) * relTolerance;
}

/** A minimal parcel feature. */
export function parcel(site_id, geometry, name = `Site ${site_id}`) {
  return { type: 'Feature', properties: { site_id, name }, geometry };
}
