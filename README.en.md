[Русский](README.md) | **English** | [Español](README.es.md) | [Português](README.pt.md)

# SA-MP Pulse

Live player counts for SA-MP and open.mp servers. One page, 1200+ servers, 24 hour history, filters and search. No login, no ads, no build step.

**Live:** https://hilsetapp.github.io/samp-pulse/

## What it shows

- Online right now for every server: players and slots.
- Top 5 servers by players, plus a chart of total online for the day.
- History per server: how the population changed over the day.
- Filters by language, country and gamemode, search by name or IP.
- Favourites (kept in your browser) and one click copy of the IP.
- Direct link to a single server: `https://hilsetapp.github.io/samp-pulse/#s=IP:port`
  Example: `#s=127.0.0.1:7777` opens the card of that server.
- The page tries the live API first and falls back to the latest snapshot if the API is slow or blocked.

## Where the data comes from

1. The browser asks `api.open.mp/servers` for the current list.
2. A GitHub Action runs `tools/snapshot.py` every 15 minutes and commits the result to the `data` branch.
3. The site build copies that snapshot next to the page, so there is always a same origin copy: `live_min.json`, `servers.json`, `online-YYYY-MM.jsonl`, `meta.json`.
4. If the live API is not reachable (some providers block it), the page keeps working on the snapshot and says at the top when that snapshot was taken.

History is written as one line per 15 minutes, so over time the project builds its own open dataset of SA-MP online. The `data` branch is public.

## Run it locally

```
git clone https://github.com/hilsetapp/samp-pulse.git
cd samp-pulse
python -m http.server 8080
```

Open http://localhost:8080 . No npm, no bundler: plain HTML, CSS and JavaScript. Python is only needed for the snapshot tool.

Want demo data without waiting for a snapshot? Run `python tools/demo_seed.py` and it will write a set of demo files you can point the page at.

## Your own copy (fork)

1. Fork the repository.
2. Settings -> Pages -> Source: GitHub Actions.
3. Actions -> "snapshot" -> Run workflow. The first run fills the `data` branch and the site.
4. Your site will be at `https://YOUR-NAME.github.io/samp-pulse/`.

The workflow runs on a schedule and on every push, so a fork keeps updating itself.

## Structure

```
index.html              the page
js/app.js               all logic: fetch, fallback, filters, history, chart
tools/snapshot.py       takes the open.mp list and writes the data files
tools/demo_seed.py      generates demo data for offline work
data-seed/              example data files
.github/workflows/      the 15 minute snapshot job
```

## Data and privacy

- Favourites and the last open server stay in `localStorage`, nothing is sent anywhere.
- No cookies, no analytics, no accounts.
- Server names, IPs and player counts are public data from open.mp, collected without touching the servers themselves.

## License

MIT. The data belongs to the server owners and to the open.mp project.
