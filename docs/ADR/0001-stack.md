# ADR 0001: Tech-Stack der Rezepte-App v2

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Grundlage:** [Anforderungskatalog](../ANFORDERUNGSKATALOG.md), Kap. 5.1 bis 5.3; NF-01, NF-02, NF-05, NF-28

## Kontext

Die App läuft als ein einziger Node-Prozess auf einem Windows-PC im Heimnetz und wird über reines HTTP von Handys, Tablets und PCs bedient. Entwickelt und betrieben wird sie von einer Person. Daraus folgen harte Budgets: Initial-JS ≤ 35 KB gzip (NF-01), genau sechs Laufzeit-Abhängigkeiten (NF-02), RAM ≤ 80 MB im Leerlauf (NF-05) und ein Qualitäts-Gate `pnpm verify` ab M0 (NF-28). Der Prototyp v1 (Vue 3, Fastify 4, Prisma/SQLite, Docker, nginx) kam ohne Tests, Lint und Typecheck nie über drei Screens hinaus (Kap. 1.1).

## Entscheidung

| Baustein | Wahl |
|---|---|
| Laufzeit | Node.js 24 LTS; Server-Code läuft als TypeScript per Type-Stripping, ohne Build-Schritt |
| Frontend | Svelte 5 (Runes) als SPA, eigener History-Router, keine UI-Bibliothek |
| Build | Vite 8 |
| Styling | Handgeschriebenes CSS: `tokens.css` plus Scoped CSS der Komponenten |
| HTTP-Server | Hono 4.13 mit `@hono/node-server` 2.1 |
| Datenbank | SQLite über better-sqlite3 13 (WAL, FTS5), handgeschriebenes SQL, nummerierte Migrationen, kein ORM |
| Bilder | sharp 0.35 (drei WebP-Varianten) |
| Validierung | zod 4 über `zod/mini` in `shared/` |
| QR-Code | qrcode-generator 2.0, nur auf dem Server |
| ZIP-Export | eigener Streaming-Writer (Verfahren „store“, CRC über `zlib.crc32`) |
| Tests | Vitest 5, Playwright für 4 Smoke-Flows |
| Lint, Format, Typen | Biome 2, svelte-check 4, TypeScript 6.0 (gepinnt) |
| Paketmanager | pnpm 10.34.5 über `packageManager`; ein Paket mit `client/`, `server/`, `shared/` und drei tsconfigs |
| Dienst | WinSW 2.12.0 (`WinSW-NET461.exe`) unter LocalService |

### Laufzeit-Abhängigkeiten (genau sechs)

| Paket | Version | Begründung |
|---|---|---|
| `hono` | 4.13.8 | Routing und Middleware auf Web-Standard-API ohne eigene Abhängigkeiten; `app.request()` erlaubt API-Tests ohne Netzwerk. |
| `@hono/node-server` | 2.1.1 | Verbindet Hono mit `node:http` (dual-stack auf `::`, Streaming-Bodys, statische Dateien). |
| `better-sqlite3` | 13.0.3 | Synchrone, stabile SQLite-API mit FTS5, Transaktionen und Online-Backup; Prebuilds für Windows und Linux im Paket, kein Compiler nötig. |
| `sharp` | 0.35.4 | Schnelle Bildpipeline (libvips) mit EXIF-Rotation und WebP; ab 0.35.4 wegen Sicherheitskorrekturen in libvips; Binärdateien über `@img/sharp-<plattform>`. |
| `zod` | 4.6.5 | Ein Schema (`zod/mini`, tree-shakebar) für Server-Validierung, Editor-Fehler, Typen und Exportformat. |
| `qrcode-generator` | 2.0.4 | QR-Code als SVG (Verbinden-Seite) und ASCII (Konsole) ohne weitere Abhängigkeiten. |

`svelte` steht in `devDependencies`, weil es vollständig in das Client-Bundle kompiliert wird. Im Client-Bundle landen nur `svelte` und `zod/mini` (nur im Editor-Chunk).

## Verworfene Alternativen (Kurzfassung)

- **Frontend:** React (Grundlast sprengt das 35-KB-Budget), Vue 3 (Stack des Prototyps, deutlich größer), Preact und SolidJS (kein Scoped CSS), SvelteKit (SSR bringt im LAN nichts), HTMX/Alpine (Editor braucht Client-State).
- **Server:** Fastify (viele transitive Pakete), Express (schwächere Typisierung).
- **Datenbank:** `node:sqlite` (in Node 24.14 noch experimentell, Neubewertung im Backlog), Prisma und Drizzle (Gewicht bzw. Beta, FTS5 schlecht abbildbar).
- **Sonstiges:** Tailwind, pnpm-Workspace, jimp, busboy, Docker Desktop, NSSM, pm2, Aufgabenplanung als Autostart.

Zahlen und Begründungen stehen in Kap. 5.3 (verworfene Alternativen) und Kap. 5.2 (strittige Punkte) des Anforderungskatalogs.

## Konsequenzen

- Kleines Bundle, ein Prozess, ein Port, kein Server-Build: `node server/main.ts` startet direkt.
- Type-Stripping verlangt `erasableSyntaxOnly`: keine `enum`s, `namespace`s oder Parameter-Properties; relative Imports mit Endung `.ts`.
- better-sqlite3 und sharp sind native Module und hängen an Node-Major und Plattform (Risiko R1). Node 24 ist in `engines` und `.nvmrc` gepinnt; ein Major-Wechsel ist ein bewusster Schritt mit Testinstallation unter LocalService. Build-Skripte werden nicht ausgeführt, die mitgelieferten Binärdateien genügen.
- Handgeschriebenes SQL braucht Disziplin: SQL nur unter `server/db/`, Mehrtabellen-Schreibvorgänge in einer Transaktion.
- Werkzeug-Upgrades (TypeScript 7, pnpm 12, neue Vite-Majors) erfolgen gezielt und nur mit grünem `pnpm verify` (Risiko R19).
- **NF-02:** Jede neue Laufzeit-Abhängigkeit braucht einen eigenen ADR in `docs/ADR/` mit Begründung, Größe, transitiven Abhängigkeiten und geprüften Alternativen. Ohne ADR wird keine Abhängigkeit ergänzt.
