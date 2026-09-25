# Design – Rezepte-App

**Stand:** Meilenstein M1 ist abgeschlossen. Sebastian hat Richtung C „Bildlastig“ gewählt und die Mockups am 23.09.2026 freigegeben. Die Werte stehen in `client/src/styles/tokens.css` und `shared/constants.ts`; der Kontrasttest (NF-13) ist grün.

| Schritt | Inhalt | Status |
|---|---|---|
| 1 | Drei Richtungs-Skizzen (Low-Fi) | erledigt am 23.09.2026 |
| 2 | Auswahl einer Richtung durch Sebastian | erledigt: C · Bildlastig |
| 3 | Statische Mockups, Komponenten- und Token-Blatt, App-Icon | erledigt am 23.09.2026 |
| 4 | Freigabe; Werte gehen ohne Rundung in `tokens.css` und `shared/constants.ts` | erledigt am 23.09.2026 |

Vollständige Vorgaben: [Anforderungskatalog, Kap. 6 und Meilenstein M1 in Kap. 8](../ANFORDERUNGSKATALOG.md).

## Canvas

Link: https://claude.ai/artifact/D6myhCx8Hg8RJgDiGKH2v7 (privat, nur für den Eigentümer sichtbar, solange er nicht über „Teilen“ freigegeben wird)

**Seite „Mockups C“:**

| Reihe | Artboards |
|---|---|
| Handy hell und dunkel (390×844) | Profilwahl, Rezeptliste, Filter-Sheet, Rezeptdetail (ganze Seite), Neues Rezept (ganze Seite), Favoriten |
| Tablet quer hell und dunkel (1024×768) | Liste und Detail nebeneinander, Rezept bearbeiten (zweispaltig), Filter-Panel neben der Liste |
| Tablet hochkant (768×1024) | Rezeptliste im 2-Spalten-Raster, Rezeptdetail mit Zutaten neben den Schritten, jeweils hell und dunkel |
| Grundlagen | Komponenten und Zustände hell und dunkel, Token-Blatt, App-Icon und Favicon |

**Seite „Richtungen“:** die drei ursprünglichen Skizzen A, B und C.

## Platzhalterbild für Rezepte ohne Foto

Rezepte ohne Foto zeigen ein Platzhalterbild: einen Teller mit Besteck und dem Anfangsbuchstaben des Titels. Die Farbe kommt fest aus der Rezept-ID, damit ein Rezept überall gleich aussieht. Im Detail liegt darauf die Schaltfläche „Foto hinzufügen“. Umsetzung als Inline-SVG ohne zusätzlichen Request; Akzeptanzkriterium unter F-16 im Katalog.

| Token | Hell (Fläche) | Dunkel |
|---|---|---|
| `--placeholder-1` | `#F3DFA2` | Fläche `--color-surface`, Teller in dieser Farbe |
| `--placeholder-2` | `#7EBDC2` | wie oben |
| `--placeholder-3` | `#E8B7A9` | wie oben |
| `--placeholder-4` | `#DCCFC2` | wie oben |

Im Mockup stehen dunkle Flächen mit Bildsymbol für echte Fotos.

## Festlegungen aus den Mockups

- **Schriften:** Bricolage Grotesque für Überschriften (700/800) und Figtree für Text (400/600/700). Im Canvas kommen sie von Google Fonts, in der App werden sie selbst gehostet (NF-15).
- **Kartenbild:** Seitenverhältnis 3:2, am Handy 350×233. Daraus folgt Variante s mit 720×480, dazu m mit 1200 px und l mit 2048 px (F-15).
- **Navigation:** Am Handy und Tablet hochkant eine schwebende dunkle Leiste, am Tablet quer eine Leiste links mit „Neu“ oben und Avatar unten.
- **Dark Mode:** Primärflächen `#D9634F` mit dunkler Schrift, Text in Primärfarbe `#F57C67`, Navigation `#373334`. Alle Werte stehen mit Kontrast im Token-Blatt.

## Freigegebene Abweichungen von den Artboards (NF-16)

| Datum | Screen | Abweichung | Grund |
|---|---|---|---|
| 25.09.2026 | Rezeptdetail, Handy und Tablet hochkant | Oben rechts über dem Foto sitzt der Avatar für den Profilwechsel, auf derselben runden Fläche wie Menü und Bearbeiten (48 px). Im Artboard fehlt er. | F-03 verlangt den Wechsel mit 2 Fingertipps auch aus dem Detail; Entscheidung von Sebastian. |
| 25.09.2026 | Neues Rezept und Rezept bearbeiten, Zutatenzeilen (Handy und Tablet) | Die Felder „Menge“ und „Einheit“ behalten die Breiten der Artboards (72 und 88 px, in der einzeiligen Zeile 64 und 76 px), haben innen aber links und rechts 5 px statt 12 px Abstand (4,5 px mit Fokus- oder Fehlerrahmen). Der Text beginnt dadurch 7 px weiter links. Der Pfeil der Einheiten-Vorschläge ist ausgeblendet; die Vorschläge erscheinen weiter beim Tippen. | Mit 12 px Abstand waren „Menge“, „Einheit“ und längere Einheiten wie „Packung“ und „Scheibe“ abgeschnitten, in Chrome wegen des 21 px breiten Pfeils auch „Stück“, „Bund“ und „Prise“. Die Artboards zeigen nur kurze Werte („g“). Abweichung zur Freigabe durch Sebastian. |

## Farbpalette (verbindlich)

Quelle: https://coolors.co/231f20-bb4430-7ebdc2-f3dfa2-efe6dd

| Name | Hex | Rolle | Kontrastregel |
|---|---|---|---|
| Linen | `#EFE6DD` | Hintergrund hell, Text dunkel | Raisin Black darauf 13,22:1 |
| Raisin Black | `#231F20` | Text hell, Hintergrund dunkel | – |
| Terracotta | `#BB4430` | Primäraktion, FAB, Favoriten-Herz, aktive Zustände | Weiß darauf 5,27:1; als Text auf Linen nur ab 24 px (4,28:1) |
| Terracotta dunkel | `#D9634F` | Primärfarbe im Dark Mode | Raisin Black darauf 4,54:1 |
| Moonstone | `#7EBDC2` | Tag-Chips, sekundäre Flächen | nur Fläche mit dunklem Text (7,72:1), nie Textfarbe |
| Vanilla | `#F3DFA2` | Sterne, Zeitangabe, Hinweise | nur Fläche mit dunklem Text (12,33:1), nie Textfarbe |

## Arbeitsdateien

- [canvas/project/](canvas/project/) enthält alle Artboards und die Canvas-Übersicht `canvas.json`.
- [canvas/generate-mockups.mjs](canvas/generate-mockups.mjs) erzeugt die Mockups der Richtung C aus gemeinsamen Bausteinen, damit Hell und Dunkel identisch bleiben. Aufruf: `node docs/design/canvas/generate-mockups.mjs docs/design/canvas/project`. Achtung: Das Skript überschreibt die Artboards. Änderungen, die direkt im Canvas gemacht wurden, müssen vorher zurückgeholt werden.
