# GW2 Fractal Items

Kleine Webanwendung, die alle Guild-Wars-2-Items aus der offiziellen API lädt und zeigt,
welche Gizmos und Consumables in Fractals of the Mist nutzbar sein könnten
(Kriterium: `game_types` enthält `Dungeon`). Anforderungen: [docs/PRD.md](docs/PRD.md).

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `server/` | Node.js-Backend mit [Hono](https://hono.dev), SQLite über das eingebaute `node:sqlite` |
| `web/` | React + Vite + TypeScript |
| `shared/` | Typen, die Server und Web gemeinsam nutzen (nur Typen, kein Laufzeitcode) |
| `sources/` | Alte Exporte, nur als Kontext |
| `docs/` | PRD |

Im Betrieb ist es ein einziger Prozess: Der Server liefert die API unter `/api/*` und das gebaute Frontend aus.
In der Entwicklung laufen Vite (Port 5173) und Server (Port 3000) getrennt, Vite leitet `/api` an den Server weiter.

## Entwicklung

Voraussetzung: Node.js 24 oder neuer.

```bash
npm install
npm run dev        # Server und Web gleichzeitig, danach http://localhost:5173 öffnen
npm run typecheck
npm test           # Backend-Tests (gegen einen lokalen Fake der GW2-API)
npm run build
```

Server und Web lassen sich auch getrennt starten: `npm run dev:server` und `npm run dev:web` in zwei Terminals.
Beim Start schreibt der Server Port und Datenbankpfad ins Log. Ist der Port belegt, sagt er das und beendet sich.

Die Daten kommen über den Button „Aktualisieren“: Der erste Lauf lädt alle Items aus der GW2-API
(mehrere hundert Requests, gedrosselt auf 5 pro Sekunde), spätere Läufe vergleichen mit dem Cache.

Die aktuell gefilterte Liste (alle Treffer, mit Kandidaten und Testergebnissen) lässt sich über die Links „CSV“ und „JSON“ neben der Trefferanzahl herunterladen; die CSV ist für deutsches Excel gedacht (Semikolon, UTF-8 mit BOM).

Die Datenbank landet in der Entwicklung unter `data/gw2-items.db` (per `.gitignore` ausgeschlossen).

## Docker

```bash
docker compose up -d --build
```

Danach läuft die App auf http://localhost:3000. Die Datenbank liegt im Volume `gw2-items-data` unter `/data`.

## Sichern und Umziehen

- Sichern: Im Kopf der App auf „Export“ klicken (bzw. `/api/export` aufrufen). Das lädt eine konsistente Kopie der Datenbank als `gw2-items-JJJJ-MM-TT.db`, auch während ein Update läuft.
- Einspielen: Server beenden, dann `npm run db:import -- datei.db`. Die bisherige Datenbank bleibt als `gw2-items.db.bak-<Zeitstempel>` neben der neuen liegen. Das Skript bricht ab, wenn der Server noch läuft.
- Docker: Container stoppen, die Datei per `docker cp datei.db <container>:/data/gw2-items.db` ins Volume kopieren (die alte Datei vorher sichern), Container wieder starten.

## Konfiguration

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | HTTP-Port |
| `DB_PATH` | `data/gw2-items.db` (Docker: `/data/gw2-items.db`) | SQLite-Datei |
| `WEB_DIST` | leer (Docker: `/app/web/dist`) | Gebautes Frontend; leer = Server liefert nur die API |
| `GW2_API_BASE` | `https://api.guildwars2.com` | Basis-URL der GW2-API |
