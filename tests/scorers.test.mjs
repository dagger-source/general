// SPEC.md "Scoring" scorer types + Module API `scorers.js`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyScorer } from '../site/engine/scorers.js';
import { ZONING_SCORER, TIMELINE_SCORER, INCENTIVE_SCORER } from './_fixtures.mjs';

// --- categorical -----------------------------------------------------------

test('categorical maps each listed value to its score', () => {
  assert.equal(applyScorer(ZONING_SCORER, 'by_right'), 100);
  assert.equal(applyScorer(ZONING_SCORER, 'special_use_permit'), 60);
  assert.equal(applyScorer(ZONING_SCORER, 'rezoning_required'), 20);
  assert.equal(applyScorer(ZONING_SCORER, 'denied'), 0);
});

test('categorical returns null for an unmapped value', () => {
  assert.equal(applyScorer(ZONING_SCORER, 'pending_review'), null);
  assert.equal(applyScorer(ZONING_SCORER, ''), null);
});

test('categorical does not fall back to a neutral score for unmapped values', () => {
  // A careless implementation returns 50 here; that invents a score with no input.
  const out = applyScorer(ZONING_SCORER, 'not_a_zoning_status');
  assert.notEqual(out, 50);
  assert.equal(out, null);
});

// --- linear_decay ----------------------------------------------------------

test('linear_decay scores best as 100 and worst as 0', () => {
  assert.equal(applyScorer(TIMELINE_SCORER, 12), 100);
  assert.equal(applyScorer(TIMELINE_SCORER, 60), 0);
});

test('linear_decay interpolates linearly between best and worst', () => {
  assert.equal(applyScorer(TIMELINE_SCORER, 36), 50);
  assert.equal(applyScorer(TIMELINE_SCORER, 24), 75);
  assert.equal(applyScorer(TIMELINE_SCORER, 48), 25);
});

test('linear_decay clamps beyond best and worst', () => {
  assert.equal(applyScorer(TIMELINE_SCORER, 0), 100);
  assert.equal(applyScorer(TIMELINE_SCORER, -5), 100);
  assert.equal(applyScorer(TIMELINE_SCORER, 600), 0);
});

// --- linear_gain -----------------------------------------------------------

test('linear_gain scores best as 100 and worst as 0', () => {
  assert.equal(applyScorer(INCENTIVE_SCORER, 100), 100);
  assert.equal(applyScorer(INCENTIVE_SCORER, 0), 0);
});

test('linear_gain interpolates and clamps', () => {
  assert.equal(applyScorer(INCENTIVE_SCORER, 25), 25);
  assert.equal(applyScorer(INCENTIVE_SCORER, 150), 100);
  assert.equal(applyScorer(INCENTIVE_SCORER, -10), 0);
});

test('linear_gain is the inverse of linear_decay over the same endpoints', () => {
  const decay = { type: 'linear_decay', best: 0, worst: 100 };
  const gain = { type: 'linear_gain', best: 100, worst: 0 };
  for (const x of [0, 10, 37.5, 80, 100]) {
    assert.equal(applyScorer(decay, x) + applyScorer(gain, x), 100, `at ${x}`);
  }
});

// --- clamping and nullish --------------------------------------------------

test('numeric scorer results are clamped to 0-100', () => {
  // Endpoints deliberately narrow so an unclamped formula overshoots hard.
  const cfg = { type: 'linear_decay', best: 10, worst: 11 };
  for (const x of [-1000, 0, 5, 10, 10.5, 11, 50, 1000]) {
    const out = applyScorer(cfg, x);
    assert.ok(out >= 0 && out <= 100, `score ${out} out of range at ${x}`);
  }
});

test('applyScorer returns null for nullish values', () => {
  for (const cfg of [ZONING_SCORER, TIMELINE_SCORER, INCENTIVE_SCORER]) {
    assert.equal(applyScorer(cfg, null), null);
    assert.equal(applyScorer(cfg, undefined), null);
  }
});

test('applyScorer scores a numeric zero rather than treating it as missing', () => {
  // 0 is falsy; it is still a real measurement.
  assert.equal(applyScorer(INCENTIVE_SCORER, 0), 0);
  assert.equal(applyScorer({ type: 'linear_decay', best: 0, worst: 10 }, 0), 100);
});
