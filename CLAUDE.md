# CLAUDE.md – recipe-book-v2

Browser-based recipe app for the home LAN. One Node process on a Windows PC serves API, SPA and images; phones and tablets connect over plain HTTP. The single source of truth for scope, data model, API, UI concept and milestones is [docs/ANFORDERUNGSKATALOG.md](docs/ANFORDERUNGSKATALOG.md) (German). Requirement IDs (F-xx, NF-xx) and chapter numbers below refer to that document.

## Current phase

M0 (foundation), M2 (profiles and recipe core) and M3 (images, released by the user on 2026-09-25) are done; M4 (tags, search, filters, sorting) is implemented and in the user's review. The design (direction C) was approved on 2026-09-23 (NF-16): build UI exactly after the approved artboards and tokens (`client/src/styles/tokens.css`); canvas link and fixed values in [docs/design/README.md](docs/design/README.md). UI texts live in `client/src/i18n/` (`de.ts` for the entry chunk, `de-screens*.ts` and `de-editor.ts` for lazy chunks). Initial JS is at 37.0 of 38 KB (ADR 0004) and the editor chunk at 29.5 of 30 KB: M5 must keep new code lazy and will likely need to split the editor chunk.

Developer setup and commands: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).

## Language

- UI texts: German, informal "du" form, only in `client/src/i18n/` (NF-10). Decimal comma, dates as `12.03.2026`.
- Code, identifiers, file names, commit messages: English.
- Docs for the user (`docs/*.md`): German.

## Stack (chapter 5.1)

Svelte 5 SPA + Vite 8 with an own mini router · Node 24 LTS running TypeScript via type stripping (no server build) · Hono 4 + `@hono/node-server` · SQLite via better-sqlite3 (WAL, FTS5), hand-written SQL, numbered migrations · sharp for images · zod (`zod/mini`) in `shared/` · Biome · Vitest · Playwright · pnpm 10 (`packageManager: pnpm@10.34.5`), one `package.json` with `client/`, `server/`, `shared/` and three tsconfigs for client, server and shared (plus `tsconfig.e2e.json` for the Playwright tests, which need DOM types) · WinSW Windows service.

Project layout: chapter 5.5. Do not add a monorepo/workspace, an ORM, Tailwind, a UI component library, or a router/state/date/icon package.

## Hard rules

- **Dependencies (NF-02):** runtime `dependencies` are exactly `hono`, `@hono/node-server`, `better-sqlite3`, `sharp`, `zod`, `qrcode-generator`. Any addition needs an ADR in `docs/ADR/`. The client bundle contains only `svelte` and `zod/mini` (editor chunk only).
- **Budgets (NF-01, NF-05):** initial JS ≤ 38 KB gzip (ADR 0004), every lazily loaded JS chunk ≤ 30 KB gzip (ADR 0002; the total is only reported), CSS ≤ 15 KB, fonts ≤ 100 KB WOFF2; server RAM ≤ 100 MB idle (ADR 0003). `scripts/size-check.ts` fails the build when a budget is exceeded.
- **Colors (NF-12, NF-13, chapter 6.7):** palette `#EFE6DD` Linen, `#231F20` Raisin Black, `#BB4430` Terracotta (`#D9634F` in dark mode), `#7EBDC2` Moonstone, `#F3DFA2` Vanilla. Colors only as CSS custom properties in `client/src/styles/tokens.css`; no color literals anywhere else. Moonstone and Vanilla only as surfaces with dark text, never as text color. Terracotta on Linen never as normal-size text (4.28:1). State is never conveyed by color alone.
- **Touch (NF-07):** tap targets ≥ 44×44 px, kitchen actions (heart, stars, FAB, save) ≥ 48×48 px; no feature relies on hover, long press or double tap.
- **Icons and fonts (NF-15):** one stroke-based inline SVG sprite with `currentColor`; no emoji or text glyphs as icons; max. 2 self-hosted WOFF2 font families, no CDN.
- **CSP:** no static `style=` attributes in `.svelte` files; use the `style:` directive or classes.
- **Plain HTTP in the LAN (NF-26):** feature-detect anything that needs a secure context (service worker, Wake Lock, clipboard, share) and hide it silently. Never promise offline mode or app installation.
- **Identity (F-05):** the acting profile comes only from the `X-Profile-Id` header, never from the request body.
- **Data (chapter 5.6):** boundaries are parsed with zod, not cast. SQL only under `server/db/` (repositories in `repos/`, plus connection, migrations and `fts.ts`); multi-table writes (including FTS maintenance) run in one `db.transaction()`. Services throw `AppError(code, status, message, details?)`.
- **UI-first:** a new DB column ships with its UI in the same change, or with a documented technical reason.
- **TypeScript:** strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums, namespaces or parameter properties); relative imports with `.ts` extension; no `any`; no `console.log` outside `server/log.ts`.

## Quality gate

`pnpm verify` = `svelte-check` + `tsc --noEmit` (server, shared) + `biome check` + `vitest run` + size check. It must be green before every commit. Every API endpoint gets at least one success and one failure test against an in-memory SQLite via `app.request()` (chapter 9).

## Scope discipline

Work milestone by milestone (chapter 8); every milestone must be usable on a phone. "Kann" requirements are only touched after all "Muss" and "Soll" requirements are accepted. Everything in chapter 3.3 (backlog) stays out unless the user decides otherwise.
