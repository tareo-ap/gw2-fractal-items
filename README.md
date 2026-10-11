# GW2 Fractal Items

A small web app that loads all Guild Wars 2 items from the official API and shows
which gizmos and consumables might be usable in Fractals of the Mist
(criterion: `game_types` contains `Dungeon`).

Public read-only version: https://tareo-ap.github.io/gw2-fractal-items/

## Structure

| Folder       | Contents                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `server/`    | Node.js backend with [Hono](https://hono.dev), SQLite via the built-in `node:sqlite`                               |
| `web/`       | React + Vite + TypeScript                                                                                          |
| `shared/`    | Types and shared rules (filters, input validation, CSV format, logic of the static version) used by server and web |
| `scripts/`   | Build of the static version (`build:pages`, `preview:pages`)                                                       |
| `site-data/` | Export for GitHub Pages (JSON, committed; created by `npm run export:static`)                                      |

In production it is a single process: the server serves the API under `/api/*` and the built frontend.
During development Vite (port 5173) and the server (port 3000) run separately; Vite proxies `/api` to the server.

## Development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev        # server and web together, then open http://localhost:5173
npm run typecheck
npm test           # backend tests (against a local fake of the GW2 API)
npm run build
```

Server and web can also be started separately: `npm run dev:server` and `npm run dev:web` in two terminals.
On startup the server logs its port and database path. If the port is taken, it says so and exits.

Data is loaded with the "Update" button: the first run fetches all items from the GW2 API
(several hundred requests, throttled to 5 per second), later runs compare against the cache.

The interface is available in English (default) and German; the "EN | DE" switch is at the top right and the browser remembers the choice.
In German, item names and descriptions are shown in German too (falling back to English), and search finds German and English terms.
Each update therefore also loads the German texts and takes about twice as long (roughly 14 instead of 7 minutes).
If only the German part fails, the update stays valid and the next run fetches the texts again.

The currently filtered list (all results, including candidates and test results) can be downloaded via the "CSV" and "JSON" links next to the result count. The CSV targets Excel with German settings (semicolon, UTF-8 with BOM).

During development the database is stored in `data/gw2-items.db` (excluded via `.gitignore`).

## Docker

```bash
docker compose up -d --build
```

The app then runs on http://localhost:3000. The database lives in the volume `gw2-items-data` under `/data`.

## GitHub Pages

Besides the Docker version there is a static, read-only version built from the same code
(list, search, filters, details, changes, comparison, CSV/JSON export; no update button, no test status editing,
no database export, no deleting of states). It loads JSON files instead of calling `/api` and never calls the GW2 API.
Address: https://tareo-ap.github.io/gw2-fractal-items/

Workflow after a game patch:

1. Update locally ("Update" button) and maintain the test status.
2. `npm run export:static` writes the data to `site-data/` (the folder is emptied first). Another database file can be passed: `npm run export:static -- path/to/file.db`. The database is opened read-only, so the server may keep running. The script prints the file count and total size (target: below about 15 MB uncompressed).
3. Commit `site-data/` and push to Forgejo; the push mirror brings it to GitHub.
4. The GitHub Action `.github/workflows/pages.yml` builds with `npm run build:pages` on every push to `main` (or manually via "Run workflow") and publishes the site.

One-time setup on GitHub: Settings → Pages → Source "GitHub Actions".

Published are all non-removed Fractal candidates of type Gizmo or Consumable, plus all items that appear in a change from the second completed update onwards (so that e.g. "Dungeon removed" stays visible). Changes of the first update (full import) are not included. Every export commit changes the JSON files (about 10 MB), so the repository grows with each patch.

Local preview of the Pages version:

```bash
npm run build:pages     # needs site-data/; builds with VITE_DATA_MODE=static into web/dist
npm run preview:pages   # vite preview, the address (with base path) is printed
```

The base path is `/gw2-fractal-items/` and can be changed with the environment variable `VITE_BASE` (e.g. `VITE_BASE=/ npm run build:pages` on Linux/macOS). `404.html` is a copy of `index.html` so that reloads and deep links such as `/gw2-fractal-items/items/123` work. `npm run build:pages` overwrites `web/dist`; the Docker image still uses `npm run build`.

## Backup and moving

- Backup: click "Export" in the app header (or open `/api/export`). This downloads a consistent copy of the database as `gw2-items-YYYY-MM-DD.db`, even while an update is running.
- Restore: stop the server, then run `npm run db:import -- file.db`. The previous database is kept next to it as `gw2-items.db.bak-<timestamp>`. The script aborts if the server is still running.
- Docker: stop the container, copy the file into the volume with `docker cp file.db <container>:/data/gw2-items.db` (back up the old file first), start the container again.

## Configuration

| Variable                           | Default                                            | Meaning                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | `3000`                                             | HTTP port                                                                                                                                                                                         |
| `DB_PATH`                          | `data/gw2-items.db` (Docker: `/data/gw2-items.db`) | SQLite file                                                                                                                                                                                       |
| `WEB_DIST`                         | empty (Docker: `/app/web/dist`)                    | Built frontend; empty = the server only serves the API                                                                                                                                            |
| `GW2_API_BASE`                     | `https://api.guildwars2.com`                       | Base URL of the GW2 API                                                                                                                                                                           |
| `UPDATE_CHECK`                     | `off` (Docker image: `on`)                         | Automatic check for a new game build. A new build ID starts an update; never before the first completed update (initial full import). Invalid values of the following variables disable the check |
| `UPDATE_CHECK_TZ`                  | `Europe/Berlin`                                    | Time zone for all schedule times (IANA name, daylight saving time is handled)                                                                                                                     |
| `UPDATE_CHECK_DAILY_AT`            | `06:00`                                            | Daily check (HH:MM)                                                                                                                                                                               |
| `UPDATE_CHECK_PATCH_WINDOW`        | `Tue 17:00-19:00`                                  | Patch window (weekday `Mon`…`Sun`, from-to); new patches usually arrive on Tuesday evenings. `off` = no window                                                                                    |
| `UPDATE_CHECK_PATCH_EVERY_MINUTES` | `30`                                               | Interval of checks within the patch window (17:00, 17:30, … 19:00). The server does not check right after startup but at the next scheduled time                                                  |

## Legal

Guild Wars 2 © ArenaNet, LLC. Item data and icons come from the official GW2 API. This project is not affiliated with ArenaNet.
