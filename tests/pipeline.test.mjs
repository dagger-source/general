// SPEC.md "Narrowing", "Decision memo" + Module API `narrow.js` / `memo.js`.
//
// Interpretation: `sites` is an array of `{parcel, profile}` and evidence
// providers are supplied through `options.providers`. SPEC.md does not state
// either shape (see QUESTIONS in the report).
import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../site/engine/narrow.js';
import { renderMemo } from '../site/engine/memo.js';
import { GeometryEvidenceProvider, MockEvidenceProvider } from '../site/engine/evidence.js';
import {
  v,
  ring,
  polygon,
  parcel,
  simpleRubric,
  ZONING_CONSTRAINT,
  EVEN_WEIGHTS,
} from './_fixtures.mjs';

const rubric = simpleRubric([ZONING_CONSTRAINT]);

function site(site_id, zoning, incentive, months, lonOffset = 0) {
  return {
    parcel: parcel(site_id, polygon([ring(lonOffset, 0, lonOffset + 0.01, 0.01)])),
    profile: {
      zoning_status: zoning === null ? null : v(zoning),
      tax_incentive_pct_capex: incentive === null ? null : v(incentive),
      interconnection_timeline_months: months === null ? null : v(months),
    },
  };
}

const SITES = [
  site('good', 'by_right', 80, 12, 0),
  site('okay', 'special_use_permit', 40, 36, 1),
  site('denied', 'denied', 90, 12, 2),
  site('unknownzoning', null, 90, 12, 3),
];

function run(options = {}) {
  return runPipeline({
    sites: SITES,
    rubric,
    weights: EVEN_WEIGHTS,
    options: { providers: [new GeometryEvidenceProvider()], seed: 1, runs: 100, ...options },
  });
}

test('candidates holds every site loaded', () => {
  const out = run();
  assert.deepEqual(
    [...out.stages.candidates].sort(),
    ['denied', 'good', 'okay', 'unknownzoning'],
  );
});

test('a failing constraint excludes the site', () => {
  const out = run();
  assert.ok(out.stages.excluded.includes('denied'));
  assert.ok(!out.stages.shortlist.includes('denied'));
});

test('a missing constraint input holds the site rather than shortlisting it', () => {
  const out = run();
  assert.ok(out.stages.held.includes('unknownzoning'), 'site must be held');
  assert.ok(!out.stages.shortlist.includes('unknownzoning'), 'site must not be shortlisted');
});

test('shortlist, excluded and held partition the candidates', () => {
  const out = run();
  const all = [...out.stages.shortlist, ...out.stages.excluded, ...out.stages.held].sort();
  assert.deepEqual(all, [...out.stages.candidates].sort());
});

test('excluded and held sites are never assigned a rank', () => {
  const out = run();
  const unranked = new Set([...out.stages.excluded, ...out.stages.held]);
  for (const row of out.ranked) {
    if (unranked.has(row.site_id)) {
      assert.ok(row.rank == null, `${row.site_id} must not carry a rank`);
    }
  }
});

test('the ranked list covers exactly the shortlist', () => {
  const out = run();
  const rankedIds = out.ranked.filter((r) => r.rank != null).map((r) => r.site_id).sort();
  assert.deepEqual(rankedIds, [...out.stages.shortlist].sort());
});

test('narrowed is a subset of the shortlist', () => {
  const out = run();
  for (const id of out.stages.narrowed) {
    assert.ok(out.stages.shortlist.includes(id), `${id} narrowed without being shortlisted`);
  }
});

test('narrowed sites are all on the Pareto frontier', () => {
  const out = run();
  for (const id of out.stages.narrowed) {
    assert.ok(out.frontier.includes(id), `${id} narrowed but not on the frontier`);
  }
});

test('the leader is the top-ranked shortlist site', () => {
  const out = run();
  const top = out.ranked.find((r) => r.rank === 1);
  assert.ok(top, 'there must be a rank-1 site');
  const leaderId = typeof out.leader === 'string' ? out.leader : out.leader.site_id;
  assert.equal(leaderId, top.site_id);
  assert.ok(out.stages.shortlist.includes(leaderId));
});

test('the leader carries its flip margin, Monte Carlo share and completeness', () => {
  const out = run();
  assert.ok(out.flip, 'flip result must be present');
  assert.ok(Object.hasOwn(out.flip, 'margin'));
  assert.ok(Object.hasOwn(out.flip, 'resolution'));
  const sum = Object.values(out.monteCarlo).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `Monte Carlo shares sum to ${sum}`);
});

test('the pipeline is deterministic for a fixed seed', () => {
  assert.deepEqual(run({ seed: 7 }), run({ seed: 7 }));
});

test('stage 2 does not depend on the weights', () => {
  const a = run();
  const b = runPipeline({
    sites: SITES,
    rubric,
    weights: { regulatory: 0.8, cost: 0.1, community: 0.1 },
    options: { providers: [new GeometryEvidenceProvider()], seed: 1, runs: 100 },
  });
  assert.deepEqual(a.stages.shortlist.sort(), b.stages.shortlist.sort());
  assert.deepEqual(a.stages.excluded.sort(), b.stages.excluded.sort());
  assert.deepEqual(a.stages.held.sort(), b.stages.held.sort());
});

// --- demo-data labelling (integrity requirement 6) ------------------------

test('demo is false when no mock input is used', () => {
  const out = run();
  assert.equal(out.demo, false);
});

test('demo is true when any input used is mock', () => {
  const fixture = Object.fromEntries(
    SITES.map((s) => [s.parcel.properties.site_id, { unbuildable_fraction: 0.1, mean_slope_pct: 2 }]),
  );
  const out = run({
    providers: [new GeometryEvidenceProvider(), new MockEvidenceProvider(fixture)],
  });
  assert.equal(out.demo, true);
});

// --- memo ----------------------------------------------------------------

test('the memo names the rubric version', () => {
  const out = run();
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  assert.ok(md.includes(rubric.version), 'rubric version must appear in the memo');
});

test('the memo states the weights it was generated for', () => {
  const out = run();
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  assert.ok(/regulatory/i.test(md) && /cost/i.test(md) && /community/i.test(md));
});

test('the memo includes an unknowns section', () => {
  const out = run();
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  assert.ok(/unknown/i.test(md), 'memo must carry an explicit unknowns list');
});

test('the memo names each held or excluded site with its reason', () => {
  const out = run();
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  for (const id of [...out.stages.excluded, ...out.stages.held]) {
    assert.ok(md.includes(id), `memo omits ${id}`);
  }
});

test('a memo built from mock inputs is labelled as demo data', () => {
  const fixture = Object.fromEntries(
    SITES.map((s) => [s.parcel.properties.site_id, { unbuildable_fraction: 0.1 }]),
  );
  const out = run({
    providers: [new GeometryEvidenceProvider(), new MockEvidenceProvider(fixture)],
  });
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  assert.ok(/demo data/i.test(md), 'memo must be labelled demo data when mock values are used');
});

test('renderMemo returns a markdown string', () => {
  const out = run();
  const md = renderMemo(out, { rubricVersion: rubric.version, weights: EVEN_WEIGHTS });
  assert.equal(typeof md, 'string');
  assert.ok(md.trim().length > 0);
});
