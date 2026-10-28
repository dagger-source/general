// Earthshaker V1.0 — dashboard wiring.
//
// All scoring lives in ./engine/. This file only renders it and handles input,
// so the engine stays testable in Node and swappable for a real data pipeline.

import { loadDataset } from './engine/load.js';
import { runPipeline } from './engine/narrow.js';
import { renderMemo, siteFlags } from './engine/memo.js';
import { PROVENANCE_LABEL } from './engine/provenance.js';
import { CRITERIA } from './engine/aggregate.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const num = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v).replace(/_/g, ' ');
};

const CRIT_LABEL = { regulatory: 'Regulatory', cost: 'Cost', community: 'Community' };
const STAGE_LABEL = {
  leader: 'Leading',
  narrowed: 'Narrowed',
  shortlist: 'Shortlist',
  held: 'Held',
  excluded: 'Excluded',
};

const state = {
  raw: null,
  rubric: null,
  sites: [],
  providers: [],
  weights: { regulatory: 40, cost: 35, community: 25 },
  selected: null,
  compare: new Set(),
  tab: 'detail',
  result: null,
  elapsed: 0,
};

/* ── boot ────────────────────────────────────────────────── */

async function boot() {
  try {
    const [raw, rubric] = await Promise.all([
      fetch('data/sites.json').then((r) => r.json()),
      fetch('rubric/rubric_v0_1.json').then((r) => r.json()),
    ]);
    state.raw = raw;
    state.rubric = rubric;
    const ds = loadDataset(raw);
    state.sites = ds.sites;
    state.providers = ds.providers;

    $('#meta-rubric').textContent = rubric.version;
    $('#meta-dataset').textContent = `${ds.sites.length} sites`;
    $('#foot-notice').textContent = raw.notice || '';

    if (raw.status && /demo/i.test(raw.status)) {
      $('#demo-banner').hidden = false;
      $('#demo-banner-text').textContent =
        'Every value shown below is fictional demo data. No parcel here is a real parcel, ' +
        'coordinates are arbitrary placeholders, and no imagery or external dataset was ' +
        'consulted. Not usable for a siting decision.';
    }

    wireEvents();
    recompute();
  } catch (err) {
    document.querySelector('.layout').innerHTML =
      `<section class="panel"><div class="note note--warn">Could not load the dataset: ${esc(err.message)}
       <br><br>This page must be served over HTTP. Opening <code>index.html</code> straight from
       disk blocks module and JSON loading. Run <code>python3 -m http.server</code> in this
       folder, or deploy it.</div></section>`;
  }
}

function wireEvents() {
  for (const input of document.querySelectorAll('[data-slider]')) {
    input.addEventListener('input', () => {
      state.weights[input.dataset.slider] = Number(input.value);
      recompute();
    });
  }
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      const [r, c, m] = btn.dataset.preset.split(',').map(Number);
      state.weights = { regulatory: r, cost: c, community: m };
      for (const input of document.querySelectorAll('[data-slider]')) {
        input.value = state.weights[input.dataset.slider];
      }
      recompute();
    });
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t === tab);
      for (const key of ['detail', 'compare', 'sensitivity']) {
        $(`#tab-${key}`).hidden = key !== state.tab;
      }
      renderPanes();
    });
  }
  $('#btn-memo').addEventListener('click', downloadMemo);
}

let pending = false;
function recompute() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const t0 = performance.now();
    state.result = runPipeline({
      sites: state.sites,
      rubric: state.rubric,
      weights: state.weights,
      providers: state.providers,
    });
    state.elapsed = performance.now() - t0;
    if (!state.selected || !state.result.sites[state.selected]) {
      state.selected = state.result.leader?.site_id ?? state.result.stages.candidates[0] ?? null;
    }
    render();
  });
}

/* ── render ──────────────────────────────────────────────── */

function stageOf(id) {
  const r = state.result;
  const d = r.sites[id];
  if (r.leader?.site_id === id) return 'leader';
  if (d.inNarrowed) return 'narrowed';
  return d.stage;
}

