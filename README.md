# AutoPort — Operations Dashboard

Internal dealership operations dashboard for AutoPort Denver.
Connects to Google Drive via Cowork MCP for live data.

## Local Development

**Requirements:** Python 3.x, Git

```bash
python serve.py        # starts http://localhost:8000
python serve.py 9000   # custom port
```

## Data Sources

All CSV/Excel/PDF data files live in Google Drive.
The `src/uploads/` directory is excluded from this repo (see `.gitignore`).
Configure Drive folder IDs in `src/js/config.js`.

## Project Structure
src/
assets/     # static assets (logo, icons) — committed to repo
css/        # stylesheet
js/         # application logic
pages/    # one file per dashboard tab

## Deployment

Hosted on GitHub Pages. Push to `main` to deploy.