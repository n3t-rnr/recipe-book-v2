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
| 25.09.2026 | Rezeptliste, Suchzeile (alle Größen) | Die Suchzeile bleibt beim Scrollen oben stehen. Ein Streifen in `--color-bg` deckt in einer iOS-Verknüpfung die Statusleiste ab (Außenabstand oben −safe-top, Innenabstand oben 12 px + safe-top). Ist der Server nicht erreichbar, sitzt die Zeile unter dem Banner (`--banner-h`); mit Banner in der iOS-Verknüpfung entsteht dadurch unter dem Banner ein leerer Streifen in Höhe von safe-top. | Kap. 6.3 verlangt ein „fixiertes Suchfeld“, das Artboard ist statisch. Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Rezeptliste, Suchfeld | Mit Text steht rechts im Feld eine 44-px-Schaltfläche „Suchbegriff löschen“ (Icon `close`, 22 px); der Innenabstand rechts sinkt dann von 18 auf 4 px. Mit Fokus hat das Feld 2 px Rahmen in Textfarbe und den 2-px-Fokusring, nur solange das Eingabefeld den Fokus hat. Die Zahl am Filtersymbol hat innen 5 px Abstand links und rechts, damit zweistellige Zahlen in den Kreis passen. | Kap. 6.3 nennt das Löschen-Icon, kein Artboard zeigt es. Fokus wie im Komponentenblatt (`input()` mit Fokus). Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Rezeptliste, Suchfeld (360 und 390 px, Listenspalte 380 px am Tablet quer) | Der Platzhalter „Rezepte, Zutaten, Tags suchen“ wird abgeschnitten. | Folgt aus den Werten des Artboards (52-px-Filterknopf, 18 px Innenabstand, 22-px-Icon) und dem Platzhaltertext aus Kap. 6.3. Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Rezeptliste, Chip-Reihe | Die Reihe scrollt waagerecht, statt überstehende Chips abzuschneiden (`overflow: hidden` im Artboard). Nach dem letzten Chip („Alle Tags …“) bleiben 20 px frei; unten 4 px Innenabstand für den Fokusring, durch −4 px Außenabstand ausgeglichen. Während die Tags laden, behält die Reihe ihre Höhe (58 px), damit nichts springt. | Kap. 6.3 verlangt eine „horizontal scrollbare Chip-Reihe“ mit bis zu 12 Tags plus aktiven Tags; abgeschnittene Chips wären nicht erreichbar (NF-07, NF-08). Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Rezeptliste, Zählzeile | Zwischen der Zahl („14 von 38 Rezepten“) und dem Sortier-Knopf stehen mindestens 8 px. Der Knopf heißt für Screenreader „Sortierung: Neueste“ (Präfix unsichtbar). | Das Artboard verteilt beides ohne Mindestabstand; lange Zahlen würden den Knopf berühren. Präfix für NF-11. Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Filter-Sheet (Handy) und Filter-Panel (Tablet quer) | Ohne die M5-Bedienelemente „Nur Favoriten“, „Mindestbewertung“, „Beste Bewertung“, „Meine Bewertung“ und „Zuletzt geändert“. Am Handy bleibt im Sheet voller Höhe deshalb unter „Filter zurücksetzen“ freie Fläche. | Die Funktionen folgen in M5 (F-25, F-43, F-44). Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Filter-Sheet und Filter-Panel, Sortierung | Mit Suchbegriff erscheint vor „Neueste“ der Chip „Relevanz“ (vorausgewählt); ohne Suchbegriff fehlt er wie im Artboard. | F-26: „Relevanz (Standard bei Suchbegriff)“. Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Filter-Panel (Tablet quer, ab 1024 px) | Höchstens 100dvh − 80 px hoch, der Inhalt scrollt darin; ein Klick außerhalb schließt das Panel. Es überlappt die Listenspalte um 64 px wie im Artboard; Abstand im Inhalt 12 px wie im Artboard `tabletFilter`. | Bei 768 px Höhe passt der Inhalt nicht immer ganz hinein. Abweichung zur Freigabe durch Sebastian. |
| 25.09.2026 | Filter-Sheet, Rezeptliste (ohne sichtbare Änderung) | „Alle müssen passen / Einer reicht“ ist eine Radiogruppe (`role="radio"`, Pfeiltasten) statt der Tab-Liste des Artboards. Die Kopfzeile der Liste liegt eine Ebene über der Suchzeile (`z-index: 21`). | Semantik und Tastaturbedienung (NF-11); die Optik bleibt gleich. Zur Freigabe durch Sebastian. |
| 25.09.2026 | Neues Rezept und Rezept bearbeiten, Tag-Feld | „Häufig verwendet“ zeigt bis zu 6 Chips statt 3, in der Reihenfolge des Servers (Anzahl, dann Name); auf einer neuen Installation füllen die ungenutzten Start-Tags die Reihe. Tag-Namen bis 40 Zeichen enden in den Moonstone-Chips des Felds und in den Plus-Chips mit „…“; der zugängliche Name bleibt vollständig. Der unsichtbare Hinweis des Felds nennt jetzt auch die Pfeiltasten. | Mehr Auswahl ohne Tippen (F-18, F-20). Ohne Kürzung scrollte die Seite bei 360 und 390 px waagerecht (NF-08). Abweichung zur Freigabe durch Sebastian. |