function render() {
  const r = state.result;
  const w = r.weights;

  for (const key of CRITERIA) {
    document.querySelector(`[data-out="${key}"]`).textContent = pct(w[key]);
  }
  $('#meta-timing').textContent = `${state.elapsed.toFixed(0)} ms`;

  renderFunnel();
  renderFormula();
  renderLegend();
  renderMap();
  renderRankTable();
  renderPanes();
}

function renderFunnel() {
  const s = state.result.stages;
  const o = state.result.options;
  const rows = [
    ['candidates', s.candidates.length, 'Candidates', 'Shortlist supplied by upstream work'],
    [
      'shortlist',
      s.shortlist.length,
      'Shortlist',
      `Passed every hard constraint — ${s.excluded.length} excluded, ${s.held.length} held`,
    ],
    [
      'narrowed',
      s.narrowed.length,
      'Narrowed',
      `Non-dominated and within ${o.narrowWithinPoints} pts of the leader, or leading ≥${pct(o.narrowMinShare)} of runs`,
    ],
    [
      'leader',
      state.result.leader ? 1 : 0,
      'Leading candidate',
      state.result.leader ? state.result.leader.name : 'none — no site passed screening',
    ],
  ];
  $('#funnel').innerHTML = rows
    .map(
      ([stage, n, lbl, sub]) =>
        `<li data-stage="${stage}"><span class="n">${n}</span><span><span class="lbl">${esc(lbl)}</span><br><span class="sub">${esc(sub)}</span></span></li>`,
    )
    .join('');
}

function renderFormula() {
  const w = state.result.weights;
  const ld = state.result.leader;
  let html = `total = ${CRITERIA.map((k) => `<b>${pct(w[k])}</b> × ${CRIT_LABEL[k]}`).join('<br>&nbsp;&nbsp;&nbsp;&nbsp;+ ')}`;
  if (ld) {
    html += `<br><br>${esc(ld.name)}:<br>`;
    html +=
      CRITERIA.map((k) => `&nbsp;&nbsp;${pct(w[k])} × ${num(ld.criteria[k].pessimistic)}`).join(' +<br>') +
      `<br>&nbsp;&nbsp;= <b>${num(ld.total)}</b> / 100`;
  }
  $('#formula').innerHTML = html;
}

function renderLegend() {
  const keys = ['leader', 'narrowed', 'shortlist', 'held', 'excluded'];
  $('#legend').innerHTML = keys
    .map(
      (k) =>
        `<span><i style="background:var(--${k})"></i>${esc(STAGE_LABEL[k])}</span>`,
    )
    .join('');
}

/* ── schematic map ───────────────────────────────────────── */

