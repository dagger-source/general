// Decision memo. One page per run, in Markdown.
//
// The memo is the artefact that leaves the tool and goes into a meeting, so it
// carries the things most easily lost in conversation: which rubric version
// produced it, how fragile the ranking is, what is missing, and what imagery
// cannot settle no matter how good the imagery gets.

import { PROVENANCE_LABEL } from './provenance.js';
import { CRITERIA } from './aggregate.js';

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const num = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : '—');

function fmtValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

/** Three worst things about a site: unknowns first, then lowest scores. */
export function siteFlags(detail, limit = 3) {
  const flags = [];
  for (const c of detail.blockers) {
    flags.push({ kind: 'blocker', text: `${c.label}: ${fmtValue(c.value)} — ${c.requirement}` });
  }
  for (const c of detail.unverified) {
    flags.push({ kind: 'unverified', text: `${c.label}: no value supplied, ${c.requirement}` });
  }
  for (const f of detail.missing) {
    flags.push({ kind: 'missing', text: `${f.criterion_label} / ${f.label}: ${f.reason}` });
  }
  const scoredFactors = [];
  for (const key of Object.keys(detail.criteria)) {
    for (const f of detail.criteria[key].factors) {
      if (!f.missing) scoredFactors.push({ key, f, shortfall: f.weight * (100 - f.score) });
    }
  }
  scoredFactors.sort((a, b) => b.shortfall - a.shortfall);
  for (const { f } of scoredFactors) {
    flags.push({
      kind: 'weak',
      text: `${f.label}: ${fmtValue(f.value)} scores ${num(f.score, 0)}/100 (weight ${f.weight})`,
    });
  }
  return flags.slice(0, limit);
}