### Neue Screens und Zustände ohne Artboard (M4, zur Freigabe durch Sebastian)

Diese Teile sind nur aus Tokens und Bausteinen des Komponentenblatts gebaut. Sie kommen in den Screenshot-Satz für M7 (NF-16, Kap. 9.6), hell und dunkel, und brauchen Sebastians Freigabe.

- **Rezeptliste, Suche ohne Treffer (F-23, F-33):** Leerzustand mit Teller, „Nichts gefunden für ‚q‘“, darunter „Meintest du:“ mit dem Vorschlag als Textknopf, dann primär 52 px „Rezept ‚q‘ anlegen“ und Outline 52 px „Filter zurücksetzen“. Nur mit Tag-Filtern: „Keine Rezepte mit diesen Filtern“ mit „Filter zurücksetzen“, ohne „anlegen“. Lange Suchbegriffe brechen um; als Titel übernimmt „anlegen“ höchstens die ersten 120 Zeichen, ohne ein halbes Emoji am Ende.
- **Filter-Sheet, Tag-Bereich:** Laden (6 Platzhalter-Chips), Fehler (Meldung und Outline-Knopf 44 px „Erneut versuchen“), leer („Noch keine Tags“), Tag-Suche ohne Treffer („Kein Tag gefunden“).
- **Filter-Sheet am Tablet hochkant (600–1023 px):** 560 px breit, mittig, so hoch wie der Inhalt.
- **Tag-Seite `/tags` (F-19, F-20):** Kopfzeile wie die anderen Hauptziele (ScreenHeader mit Avatar, ohne Zurück; Entscheidung vom 25.09.2026, F-34). Inhalt höchstens 760 px breit. Suchfeld und „Neuer Tag“; unter etwa 400 px rutscht „Neuer Tag“ unter das Suchfeld (Mindestbreite 12rem). Je Tag eine Zeile (Innenabstand 8 px oben und unten) mit Zähl-Chip, der die gefilterte Liste öffnet, und ⋮-Menü. Zustände: Liste, Laden (6 Balken in 60-px-Zeilen), leer, Fehler mit „Erneut versuchen“, Suche ohne Treffer mit „Tag ‚q‘ anlegen“ (der Knopf bricht bei langen Namen um), Abstand 24 px über den Zuständen, 32 px unten.
- **Tag-Seite, Formulare und Dialoge:** Umbenennen direkt in der Zeile, auch mit Fehlermeldung; Formular „Neuer Tag“. Feld und Fehler stehen untereinander, die Knöpfe mit 16 px Abstand. Das Namensfeld zeigt den Platzhalter „Name des Tags“ wie die kompakten Felder des Komponentenblatts („Menge“, „Einheit“). Nach dem Speichern bleiben Formular oder Dialog mit dem arbeitenden Knopf offen, bis die neu geladene Liste da ist; erst dann folgen Meldung, Schließen und Fokus. Namen bis 40 Zeichen brechen in Chips und Titeln um.
- **Tag-Seite, Menü und Sheets:** Menü je Tag („Umbenennen“, „Zusammenführen mit …“ mit Icon `tag`, „Löschen“), Sheet „Zusammenführen mit …“ mit Tag-Suche und den Zielen als Chips (Variante `action`), Dialoge „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen“ und „Von 4 Rezepten entfernen?“. Die Seite ersetzt ihre eigene vorige Meldung, statt Meldungen zu stapeln.
- **Tag-Seite, Verhalten bei Netzfehlern (NF-09, NF-11):** Scheitert „Aktualisieren“, das Laden beim Öffnen oder nach der Wiederverbindung, zeigt die Seite die Meldung aus Kap. 6.6 („Das dauert zu lange“ mit „Erneut versuchen“ nach 10 s, bei anderen Fehlern nur den Text; ohne Verbindung erscheint stattdessen das Banner), auch auf der leeren Seite „Noch keine Tags“. Nur der Fehlerzustand mit eigenem „Erneut versuchen“ bleibt ohne Meldung. Kommt nach Umbenennen, „Neuer Tag“ oder Löschen die neu geladene Liste nicht, geht der Fokus sofort auf das ⋮ der Zeile (oder ins Suchfeld), statt auf einen zweiten Ladeversuch zu warten.
- **Tag-Feld im Editor, Vorschlagsliste (F-18):** Beim Tippen ersetzen „Vorschläge“ und bis zu 6 Optionen die Reihe „Häufig verwendet“. Jede Option ist ein Plus-Chip wie im Artboard `tagEditor()` mit der Rezeptanzahl in Schriftstärke 500 („Vegetarisch 12“). Die mit den Pfeiltasten markierte Option zeigt den Fokusring (2 px `--color-focus`, Abstand 2 px), keine andere Farbe (NF-13). Ändert sich die Liste, scrollt sie über die Speichern-Leiste; ist dafür zu wenig Höhe (Handy quer), bleibt das Tag-Feld sichtbar (Scroll-Abstand 12 px). Strg/Cmd+Enter bei markierter Option speichert das Rezept mit dieser Option, nicht mit dem getippten Anfang (F-18: „Enter oder Komma übernimmt den markierten Vorschlag“). Verlässt der Fokus das Feld (Tab, Klick daneben), wird dagegen der getippte Text zum Chip.

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
