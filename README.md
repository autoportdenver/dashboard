# AutoPort Operations Dashboard (view-only)

A lightweight, read-only operations dashboard published as a static site on
GitHub Pages. It gives the team three at-a-glance views:

- **Reports Status** — which data feeds have run, and how recent each one is
- **Tasks** — items automatically flagged from the latest data (deals & inventory)
- **Titles** — title items that need attention

The published page is a single self-contained `index.html`: the CSS, JavaScript,
and logo are all inlined and the data is baked in at build time. It makes no
external network calls and needs no server or database to view.

## How it works

The dashboard uses a **snapshot** model. A private source workbook is the system
of record; a small pipeline turns the relevant parts of it into two JSON files,
bakes them into the page, and publishes the result:

```
source workbook  (private; lives on Google Drive)
      │   make_json.py      reads the workbook (read-only, no write-back)
      ▼
data/reports.json  +  data/flags.json
      │   build_viewonly.py  inlines the data, logo, and styles
      ▼
index.html   ──►   GitHub Pages
```

Each step is small and independent. `make_json.py` only ever *reads* the source
and emits the two JSON files; `build_viewonly.py` turns those into the deployable
page. Because everything is inlined, the finished `index.html` works offline.

## Automation

The GitHub Actions workflow `.github/workflows/publish-wif.yml` runs on a
schedule (and on demand): it fetches the workbook, regenerates the data, rebuilds
the page, and deploys it to GitHub Pages. Authentication to Google Drive is
**keyless**, via Workload Identity Federation — no credentials or keys are stored
in the repository. The one-time Google Cloud / Workload Identity setup is
maintained separately by the operator.

## Repository layout

```
.github/workflows/publish-wif.yml   automated build + deploy
assets/logo.png                     dashboard logo (inlined at build)
build/make_json.py                  workbook  ->  reports.json + flags.json
build/build_viewonly.py             data + logo + CSS  ->  index.html
ci/fetch_drive_file.py              downloads the workbook during CI
```

Generated files (`index.html`, `data/*.json`) and the private source workbook are
intentionally **not** committed — the build produces them fresh. See `.gitignore`.

## Building locally

With Python 3 and your own copy of the source workbook:

```bash
pip install openpyxl
python build/make_json.py --workbook "/path/to/workbook.xlsx" --out data
python build/build_viewonly.py            # writes index.html
```

Then open `index.html` in any browser. `make_json.py` reads the workbook's cached
values by default; add `--recalc` to have LibreOffice recompute formulas first, if
the workbook's cached values may be stale.

## A note on visibility

The published site is public. This view-only build intentionally leaves out
financial figures (P&L, balances, cash flow). It does show operational details
such as stock numbers and vehicle descriptions, so keep that in mind when sharing
the URL.
