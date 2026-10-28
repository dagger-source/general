// SPEC.md "Scoring" / "Missing factors" + Module API `scoring.js`.
// Integrity requirements 1, 2 and the completeness separation rule.
import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreCriterion, scoreSite } from '../site/engine/scoring.js';
import {
  v,
  MISSING,
  twoFactorCriterion,
  threeFactorCriterion,
  simpleRubric,
  ZONING_SCORER,
} from './_fixtures.mjs';

const EPS = 1e-9;

function inputs(obj) {
  return obj;
}

// --- weighted sum ----------------------------------------------------------

test('criterion score is the weighted sum of its factor scores (hand-computed)', () => {
  // zoning by_right -> 100 at weight 0.6  => 60
  // timeline 36 months on 12..60 decay -> 50 at weight 0.4 => 20
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': v(36),
  }));
  assert.ok(Math.abs(out.pessimistic - 80) < EPS, `expected 80, got ${out.pessimistic}`);
  assert.ok(Math.abs(out.optimistic - 80) < EPS, `expected 80, got ${out.optimistic}`);
  assert.equal(out.completeness, 1);
});

test('a second hand-computed criterion case checks the weighting, not just the total', () => {
  // zoning special_use_permit -> 60 at 0.5 => 30
  // timeline 24 -> 75 at 0.3 => 22.5
  // incentive 40 pct -> 40 at 0.2 => 8
  const out = scoreCriterion(threeFactorCriterion(), inputs({
    'profile.zoning_status': v('special_use_permit'),
    'profile.interconnection_timeline_months': v(24),
    'profile.tax_incentive_pct_capex': v(40),
  }));
  assert.ok(Math.abs(out.pessimistic - 60.5) < 1e-9, `expected 60.5, got ${out.pessimistic}`);
});

test('every factor contribution equals weight * score for present factors', () => {
  const out = scoreCriterion(threeFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': v(24),
    'profile.tax_incentive_pct_capex': v(40),
  }));
  let sum = 0;
  for (const f of out.factors) {
    assert.ok(Math.abs(f.contribution - f.weight * f.score) < EPS, `factor ${f.id}`);
    sum += f.contribution;
  }
  assert.ok(Math.abs(sum - out.pessimistic) < 1e-9, 'contributions must sum to pessimistic');
});

test('criterion scores stay inside 0-100', () => {
  const def = threeFactorCriterion();
  const cases = [
    { 'profile.zoning_status': v('by_right'), 'profile.interconnection_timeline_months': v(0), 'profile.tax_incentive_pct_capex': v(1000) },
    { 'profile.zoning_status': v('denied'), 'profile.interconnection_timeline_months': v(999), 'profile.tax_incentive_pct_capex': v(-50) },
  ];
  for (const c of cases) {
    const out = scoreCriterion(def, inputs(c));
    for (const mode of ['pessimistic', 'optimistic']) {
      assert.ok(out[mode] >= 0 && out[mode] <= 100, `${mode} = ${out[mode]}`);
    }
  }
});

// --- missing factors -------------------------------------------------------

test('a missing factor contributes 0 pessimistically and 100 optimistically', () => {
  // zoning by_right -> 60 of 60 available; timeline missing at weight 0.4.
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': MISSING,
  }));
  assert.ok(Math.abs(out.pessimistic - 60) < EPS, `expected 60, got ${out.pessimistic}`);
  assert.ok(Math.abs(out.optimistic - 100) < EPS, `expected 100, got ${out.optimistic}`);
  assert.ok(Math.abs(out.completeness - 0.6) < EPS, `expected 0.6, got ${out.completeness}`);
});

test('an absent input key is treated exactly like an explicit null', () => {
  const explicit = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': null,
  }));
  const absent = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
  }));
  assert.equal(absent.pessimistic, explicit.pessimistic);
  assert.equal(absent.optimistic, explicit.optimistic);
  assert.equal(absent.completeness, explicit.completeness);
});

test('an input tagged unknown is missing even when it carries a value', () => {
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': { value: 12, provenance: 'unknown', source: 'stale' },
  }));
  assert.ok(Math.abs(out.pessimistic - 60) < EPS, 'unknown-tagged input must not score');
  assert.ok(Math.abs(out.completeness - 0.6) < EPS);
});

test('a missing factor gets no default, neutral or averaged score', () => {
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': MISSING,
  }));
  const f = out.factors.find((x) => x.id === 'timeline');
  assert.equal(f.missing, true);
  assert.equal(f.score, null);
  assert.equal(f.contribution, 0);
});

