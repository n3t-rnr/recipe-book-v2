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
| `pnpm typecheck` | `svelte-check` für den Client (Warnungen gelten als Fehler) sowie `tsc` für `tsconfig.server.json` und `tsconfig.shared.json`. |
| `pnpm lint` | `biome check .`: Lint, Formatierung und Import-Reihenfolge prüfen, ohne zu ändern. `.svelte`-Dateien prüft `svelte-check`. |
| `pnpm format` | `biome check --write .`: Formatierung und sichere Lint-Korrekturen anwenden. |
| `pnpm test` | `vitest run`: Unit-Tests (`tests/unit`) und API-Tests gegen eine In-Memory-SQLite (`tests/api`). |
| `pnpm verify` | Qualitäts-Gate: `typecheck`, `lint`, `test` und `build` inklusive Size-Check. Muss vor jedem Commit grün sein; GitHub Actions führt es bei jedem Push und Pull Request aus (`.github/workflows/verify.yml`). |
| `pnpm size` | Nur den Size-Check gegen ein vorhandenes `dist/` (ohne neuen Build). |

Einzelne Testdatei: `pnpm exec vitest run tests/unit/normalize.test.ts`.

## Projektstruktur

```
client/    Svelte-SPA (Vite-Root), public/ mit Manifest und Icons
server/    Hono-Server: main.ts (Start), app.ts (App-Factory), middleware/, routes/, services/, db/
shared/    Code für Client und Server: zod-Schemas, Normalisierung, Konstanten
tests/     unit/, api/, fixtures/, helpers/
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
- UI-Texte auf Deutsch in Du-Form, nur in `client/src/i18n/de.ts`; Farben nur über Tokens.
- Commits nach Conventional Commits (`feat:`, `fix:`, `chore:`), `pnpm verify` vorher grün.
- Neue Laufzeit-Abhängigkeiten nur mit ADR in `docs/ADR/` (NF-02, [ADR 0001](ADR/0001-stack.md)).
