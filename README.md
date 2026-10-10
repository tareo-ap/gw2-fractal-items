# GW2 Fractal Items

Kleine Webanwendung, die alle Guild-Wars-2-Items aus der offiziellen API lädt und zeigt,
welche Gizmos und Consumables in Fractals of the Mist nutzbar sein könnten
(Kriterium: `game_types` enthält `Dungeon`). Anforderungen: [docs/PRD.md](docs/PRD.md).

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `server/` | Node.js-Backend mit [Hono](https://hono.dev), SQLite über das eingebaute `node:sqlite` |
| `web/` | React + Vite + TypeScript |
| `shared/` | Typen und gemeinsame Regeln (Filter, Eingabe-Prüfung, CSV-Format, Logik der statischen Fassung), die Server und Web nutzen |
| `scripts/` | Build der statischen Fassung (`build:pages`, `preview:pages`) |
| `site-data/` | Export für GitHub Pages (JSON, wird committet; erst nach dem ersten `npm run export:static` vorhanden) |
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

Die Oberfläche gibt es auf Englisch (Standard) und Deutsch; der Umschalter „EN | DE“ sitzt oben rechts, die Wahl merkt sich der Browser.
In der deutschen Ansicht erscheinen auch Item-Namen und Beschreibungen auf Deutsch (mit Fallback auf Englisch) und die Suche findet deutsche und englische Begriffe.
Dafür lädt jedes Update zusätzlich die deutschen Texte, es dauert deshalb etwa doppelt so lange (ca. 14 statt 7 Minuten). Die deutschen Texte erscheinen erst nach dem ersten Update mit dieser Version.
Scheitert nur der deutsche Teil, bleibt das Update gültig; der nächste Lauf holt die Texte nach.

Die aktuell gefilterte Liste (alle Treffer, mit Kandidaten und Testergebnissen) lässt sich über die Links „CSV“ und „JSON“ neben der Trefferanzahl herunterladen; die CSV ist für deutsches Excel gedacht (Semikolon, UTF-8 mit BOM).

Die Datenbank landet in der Entwicklung unter `data/gw2-items.db` (per `.gitignore` ausgeschlossen).

## Docker

```bash
docker compose up -d --build
```

Danach läuft die App auf http://localhost:3000. Die Datenbank liegt im Volume `gw2-items-data` unter `/data`.

## GitHub Pages

Neben der Docker-Version gibt es eine statische, schreibgeschützte Fassung aus demselben Code
(Liste, Suche, Filter, Details, Änderungen, Vergleich, Export CSV/JSON; ohne Update-Button, Teststatus-Bearbeitung,
DB-Export und Stände löschen). Die Daten kommen aus JSON-Dateien statt von `/api`; die GW2-API wird dort nie aufgerufen.
Adresse: https://tareo-ap.github.io/gw2-fractal-items/

Ablauf nach einem Patch:

1. Lokal aktualisieren (Button „Aktualisieren“) und Teststatus pflegen.
2. `npm run export:static` schreibt die Daten nach `site-data/` (Ordner wird vorher geleert). Optional mit anderer Datei: `npm run export:static -- pfad/zur.db`. Die Datenbank wird nur lesend geöffnet, der Server darf weiterlaufen. Das Skript nennt Dateizahl und Gesamtgröße (Ziel unter ca. 15 MB unkomprimiert).
3. `site-data/` committen und nach Forgejo pushen; der Push-Mirror bringt es nach GitHub.
4. Die GitHub Action `.github/workflows/pages.yml` baut bei jedem Push auf `main` (oder manuell per „Run workflow“) mit `npm run build:pages` und veröffentlicht die Seite.

Einmalig auf GitHub: Settings → Pages → Source „GitHub Actions“.

Veröffentlicht werden alle nicht entfernten Fractal-Kandidaten vom Typ Gizmo oder Consumable sowie alle Items, die in einer Änderung ab dem zweiten abgeschlossenen Update vorkommen (damit z. B. „Dungeon weg“ sichtbar bleibt). Die Änderungen des ersten Updates (Vollimport) sind nicht enthalten. Jeder Export-Commit ändert die JSON-Dateien (ca. 10 MB), das Repository wächst dadurch mit jedem Patch.

Lokale Vorschau der Pages-Fassung:

```bash
npm run build:pages     # braucht site-data/ ; baut mit VITE_DATA_MODE=static nach web/dist
npm run preview:pages   # vite preview, Adresse steht in der Ausgabe (mit Basis-Pfad)
```

Der Basis-Pfad ist `/gw2-fractal-items/` und lässt sich über die Umgebungsvariable `VITE_BASE` ändern (z. B. `VITE_BASE=/ npm run build:pages` auf Linux/macOS). `404.html` ist eine Kopie von `index.html`, damit Reload und Deep-Links wie `/gw2-fractal-items/items/123` funktionieren. `npm run build:pages` überschreibt `web/dist`; für das Docker-Image gilt weiterhin `npm run build`.

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
| `UPDATE_CHECK` | `off` (Docker-Image: `on`) | Automatische Prüfung auf eine neue Game-Build. Bei neuer Build-ID startet ein Update; solange es noch kein abgeschlossenes Update gibt (erster Vollimport), nie. Ungültige Werte der folgenden Variablen schalten die Prüfung aus |
| `UPDATE_CHECK_TZ` | `Europe/Berlin` | Zeitzone für alle Zeiten des Zeitplans (IANA-Name, Sommer-/Winterzeit wird berücksichtigt) |
| `UPDATE_CHECK_DAILY_AT` | `06:00` | Tägliche Prüfung (HH:MM) |
| `UPDATE_CHECK_PATCH_WINDOW` | `Tue 17:00-19:00` | Patch-Fenster (Wochentag `Mon`…`Sun`, von-bis); neue Patches kommen meist dienstags abends. `off` = kein Fenster |
| `UPDATE_CHECK_PATCH_EVERY_MINUTES` | `30` | Abstand der Prüfungen im Patch-Fenster (17:00, 17:30, … 19:00). Nach dem Start wird nicht sofort geprüft, sondern zum nächsten Termin |
