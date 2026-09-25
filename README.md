# recipe-book-v2 – Rezepte-App fürs Heimnetz

Eine leichtgewichtige Rezepte-App, die auf einem Windows-PC im lokalen Netz läuft und im Browser von Handy, Tablet und PC bedient wird. Alle Profile teilen sich die Rezepte, Bewertungen und Favoriten gehören je einem Profil.

**Status:** Design freigegeben (M1). Fundament (M0), Profile und Rezepte (M2) sowie Bilder (M3) sind umgesetzt. Als Nächstes folgt M4 mit Tags, Suche und Filtern. Starten und Entwickeln: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).

## Funktionsumfang Release 1.0

- Rezepte anlegen, bearbeiten und löschen, mit Papierkorb und Rückgängig
- Strukturierte Zutaten, Zubereitungsschritte, ein Foto je Rezept direkt aus der Handykamera
- Mehrere Tags je Rezept, umlautsicher, mit Autovervollständigung und Tag-Verwaltung
- Volltextsuche während des Tippens, Filter über Tag-Chips, Favoriten und Bewertung
- Bewertung mit 1–5 Sternen und Favoriten je Profil
- Profile ohne Passwort, Wechsel mit zwei Fingertipps
- Verbinden per QR-Code, tägliches Backup, Export als ZIP, Betrieb als Windows-Dienst

## Geplanter Stack

| Schicht | Wahl |
|---|---|
| Frontend | Svelte 5 als SPA, Vite, eigenes CSS mit Design-Tokens |
| Server | Node.js 24 LTS, Hono, ein Prozess auf Port 8080 |
| Daten | SQLite über better-sqlite3 mit FTS5, Bilder als WebP über sharp |
| Betrieb | Windows-Dienst über WinSW, ein Datenordner |

## Dokumente

- [Planung und Anforderungskatalog](docs/ANFORDERUNGSKATALOG.md): Ziele, 75 Anforderungen mit Akzeptanzkriterien, Datenmodell, Architektur, UI-Konzept, API, Meilensteine, Betrieb, Risiken
- [Design](docs/design/README.md): Design-Canvas und Farbpalette
- [CLAUDE.md](CLAUDE.md): verbindliche Regeln für die Umsetzung
