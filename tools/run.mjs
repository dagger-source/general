#!/usr/bin/env node
// Headless Earthshaker run. Same engine the dashboard uses, so this is the
// quickest way to verify scoring and narrowing without a browser.
//
//   node tools/run.mjs                              default weights, prints memo
//   node tools/run.mjs --reg 0.5 --cost 0.3 --comm 0.2
//   node tools/run.mjs --out memo.md
//   node tools/run.mjs --summary                    one-line-per-site table only

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDataset } from '../site/engine/load.js';
import { runPipeline } from '../site/engine/narrow.js';
import { renderMemo } from '../site/engine/memo.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const raw = JSON.parse(readFileSync(resolve(root, flag('data', 'site/data/sites.json')), 'utf8'));
const rubric = JSON.parse(
  readFileSync(resolve(root, flag('rubric', 'site/rubric/rubric_v0_1.json')), 'utf8'),
);

const { sites, providers, warnings, status } = loadDataset(raw);

const weights = {
  regulatory: Number(flag('reg', 0.4)),
  cost: Number(flag('cost', 0.35)),
  community: Number(flag('comm', 0.25)),
};

const started = Date.now();
const result = runPipeline({ sites, rubric, weights, providers });
const elapsed = Date.now() - started;

if (status) console.error(`dataset status: ${status}`);
for (const w of warnings) console.error(`warning: ${w}`);
console.error(`pipeline: ${sites.length} sites in ${elapsed} ms`);

const pct = (x) => `${(x * 100).toFixed(0)}%`;

if (has('summary')) {
  const s = result.stages;
  console.log(
    `\nweights  reg=${pct(result.weights.regulatory)} cost=${pct(result.weights.cost)} comm=${pct(result.weights.community)}`,
  );
  console.log(
    `stages   candidates=${s.candidates.length} shortlist=${s.shortlist.length} ` +
      `excluded=${s.excluded.length} held=${s.held.length} narrowed=${s.narrowed.length}`,
  );
  console.log('');
  console.log('rank site       name                 total ceil   reg  cost  comm  compl front  r1%');
  for (const r of result.ranked) {
    const d = result.sites[r.site_id];
    console.log(
      `${String(r.rank).padStart(4)} ${r.site_id.padEnd(10)} ${d.name.padEnd(20)} ` +
        `${r.total.toFixed(1).padStart(5)} ${r.totalOptimistic.toFixed(1).padStart(5)} ` +
        `${d.criteria.regulatory.pessimistic.toFixed(0).padStart(4)} ` +
        `${d.criteria.cost.pessimistic.toFixed(0).padStart(5)} ` +
        `${d.criteria.community.pessimistic.toFixed(0).padStart(5)} ` +
        `${pct(d.completeness).padStart(6)} ${(d.onFrontier ? 'yes' : 'no').padStart(5)} ` +
        `${pct(d.rank1Share).padStart(5)}`,
    );
  }
  for (const id of result.stages.excluded) {
    const d = result.sites[id];
    console.log(
      `   - ${id.padEnd(10)} ${d.name.padEnd(20)} EXCLUDED: ${d.blockers.map((b) => b.label).join('; ')}`,
    );
  }
  for (const id of result.stages.held) {
    const d = result.sites[id];
    console.log(
      `   ? ${id.padEnd(10)} ${d.name.padEnd(20)} HELD: ${d.unverified.map((b) => b.label).join('; ')}`,
    );
  }
  console.log('');
  console.log(`narrowed  ${result.stages.narrowed.join(', ') || 'none'}`);
  console.log(`frontier  ${result.frontier.join(', ') || 'none'}`);
  console.log(
    `flip      ${
      result.flip.margin === null
        ? 'none at this resolution'
        : `${(result.flip.margin * 100).toFixed(1)} pts of weight -> ${result.flip.challenger}`
    }`,
  );
  console.log(
    `topsis    leader=${result.topsisLeader} agrees=${result.topsisAgrees}`,
  );
} else {
  const memo = renderMemo(result, {});
  const out = flag('out', null);
  if (out) {
    writeFileSync(resolve(root, out), memo);
    console.error(`memo written to ${out}`);
  } else {
    console.log(memo);
  }
}
