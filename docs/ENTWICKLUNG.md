# Entwicklung

Anleitung für die Arbeit am Code der Rezepte-App. Betrieb als Windows-Dienst: `docs/BETRIEB.md` (folgt in M6). Verbindliche Regeln für den Code: [CLAUDE.md](../CLAUDE.md). Anforderungen, Architektur und API: [Anforderungskatalog](ANFORDERUNGSKATALOG.md).

## Voraussetzungen

- **Node.js 24 LTS** (mindestens 24.14, kleiner 25). `.nvmrc` enthält `24`; wegen `engine-strict=true` in `.npmrc` bricht `pnpm install` mit anderen Versionen ab. Für die Entwicklung genügt jede Installation (auch per nvm); für den späteren Windows-Dienst muss Node maschinenweit installiert sein (Kap. 10.2).
- **pnpm 10.34.5** über Corepack: einmalig `corepack enable`. Die Version legt das Feld `packageManager` in `package.json` fest; Corepack lädt sie beim ersten Aufruf.
- **Git**.

Ein C/C++-Compiler, Python oder die Visual-Studio-Build-Tools sind nicht nötig.

## Einrichtung

```powershell
git clone https://github.com/n3t-rnr/recipe-book-v2
cd recipe-book-v2
pnpm install
```

Die Warnung `Ignored build scripts: better-sqlite3` ist erwartet und kein Fehler. better-sqlite3 liefert fertige Binärdateien für Windows x64, Linux und macOS im Paket mit (`node_modules/better-sqlite3/prebuilds/`) und darf nicht kompiliert werden. Das Build-Skript bitte **nicht** per `pnpm approve-builds` freigeben, sonst versucht pnpm einen Compiler-Lauf. sharp bringt seine Binärdateien ebenso fertig über `@img/sharp-<plattform>` mit.

`.npmrc` setzt außerdem `package-import-method=copy`: pnpm kopiert Dateien aus dem Store, statt Hardlinks anzulegen, damit das Dienstkonto LocalService sie später lesen kann (Risiko R2).

## Befehle