test('when every factor is missing: completeness 0, pessimistic 0, optimistic 100', () => {
  const out = scoreCriterion(twoFactorCriterion(), inputs({}));
  assert.equal(out.completeness, 0);
  assert.equal(out.pessimistic, 0);
  assert.equal(out.optimistic, 100);
});

test('completeness is the share of factor weight that is known', () => {
  const out = scoreCriterion(threeFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'), // weight 0.5
    'profile.tax_incentive_pct_capex': v(10), // weight 0.2
  }));
  assert.ok(Math.abs(out.completeness - 0.7) < EPS, `expected 0.7, got ${out.completeness}`);
  assert.ok(out.completeness >= 0 && out.completeness <= 1);
});

test('an unmapped categorical value counts as missing, not as a zero score', () => {
  const def = twoFactorCriterion();
  const out = scoreCriterion(def, inputs({
    'profile.zoning_status': v('no_such_status'),
    'profile.interconnection_timeline_months': v(12),
  }));
  const f = out.factors.find((x) => x.id === 'zoning');
  assert.equal(f.missing, true, 'unscorable input is missing');
  assert.equal(f.contribution, 0);
  // Optimistic must account for the unscored weight.
  assert.ok(out.optimistic > out.pessimistic, 'optimistic must exceed pessimistic');
  assert.ok(Math.abs(out.completeness - 0.4) < EPS, `expected 0.4, got ${out.completeness}`);
});

// --- integrity requirement 2: missing data never improves a score ----------

test('making a present factor missing never raises the pessimistic score', () => {
  const def = twoFactorCriterion();
  const withMissing = scoreCriterion(def, inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': MISSING,
  }));
  for (const months of [0, 12, 24, 36, 48, 60, 120]) {
    const present = scoreCriterion(def, inputs({
      'profile.zoning_status': v('by_right'),
      'profile.interconnection_timeline_months': v(months),
    }));
    assert.ok(
      withMissing.pessimistic <= present.pessimistic + EPS,
      `missing (${withMissing.pessimistic}) beat present ${months}mo (${present.pessimistic})`,
    );
  }
});

test('making a present factor missing never raises the pessimistic score, for every categorical value', () => {
  const def = twoFactorCriterion();
  const withMissing = scoreCriterion(def, inputs({
    'profile.interconnection_timeline_months': v(24),
  })).pessimistic;
  for (const status of Object.keys(ZONING_SCORER.map)) {
    const present = scoreCriterion(def, inputs({
      'profile.zoning_status': v(status),
      'profile.interconnection_timeline_months': v(24),
    })).pessimistic;
    assert.ok(withMissing <= present + EPS, `missing beat ${status}`);
  }
});

test('pessimistic is never above optimistic', () => {
  const def = threeFactorCriterion();
  const combos = [
    {},
    { 'profile.zoning_status': v('by_right') },
    { 'profile.zoning_status': v('denied'), 'profile.interconnection_timeline_months': v(60) },
    {
      'profile.zoning_status': v('by_right'),
      'profile.interconnection_timeline_months': v(12),
      'profile.tax_incentive_pct_capex': v(100),
    },
  ];
  for (const c of combos) {
    const out = scoreCriterion(def, inputs(c));
    assert.ok(out.pessimistic <= out.optimistic + EPS, JSON.stringify(c));
  }
});

test('pessimistic equals optimistic exactly when the criterion is complete', () => {
  const out = scoreCriterion(threeFactorCriterion(), inputs({
    'profile.zoning_status': v('rezoning_required'),
    'profile.interconnection_timeline_months': v(48),
    'profile.tax_incentive_pct_capex': v(5),
  }));
  assert.equal(out.completeness, 1);
  assert.ok(Math.abs(out.pessimistic - out.optimistic) < EPS);
});

// --- completeness is never folded into the score ---------------------------

test('low and high completeness yield the same pessimistic score for identical present contributions', () => {
  const def = threeFactorCriterion(); // weights 0.5 / 0.3 / 0.2
  // Sparse site: only the 0.5 factor is known, and it scores 100 => 50.
  const sparse = scoreCriterion(def, inputs({
    'profile.zoning_status': v('by_right'),
  }));
  // Complete site: same 0.5 factor at 100, and the other two score 0 => 50.
  const complete = scoreCriterion(def, inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': v(60), // worst -> 0
    'profile.tax_incentive_pct_capex': v(0), // worst -> 0
  }));
  assert.ok(Math.abs(sparse.completeness - 0.5) < EPS);
  assert.equal(complete.completeness, 1);
  assert.ok(
    Math.abs(sparse.pessimistic - complete.pessimistic) < EPS,
    `completeness leaked into the score: ${sparse.pessimistic} vs ${complete.pessimistic}`,
  );
  assert.ok(Math.abs(sparse.pessimistic - 50) < EPS);
});

