# ADR 0003: RAM-Grenze im Leerlauf auf 100 MB

- **Status:** angenommen
- **Datum:** 2026-09-24
- **Betrifft:** NF-05 (Ressourcenverbrauch des Servers), Kap. 1.4, Kap. 5.1

## Kontext

NF-05 verlangte RSS ≤ 80 MB im Leerlauf und legte fest: Werden die Zielwerte mit der vorgesehenen Konfiguration verfehlt, entscheidet der Nutzer über Anpassung oder neue Grenzen. In M3 wurde auf dem Entwicklungs-PC (Windows 11, Node 24.14) gemessen:

| Zustand | Arbeitssatz (RSS) |
|---|---|
| Nacktes Node ohne App-Code | 50 MB |
| Plus Hono und better-sqlite3 (DB geöffnet) | 60 MB |
| Plus sharp geladen (`cache(false)`, `concurrency(2)`) | 67 MB |
| 10 min Leerlauf nach der Upload-Messreihe | 86 MB (privat 87 MB) |

Allein das Laden der sechs Laufzeit-Abhängigkeiten braucht damit 67 MB. Nach der Bildverarbeitung gibt der Speicher-Allocator von Windows einen Teil der Seiten nicht sofort an das System zurück. Das ist kein Leck, denn der Wert wächst bei weiteren Uploads nicht. 80 MB wären nur ohne sharp im Prozess oder mit einem eigenen Bildprozess erreichbar gewesen. Beides widerspricht „ein Prozess, ein Port“ (Kap. 5.4) oder kostet mehr, als es bringt.

## Entscheidung

Sebastian hat am 24.09.2026 entschieden: Die Grenze für RSS im Leerlauf steigt von 80 MB auf **≤ 100 MB**. Sie gilt nach 10 min Leerlauf und 10 min nach einem Upload.

Unverändert bleiben:

- ≤ 250 MB bei Bildverarbeitung mit zwei parallelen Uploads,
- 0 % CPU im Leerlauf,
- Start ≤ 1 s.

## Nachtrag vom 25.09.2026: Extremfälle

Mit dem genaueren Messverfahren aus dem M3-Review (RSS alle 5 ms während eines Bildjobs) hat eine Sitzung mit 24 ungewöhnlich schweren Uploads, darunter zwei PNG-Dateien mit 60 MP, den Leerlauf-Wert auf **111 MB** gehoben. Er blieb 10 s, 1, 3, 5 und 10 min nach dem letzten Upload gleich. Nach normalen Handyfotos liegt er weiter bei 86 MB. Der Speicher stammt aus dem Heap von libvips und Windows, den der Prozess nach der Spitze behält; er wächst bei weiteren Uploads nicht weiter.

Sebastian hat entschieden (Option a): Die 100-MB-Grenze gilt für den normalen Betrieb mit Handyfotos (JPEG bis 12 MP). Nach seltenen Extremfällen darf der Wert höher bleiben. Verworfen wurden eine Bildverarbeitung in einem kurzlebigen Hilfsprozess (mehr Code, erstes Foto nach einer Pause etwa 0,3 s langsamer) und eine Grenze von 120 MB.

## Folgen

- Der Abstand zur Grenze beträgt rund 14 MB. Neue Hintergrundaufgaben wie das Backup-Modul in M6 dürfen keinen dauerhaften Speicher halten (keine Caches ohne Grenze).
- Die Messung auf dem Ziel-PC bleibt Teil der Abnahme (M7, Kap. 9.5). Überschreitet sie 100 MB, ist ein neuer ADR nötig.
