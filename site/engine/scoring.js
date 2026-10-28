// Criterion scoring.
//
// The central rule: a factor whose input is missing produces NO score. It does
// not get a default, a neutral midpoint, or the average of its siblings — each
// of those silently converts ignorance into a favourable number.
//
// Instead every criterion reports a pair. `pessimistic` treats each missing
// factor as 0, `optimistic` treats it as 100, and the reported score is the
// pessimistic one. The gap between them is the cost of not knowing, and
// `completeness` reports how much of the criterion's weight is actually
// evidenced. Completeness is never folded into the score.

import { isMissing } from './provenance.js';
import { applyScorer, describeScorer } from './scorers.js';

const EPS = 1e-6;

export function scoreCriterion(criterionDef, inputs) {
  const factors = [];
  let weightSum = 0;
  let pessimistic = 0;
  let knownWeight = 0;

  for (const def of criterionDef.factors) {
    weightSum += def.weight;
    const v = inputs[def.input];
    const missing = isMissing(v);
    const score = missing ? null : applyScorer(def.scorer, v.value);
    // A present input that the scorer cannot map (an unmapped category) is also
    // missing for scoring purposes: there is no defensible number for it.
    const unscored = score === null;

    const factor = {
      id: def.id,
      label: def.label,
      weight: def.weight,
      input: def.input,
      value: missing ? null : v.value,
      provenance: missing ? 'unknown' : v.provenance,
      source: missing ? null : v.source,
      observed: missing ? null : (v.observed ?? null),
      score,
      missing: unscored,
      contribution: unscored ? 0 : def.weight * score,
      scorer: describeScorer(def.scorer),
      imagery_can_verify: def.imagery_can_verify === true,
      verification_note: def.verification_note || null,
      unmapped: !missing && score === null,
    };

    if (!unscored) {
      pessimistic += factor.contribution;
      knownWeight += def.weight;
    }
    factors.push(factor);
  }

  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(
      `factor weights for "${criterionDef.label || 'criterion'}" sum to ${weightSum}, expected 1.0`,
    );
  }

  const missingWeight = 1 - knownWeight;
  return {
    label: criterionDef.label,
    description: criterionDef.description,
    pessimistic,
    optimistic: pessimistic + missingWeight * 100,
    completeness: knownWeight,
    factors,
  };
}

export function scoreSite(rubric, inputs) {
  const out = {};
  for (const [key, def] of Object.entries(rubric.criteria)) {
    out[key] = scoreCriterion(def, inputs);
  }
  return out;
}

/** Share of total rubric weight that is evidenced, averaged across criteria. */
export function overallCompleteness(criterionScores, weights) {
  let total = 0;
  for (const [key, score] of Object.entries(criterionScores)) {
    total += (weights[key] ?? 0) * score.completeness;
  }
  return total;
}

/** Every factor with no usable value, across all criteria. */
export function missingFactors(criterionScores) {
  const out = [];
  for (const [key, score] of Object.entries(criterionScores)) {
    for (const f of score.factors) {
      if (f.missing) {
        out.push({
          criterion: key,
          criterion_label: score.label,
          ...f,
          reason: f.unmapped ? 'value not recognised by rubric' : 'no value supplied',
        });
      }
    }
  }
  return out;
}

/** Factors that no imagery can settle, regardless of whether a value exists. */
export function imageryBlindFactors(criterionScores) {
  const out = [];
  for (const [key, score] of Object.entries(criterionScores)) {
    for (const f of score.factors) {
      if (!f.imagery_can_verify) out.push({ criterion: key, criterion_label: score.label, ...f });
    }
  }
  return out;
}

export { EPS };
