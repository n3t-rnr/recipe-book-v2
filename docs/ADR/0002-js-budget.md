# ADR 0002: JS-Budget je nachgeladenem Chunk statt Gesamtgrenze

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Betrifft:** NF-01 (Transfer- und Bundle-Budget)

## Kontext

NF-01 sah drei JS-Grenzen vor: Initial-Route ≤ 35 KB gzip und alle JS-Dateien zusammen ≤ 70 KB gzip. Nach M2 lag das Start-JavaScript bei 34,2 KB, die Summe aller Chunks bei 79,3 KB. Der größte Anteil ist der Editor-Chunk mit rund 24 KB, davon etwa 9 KB für die Eingabeprüfung mit `zod/mini` und den gemeinsamen Schemas (NF-28). Der Editor wird erst beim Öffnen geladen. Mit M3 bis M6 kommen weitere nachgeladene Seiten hinzu, die Summe wächst also weiter.

Für die gefühlte Geschwindigkeit zählt, was beim ersten Aufruf geladen wird. Die Summe aller Chunks lädt kein Gerät auf einmal.

## Entscheidung

Sebastian hat am 23.09.2026 entschieden:

- Das Start-JavaScript bleibt strikt bei **≤ 35 KB gzip** (seit ADR 0004: ≤ 38 KB). Dazu zählen alle Skripte und `modulepreload`-Chunks aus `index.html`.
- Jeder **nachgeladene JS-Chunk** darf höchstens **30 KB gzip** groß sein.
- Die **Summe aller Chunks** wird im Size-Check nur noch zur Information ausgegeben und ist keine Grenze mehr.
- Die Profilwahl gehört nicht mehr zur Initial-Route. Sie wird beim ersten Start nachgeladen, weil sie auf einem Gerät nur einmal gebraucht wird.

`scripts/size-check.ts` prüft das beim Build, `tests/unit/size-check.test.ts` sichert die Regeln ab.

## Folgen

- Die Startgeschwindigkeit bleibt geschützt. Neue Seiten müssen trotzdem schlank bleiben, weil jede einzeln begrenzt ist.
- Die Eingabeprüfung im Editor nutzt weiter die gemeinsamen zod-Schemas. Es gibt keine doppelten Regeln in Client und Server.
- Wächst ein Chunk über 30 KB, wird er aufgeteilt oder schlanker gemacht. Eine Anhebung braucht einen neuen ADR.