export function renderMemo(result, meta = {}) {
  const L = [];
  const generated = meta.generated || new Date().toISOString();
  const w = result.weights;

  L.push('# Earthshaker V1.0 — Site screening decision memo');
  L.push('');
  if (result.demo) {
    L.push('> **DEMO DATA.** This run contains mocked evidence. Every imagery-derived and');
    L.push('> external-dataset value below comes from a demo fixture and has not been');
    L.push('> observed. Do not use this memo for a real siting decision.');
    L.push('');
  }
  L.push('> This memo is **advisory**. It screens and ranks; it does not decide, and it');
  L.push('> does not establish feasibility. Every item in the Unknowns section must be');
  L.push('> resolved before a site is committed.');
  L.push('');

  L.push('## Run');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Generated | ${generated} |`);
  L.push(`| Rubric version | \`${result.rubricVersion}\` |`);
  L.push(
    `| Weights | Regulatory ${pct(w.regulatory)}, Cost ${pct(w.cost)}, Community ${pct(w.community)} |`,
  );
  L.push(
    `| Sensitivity | ${result.options.runs} runs, weights perturbed ±${pct(result.options.jitter)} relative, seed ${result.options.seed} |`,
  );
  L.push(`| Ranking method | weighted sum of pessimistic criterion scores |`);
  L.push('');

  L.push('## Narrowing');
  L.push('');
  const s = result.stages;
  L.push(`1. **Candidates:** ${s.candidates.length}`);
  L.push(
    `2. **Shortlist:** ${s.shortlist.length} passed every hard constraint — ${s.excluded.length} excluded, ${s.held.length} held for verification`,
  );
  L.push(
    `3. **Narrowed:** ${s.narrowed.length} on the Pareto frontier and either within ${result.options.narrowWithinPoints} points of the leader or leading in ≥${pct(result.options.narrowMinShare)} of sensitivity runs`,
  );
  L.push(`4. **Leading candidate:** ${result.leader ? result.leader.name : 'none'}`);
  L.push('');
  L.push(
    'Hard constraints are screened before scoring, so changing the weights cannot ' +
      'rescue an excluded site or promote a held one.',
  );
  L.push('');

  if (result.leader) {
    const ld = result.leader;
    L.push('## Recommendation');
    L.push('');
    L.push(
      `**${ld.name}** (\`${ld.site_id}\`) ranks first at these weights, scoring ` +
        `**${num(ld.total)}/100** (optimistic ceiling ${num(ld.totalOptimistic)} if every ` +
        `unknown resolved favourably), on **${pct(ld.completeness)}** data completeness.`,
    );
    L.push('');
    const f = result.flip;
    if (f.margin === null) {
      L.push(
        `It leads across the whole weight simplex at ${f.resolution} resolution — no weighting tested changes the top pick.`,
      );
    } else {
      L.push(
        `Its lead is **fragile at ${num(f.margin * 100, 1)} points of weight**: shifting that ` +
          `much weight between criteria hands first place to \`${f.challenger}\` ` +
          `(grid resolution ${f.resolution}).`,
      );
    }
    L.push(
      `It holds first place in **${pct(result.monteCarlo[ld.site_id] ?? 0)}** of sensitivity runs.`,
    );
    if (result.topsisAgrees === false) {
      L.push('');
      L.push(
        `⚠️ **Methods disagree.** TOPSIS, run as a cross-check, favours \`${result.topsisLeader}\`. ` +
          'Treat the gap between the top candidates as within the noise of the method.',
      );
    }
    L.push('');
  } else {
    L.push('## Recommendation');
    L.push('');
    L.push('**None.** No candidate passed every hard constraint. See the exclusions below.');
    L.push('');
  }

  L.push('## Ranking');
  L.push('');
  L.push('Only shortlisted sites are ranked. Reported scores are pessimistic: every');
  L.push('unknown factor contributes zero, so missing data can never help a site.');
  L.push('');
  L.push('| Rank | Site | Total | Ceiling | Reg | Cost | Comm | Complete | Frontier | Rank-1 share |');
  L.push('|---:|---|---:|---:|---:|---:|---:|---:|:--:|---:|');
  for (const r of result.ranked) {
    const d = result.sites[r.site_id];
    L.push(
      `| ${r.rank} | ${d.name} (\`${r.site_id}\`) | **${num(r.total)}** | ${num(r.totalOptimistic)} | ` +
        `${num(d.criteria.regulatory.pessimistic)} | ${num(d.criteria.cost.pessimistic)} | ` +
        `${num(d.criteria.community.pessimistic)} | ${pct(d.completeness)} | ` +
        `${d.onFrontier ? '✓' : ''} | ${pct(d.rank1Share)} |`,
    );
  }
  L.push('');
  L.push(`**Pareto frontier (non-dominated):** ${result.frontier.join(', ') || 'none'}`);
  L.push('');

  if (s.excluded.length) {
    L.push('## Excluded');
    L.push('');
    L.push('| Site | Failed constraint | Value | Requirement |');
    L.push('|---|---|---:|---|');
    for (const id of s.excluded) {
      const d = result.sites[id];
      for (const c of d.blockers) {
        L.push(`| ${d.name} (\`${id}\`) | ${c.label} | ${fmtValue(c.value)} | ${c.requirement} |`);
      }
    }
    L.push('');
  }

  if (s.held.length) {
    L.push('## Held for verification');
    L.push('');
    L.push('These sites are **not** excluded and **not** shortlisted. A hard constraint');
    L.push('could not be evaluated because its input is missing. They are held rather than');
    L.push('passed, because an unchecked constraint is not a satisfied one.');
    L.push('');
    L.push('| Site | Unevaluated constraint | Needed |');
    L.push('|---|---|---|');
    for (const id of s.held) {
      const d = result.sites[id];
      for (const c of d.unverified) {
        L.push(`| ${d.name} (\`${id}\`) | ${c.label} | \`${c.input}\` — ${c.requirement} |`);
      }
    }
    L.push('');
  }

  L.push('## Score composition');
  L.push('');
  L.push('`total = ' + CRITERIA.map((k) => `${pct(w[k])} × ${k}`).join(' + ') + '`');
  L.push('');
  for (const r of result.ranked.slice(0, meta.breakdownLimit ?? 3)) {
    const d = result.sites[r.site_id];
    L.push(`### ${d.name} (\`${r.site_id}\`) — ${num(r.total)}/100`);
    L.push('');
    L.push('| Criterion | Factor | Input | Value | Provenance | Score | Weight | Contribution |');
    L.push('|---|---|---|---:|---|---:|---:|---:|');
    for (const key of CRITERIA) {
      const c = d.criteria[key];
      for (const f of c.factors) {
        L.push(
          `| ${c.label} | ${f.label} | \`${f.input}\` | ${fmtValue(f.value)} | ` +
            `${PROVENANCE_LABEL[f.provenance]} | ${f.missing ? '—' : num(f.score, 0)} | ${f.weight} | ` +
            `${f.missing ? '0 (unknown)' : num(f.contribution)} |`,
        );
      }
      L.push(
        `| **${c.label} subtotal** | | | | | **${num(c.pessimistic)}** | ${pct(w[key])} | **${num(w[key] * c.pessimistic)}** |`,
      );
    }
    L.push('');
  }

  L.push('## Top flags');
  L.push('');
  for (const id of s.shortlist) {
    const d = result.sites[id];
    const flags = siteFlags(d, 3);
    L.push(`**${d.name}** (\`${id}\`)`);
    for (const f of flags) L.push(`- _${f.kind}_ — ${f.text}`);
    if (!flags.length) L.push('- no flags');
    L.push('');
  }

  L.push('## Unknowns');
  L.push('');
  L.push('### Missing values');
  L.push('');
  const anyMissing = s.candidates.some((id) => result.sites[id].missing.length || result.sites[id].unverified.length);
  if (!anyMissing) {
    L.push('None. Every rubric input had a value for every site.');
  } else {
    L.push('| Site | Input | What it feeds | Effect |');
    L.push('|---|---|---|---|');
    for (const id of s.candidates) {
      const d = result.sites[id];
      for (const c of d.unverified) {
        L.push(`| ${d.name} | \`${c.input}\` | hard constraint: ${c.label} | site held, not ranked |`);
      }
      for (const f of d.missing) {
        L.push(
          `| ${d.name} | \`${f.input}\` | ${f.criterion_label} / ${f.label} | scored 0, costs ${num(f.weight * 100)} pts of ${f.criterion_label} |`,
        );
      }
    }
  }
  L.push('');

  L.push('### Not answerable from imagery, at any resolution');
  L.push('');
  L.push('These factors are in the rubric but no image can settle them. They come from');
  L.push('the upstream profile or an authoritative dataset, and each needs confirmation');
  L.push('from the named source before a decision.');
  L.push('');
  const blind = new Map();
  for (const id of s.candidates) {
    for (const f of result.sites[id].imageryBlind) {
      if (!blind.has(f.id)) blind.set(f.id, f);
    }
  }
  L.push('| Factor | Input | Why imagery cannot settle it |');
  L.push('|---|---|---|');
  for (const f of blind.values()) {
    L.push(`| ${f.label} | \`${f.input}\` | ${f.verification_note || '—'} |`);
  }
  L.push('');
  for (const note of [
    'Grid capacity, interconnection queue position, and utility commitments are never inferred by this tool. They appear only where a profile reports them.',
    'Visible transmission lines or substations are evidence of nearby infrastructure only. They are not evidence of available capacity, and this rubric deliberately does not score them.',
    'Zoning, protected-area designation, water rights, and tax abatements are legal statuses. They require the issuing authority, not an image.',
  ]) {
    L.push(`- ${note}`);
  }
  L.push('');

  L.push('---');
  L.push('');
  L.push(
    `_Earthshaker V1.0, rubric \`${result.rubricVersion}\`. Advisory screening output. ` +
      `${result.demo ? 'Contains demo data. ' : ''}Not a feasibility determination._`,
  );
  L.push('');
  return L.join('\n');
}