| Befehl | Wirkung |
|---|---|
| `pnpm dev` | Startet Server und Vite parallel (`scripts/dev.ts`). Jede Ausgabezeile trägt das Präfix `[server]` bzw. `[client]`. Strg+C beendet beide; endet ein Prozess von selbst, wird der andere ebenfalls beendet. |
| `pnpm dev:server` | Nur den Server mit `node --watch` auf Port 8080 (`PORT`); startet bei Änderungen an Server-Dateien neu. |
| `pnpm dev:client` | Nur den Vite-Dev-Server auf Port 5173 mit Hot Reload; leitet `/api` und `/media` an `http://localhost:8080` weiter. |
| `pnpm build` | Baut den Client nach `dist/client` und prüft danach die Budgets (`scripts/size-check.ts`, NF-01). Bei Überschreitung schlägt der Build fehl. |
| `pnpm start` | Startet den Server ohne Watch-Modus. Er liefert API, Bilder und den Build aus `dist/client` auf einem Port aus, wie später der Dienst. |
| `pnpm typecheck` | `svelte-check` für den Client (Warnungen gelten als Fehler) sowie `tsc` für `tsconfig.server.json`, `tsconfig.shared.json` und `tsconfig.e2e.json`. |
| `pnpm lint` | `biome check .`: Lint, Formatierung und Import-Reihenfolge prüfen, ohne zu ändern. `.svelte`-Dateien prüft `svelte-check`. |
| `pnpm format` | `biome check --write .`: Formatierung und sichere Lint-Korrekturen anwenden. |
| `pnpm test` | `vitest run`: Unit-Tests (`tests/unit`) und API-Tests gegen eine In-Memory-SQLite (`tests/api`). |
| `pnpm verify` | Qualitäts-Gate: `typecheck`, `lint`, `test` und `build` inklusive Size-Check. Muss vor jedem Commit grün sein; GitHub Actions führt es bei jedem Push und Pull Request aus (`.github/workflows/verify.yml`). |
| `pnpm size` | Nur den Size-Check gegen ein vorhandenes `dist/` (ohne neuen Build). |
| `pnpm perf` | Leistungsmessung mit 1.000 Testrezepten (NF-04, siehe [Leistungsmessung](#leistungsmessung-nf-04)). Nicht Teil von `pnpm verify`. |
| `pnpm e2e` | Baut den Client und führt die Browser-Tests aus (`tests/e2e`, Playwright) – auf emuliertem Android-Handy, iPhone, iPad und PC. Jeder Test-Worker startet einen eigenen Server mit leerem Datenordner; ein Test schlägt fehl, sobald die Seite gegen die CSP verstößt oder im Browser einen Fehler wirft. Nicht Teil von `pnpm verify`. |

Einzelne Testdatei: `pnpm exec vitest run tests/unit/normalize.test.ts`.

Browser-Tests: Einmalig nach `pnpm install` die Browser laden (rund 250 MB, landen unter `%LOCALAPPDATA%\ms-playwright`):

```powershell
pnpm exec playwright install chromium webkit
```

Einzelne Datei oder ein Gerät: `pnpm exec playwright test tests/e2e/photos.spec.ts --project=phone-webkit` (vorher `pnpm build`). Die Geräte-Profile stehen in `playwright.config.ts`; ein Test läuft auf den Geräten, deren Kennzeichen `@phone`, `@tablet` oder `@desktop` in seinem Titel steht.

## Leistungsmessung (NF-04)

`pnpm perf` misst die Serverzeiten, die NF-04 verlangt. Die Messung läuft mit Vitest über `vitest.perf.config.ts` und nimmt alle Dateien `tests/perf/*.perf.ts`. `pnpm test` und `pnpm verify` führen sie nicht aus, weil Zeiten vom Rechner abhängen.

**Wann:** vor der Abnahme jedes Meilensteins, der Liste, Suche oder Tags ändert (zuerst M4), und vor jedem Release (Kap. 9.1 und 9.5). Am aussagekräftigsten ist ein Lauf auf dem Server-PC. Andere Programme sollten dabei nicht viel Last erzeugen.

**Aufbau:** Jede Messdatei legt eine Datenbank-Datei in einem temporären Ordner an. Sie öffnet sie wie der Server (WAL, `synchronous=NORMAL`) und füllt sie mit `tests/seed.ts`: 1.000 Rezepte mit je 10 Zutaten, 6 Zubereitungsschritten und 3 Tags. Die Anfragen laufen durch die komplette App mit allen Middlewares. Als Serverzeit gilt `durationMs` aus der Log-Zeile `request` (NF-25), also der Wert, den später auch `data/logs/app.log` zeigt.

`tests/perf/nf04.perf.ts` misst Folgendes:

- **Liste und Suche:** 50 Anfragen zum Aufwärmen, danach 500 gemessene `GET /recipes` mit Profil-Header. Jede Anfrage hat einen Suchbegriff, 2 Tags und eine Sortierung. Die Begriffe wechseln durch: „kaese“, „suppe“, „zwieb“, „kartoffel käse“, „tomate“, „apfel“, „creme brulee“, „weiss“, „kuchen“ und „spazle“ (ohne Treffer; mit Tag-Filter berechnet der Server kein „Meintest du“, den Vorschlag misst der eigene Punkt unten). Tag-Modus und Sortierung wechseln ebenfalls. Jede 5. Anfrage lädt Seite 2, wenn es sie gibt. Grenze: p95 ≤ 30 ms.
- **Detail:** 500 gemessene `GET /recipes/:id`, verteilt über alle Rezepte. Grenze: p95 ≤ 10 ms.
- **Keine Anfrage über 100 ms** (NF-04, drittes AK). Das gilt für alle Anfragen dieser Datei, auch für die folgenden.
- **Nur berichtet**, ohne eigene p95-Grenze:
  - alle Seiten der ungefilterten Liste;
  - `GET /tags`;
  - eine Suche mit 200 Zeichen;
  - „Spazle“ ohne Tag-Filter, 20-mal direkt nach einer Datenänderung: Jede dieser Anfragen baut die Wortliste neu auf und liefert „Meintest du: Spätzle“ (F-23);
  - der Neuaufbau der Wortliste für „Meintest du“, direkt gemessen (Kap. 4.5 nennt < 5 ms);
  - der Abfrageplan einer Suche.

`tests/perf/tags.perf.ts` misst Umbenennen, Zusammenführen und Löschen großer Tags (ebenfalls unter 100 ms).

p95 ist der Wert an Position ⌈0,95 · n⌉ der aufsteigend sortierten Zeiten. Die Zahlen stehen als Hinweise in der Ausgabe von Vitest (vollständig mit `pnpm perf --reporter=verbose`). `tests/perf/nf04.perf.ts` schreibt sie außerdem nach `test-results/perf/nf04.json`: je Messreihe n, p50, p95 und max, dazu Node- und SQLite-Version und das Datum. Der Ordner `test-results/` steht in `.gitignore`. Für die Abnahme die Werte deshalb ins Abnahmeprotokoll oder in diese Datei übernehmen.

### Messwerte M4 (25.09.2026)

Entwicklungs-PC (Windows 11, 16 logische Kerne, Node 24.14.0, SQLite 3.53.4), fertig zusammengeführter M4-Stand nach allen Reviews, drei Läufe von `pnpm perf` direkt nacheinander, ohne parallele Browser-Tests. Andere Programme erzeugten dabei etwa 40 % CPU-Last. Alle Tests grün.

| Messreihe | Lauf 1 | Lauf 2 | Lauf 3 | Grenze |
|---|---|---|---|---|
| Liste und Suche (n = 500): p50 / **p95** / max | 4,0 / **6,5** / 8,1 ms | 4,0 / **6,3** / 8,5 ms | 3,9 / **6,5** / 8,4 ms | p95 ≤ 30 ms, max < 100 ms |
| Detail (n = 500): p50 / **p95** / max | 0,2 / **0,4** / 1,2 ms | 0,3 / **0,4** / 2,2 ms | 0,3 / **0,4** / 1,2 ms | p95 ≤ 10 ms, max < 100 ms |
| Liste ohne Filter, alle 25 Seiten: max | 1,8 ms | 2,2 ms | 1,8 ms | max < 100 ms |
| `GET /tags` (n = 20): max | 1,9 ms | 1,9 ms | 1,6 ms | max < 100 ms |
| Suche mit 200 Zeichen (n = 20): p50 / max | 14,1 / 25,0 ms | 14,2 / 25,9 ms | 14,2 / 23,9 ms | max < 100 ms |
| „Spazle“ nach einer Änderung, Wortliste neu (n = 20): p50 / p95 / max | 8,6 / 11,1 / 11,4 ms | 8,6 / 9,6 / 10,5 ms | 8,5 / 9,5 / 10,5 ms | max < 100 ms |
| Wortliste „Meintest du“ neu aufbauen (627 Wörter, n = 20): p50 / p95 | 4,7 / 5,4 ms | 4,6 / 5,5 ms | 4,4 / 6,1 ms | nur berichtet (Kap. 4.5: < 5 ms) |

In der Liste und Suche liefen je Lauf 16 Anfragen auf Seite 2, und 304 der 500 Anfragen hatten Treffer.

`tests/perf/tags.perf.ts` (Grenze je Anfrage 100 ms):

| Tag-Änderung | Lauf 1 | Lauf 2 | Lauf 3 |
|---|---|---|---|
| Umbenennen „Backen“ (88 Rezepte, größter Seed-Tag) | 17,3 ms | 17,2 ms | 17,9 ms |
| Zusammenführen „Sommer“ (83) in „Backen neu“ (danach 166) | 17,4 ms | 17,6 ms | 16,4 ms |
| Löschen „Backen neu“ (166 Rezepte) | 42,6 ms | 40,7 ms | 40,9 ms |
| Umbenennen eines Tags mit 600 Rezepten | 73,8 ms | 72,8 ms | 77,2 ms |
| Zusammenführen 600 in 550 (danach 1.000) | 65,7 ms | 68,4 ms | 64,3 ms |
| Löschen eines Tags mit 600 Rezepten | 75,9 ms | 72,8 ms | 68,0 ms |
| nur zur Info: Löschen eines Tags an allen 1.000 Rezepten | 105,8 ms | 103,4 ms | 104,6 ms |
| nur zur Info: Checkpoint von 689 WAL-Seiten | 130,8 ms | 93,8 ms | 81,4 ms |

Offen:

- Ein Lauf auf dem Server-PC fehlt noch.
- Tag-Änderungen an 600 Rezepten haben wenig Reserve. Unter starker Last (ein Spiel und parallel laufende Browser-Tests) lag Umbenennen in einem Review bei 108–111 ms. Die Zeit steckt im Neuaufbau der Suchzeilen, etwa ein Drittel davon in `normalize()`.
- Ein Tag an allen 1.000 Rezepten und der automatische WAL-Checkpoint (bei 1.000 Seiten, er läuft im Commit der Anfrage, die die Grenze überschreitet) bringen einzelne Schreibanfragen über 100 ms (NF-04, drittes AK).

## Projektstruktur

```
client/    Svelte-SPA (Vite-Root), public/ mit Manifest und Icons
server/    Hono-Server: main.ts (Start), app.ts (App-Factory), middleware/, routes/, services/, db/
shared/    Code für Client und Server: zod-Schemas, Normalisierung, Konstanten
tests/     unit/, api/, perf/ (pnpm perf), e2e/ (Playwright), fixtures/, helpers/
scripts/   dev.ts (Dev-Runner), size-check.ts (Budgets)
deploy/    install.ps1 (Firewall und Netzwerk; Dienst folgt in M6)
docs/      Anforderungskatalog, ADRs, Design
```

Die vollständige Struktur mit Zweck jeder Datei steht in Kap. 5.5 des Anforderungskatalogs.

## Datenordner

In der Entwicklung liegen alle Daten in `./data` im Repository (von Git ignoriert): `rezepte.sqlite` (mit `-wal` und `-shm`), `images/`, `backups/`, `logs/app.log` und `tmp/`. Der Server legt die Ordner beim Start an. Zum Zurücksetzen den Server stoppen und `data/` löschen.

Ein anderer Ordner lässt sich über `DATA_DIR` setzen (relative Pfade gelten ab dem Repository-Ordner):

```powershell
$env:DATA_DIR = 'C:\temp\rezepte-test'; pnpm dev:server
```

```bash
DATA_DIR=/c/temp/rezepte-test pnpm dev:server
```

Weitere Umgebungsvariablen (`PORT`, `HOST`, `PUBLIC_URL`, `ALLOWED_HOSTS`, `LOG_LEVEL` …) beschreibt Kap. 5.5. Das Proxy-Ziel des Vite-Dev-Servers folgt `PORT` (Standard 8080). Wer `PORT` ändert und Server und Vite in getrennten Terminals startet, setzt `PORT` in beiden; `pnpm dev` gibt die Variable automatisch an beide weiter.

## Auf dem Handy testen

Handy und PC müssen im selben WLAN sein. Die IP-Adresse des PCs zeigt der Server beim Start an (alternativ `ipconfig`).

**Variante A: Produktions-Build über Port 8080 (empfohlen für Gerätetests)**

1. `pnpm build`
2. `pnpm start` (oder `pnpm dev:server`, dann startet der Server bei Server-Änderungen neu)
3. Auf dem Handy `http://<IP>:8080` öffnen, z. B. `http://192.168.178.20:8080`. Das `http://` immer mit eintippen.

Das entspricht dem späteren Betrieb: ein Prozess, ein Port, Host-Prüfung und Security-Header aktiv. Nach Client-Änderungen ist ein neuer `pnpm build` nötig.

**Variante B: Vite-Dev-Server mit Hot Reload**

Der Vite-Dev-Server auf Port 5173 leitet `/api` und `/media` an den Server auf Port 8080 weiter. Standardmäßig lauscht Vite nur auf `localhost`; für das Handy:

1. `pnpm dev:server` in einem Terminal
2. `pnpm dev:client --host` in einem zweiten Terminal (Vite zeigt dann eine „Network“-Adresse)
3. Auf dem Handy `http://<IP>:5173` öffnen.

Port 5173 ist durch die Firewall-Regel „RezepteApp“ nicht abgedeckt. Beim ersten Lauschen im Netz fragt die Windows-Firewall nach `node.exe`: dort nur „Private Netzwerke“ zulassen. Wird der Dialog abgebrochen oder für „Öffentlich“ beantwortet, legt Windows eine Block-Regel für `node.exe` an, die auch Port 8080 sperrt; `deploy/install.ps1` findet und deaktiviert sie.

## Windows-Firewall

Damit Handys Port 8080 erreichen, einmalig in einer PowerShell **als Administrator** im Repository-Ordner ausführen:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install.ps1
```

Parameter: `-Port` (Standard 8080), `-DataDir` (erst ab M6 genutzt), `-Force` (keine Rückfragen). Das Skript ist wiederholbar und enthält in M0 nur den Firewall- und Netzwerkteil:

- prüft, ob der Port in einem von Windows reservierten Bereich liegt (Hyper-V, WSL2, Docker), und bricht dann ab;
- legt die Regel „RezepteApp“ an oder aktualisiert sie (eingehend, TCP, Port, nur Profil Privat);
- findet Block-Regeln für `node.exe` und deaktiviert sie nach Rückfrage;
- warnt, wenn das Netzwerk als „Öffentlich“ eingestuft ist, und nennt den Befehl zum Umstellen;
- prüft mDNS für die Adresse `<Computername>.local`;
- zeigt die Adressen `http://<IP>:<Port>` für Handys und Tablets.

Der Windows-Dienst (WinSW), die Ordnerrechte und die Health-Prüfung folgen in M6.

## Konventionen

Die verbindlichen Regeln stehen in [CLAUDE.md](../CLAUDE.md) und in Kap. 5.6 des Anforderungskatalogs. Kurzfassung:

- TypeScript strikt; relative Imports mit Endung `.ts`; keine `enum`s, `namespace`s oder Parameter-Properties (Type-Stripping); kein `any`; kein `console.log` außerhalb von `server/log.ts`.
- SQL nur unter `server/db/` (Repositories in `repos/`, dazu Verbindung, Migrationen und FTS-Pflege); Grenzen (Body, Query, Env) werden mit zod geparst; Fehler als `AppError`.
- UI-Texte auf Deutsch in Du-Form, nur in `client/src/i18n/` (`de.ts` für den Start-Chunk, `de-screens*.ts` und `de-editor.ts` für nachgeladene Teile); Farben nur über Tokens.
- Commits nach Conventional Commits (`feat:`, `fix:`, `chore:`), `pnpm verify` vorher grün.
- Neue Laufzeit-Abhängigkeiten nur mit ADR in `docs/ADR/` (NF-02, [ADR 0001](ADR/0001-stack.md)).
