// SPEC.md "Provenance" + Module API `provenance.js`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVENANCE, val, UNKNOWN, isMissing, weakest, derive } from '../site/engine/provenance.js';

const EXPECTED_ORDER = [
  'measured',
  'derived',
  'profile_reported',
  'vlm_inferred',
  'estimated',
  'mock',
  'unknown',
];

test('PROVENANCE lists the seven tags ordered strongest to weakest', () => {
  assert.deepEqual(PROVENANCE, EXPECTED_ORDER);
});

test('val wraps a value into {value, provenance, source, observed}', () => {
  const v = val(42, 'measured', { source: 'survey', observed: '2026-01-02' });
  assert.equal(v.value, 42);
  assert.equal(v.provenance, 'measured');
  assert.equal(v.source, 'survey');
  assert.equal(v.observed, '2026-01-02');
});

test('UNKNOWN is a Value with a null value and the unknown tag', () => {
  assert.equal(UNKNOWN.value, null);
  assert.equal(UNKNOWN.provenance, 'unknown');
});

// --- isMissing -------------------------------------------------------------

test('isMissing is true for a nullish Value object', () => {
  assert.equal(isMissing(null), true);
  assert.equal(isMissing(undefined), true);
});

test('isMissing is true for a nullish inner value', () => {
  assert.equal(isMissing({ value: null, provenance: 'measured' }), true);
  assert.equal(isMissing({ value: undefined, provenance: 'measured' }), true);
});

test('isMissing is true when the provenance tag is unknown', () => {
  assert.equal(isMissing({ value: 17, provenance: 'unknown' }), true);
  assert.equal(isMissing(UNKNOWN), true);
});

test('isMissing is false for a present value', () => {
  assert.equal(isMissing({ value: 17, provenance: 'mock' }), false);
});

test('isMissing is false for falsy-but-present values', () => {
  // 0, '' and false are data, not absence.
  assert.equal(isMissing({ value: 0, provenance: 'measured' }), false);
  assert.equal(isMissing({ value: '', provenance: 'measured' }), false);
  assert.equal(isMissing({ value: false, provenance: 'measured' }), false);
});

// --- weakest ---------------------------------------------------------------

test('weakest returns the weakest of the supplied tags', () => {
  assert.equal(weakest('measured', 'mock'), 'mock');
  assert.equal(weakest('mock', 'measured'), 'mock');
  assert.equal(weakest('derived', 'profile_reported', 'vlm_inferred'), 'vlm_inferred');
  assert.equal(weakest('measured'), 'measured');
});

test('weakest treats unknown as weaker than every other tag', () => {
  for (const tag of EXPECTED_ORDER.slice(0, -1)) {
    assert.equal(weakest(tag, 'unknown'), 'unknown', `unknown should beat ${tag}`);
  }
});

test('weakest is consistent with the PROVENANCE ordering for every pair', () => {
  for (let i = 0; i < EXPECTED_ORDER.length; i += 1) {
    for (let j = 0; j < EXPECTED_ORDER.length; j += 1) {
      const expected = EXPECTED_ORDER[Math.max(i, j)];
      assert.equal(weakest(EXPECTED_ORDER[i], EXPECTED_ORDER[j]), expected);
    }
  }
});

// --- derive ----------------------------------------------------------------

test('derive applies fn to the unwrapped values', () => {
  const a = val(10, 'measured', { source: 'a' });
  const b = val(4, 'measured', { source: 'b' });
  const out = derive([a, b], (x, y) => x - y, { source: 'calc' });
  assert.equal(out.value, 6);
  assert.equal(out.source, 'calc');
});

test('derive takes the weakest input provenance', () => {
  const a = val(10, 'measured', { source: 'a' });
  const b = val(0.25, 'mock', { source: 'b' });
  const out = derive([a, b], (x, y) => x * (1 - y), { source: 'developable' });
  assert.equal(out.provenance, 'mock');
  assert.equal(out.value, 7.5);
});

test('derive returns UNKNOWN when any input is missing', () => {
  const present = val(10, 'measured', { source: 'a' });
  for (const bad of [null, undefined, { value: null, provenance: 'mock' }, UNKNOWN]) {
    const out = derive([present, bad], (x, y) => x + y, { source: 'calc' });
    assert.equal(out.value, null, 'derived value must be null');
    assert.equal(out.provenance, 'unknown', 'derived provenance must be unknown');
  }
});

test('derive does not call fn when an input is missing', () => {
  let called = 0;
  derive([val(1, 'measured', { source: 'a' }), UNKNOWN], () => {
    called += 1;
    return 1;
  }, { source: 'calc' });
  assert.equal(called, 0);
});

test('derive of a single measured input keeps measured provenance', () => {
  const out = derive([val(8, 'measured', { source: 'a' })], (x) => x * 2, { source: 'calc' });
  assert.equal(out.value, 16);
  assert.equal(out.provenance, 'measured');
});
