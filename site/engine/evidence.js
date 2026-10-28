// Evidence providers. Each provider answers for one class of evidence, and all
// of them sit behind the same `evidenceFor(parcel)` interface so that a provider
// can be swapped without touching scoring.
//
// Increment 1 ships two:
//   GeometryEvidenceProvider — what the parcel outline alone supports. Real.
//   MockEvidenceProvider     — everything that would need imagery or external
//                              datasets. Demo data, tagged `mock`.
//
// Increment 2 replaces MockEvidenceProvider with real adapters (imagery crops,
// flood/wetland/protected-area vectors, schools, building footprints, terrain)
// without any change below this file.

import { val, derive, UNKNOWN } from './provenance.js';

const EARTH_RADIUS_M = 6378137;
const SQM_PER_ACRE = 4046.8564224;
const rad = (deg) => (deg * Math.PI) / 180;

function ringAreaSqm(ring) {
  // Spherical excess over a closed ring. Sign indicates winding; callers take
  // the absolute value, and interior rings are subtracted explicitly.
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

function polygonAreaSqm(rings) {
  if (!rings || rings.length === 0) return 0;
  const outer = Math.abs(ringAreaSqm(rings[0]));
  const holes = rings.slice(1).reduce((sum, r) => sum + Math.abs(ringAreaSqm(r)), 0);
  return Math.max(0, outer - holes);
}

/** Area of a GeoJSON Polygon or MultiPolygon, in acres. Interior rings subtracted. */
export function geodesicAreaAcres(geometry) {
  if (!geometry || typeof geometry !== 'object') return 0;
  let sqm = 0;
  if (geometry.type === 'Polygon') {
    sqm = polygonAreaSqm(geometry.coordinates);
  } else if (geometry.type === 'MultiPolygon') {
    sqm = geometry.coordinates.reduce((sum, rings) => sum + polygonAreaSqm(rings), 0);
  } else {
    throw new Error(`unsupported geometry type: ${geometry.type}`);
  }
  return sqm / SQM_PER_ACRE;
}

function allVertices(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  throw new Error(`unsupported geometry type: ${geometry.type}`);
}

export function centroidOf(geometry) {
  const pts = allVertices(geometry);
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lon, lat];
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (seq) => {
    const stack = [];
    for (const p of seq) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
        stack.pop();
      }
      stack.push(p);
    }
    return stack;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Outward buffer of a parcel, in metres.
 *
 * Implemented as the convex hull of circles placed on each vertex. That is the
 * EXACT buffer for a convex parcel and an over-approximation for a concave one,
 * which is the safe direction for a screening buffer: it never understates the
 * area being examined. Replace with a real geometry library when concave
 * parcels arrive.
 */
export function bufferGeometry(geometry, metres, samples = 24) {
  const [clon, clat] = centroidOf(geometry);
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(rad(clat));
  const ring = [];
  for (const [lon, lat] of allVertices(geometry)) {
    for (let i = 0; i < samples; i++) {
      const theta = (2 * Math.PI * i) / samples;
      ring.push([
        lon + (metres * Math.cos(theta)) / mPerDegLon,
        lat + (metres * Math.sin(theta)) / mPerDegLat,
      ]);
    }
  }
  const hull = convexHull(ring);
  return { type: 'Polygon', coordinates: [[...hull, hull[0]]] };
}

export class GeometryEvidenceProvider {
  constructor({ bufferMetres = 2000 } = {}) {
    this.bufferMetres = bufferMetres;
    this.name = 'parcel geometry';
  }

  evidenceFor(parcel) {
    const geometry = parcel.geometry;
    const source = 'computed from supplied parcel boundary';
    if (!geometry) {
      return { area_acres: UNKNOWN, buffer: UNKNOWN };
    }
    return {
      area_acres: val(geodesicAreaAcres(geometry), 'derived', { source }),
      buffer: val(bufferGeometry(geometry, this.bufferMetres), 'derived', {
        source: `${this.bufferMetres} m buffer of supplied parcel boundary`,
      }),
    };
  }
}

export class MockEvidenceProvider {
  /**
   * @param {object} table keyed by site_id, each a flat object of raw values.
   *   A key whose value is null is reported as missing, not as zero.
   */
  constructor(table, { source = 'DEMO FIXTURE — not observed', observed = null } = {}) {
    this.table = table || {};
    this.source = source;
    this.observed = observed;
    this.name = 'mock evidence fixture';
  }

  evidenceFor(parcel) {
    const row = this.table[parcel.properties?.site_id ?? parcel.site_id] || {};
    const out = {};
    for (const [key, raw] of Object.entries(row)) {
      out[key] = val(raw, 'mock', {
        source: this.source,
        observed: row.observed ?? this.observed,
      });
    }
    delete out.observed;
    return out;
  }
}

function profileValue(entry) {
  if (entry === null || entry === undefined) return UNKNOWN;
  if (typeof entry === 'object' && 'value' in entry) {
    return val(entry.value, entry.provenance || 'profile_reported', {
      source: entry.source || 'upstream site profile',
      observed: entry.observed || null,
    });
  }
  return val(entry, 'profile_reported', { source: 'upstream site profile' });
}

/**
 * Assemble the full input map for one site: profile fields, every provider's
 * evidence, and the derived fields that depend on both.
 */
export function buildInputs(site, providers = []) {
  const inputs = {};

  for (const [key, entry] of Object.entries(site.profile || {})) {
    inputs[`profile.${key}`] = profileValue(entry);
  }

  // A site may arrive flattened ({site_id, geometry, profile}) or with the raw
  // GeoJSON Feature kept intact ({parcel, profile}). Both are accepted.
  const parcel = site.parcel
    ? site.parcel
    : site.geometry
      ? { geometry: site.geometry, properties: { site_id: site.site_id } }
      : site;

  // Providers return bare keys; the `evidence.` namespace is applied here so a
  // provider never has to know how its output will be addressed.
  for (const provider of providers) {
    for (const [key, value] of Object.entries(provider.evidenceFor(parcel) || {})) {
      inputs[key.startsWith('evidence.') ? key : `evidence.${key}`] = value;
    }
  }

  inputs['evidence.developable_area_acres'] = derive(
    [inputs['evidence.area_acres'] ?? UNKNOWN, inputs['evidence.unbuildable_fraction'] ?? UNKNOWN],
    (acres, fraction) => acres * (1 - fraction),
    { source: 'area_acres x (1 - unbuildable_fraction)' },
  );

  return inputs;
}
