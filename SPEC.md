# Site Screening Tool — Increment 1 Spec

Version: increment-1
Status: demo data only. No live imagery, no live datasets, no network calls.

## Purpose

Take a shortlist of 5–20 candidate data center parcels that already have upstream
profiles, and return a ranked, explainable recommendation. The ranking minimizes
regulatory risk, cost, and harm to neighbors.

The tool advises. It does not decide, it does not search for sites, and it does
not generate profiles.

## Non-goals (increment 1)

- Site discovery or parcel generation.
- Profile generation.
- Real imagery, real vector datasets, real VLM calls, real Earth Engine calls.
- User accounts, persistence, model fine-tuning.

## Inputs

### Parcels (GeoJSON FeatureCollection)

Each feature must have:
- `properties.site_id` — unique string.
- `properties.name` — display string.
- `geometry` — Polygon or MultiPolygon, WGS84.

### Profiles (JSON, keyed by `site_id`)

Per site, every field is an object `{value, provenance, source, observed}` or
`null` if unknown:
- `land_cost_usd_per_acre` (number)
- `power_cost_usd_per_mwh` (number)
- `interconnection_timeline_months` (number)
- `zoning_status` (one of `by_right`, `special_use_permit`, `rezoning_required`, `denied`)
- `tax_incentive_pct_capex` (number, 0–100)
- `water_availability` (one of `ample`, `adequate`, `constrained`, `none`)

A missing field is `null`. An absent key is equivalent to `null`.

### Weights

`{regulatory, cost, community}`, each >= 0, summing to 1.0 within 1e-6.

## Provenance

Every value in the system carries one of these tags, ordered from strongest to
weakest:

`measured` > `derived` > `profile_reported` > `vlm_inferred` > `estimated` > `mock` > `unknown`

When a value is computed from several inputs, its provenance is the **weakest**
of its inputs. A value whose provenance is `unknown` is missing.

`mock` means demo data. Any site, score, or memo containing a `mock` value must
be labeled as demo data in every surface that displays it.

## Evidence

`EvidenceProvider` is an interface with one method, `evidence_for(parcel) -> dict`
of named values. Increment 1 ships two implementations:

- `GeometryEvidenceProvider` — computes what the parcel geometry alone supports:
  `area_acres` (equal-area projection), and the 2 km buffer geometry. Provenance
  `derived`.
- `MockEvidenceProvider` — reads a fixture file for everything that would
  otherwise require imagery or external datasets. Provenance `mock`. Fields:
  `unbuildable_fraction`, `mean_slope_pct`, `protected_area_distance_m`,
  `wetland_overlap_pct`, `fema_floodway_overlap_pct`, `residences_within_1km`,
  `schools_within_1km`, `distance_nearest_residence_m`, `current_land_use`.

`developable_area_acres` is derived: `area_acres * (1 - unbuildable_fraction)`.
Its provenance is therefore `mock` while the mock provider supplies the fraction.

Providers must be swappable without changing scoring code.

## Hard constraints

Evaluated before scoring. Each constraint returns exactly one of three outcomes:

- `pass` — input present and satisfies the test.
- `fail` — input present and violates the test.
- `unknown` — input missing. **Never treated as a pass.**

A site with any `fail` is **excluded**. A site with no `fail` but one or more
`unknown` is **held**, in a separate bucket from sites that cleanly pass. Only
sites where every constraint passes form the shortlist.

## Scoring

Three criteria: `regulatory`, `cost`, `community`. Each scores 0–100, where
**higher is always better** (lower risk, lower cost, less harm to neighbors).

Each criterion has weighted factors. Each factor maps one input through a scorer
to 0–100:

- `categorical` — explicit value→score map.
- `linear_decay` — `best` scores 100, `worst` scores 0, linear between, clamped.
- `linear_gain` — the inverse.

Factor weights within a criterion must sum to 1.0.

### Missing factors

A factor whose input is missing produces no score. It does not get a default, a
neutral value, or a criterion average. Instead each criterion yields:

- `pessimistic` — missing factors contribute 0.
- `optimistic` — missing factors contribute 100.
- `completeness` — the share of factor weight that is known, 0–1.

The **reported** criterion score is the pessimistic one. The optimistic score is
carried alongside so the UI and memo can show a range. Completeness is reported
separately from suitability and never folded into the score.

If every factor in a criterion is missing, completeness is 0, pessimistic is 0,
optimistic is 100.

## Aggregation

- **Weighted sum** — `total = Σ criterion_weight × criterion_score`, computed
  separately for pessimistic and optimistic. Ranking uses pessimistic.
- **TOPSIS** — computed on the pessimistic criterion scores as a cross-check.
  Shown, not used for the headline ranking.
- **Pareto frontier** — a site is dominated if another site is >= on all three
  pessimistic criterion scores and > on at least one. The frontier is the set of
  non-dominated sites.
- **Weight sensitivity (Monte Carlo)** — perturb each weight by a uniform
  ±20% relative, renormalize to sum 1, repeat N times (default 2000, seeded).
  Report each site's share of runs at rank 1.
- **Flip margin** — the smallest total weight shift that changes the top-ranked
  site. Measured as half the L1 distance between the current weight vector and
  the nearest weight vector on the simplex with a different winner, found by grid
  search at a stated resolution. Reported with that resolution. If no grid point
  has a different winner, report `None`.

Only sites in the shortlist are ranked. Excluded and held sites are listed with
their reason and are never assigned a rank.

## Narrowing

The dashboard presents four nested stages:

1. **Candidates** — every site loaded.
2. **Shortlist** — candidates passing all hard constraints. Excluded and held
   sites shown separately with reasons.
3. **Narrowed** — shortlist sites that are on the Pareto frontier **and** either
   within 10 points of the leader's pessimistic total or hold rank 1 in at least
   5% of Monte Carlo runs.
4. **Leading candidate** — the top-ranked shortlist site, presented with its
   flip margin, Monte Carlo rank-1 share, and completeness.

Changing weights re-runs stages 3 and 4. Stage 2 does not depend on weights.

## Outputs

### Dashboard (static, no build step, no dependencies)

Plain HTML, CSS, and ES modules served as files. It must run from any static
host, including a Netlify drag-and-drop deploy, with no server, no API keys, and
no third-party network calls.

- Schematic map of parcels and 2 km buffers, colored by stage. **No basemap or
  satellite imagery in increment 1**: the demo coordinates are arbitrary
  placeholders, so drawing them over a real basemap would imply real places are
  being evaluated. The map is labeled schematic.
- Weight sliders for the three criteria, normalized to 1.
- Stage funnel showing counts at each stage.
- Ranked table linked to map selection.
- Site detail panel: criterion scores, every factor's contribution, the inputs
  and their provenance, constraint outcomes, missing-data list, completeness.
- Side-by-side comparison of selected sites.
- A demo-data banner whenever any displayed value is `mock`.

### Decision memo (Markdown download)

Generated client-side for the current weights: run metadata including rubric
version and weights, the stage funnel, the ranking table, criterion breakdown,
the Pareto frontier, sensitivity results, per-site top flags, and an explicit
**unknowns** list naming every missing input and every input that imagery cannot
verify.

## Module API

ES modules under `site/engine/`, importable unchanged in Node and the browser.

### `provenance.js`
- `PROVENANCE` — ordered strongest→weakest array of the seven tags.
- `val(value, provenance, {source, observed}) -> Value` where `Value` is
  `{value, provenance, source, observed}`.
- `UNKNOWN` — a `Value` with `value: null`, `provenance: 'unknown'`.
- `isMissing(v) -> boolean` — true when `v` is nullish, `v.value` is nullish, or
  `v.provenance === 'unknown'`.
- `weakest(...tags) -> tag`.
- `derive(values, fn, {source}) -> Value` — applies `fn` to the unwrapped values;
  returns `UNKNOWN` if any input is missing; provenance is `weakest` of inputs.

### `scorers.js`
- `applyScorer(cfg, value) -> number | null` — `null` when `value` is nullish or,
  for `categorical`, unmapped. Supports `categorical`, `linear_decay`,
  `linear_gain`. Numeric results are clamped to 0–100.

### `evidence.js`
- `geodesicAreaAcres(geometry) -> number` — Polygon and MultiPolygon, subtracting
  interior rings.
- `GeometryEvidenceProvider` / `MockEvidenceProvider` — each exposes
  `evidenceFor(parcelFeature) -> {key: Value}`.
- `buildInputs(site, providers) -> {key: Value}` — merges provider output with
  `profile.*` keys and adds derived `developable_area_acres`. Keys are namespaced
  `evidence.*` and `profile.*`.

### `constraints.js`
- `evaluateConstraints(inputs, rubric) -> [{id, label, outcome, input, value, provenance, rationale}]`
  with `outcome` in `pass | fail | unknown`.
- `classify(results) -> 'shortlist' | 'excluded' | 'held'`.

### `scoring.js`
- `scoreCriterion(criterionDef, inputs) -> {pessimistic, optimistic, completeness, factors}`
  where each factor is
  `{id, label, weight, input, value, provenance, source, score, missing, contribution}`.
  `contribution` is `weight * score` for present factors and `0` for missing ones.
- `scoreSite(rubric, inputs) -> {regulatory, cost, community}`.

### `aggregate.js`
- `weightedTotal(criterionScores, weights, mode) -> number`, `mode` in
  `pessimistic | optimistic`.
- `rankSites(scored, weights) -> [{site_id, total, totalOptimistic, rank, ...}]`
  sorted by descending pessimistic total; ties broken by `site_id` ascending.
- `topsis(scored, weights) -> {site_id: closeness}`.
- `paretoFrontier(scored) -> [site_id]`.
- `monteCarlo(scored, weights, {runs, jitter, seed}) -> {site_id: share}` — seeded
  and deterministic for a given seed.
- `flipMargin(scored, weights, {step}) -> {margin, resolution, challenger} | {margin: null, ...}`.

### `narrow.js`
- `runPipeline({sites, rubric, weights, options}) -> {stages, ranked, frontier, monteCarlo, flip, leader, demo}`
  where `stages` carries `candidates`, `shortlist`, `excluded`, `held`,
  `narrowed`, each an array of site ids, and `demo` is true when any input used
  is `mock`.

### `memo.js`
- `renderMemo(result, meta) -> string` — Markdown.

## Integrity requirements

These are testable requirements, not guidance.

1. No score component exists without a traceable input. Every factor
   contribution names its input key, value, provenance, and source.
2. Missing data never improves a site's reported score or total.
3. A missing hard-constraint input never produces a pass.
4. Grid capacity, queue position, and utility commitments are never inferred.
   They appear only if a profile reports them, labeled `profile_reported`.
5. Imagery-derived proximity to transmission infrastructure is never described
   as available capacity.
6. Any output containing a `mock` value is labeled as demo data.
7. The rubric version appears in every memo and on the dashboard.
