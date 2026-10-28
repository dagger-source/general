// SPEC.md "Evidence" + Module API `evidence.js`.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  geodesicAreaAcres,
  GeometryEvidenceProvider,
  MockEvidenceProvider,
  buildInputs,
} from '../site/engine/evidence.js';
import { ring, polygon, multiPolygon, rectAreaAcres, closeTo, parcel, v } from './_fixtures.mjs';

// Equal-area projections, spherical formulas and ellipsoidal formulas disagree
// by well under a percent; 2 pct keeps the expectation hand-checkable without
// pinning a magic number.
const TOL = 0.02;

// --- geodesicAreaAcres -----------------------------------------------------

test('a one-degree square near the equator matches the spherical rectangle area', () => {
  const geom = polygon([ring(0, 0, 1, 1)]);
  const expected = rectAreaAcres(0, 0, 1, 1); // ~3.05e6 acres
  const actual = geodesicAreaAcres(geom);
  assert.ok(
    closeTo(actual, expected, TOL),
    `expected ~${expected.toFixed(0)} acres, got ${actual}`,
  );
});

test('the equatorial one-degree square is on the order of three million acres', () => {
  // Sanity band, independent of the formula above: catches unit mix-ups
  // (square metres, hectares, square kilometres) rather than small model error.
  const actual = geodesicAreaAcres(polygon([ring(0, 0, 1, 1)]));
  assert.ok(actual > 2.9e6 && actual < 3.2e6, `${actual} acres is not a plausible value`);
});

test('a smaller rectangle away from the equator also matches the spherical area', () => {
  const geom = polygon([ring(-100, 40, -99.9, 40.1)]);
  const expected = rectAreaAcres(-100, 40, -99.9, 40.1);
  const actual = geodesicAreaAcres(geom);
  assert.ok(closeTo(actual, expected, TOL), `expected ~${expected}, got ${actual}`);
});

test('area is positive regardless of ring winding order', () => {
  const ccw = polygon([ring(0, 0, 0.1, 0.1)]);
  const cw = polygon([[...ring(0, 0, 0.1, 0.1)].reverse()]);
  const a = geodesicAreaAcres(ccw);
  const b = geodesicAreaAcres(cw);
  assert.ok(a > 0 && b > 0, `areas must be positive: ${a}, ${b}`);
  assert.ok(closeTo(b, a, 1e-9), `winding changed the area: ${a} vs ${b}`);
});

test('geodesicAreaAcres subtracts interior rings', () => {
  // 1-degree outer square with a 0.5-degree hole at its centre.
  const outer = ring(0, 0, 1, 1);
  const hole = ring(0.25, 0.25, 0.75, 0.75);
  const withHole = geodesicAreaAcres(polygon([outer, hole]));
  const expected = rectAreaAcres(0, 0, 1, 1) - rectAreaAcres(0.25, 0.25, 0.75, 0.75);
  assert.ok(
    closeTo(withHole, expected, TOL),
    `expected ~${expected.toFixed(0)} acres, got ${withHole}`,
  );
});

test('a holed polygon is smaller than the same polygon without the hole', () => {
  const outer = ring(0, 0, 1, 1);
  const hole = ring(0.25, 0.25, 0.75, 0.75);
  const solid = geodesicAreaAcres(polygon([outer]));
  const holed = geodesicAreaAcres(polygon([outer, hole]));
  assert.ok(holed < solid, `hole was not subtracted: ${holed} vs ${solid}`);
});

test('two interior rings are both subtracted', () => {
  const outer = ring(0, 0, 1, 1);
  const h1 = ring(0.1, 0.1, 0.3, 0.3);
  const h2 = ring(0.6, 0.6, 0.8, 0.8);
  const actual = geodesicAreaAcres(polygon([outer, h1, h2]));
  const expected =
    rectAreaAcres(0, 0, 1, 1) - rectAreaAcres(0.1, 0.1, 0.3, 0.3) - rectAreaAcres(0.6, 0.6, 0.8, 0.8);
  assert.ok(closeTo(actual, expected, TOL), `expected ~${expected.toFixed(0)}, got ${actual}`);
});

test('a MultiPolygon area is the sum of its parts', () => {
  const one = polygon([ring(0, 0, 1, 1)]);
  const single = geodesicAreaAcres(one);
  const two = multiPolygon([[ring(0, 0, 1, 1)], [ring(10, 0, 11, 1)]]);
  const actual = geodesicAreaAcres(two);
  assert.ok(
    closeTo(actual, 2 * single, 1e-6),
    `expected ~${2 * single}, got ${actual}`,
  );
});