function renderMap() {
  const r = state.result;
  const svg = $('#map');
  const ids = r.stages.candidates;

  const pts = [];
  for (const id of ids) {
    const d = r.sites[id];
    for (const g of [d.geometry, d.buffer]) {
      if (!g) continue;
      for (const ring of g.coordinates) for (const p of ring) pts.push(p);
    }
  }
  if (!pts.length) return;

  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  const W = 820, PAD = 26;
  const spanX = (maxLon - minLon) * kx;
  const spanY = maxLat - minLat;
  const scale = (W - PAD * 2) / spanX;
  const H = Math.round(spanY * scale + PAD * 2 + 26);

  const px = (lon) => PAD + (lon - minLon) * kx * scale;
  const py = (lat) => H - 26 - PAD - (lat - minLat) * scale;
  const path = (g) =>
    g.coordinates
      .map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join('') + 'Z')
      .join('');

  const parts = [];
  // buffers first so parcels sit on top
  for (const id of ids) {
    const d = r.sites[id];
    if (!d.buffer) continue;
    const st = stageOf(id);
    parts.push(
      `<path class="buffer" d="${path(d.buffer)}" fill="var(--${st})" stroke="var(--${st})"/>`,
    );
  }
  for (const id of ids) {
    const d = r.sites[id];
    const st = stageOf(id);
    const sel = id === state.selected ? ' is-selected' : '';
    parts.push(
      `<path class="parcel${sel}" d="${path(d.geometry)}" fill="var(--${st})" fill-opacity="${
        st === 'excluded' || st === 'held' ? 0.3 : 0.75
      }" stroke="var(--${st})" data-id="${esc(id)}"><title>${esc(d.name)} — ${esc(
        STAGE_LABEL[st],
      )}</title></path>`,
    );
    const c = d.geometry.coordinates[0];
    const cx = c.reduce((s, p) => s + px(p[0]), 0) / c.length;
    const cy = c.reduce((s, p) => s + py(p[1]), 0) / c.length;
    if (d.rank) parts.push(`<text class="map-rank" x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}">${d.rank}</text>`);
    parts.push(
      `<text class="map-label" x="${cx.toFixed(1)}" y="${(cy + 19).toFixed(1)}" text-anchor="middle">${esc(d.name)}</text>`,
    );
  }

  // 2 km scale bar, measured in the same projection
  const metresPerDegLat = 111320;
  const barM = 2000;
  const barPx = (barM / metresPerDegLat) * scale;
  const by = H - 14;
  parts.push(
    `<line class="scalebar" x1="${PAD}" y1="${by}" x2="${PAD + barPx}" y2="${by}"/>`,
    `<line class="scalebar" x1="${PAD}" y1="${by - 4}" x2="${PAD}" y2="${by + 4}"/>`,
    `<line class="scalebar" x1="${PAD + barPx}" y1="${by - 4}" x2="${PAD + barPx}" y2="${by + 4}"/>`,
    `<text class="scalebar-text" x="${PAD + barPx + 7}" y="${by + 3}">2 km</text>`,
  );

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = parts.join('');
  for (const node of svg.querySelectorAll('.parcel')) {
    node.addEventListener('click', () => {
      state.selected = node.dataset.id;
      state.tab = 'detail';
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.tab === 'detail');
      for (const key of ['detail', 'compare', 'sensitivity']) $(`#tab-${key}`).hidden = key !== 'detail';
      render();
    });
  }

  $('#map-note').textContent =
    'Schematic only — no basemap and no satellite imagery. The demo coordinates are ' +
    'arbitrary placeholders, so drawing them over a real map would imply real places are ' +
    'under consideration. Dashed outlines are the 2 km screening buffer.';
}

/* ── ranked table ────────────────────────────────────────── */

