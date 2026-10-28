// Dataset loading and validation.
//
// Validation is deliberately strict about identity and geometry, and
// deliberately permissive about profile completeness: a missing profile field is
// a legitimate state the rest of the engine is built to handle, not an error.

import { GeometryEvidenceProvider, MockEvidenceProvider } from './evidence.js';

const PROFILE_FIELDS = [
  'land_cost_usd_per_acre',
  'power_cost_usd_per_mwh',
  'interconnection_timeline_months',
  'zoning_status',
  'tax_incentive_pct_capex',
  'water_availability',
];

export function validateDataset(raw) {
  const errors = [];
  const warnings = [];

  if (!raw?.parcels?.features?.length) {
    errors.push('no parcels: expected parcels.features to be a non-empty array');
    return { errors, warnings };
  }

  const seen = new Set();
  for (const [i, f] of raw.parcels.features.entries()) {
    const id = f.properties?.site_id;
    if (!id) {
      errors.push(`feature ${i}: missing properties.site_id`);
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate site_id: ${id}`);
    seen.add(id);
    if (!f.properties?.name) warnings.push(`${id}: no name, falling back to site_id`);
    const t = f.geometry?.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon') {
      errors.push(`${id}: geometry must be Polygon or MultiPolygon, got ${t ?? 'nothing'}`);
    }
    if (!raw.profiles?.[id]) {
      warnings.push(`${id}: no upstream profile, every profile factor will be unknown`);
    } else {
      for (const field of PROFILE_FIELDS) {
        const v = raw.profiles[id][field];
        if (v === undefined) warnings.push(`${id}: profile field ${field} absent`);
        else if (v === null) warnings.push(`${id}: profile field ${field} reported as unknown`);
      }
    }
    if (!raw.mock_evidence?.[id]) {
      warnings.push(`${id}: no evidence row, every evidence factor will be unknown`);
    }
  }

  const n = raw.parcels.features.length;
  if (n < 5) warnings.push(`${n} sites: the tool is intended for shortlists of 5-20`);
  if (n > 20) warnings.push(`${n} sites: above the intended 5-20, run time will grow`);

  return { errors, warnings };
}

export function loadDataset(raw, { bufferMetres = 2000 } = {}) {
  const { errors, warnings } = validateDataset(raw);
  if (errors.length) {
    throw new Error(`dataset is not usable:\n  - ${errors.join('\n  - ')}`);
  }

  const sites = raw.parcels.features.map((f) => ({
    site_id: f.properties.site_id,
    name: f.properties.name || f.properties.site_id,
    geometry: f.geometry,
    profile: raw.profiles?.[f.properties.site_id] || {},
  }));

  const providers = [
    new GeometryEvidenceProvider({ bufferMetres }),
    new MockEvidenceProvider(raw.mock_evidence || {}),
  ];

  return {
    sites,
    providers,
    warnings,
    notice: raw.notice || null,
    status: raw.status || null,
    dataset: raw.dataset || 'unnamed dataset',
  };
}

export { PROFILE_FIELDS };
