# ADR 0004: Start-JavaScript bis 38 KB

- **Status:** angenommen
- **Datum:** 2026-09-25
- **Betrifft:** NF-01 (Transfer- und Bundle-Budget), Kap. 1.4, Kap. 5.1; ergänzt ADR 0002

## Kontext

NF-01 begrenzte das Start-JavaScript (alle Skripte und `modulepreload`-Chunks aus `index.html`) auf 35 KB gzip. Nach M3 lag es bei 35.830 Byte, fast genau an der Grenze. Eine Umstellung der Chunk-Aufteilung in `vite.config.ts` (ein gemeinsamer Start-Chunk statt eines zweiten, dazu ein schlankerer Preload-Helper) senkte es auf 33.905 Byte, also 1,9 KB Luft.

M4 bringt Suchfeld, Tag-Chips und Sortierung auf den ersten Bildschirm, M5 Herz und Sterne auf jede Karte und die Suche in die Favoriten-Ansicht. Die Planung für M4 kam auf etwa 1,95 KB zusätzlichen Start-Code. Der Plan-Kritiker hielt diese Schätzung für 30–50 % zu niedrig. Spätestens M5 hätte die Grenze gerissen.

Ohne höhere Grenze hätte jede Änderung am ersten Bildschirm Byte-Tricks gebraucht: globale CSS-Klassen statt Komponenten, nachgeladene Chip-Reihe, Konstanten als Literale. Das macht den Code schwerer lesbar, ohne dass man den Unterschied im Heimnetz merkt.

## Entscheidung

Sebastian hat am 25.09.2026 entschieden: Das Start-JavaScript darf **≤ 38 KB gzip** groß sein (38.912 Byte). Das gilt ab M4 und deckt M5 mit ab.

Unverändert bleiben:

- jeder nachgeladene Chunk ≤ 30 KB gzip (ADR 0002),
- CSS ≤ 15 KB gzip, Schriften ≤ 100 KB,
- erster Besuch der Liste ohne Bilder ≤ 160 KB Transfer,
- `scripts/size-check.ts` lässt `pnpm build` bei jeder Überschreitung scheitern.

## Folgen

- Komponenten dürfen im Start-Chunk wiederverwendet werden, statt sie aus Byte-Gründen nachzubauen.
- Neuer Code gehört weiter in nachgeladene Chunks, wo das ohne Nachteil für den ersten Bildschirm geht. M4 soll unter etwa 36,5 KB bleiben, damit für M5 Platz ist.
- Eine weitere Anhebung braucht einen neuen ADR.