function renderRankTable() {
  const r = state.result;
  const head =
    '<thead><tr><th>#</th><th>Site</th><th class="num">Total</th><th class="num">Reg</th>' +
    '<th class="num">Cost</th><th class="num">Comm</th><th>Complete</th><th>Stage</th>' +
    '<th class="num">Rank-1</th><th>Cmp</th></tr></thead>';

  const rows = r.ranked.map((row) => {
    const d = r.sites[row.site_id];
    const st = stageOf(row.site_id);
    const low = d.completeness < 0.95;
    return `<tr data-id="${esc(row.site_id)}" class="${row.site_id === state.selected ? 'is-selected' : ''}">
      <td class="num">${row.rank}</td>
      <td><strong>${esc(d.name)}</strong><br><span class="card__sub">${esc(row.site_id)}</span></td>
      <td class="num"><span class="total">${num(row.total)}</span>${
        row.totalOptimistic - row.total > 0.05
          ? `<br><span class="ceiling">↑${num(row.totalOptimistic)}</span>`
          : ''
      }</td>
      <td class="num">${num(d.criteria.regulatory.pessimistic, 0)}</td>
      <td class="num">${num(d.criteria.cost.pessimistic, 0)}</td>
      <td class="num">${num(d.criteria.community.pessimistic, 0)}</td>
      <td><span class="meter"><span class="meter__bar"><span class="meter__fill${
        low ? ' is-low' : ''
      }" style="width:${(d.completeness * 100).toFixed(0)}%"></span></span><span class="meter__txt">${pct(
        d.completeness,
      )}</span></span></td>
      <td><span class="badge badge--${st}">${esc(STAGE_LABEL[st])}</span></td>
      <td class="num">${pct(d.rank1Share)}</td>
      <td><input type="checkbox" data-cmp="${esc(row.site_id)}" ${
        state.compare.has(row.site_id) ? 'checked' : ''
      }></td>
    </tr>`;
  });

  const outRows = [...r.stages.excluded, ...r.stages.held].map((id) => {
    const d = r.sites[id];
    const st = d.stage;
    const why =
      st === 'excluded'
        ? d.blockers.map((b) => `${b.label}: ${fmt(b.value)} (${b.requirement})`).join('; ')
        : d.unverified.map((b) => `${b.label}: no value for ${b.input}`).join('; ');
    return `<tr data-id="${esc(id)}" class="is-out ${id === state.selected ? 'is-selected' : ''}">
      <td class="num">—</td>
      <td><strong>${esc(d.name)}</strong><br><span class="card__sub">${esc(id)}</span></td>
      <td colspan="5" class="wrap" style="white-space:normal">${esc(why)}</td>
      <td><span class="badge badge--${st}">${esc(STAGE_LABEL[st])}</span></td>
      <td class="num">—</td><td></td>
    </tr>`;
  });

  $('#rank-table').innerHTML = head + '<tbody>' + rows.join('') + outRows.join('') + '</tbody>';
  $('#rank-note').textContent = `${r.ranked.length} ranked · ${r.stages.excluded.length} excluded · ${r.stages.held.length} held`;

  for (const tr of document.querySelectorAll('#rank-table tbody tr')) {
    tr.addEventListener('click', (e) => {
      if (e.target.matches('[data-cmp]')) return;
      state.selected = tr.dataset.id;
      render();
    });
  }
  for (const box of document.querySelectorAll('[data-cmp]')) {
    box.addEventListener('change', () => {
      const id = box.dataset.cmp;
      if (box.checked) {
        if (state.compare.size >= 4) {
          box.checked = false;
          return;
        }
        state.compare.add(id);
      } else state.compare.delete(id);
      $('#compare-count').textContent = state.compare.size ? `(${state.compare.size})` : '';
      renderPanes();
    });
  }
  $('#compare-count').textContent = state.compare.size ? `(${state.compare.size})` : '';
}

/* ── panes ───────────────────────────────────────────────── */

function renderPanes() {
  if (state.tab === 'detail') renderDetail();
  if (state.tab === 'compare') renderCompare();
  if (state.tab === 'sensitivity') renderSensitivity();
}

function provSpan(p) {
  const cls = p === 'mock' ? ' prov--mock' : p === 'unknown' ? ' prov--unknown' : '';
  return `<span class="prov${cls}">${esc(PROVENANCE_LABEL[p] || p)}</span>`;
}

