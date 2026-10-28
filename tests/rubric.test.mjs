// Structural invariants of the shipped rubric, from SPEC.md "Scoring" and
// "Hard constraints". Only structure is asserted here, never specific numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUBRIC_URL = new URL('../site/rubric/rubric_v0_1.json', import.meta.url);
const RUBRIC_PATH = fileURLToPath(RUBRIC_URL);
const present = existsSync(RUBRIC_PATH);

const skip = present
  ? false
  : `rubric file not found at ${RUBRIC_PATH} - skipping rubric structure tests`;

const rubric = present ? JSON.parse(readFileSync(RUBRIC_PATH, 'utf8')) : null;

const CRITERIA = ['regulatory', 'cost', 'community'];
const SCORER_TYPES = ['categorical', 'linear_decay', 'linear_gain'];

/** Criteria may be a keyed object or an array of criterion defs. */
function criterionEntries(r) {
  const c = r.criteria ?? r.criterion ?? {};
  if (Array.isArray(c)) return c.map((def) => [def.id, def]);
  return Object.entries(c);
}

function constraints(r) {
  return r.hard_constraints ?? r.constraints ?? r.hardConstraints ?? [];
}

test('the rubric declares a version', { skip }, () => {
  assert.ok(typeof rubric.version === 'string' && rubric.version.length > 0);
});

test('the rubric has exactly the three criteria regulatory, cost and community', { skip }, () => {
  const ids = criterionEntries(rubric).map(([id]) => id).sort();
  assert.deepEqual(ids, [...CRITERIA].sort());
});

test('factor weights within each criterion sum to 1.0', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    const sum = def.factors.reduce((a, f) => a + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `criterion ${id} factor weights sum to ${sum}`);
  }
});

test('every criterion has at least one factor', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    assert.ok(Array.isArray(def.factors) && def.factors.length > 0, `criterion ${id} has no factors`);
  }
});

test('every factor names an input key and carries a scorer', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    for (const f of def.factors) {
      assert.ok(typeof f.id === 'string' && f.id.length > 0, `${id} has an unnamed factor`);
      assert.ok(
        typeof f.input === 'string' && f.input.length > 0,
        `factor ${id}.${f.id} names no input`,
      );
      assert.ok(f.scorer, `factor ${id}.${f.id} has no scorer`);
      assert.ok(
        SCORER_TYPES.includes(f.scorer.type),
        `factor ${id}.${f.id} has scorer type ${f.scorer.type}`,
      );
    }
  }
});

test('every factor weight is a positive number', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    for (const f of def.factors) {
      assert.ok(typeof f.weight === 'number' && f.weight > 0, `${id}.${f.id} weight ${f.weight}`);
    }
  }
});

test('factor ids are unique within a criterion', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    const ids = def.factors.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `criterion ${id} has duplicate factor ids`);
  }
});

test('every factor input is namespaced evidence.* or profile.*', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    for (const f of def.factors) {
      assert.ok(
        /^(evidence|profile)\./.test(f.input),
        `factor ${id}.${f.id} input ${f.input} is not namespaced`,
      );
    }
  }
});

test('every hard constraint carries an id, an input, a test and a rationale', { skip }, () => {
  const list = constraints(rubric);
  assert.ok(Array.isArray(list) && list.length > 0, 'the rubric declares no hard constraints');
  for (const c of list) {
    assert.ok(typeof c.id === 'string' && c.id.length > 0, 'constraint without an id');
    assert.ok(typeof c.input === 'string' && c.input.length > 0, `constraint ${c.id} names no input`);
    assert.ok(c.test != null, `constraint ${c.id} has no test`);
    assert.ok(
      typeof c.rationale === 'string' && c.rationale.trim().length > 0,
      `constraint ${c.id} has no rationale`,
    );
  }
});

test('hard constraint ids are unique', { skip }, () => {
  const ids = constraints(rubric).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate hard constraint ids');
});

test('every hard constraint input is namespaced evidence.* or profile.*', { skip }, () => {
  for (const c of constraints(rubric)) {
    assert.ok(/^(evidence|profile)\./.test(c.input), `constraint ${c.id} input ${c.input}`);
  }
});

test('categorical scorers map every value to a 0-100 score', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    for (const f of def.factors) {
      if (f.scorer.type !== 'categorical') continue;
      const map = f.scorer.map ?? f.scorer.values;
      assert.ok(map && Object.keys(map).length > 0, `${id}.${f.id} has an empty categorical map`);
      for (const [key, score] of Object.entries(map)) {
        assert.ok(
          typeof score === 'number' && score >= 0 && score <= 100,
          `${id}.${f.id} maps ${key} to ${score}`,
        );
      }
    }
  }
});

test('linear scorers declare numeric best and worst endpoints that differ', { skip }, () => {
  for (const [id, def] of criterionEntries(rubric)) {
    for (const f of def.factors) {
      if (f.scorer.type === 'categorical') continue;
      assert.ok(typeof f.scorer.best === 'number', `${id}.${f.id} best is not numeric`);
      assert.ok(typeof f.scorer.worst === 'number', `${id}.${f.id} worst is not numeric`);
      assert.notEqual(f.scorer.best, f.scorer.worst, `${id}.${f.id} best equals worst`);
    }
  }
});
