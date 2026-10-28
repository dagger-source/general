# Earthshaker V1.0

Advisory screening for shortlisted data center sites. Takes 5–20 candidate
parcels with upstream profiles and returns a ranked, explainable recommendation
across **Regulatory risk**, **Cost**, and **Community & environmental impact**.

The tool advises. It does not decide, it does not find sites, it does not
generate profiles, and it does not establish feasibility.

> **This build runs entirely on demo data.** Every parcel, profile field, and
> evidence value in `site/data/sites.json` is fictional. Coordinates are
> arbitrary placeholders. No imagery and no external dataset was consulted.

## Deploy

The dashboard is static — no build step, no dependencies, no API keys, no
third-party network calls.

**Netlify drag-and-drop:** upload `earthshaker-v1.0.zip` (contains `index.html`
at its root) to the Netlify deploy drop zone.

**Netlify from git:** already configured. `netlify.toml` publishes `site/`.

**Locally:** the page loads ES modules and JSON over `fetch`, so it needs an
HTTP server. Opening `index.html` from disk will not work.

```bash
cd site && python3 -m http.server 8777
```

## Headless run

Same engine as the dashboard, no browser:

```bash
node tools/run.mjs --summary
```

```bash
node tools/run.mjs --reg 0.25 --cost 0.25 --comm 0.5 --out memo.md
```

## Tests

```bash
node --test tests/
```

## Layout

```
site/
  index.html  styles.css  app.js     dashboard (rendering + input only)
  engine/                            all scoring logic, runs in Node and browser
    provenance.js   value tags, weakest-wins combination
    scorers.js      categorical / linear factor scorers
    evidence.js     EvidenceProvider interface, geometry + mock providers
    constraints.js  hard screening, three-way pass/fail/unknown
    scoring.js      criterion scores, pessimistic + optimistic + completeness
    aggregate.js    weighted sum, TOPSIS, Pareto, Monte Carlo, flip margin
    narrow.js       the four-stage narrowing pipeline
    memo.js         Markdown decision memo
    load.js         dataset validation and loading
  rubric/rubric_v0_1.json            the versioned, written rubric
  data/sites.json                    DEMO FIXTURE — replace with real data
tools/run.mjs                        headless runner
SPEC.md                              what increment 1 is supposed to do
```

## How it narrows

1. **Candidates** — everything supplied.
2. **Shortlist** — passes every hard constraint. Screened *before* scoring, so
   no weighting can rescue an excluded site.
3. **Narrowed** — on the Pareto frontier *and* either within 10 points of the
   leader or leading in ≥5% of sensitivity runs.
4. **Leading candidate** — top of the weighted sum, reported with how easily it
   flips.

Moving the sliders only moves steps 3 and 4.

## Data integrity rules, enforced in code

- **Missing data never helps.** Reported scores are pessimistic: an unknown
  factor contributes zero. The optimistic ceiling is carried alongside, and
  completeness is reported separately from suitability.
- **An unchecked constraint is not a satisfied one.** A hard constraint whose
  input is missing returns `unknown` and *holds* the site. It never passes.
- **Provenance is weakest-wins.** A value derived from a mocked input is itself
  mocked, so demo data cannot launder itself into looking measured.
- **Every score component traces to an input**, named with its provenance and
  source.
- **Capacity is never inferred.** Proximity to transmission infrastructure is
  deliberately absent from the rubric — it is evidence of nearby infrastructure
  only, never of available interconnection capacity.
- **Legal status needs the issuing authority.** Zoning, protected-area
  designation, water rights, and tax abatements are flagged as not answerable
  from imagery at any resolution.

## Swapping in real data

Replace `site/data/sites.json` with real parcels and upstream profiles, keeping
the shape documented in `SPEC.md`. To replace the mocked evidence, implement the
`evidenceFor(parcel)` interface in `site/engine/evidence.js` — scoring does not
change. The rubric is data, not code: edit `site/rubric/rubric_v0_1.json` and
bump its `version`, which is stamped on every memo.

## Not in this build

Site search, profile generation, live imagery, real vector datasets, VLM
evidence extraction, the historical backtest, and user accounts. See `SPEC.md`.