test('a MultiPolygon subtracts interior rings in each part', () => {
  const geom = multiPolygon([
    [ring(0, 0, 1, 1), ring(0.25, 0.25, 0.75, 0.75)],
    [ring(10, 0, 11, 1)],
  ]);
  const expected =
    rectAreaAcres(0, 0, 1, 1) -
    rectAreaAcres(0.25, 0.25, 0.75, 0.75) +
    rectAreaAcres(10, 0, 11, 1);
  const actual = geodesicAreaAcres(geom);
  assert.ok(closeTo(actual, expected, TOL), `expected ~${expected.toFixed(0)}, got ${actual}`);
});

test('a single-part MultiPolygon equals the equivalent Polygon', () => {
  const asPolygon = geodesicAreaAcres(polygon([ring(0, 0, 0.2, 0.2)]));
  const asMulti = geodesicAreaAcres(multiPolygon([[ring(0, 0, 0.2, 0.2)]]));
  assert.ok(closeTo(asMulti, asPolygon, 1e-9), `${asMulti} vs ${asPolygon}`);
});

// --- GeometryEvidenceProvider ---------------------------------------------
// The spec names the evidence values but not the buffer key, so the buffer is
// located by name match.

test('GeometryEvidenceProvider reports area_acres with derived provenance', () => {
  const provider = new GeometryEvidenceProvider();
  const out = provider.evidenceFor(parcel('s1', polygon([ring(0, 0, 0.01, 0.01)])));
  assert.ok(out.area_acres, 'area_acres must be supplied');
  assert.equal(out.area_acres.provenance, 'derived');
  assert.ok(out.area_acres.value > 0);
});

test('GeometryEvidenceProvider area matches geodesicAreaAcres for the same geometry', () => {
  const geom = polygon([ring(0, 0, 0.05, 0.05)]);
  const out = new GeometryEvidenceProvider().evidenceFor(parcel('s1', geom));
  assert.ok(closeTo(out.area_acres.value, geodesicAreaAcres(geom), 1e-9));
});

test('GeometryEvidenceProvider supplies a 2 km buffer geometry', () => {
  const out = new GeometryEvidenceProvider().evidenceFor(
    parcel('s1', polygon([ring(0, 0, 0.01, 0.01)])),
  );
  const key = Object.keys(out).find((k) => /buffer/i.test(k));
  assert.ok(key, `no buffer key in ${Object.keys(out).join(', ')}`);
  const buffer = out[key];
  assert.ok(buffer && buffer.value, 'buffer must carry a value');
  assert.equal(buffer.provenance, 'derived');
  assert.ok(/Polygon/i.test(buffer.value.type), `buffer should be a polygon, got ${buffer.value.type}`);
});

test('GeometryEvidenceProvider makes no network or dataset call for a bare geometry', () => {
  // A geometry-only provider must work on a feature with no properties but
  // site_id/name and no profile data attached.
  const out = new GeometryEvidenceProvider().evidenceFor({
    type: 'Feature',
    properties: { site_id: 's1', name: 'S1' },
    geometry: polygon([ring(0, 0, 0.01, 0.01)]),
  });
  assert.ok(out.area_acres.value > 0);
});

// --- MockEvidenceProvider -------------------------------------------------

const MOCK_FIXTURE = {
  s1: {
    unbuildable_fraction: 0.25,
    mean_slope_pct: 3,
    protected_area_distance_m: 4000,
    wetland_overlap_pct: 1,
    fema_floodway_overlap_pct: 0,
    residences_within_1km: 12,
    schools_within_1km: 0,
    distance_nearest_residence_m: 800,
    current_land_use: 'cropland',
  },
};

test('MockEvidenceProvider tags every value it supplies as mock', () => {
  const out = new MockEvidenceProvider(MOCK_FIXTURE).evidenceFor(
    parcel('s1', polygon([ring(0, 0, 0.01, 0.01)])),
  );
  for (const [key, value] of Object.entries(out)) {
    assert.equal(value.provenance, 'mock', `${key} should be mock`);
  }
});

test('MockEvidenceProvider supplies every field the spec lists', () => {
  const out = new MockEvidenceProvider(MOCK_FIXTURE).evidenceFor(
    parcel('s1', polygon([ring(0, 0, 0.01, 0.01)])),
  );
  for (const key of Object.keys(MOCK_FIXTURE.s1)) {
    assert.ok(Object.hasOwn(out, key), `missing ${key}`);
    assert.equal(out[key].value, MOCK_FIXTURE.s1[key]);
  }
});

