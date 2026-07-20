# Meter Console (Local)

Local energy-meter dashboard: connect meters, poll them from the server
(not the browser), store every reading in a local SQLite database, and
generate daily/monthly reports per meter.

## Requirements
- Node.js **22.5 or newer** (uses Node's built-in `node:sqlite` — no
  database software or npm packages to install).

Check your version:
```
node --version
```

## Run it

```
cd meter-console
node server.js
```

Then open **http://localhost:5177** in your browser.

To use a different port:
```
PORT=8080 node server.js
```

That's it — no `npm install` needed. A file `data/meters.db` will be
created automatically on first run and holds all your meters + history.

## Keeping it running
The server needs to stay running for polling and history to keep
accumulating (closing the browser tab is fine — the server keeps
polling in the background). A couple of easy options:

- **Simplest:** leave the terminal window open, or run it inside a
  `screen`/`tmux` session.
- **Auto-restart / run in background:** install [pm2](https://pm2.keymetrics.io/)
  (`npm install -g pm2`) then `pm2 start server.js --name meter-console`.
- **Run at boot (Linux, systemd):** create a small unit file that runs
  `node /path/to/meter-console/server.js`, `enable` it, and it'll survive
  reboots.

## Adding a meter
Open the **Dashboard** tab → "Connect a meter":
- **Name** — anything you like.
- **API URL** — an endpoint that returns JSON with the meter's current
  reading.
- **Auth header** — optional, e.g. `Bearer eyJhbGciOi...`.
- **Poll every (sec)** — how often the server fetches that URL.
- **Field mapping** (advanced) — if your API's JSON doesn't use the
  default field names (`activePower`, `voltage`, `current`, `powerFactor`,
  `frequency`, `energy`), map them with dot paths, e.g.
  `{"activePower":"data.kw"}`.

Since polling now happens on the server instead of in the browser,
CORS restrictions on the meter's API generally no longer apply.

You can also click **"try a demo meter"** to see the layout with
simulated data.

## Reports
The **Reports** tab lets you pick a meter and a date (daily) or month
(monthly) and generates:
- Total & average/peak power, and estimated energy (kWh)
- An hour-by-hour (daily) or day-by-day (monthly) breakdown table + chart
- A **Download CSV** button for either report

Energy (kWh) is estimated by integrating the active-power readings over
time (trapezoidal rule), so it works even if a meter's own cumulative
"energy" field is missing, unreliable, or resets — the meter's own
energy delta is also included in the API response as a cross-check.

## Project layout
```
meter-console/
  server.js     — HTTP server + REST API (plain Node http, no framework)
  db.js         — SQLite persistence (meters, readings)
  poller.js     — server-side polling of each meter's API
  reports.js    — daily/monthly report + CSV generation
  public/
    index.html  — dashboard + reports UI
  data/
    meters.db   — created automatically, holds all your data
```

## Backing up your data
Everything lives in `data/meters.db` — just copy that file to back up
or move your meter list and full reading history.