test('completeness is reported as its own field and is not a multiplier on the score', () => {
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.interconnection_timeline_months': MISSING,
  }));
  assert.ok(Object.hasOwn(out, 'completeness'));
  assert.ok(typeof out.completeness === 'number');
  // A "score times completeness" implementation reports 36 here.
  assert.ok(Math.abs(out.pessimistic - 60) < EPS, `expected 60, got ${out.pessimistic}`);
});

test('rescaling by known weight is not applied (that would reward missing data)', () => {
  // zoning by_right only: known weight 0.6, raw contribution 60.
  // A "normalize by completeness" implementation reports 100 here.
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
  }));
  assert.ok(Math.abs(out.pessimistic - 60) < EPS, `expected 60, got ${out.pessimistic}`);
  assert.notEqual(out.pessimistic, 100);
});

// --- integrity requirement 1: traceability ---------------------------------

test('every factor object names its input key, value, provenance and source', () => {
  const out = scoreCriterion(threeFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right', 'profile_reported', 'county-gis'),
    'profile.interconnection_timeline_months': v(24, 'measured', 'utility-letter'),
    'profile.tax_incentive_pct_capex': v(40, 'estimated', 'analyst'),
  }));
  assert.equal(out.factors.length, 3);
  for (const f of out.factors) {
    for (const key of ['id', 'label', 'weight', 'input', 'value', 'provenance', 'source', 'score', 'missing', 'contribution']) {
      assert.ok(Object.hasOwn(f, key), `factor ${f.id} is missing ${key}`);
    }
    assert.ok(typeof f.input === 'string' && f.input.length > 0, 'input key must be named');
  }
  const zoning = out.factors.find((f) => f.id === 'zoning');
  assert.equal(zoning.input, 'profile.zoning_status');
  assert.equal(zoning.value, 'by_right');
  assert.equal(zoning.provenance, 'profile_reported');
  assert.equal(zoning.source, 'county-gis');
});

test('missing factors still trace to their input key with unknown provenance', () => {
  const out = scoreCriterion(twoFactorCriterion(), inputs({
    'profile.zoning_status': v('by_right'),
  }));
  const f = out.factors.find((x) => x.id === 'timeline');
  assert.equal(f.input, 'profile.interconnection_timeline_months');
  assert.equal(f.missing, true);
  assert.equal(f.value, null);
  assert.equal(f.provenance, 'unknown');
});

test('factor weights in the criterion result sum to 1.0', () => {
  for (const def of [twoFactorCriterion(), threeFactorCriterion()]) {
    const out = scoreCriterion(def, inputs({}));
    const sum = out.factors.reduce((a, f) => a + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `weights sum to ${sum}`);
  }
});

// --- scoreSite -------------------------------------------------------------

test('scoreSite returns exactly the three criteria', () => {
  const out = scoreSite(simpleRubric(), inputs({
    'profile.zoning_status': v('by_right'),
    'profile.tax_incentive_pct_capex': v(50),
    'profile.interconnection_timeline_months': v(36),
  }));
  assert.deepEqual(Object.keys(out).sort(), ['community', 'cost', 'regulatory']);
});

test('scoreSite scores each criterion independently', () => {
  const out = scoreSite(simpleRubric(), inputs({
    'profile.zoning_status': v('by_right'), // regulatory -> 100
    'profile.tax_incentive_pct_capex': v(50), // cost -> 50
    'profile.interconnection_timeline_months': v(36), // community -> 50
  }));
  assert.ok(Math.abs(out.regulatory.pessimistic - 100) < EPS);
  assert.ok(Math.abs(out.cost.pessimistic - 50) < EPS);
  assert.ok(Math.abs(out.community.pessimistic - 50) < EPS);
});

test('scoreSite carries pessimistic, optimistic, completeness and factors per criterion', () => {
  const out = scoreSite(simpleRubric(), inputs({ 'profile.zoning_status': v('by_right') }));
  for (const name of ['regulatory', 'cost', 'community']) {
    const c = out[name];
    for (const key of ['pessimistic', 'optimistic', 'completeness', 'factors']) {
      assert.ok(Object.hasOwn(c, key), `${name}.${key} missing`);
    }
    assert.ok(Array.isArray(c.factors));
  }
  assert.equal(out.cost.completeness, 0);
  assert.equal(out.cost.pessimistic, 0);
  assert.equal(out.cost.optimistic, 100);
});