function factorTable(c) {
  const rows = c.factors
    .map(
      (f) => `<tr class="${f.missing ? 'is-missing' : ''}">
      <td class="wrap">${esc(f.label)}${f.imagery_can_verify ? '' : ' <span title="not answerable from imagery">◌</span>'}</td>
      <td class="num">${fmt(f.value)}</td>
      <td>${provSpan(f.provenance)}</td>
      <td class="num">${f.missing ? '—' : num(f.score, 0)}</td>
      <td class="num">${f.weight}</td>
      <td class="num">${f.missing ? '<em>0</em>' : num(f.contribution)}</td>
    </tr>`,
    )
    .join('');
  return `<table class="factors"><thead><tr><th>Factor</th><th class="num">Value</th><th>Source</th>
    <th class="num">Score</th><th class="num">Wt</th><th class="num">Contrib</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderDetail() {
  const r = state.result;
  const d = r.sites[state.selected];
  if (!d) {
    $('#tab-detail').innerHTML = '<p class="empty">Select a site on the map or in the table.</p>';
    return;
  }
  const st = stageOf(d.site_id);
  const L = [];

  L.push(`<div class="card">
    <div class="card__row">
      <div><h3>${esc(d.name)}</h3><span class="card__sub">${esc(d.site_id)}</span></div>
      <span class="badge badge--${st}">${esc(STAGE_LABEL[st])}</span>
    </div>`);

  if (d.stage === 'shortlist') {
    L.push(`<div class="card__row" style="margin-top:10px">
      <div class="bigscore">${num(d.total)}<small> / 100</small></div>
      <dl class="kv">
        <dt>Rank</dt><dd>${d.rank} of ${r.ranked.length}</dd>
        <dt>Ceiling</dt><dd>${num(d.totalOptimistic)}</dd>
        <dt>Completeness</dt><dd>${pct(d.completeness)}</dd>
        <dt>Non-dominated</dt><dd>${d.onFrontier ? 'yes' : 'no'}</dd>
        <dt>Rank-1 share</dt><dd>${pct(d.rank1Share)}</dd>
      </dl>
    </div>`);
    if (d.totalOptimistic - d.total > 0.05) {
      L.push(`<div class="note note--warn">Unknowns cost this site up to
        ${num(d.totalOptimistic - d.total)} points. The reported score assumes every
        unknown resolves unfavorably, so missing data never flatters it.</div>`);
    }
  } else if (d.stage === 'excluded') {
    L.push(`<div class="note note--warn"><strong>Excluded by hard constraint.</strong>
      Not ranked, and no weighting can bring it back.</div>`);
  } else {
    L.push(`<div class="note note--warn"><strong>Held for verification.</strong>
      A hard constraint could not be evaluated because its input is missing. It is
      held rather than passed — an unchecked constraint is not a satisfied one.</div>`);
  }
  L.push('</div>');

  // constraints
  L.push('<div class="card"><h4>Hard constraints</h4><ul class="constraints">');
  for (const c of d.constraints) {
    const mark = c.outcome === 'pass' ? '✓' : c.outcome === 'fail' ? '✕' : '?';
    L.push(`<li><span class="mark mark--${c.outcome}">${mark}</span>
      <span>${esc(c.label)} — ${fmt(c.value)}
      <span class="req">${esc(c.requirement)} · ${esc(c.rationale)}</span></span></li>`);
  }
  L.push('</ul></div>');

  // criteria
  L.push('<div class="card"><h4>Score components</h4>');
  for (const key of CRITERIA) {
    const c = d.criteria[key];
    L.push(`<div class="crit">
      <div class="crit__head"><span class="crit__name">${esc(c.label)}</span>
      <span class="crit__score">${num(c.pessimistic)} <span class="prov">× ${pct(r.weights[key])} = ${num(
        r.weights[key] * c.pessimistic,
      )}</span></span></div>
      <p class="crit__desc">${esc(c.description)} Completeness ${pct(c.completeness)}.</p>
      ${factorTable(c)}
    </div>`);
  }
  L.push('</div>');

  // flags
  const flags = siteFlags(d, 5);
  L.push('<div class="card"><h4>Top flags</h4><ul class="flaglist">');
  if (!flags.length) L.push('<li><span class="kind">—</span><span>No flags.</span></li>');
  for (const f of flags) {
    L.push(`<li><span class="kind kind--${f.kind}">${esc(f.kind)}</span><span>${esc(f.text)}</span></li>`);
  }
  L.push('</ul>');

  // unknowns
  L.push('<h4>Needs verification</h4>');
  if (!d.missing.length && !d.unverified.length) {
    L.push('<p class="hint">Every rubric input has a value. Provenance still applies.</p>');
  } else {
    L.push('<ul class="flaglist">');
    for (const c of d.unverified) {
      L.push(`<li><span class="kind kind--unverified">blocking</span><span><code>${esc(
        c.input,
      )}</code> — ${esc(c.label)}, ${esc(c.requirement)}</span></li>`);
    }
    for (const f of d.missing) {
      L.push(`<li><span class="kind kind--missing">missing</span><span><code>${esc(f.input)}</code> — ${esc(
        f.criterion_label,
      )} / ${esc(f.label)}, costs ${num(f.weight * 100)} pts of ${esc(f.criterion_label)}</span></li>`);
    }
    L.push('</ul>');
  }

  L.push(`<h4>Not answerable from imagery</h4><ul class="flaglist">`);
  for (const f of d.imageryBlind) {
    L.push(`<li><span class="kind kind--weak">${esc(f.criterion)}</span><span>${esc(
      f.label,
    )} — ${esc(f.verification_note || '')}</span></li>`);
  }
  L.push('</ul>');
  L.push(`<div class="note note--demo">Proximity to transmission lines or a substation is
    deliberately absent from this rubric. It would be evidence of nearby infrastructure
    only — never of available interconnection capacity, which requires a utility study.</div>`);
  L.push('</div>');

  $('#tab-detail').innerHTML = L.join('');
}

function renderCompare() {
  const r = state.result;
  const ids = [...state.compare];
  if (!ids.length) {
    $('#tab-compare').innerHTML =
      '<p class="empty">Tick up to four sites in the ranked table to compare them side by side.</p>';
    return;
  }
  const ds = ids.map((id) => r.sites[id]);
  const col = (fn) => ds.map((d) => `<td class="num">${fn(d)}</td>`).join('');

  const L = ['<div class="card"><h4>Side by side</h4><table class="factors"><thead><tr><th></th>'];
  for (const d of ds) L.push(`<th class="num">${esc(d.name)}</th>`);
  L.push('</tr></thead><tbody>');
  L.push(`<tr><td>Stage</td>${ds
    .map((d) => `<td class="num"><span class="badge badge--${stageOf(d.site_id)}">${esc(STAGE_LABEL[stageOf(d.site_id)])}</span></td>`)
    .join('')}</tr>`);
  L.push(`<tr><td><strong>Total</strong></td>${col((d) => (d.total == null ? '—' : `<strong>${num(d.total)}</strong>`))}</tr>`);
  L.push(`<tr><td>Ceiling</td>${col((d) => num(d.totalOptimistic))}</tr>`);
  L.push(`<tr><td>Rank</td>${col((d) => d.rank ?? '—')}</tr>`);
  L.push(`<tr><td>Completeness</td>${col((d) => pct(d.completeness))}</tr>`);
  L.push(`<tr><td>Rank-1 share</td>${col((d) => (d.rank1Share == null ? '—' : pct(d.rank1Share)))}</tr>`);
  for (const key of CRITERIA) {
    L.push(`<tr><td><strong>${esc(CRIT_LABEL[key])}</strong></td>${col((d) => `<strong>${num(d.criteria[key].pessimistic)}</strong>`)}</tr>`);
    const defs = state.rubric.criteria[key].factors;
    for (let i = 0; i < defs.length; i++) {
      L.push(
        `<tr><td style="padding-left:16px">${esc(defs[i].label)}</td>${ds
          .map((d) => {
            const f = d.criteria[key].factors[i];
            return `<td class="num">${f.missing ? '<em>unknown</em>' : fmt(f.value)}<br><span class="prov">${
              f.missing ? '' : num(f.score, 0)
            }</span></td>`;
          })
          .join('')}</tr>`,
      );
    }
  }
  L.push('</tbody></table></div>');

  L.push('<div class="card"><h4>Flags by site</h4>');
  for (const d of ds) {
    L.push(`<h4 style="margin-top:10px">${esc(d.name)}</h4><ul class="flaglist">`);
    for (const f of siteFlags(d, 3)) {
      L.push(`<li><span class="kind kind--${f.kind}">${esc(f.kind)}</span><span>${esc(f.text)}</span></li>`);
    }
    L.push('</ul>');
  }
  L.push('</div>');
  $('#tab-compare').innerHTML = L.join('');
}

function renderSensitivity() {
  const r = state.result;
  const o = r.options;
  const L = [];

  L.push(`<div class="card"><h4>How stable is the ranking?</h4>`);
  if (!r.ranked.length) {
    L.push('<p class="empty">Nothing ranked.</p></div>');
    $('#tab-sensitivity').innerHTML = L.join('');
    return;
  }

  const f = r.flip;
  if (f.margin === null) {
    L.push(`<p>The leader holds across every weighting tested, at ${f.resolution} grid
      resolution. No reweighting changes the top pick.</p>`);
  } else {
    L.push(`<p>Shifting <strong>${num(f.margin * 100)} points of weight</strong> between
      criteria changes the top pick to <code>${esc(f.challenger)}</code>
      (${esc(r.sites[f.challenger]?.name ?? '')}). Grid resolution ${f.resolution}.</p>`);
    if (f.margin * 100 < 10) {
      L.push(`<div class="note note--warn">The lead is narrow. Treat the top two or three
        as a tie and decide between them on the evidence, not the score.</div>`);
    }
  }

  L.push(`<h4>Rank-1 share — weights perturbed ±${pct(o.jitter)} relative, ${o.runs} runs, seed ${o.seed}</h4>`);
  L.push('<div class="barlist">');
  const shares = r.ranked.map((row) => [row.site_id, r.monteCarlo[row.site_id] ?? 0]);
  for (const [id, share] of shares) {
    L.push(`<div class="barlist__row"><span>${esc(r.sites[id].name)}</span>
      <span class="barlist__track"><span class="barlist__fill" style="width:${(share * 100).toFixed(1)}%"></span></span>
      <span class="barlist__val">${pct(share)}</span></div>`);
  }
  L.push('</div>');
  L.push(`<div class="note">These two measures answer different questions. The rank-1 share
    asks how the leader holds up to small wobble <em>around the current weights</em>. The flip
    margin asks how far you would have to move <em>anywhere</em> on the weight simplex to change
    the answer. A site can hold 100% of the first and still have a narrow second.</div>`);
  L.push('</div>');

  L.push(`<div class="card"><h4>Pareto frontier</h4>
    <p class="hint">Sites that nothing else beats on all three criteria at once. These are the
    only defensible choices; anything off the frontier is beaten outright by something on it.</p>
    <ul class="flaglist">`);
  for (const id of r.frontier) {
    const d = r.sites[id];
    L.push(`<li><span class="kind kind--weak">${esc(id)}</span><span>${esc(d.name)} —
      Reg ${num(d.criteria.regulatory.pessimistic, 0)}, Cost ${num(d.criteria.cost.pessimistic, 0)},
      Comm ${num(d.criteria.community.pessimistic, 0)}</span></li>`);
  }
  L.push('</ul>');
  const off = r.ranked.filter((x) => !r.frontier.includes(x.site_id));
  if (off.length) {
    L.push(`<p class="hint">Dominated: ${off.map((x) => esc(x.site_id)).join(', ')}</p>`);
  }
  L.push('</div>');

  L.push(`<div class="card"><h4>Cross-check — TOPSIS</h4>`);
  if (r.topsisAgrees) {
    L.push(`<p>TOPSIS, run independently of the weighted sum, also puts
      <code>${esc(r.topsisLeader)}</code> first. The two methods agree.</p>`);
  } else {
    L.push(`<div class="note note--warn">TOPSIS favors <code>${esc(r.topsisLeader)}</code>
      while the weighted sum favors <code>${esc(r.ranked[0].site_id)}</code>. When the two
      disagree the gap is within the noise of the method — treat them as tied.</div>`);
  }
  L.push('</div>');

  $('#tab-sensitivity').innerHTML = L.join('');
}

/* ── memo export ─────────────────────────────────────────── */

function downloadMemo() {
  const md = renderMemo(state.result, { generated: new Date().toISOString() });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `earthshaker-memo-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

boot();