test('MockEvidenceProvider yields missing values for a site absent from the fixture', () => {
  const out = new MockEvidenceProvider(MOCK_FIXTURE).evidenceFor(
    parcel('nope', polygon([ring(0, 0, 0.01, 0.01)])),
  );
  for (const [key, value] of Object.entries(out)) {
    assert.ok(
      value == null || value.value == null || value.provenance === 'unknown',
      `${key} invented a value for an unknown site: ${JSON.stringify(value)}`,
    );
  }
});

// --- buildInputs ----------------------------------------------------------
// Interpretation: a site is `{parcel, profile}` and keys are namespaced
// `evidence.*` / `profile.*`.

function site(site_id = 's1') {
  return {
    parcel: parcel(site_id, polygon([ring(0, 0, 0.01, 0.01)])),
    profile: {
      land_cost_usd_per_acre: v(20000),
      power_cost_usd_per_mwh: v(45),
      interconnection_timeline_months: v(30),
      zoning_status: v('by_right'),
      tax_incentive_pct_capex: v(10),
      water_availability: v('adequate'),
    },
  };
}

test('buildInputs namespaces profile keys under profile.*', () => {
  const inputs = buildInputs(site(), [new GeometryEvidenceProvider()]);
  assert.ok(inputs['profile.zoning_status'], 'profile.zoning_status missing');
  assert.equal(inputs['profile.zoning_status'].value, 'by_right');
  assert.equal(inputs['profile.interconnection_timeline_months'].value, 30);
});

test('buildInputs namespaces provider keys under evidence.*', () => {
  const inputs = buildInputs(site(), [
    new GeometryEvidenceProvider(),
    new MockEvidenceProvider(MOCK_FIXTURE),
  ]);
  assert.ok(inputs['evidence.area_acres'], 'evidence.area_acres missing');
  assert.equal(inputs['evidence.mean_slope_pct'].value, 3);
});

test('buildInputs adds derived developable_area_acres', () => {
  const inputs = buildInputs(site(), [
    new GeometryEvidenceProvider(),
    new MockEvidenceProvider(MOCK_FIXTURE),
  ]);
  const dev = inputs['evidence.developable_area_acres'];
  assert.ok(dev, 'evidence.developable_area_acres missing');
  const area = inputs['evidence.area_acres'].value;
  assert.ok(closeTo(dev.value, area * 0.75, 1e-9), `expected ${area * 0.75}, got ${dev.value}`);
});

test('developable_area_acres takes the weakest input provenance (mock)', () => {
  const inputs = buildInputs(site(), [
    new GeometryEvidenceProvider(),
    new MockEvidenceProvider(MOCK_FIXTURE),
  ]);
  assert.equal(inputs['evidence.developable_area_acres'].provenance, 'mock');
});

test('developable_area_acres is missing when the unbuildable fraction is missing', () => {
  // Geometry only: nothing supplies unbuildable_fraction.
  const inputs = buildInputs(site(), [new GeometryEvidenceProvider()]);
  const dev = inputs['evidence.developable_area_acres'];
  assert.ok(
    dev == null || dev.value == null || dev.provenance === 'unknown',
    `developable area was invented without its inputs: ${JSON.stringify(dev)}`,
  );
});

test('buildInputs treats an absent profile key as a missing value', () => {
  const s = site();
  delete s.profile.zoning_status;
  const inputs = buildInputs(s, [new GeometryEvidenceProvider()]);
  const z = inputs['profile.zoning_status'];
  assert.ok(
    z == null || z.value == null || z.provenance === 'unknown',
    `absent profile key must not become a value: ${JSON.stringify(z)}`,
  );
});

test('buildInputs keeps a null profile field null rather than defaulting it', () => {
  const s = site();
  s.profile.water_availability = null;
  const inputs = buildInputs(s, [new GeometryEvidenceProvider()]);
  const w = inputs['profile.water_availability'];
  assert.ok(w == null || w.value == null || w.provenance === 'unknown');
});

test('providers are swappable: scoring inputs are built the same way with either set', () => {
  const geomOnly = buildInputs(site(), [new GeometryEvidenceProvider()]);
  const both = buildInputs(site(), [
    new GeometryEvidenceProvider(),
    new MockEvidenceProvider(MOCK_FIXTURE),
  ]);
  // Swapping providers changes which keys are present, never the namespacing
  // or the profile half of the inputs.
  assert.equal(geomOnly['profile.zoning_status'].value, both['profile.zoning_status'].value);
  assert.ok(closeTo(geomOnly['evidence.area_acres'].value, both['evidence.area_acres'].value, 1e-9));
});
