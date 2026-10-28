// Hard constraints. Screened before scoring, never tradeable against weighted
// preferences.
//
// The important rule is the three-way outcome. A constraint whose input is
// missing returns `unknown`, which holds the site for verification. It does not
// pass. Collapsing `unknown` into `pass` is exactly how a screening tool ends up
// recommending a site nobody checked.

import { isMissing } from './provenance.js';

export const OUTCOME = { PASS: 'pass', FAIL: 'fail', UNKNOWN: 'unknown' };

function runTest(test, value) {
  switch (test.type) {
    case 'min':
      return value >= test.value;
    case 'max':
      return value <= test.value;
    case 'in':
      return test.values.includes(value);
    case 'not_in':
      return !test.values.includes(value);
    default:
      throw new Error(`unsupported constraint test: ${test.type}`);
  }
}

export function describeTest(test) {
  switch (test.type) {
    case 'min':
      return `must be at least ${test.value}`;
    case 'max':
      return `must be at most ${test.value}`;
    case 'in':
      return `must be one of ${test.values.join(', ')}`;
    case 'not_in':
      return `must not be ${test.values.join(' or ')}`;
    default:
      return test.type;
  }
}

export function evaluateConstraints(inputs, rubric) {
  return (rubric.hard_constraints || []).map((c) => {
    const v = inputs[c.input];
    const base = {
      id: c.id,
      label: c.label,
      input: c.input,
      rationale: c.rationale,
      requirement: describeTest(c.test),
      imagery_can_verify: c.imagery_can_verify === true,
    };

    if (isMissing(v)) {
      return { ...base, outcome: OUTCOME.UNKNOWN, value: null, provenance: 'unknown', source: null };
    }
    return {
      ...base,
      outcome: runTest(c.test, v.value) ? OUTCOME.PASS : OUTCOME.FAIL,
      value: v.value,
      provenance: v.provenance,
      source: v.source,
    };
  });
}

/**
 * `excluded` beats `held`: a site that fails one constraint is out regardless of
 * what else is unverified.
 */
export function classify(results) {
  if (results.some((r) => r.outcome === OUTCOME.FAIL)) return 'excluded';
  if (results.some((r) => r.outcome === OUTCOME.UNKNOWN)) return 'held';
  return 'shortlist';
}
