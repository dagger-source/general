// Provenance tracking. Every value in Earthshaker carries a tag saying how it
// was obtained, so that no score can be traced back to nothing.
//
// Ordered strongest to weakest. A value computed from several inputs takes the
// WEAKEST provenance among them, so that one mocked input is enough to mark the
// result as mocked. This is deliberate: it is the only way a demo value cannot
// quietly launder itself into looking measured.

export const PROVENANCE = [
  'measured',
  'derived',
  'profile_reported',
  'vlm_inferred',
  'estimated',
  'mock',
  'unknown',
];

const RANK = new Map(PROVENANCE.map((tag, i) => [tag, i]));

export const PROVENANCE_LABEL = {
  measured: 'Measured',
  derived: 'Derived',
  profile_reported: 'Reported in profile',
  vlm_inferred: 'Inferred by vision model',
  estimated: 'Estimated',
  mock: 'DEMO DATA',
  unknown: 'Unknown',
};

/** Build a Value. Passing a nullish `value` produces a missing Value. */
export function val(value, provenance, { source = null, observed = null } = {}) {
  if (value === null || value === undefined) {
    return { value: null, provenance: 'unknown', source, observed };
  }
  if (!RANK.has(provenance)) {
    throw new Error(`unknown provenance tag: ${provenance}`);
  }
  return { value, provenance, source, observed };
}

export const UNKNOWN = Object.freeze({
  value: null,
  provenance: 'unknown',
  source: null,
  observed: null,
});

export function isMissing(v) {
  if (v === null || v === undefined) return true;
  if (v.value === null || v.value === undefined) return true;
  return v.provenance === 'unknown';
}

/** Weakest (highest-rank) tag among those given. No arguments => 'unknown'. */
export function weakest(...tags) {
  const flat = tags.flat();
  if (flat.length === 0) return 'unknown';
  let worst = flat[0];
  for (const tag of flat) {
    if (!RANK.has(tag)) throw new Error(`unknown provenance tag: ${tag}`);
    if (RANK.get(tag) > RANK.get(worst)) worst = tag;
  }
  return worst;
}

/**
 * Compute a new Value from existing ones. Returns UNKNOWN if ANY input is
 * missing — a derived value is never built on a gap.
 */
export function derive(values, fn, { source = null, observed = null } = {}) {
  const list = Array.isArray(values) ? values : [values];
  if (list.some(isMissing)) return { ...UNKNOWN, source, observed };
  const out = fn(...list.map((v) => v.value));
  if (out === null || out === undefined || (typeof out === 'number' && !Number.isFinite(out))) {
    return { ...UNKNOWN, source, observed };
  }
  const tags = list.map((v) => v.provenance);
  return {
    value: out,
    provenance: weakest(...tags),
    source,
    observed: observed ?? list.map((v) => v.observed).find((o) => o) ?? null,
  };
}

/** True if any value in the map carries demo provenance. */
export function containsMock(inputs) {
  return Object.values(inputs).some((v) => v && v.provenance === 'mock');
}
