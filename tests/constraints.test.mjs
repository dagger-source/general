// SPEC.md "Hard constraints" + Module API `constraints.js`.
// Integrity requirement 3: a missing hard-constraint input never produces a pass.
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateConstraints, classify } from '../site/engine/constraints.js';
import {
  v,
  MISSING,
  simpleRubric,
  ZONING_CONSTRAINT,
  FLOODWAY_CONSTRAINT,
} from './_fixtures.mjs';

const rubric = simpleRubric([ZONING_CONSTRAINT, FLOODWAY_CONSTRAINT]);

function byId(results, id) {
  const hit = results.find((r) => r.id === id);
  assert.ok(hit, `no constraint result for ${id}`);
  return hit;
}

// --- outcomes --------------------------------------------------------------

test('a present input that satisfies the test passes', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('by_right'),
    'evidence.fema_floodway_overlap_pct': v(2, 'mock'),
  }, rubric);
  assert.equal(byId(results, 'zoning_not_denied').outcome, 'pass');
  assert.equal(byId(results, 'floodway_overlap').outcome, 'pass');
});

test('a present input that violates the test fails', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('denied'),
    'evidence.fema_floodway_overlap_pct': v(80, 'mock'),
  }, rubric);
  assert.equal(byId(results, 'zoning_not_denied').outcome, 'fail');
  assert.equal(byId(results, 'floodway_overlap').outcome, 'fail');
});

test('a missing input yields unknown, never pass', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': MISSING,
    'evidence.fema_floodway_overlap_pct': null,
  }, rubric);
  for (const id of ['zoning_not_denied', 'floodway_overlap']) {
    const r = byId(results, id);
    assert.notEqual(r.outcome, 'pass', `${id} must not pass on missing input`);
    assert.equal(r.outcome, 'unknown');
  }
});

test('an absent input key yields unknown', () => {
  const results = evaluateConstraints({}, rubric);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.outcome, 'unknown', `${r.id} should be unknown`);
  }
});

test('an input tagged unknown yields unknown even though it carries a value', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': { value: 'by_right', provenance: 'unknown', source: 'stale' },
    'evidence.fema_floodway_overlap_pct': v(0, 'mock'),
  }, rubric);
  assert.equal(byId(results, 'zoning_not_denied').outcome, 'unknown');
});

test('a boundary value is evaluated, not treated as missing (zero overlap passes)', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('by_right'),
    'evidence.fema_floodway_overlap_pct': v(0, 'mock'),
  }, rubric);
  assert.equal(byId(results, 'floodway_overlap').outcome, 'pass');
});

test('every outcome is exactly one of pass, fail, unknown', () => {
  const cases = [
    {},
    { 'profile.zoning_status': v('denied') },
    { 'profile.zoning_status': v('by_right'), 'evidence.fema_floodway_overlap_pct': v(10, 'mock') },
    { 'profile.zoning_status': MISSING, 'evidence.fema_floodway_overlap_pct': v(99, 'mock') },
  ];
  for (const inputs of cases) {
    for (const r of evaluateConstraints(inputs, rubric)) {
      assert.ok(['pass', 'fail', 'unknown'].includes(r.outcome), `bad outcome ${r.outcome}`);
    }
  }
});

// --- traceability ----------------------------------------------------------

test('each constraint result names its input, value, provenance and rationale', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('special_use_permit', 'profile_reported', 'county-gis'),
    'evidence.fema_floodway_overlap_pct': v(3, 'mock', 'fixture-floodway'),
  }, rubric);
  for (const r of results) {
    for (const key of ['id', 'label', 'outcome', 'input', 'value', 'provenance', 'rationale']) {
      assert.ok(Object.hasOwn(r, key), `constraint ${r.id} missing ${key}`);
    }
    assert.ok(typeof r.rationale === 'string' && r.rationale.length > 0);
  }
  const z = byId(results, 'zoning_not_denied');
  assert.equal(z.input, 'profile.zoning_status');
  assert.equal(z.value, 'special_use_permit');
  assert.equal(z.provenance, 'profile_reported');
});

test('an unknown result still names the input it needed and reports unknown provenance', () => {
  const results = evaluateConstraints({}, rubric);
  const z = byId(results, 'zoning_not_denied');
  assert.equal(z.input, 'profile.zoning_status');
  assert.equal(z.value, null);
  assert.equal(z.provenance, 'unknown');
});

test('one result is returned per rubric constraint, in rubric order', () => {
  const results = evaluateConstraints({}, rubric);
  assert.deepEqual(results.map((r) => r.id), ['zoning_not_denied', 'floodway_overlap']);
});

// --- classify --------------------------------------------------------------

test('classify returns shortlist only when every constraint passes', () => {
  assert.equal(classify([{ outcome: 'pass' }, { outcome: 'pass' }]), 'shortlist');
});

test('classify returns held when there is an unknown and no fail', () => {
  assert.equal(classify([{ outcome: 'pass' }, { outcome: 'unknown' }]), 'held');
  assert.equal(classify([{ outcome: 'unknown' }]), 'held');
});

test('classify never returns shortlist for a site with an unknown', () => {
  const out = classify([{ outcome: 'pass' }, { outcome: 'pass' }, { outcome: 'unknown' }]);
  assert.notEqual(out, 'shortlist');
  assert.equal(out, 'held');
});

test('classify returns excluded when any constraint fails', () => {
  assert.equal(classify([{ outcome: 'pass' }, { outcome: 'fail' }]), 'excluded');
  assert.equal(classify([{ outcome: 'fail' }]), 'excluded');
});

test('a fail outranks an unknown: excluded wins over held', () => {
  assert.equal(classify([{ outcome: 'unknown' }, { outcome: 'fail' }]), 'excluded');
  assert.equal(classify([{ outcome: 'fail' }, { outcome: 'unknown' }]), 'excluded');
});

test('a site with no constraints at all is shortlisted', () => {
  assert.equal(classify([]), 'shortlist');
});

// --- end to end: missing input must hold the site, not shortlist it --------

test('a site missing one hard-constraint input is held, not shortlisted', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('by_right'),
    // floodway overlap unknown
  }, rubric);
  assert.equal(classify(results), 'held');
});

test('the same site with that input supplied and satisfied is shortlisted', () => {
  const results = evaluateConstraints({
    'profile.zoning_status': v('by_right'),
    'evidence.fema_floodway_overlap_pct': v(1, 'mock'),
  }, rubric);
  assert.equal(classify(results), 'shortlist');
});
