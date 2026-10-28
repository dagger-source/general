// Scorers map one raw input onto 0-100, where 100 is always the better end.
//
// `linear_decay` and `linear_gain` share the same interpolation: 100 at `best`,
// 0 at `worst`, clamped outside that span. They differ only in which end is
// numerically larger, and both names are kept because the rubric reads better
// when the intent is stated.

const clamp = (n) => Math.max(0, Math.min(100, n));

function interpolate(value, best, worst) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (best === worst) return null;
  return clamp(((value - worst) / (best - worst)) * 100);
}

/**
 * @returns {number|null} 0-100, or null when the input is absent or the
 *   categorical map has no entry for it. Null means "no score", which the
 *   caller must treat as missing — never as zero.
 */
export function applyScorer(cfg, value) {
  if (!cfg || typeof cfg.type !== 'string') {
    throw new Error('scorer config must have a type');
  }
  if (value === null || value === undefined) return null;

  switch (cfg.type) {
    case 'categorical': {
      if (!cfg.map || typeof cfg.map !== 'object') {
        throw new Error('categorical scorer requires a map');
      }
      if (!Object.prototype.hasOwnProperty.call(cfg.map, value)) return null;
      const score = cfg.map[value];
      return typeof score === 'number' && Number.isFinite(score) ? clamp(score) : null;
    }
    case 'linear_decay':
    case 'linear_gain':
      return interpolate(value, cfg.best, cfg.worst);
    default:
      throw new Error(`unsupported scorer type: ${cfg.type}`);
  }
}

/** Human-readable description of a scorer, for the evidence panel and memo. */
export function describeScorer(cfg) {
  switch (cfg.type) {
    case 'categorical': {
      const pairs = Object.entries(cfg.map)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`);
      return `categorical (${pairs.join(', ')})`;
    }
    case 'linear_decay':
    case 'linear_gain':
      return `linear: ${cfg.best} scores 100, ${cfg.worst} scores 0, clamped`;
    default:
      return cfg.type;
  }
}
