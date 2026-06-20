# AutoPort — Operations Dashboard

Internal dealership operations dashboard for AutoPort Denver.
Authenticates with Google via OAuth (GIS) and reads all data directly from Google Drive.

## Local Development

**Requirements:** Python 3.x, Git

```bash
python serve.py        # starts http://localhost:8000
python serve.py 9000   # custom port
```

Open http://localhost:8000, click "Sign in with Google", and grant Drive access when prompted.

## Data Sources

All data is fetched live from Google Drive on sign-in — no local data files needed.
Drive folder and file IDs are configured in `src/js/config.js`.

Data files used:
- **Sales Log** (`Sales - Live.xlsx`) — units sold and gross profit per salesperson
- **Deal Detail**, **Itemized Costs**, **Deal Payments** — deal-level financials
- **Inventory Report** — active floor inventory
- **Title Report**, **DTS Reports** — title and delivery tracking
- **Accounting Package** — GL / cashflow data

## Project Structure

```
src/
  assets/   # logo.png, autoportimage.png — committed to repo
  css/      # stylesheet
  js/       # application logic
    pages/  # one file per dashboard tab
```

## Deployment

Hosted on GitHub Pages. Push to `main` to deploy.