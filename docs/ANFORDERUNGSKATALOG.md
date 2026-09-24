# Rezepte-App v2 – Planung und Anforderungskatalog

| Feld | Inhalt |
|---|---|
| Projekt | recipe-book-v2 (github.com/n3t-rnr/recipe-book-v2) |
| Stand | 23.09.2026, Entwurf zur Freigabe durch Sebastian (überarbeitet nach Review) |
| Umfang | 74 Anforderungen: 45 funktional (F), 29 nicht-funktional (NF); 57 Muss, 13 Soll, 4 Kann |
| Stack (Kurzform) | Svelte 5 als SPA + Vite 8.3 · Node.js 24 LTS + Hono 4 · SQLite über better-sqlite3 mit FTS5 · sharp für Bilder · ein Prozess, ein Port, ein Datenordner · Windows-Dienst über WinSW |
| Aufwand | 16–21 Personentage in 8 Meilensteinen (M0–M7), zuzüglich Wartezeit auf Design-Entscheidungen |

**Prioritäten:** *Muss* = ohne diese Anforderung wird Release 1.0 nicht abgenommen. *Soll* = für Release 1.0 geplant; nur nach Rücksprache verschiebbar. *Kann* = wird nur gebaut, wenn alle Muss- und Soll-Anforderungen abgenommen sind; sonst Backlog.

**Begriffe:**

- **Prototyp v1** = das verworfene Repository `recipe_book` (Vue 3, Fastify 4, Prisma). „v1“ steht in diesem Dokument nur dafür.
- **Release 1.0** = die erste abgenommene Auslieferung dieser App (Git-Tag `v1.0.0`), auch „MVP“.
- Rezept, Zutat, Zubereitungsschritt, Tag, Bewertung, Favorit, Profil.
- **Beschreibung** = das freie Textfeld eines Rezepts (Spalte `description`); es gibt keinen separaten Feldnamen „Notizen“.
- **Browser-Tab** = Registerkarte des Browsers. Die Navigationsziele der App heißen **Ansichten** (z. B. „Favoriten-Ansicht“).
- **Fingertipp** = einmaliges Antippen eines Bedienelements (Wegzählung „≤ 3 Fingertipps“).
- **Verknüpfung auf dem Startbildschirm** = Lesezeichen-Icon auf dem Home-Bildschirm; keine installierte App im Sinne einer PWA.
- Code-Bezeichner, Dateinamen und Bibliotheksnamen bleiben englisch.

---

## 1. Kontext und Ziele

### 1.1 Warum eine neue App

Der Prototyp v1 (Vue 3, Fastify 4, Prisma/SQLite) kam nie über drei Screens hinaus, und es wurde nie ein Rezept gespeichert. Die Ursachen sind bekannt und prägen diese Planung:

| Fehler im Prototyp v1 | Konsequenz |
|---|---|
| Zutaten, Schritte und Tags als JSON-Strings in TEXT-Spalten; Tag-Filter per Teilstring-Hack | Vollständig relationales Modell (Kap. 4); Tag-Filter über Verknüpfungstabelle |
| Tag-Regex `^[a-z0-9._-]{1,32}$` lehnte Umlaute und Leerzeichen ab | Tags erlauben beliebiges Unicode; Gleichheit, Suche und Sortierung über eine deutsche Normalisierung (F-17, F-22, Kap. 4.4) |
| Bild-Upload konfiguriert, aber nie gebaut | Bilder sind Muss (F-14 bis F-16) und haben einen eigenen Meilenstein (M3) mit Gerätetest |
| Bewertungen ohne Identität, `userId` aus dem Request-Body | Identität nur aus dem Header `X-Profile-Id`, mit Manipulationstest (F-05) |
| Keine Tests, kein Lint, kein Typecheck | Qualitäts-Gate `pnpm verify` ab M0 (NF-28, NF-29) |
| Docker schrieb die DB außerhalb des Volumes, SPA-Deep-Links lieferten hinter nginx 404 | Kein Docker, kein nginx: ein Node-Prozess mit SPA-Fallback und einem Datenordner (NF-18, NF-22, F-34) |
| Optimistisches Sperren vom Client ausgehebelt | Version wird nur serverseitig geprüft und gesetzt (F-07) |
| Felder im Schema ohne Oberfläche (prepMinutes, notes …) | UI-first: jede Spalte hat eine Oberfläche oder eine technische Begründung; Wachstumspfade stehen im Backlog, nicht im Schema |

### 1.2 Zielbild

Eine leichtgewichtige Web-App, die auf einem Windows-PC im Heimnetz läuft und im Browser von Handy, Tablet und PC bedient wird. Alle Profile teilen sich die Rezepte; Bewertungen und Favoriten gehören je einem Profil. Rezepte lassen sich mit Foto, strukturierten Zutaten, Zubereitungsschritten und Tags schnell erfassen, umlautsicher finden und nach Tags, Favoriten und Bewertung filtern.

Leitprinzipien:

1. **Bedienbarkeit vor Funktionsfülle:** Daumenzone, wenige Fingertipps, Rückgängig statt Nachfragen, große Tippflächen für die Küche.
2. **Leichtgewicht in Zahlen:** Budgets für JS, CSS, Schriften, RAM, Latenz und Abhängigkeiten (NF-01 bis NF-05), automatisch geprüft.
3. **Deutsch überall richtig:** Umlaute, ß, Dezimalkomma und Sortierung nach DIN 5007-1.
4. **Ein Prozess, ein Port, ein Datenordner:** Backup heißt Ordner kopieren.
5. **Ehrlich zu den Grenzen von http im LAN:** Die App verspricht nichts, was ohne sicheren Kontext nicht geht (NF-26).
6. **Jeder Meilenstein ist auf dem Handy nutzbar:** Der Fehler des Prototyps v1 „nie vom Handy benutzt“ wird ab dem ersten Tag ausgeschlossen.

### 1.3 Abgrenzung

In Release 1.0 enthalten: Profile ohne Passwort; Rezepte anlegen, bearbeiten und löschen (mit Papierkorb); strukturierte Zutaten mit Textmodus; Zubereitungsschritte; ein Bild je Rezept; mehrere Tags je Rezept; Volltextsuche; Filter nach Tags, Favoriten und Bewertung; Bewertung und Favoriten je Profil; Backup, Export, Verbinden-Seite; Betrieb als Windows-Dienst.

Nicht in Release 1.0: Zugriff aus dem Internet, Nutzerkonten mit Passwort oder Rechten, Offline-Betrieb/PWA mit Service Worker, native Apps, mehrere Bilder je Rezept, Einkaufsliste, Wochenplan, URL-Import, Nährwerte, Import von Sicherungen, Mehrsprachigkeit, HTTPS. Details in Kap. 3.3.

### 1.4 Erfolgskriterien

| Kriterium | Messung | Zielwert |
|---|---|---|
| Schnelle Erfassung | Rezept aus einem Kochbuch mit 10 Zutaten und 5 Zubereitungsschritten am Tablet (Foto + Textmodus F-12), Stoppuhr | ≤ 3 min |
| Schnelle Skizze | Nur Titel und Foto am Handy | ≤ 30 s |
| Finden | Bekanntes Rezept unter 200 Rezepten über Suche oder Tag-Chips | ≤ 10 s, ≤ 3 Fingertipps |
| Profilwechsel | Von jeder Hauptansicht | ≤ 2 Fingertipps |
| Neues Gerät verbinden | QR-Code scannen bis Profilwahl | ≤ 1 min |
| Leichtgewicht | Initial-JS (gzip) / RAM des Servers im Leerlauf | ≤ 35 KB / ≤ 80 MB |
| Zuverlässigkeit | PC-Neustart ohne Anmeldung; Wiederherstellung aus Backup | App erreichbar; Wiederherstellung einmal real erfolgreich |
| Qualität | Muss-Akzeptanzkriterien auf 4 Geräteklassen (Android-Handy, iPhone, iPad, Windows-PC) | 100 % erfüllt |
| Nutzung (Beobachtung, kein Abnahmekriterium) | Vier Wochen nach Abnahme | ≥ 30 Rezepte, von ≥ 2 Profilen bewertet |

---

## 2. Nutzer und Nutzungsszenarien

### 2.1 Personas

| Persona | Geräte | Ziele | Folgerungen für die App |
|---|---|---|---|
| Betreiber und Haupterfasser (z. B. Sebastian) | Windows-PC, Tablet, Handy | Server einrichten und aktualisieren, viele Rezepte erfassen, Tags pflegen, Daten sichern | Schnelle Erfassung (Foto zuerst, Zutaten als Text), Tag-Verwaltung, Backup und Status, klare Betriebsanleitung |
| Mitkochende Person (z. B. Anna) | Handy, Tablet auf der Arbeitsplatte | Nach Rezept kochen, bewerten, Favoriten markieren | Große Schrift, abhaken, wenige Fingertipps, keine Einrichtung außer einmal QR scannen |
| Gelegenheitsnutzer (Familienmitglied, Gast im WLAN) | Eigenes Handy | Ideen finden, etwa „vegetarisch und schnell“ | Selbsterklärende Suche mit Tag-Chips, Profil mit einem Fingertipp, keine Anmeldung |

Rahmen: 2–6 Profile, 50–1.000 Rezepte, 1–3 gleichzeitig genutzte Geräte, wechselnde WLAN-Qualität in der Küche, teils nasse oder fettige Finger.

### 2.2 Szenarien

| ID | Situation (Gerät) | Ablauf | Bezug |
|---|---|---|---|
| S1 | Ersteinrichtung eines Handys (Android) | Am PC „Mehr → Anderes Gerät verbinden“ öffnen; Anna scannt den QR-Code mit der Kamera-App; Chrome öffnet `http://192.168.178.20:8080`; sie tippt auf „Anna“ und legt eine Verknüpfung auf dem Startbildschirm an. Ziel ≤ 1 min. | F-39, F-02, F-37 |
| S2 | Rezept aus dem Kochbuch erfassen (iPad) | „+“ → „Foto aufnehmen“ (der Upload läuft im Hintergrund) → Titel → Tags per Autovervollständigung → Zutaten im Textmodus abtippen → Zubereitung als Text mit Absätzen → Speichern. Ziel ≤ 3 min. | F-06, F-12, F-14, F-18 |
| S3 | Schnelle Idee (Handy) | Titel „Omas Linsensuppe“ und Foto, Speichern; der Rest folgt später am PC. Ziel ≤ 30 s. | F-06, F-09 |
| S4 | Kochen am Tablet auf der Arbeitsplatte (quer, 1024×768) | Liste links, Rezeptdetail rechts; Zutaten beim Bereitstellen abhaken; große, nummerierte Zubereitungsschritte. | F-29, F-30, F-31 |
| S5 | Gast sucht „vegetarisch und schnell“ (Handy) | Profil wählen oder anlegen; in der Chip-Reihe „Vegetarisch“ und „Schnell“ antippen (2 Fingertipps); Ergebnisse mit Bildern. | F-24, F-02 |
| S6 | Nach dem Essen bewerten (Handy) | Rezept öffnen, 4. Stern und Herz antippen. Sebastian sieht „Ø 4,5 (2)“, sobald er in seinen Browser-Tab zurückkehrt, am dauerhaft offenen Küchen-Tablet spätestens nach 70 s. | F-27, F-28, F-36 |
| S7 | Zwei Geräte bearbeiten gleichzeitig | Sebastian korrigiert am PC Mengen, Anna ergänzt am Handy einen Tag. Anna speichert als Zweite und sieht den Konfliktdialog. „Neu laden“ zeigt Sebastians Fassung und bietet an, ihre geänderten Felder (Tags) zu übernehmen; nichts von ihrer Eingabe geht verloren. | F-07 |
| S8 | Versehentlich gelöscht (Handy, nasse Finger) | Rezept gelöscht → Toast „Rückgängig“. Wurde der Toast übersehen: Mehr → Papierkorb → Wiederherstellen. | F-08 |
| S9 | Tags aufräumen (Desktop) | „Nachtisch“ in „Dessert“ zusammenführen (Bestätigung nennt 7 betroffene Rezepte); Tippfehler-Tag löschen. | F-19 |
| S10 | Betrieb nach Windows-Update | Windows startet nachts neu; der Dienst läuft ohne Anmeldung wieder an; das verpasste 03:00-Backup wird nachgeholt; unter „Status“ steht das letzte Backup. | NF-22, F-40, F-42 |

---

## 3. Anforderungskatalog

Jede Anforderung hat eine ID, eine Priorität und ein oder mehrere Akzeptanzkriterien (AK), die ein Tester ohne Interpretationsspielraum prüfen kann. „API-Test“ heißt: automatisierter Test gegen die Hono-App mit `app.request()` und einer `:memory:`-Datenbank; sofern nicht anders genannt, setzt er `X-Rezepte-Client: 1`. „Injizierte Uhr“ heißt: Der Test ersetzt die Zeitquelle des Servers. Die IDs F-43 bis F-45 sind bei der Überarbeitung entstanden und stehen thematisch bei ihrer Gruppe. Wird eine Prüfung an mehreren Stellen gebraucht, steht sie nur bei einer ID; andere Stellen verweisen darauf.

### 3.1 Funktionale Anforderungen

#### 3.1.1 Profile

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-01 | Profil anlegen | Profil mit Namen (1–40 Zeichen, beliebiges Unicode inkl. Umlaute und Leerzeichen) und einer von 6 Avatarfarben (`--avatar-1` … `--avatar-6`, Kap. 6.7). Kein Passwort. | Muss |
| F-02 | Profil wählen und auf dem Gerät merken | Beim ersten Öffnen erscheint die Profilwahl (Kacheln + „Neues Profil“); gibt es noch kein Profil, erscheint direkt das Namensfeld. Die Auswahl wird in `localStorage` gespeichert, spätere Aufrufe starten in der Rezeptliste. | Muss |
| F-03 | Profil mit zwei Fingertipps wechseln | Die Avatar-Schaltfläche (Handy und Tablet hochkant oben rechts, sonst in der Navigationsleiste links) öffnet ein Sheet mit allen Profilen. Der Avatar zeigt die Initiale, bei gleichen Initialen zweier Profile zwei Buchstaben. | Muss |
| F-04 | Profil umbenennen und löschen | Name und Farbe sind änderbar. Beim Löschen verschwinden die Bewertungen und Favoriten des Profils; Rezepte bleiben erhalten. | Soll |
| F-05 | Identität nur aus dem Profil-Header | Personenbezogene Schreibaktionen (Bewertung, Favorit, Autor beim Anlegen, Ändern oder Löschen) übernehmen das Profil ausschließlich aus `X-Profile-Id`. Der Server prüft bei jeder Anfrage mit diesem Header, ob das Profil existiert. Begründung: Fehler des Prototyps v1. | Muss |

Akzeptanzkriterien:

- **F-01**
  - „Jörg Müller“ anlegen → erscheint unverändert und in der gewählten Farbe in der Profilwahl.
  - Ist „Sebastian“ vorhanden, werden „sebastian“ und „SEBASTIAN“ mit 409 `NAME_EXISTS` abgelehnt; die UI zeigt „Name bereits vergeben“; die DB enthält kein Duplikat.
  - Ist der Name leer oder besteht nur aus Leerzeichen, bleibt die Schaltfläche deaktiviert; der direkte API-Aufruf liefert 400 `VALIDATION` mit `details[0].field = "name"`.
- **F-02**
  - „Anna“ wählen, Seite neu laden → die Liste erscheint direkt, der Avatar zeigt „A“.
  - Ist das gemerkte Profil serverseitig gelöscht (401 `PROFILE_UNKNOWN`), erscheint die Profilwahl mit dem Hinweis „Profil nicht mehr vorhanden“ statt einer Fehlermeldung.
  - Eine iOS-Verknüpfung auf dem Home-Bildschirm hat einen eigenen Speicher: Beim ersten Öffnen erscheint die Profilwahl, und die Auswahl gelingt mit einem Fingertipp.
  - Leere Datenbank: Das Namensfeld hat den Fokus; Enter legt das Profil an und öffnet die Liste.
- **F-03**
  - Aus Liste, Detail, Favoriten-Ansicht und Tags gelingt der Wechsel mit genau zwei Fingertipps (Avatar → Kachel).
  - Nach dem Wechsel zeigen Herzen, eigene Sterne und die Favoriten-Ansicht innerhalb von 1 s die Daten des neuen Profils, ohne dass die Seite neu lädt.
  - Existieren „Anna“ und „Andreas“, zeigen die Avatare „An“ und „Ad“ (erster Buchstabe plus erster abweichender Buchstabe).
- **F-04**
  - Umbenennen von „Anna“ in „Anna K.“ ändert alle Anzeigen, auch die Einzelbewertungen im Detail und „angelegt von“.
  - Löschen nennt die Zahl der verlorenen Bewertungen und Favoriten und verlangt eine Bestätigung; danach bleiben die Rezepte erhalten, als Autor erscheint „unbekannt“ (F-29).
  - Das letzte verbleibende Profil lässt sich nicht löschen (409 `LAST_PROFILE`, deutsche Meldung).
- **F-05**
  - `PUT /api/v1/recipes/1/rating` mit `X-Rezepte-Client: 1` und ohne `X-Profile-Id` → 401 `PROFILE_REQUIRED`; mit unbekannter ID → 401 `PROFILE_UNKNOWN`.
  - Ein Body-Feld `profileId` mit fremder ID wird ignoriert; die Bewertung gehört dem Header-Profil (API-Test).
  - Lesende Aufrufe ohne `X-Profile-Id` funktionieren; `myRating` und `isFavorite` sind dann `null`. Ein vorhandener, aber unbekannter `X-Profile-Id` liefert auch bei lesenden Aufrufen 401 `PROFILE_UNKNOWN`.
  - `GET /recipes?fav=1` oder `?sort=myRating` ohne `X-Profile-Id` → 401 `PROFILE_REQUIRED` (API-Test).

#### 3.1.2 Rezepte

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-06 | Rezept anlegen | Pflicht ist nur der Titel (1–120 Zeichen). Optional: Beschreibung (≤ 2.000), Portionen (0,25–100) mit Einheit (Portionen, Stück, Personen oder frei, ≤ 20 Zeichen), Vorbereitungszeit und Koch-/Backzeit (je 1–1.440 min; leer = nicht gesetzt), Quelle (≤ 500), Zutaten, Zubereitungsschritte, Tags, ein Bild. Foto, Titel, Tags, Zutaten und Zubereitung sind sichtbar; die übrigen Felder stehen eingeklappt unter „Weitere Angaben“. | Muss |
| F-45 | Hinweis auf ähnliche Rezepte | Beim Tippen des Titels (Debounce 300 ms, ab 4 Zeichen) zeigt der Editor einen nicht blockierenden Hinweis „Ähnliches Rezept vorhanden: Käsespätzle (Sebastian)“ mit Link, wenn ein aktives Rezept denselben `title_key` hat oder die Damerau-Levenshtein-Distanz der Schlüssel ≤ 1 (4–6 Zeichen) bzw. ≤ 2 (ab 7 Zeichen) beträgt (dieselbe Funktion wie F-23). Höchstens 3 Treffer. | Soll |
| F-07 | Rezept bearbeiten mit Konfliktschutz | Alle Felder sind änderbar. Gleichzeitige Änderungen erkennt eine Versionsnummer, die nur der Server prüft und setzt. Im Konfliktfall gehen keine Eingaben verloren. Begründung: Fehler des Prototyps v1. | Muss |
| F-08 | Löschen mit Papierkorb und Rückgängig | Löschen verschiebt das Rezept ohne Vorab-Dialog in einen Papierkorb (30 Tage), aus dem es wiederhergestellt werden kann; ein Toast bietet 8 s lang „Rückgängig“. Wer gelöscht hat, wird gespeichert (`deleted_by`). Begründung: Ohne Anmeldung kann jedes Gerät löschen; der Papierkorb ist das Sicherheitsnetz. | Muss |
| F-09 | Entwurfsschutz im Editor | Der Editor sichert Eingaben alle 2 s in `localStorage` (`draft:new` bzw. `draft:<id>`) und bietet nach Abbruch, Absturz oder Schließen des Browser-Tabs die Wiederherstellung an. | Muss |

Akzeptanzkriterien:

- **F-06**
  - Nur Titel → Speichern legt das Rezept an, öffnet die Detailansicht, und das Rezept steht in der Liste.
  - „Käsespätzle“ mit 3 Zutaten, 2 Zubereitungsschritten und 2 Tags → das Detail zeigt alle Angaben unverändert inkl. Umlauten.
  - Bei leerem Titel ist Speichern deaktiviert und am Feld steht ein Hinweis; ein Titel mit 121 Zeichen per API → 400 `VALIDATION` mit `details[0].field = "title"`.
  - `created_by` ist das aktive Profil; das Detail zeigt „angelegt von Sebastian am …“.
- **F-45**
  - Ist „Käsespätzle“ vorhanden, zeigt die Eingabe „käsespätzle“ oder „Kasespatzle“ den Hinweis mit Link; Speichern bleibt möglich und legt ein zweites Rezept an.
  - „Linsensuppe“ zeigt bei vorhandenem „Käsespätzle“ keinen Hinweis; Rezepte im Papierkorb lösen keinen Hinweis aus (API-Test `GET /recipes/similar`).
- **F-07**
  - Eine Titeländerung ist nach dem Speichern in Detail und Liste sichtbar; `version` steigt um genau 1.
  - Gerät A und B öffnen dasselbe Rezept; A speichert, dann B → Dialog „Inzwischen von Anna geändert“ mit „Neu laden“ und „Meine Version speichern“.
  - „Neu laden“ zeigt die Serverfassung, markiert die Felder, die auf Gerät B geändert wurden, und bietet je Feld „Meine Änderung übernehmen“ an; bis zum Speichern bleibt der lokale Entwurf (F-09) erhalten.
  - `PUT` mit `version = 999` → 409 `VERSION_CONFLICT`, der aktuelle Stand steht in `details.current`, der Datensatz bleibt unverändert. Überschreiben gelingt nur mit `?force=1`; der Server setzt die Version selbst (alte Version + 1).
  - Wurde das Rezept inzwischen auf einem anderen Gerät gelöscht, liefert `PUT` 410 `IN_TRASH`; der Editor zeigt „Von Anna in den Papierkorb gelegt – wiederherstellen und speichern?“, alle Eingaben bleiben erhalten, und die Bestätigung stellt wieder her und speichert.
- **F-08**
  - Löschen verschiebt das Rezept ohne Vorab-Dialog in den Papierkorb und zeigt 8 s lang „Rezept gelöscht – Rückgängig“. Rückgängig stellt es inkl. Bild, Tags, Bewertungen und Favoriten wieder her.
  - Der Papierkorb (Mehr → Papierkorb) zeigt Titel, gelöscht von, Löschdatum und Resttage; „Wiederherstellen“ wirkt sofort.
  - Nach 30 Tagen wird das Rezept endgültig gelöscht (Test mit injizierter Uhr); seine Bilddateien wandern nach `images/.trash/` (F-16).
  - „Endgültig löschen“ im Papierkorb verlangt eine Bestätigung mit dem Titel; danach gibt es keine DB-Zeilen des Rezepts mehr, und `count(recipes_fts) = count(recipes)` (API-Test).
- **F-09**
  - Titel und zwei Zutaten eingeben, Browser-Tab schließen, Editor erneut öffnen → „Entwurf vom … wiederherstellen?“. Die Wiederherstellung füllt alle Felder, auch Zutaten, Zubereitungsschritte, Tags und das bereits hochgeladene Bild.
  - Ist das Entwurfsbild inzwischen gelöscht (`GET /images/:id` → 404, Test mit injizierter Uhr > 7 Tage), erscheint „Foto nicht mehr vorhanden – bitte erneut aufnehmen“, und `imageId` wird aus dem Entwurf entfernt.
  - Nach erfolgreichem Speichern ist der Entwurf gelöscht.
  - Abbrechen oder Zurück-Geste mit ungespeicherten Änderungen fragt „Änderungen verwerfen?“ (eine der Rückfragen aus F-35).
  - Bricht die Verbindung beim Speichern ab, bleiben alle Eingaben erhalten, und es erscheint „Erneut versuchen“.

#### 3.1.3 Zutaten und Zubereitung

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-10 | Strukturierte Zutaten | Jede Zutat hat Menge (optional; Dezimalzahl oder Bruch, optional Bereich), Einheit (frei, ≤ 20 Zeichen; Vorschläge: g, kg, ml, l, EL, TL, Stück, Prise, Bund, Zehe, Dose, Packung, Tasse, Scheibe, Msp.), Name (Pflicht, 1–120), Notiz (≤ 200) und optional eine Gruppenüberschrift. Die Reihenfolge ist per Ziehgriff und zusätzlich per Auf/Ab-Schaltflächen änderbar. Höchstens 200 Zutaten. **Formatregel für Mengen** (`client/src/lib/format.ts`): Nachkommaanteile ¼, ⅓, ½, ⅔, ¾ (Toleranz 0,01) erscheinen als Bruchzeichen, mit ganzem Teil als „1 ½“; alle anderen Werte mit Dezimalkomma und höchstens 2 Nachkommastellen. | Muss |
| F-11 | Zubereitungsschritte | Die Zubereitungsbeschreibung ist eine geordnete Liste von Zubereitungsschritten (je 1–4.000 Zeichen, Zeilenumbrüche bleiben erhalten, höchstens 100). Leere Schritte werden beim Speichern verworfen. Ein Rezept ohne Schritte ist erlaubt. | Muss |
| F-12 | Zutaten und Zubereitungsschritte als Text einfügen | Textmodus für Zutaten: eine Zutat pro Zeile, der Parser `shared/ingredient-parser.ts` zerlegt sie; eine Zeile, die auf „:“ endet, wird zur Gruppe; unsichere Zeilen werden markiert; kein Text geht verloren. Die Einheit wird so übernommen, wie sie in der Zeile steht; nur die Langformen aus `shared/units.ts` werden auf die Kurzform abgebildet („Esslöffel“ → „EL“, „Teelöffel“ → „TL“, „Gramm“ → „g“). Bindestrich und Halbgeviertstrich zwischen Zahlen ergeben einen Bereich. Zubereitung: Absätze oder führende Nummern trennen die Schritte. Begründung: zentraler Hebel für die schnelle Erfassung (Kap. 1.4, S2). | Muss |
| F-13 | Portionen skalieren | Portionsregler im Detail; alle Mengen werden proportional umgerechnet. Die Skalierung ist nur eine Anzeige und wird nicht gespeichert. | Kann |

Akzeptanzkriterien:

- **F-10**
  - Die Zeile „200 · g · Mehl · gesiebt“ ergibt in der DB `amount=200, unit='g', name='Mehl', note='gesiebt'` und im Detail „200 g Mehl, gesiebt“.
  - Formatregel (Unit-Test): Eingabe „1,5“ → gespeichert 1.5, angezeigt „1 ½“; „1/2“ oder „½“ → 0.5, „½“; „1/3“ → 0.3333…, „⅓“; „0,1“ → „0,1“; „1,25“ → „1 ¼“; „2,4“ → „2,4“; „2–3“ → `amount=2, amount_max=3`, angezeigt „2–3“.
  - „Salz“ ohne Menge und Einheit wird ohne führende Leerzeichen angezeigt; die Gruppe „Für die Soße“ erscheint im Detail als Zwischenüberschrift; eine geänderte Reihenfolge bleibt nach dem Neuladen erhalten.
  - Enter im Namensfeld der letzten Zutat legt eine neue Zeile an und fokussiert deren Mengenfeld.
- **F-11**
  - 3 Schritte anlegen, Schritt 3 per Auf-Schaltfläche an Position 1 → nach dem Neuladen stimmt die Nummerierung 1–3 in der neuen Reihenfolge.
  - Zeilenumbrüche innerhalb eines Schritts bleiben in der Anzeige erhalten.
  - Ein Rezept ohne Schritte zeigt im Detail „Noch keine Zubereitung erfasst“ mit einem Link zum Bearbeiten.
- **F-12**
  - Verbindliche Sollwerte (Unit-Test, `tests/fixtures/ingredient-lines.json` enthält alle ≥ 40 Zeilen mit Sollwerten):
    - „1/2 TL Salz“ → `{amount:0.5, amountMax:null, unit:'TL', name:'Salz', note:''}`
    - „2-3 EL Olivenöl“ → `{amount:2, amountMax:3, unit:'EL', name:'Olivenöl', note:''}`
    - „1 ½ Tassen Milch“ → `{amount:1.5, amountMax:null, unit:'Tassen', name:'Milch', note:''}`
    - „400 ml Kokosmilch“ → `{amount:400, amountMax:null, unit:'ml', name:'Kokosmilch', note:''}`
    - „250 g Mehl (Type 405)“ → `{amount:250, amountMax:null, unit:'g', name:'Mehl', note:'Type 405'}`
    - „3 Zehen Knoblauch, fein gehackt“ → `{amount:3, amountMax:null, unit:'Zehen', name:'Knoblauch', note:'fein gehackt'}`
    - „Für die Soße:“ → Gruppe „Für die Soße“ für die folgenden Zeilen.
  - Eine nicht erkennbare Zeile („etwas Pfeffer aus der Mühle“) landet vollständig im Namen und wird mit Hinweis-Symbol und umrandeter Vanilla-Fläche markiert; kein Zeichen geht verloren.
  - Der Wechsel zwischen Textmodus und Zeilenmodus verliert nichts (Roundtrip-Test).
  - Eingefügter Text mit Leerzeilen ergibt einen Zubereitungsschritt je Absatz; führende „1.“ und „2)“ werden entfernt.
- **F-13**
  - 4 → 6 Portionen: „400 g Mehl“ wird „600 g Mehl“; „2–3 Eier“ verdoppelt wird „4–6 Eier“.
  - Rundung: unter 10 auf ¼ oder ⅓ genau (Anzeige nach der Formatregel aus F-10, z. B. „2 ½“); von 10 bis 100 auf ganze Zahlen; über 100 auf Vielfache von 5.
  - Zutaten ohne Menge und die Einheiten „Prise“, „Msp.“, „etwas“, „n. B.“ werden nicht skaliert und erhalten den Hinweis „nach Geschmack anpassen“.
  - Eine Pluralliste mit ≥ 25 Wörtern (`shared/plural.ts`) greift, sobald die Menge 1 überschreitet: „1 Ei“ verdoppelt wird „2 Eier“, „1 Zehe Knoblauch“ verdreifacht wird „3 Zehen Knoblauch“; unbekannte Wörter bleiben unverändert. Nach dem Neuladen gilt wieder die gespeicherte Portionszahl.

#### 3.1.4 Bilder

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-14 | Bild aufnehmen oder auswählen | Ein Bild je Rezept. Der Editor zeigt zwei große Schaltflächen: „Foto aufnehmen“ (`<input type="file" accept="image/jpeg" capture="environment">`) und „Bild auswählen“ (`accept="image/jpeg,image/png,image/webp"`). Der Upload startet direkt nach der Auswahl, auch bei einem noch ungespeicherten Rezept. Speichern wartet auf einen laufenden Upload; ein gescheiterter Upload verhindert das Speichern nicht. Maximal 20 MiB (20.971.520 Bytes, `shared/constants.ts`). | Muss |
| F-15 | Serverseitige Bildverarbeitung | sharp dreht nach EXIF, entfernt Metadaten und erzeugt drei WebP-Varianten, nie vergrößert. **Startwerte** (endgültig nach der Designentscheidung in M1, als Konstanten in `shared/constants.ts`): s = Kartenvariante im Kartenformat des Designs (Vorgabe 4:3) mit einer Breite ≥ 2× der breitesten Karte, Startwert 720×540 zugeschnitten (q72); m = 1200 px längste Kante (q78); l = 2048 px längste Kante (q80). Pipeline: das Original wird einmal mit Shrink-on-load zu l dekodiert, m und s entstehen aus dem l-Puffer. Konfiguration: `sharp.cache(false)`, `sharp.concurrency(2)`, `limitInputPixels` = 60 MP. Das Original wird verworfen. Die Dateien werden atomar geschrieben (erst in `tmp/`, dann umbenannt). | Muss |
| F-16 | Bild ersetzen, entfernen, aufräumen | Das Bild lässt sich ersetzen oder entfernen. Nicht mehr referenzierte Bilddateien werden nicht sofort gelöscht, sondern nach dem Commit nach `images/.trash/` verschoben und erst nach der Backup-Aufbewahrung (`BACKUP_KEEP`, 14 Tage) endgültig entfernt. Beim Start und im wöchentlichen Aufräumlauf holt der Server Dateien, auf die eine `images`-Zeile verweist, aus `images/.trash/` zurück (Wiederherstellung aus Backup). Hochgeladene, nie zugeordnete Bilder verschwinden nach 7 Tagen; verwaiste Dateien wandern im wöchentlichen Aufräumlauf ebenfalls nach `images/.trash/`. | Muss |

Akzeptanzkriterien:

- **F-14**
  - Über `http://<IP>:8080` öffnet „Foto aufnehmen“ auf Android Chrome, iPhone Safari und iPad Safari direkt die Kamera; nach dem Upload erscheint das Foto in Editor, Liste und Detail.
  - Ein 8-MB-JPEG wird angenommen; während des Uploads zeigt ein Balken den Fortschritt, und das Formular bleibt bedienbar.
  - Eine 25-MB-Datei lehnt der Client schon vor dem Senden mit „Bild zu groß (max. 20 MB)“ ab; der Server bricht einen Stream nach 20.971.520 Bytes mit 413 ab.
  - Eine PDF-Datei mit der Endung .jpg → 415 „Nur JPEG, PNG oder WebP“. Eine HEIC/HEIF-Datei → 415 mit dem Hinweis „Bitte als JPEG speichern – iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: in der Kamera-App HEIF ausschalten“.
- **F-15**
  - Ein 12-MP-Hochkantfoto (EXIF-Orientierung 6, mit GPS-Daten) ergibt drei korrekt hochkant ausgerichtete Dateien; mit den Startwerten gilt s ≤ 60 KB, m ≤ 200 KB, l ≤ 600 KB (werden die Maße in M1 geändert, werden die Grenzen im selben Schritt neu gesetzt).
  - Die Dateien enthalten keine EXIF- oder GPS-Daten (im Test mit `sharp().metadata()` geprüft).
  - Die Verarbeitung dauert auf dem Server-PC ≤ 2 s (Log-Messung, NF-25); ein Bild über 60 MP wird mit 413 und „Bild hat zu viele Pixel (max. 60 MP)“ abgelehnt.
  - Scheitert das Schreiben der dritten Variante (simuliert), bleibt keine der drei Dateien liegen, und es entsteht kein DB-Verweis.
- **F-16**
  - Nach Ersetzen und Speichern liegen für das Rezept nur die drei neuen Dateien in `images/`; die alten liegen in `images/.trash/` und sind nach 14 Tagen entfernt (Test mit injizierter Uhr).
  - DB-Backup von gestern einspielen und starten → ein am Vortag ersetztes Bild ist wieder sichtbar.
  - Nach dem Entfernen zeigen Liste und Detail einen Platzhalter (Inline-SVG mit `currentColor`, kein zusätzlicher Request).
  - Jedes Rezept ohne Bild zeigt in Karte, Tablet-Liste und Detail das Platzhalterbild aus dem Design: Teller mit Besteck und dem Anfangsbuchstaben des Titels. Die Hintergrundfarbe ist `--placeholder-(ID mod 4 + 1)` und damit für dasselbe Rezept auf allen Geräten gleich. Das Detail bietet darauf „Foto hinzufügen“ an (Nutzervorgabe vom 23.09.2026).
  - Nie zugeordnete Uploads werden nach 7 Tagen gelöscht (Test mit injizierter Uhr). Der wöchentliche Aufräumlauf verschiebt Dateien ohne DB-Zeile und schreibt ihre Anzahl ins Log.

#### 3.1.5 Tags

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-17 | Mehrere Tags je Rezept, umlautsicher | 0–20 Tags je Rezept. Ein Tag-Name hat 1–40 Zeichen: alle Unicode-Buchstaben, Ziffern, Leerzeichen und Satzzeichen außer Steuerzeichen. Die Eindeutigkeit prüft der normalisierte Schlüssel `name_key` (Kap. 4.4). | Muss |
| F-18 | Tag-Autovervollständigung | Beim Tippen schlägt die App vorhandene Tags mit Rezeptanzahl vor. Der Präfixvergleich läuft über `queryVariants()` aus `shared/normalize.ts` (normalisiert, inkl. ae/oe/ue → a/o/u). Enter oder Komma übernimmt; neue Tags entstehen beim Speichern. | Muss |
| F-19 | Tags verwalten | Die Tag-Seite zeigt alle Tags mit Anzahl und erlaubt Umbenennen, Zusammenführen und Löschen; Rezeptzuordnungen, Suchindex und die `version` der betroffenen Rezepte werden mitgeführt. Zusammenführen bleibt Muss, weil es der einzige Weg ist, entstandene Tag-Dubletten zu bereinigen, ohne Rezepte einzeln zu bearbeiten. | Muss |
| F-20 | Start-Tags bei Erstinstallation | Eine leere Datenbank erhält 10 Tags: Vegetarisch, Vegan, Schnell, Hauptgericht, Beilage, Suppe, Salat, Dessert, Backen, Frühstück. Begründung: Der Tag-Filter funktioniert ab Tag 1, und es wuchern weniger Varianten. | Soll |

Akzeptanzkriterien:

- **F-17**
  - „Süßspeise“, „Schnell & einfach“, „Für Gäste“ und „Low-Carb“ werden gespeichert und unverändert angezeigt.
  - Ist „Süßspeise“ vorhanden, verknüpfen „süßspeise“, „Süssspeise“, „Süsspeise“ und „SÜSSSPEISE“ diesen Tag (gemeinsamer Schlüssel `susspeise`); ein zweiter Tag entsteht nicht.
  - Ein 21. Tag wird im Client und per API (400) mit Meldung abgelehnt.
- **F-18**
  - „veg“ schlägt „Vegetarisch (12)“ und „Vegan (3)“ vor, nach Anzahl sortiert.
  - „su“ und „sue“ schlagen „Süßspeise“ vor.
  - Vorschläge erscheinen ≤ 100 ms nach dem Tastendruck (lokale Tag-Liste, kein Request je Taste); Enter oder Komma übernimmt den markierten Vorschlag oder legt den Text als neuen Tag an.
  - Neue Tags entstehen erst beim Speichern, in derselben Transaktion; Abbrechen hinterlässt keinen Tag.
- **F-19**
  - Umbenennen von „Nachtisch“ in das vorhandene „Dessert“ fragt „‚Nachtisch‘ in ‚Dessert‘ zusammenführen? 7 Rezepte betroffen“. Nach der Bestätigung trägt kein Rezept mehr „Nachtisch“, und keines hat „Dessert“ doppelt.
  - Nach Umbenennen oder Zusammenführen findet die Suche die Rezepte unter dem neuen Namen (API-Test).
  - Löschen fragt „Von 4 Rezepten entfernen?“ und entfernt nur die Zuordnungen; die Rezepte bleiben.
  - Umbenennen, Zusammenführen und Löschen erhöhen die `version` aller betroffenen Rezepte in derselben Transaktion; ein `PUT` mit der alten Version liefert 409 `VERSION_CONFLICT`, statt den alten Tag per Upsert wieder anzulegen (API-Test).
- **F-20**
  - Nach einer Neuinstallation zeigt die Tag-Seite diese 10 Tags mit Anzahl 0, und die Chip-Reihe der Liste bietet sie an.
  - Start-Tags lassen sich wie alle Tags ändern und löschen; ein Neustart legt gelöschte Start-Tags nicht erneut an (`meta.seeded`).

#### 3.1.6 Suche, Filter, Sortierung

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-21 | Volltextsuche während des Tippens | Durchsucht Titel, Tags, Zutatennamen, Beschreibung und Zubereitungsschritte: Präfixtreffer in allen Feldern, Teilworttreffer (für Komposita) in Titel, Tags und Zutaten. Mehrere Wörter sind UND-verknüpft. Ranking: Titeltreffer zuerst; danach ein gewichtetes Ranking mit der Gewichtung Tags > Zutaten > übriger Text (Gewichtung, keine strikte Reihenfolge; Kap. 4.5). Die Suche startet ab 2 Zeichen mit 150 ms Debounce; veraltete Anfragen werden abgebrochen, bisherige Treffer bleiben sichtbar, bis neue da sind. | Muss |
| F-22 | Schreibweisen-Toleranz | Groß-/Kleinschreibung, Akzente, ä/ö/ü, ß/ss und Dreifachkonsonanten spielen keine Rolle. ae/oe/ue gelten in der Suchanfrage als Variante von ä/ö/ü; im Index werden sie nicht ersetzt. | Muss |
| F-23 | „Meintest du …?“ | Bei 0 Treffern und einem Begriff ab 4 Zeichen schlägt der Server ein ähnliches Wort aus Titeln, Tags und Zutaten vor (Damerau-Levenshtein: Distanz ≤ 1 bei 4–6 Zeichen, ≤ 2 ab 7). | Soll |
| F-24 | Tag-Filter mit Chip-Reihe, UND/ODER | Unter dem Suchfeld liegt eine horizontale Chip-Reihe: aktive Tags zuerst, dann die 12 meistgenutzten; ein Fingertipp schaltet den Filter an oder aus. Das Filter-Sheet zeigt alle Tags (mit Suche und Anzahl) und den Modus „alle müssen passen“ (Standard) oder „einer reicht“. | Muss |
| F-25 | Filter „Nur Favoriten“ | „Nur Favoriten“ (des aktiven Profils), kombinierbar mit Suche und Tags. | Muss |
| F-43 | Filter Mindestbewertung | „Mindestens n Sterne“ (Durchschnitt aller Profile, n = 1–5), kombinierbar mit Suche, Tags und Favoriten. | Soll |
| F-26 | Sortierung (Grundumfang) | Relevanz (Standard bei Suchbegriff), Neueste (Standard ohne Suchbegriff), Titel A–Z (DIN 5007-1). | Muss |
| F-44 | Weitere Sortierungen | Beste Bewertung, Meine Bewertung, Zuletzt geändert. | Soll |

Akzeptanzkriterien:

- **F-21**
  - „zwieb“ findet ein Rezept, das „Zwiebeln“ nur als Zutat enthält; „suppe“ findet „Kürbissuppe“; „kuchen“ findet „Käsekuchen“.
  - „tomate“ listet „Tomatensuppe“ (Titeltreffer) vor Rezepten, die „Tomaten“ nur als Zutat enthalten.
  - „kartoffel käse“ liefert nur Rezepte, die beide Begriffe enthalten.
  - Bei 1.000 Rezepten erscheinen die Treffer im Client ≤ 300 ms nach der letzten Eingabe (Ende-zu-Ende; die Serverzeit prüft NF-04); der Netzwerk-Tab zeigt höchstens eine laufende Suchanfrage.
- **F-22**
  - „kase“, „käse“, „KÄSE“ und „kaese“ liefern für „Käsekuchen“ dieselben Treffer; „weiss“ findet „Weißkohl“; „creme brulee“ findet „Crème brûlée“.
  - ae/oe/ue werden nur in der Anfrage als zusätzliche Variante ersetzt: „Michaels Nudeln“ bleibt über „michael“ auffindbar (Unit-Test des Query-Builders).
  - Die Unit-Tests für `normalize()` decken ä, ö, ü, ß, ẞ, é, ñ, ø, Dreifachkonsonanten, Emojis und Ziffernfolgen ab (≥ 30 Fälle).
- **F-23**
  - „Spazle“ ohne Treffer zeigt „Meintest du: Spätzle?“; ein Fingertipp darauf startet die Suche.
  - „Lasange“ schlägt „Lasagne“ vor.
  - Unter 4 Zeichen oder wenn es Treffer gibt, erscheint kein Vorschlag.
- **F-24**
  - „Vegetarisch“ und „Schnell“ sind aus der Liste mit zwei Fingertipps aktiv. Im Modus „alle“ kommen nur Rezepte mit beiden Tags, bei „einer reicht“ die Vereinigung (API-Test).
  - Aktive Filter erscheinen als hervorgehobene Chips mit Häkchen (nicht nur farblich) und als Zahl am Filtersymbol; jeder lässt sich einzeln entfernen.
  - „Filter zurücksetzen“ entfernt alle Filter und den Suchbegriff mit einem Fingertipp.
- **F-25**
  - „Nur Favoriten“ zeigt ausschließlich Favoriten des aktiven Profils; nach einem Profilwechsel ändert sich die Menge.
  - „Nur Favoriten“ + Tag „Dessert“ + Suche „schoko“ liefert die Schnittmenge (API-Test).
- **F-43**
  - „ab 4 Sternen“ schließt unbewertete Rezepte und Rezepte mit Ø 3,9 aus, Ø 4,0 ist enthalten (API-Test).
  - „ab 4 Sternen“ + Tag „Dessert“ + Suche „schoko“ liefert die Schnittmenge (API-Test).
- **F-26**
  - Titel A–Z sortiert ['Zucchini', 'Öl', 'Birne', 'Äpfel', 'Apfelkuchen', 'Ananas'] zu ['Ananas', 'Äpfel', 'Apfelkuchen', 'Birne', 'Öl', 'Zucchini'].
  - „Neueste“ ohne Suchbegriff: absteigend nach `created_at`; mit Suchbegriff ist „Relevanz“ vorausgewählt (API-Test).
  - Die Sortierung bleibt beim Nachladen weiterer Seiten und nach dem Neuladen erhalten (URL-Parameter `sort`).
- **F-44**
  - „Beste Bewertung“: Durchschnitt absteigend, bei Gleichstand zuerst die mit mehr Bewertungen, unbewertete zuletzt (API-Test).
  - „Meine Bewertung“: eigene Sterne absteigend, selbst nicht bewertete zuletzt; ohne Profil 401 (F-05).
  - „Zuletzt geändert“: absteigend nach `updated_at`; ein gerade bearbeitetes Rezept steht oben (API-Test).

#### 3.1.7 Bewertung und Favoriten

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-27 | Bewertung 1–5 Sterne je Profil | Jedes Profil bewertet jedes Rezept mit 1–5 ganzen Sternen und ändert oder entfernt die Bewertung. Entfernen geht über die Schaltfläche „Bewertung entfernen“ (sichtbar, sobald eine eigene Bewertung existiert, per Tastatur erreichbar) und als Abkürzung durch Antippen des eigenen gesetzten Sterns; beides mit Rückgängig-Toast (F-35). Neben den Sternen steht „Deine Bewertung (Anna): 4“ bzw. „Noch nicht bewertet (Anna)“. Die Anzeige reagiert sofort (optimistisch). Die Liste zeigt Durchschnitt und Anzahl, das Detail zusätzlich die Einzelbewertungen mit Profilnamen. | Muss |
| F-28 | Favoriten je Profil | Ein Herz in Karte und Detail (≥ 48 px) reagiert sofort. Die Favoriten-Ansicht ist die Liste mit festem Filter; Suche und Chips funktionieren dort ebenfalls. Setzen und Entfernen sind idempotent. | Muss |

Akzeptanzkriterien:

- **F-27**
  - Sebastian gibt 4, Anna 2 → Liste und Detail zeigen „Ø 3,0 (2)“; das Detail zeigt zusätzlich „Anna 2 · Sebastian 4“ und für Anna „Deine Bewertung (Anna): 2“.
  - Antippen des eigenen 4. Sterns oder „Bewertung entfernen“ entfernt die Bewertung, der Durchschnitt wird neu berechnet, und der Toast „Bewertung entfernt – Rückgängig“ stellt sie wieder her.
  - `stars = 0` oder `6` → 400. Bei einem Serverfehler springt die Anzeige zurück, und ein Toast erscheint.
  - Tastatur- und Screenreader-Bedienung: siehe NF-11.
- **F-28**
  - Das Herz in der Liste füllt sich beim Antippen sofort und bleibt nach dem Neuladen gefüllt.
  - Annas Favoriten-Ansicht zeigt keine Favoriten von Sebastian. Eine leere Favoriten-Ansicht zeigt „Noch keine Favoriten – tippe bei einem Rezept auf das Herz“.
  - Zwei gleichzeitige `PUT` mit demselben Profil erzeugen keinen Fehler (API-Test).
  - Bei einem Netzwerkfehler springt das Herz zurück, und ein Toast erscheint.

#### 3.1.8 Rezeptansicht und Kochen

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-29 | Rezeptdetail | Zeigt Bild (Variante m; Antippen öffnet l), Titel, Zeiten (Vorbereitung, Kochen, Summe), Portionen, Tags (antippbar), eigene Sterne und Durchschnitt, Herz, Zutaten nach Gruppen, nummerierte Zubereitungsschritte (Schrift ≥ 18 px am Handy), Beschreibung, Quelle sowie „angelegt von … am …, geändert von … am …“. Die Quelle erscheint nur als Link, wenn sie mit `http://` oder `https://` beginnt, sonst als reiner Text. Bei 600–1023 px und ab 1280 px stehen Zutaten und Schritte nebeneinander, die Zutaten bleiben beim Scrollen stehen; bei 1024–1279 px (Detailspalte neben der Liste) stehen sie untereinander. | Muss |
| F-30 | Abhaken von Zutaten und Zubereitungsschritten | Antippen einer Zeile streicht sie durch. Der Zustand gilt je Rezept und Browser-Tab (`sessionStorage`). | Soll |
| F-31 | Kochmodus | Vollbild mit einem Zubereitungsschritt je Ansicht, Schrift ≥ 24 px, großer „Weiter“-Fläche, Fortschritt „Schritt 3 von 8“ und den Zutaten als Sheet. Bildschirm wach halten: natives Screen Wake Lock nur im sicheren Kontext; über http ein Hinweis; ein experimenteller Video-Ersatz nur hinter einem Schalter. | Kann |
| F-32 | Druckansicht | Druck-CSS für das Rezeptdetail. | Kann |

Akzeptanzkriterien:

- **F-29**
  - Nicht gesetzte Felder werden ausgeblendet: keine leeren Zeiten, kein „null“, keine leeren Überschriften. Ausnahme: Ist `created_by` bzw. `updated_by` NULL (Profil gelöscht), steht „unbekannt“.
  - Antippen eines Tags öffnet die Liste mit diesem Tag als Filter.
  - Bei 768×1024 stehen Zutaten und Zubereitung nebeneinander, und die Zutaten bleiben beim Scrollen sichtbar. Bei 1024×768 sind Liste und Detail gleichzeitig sichtbar.
  - Liste → Detail: Titel und Bild erscheinen aus den Listendaten ≤ 200 ms nach dem Fingertipp; die übrigen Daten folgen.
  - Quelle `https://example.org/rezept` ist ein Link; Quelle „Omas Kochbuch S. 12“ ist Text (Prüfung auf `javascript:` siehe NF-21).
- **F-30**
  - Antippen der ganzen Zeile (≥ 48 px hoch) streicht sie durch; erneutes Antippen hebt das auf.
  - Der Zustand übersteht den Wechsel Liste ↔ Detail im selben Browser-Tab und wird beim Schließen des Browser-Tabs verworfen.
  - „Alle zurücksetzen“ entfernt alle Markierungen des Rezepts.
- **F-31**
  - Die Schrift ist ≥ 24 px, die „Weiter“-Fläche nimmt die volle Breite der unteren Bildschirmhälfte ein; Wischen und Pfeiltasten blättern.
  - Über `http://<IP>` erscheint „Bildschirm wach halten ist über diese Verbindung nicht möglich – Bildschirm-Timeout am Gerät verlängern“, und die Konsole zeigt keinen Fehler.
  - Über `http://localhost` ist `navigator.wakeLock` aktiv und wird beim Verlassen freigegeben.
  - Der experimentelle Schalter ist standardmäßig aus; eingeschaltet zeigt ein Symbol „aktiv“ oder „nicht möglich“. Eine Mindestdauer wird nicht zugesagt.
- **F-32**
  - Die Druckvorschau zeigt Titel, Angaben, Zutaten und Zubereitungsschritte ohne Navigation, Schaltflächen und dunklen Hintergrund.
  - Ein Rezept mit 12 Zutaten und 8 Schritten passt auf höchstens 2 A4-Seiten.

#### 3.1.9 Bedienung, Navigation, Zustände

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-33 | Leer-, Lade- und Fehlerzustände | Jede Ansicht definiert: leer (mit Handlung), ladend (Skeleton), Fehler (Meldung + „Erneut versuchen“), Server nicht erreichbar (Banner, die letzte Liste bleibt sichtbar), Rezept im Papierkorb. | Muss |
| F-34 | Navigation, Deep-Links, URL-Zustand | Jede Ansicht hat eine URL; der Server liefert für App-Pfade `index.html`. Suchbegriff, Filter und Sortierung stehen in der URL. Zurück stellt die Scrollposition wieder her; die Zurück-Taste schließt zuerst offene Sheets. Jede Unteransicht hat eine eigene Zurück-Schaltfläche, und die Liste hat eine Aktualisieren-Schaltfläche, damit die App auch ohne Browserleiste (iOS-Verknüpfung im Standalone-Modus) bedienbar ist. | Muss |
| F-35 | Rückgängig statt Nachfragen | Nicht endgültige Aktionen werden sofort ausgeführt und lassen sich 8 s lang per Toast zurücknehmen. Vorab gefragt wird nur bei endgültigen Aktionen und beim Verwerfen ungespeicherter Eingaben. Das Löschen eines Rezepts regelt F-08. | Soll |
| F-36 | Aktualität zwischen Geräten und nach Updates | Jede Antwort trägt `X-Data-Revision` und `X-App-Version`. Liste, Favoriten-Ansicht, Detail und Tag-Seite laden neu, wenn man in den Browser-Tab zurückkehrt (`visibilitychange`, `focus`), und fragen, solange die Seite sichtbar ist, alle 60 s `GET /api/v1/revision` ab; nur bei geänderter Revision wird neu geladen. Editor und Kochmodus laden nie automatisch neu; dort greift der Versionscheck beim Speichern (F-07). Eine abweichende App-Version zeigt ein Update-Banner. Begründung: Mehrere Geräte arbeiten auf denselben Daten. | Soll |
| F-37 | Verknüpfung auf dem Startbildschirm | `manifest.webmanifest` (Name „Rezepte“, Icons 192/512 inkl. maskable, `theme_color` aus der Palette, `display: standalone`), `apple-touch-icon` 180 px, Favicon, `<meta name="theme-color">` je Farbschema und `apple-mobile-web-app-*`-Meta-Tags. Kein Service Worker. Über http öffnet die Verknüpfung auf iOS ohne Safari-Leisten (Standalone), auf Android im normalen Chrome-Tab mit Adressleiste (keine WebAPK-Installation). Eine Anleitung steht auf der Verbinden-Seite. | Soll |
| F-38 | Link kopieren | Den Rezept-Link in die Zwischenablage kopieren, mit Rückfallebenen für http. | Kann |

Akzeptanzkriterien:

- **F-33**
  - Nach einer Neuinstallation steht dort „Noch keine Rezepte“ mit der Schaltfläche „Erstes Rezept anlegen“.
  - Eine Suche ohne Treffer zeigt den Suchbegriff, „Filter zurücksetzen“ und „Rezept ‚…‘ anlegen“ (der Begriff wird als Titel übernommen).
  - Bei gestopptem Server erscheint das Banner „Server nicht erreichbar – läuft der Rezepte-PC?“ ≤ 3 s nach der fehlgeschlagenen Anfrage; die zuletzt geladene Liste bleibt sichtbar; „Erneut versuchen“ lädt nach dem Serverstart.
  - Das erste Laden zeigt Skeleton-Karten statt eines Spinners (CLS siehe NF-06).
  - Ein Deep-Link auf ein Rezept im Papierkorb (410 `IN_TRASH`) zeigt „Im Papierkorb (gelöscht von Anna am …)“ mit „Wiederherstellen“ statt „Nicht gefunden“.
- **F-34**
  - `http://<host>:8080/rezepte/42` direkt aufgerufen zeigt das Rezept (kein 404). Unbekannte App-Pfade zeigen die App-Seite „Nicht gefunden“ mit einem Link zur Liste.
  - Bis Rezept 30 scrollen, öffnen, Zurück → Rezept 30 ist wieder im Sichtbereich, die Filter sind unverändert.
  - Zwei Filter setzen und neu laden → beide aktiv; ein kopierter Link zeigt auf einem anderen Gerät dieselbe gefilterte Liste.
  - Ein offenes Bottom-Sheet schließt die Zurück-Taste (Android) bzw. die Zurück-Geste; die Seite bleibt.
  - Jede Unteransicht (Detail am Handy, Editor, Tag-Seite, Papierkorb, Status, Verbinden) hat oben links eine Zurück-Schaltfläche (≥ 44 px); die Liste hat eine Aktualisieren-Schaltfläche. Beides funktioniert in einer iOS-Verknüpfung ohne Browserleiste.
- **F-35**
  - Favorit entfernen, Bewertung entfernen, Tag vom Rezept entfernen und Zutat oder Zubereitungsschritt im Editor entfernen werden sofort ausgeführt; der Toast „Rückgängig“ (8 s) stellt den vorherigen Zustand an alter Position wieder her.
  - Vorab bestätigt werden nur: endgültig löschen, Profil löschen, Tag löschen, Tags zusammenführen und das Verwerfen ungespeicherter Editor-Änderungen (F-09).
- **F-36**
  - Anna bewertet auf Gerät A; Sebastian kehrt auf Gerät B in den Browser-Tab zurück → die Bewertung erscheint ≤ 2 s ohne manuelles Neuladen.
  - Tablet zeigt 5 min lang sichtbar die Liste; auf dem Handy wird ein Rezept angelegt → die Liste auf dem Tablet zeigt es ≤ 70 s später.
  - Editor mit Eingaben öffnen, Browser-Tab wechseln oder Handy sperren, zurückkehren → alle Eingaben sind unverändert.
  - Einen auf Gerät A umbenannten Tag schlägt die Autovervollständigung auf Gerät B nach dem nächsten Request vor.
  - Nach einem Server-Update zeigt ein noch offener alter Client „Neue Version verfügbar – Neu laden“; der Fingertipp lädt die neue Version.
- **F-37**
  - iOS Safari: „Zum Home-Bildschirm“ erzeugt das Icon „Rezepte“; die Verknüpfung öffnet ohne Safari-Leisten.
  - Android Chrome: „Zum Startbildschirm hinzufügen“ legt eine Verknüpfung mit Icon (Manifest-Icon oder Favicon) an, die im Chrome-Tab die Liste öffnet.
  - `GET /manifest.webmanifest` liefert `Content-Type: application/manifest+json`; `GET /apple-touch-icon.png` liefert ein PNG (API-Test).
  - Die Anleitung erklärt, dass die iOS-Verknüpfung einen eigenen Speicher hat (Profil einmal neu wählen), dass Android die Verknüpfung im Browser öffnet und dass es keinen Offline-Betrieb gibt.
- **F-38**
  - „Link kopieren“ nutzt `navigator.clipboard` (falls verfügbar), sonst `execCommand('copy')`, sonst ein markiertes Textfeld; es erscheint „Link kopiert“ oder das Feld.
  - Der Link öffnet das Rezept auf einem anderen Gerät im LAN.

#### 3.1.10 Daten und Betrieb (funktional)

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| F-39 | Verbinden-Seite und Konsolenausgabe | Der Server ermittelt private IPv4-Adressen (10/8, 172.16/12, 192.168/16) nicht-virtueller Adapter und `<Computername>.local`, beim Start und bei jedem Aufruf von `/server-info` neu. Ausgeschlossen sind 127.x, 169.254.x, IPv6-Link-Local und virtuelle Adapter (vEthernet, WSL, VirtualBox, VMware, VPN-Adapter); `PUBLIC_URL` kann eine Adresse vorgeben. Konsole und Log zeigen beim Start die URLs und einen ASCII-QR-Code. Die App zeigt unter „Mehr → Anderes Gerät verbinden“ die URLs groß, den QR-Code (SVG vom Server) und eine Kurzanleitung. | Muss |
| F-40 | Automatisches und manuelles Backup | Eine stündliche Prüfung erzeugt per Online-Backup von better-sqlite3 (`db.backup()`, asynchron und seitenweise, blockiert die Event-Loop nicht) `backups/rezepte-JJJJ-MM-TT.sqlite`, sobald die Ortszeit 03:00 überschritten ist und das heutige Backup fehlt; nach einem Start wird ein fehlendes Backup nachgeholt. 14 automatische Backups bleiben erhalten; ein manuelles Backup ist per Schaltfläche möglich; Fehler werden angezeigt. | Muss |
| F-41 | Export als ZIP | `GET /api/v1/export` streamt `rezepte-export-JJJJ-MM-TT.zip`: `rezepte.json` (Formatversion 1: Profile sowie aktive Rezepte mit Zutaten, Zubereitungsschritten, Tags, Bewertungen, Favoriten und Bildverweis; Rezepte im Papierkorb werden nicht exportiert) und `images/<key>-l.webp`, unkomprimiert gespeichert. | Soll |
| F-42 | Status- und Speicheranzeige | „Mehr → Status“ zeigt Version, Anzahl der Rezepte, Bilder und Profile, die Größe von DB, Bildern und Backups, den freien Speicher, das letzte Backup und den Zustand der Bildverarbeitung. | Soll |

Akzeptanzkriterien:

- **F-39**
  - Die Startausgabe enthält z. B. `http://192.168.178.20:8080` und `http://kueche-pc.local:8080`, aber keinen NetBIOS-Namen ohne `.local` und keine 169.254-, fe80- oder vEthernet-Adresse.
  - Der QR-Code kodiert die IP-URL (bzw. `PUBLIC_URL`, falls gesetzt) mit ausgeschriebenem `http://`; der Scan mit der Kamera eines Android-Handys und eines iPhones öffnet die App.
  - Die Verbinden-Seite lädt keine QR-Bibliothek im Client (Netzwerk-Tab); nach einem IP-Wechsel zeigt sie ohne Neustart die neue Adresse.
  - Mit `PUBLIC_URL=http://rezepte.fritz.box:8080` steht diese URL an erster Stelle und im QR-Code.
- **F-40**
  - „Backup jetzt“ erzeugt eine Datei, deren `PRAGMA integrity_check` „ok“ ergibt und die alle Rezepte enthält; während des Backups antwortet `/api/v1/health` in ≤ 200 ms.
  - Beim 15. automatischen Backup wird das älteste gelöscht; manuelle Backups (`manual-…`) werden getrennt gezählt (5).
  - War der PC um 03:00 aus, entsteht das Backup ≤ 5 min nach dem Start. An Tagen mit Zeitumstellung entsteht genau ein Backup (Test mit injizierter Uhr, Zeitzone Europe/Berlin).
  - Scheitert ein Backup, zeigen `/api/v1/health` (`lastBackupError`) und die Status-Seite eine Warnung.
- **F-41**
  - Das ZIP lässt sich im Windows-Explorer und mit `Expand-Archive` öffnen; `rezepte.json` ist gültiges UTF-8-JSON mit unveränderten Umlauten und besteht die Prüfung gegen `ExportV1`.
  - Die Zahl der Rezepte in `rezepte.json` stimmt mit `counts.recipes` aus `/api/v1/health` überein (Rezepte im Papierkorb zählen dort unter `counts.trash` und fehlen im Export).
  - 500 Rezepte mit 500 Bildern sind in ≤ 30 s exportiert; währenddessen antwortet `/api/v1/health` in ≤ 200 ms.
- **F-42**
  - Die Anzeige lautet z. B. „Letztes Backup: heute, 03:00“; ist es älter als 48 h, erscheint eine Warnung.
  - Unter 1 GB freiem Speicher erscheint ein Hinweis, unter 200 MB eine Warnung (Ablehnung von Uploads siehe NF-24).
  - Alle Werte stimmen mit `/api/v1/health` überein.

### 3.2 Nicht-funktionale Anforderungen

#### 3.2.1 Leichtgewichtigkeit und Performance

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-01 | Transfer- und Bundle-Budget | Initial-Route (App-Shell und Liste): JS ≤ 35 KB gzip; die Profilwahl wird beim ersten Start nachgeladen. Jeder nachgeladene JS-Chunk ≤ 30 KB gzip; die Summe aller Chunks wird nur berichtet (Entscheidung vom 23.09.2026, ADR 0002, ersetzt „JS gesamt ≤ 70 KB“). CSS ≤ 15 KB gzip. Editor, Tag-Verwaltung, Mehr/Verbinden/Status und Kochmodus werden lazy geladen. Webfonts insgesamt ≤ 100 KB WOFF2, davon für die erste Ansicht höchstens 2 Dateien mit zusammen ≤ 60 KB. Erster Besuch der Liste ohne Bilder ≤ 160 KB Transfer. | Muss |
| NF-02 | Abhängigkeitsbudget | Laufzeit-Abhängigkeiten (`dependencies`): genau `hono`, `@hono/node-server`, `better-sqlite3`, `sharp`, `zod`, `qrcode-generator`. `svelte` steht in `devDependencies`, weil es vollständig gebündelt wird. Im Client-Bundle landen nur `svelte` und `zod/mini` (nur im Editor-Chunk). Kein UI-Framework und kein Router-, State-, Datums-, Icon- oder CSS-Paket zur Laufzeit. | Muss |
| NF-03 | Lade- und Reaktionszeit am Handy | Schneller erster und warmer Aufruf auf einem Mittelklasse-Handy im WLAN. | Muss |
| NF-04 | API-Antwortzeiten | Liste und Suche bleiben bei 1.000 Rezepten schnell, ohne N+1-Abfragen. | Muss |
| NF-05 | Ressourcenverbrauch des Servers | RAM ≤ 80 MB im Leerlauf, ≤ 250 MB bei Bildverarbeitung, 0 % CPU im Leerlauf (kein Client verbunden), Start ≤ 1 s. Uploads werden gestreamt, höchstens 2 Bildjobs laufen parallel; sharp ist nach F-15 konfiguriert (ohne Operations-Cache, 2 Threads). Die Zielwerte werden in M3 auf dem Ziel-PC gemessen; werden sie mit dieser Konfiguration verfehlt, entscheidet der Nutzer über Anpassung oder neue Grenzen. | Muss |
| NF-06 | Bildauslieferung und Caching | Unveränderliche Bild-URLs mit langem Cache, die passende Variante je Ansicht per `srcset`/`sizes` (höchstens 2-fache Pixeldichte), Lazy Loading, feste Abmessungen. | Muss |

Akzeptanzkriterien:

- **NF-01**
  - `scripts/size-check.ts` (gzip über `node:zlib`, ohne Zusatzpaket) prüft `dist/` und lässt `pnpm build` fehlschlagen, sobald eine Grenze (inkl. Schriftbudget) überschritten ist.
  - Erster Besuch der Liste bei leerem Cache (Netzwerk-Tab): JS ≤ 35 KB, Summe ohne Bilder ≤ 160 KB, nur Requests an den eigenen Origin.
  - Den Editor-Chunk lädt der Browser erst beim Öffnen des Editors (Netzwerk-Tab).
- **NF-02**
  - `dependencies` in `package.json` enthält genau die sechs genannten Pakete, `svelte` steht in `devDependencies`; jede Ergänzung braucht einen ADR in `docs/ADR/`. Den Inhalt des Client-Bundles prüfen Size-Check und eine Chunk-Analyse (`vite build --mode analyze`).
  - `pnpm ls --prod --depth Infinity` listet ≤ 30 Pakete; `node_modules` einer reinen Produktionsinstallation ist ≤ 150 MB groß.
  - `pnpm audit --prod` meldet zum Release keine bekannte kritische Schwachstelle.
- **NF-03**
  - Lighthouse Mobile (DevTools, CPU 4-fach verlangsamt, ohne Netzwerkdrosselung, gegen den LAN-Server): Performance ≥ 90, LCP ≤ 2,0 s beim ersten Besuch.
  - Warmer Aufruf mit Assets im Cache: Die Liste mit 40 Karten ist auf einem mindestens 3 Jahre alten Mittelklasse-Android-Handy in ≤ 1,0 s sichtbar.
  - INP ≤ 200 ms für Herz, Stern, Tag-Chip und das Öffnen eines Rezepts.
- **NF-04**
  - Seed mit 1.000 Rezepten (je 10 Zutaten, 6 Zubereitungsschritte, 3 Tags): p95 der Serverzeit ≤ 30 ms für `GET /recipes` mit `q`, 2 Tags und Sortierung, ≤ 10 ms für `GET /recipes/:id` (Vitest-Benchmark).
  - Eine Listenanfrage braucht höchstens 4 SQL-Statements (Zähler im Test).
  - Das Log (NF-25) zeigt im Normalbetrieb keine Anfrage über 100 ms, ausgenommen Upload und Export; Backups laufen asynchron (F-40) und sind nicht ausgenommen.
- **NF-05**
  - Nach 10 min Leerlauf zeigt der Task-Manager RSS ≤ 80 MB und CPU 0 %; einziger Server-Timer ist die stündliche Wartung.
  - Leerlauf-RSS 10 min nach einem Upload ≤ 80 MB (misst, ob Speicher nach der Spitze zurückgegeben wird).
  - Zwei gleichzeitige Uploads von 12-MP-Fotos: RSS-Spitze ≤ 250 MB (`process.memoryUsage` im Log). Weitere Jobs warten in einer Warteschlange; Uploads landen als Stream in `data/tmp/`, nicht im RAM.
  - Start bis „bereit“ ≤ 1 s (ohne FTS-Neuaufbau); während einer Bildverarbeitung antwortet `/api/v1/health` in ≤ 200 ms.
- **NF-06**
  - `/media/<key>-s.webp` antwortet mit `Cache-Control: public, max-age=31536000, immutable`; beim zweiten Aufruf der Liste kommen alle Bilder aus dem Cache.
  - Listen laden je nach Kartenbreite und Pixeldichte s oder m, nie l; das Detail lädt m, das Vollbild l; Bilder außerhalb des Viewports laden lazy.
  - Auf dem iPad (2-spaltige Liste) und am Handy (1 Spalte) gilt für jedes Kartenbild: natürliche Breite ≥ angezeigte Breite × min(DPR, 2) (E2E-Prüfung über `naturalWidth`).
  - Bilder haben feste Abmessungen bzw. ein festes Seitenverhältnis: CLS < 0,05 beim Laden der Liste.

#### 3.2.2 Bedienbarkeit

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-07 | Touch-Bedienung und Daumenzone | Tippflächen ≥ 44×44 px, Küchenaktionen ≥ 48×48 px, Abstand ≥ 8 px. Primäraktionen liegen am Handy in der unteren Bildschirmhälfte. Keine Funktion setzt Hover, langes Drücken oder Doppeltipp voraus. Die Bildschirmtastatur verdeckt nie das fokussierte Feld. | Muss |
| NF-08 | Responsives Layout | < 600 px Handy (eine Spalte, untere Navigation); 600–1023 px Tablet hochkant (Karten zweispaltig, Detail zweispaltig, untere Navigation); ≥ 1024 px Tablet quer und Desktop (Navigationsleiste links, Liste 360–400 px und Detail nebeneinander). Die genauen Werte kommen aus dem Design (M1). | Muss |
| NF-09 | Langsames oder unterbrochenes WLAN | Skeletons statt weißer Seiten, Timeouts mit Wiederholen, kein doppeltes Speichern, Aktualisierung nach der Wiederverbindung. | Muss |
| NF-10 | Deutsche Oberfläche und Formate | Alle Texte sind deutsch und liegen in `client/src/i18n/de.ts`. UI-Texte duzen durchgängig („Tippe …“, „Meintest du …“), Beschriftungen sind knapp und neutral. Dezimalkomma und Formatregel für Mengen nach F-10; Datum „12.03.2026“, innerhalb von 7 Tagen relativ („heute“, „vor 3 Tagen“). Alle Server-Fehlercodes haben einen deutschen Text. | Muss |

Akzeptanzkriterien:

- **NF-07**
  - Alle interaktiven Elemente haben ≥ 44×44 px Trefferfläche; Herz, Sterne, FAB, Speichern, Checklisten-Zeilen und „Weiter“ im Kochmodus haben ≥ 48×48 px (DevTools-Stichprobe auf allen Screens).
  - Am Handy liegen Speichern, FAB und Navigation in der unteren Bildschirmhälfte.
  - Jede Wischgeste hat eine sichtbare Alternative, etwa Auf/Ab-Schaltflächen beim Umsortieren.
  - Bei offener Bildschirmtastatur bleibt das fokussierte Feld sichtbar, und die Speichern-Leiste verdeckt kein Eingabefeld (geprüft bei 360×640 auf Android und auf dem iPhone; Umsetzung über `visualViewport`). Das Zutaten-Zeilenlayout unter 400 px Breite folgt dem M1-Artboard.
- **NF-08**
  - Bei 360, 390, 768, 1024 und 1440 px Breite gilt `document.documentElement.scrollWidth ≤ innerWidth` (E2E), und nichts überlappt (Screenshot-Prüfung).
  - Bei 1024×768 sind Liste und Detail gleichzeitig sichtbar; die Auswahl eines Rezepts ändert nur die Detailspalte und die URL.
  - Das Drehen des Tablets behält Rezept und Scrollposition.
- **NF-09**
  - Mit einem eigenen DevTools-Drosselprofil „Schwaches WLAN“ (400 kbit/s Down, 400 kbit/s Up, 400 ms RTT) zeigt jede Ansicht innerhalb von 1 s Skeletons, nie eine weiße Seite.
  - Anfragen brechen nach 10 s ab und bieten „Erneut versuchen“ an. Uploads brechen nur ab, wenn 30 s lang kein Fortschritt kommt: Ein 12-MB-Foto mit einem Profil von 1 Mbit/s Upload wird vollständig hochgeladen.
  - Doppeltes Tippen auf Speichern oder das Wiederholen nach einem Verbindungsabbruch erzeugt kein zweites Rezept: Der Client sendet einen `createKey`, und der Server liefert beim zweiten `POST` dasselbe Rezept zurück (API-Test).
  - Nach der Wiederverbindung (`online`-Ereignis oder erfolgreicher Retry) aktualisiert sich die aktuelle Ansicht (außer Editor und Kochmodus, F-36).
- **NF-10**
  - Ein Test bildet jeden Server-Fehlercode auf einen Text in `de.ts` ab; es gibt keinen Code ohne deutschen Text.
  - 2.4 erscheint als „2,4“, die Eingabe „2,4“ wird als 2.4 gespeichert; Brüche nach der Formatregel aus F-10.
  - Datumsangaben: „12.03.2026“; innerhalb von 7 Tagen „heute“, „gestern“, „vor 3 Tagen“.
  - Die Review-Checkliste für UI-Texte prüft die Du-Form; `de.ts` enthält keine Sie-Anrede (Suche nach „ Sie “, „Ihre“, „Meinten“).

#### 3.2.3 Gestaltung und Barrierefreiheit

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-11 | Barrierefreiheit (Basis) | Semantisches HTML, Labels, sichtbarer Fokus, volle Tastaturbedienung, ARIA für Sterne, Chips und Dialoge, `prefers-reduced-motion`. Die Sterne sind eine `radiogroup` (Pfeiltasten wählen); „Bewertung entfernen“ ist eine eigene Schaltfläche (F-27). | Muss |
| NF-12 | Palette ausschließlich über Design-Tokens | Die fünf Palettenfarben, das neutrale Weiß für `--color-on-primary` und alle abgeleiteten Töne stehen nur als CSS Custom Properties in `client/src/styles/tokens.css`: `--color-bg`, `--color-text`, `--color-primary`, `--color-secondary`, `--color-highlight` und die Ableitungen (Kap. 6.7). Ableitungen werden im Design-Schritt mit oklch berechnet und als feste Werte hinterlegt, die oklch-Formel steht als Kommentar daneben. | Muss |
| NF-13 | Kontrastregeln | Normaler Text ≥ 4,5:1; großer Text (≥ 24 px bzw. ≥ 18,66 px fett), Icons und UI-Grenzen ≥ 3:1. UI-Komponenten, deren Fläche die einzige Begrenzung ist, brauchen ≥ 3:1 zum Umfeld. Moonstone und Vanilla nur als Fläche mit dunklem Text; Terracotta auf Linen nie als normaler Text. Zustände nie nur über Farbe. Icons auf Fotos liegen auf einer eigenen Fläche. | Muss |
| NF-14 | Dark Mode | Folgt `prefers-color-scheme`; ein Schalter System/Hell/Dunkel in „Mehr“ gilt je Gerät; das Farbschema steht vor dem ersten Rendern fest. | Muss |
| NF-15 | Typografie, Schriften, Icons | Fließtext am Handy ≥ 16 px, Eingabefelder ≥ 16 px, Zeilenhöhe ≥ 1,4, Größen in rem. Höchstens 2 selbst gehostete Schriftfamilien (WOFF2, kein CDN, `font-display: swap`), eingebunden per `@font-face` aus `client/src/assets/fonts/`, damit Vite sie gehasht unter `/assets/` ablegt. Ein einheitliches, strichbasiertes SVG-Icon-Set; keine Emojis und keine Textzeichen wie „⋯“ oder „+“ als Icons. | Muss |
| NF-16 | Umsetzung nach freigegebenem Design | Komponenten werden exakt nach den freigegebenen Artboards aus M1 umgesetzt; Werte werden übernommen, nicht gerundet. Screens ohne eigenes Artboard werden ausschließlich aus Tokens und Komponenten des Komponenten- und Zustandsblatts gebaut und in M7 als Screenshot-Satz gesondert freigegeben. Vor der Freigabe entsteht kein UI-Code außer technischen Platzhaltern. | Muss |

Akzeptanzkriterien:

- **NF-11**
  - Lighthouse Accessibility ≥ 95 für Profilwahl, Liste, Detail und Editor, hell und dunkel (schließt die Kontrastprüfung von Lighthouse ein).
  - Ein Rezept lässt sich allein mit der Tastatur anlegen und speichern; der Fokus ist immer sichtbar; Escape schließt Sheets.
  - Die Sterne sind per Pfeiltasten bedienbar und werden als „Bewertung, 4 von 5 Sternen“ vorgelesen; „Bewertung entfernen“ ist per Tab erreichbar und per Enter auslösbar.
  - Icon-Schaltflächen haben `aria-label`; mit `prefers-reduced-motion` dauert keine Animation länger als 100 ms.
- **NF-12**
  - Ein Test durchsucht `client/src/**/*.{svelte,ts,css,svg}` und `client/index.html` nach Farbliteralen (`#hex`, `rgb(`, `hsl(`, `oklch(`) und schlägt bei einem Treffer fehl. Abschließende Ausnahmen: `tokens.css`, `print.css` (Schwarz auf Weiß), `manifest.webmanifest` (`theme_color`, `background_color`), die `<meta name="theme-color">`-Tags in `index.html` (je Schema mit `media="(prefers-color-scheme: dark)"`), das Inline-Theme-Skript und die generierten App-Icons. Icons, Illustrationen und Platzhalter verwenden `currentColor` oder CSS-Variablen.
  - `tokens.css` enthält die Basiswerte exakt: #EFE6DD, #231F20, #BB4430, #7EBDC2, #F3DFA2, #D9634F als Primärfarbe im Dark Mode sowie #FFFFFF als `--color-on-primary` hell.
  - Moonstone und Vanilla kommen nur als `background` oder `fill` vor, nie als `color` (Test über die Token-Verwendung plus Review-Checkliste).
- **NF-13**
  - `tests/unit/contrast.test.ts` berechnet für alle Paare Text-Token × {`--color-bg`, `--color-surface`, `--color-surface-raised`} und für alle Flächen-Token × Text/Icon (secondary, highlight, primary, Avatarfarben) in beiden Modi das WCAG-Verhältnis und schlägt unter der jeweiligen Grenze fehl; die Paarliste wird aus `tokens.css` erzeugt, nicht freiwillig deklariert.
  - Primär-Schaltflächen tragen hell weiße Schrift auf #BB4430 (5,27:1) und dunkel Raisin Black auf #D9634F (4,54:1); Primär- und Fehlertext in normaler Größe nutzt `--color-primary-text` (≥ 4,5:1 auf allen Flächen); Terracotta erscheint auf Linen nie als Text unter 24 px (bzw. 18,66 px fett).
  - Sterne: Der Unterschied zwischen gefülltem und leerem Stern ist in hell und dunkel durch Form (gefüllt mit Kontur `--color-text` vs. nur Kontur `--color-border-strong` ≥ 3:1) und den Text „Deine Bewertung: n“ erkennbar, nicht allein durch die Vanilla-Füllung.
  - Aktiver Filter, Favorit, eigene Bewertung und Fehler sind zusätzlich durch Symbol, Füllung oder Text erkennbar; die Initiale auf jeder Avatarfarbe erreicht ≥ 4,5:1 in beiden Modi.
  - Das Herz auf einer Karte mit Foto erreicht gegen ein rein weißes und ein rein schwarzes Testbild ≥ 3:1 zu seiner Unterlage (E2E-Screenshot-Messung).
- **NF-14**
  - Bei dunklem Systemschema startet die App ohne hellen Blitz (Skript im `<head>` setzt das Schema vor dem ersten Paint).
  - Die manuelle Wahl überschreibt das System und bleibt nach dem Neuladen erhalten.
  - Alle Screens einschließlich Sheets, Dialogen, Toasts, Platzhaltern und Skeletons sind in beiden Modi gestaltet; NF-13 ist für beide grün.
- **NF-15**
  - Fließtext am Handy ≥ 16 px, Eingabefelder ≥ 16 px (Fokus löst auf iOS keinen Zoom aus), Zeilenhöhe ≥ 1,4.
  - Schriften liegen als WOFF2 mit Hash-Namen unter `/assets/` und respektieren das Budget aus NF-01; der Netzwerk-Tab zeigt keine Anfrage an fremde Hosts, auch nicht ohne Internetverbindung.
  - Alle Icons stammen aus einem strichbasierten Set, liegen als Inline-SVG-Sprite vor und nutzen `currentColor`; ein Test findet keine Emoji-Codepunkte in `.svelte`-Dateien.
- **NF-16**
  - Für jedes freigegebene Artboard gibt es einen gleich großen Screenshot der Umsetzung im selben Modus. Maße, Farben und Schriftgrößen aus dem Token-Blatt sind identisch; jede Layout-Abweichung > 4 px steht mit Begründung in der Vergleichsliste (Kap. 9.6) und ist vom Nutzer freigegeben.
  - Screens ohne eigenes Artboard (u. a. Tag-Seite, Papierkorb, Verbinden, Status, Konfliktdialog, Desktop ≥ 1280 px) stehen als eigener Screenshot-Satz in der Vergleichsliste und sind vom Nutzer freigegeben.
  - Bis zur Freigabe in M1 enthält das Repository nur die technische Platzhalterseite aus M0 als UI-Code.

#### 3.2.4 Kompatibilität

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-17 | Browser- und Geräteunterstützung | Android 12+ mit Chrome (aktuelle und vorherige Hauptversion), iOS/iPadOS 17+ mit Safari, Windows 10/11 mit aktuellem Chrome, Edge und Firefox. Keine Polyfills für ältere Browser. | Muss |

Akzeptanzkriterien:

- **NF-17**
  - Die Abnahme-Checkliste (Kap. 9.4) ist je Release auf allen 4 Geräteklassen abgehakt: alle Prüfpunkte zu Muss-Anforderungen; Prüfpunkte zu Soll- und Kann-Anforderungen, sofern diese umgesetzt sind.
  - Die E2E-Smoke-Tests laufen in Chromium und WebKit grün.
  - Ein nicht unterstützter Browser (z. B. iOS 15) zeigt einen deutschen Hinweis statt einer leeren Seite.

#### 3.2.5 Datensicherheit und Backup

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-18 | Ein Datenordner, Wiederherstellung durch Kopieren | Alle veränderlichen Daten liegen in `DATA_DIR` (Standard `C:\RezepteApp\data`): `rezepte.sqlite` (+ `-wal`/`-shm`), `images/` (inkl. `images/.trash/`), `backups/`, `logs/`, `tmp/`. Der Code liegt getrennt in `app/`. | Muss |
| NF-19 | Datenintegrität und Absturzsicherheit | WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. Jeder zusammengesetzte Schreibvorgang, einschließlich FTS, ist eine Transaktion. Beim Start läuft `PRAGMA quick_check`; bei einem Fehler geht der Server in einen Nur-Lese-Modus. | Muss |
| NF-20 | Schema-Migrationen mit Vorab-Backup | Nummerierte SQL-Migrationen laufen beim Start in einer Transaktion; der Stand steht in `PRAGMA user_version`; vorher entsteht automatisch ein Backup. | Muss |
| NF-21 | Schutzmaßnahmen im LAN | Keine Authentifizierung (Nutzerentscheidung), aber Schutz vor Unfällen und fremden Webseiten: Upload-Prüfung, Pfadschutz, Größenlimits, Schutz gegen Cross-Site-Anfragen und DNS-Rebinding, sichere Links, dokumentiertes Vertrauensmodell. Host-Prüfung: Jedes IP-Literal (IPv4, IPv6 in Klammern) und `localhost` sind erlaubt, weil DNS-Rebinding immer einen Hostnamen voraussetzt. Hostnamen sind nur exakt erlaubt aus `<Computername>`, `<Computername>.local`, dem Host von `PUBLIC_URL` und der Liste `ALLOWED_HOSTS` (kommagetrennt, Standard `<Computername>.fritz.box`), ohne Beachtung von Groß-/Kleinschreibung und Port. | Muss |

Akzeptanzkriterien:

- **NF-18**
  - Dienst stoppen, `data/` auf einen zweiten PC mit derselben App-Version kopieren, starten → alle Rezepte, Bilder und Bewertungen sind da.
  - Die Wiederherstellung einer Backup-Datei nach `docs/BETRIEB.md` (≤ 10 Schritte) wurde vor dem Release einmal real durchgeführt und protokolliert.
  - Die App schreibt nur in `DATA_DIR`; auch die WinSW-Logs liegen in `data/logs/`.
- **NF-19**
  - Ein erzwungener Fehler beim Einfügen des 3. Zubereitungsschritts hinterlässt kein halbes Rezept (API-Test).
  - `taskkill /F` während einer Schreibserie (Skript mit 100 Speicherungen) → Neustart ohne Fehler, `quick_check` = ok, jede bestätigte Speicherung ist vorhanden.
  - Mit einer absichtlich beschädigten Test-DB startet der Server im Nur-Lese-Modus: Schreibanfragen liefern 503 `READ_ONLY`, und ein Banner verweist auf die Wiederherstellung aus `backups/`.
- **NF-20**
  - Auf einer leeren DB laufen alle Migrationen; beim zweiten Start läuft keine erneut.
  - Vor jeder Migration entsteht `backups/pre-migration-NNN.sqlite`; die letzten 5 bleiben erhalten.
  - Eine fehlschlagende Migration wird zurückgerollt; der Server beendet sich mit Exit-Code 1 und klarer Meldung, die DB bleibt unverändert.
- **NF-21**
  - `GET /media/../rezepte.sqlite` und `/media/%2e%2e%2frezepte.sqlite` → 404. Dateinamen müssen `^[0-9a-f]{16}-(s|m|l)\.webp$` entsprechen.
  - Ein Titel `<script>alert(1)</script>` erscheint als Text; die Quelle `javascript:alert(1)` erscheint als Text, nicht als Link; ein JSON-Body > 1 MB → 413; ein Upload ohne Bild-Magic-Bytes → 415.
  - Schreibende Anfragen ohne den Header `X-Rezepte-Client` oder mit falschem Content-Type → 400, sodass fremde Webseiten ohne CORS-Preflight nichts ändern können. Anfragen mit dem Host `evil.example` → 421; Browser-Navigationen (`Accept: text/html`) erhalten dabei eine deutsche HTML-Seite mit der richtigen URL. `Host: 192.168.178.99:8080`, `kueche-pc.fritz.box` und `[fd00::5]:8080` → erlaubt.
  - Wechselt die IP des Server-PCs im laufenden Betrieb, ist die App über die neue IP ohne Neustart erreichbar (kein 421).
  - `docs/BETRIEB.md` enthält „Wer kann zugreifen?“: Jedes Gerät im WLAN darf alles, keine Portweiterleitung, Gäste gehören ins Gäste-WLAN.

#### 3.2.6 Betrieb

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-22 | Ein Prozess, ein Port, Windows-Dienst | Ein Node-Prozess liefert API, SPA und Bilder auf einem Port (Standard 8080, `PORT`). Er läuft als Windows-Dienst „RezepteApp“ über WinSW 2.12.0 (`WinSW-NET461.exe`, SHA-256 geprüft) unter dem Konto LocalService, Starttyp Automatisch, Neustart 10 s nach einem Absturz. `node.exe` ist maschinenweit installiert. | Muss |
| NF-23 | Firewall, Netzwerkprofil, Erreichbarkeit | Eingehende Regel nur für das Profil „Privat“; Prüfung des Netzwerkprofils, von mDNS und von Block-Regeln für `node.exe`; erreichbar über IP (verbindlich) und `<Computername>.local` (umgebungsabhängig); DHCP-Reservierung dokumentiert. | Muss |
| NF-24 | Robuster Start, sauberes Beenden, eingeschränkter Betrieb | Start-Prüfungen mit klaren Meldungen, geordnetes Beenden mit WAL-Checkpoint, eingeschränkter Betrieb, wenn sharp nicht lädt oder der Speicher knapp wird. | Muss |
| NF-25 | Logging | JSON Lines in `data/logs/app.log` mit Zeit (UTC), Level, `requestId`, Methode, Pfad, Status, `durationMs` und bei Fehlern dem Stack. Rotation bei 5 MB, 3 Generationen. Die Datei bleibt nicht dauerhaft geöffnet. Begründung für Muss: Mehrere Nachweise (NF-04, NF-05, F-15, F-16) stützen sich auf das Log. | Muss |
| NF-26 | Ehrlicher Umgang mit dem unsicheren http-Kontext | Funktionen, die einen sicheren Kontext brauchen, werden per Feature-Detection geprüft und ohne Fehler ausgeblendet oder ersetzt. Die App verspricht weder Offline-Betrieb noch eine Installation im Sinne einer PWA; sie bietet nur eine Verknüpfung auf dem Startbildschirm (F-37). | Muss |
| NF-27 | Installation und Update | Dokumentierte Installation in ≤ 20 min; ein Update-Skript mit Health-Prüfung und Rückweg. | Soll |

Akzeptanzkriterien:

- **NF-22**
  - Nach `deploy/install.ps1` (als Administrator) und einem Neustart des PCs ist `http://<IP>:8080` vom Handy erreichbar, ohne dass sich jemand am PC angemeldet hat.
  - Nach dem Beenden von `node.exe` im Task-Manager ist die App ≤ 15 s später wieder erreichbar; `netstat` zeigt genau einen lauschenden Port der App.
  - `install.ps1` bricht mit einer Meldung ab, wenn `node.exe` unter einem Benutzerprofil liegt oder LocalService `app/`, `node.exe` oder die nativen Module nicht lesen kann. Nach der Installation fragt das Skript `/api/v1/health` des laufenden Dienstes ab.
  - `uninstall.ps1` entfernt Dienst und Firewall-Regel und lässt `data/` unangetastet.
- **NF-23**
  - `Get-NetFirewallRule -DisplayName 'RezepteApp'` zeigt eine aktive Regel: Inbound, TCP 8080, Profil Private. Für Public gibt es keine Regel.
  - `install.ps1` prüft `Get-NetConnectionProfile` und nennt bei „Public“ den Befehl zur Umstellung; meldet abgeschaltetes mDNS (`EnableMDNS=0`); findet Block-Regeln für `node.exe` (`Get-NetFirewallApplicationFilter -Program '*node.exe' | Get-NetFirewallRule | Where-Object Action -eq Block`) und deaktiviert sie nach Rückfrage.
  - IP-URL und QR-Code funktionieren auf Android und iOS im selben WLAN (verbindlich). `http://<Computername>.local:8080` wird auf den Abnahmegeräten getestet und das Ergebnis dokumentiert (kein Abnahmekriterium, weil es von Router, Multicast und „Privates DNS“ abhängt).
  - `docs/VERBINDEN.md` beschreibt die DHCP-Reservierung (FRITZ!Box und allgemein) in ≤ 5 Schritten.
- **NF-24**
  - Ist `DATA_DIR` nicht beschreibbar, der Port belegt (`EADDRINUSE`) oder von Windows reserviert (`EACCES`, `netsh int ipv4 show excludedportrange protocol=tcp`), endet der Start mit Exit-Code 1 und der Meldung „Datenordner nicht beschreibbar: …“, „Port 8080 ist bereits belegt“ bzw. „Port 8080 ist von Windows reserviert – anderen Port wählen“; `install.ps1` prüft die Ausnahmebereiche vorab.
  - `Stop-Service RezepteApp` (WinSW sendet Strg+C, Node erhält SIGINT bzw. SIGBREAK) erzeugt die Logzeile „shutdown: SIGINT“; offene Requests laufen höchstens 5 s weiter, dann folgt `wal_checkpoint(TRUNCATE)`; danach ist `rezepte.sqlite-wal` leer oder nicht vorhanden (in M6 real geprüft).
  - Lädt sharp nicht, startet der Server trotzdem: `/api/v1/health` meldet `images: "unavailable"`, Uploads liefern 503 `IMAGES_UNAVAILABLE` mit deutscher Meldung, vorhandene Bilder werden weiter ausgeliefert.
  - Unter 200 MB freiem Speicher werden Uploads mit 507 abgelehnt und Backups mit einer Warnung in `/api/v1/health` übersprungen.
- **NF-25**
  - Jeder Request erzeugt genau eine Zeile mit `durationMs`. Bei einem 500er steht der Stack im Log; die HTTP-Antwort enthält nur `code`, `message` und `requestId`.
  - Nach 5 MB entsteht `app.1.log`; es gibt nie mehr als 3 Dateien.
  - Wird `app.log` bei laufendem Server gelöscht oder verschoben, legt der nächste Schreibvorgang sie neu an, ohne Fehler und ohne verlorene Folgezeilen.
- **NF-26**
  - Über `http://192.168.x.x` zeigt die Konsole keinen Fehler zu Service Worker, Wake Lock, Clipboard oder Web Share, und kein Service Worker wird registriert.
  - Die Prüfung erfolgt über `window.isSecureContext` und `'wakeLock' in navigator`; nicht verfügbare Funktionen sind ausgeblendet oder ersetzt.
  - Sofern F-31 bzw. F-38 umgesetzt sind: Über `http://localhost` sind Wake Lock bzw. `navigator.clipboard` aktiv.
  - Weder UI noch Doku versprechen Offline-Betrieb oder eine App-Installation; sie sprechen von „Verknüpfung auf dem Startbildschirm“.
- **NF-27**
  - Eine technisch versierte Person installiert die App nach `docs/BETRIEB.md` auf einem frischen Windows-11-PC mit Node 24 in ≤ 20 min. Die Anleitung behandelt: Port belegt oder reserviert, Netzprofil öffentlich, `.local` nicht auflösbar, Browser-Warnung „Nicht sicher“.
  - `deploy/update.ps1` (als Administrator) stoppt den Dienst, führt `git pull`, `pnpm install --frozen-lockfile --package-import-method=copy` und `pnpm build` aus, startet den Dienst und prüft die Health. Scheitert ein Schritt, gibt es einen dokumentierten Rückweg (vorheriger Git-Tag und pre-migration-Backup).
  - Nach dem Update meldet `/api/v1/health` die neue Version, und offene Clients zeigen das Update-Banner (F-36).

#### 3.2.7 Wartbarkeit

| ID | Titel | Beschreibung | Priorität |
|---|---|---|---|
| NF-28 | Qualitäts-Gate, strikte Typen, geteilte Validierung | `pnpm verify` = `svelte-check` + `tsc --noEmit` (server, shared) + `biome check` + `vitest run` + Size-Check. TypeScript 6.x strict mit `noUncheckedIndexedAccess`, `erasableSyntaxOnly` und `verbatimModuleSyntax`. zod-Schemas (API `zod/mini`) in `shared/` sind die einzige Quelle für Validierung (Server und Editor), Typen und Exportformat. | Muss |
| NF-29 | Automatisierte Tests | Unit-, API- und E2E-Smoke-Tests nach Kap. 9. | Muss |

Akzeptanzkriterien:

- **NF-28**
  - `pnpm verify` endet auf dem Entwicklungs-PC mit Exit-Code 0 in ≤ 90 s; GitHub Actions führt es bei jedem Push aus.
  - Ein Rezept, das der Editor als gültig anzeigt, lehnt der Server nie mit 400 ab (gemeinsame Fixtures für Client- und API-Tests).
  - Wird ein Feld im zod-Schema umbenannt, entstehen Typfehler in Client und Server.
  - Die Biome-Regel `noExplicitAny` steht auf `error`; ein eingebauter Verstoß lässt `verify` scheitern. Eine Lint-Regel bzw. ein Test findet keine statischen `style=`-Attribute in `.svelte`-Dateien (CSP, Kap. 7.8).
- **NF-29**
  - Jeder API-Endpunkt hat mindestens einen Erfolgs- und einen Fehlerfall-Test; die Manipulationstests aus F-05, F-07, F-14, F-19 und NF-21 sind enthalten.
  - Unit-Tests gibt es für `normalize` (≥ 30 Fälle), den Zutaten-Parser (≥ 40 Zeilen mit Sollwerten), die Mengen-Formatregel, den Query-Builder der Suche, den Backup-Zeitplan mit injizierter Uhr und die Kontrastpaare; für Skalierung und Pluralformen, falls F-13 umgesetzt wird.
  - 4 Playwright-Smoke-Flows laufen gegen den Produktions-Build mit aktiver CSP in den Viewports 390×844 und 1024×768 grün (Chromium, WebKit): Profil wählen; Rezept mit Bild anlegen; suchen und filtern; bewerten und favorisieren. Jeder Flow schlägt fehl, wenn ein `securitypolicyviolation`-Ereignis auftritt.

### 3.3 Explizit nicht im Umfang (Backlog / Später)

Ideen aus diesem Backlog wandern erst nach der Abnahme von Release 1.0 und nach einer bewussten Entscheidung in den Katalog. Bei „Vorbereitung in Release 1.0“ steht nur, was ohnehin gebraucht wird; es gibt keine Spalten auf Vorrat.

| Thema | Grund für die Verschiebung | Vorbereitung in Release 1.0 |
|---|---|---|
| Mehrere Bilder je Rezept, Bilder zu Zubereitungsschritten | Mehr UI (Galerie, Sortierung) ohne Nutzen für den Kern | `images` ist eine eigene Tabelle; Positionsspalte und Migration kommen mit der Funktion |
| Rezept duplizieren („Variante von …“) | Nicht im Nutzerumfang | – |
| Timer aus Zubereitungsschritten | Braucht Zeitangaben je Schritt und Audio; über http eingeschränkt | – |
| Einkaufsliste mit Mengenaggregation | Eigene Funktion; braucht Einheitenumrechnung | Strukturierte Zutaten (`amount`, `unit`, `name_key`) |
| Wochenplan | Eigene Funktion mit Kalender | – |
| URL-Import (schema.org/Recipe) | Webseiten-Parsing ist wartungsintensiv | Feld `source` |
| Import einer Sicherung per UI | Release 1.0 stellt durch Zurückkopieren wieder her | Exportformat Version 1 ist definiert (F-41) |
| „Was koche ich heute?“ (Zufallsrezept) | Nicht im Nutzerumfang | – |
| Kochhistorie, „Zuletzt gekocht“, „Zuletzt angesehen“ je Gerät | Nicht im Nutzerumfang; „Neueste“ plus Chips und Favoriten genügen | – |
| Kommentare und Kochnotizen je Profil | Nicht im Nutzerumfang | – |
| Nährwerte, Allergene | Datenpflege aufwendig | – |
| Echte Tippfehlertoleranz (zweite FTS5-Tabelle mit `trigram`) | Index etwa 3-mal größer; „Meintest du“ deckt den Alltag ab | Suche ist im Modul `server/services/search.ts` gekapselt |
| Clientseitige Verkleinerung und HEIC-Konvertierung vor dem Upload | Server-Pipeline genügt; EXIF und HEIC im Browser uneinheitlich | Upload-Endpunkt akzeptiert beliebige erlaubte Größen bis 20 MiB |
| HTTPS (mkcert oder eigene Domain mit DNS-01) samt Offline-Lesen per Service Worker, nativem Wake Lock und Web Share | Vertrauensschritt auf jedem Gerät bzw. eigene Domain nötig (Kap. 10.7) | `@hono/node-server` unterstützt `createServer: https.createServer`; Release 1.0 enthält dafür bewusst keinen ungetesteten Code |
| Optionaler Admin-PIN für endgültiges Löschen und Tag-Zusammenführung | Widerspricht der Entscheidung „keine Passwörter“; Papierkorb und Backups genügen | Endgültige Aktionen sind im Code zentral markiert |
| Echtzeit-Aktualisierung (Server-Sent Events) | Bei 1–3 Geräten genügen Neuladen beim Tab-Wechsel und 60-s-Revisionsabgleich (F-36) | `X-Data-Revision`, `GET /revision` |
| Versionshistorie von Rezepten | Aufwand; der Papierkorb deckt das Löschen ab | – |
| Watchdog gegen einen hängenden Prozess | WinSW startet nur bei Prozessende neu; das Risiko ist gering | `/api/v1/health` |
| Automatische Kopie der Backups auf NAS/USB | Umgebungsabhängig | Skriptvorlage in `docs/BETRIEB.md` |
| Mehrsprachigkeit | Nur Deutsch gefordert | Alle Texte in `de.ts` |
| Tray-App für Windows | Der Dienst genügt | – |
| Tag-Kategorien, Hierarchie, Tag-Farben | Flache Tags genügen | – |
| Wechsel auf `node:sqlite` | Erst sinnvoll, wenn das Modul in der eingesetzten Node-LTS stabil ist (Kap. 5.3) | DB-Zugriff ist in `server/db/connection.ts` gekapselt |

---

## 4. Datenmodell

### 4.1 Grundsätze

- Vollständig relational: Zutaten, Zubereitungsschritte, Tags und Bilder sind eigene Tabellen; es gibt keine JSON-Strings in TEXT-Spalten.
- IDs sind `INTEGER PRIMARY KEY` (rowid): kompakt, schnell, und die FTS-Zeile verwendet dieselbe rowid.
- Zeitstempel sind TEXT im Format ISO 8601 in UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`); die Anzeige rechnet in Ortszeit um.
- Jede such-, sortier- oder eindeutigkeitsrelevante Textspalte hat eine Schlüsselspalte `*_key`, berechnet von derselben Funktion `shared/normalize.ts` in Client und Server. SQLite kennt ohne ICU keine deutsche Kollation, und better-sqlite3 bietet keine eigene Kollations-API.
- UI-first: Jede Spalte hat eine Oberfläche oder eine technische Begründung, die als Kommentar in der DDL steht (z. B. `create_key`, `*_key`).
- PRAGMAs beim Öffnen: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `cache_size=-16000` (16 MB).

### 4.2 Tabellenübersicht

| Tabelle | Zweck | Wichtige Spalten | Indizes |
|---|---|---|---|
| `profiles` | Personen ohne Passwort | `name`, `name_key` (UNIQUE), `avatar` (Token-Name) | UNIQUE `name_key` |
| `recipes` | Gemeinsame Rezepte | `title`, `title_key`, Zeiten, Portionen, `source`, `version`, `created_by`, `updated_by`, `deleted_at`, `deleted_by`, `create_key` | `(title_key, title)`, `created_at`, `updated_at` jeweils partiell für `deleted_at IS NULL`; `deleted_at` partiell; UNIQUE `create_key` |
| `ingredients` | Zutaten | `position`, `group_name`, `amount`, `amount_max`, `unit`, `name`, `name_key`, `note` | `(recipe_id, position)`, `name_key` |
| `steps` | Zubereitungsschritte | `position`, `text` | `(recipe_id, position)` |
| `tags` | Tags | `name`, `name_key` (UNIQUE) | UNIQUE `name_key` |
| `recipe_tags` | Zuordnung Rezept ↔ Tag | PK `(recipe_id, tag_id)` | `(tag_id, recipe_id)` |
| `images` | Bild und Varianten | `recipe_id` (NULL = hochgeladen, noch nicht zugeordnet), `file_key`, Abmessungen | UNIQUE `recipe_id` partiell (ein Bild je Rezept); `created_at` partiell für nicht zugeordnete |
| `ratings` | Bewertung je Profil | PK `(profile_id, recipe_id)`, `stars` 1–5 | `recipe_id` |
| `favorites` | Favorit je Profil | PK `(profile_id, recipe_id)` | `recipe_id` |
| `meta` | Schlüssel/Wert | `data_revision`, `last_backup_at`, `last_backup_error`, `seeded` | PK `key` |
| `recipes_fts` | Volltextindex (FTS5, contentless) | `title`, `tags`, `ingredients`, `body` | FTS5 mit `prefix='2 3 4'` |

### 4.3 DDL (`server/db/migrations/001_init.sql`)

```sql
CREATE TABLE profiles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL UNIQUE,
  avatar      TEXT NOT NULL DEFAULT 'avatar-1',      -- Token-Name, keine Hex-Farbe
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Reihenfolge der Profilkacheln
);

CREATE TABLE recipes (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_key     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  servings      REAL CHECK (servings IS NULL OR (servings >= 0.25 AND servings <= 100)),
  servings_unit TEXT NOT NULL DEFAULT 'Portionen' CHECK (length(servings_unit) <= 20),
  prep_minutes  INTEGER CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 1 AND 1440),
  cook_minutes  INTEGER CHECK (cook_minutes IS NULL OR cook_minutes BETWEEN 1 AND 1440),
  source        TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 500),
  create_key    TEXT UNIQUE,                          -- vom Client erzeugt; verhindert Doppelanlage
  version       INTEGER NOT NULL DEFAULT 1,           -- nur der Server setzt diesen Wert
  created_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT,                                 -- Papierkorb; NULL = aktiv
  deleted_by    INTEGER REFERENCES profiles(id) ON DELETE SET NULL  -- „gelöscht von“ (Papierkorb, IN_TRASH)
);
CREATE INDEX idx_recipes_title   ON recipes(title_key, title) WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_created ON recipes(created_at)       WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_updated ON recipes(updated_at)       WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_trash   ON recipes(deleted_at)       WHERE deleted_at IS NOT NULL;

CREATE TABLE ingredients (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  group_name  TEXT NOT NULL DEFAULT '' CHECK (length(group_name) <= 60),
  amount      REAL CHECK (amount IS NULL OR amount >= 0),
  amount_max  REAL CHECK (amount_max IS NULL OR (amount IS NOT NULL AND amount_max > amount)),
  unit        TEXT NOT NULL DEFAULT '' CHECK (length(unit) <= 20),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_key    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200)
);
CREATE INDEX idx_ingredients_recipe ON ingredients(recipe_id, position);
CREATE INDEX idx_ingredients_name   ON ingredients(name_key);

CREATE TABLE steps (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000)
);
CREATE INDEX idx_steps_recipe ON steps(recipe_id, position);

CREATE TABLE tags (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL UNIQUE
);

CREATE TABLE recipe_tags (
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX idx_recipe_tags_tag ON recipe_tags(tag_id, recipe_id);

CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,  -- NULL = noch nicht zugeordnet
  file_key    TEXT NOT NULL UNIQUE,                              -- 16 Hex, zufällig
  width       INTEGER NOT NULL,                                  -- Variante l; für feste Abmessungen (CLS)
  height      INTEGER NOT NULL,
  bytes_total INTEGER NOT NULL,                                  -- Summe s+m+l; Status-Seite
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Aufräumen nicht zugeordneter Uploads
);
CREATE UNIQUE INDEX idx_images_recipe ON images(recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX idx_images_unassigned ON images(created_at) WHERE recipe_id IS NULL;

CREATE TABLE ratings (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id)  ON DELETE CASCADE,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (profile_id, recipe_id)
) WITHOUT ROWID;
CREATE INDEX idx_ratings_recipe ON ratings(recipe_id);

CREATE TABLE favorites (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id)  ON DELETE CASCADE,
  PRIMARY KEY (profile_id, recipe_id)
) WITHOUT ROWID;
CREATE INDEX idx_favorites_recipe ON favorites(recipe_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO meta(key, value) VALUES ('data_revision', '0');

-- Volltext: contentless-delete (SQLite >= 3.43; better-sqlite3 13 bündelt 3.53.x)
-- rowid = recipes.id; Spalteninhalte sind bereits normalisiert (Kap. 4.4)
CREATE VIRTUAL TABLE recipes_fts USING fts5(
  title, tags, ingredients, body,
  content = '', contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
```

Hinweise zur FTS-Pflege:

- Bei jedem Anlegen oder Ändern eines Rezepts läuft in derselben Transaktion `DELETE FROM recipes_fts WHERE rowid = ?` und danach `INSERT INTO recipes_fts(rowid, title, tags, ingredients, body) VALUES (...)`. Contentless-delete-Tabellen unterstützen `DELETE` und `INSERT OR REPLACE`; das FTS5-Kommando `'delete'` unterstützen sie nicht, `UPDATE` nur mit allen Spalten.
- Nach dem Umbenennen, Zusammenführen oder Löschen eines Tags werden alle betroffenen Rezepte neu indexiert und ihre `version` erhöht, in derselben Transaktion.
- Rezepte im Papierkorb bleiben im Index; die Suchabfrage filtert über `recipes.deleted_at IS NULL`.
- Endgültiges Löschen (Purge nach 30 Tagen, `DELETE /trash/:id`) entfernt in derselben Transaktion `DELETE FROM recipes_fts WHERE rowid = ?`.
- Konsistenzprüfung beim Start: `SELECT count(*) FROM recipes_fts` wird mit `SELECT count(*) FROM recipes` verglichen. Bei einer Abweichung folgen `INSERT INTO recipes_fts(recipes_fts) VALUES('delete-all')` und die Neuindexierung aller Rezepte in einer Transaktion (bei 1.000 Rezepten < 1 s). Das Kommando `'rebuild'` gibt es für contentless-Tabellen nicht. Für Notfälle gibt es `node server/main.ts --rebuild-fts`.
- Spaltenwerte einer contentless-Tabelle sind beim Lesen NULL. Die Anzeige kommt deshalb immer aus `recipes`, und `highlight()`/`snippet()` werden nicht verwendet; der Client hebt Treffer im Titel selbst hervor.

### 4.4 Normalisierung, Umlaute und Sortierung

`normalize(s)` in `shared/normalize.ts` berechnet in dieser Reihenfolge:

1. Unicode-NFD; Kleinschreibung mit `toLocaleLowerCase('de')`.
2. `ß` und `ẞ` → `ss`; `æ` → `ae`, `œ` → `oe`, `ø` → `o`, `ł` → `l`.
3. Kombinierende Zeichen (`\p{M}`) entfernen, also `ä` → `a`, `é` → `e` (DIN 5007-1: ä wird wie a einsortiert).
4. Folgen von drei oder mehr gleichen Buchstaben auf zwei kürzen, Ziffern ausgenommen: „Süßspeise“ → `sussspeise` → `susspeise`; „Schifffahrt“ → `schiffahrt`; „1000“ bleibt `1000`.
5. Leerraum zusammenfassen und trimmen.

Einsatz:

- **Eindeutigkeit:** `profiles.name_key` und `tags.name_key` sind UNIQUE. „Vegan“, „vegan“ und „VEGAN“ sind derselbe Tag, ebenso „Süßspeise“ und „Süssspeise“. Dass auch „Käse“ und „Kase“ zusammenfallen, ist bewusst akzeptiert, weil es Tippfehler-Duplikate verhindert.
- **Sortierung Titel A–Z:** `ORDER BY title_key, title, id`. Das entspricht DIN 5007-1; bei gleichem Schlüssel entscheidet die Binärordnung des Originaltitels, danach die ID.
- **ae/oe/ue:** Diese Ersetzung ist nicht Teil von `normalize()`, damit „Michael“, „Poesie“ oder „Goethe“ im Index unverändert bleiben. `queryVariants()` erzeugt für Begriffe mit `ae`/`oe`/`ue` eine zusätzliche Variante (`kaese` → `kaese`, `kase`); Suche (Kap. 4.5) und Tag-Autovervollständigung (F-18) nutzen sie.
- **Anzeige:** Originaltexte werden nie verändert gespeichert oder angezeigt.

### 4.5 Suchstrategie

1. Der Suchtext wird normalisiert und in Begriffe zerlegt (Trennung an allem außer `\p{L}\p{N}`). Die Suche startet ab 2 Zeichen Gesamtlänge; Begriffe mit 1 Zeichen werden ignoriert.
2. Für jeden Begriff `t` gibt es zwei Trefferquellen:
   - **Präfix (FTS5):** `recipes_fts MATCH '"t"*'`, bei ae/oe/ue zusätzlich `OR "t'"*`. Das Präfix wird korrekt gequotet, Anführungszeichen im Begriff werden verdoppelt, sodass keine FTS-Syntax eingeschleust werden kann.
   - **Teilwort (für Komposita, ab 3 Zeichen):** `title_key LIKE '%t%'` oder ein Tag-`name_key` oder Zutaten-`name_key` enthält `t` (LIKE mit escapten `%` und `_`). Damit findet „suppe“ die „Kürbissuppe“ und „käse“ die Zutat „Parmesankäse“.
3. Die Treffermengen der Begriffe werden geschnitten (`INTERSECT`), also UND-Verknüpfung.
4. Filter: Tags über `recipe_tags` mit exakten IDs, im Modus „alle“ per `GROUP BY recipe_id HAVING COUNT(*) = n`, im Modus „einer reicht“ per `EXISTS`; Favoriten über einen Join auf das Header-Profil; Mindestbewertung über `AVG(stars)`; `deleted_at IS NULL`.
5. Ranking bei Sortierung „Relevanz“: (a) zuerst Rezepte, deren `title_key` alle Begriffe als Präfix oder Teilwort enthält; (b) danach `bm25(recipes_fts, 10.0, 6.0, 4.0, 1.0)` (Titel, Tags, Zutaten, Text) als Gewichtung, nicht als strikte Reihenfolge; (c) Rezepte nur mit Teilworttreffer außerhalb des Titels zuletzt; (d) `title_key` als Gleichstandsregel.
6. Eine Seite braucht ein CTE-Statement für die Seite, eines für die Gesamtzahl und eines für die Tags der Seiten-IDs, also höchstens 4 Statements (NF-04).
7. „Meintest du“ (F-23) und ähnliche Titel (F-45): Aus Titeln, Tag-Namen und Zutatennamen entsteht eine Wortliste (normalisiertes Wort → erste Originalschreibweise), die im Speicher liegt und bei einer Änderung von `data_revision` neu aufgebaut wird (< 5.000 Wörter, < 5 ms). Der Vergleich nutzt Damerau-Levenshtein in reinem TypeScript, ohne Abhängigkeit.
8. Paginierung: 40 Einträge je Seite. Der Cursor kodiert den letzten Sortierwert und die ID (Keyset); bei „Relevanz“ kodiert er einen Offset, was bei ≤ 1.000 Treffern unkritisch ist.

### 4.6 Bildablage

- Dateien: `DATA_DIR/images/<file_key>-s.webp`, `-m.webp`, `-l.webp`, flach, ohne Unterordner (bei ≤ 5.000 Rezepten ≤ 15.000 Dateien, für NTFS unkritisch). Nicht mehr referenzierte Dateien liegen 14 Tage in `images/.trash/` (F-16).
- `file_key` = 16 Hex-Zeichen aus `crypto.randomBytes(8)`. Jeder Upload bekommt einen neuen Schlüssel, darum dürfen URLs `immutable` gecacht werden, und es gibt keine gemeinsam genutzten Dateien, keinen Referenzzähler und keine Deduplizierung.
- Pipeline: Der Request-Body wird als Stream nach `DATA_DIR/tmp/<uuid>.upload` geschrieben, mit Größenzähler und Abbruch bei 20 MiB. Dann folgen die Magic-Byte-Prüfung (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`, HEIC/HEIF-`ftyp` wird erkannt und abgelehnt), die Pixelprüfung (`limitInputPixels` 60 MP) und die Warteschlange (höchstens 2 Jobs). sharp (`cache(false)`, `concurrency(2)`) dekodiert das Original einmal mit `rotate()` und Shrink-on-load zu l, leitet m und s aus dem l-Puffer ab und schreibt die drei Varianten ohne Metadaten nach `tmp/`. Erst wenn alle drei fertig sind, werden sie nach `images/` umbenannt und die `images`-Zeile geschrieben (`recipe_id = NULL`). Danach werden die temporären Dateien gelöscht.
- Zuordnung: `POST`/`PUT /recipes` mit `imageId`. In der Transaktion wird das Bild dem Rezept zugeordnet; ein vorheriges Bild verliert seine Zeile, seine Dateien verschiebt der Server nach dem Commit nach `images/.trash/`. Eine unbekannte oder bereits einem anderen Rezept zugeordnete `imageId` → 400 `VALIDATION` mit `details[0].field = "imageId"`.
- Aufräumen (stündliche Wartung): nicht zugeordnete Bilder älter als 7 Tage; Dateien in `images/.trash/` älter als 14 Tage. Wöchentlich und beim Start: Dateien in `images/` ohne DB-Zeile nach `images/.trash/`, referenzierte Dateien aus `images/.trash/` zurück nach `images/`, Dateien in `tmp/` älter als 1 h löschen.

### 4.7 Migrationen

- Dateien `server/db/migrations/NNN_name.sql`; der Stand steht in `PRAGMA user_version`.
- Beim Start werden alle Migrationen mit einer Nummer über `user_version` in einer Transaktion angewendet; vorher entsteht per `VACUUM INTO` `backups/pre-migration-NNN.sqlite` (die letzten 5 bleiben). `VACUUM INTO` blockiert kurz, läuft aber vor dem Binden des Ports und stört daher keine Anfrage.
- Ein Migrationstest wendet alle Migrationen auf eine leere DB und auf eine Beispiel-DB der Vorversion an.

### 4.8 Exportformat (Version 1)

`rezepte.json`: `{ "format": "rezepte-export", "formatVersion": 1, "exportedAt": "…", "appVersion": "…", "profiles": [{ "ref": "p1", "name": "…", "avatar": "…" }], "tags": ["…"], "recipes": [{ "title": "…", "description": "…", "servings": 4, "servingsUnit": "Portionen", "prepMinutes": 20, "cookMinutes": 25, "source": "…", "createdAt": "…", "updatedAt": "…", "createdBy": "p1", "ingredients": [{ "group": "", "amount": 400, "amountMax": null, "unit": "g", "name": "Mehl", "note": "" }], "steps": [{ "text": "…" }], "tags": ["Vegetarisch"], "image": "images/3f9a1c0b7d2e4a61-l.webp", "ratings": [{ "profile": "p1", "stars": 4 }], "favoritedBy": ["p1"] }] }`. Zutaten und Schritte haben dieselbe Form wie in `RecipeInput` (Kap. 7.4). Interne IDs werden nicht exportiert, Rezepte im Papierkorb ebenfalls nicht. Das zod-Schema `ExportV1` in `shared/` beschreibt das Format und verwendet die Teil-Schemas von `RecipeInput`; F-41 prüft den Export dagegen, und ein späterer Import nutzt dasselbe Schema.

---

## 5. Architektur und Tech-Stack

### 5.1 Entscheidung

| Baustein | Wahl (Stand 09.09.2026) | Begründung |
|---|---|---|
| Laufzeit | Node.js 24 LTS „Krypton“ (installiert: 24.14; aktuell 24.21; Support bis 04/2028). Der Server-Code läuft als TypeScript direkt per Type-Stripping, ohne Build-Schritt. | Schon installiert; eine Sprache für Client, Server und geteilte Schemas; kein `tsx`/`ts-node` nötig |
| Frontend | Svelte 5 (Runes) als reine SPA; eigener History-Router (~100 Zeilen); keine UI-Bibliothek | Kleinste Runtime bei formularlastiger UI, Scoped CSS eingebaut, kein Virtual DOM |
| Build | Vite 8.3 (Rolldown) | Standardwerkzeug, Code-Splitting für die Lazy-Chunks aus NF-01 |
| Styling | Handgeschriebenes CSS: `tokens.css` (Palette, Typo-Skala, Abstände, Radien) + Scoped CSS der Komponenten | Die Tokens bilden die Palette 1:1 ab; ~8 Screens; kein Build-Plugin; CSS ≤ 15 KB |
| HTTP-Server | Hono 4.13 + `@hono/node-server` 2.1 | Keine Abhängigkeiten, Web-Standard-API, `app.request()` für API-Tests ohne Netzwerk |
| Datenbank | SQLite über better-sqlite3 13.0.x (N-API, Prebuilds für Windows x64 direkt im Paket, kein Install-Skript; bündelt SQLite 3.53.x inkl. FTS5); handgeschriebenes SQL mit Prepared Statements; kein ORM | FTS5 ist Kern der Suche; stabile, synchrone API, einfache Transaktionen, asynchrones Online-Backup `db.backup()` |
| Bilder | sharp ≥ 0.35.4 (libvips 8.18, Binärdateien über `@img/sharp-win32-x64`, kein Install-Skript) | 12-MP-Foto zu drei WebP-Varianten in ≤ 2 s (in M3 gemessen); ≥ 0.35.4 wegen Sicherheitskorrekturen in libvips |
| Validierung | zod 4 über die API `zod/mini` (tree-shakebar, Kern ~2 KB gzip) in `shared/schemas.ts` | Ein Schema für Server-Validierung, Editor-Fehler, Typen und Exportformat |
| QR-Code | `qrcode-generator` 2.0.x (0 Abhängigkeiten), nur auf dem Server: `createSvgTag` für die Verbinden-Seite, `createASCII` für die Konsole | Kein QR-Code im Client-Bundle |
| ZIP-Export | Eigener Streaming-Writer, Verfahren „store“ (ohne Kompression), CRC über `zlib.crc32` (in Node 24 vorhanden), ~120 Zeilen | Bilder sind schon komprimiert; keine Abhängigkeit |
| Tests | Vitest 5.0 (seit 03.09.2026; Rückfall auf 4.1, falls ein Plugin noch nicht passt), Playwright für 4 Smoke-Flows | Ein Runner für Unit und API |
| Lint/Format/Typen | Biome 2.x, `svelte-check` 4.x, TypeScript 6.0.x gepinnt | TS 7 hat keine stabile programmatische API; `svelte-check` unterstützt es nur experimentell über `--tsgo` |
| Paketmanager | pnpm 10, festgelegt über `"packageManager": "pnpm@10.34.5"` (letzte 10er-Version; aktuell ist pnpm 12.x, der Wechsel ist ein bewusster Upgrade-Schritt mit `pnpm verify`); **ein** `package.json` mit `client/`, `server/`, `shared/` und drei tsconfigs | Trennung ohne Workspace-Aufwand |
| Dienst | WinSW 2.12.0 (letzte stabile Version, 01/2023), Variante `WinSW-NET461.exe` (~0,6 MB; nutzt das vorinstallierte .NET Framework 4.8) | Startet vor der Anmeldung, Neustart bei Absturz, Stop-Signal per Strg+C, Standardwerkzeuge `sc`/`Start-Service` |

Budgets: Laufzeit-Abhängigkeiten (`dependencies`) genau 6; im Client-Bundle nur `svelte` und `zod/mini`; RAM ≤ 80 MB im Leerlauf; JS initial ≤ 35 KB gzip (NF-01, NF-02, NF-05).

### 5.2 Strittige Punkte zwischen den Vorschlägen und Entscheidung

| Frage | Optionen | Entscheidung und Begründung |
|---|---|---|
| Tailwind oder eigenes CSS | Tailwind 4 (+1 Build-Plugin, 8–15 KB CSS) oder Tokens + Scoped CSS | **Eigenes CSS.** Die Palette verlangt Tokens ohnehin; bei ~8 Screens bringt Tailwind keinen Vorteil, der ein Build-Plugin und Utility-Klassen rechtfertigt. |
| Validierung | Handgeschriebene Funktionen oder zod | **zod/mini in `shared/`.** Ein Schema verhindert, dass Client- und Server-Regeln und Typen auseinanderlaufen; ~2–5 KB gzip, nur im Editor-Chunk. |
| Projektstruktur | pnpm-Workspace mit 3 Paketen oder ein Paket | **Ein Paket, drei tsconfigs.** Gleiche Trennung bei weniger Werkzeugaufwand für eine Person. |
| Autostart | Aufgabenplanung oder WinSW | **WinSW-Dienst.** Die Aufgabenplanung bietet keinen verlässlichen Neustart nach einem Absturz des lang laufenden Prozesses und kein sauberes Stop-Signal. Sie bleibt nur als dokumentierte Notlösung (Kap. 10.4). |
| Suche | FTS5-Trigram oder Präfix-FTS mit bm25 | **Präfix-FTS5 (contentless_delete, prefix '2 3 4') plus gezielte Teilwortsuche in Titel, Tags und Zutaten.** Deterministisches Ranking; Komposita werden gefunden; Trigram (Index ~3-mal größer, erst ab 3 Zeichen) wandert in den Backlog. |
| Sofortfilter im Client | Lokales Filtern der geladenen Liste bis ~500 Rezepte oder nur Server | **Nur Server.** Ein zweiter Suchpfad würde abweichen. 150 ms Debounce, Abbruch veralteter Anfragen und sichtbare alte Treffer genügen im LAN (≤ 300 ms, F-21). |
| „Meintest du“ | Im Client über gecachte Titel oder auf dem Server | **Server.** Eine Wortliste, die mit `data_revision` invalidiert wird; keine Cache-Konsistenzprobleme im Client. |
| Wake Lock im Kochmodus | Stummer Video-Loop als Muss oder nur native API | **Nur native API im sicheren Kontext; der Video-Ersatz ist experimentell und hinter einem Schalter (F-31, Kann).** Der Trick ist dokumentiert fragil. |
| Umfang Kochmodus, Skalierung, Duplizieren | Muss/Soll oder Kann/Backlog | **Kann bzw. Backlog.** Sie liegen außerhalb des genannten Umfangs; die Bedienbarkeit des Kerns (Papierkorb, Entwurf, Textmodus, Chips, Rückgängig) hat Vorrang. |
| Entwurfsspeicher | `sessionStorage` oder `localStorage` | **localStorage.** Nur so übersteht der Entwurf das Schließen des Browser-Tabs. |
| Bildformat und Varianten | 2 Varianten (JPEG + WebP) oder 3 WebP | **3 WebP-Varianten** (Startwerte s 720×540 im Kartenformat, m 1200 px, l 2048 px; endgültig nach M1). WebP ist ~25–35 % kleiner und in allen Zielbrowsern verfügbar; Karten wählen per `srcset` zwischen s und m, das Detail lädt m statt l. |
| Anzahl Bilder | 1 oder bis 10 | **1 in Release 1.0**; mehrere Bilder im Backlog. |
| Upload-Verfahren | multipart/form-data oder roher Body | **Roher Body (`Content-Type: image/jpeg` usw.) per XHR mit Fortschritt.** Kein Multipart-Parser, echtes Streaming in eine Datei, harte Grenze von 20 MiB. |
| Bild vor dem ersten Speichern | Erst speichern, dann hochladen, oder vorab hochladen | **Vorab hochladen** (`POST /images` → nicht zugeordnet, Aufräumen nach 7 Tagen). Foto zuerst, dann tippen, ohne am Ende zu warten. |
| Löschen | Hart mit Dialog oder Papierkorb | **Papierkorb (30 Tage) + Rückgängig-Toast**, ohne Vorab-Dialog; Bestätigung nur beim endgültigen Löschen. |
| IDs | UUIDv7 als TEXT oder INTEGER | **INTEGER.** Kleinere Indizes, direkte FTS-rowid, im LAN keine Geheimhaltung nötig. |
| Linter | ESLint 9 + Prettier oder oxlint + Prettier oder Biome | **Biome** (ein Binary). Svelte-Templates prüft `svelte-check`. |
| QR-Paket | `qrcode` (3 Laufzeit-Abhängigkeiten: dijkstrajs, pngjs, yargs) oder `qrcode-generator` (0) | **qrcode-generator.** |
| Port | 8080 oder 8420 | **8080** (verbreitet, leicht zu merken); konfigurierbar, der Start meldet „Port belegt“ bzw. „Port reserviert“. |
| Hostname in URLs | NetBIOS-Name oder `.local` | **Nur IP und `<Computername>.local`** (plus `PUBLIC_URL`). Android und iOS lösen keine NetBIOS-Namen auf; der QR-Code enthält die IP-URL bzw. `PUBLIC_URL`, falls gesetzt. |
| Inline-Styles und CSP | `style-src-attr 'unsafe-inline'` oder keine `style=`-Attribute | **Keine statischen `style=`-Attribute**; dynamische Werte nur über die Svelte-Direktive `style:` (CSSOM, von der CSP nicht betroffen) und Klassen. Die Unterstützung von `style-src-attr` in Safari ist nicht gesichert. |

### 5.3 Verworfene Alternativen

| Alternative | Zahlen und Fakten | Warum verworfen |
|---|---|---|
| React 19 + ReactDOM | ~42–45 KB gzip Grundlast vor jeder App-Zeile | Initialbudget von 35 KB nicht haltbar |
| Vue 3 | ~34 KB gzip Runtime | Stack des Prototyps v1; um ein Vielfaches größer als die Svelte-Runtime ohne Vorteil |
| Preact | ~4 KB | Klein, aber Formular-Reaktivität und Scoped CSS fehlen; das React-Ökosystem verleitet zu schweren Bibliotheken |
| SolidJS | ~7 KB | Kleineres Ökosystem, kein Scoped CSS |
| SvelteKit | SSR, Adapter, eigene Server-Routen; Major-Umbruch auf v3 | SSR bringt im LAN nichts; zweite Server-Schicht neben der API |
| HTMX/Alpine + serverseitige Templates | ~14 KB + ~15 KB | Editor mit dynamischen Zeilen, Parser und Chips braucht Client-State und würde am Ende schwerer |
| Fastify 5 | ~30–40 transitive Pakete, Plugins für multipart/static | Hono leistet dasselbe ohne Abhängigkeiten |
| Express 5 | Keine eingebauten Typen, schwächere Middleware-Typisierung | Kein Vorteil |
| `node:sqlite` | 0 Abhängigkeiten; enthält FTS5 (in Node 24.14 lokal geprüft: contentless_delete-Tabelle angelegt, SQLite 3.51.2). In der installierten Node 24.14 aber experimentell (ExperimentalWarning), ab 24.15 bzw. 25.7 Stability 1.2 (Release Candidate) | Nicht wegen fehlender Funktionen verworfen, sondern wegen der noch nicht stabilen API. better-sqlite3 13 hat kein Install-Skript mehr, der Nachteil der nativen Abhängigkeit ist daher klein. Neubewertung im Backlog, sobald `node:sqlite` in der eingesetzten Node-LTS stabil ist; `server/db/connection.ts` kapselt den Zugriff |
| Prisma (Prototyp v1) | Query-Engine ~15 MB, Generate-Schritt, FTS nicht abbildbar | Gewicht und Erfahrung aus dem Prototyp v1 |
| Drizzle 0.45 | 1.0 noch Beta | Für ~9 Tabellen und ~40 Queries ist Raw-SQL kürzer und für FTS5 direkter |
| jimp / reines JS | 5–10-mal langsamer als sharp, hoher RAM-Bedarf bei 12 MP | Budget in NF-05 nicht haltbar |
| Pflicht-Verkleinerung im Browser | EXIF-Rotation und HEIC uneinheitlich | Server-Pipeline ist verlässlich; Browser-Vorverkleinerung im Backlog |
| Multipart mit busboy | +1 Abhängigkeit, oder bis 20 MiB RAM-Puffer | Roher Body-Stream ist einfacher und leichter |
| Service Worker / PWA | Über http im LAN nicht verfügbar | Nicht versprochen (NF-26) |
| Docker Desktop | WSL2-VM mit 1–2 GB RAM; Volume-Fehler im Prototyp v1 | Unnötig schwer auf einem Windows-Desktop |
| .NET 9 / Python | Zweite Toolchain neben dem Frontend | Keine geteilten Typen und Schemas |
| NSSM | Letztes stabiles Release 2.24 von 2014 | Ungepflegt |
| pm2 / node-windows | Globaler Zusatzdaemon bzw. ungepflegt | WinSW ist kleiner und Windows-nativ |
| Trigram-FTS als Hauptindex | Index ~3-mal größer, Treffer erst ab 3 Zeichen, bei kurzen Begriffen viel Rauschen | Präfix + Teilwort deckt Komposita gezielt ab |
| Lokale Sofortfilterung | Zweite Suchimplementierung | Abweichungsrisiko ohne messbaren Gewinn im LAN |

### 5.4 Prozessmodell

```
Handy / Tablet / PC im WLAN
   |  http://192.168.178.20:8080   oder   http://kueche-pc.local:8080
   v
+--------------------------------------------------------------------+
| node.exe server/main.ts  (Windows-Dienst "RezepteApp", LocalService)|
|  lauscht dual-stack auf :: (IPv4 + IPv6), Port 8080                |
|                                                                    |
|  Hono-App (server/app.ts)                                          |
|   Middleware: requestId -> Host-Prüfung -> Security-Header ->      |
|               Client-Header/Content-Type -> Profil -> Fehler       |
|   /api/v1/*    JSON-API (zod-validiert), Cache-Control: no-store   |
|   /media/*     WebP-Dateien aus DATA_DIR/images (immutable)        |
|   /assets/*    Vite-Build mit Hash-Namen inkl. Schriften (immutable)|
|   /<datei>     Wurzeldateien aus dist/client (Manifest, Icons,     |
|                Favicon), Cache-Control: no-cache                   |
|   /* ohne Dateiendung  index.html (SPA-Fallback, no-cache, CSP)    |
|   sonst        404                                                 |
|                                                                    |
|  better-sqlite3 (1 Verbindung, synchron, WAL) -> data/rezepte.sqlite|
|  sharp (2 Threads, ohne Cache), Warteschlange max. 2 Jobs          |
|  Wartungs-Timer (stündlich): Backup, Papierkorb, Bild-Aufräumen    |
|  Logger (JSON Lines) -> data/logs/app.log                          |
+--------------------------------------------------------------------+
```

**Startreihenfolge:** Konfiguration parsen (zod) → `DATA_DIR` prüfen (beschreibbar, freier Speicher) → DB öffnen, PRAGMAs setzen, `quick_check` → Migrationen mit Vorab-Backup → FTS-Konsistenz → Bilddateien mit der DB abgleichen (Rückholung aus `images/.trash/`) → sharp laden (bei einem Fehler eingeschränkter Betrieb) → Start-Tags einmalig anlegen → Port binden (bei `EADDRINUSE` bzw. `EACCES` Exit 1 mit Meldung) → URLs ermitteln → URLs und ASCII-QR ausgeben → Wartungs-Timer starten.

**Beenden:** Unter Windows kommen nur SIGINT (Strg+C, von WinSW gesendet) und SIGBREAK an; SIGTERM wird dort nicht zugestellt. Bei SIGINT oder SIGBREAK schreibt der Server „shutdown: <Signal>“ ins Log, nimmt keine Verbindungen mehr an, lässt offene Requests höchstens 5 s laufen, bricht laufende Bildjobs ab und löscht deren temporäre Dateien, führt `PRAGMA wal_checkpoint(TRUNCATE)` aus, schließt die DB und endet mit Exit 0. M6 prüft das real (NF-24). Scheitert die Zustellung von Strg+C, ist Plan B ein nur über `localhost` erreichbarer Shutdown-Endpunkt, den WinSW über `<stopexecutable>` aufruft.

**Nebenläufigkeit:** Alle DB-Zugriffe sind synchron und kurz (< 5 ms). Lang laufen nur die Bildverarbeitung (asynchron im libvips-Threadpool, Warteschlange), das Online-Backup (`db.backup()`, seitenweise asynchron) und der Export (Stream mit Backpressure). Bei 1–3 gleichzeitigen Geräten entsteht kein Engpass.

**Datenrevision:** Nach jeder erfolgreichen schreibenden Anfrage (2xx auf POST/PUT/PATCH/DELETE) erhöht eine Middleware `meta.data_revision`. Jede Antwort trägt die Header `X-Data-Revision` und `X-App-Version` (F-36); `GET /api/v1/revision` liefert nur die Revision für den 60-s-Abgleich.

**Host-Prüfung:** Erlaubt sind jedes IP-Literal, `localhost` und die Hostnamen aus NF-21 (`<Computername>`, `<Computername>.local`, `PUBLIC_URL`, `ALLOWED_HOSTS`). Die Prüfung hängt nicht an den beim Start ermittelten Adressen, darum wirkt ein IP-Wechsel sofort.

**Ablauf: neues Rezept mit Foto**

1. Der Nutzer tippt „Foto aufnehmen“; der Client sendet sofort `POST /api/v1/images` (roher Body, XHR mit Fortschritt, Inaktivitäts-Timeout 30 s).
2. Der Server streamt nach `tmp/`, prüft Magic Bytes und Pixelzahl, reiht den Job ein, erzeugt die drei Varianten atomar und legt `images` mit `recipe_id = NULL` an → 201 `{ imageId, urls }`.
3. Der Nutzer füllt weiter aus; der Entwurf (inkl. `imageId`) wird alle 2 s gesichert.
4. `POST /api/v1/recipes` mit `imageId` und `createKey`. In einer Transaktion entstehen `recipes`, `ingredients`, `steps`, fehlende Tags (Upsert über `name_key`), `recipe_tags`, die Bildzuordnung und die FTS-Zeile; die Revision steigt → 201 mit dem Detail.

**Ablauf: Liste mit Suche** – Der Client sendet `GET /api/v1/recipes?q=…&tags=…&sort=…` mit Debounce 150 ms und `AbortController`. Der Server baut die Abfrage nach Kap. 4.5 (≤ 4 Statements) und antwortet mit `{ items, nextCursor, total, didYouMean? }`.

### 5.5 Projektstruktur

```
recipe-book-v2/
├─ package.json            # ein Paket; packageManager pnpm@10.34.5; engines node 24;
│                          # scripts: dev, build, start, verify, test, e2e, seed, size
├─ pnpm-lock.yaml
├─ .npmrc                  # package-import-method=copy (zusätzlich explizit in den Skripten)
├─ .nvmrc                  # 24
├─ biome.json
├─ tsconfig.base.json      # strict, noUncheckedIndexedAccess, erasableSyntaxOnly, verbatimModuleSyntax
├─ tsconfig.client.json / tsconfig.server.json / tsconfig.shared.json
├─ vite.config.ts          # root: client/, outDir: dist/client, Dev-Proxy /api und /media -> :8080
├─ vitest.config.ts
├─ playwright.config.ts
├─ client/
│  ├─ index.html           # Inline-Theme-Skript (per CSP-Hash erlaubt), Manifest, theme-color, apple-touch-icon
│  ├─ public/              # icons/, manifest.webmanifest, favicon.ico, apple-touch-icon.png (ungehasht, no-cache)
│  └─ src/
│     ├─ main.ts, App.svelte, router.ts
│     ├─ api.ts            # fetch/XHR-Wrapper, Header, Timeouts, AbortController, Fehler-Mapping
│     ├─ state/            # profile.svelte.ts, list.svelte.ts, tags.svelte.ts, toast.svelte.ts, theme.svelte.ts, revision.svelte.ts
│     ├─ lib/              # format.ts (Zahlen, Brüche, Datum), draft.ts, scroll.ts, feature.ts (Secure-Context-Checks), viewport.ts
│     ├─ components/       # AppShell, BottomNav, NavRail, BackButton, RecipeCard, TagChip, ChipRow, TagInput,
│     │                    # StarRating, Heart, ImagePicker, IngredientEditor, StepEditor, Sheet,
│     │                    # Dialog, ConflictDialog, Toast, EmptyState, Skeleton, Banner, Avatar, Icon
│     ├─ routes/           # ProfilePick, RecipeList, RecipeDetail, RecipeEdit (lazy), Favorites,
│     │                    # Tags (lazy), More (lazy), Connect (lazy), Trash (lazy), Status (lazy), CookMode (lazy)
│     ├─ i18n/de.ts
│     ├─ icons/sprite.svg
│     ├─ assets/fonts/     # WOFF2, per @font-face eingebunden -> gehasht unter /assets/
│     └─ styles/           # tokens.css, base.css, fonts.css, print.css
├─ server/
│  ├─ main.ts              # Bootstrap, Start-Checks, Signale, URL-/QR-Ausgabe
│  ├─ app.ts               # Hono-App-Factory (testbar ohne Netzwerk)
│  ├─ config.ts            # Env -> typisierte Konfiguration (zod)
│  ├─ log.ts, errors.ts    # JSON-Lines-Logger, AppError(code, status)
│  ├─ middleware/          # request-id, host-check, security-headers, client-guard, profile, revision, error
│  ├─ routes/              # profiles, recipes, trash, images, tags, ratings, favorites, ops, media, static, spa
│  ├─ services/            # recipes, tags, search, suggest, images (Pipeline + Queue), backup,
│  │                       # export-zip, maintenance, net-info, fts
│  └─ db/                  # connection.ts, migrate.ts, repos/*.ts, migrations/001_init.sql
├─ shared/
│  ├─ schemas.ts           # zod/mini: ProfileInput, RecipeInput, TagInput, RatingInput, ExportV1
│  ├─ types.ts             # DTOs (RecipeCard, RecipeDetail, …), aus Schemas abgeleitet
│  ├─ normalize.ts         # normalize(), queryVariants()
│  ├─ ingredient-parser.ts, units.ts, scale.ts, plural.ts
│  └─ constants.ts         # Limits (Titel 120, Tags 20, Upload 20 MiB, Bildvarianten, …)
├─ tests/
│  ├─ unit/  api/  e2e/  fixtures/   # Bilder, ingredient-lines.json, Umlaut-Listen
│  └─ seed.ts              # 1.000 deutsche Testrezepte
├─ scripts/size-check.ts
├─ deploy/
│  ├─ install.ps1, uninstall.ps1, update.ps1
│  └─ RezepteApp.xml.template
└─ docs/
   ├─ BETRIEB.md, VERBINDEN.md
   ├─ ADR/0001-stack.md …
   └─ design/README.md     # Link zum freigegebenen Design-Canvas, Token-Blatt
```

Laufzeitordner auf dem Windows-PC:

```
C:\RezepteApp\
├─ app\        git clone, node_modules, dist\client
├─ service\    RezepteApp.exe (WinSW-NET461, umbenannt), RezepteApp.xml
└─ data\       rezepte.sqlite (+ -wal, -shm), images\ (inkl. .trash\), backups\, logs\, tmp\
```

Konfiguration über Umgebungsvariablen in der WinSW-XML: `PORT` (8080), `HOST` (leer = dual-stack auf `::`; `0.0.0.0` nur IPv4), `DATA_DIR`, `PUBLIC_URL` (optional), `ALLOWED_HOSTS` (Standard `<Computername>.fritz.box`), `BACKUP_KEEP` (14), `TRASH_DAYS` (30), `MAX_UPLOAD_MB` (20, gemeint sind MiB), `LOG_LEVEL` (info).

### 5.6 Konventionen

- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (keine `enum`s, `namespace`s oder Parameter-Properties, weil Node-Type-Stripping sie nicht kann); relative Imports mit Endung `.ts` (`allowImportingTsExtensions`); kein `any` (Biome `noExplicitAny: error`); kein `console.log` außerhalb von `log.ts`.
- **Grenzen werden geparst, nicht gecastet:** HTTP-Body, Query, Env und Exportdatei laufen durch zod-Schemas aus `shared/schemas.ts`.
- **SQL** nur in `server/db/repos/`; jede Schreiboperation mit mehreren Tabellen läuft in `db.transaction()`; FTS-Pflege gehört in dieselbe Transaktion.
- **Fehler:** Services werfen nur `AppError(code, status, message, details?)`; die Fehler-Middleware antwortet einheitlich (Kap. 7.1); der Client ordnet `code` einem Text aus `de.ts` zu.
- **UI:** Texte nur in `de.ts` (Du-Form); Farben nur über Tokens; Icons nur aus dem Sprite; keine statischen `style=`-Attribute (nur `style:`-Direktive und Klassen); jede Liste mit Leer-, Lade- und Fehlerzustand.
- **UI-first:** Eine neue DB-Spalte braucht im selben PR ihre Oberfläche oder eine dokumentierte technische Begründung.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`); `pnpm verify` muss vor jedem Commit grün sein (optional per `simple-git-hooks`).
- **ADRs:** Jede Stack-Entscheidung und jede neue Laufzeit-Abhängigkeit bekommt einen kurzen Eintrag in `docs/ADR/`.

### 5.7 Geprüfte Quellen (Stand September 2026)

- Chrome „HTTPS by default“ (Chrome 154, private Adressen ausgenommen): https://www.heise.de/en/news/Chrome-to-warn-about-HTTP-connections-by-default-from-2026-10962985.html
- iOS: Home-Bildschirm-Apps teilen den Speicher nicht mit Safari: https://bugs.webkit.org/show_bug.cgi?id=181849
- iOS-HEIC-Konvertierung bei Datei-Upload: https://shkspr.mobi/blog/2020/12/coping-with-heic-in-the-browser/
- Vite 8.3: https://vite.dev/releases · Vitest 5.0: https://vitest.dev/blog/vitest-5.html
- Node.js 24 LTS: https://endoflife.date/nodejs · `node:sqlite` (Stability 1.2 ab 24.15/25.7): https://nodejs.org/api/sqlite.html; FTS5 in Node 24.14 lokal geprüft
- better-sqlite3 13 (SQLite 3.53.4, kein Install-Skript in 13.0.3 laut npm-Registry): https://github.com/WiseLibs/better-sqlite3/releases
- SQLite FTS5 (contentless_delete, delete-all, rebuild): https://sqlite.org/fts5.html
- sharp 0.35 (kein Install-Skript in 0.35.4 laut npm-Registry): https://newreleases.io/project/github/lovell/sharp/release/v0.35.0
- pnpm (letzte 10er-Version 10.34.5, aktuell 12.x laut npm-Registry): https://www.npmjs.com/package/pnpm
- TypeScript 7 und svelte-check: https://github.com/sveltejs/language-tools/releases
- CSP `style-src-attr`, Browserunterstützung: https://caniuse.com/mdn-http_headers_csp_content-security-policy_style-src-attr
- Chrome DevTools Drosselung (eigene Profile): https://developer.chrome.com/docs/devtools/settings/throttling
- qrcode-generator: https://www.npmjs.com/package/qrcode-generator · Zod Mini: https://zod.dev/packages/mini
- WinSW 2.12.0: https://github.com/winsw/winsw/releases/tag/v2.12.0

---

## 6. UI-Konzept

### 6.1 Grundsätze

- **Daumen zuerst:** Navigation, FAB und Speichern liegen am Handy unten; es gibt keine Primäraktion oben rechts (oben rechts sitzt nur der Avatar für den Profilwechsel, oben links die Zurück-Schaltfläche in Unteransichten).
- **Kurze Wege:** Liste → Rezept 1 Fingertipp; Tag-Filter 1 Fingertipp je Tag; Profilwechsel 2 Fingertipps; Favorit und Bewertung je 1 Fingertipp.
- **Rückgängig statt Nachfragen** (F-35); Dialoge nur bei endgültigen Aktionen und beim Verwerfen von Eingaben; keine Modals über Modals; Bottom-Sheets für Filter, Profilwahl und Menüs.
- **Sofortiges Feedback:** optimistische Updates für Herz und Sterne, Skeletons statt Spinner, Button-Sperre während des Speicherns.
- **Küchentauglich:** Tippflächen ≥ 48 px für Küchenaktionen, keine Hover- oder Long-Press-Pflicht, große Schrift in den Zubereitungsschritten.
- **Ohne Browserleiste bedienbar:** Zurück-Schaltfläche in jeder Unteransicht, Aktualisieren in der Liste (F-34).
- **Deutsch, Du-Form:** UI-Texte duzen durchgängig („Tippe bei einem Rezept auf das Herz“, „Meintest du: Spätzle?“); Beschriftungen knapp wie „Rezept speichern“, „Foto aufnehmen“, „Filter zurücksetzen“ (NF-10).

### 6.2 Navigation und Routen

| Route | Ansicht | Laden |
|---|---|---|
| `/` | Weiterleitung auf `/rezepte`, ohne gemerktes Profil auf `/profil` | – |
| `/profil` | Profilwahl | initial |
| `/rezepte` | Rezeptliste (Query: `q`, `tags`, `tagMode`, `fav`, `minRating`, `sort`) | initial |
| `/rezepte/:id` | Rezeptdetail (am Tablet quer: Detailspalte neben der Liste); im Papierkorb: Hinweis mit „Wiederherstellen“ | initial |
| `/rezepte/neu`, `/rezepte/:id/bearbeiten` | Editor | lazy |
| `/rezepte/:id/kochen` | Kochmodus (Kann) | lazy |
| `/favoriten` | Favoriten-Ansicht (Liste mit festem Filter) | initial |
| `/tags` | Tag-Verwaltung | lazy |
| `/mehr`, `/mehr/verbinden`, `/mehr/papierkorb`, `/mehr/status` | Mehr: Profil, Darstellung, Verbinden, Papierkorb, Daten, Status, Über | lazy |

Die untere Navigation (Handy und Tablet hochkant) hat 4 Ziele: **Rezepte · Favoriten · Tags · Mehr**. Der FAB „Neues Rezept“ (Plus-Icon aus dem Sprite, `aria-label`) sitzt in den Ansichten Rezepte und Favoriten unten rechts über der Navigation. Der Avatar oben rechts öffnet das Profil-Sheet. Am Tablet quer und am Desktop enthält eine Navigationsleiste links dieselben Ziele sowie „Neues Rezept“ und den Avatar. Aktive Navigationspunkte zeigen Icon und Indikator in Primärfarbe und das Label fett in `--color-text`.

### 6.3 Screens

**Profilwahl** – Überschrift „Wer kocht?“; Kacheln (≥ 96 px) mit Avatarfarbe, Initiale(n) und Name; letzte Kachel „Neues Profil“ (Name, Farbe aus 6 Avatar-Tokens). Ohne Profile steht direkt das Namensfeld mit Fokus da. Hinweiszeile: „Profile trennen nur Bewertungen und Favoriten – kein Passwort.“

**Rezeptliste** – Kopfzeile mit Titel, Aktualisieren-Schaltfläche und Avatar. Darunter ein fixiertes Suchfeld (`type="search"`, `enterkeyhint="search"`, Platzhalter „Rezepte, Zutaten, Tags suchen“, Löschen-Icon). Unter dem Suchfeld die horizontal scrollbare Chip-Reihe: aktive Tags zuerst, mit Häkchen; dann die meistgenutzten; zuletzt „Alle Tags …“. Rechts neben dem Suchfeld das Filtersymbol mit Zähler. Darunter „38 Rezepte“ und die Karten. Karte: Bild im Kartenformat aus dem Design (Variante s bzw. m per `srcset`, fester Platz, sonst das Platzhalterbild: Teller mit Besteck und Anfangsbuchstabe, Farbe aus der Rezept-ID, siehe F-16), Titel (max. 2 Zeilen), Gesamtzeit, bis zu 3 Tag-Chips (+n), Ø-Sterne mit Anzahl und das Herz (48 px) auf einer runden Fläche über dem Bild (Kap. 6.7). Die nächste Seite lädt beim Scrollen (IntersectionObserver, 40 je Seite).

**Filter-Sheet** – Tags mit Suche und Anzahl (Mehrfachauswahl); Segment „alle müssen passen / einer reicht“; Schalter „Nur Favoriten“; „Mindestbewertung“ (1–5, F-43); Sortierung als Radiogruppe. Änderungen wirken sofort (kein „Anwenden“), die Trefferzahl steht im Sheet-Kopf; darunter „Filter zurücksetzen“.

**Rezeptdetail** – Zurück-Schaltfläche oben links (am Handy); Bild m (Antippen → Vollbild l), Titel, Meta-Zeile (Zeiten, Portionen), Tag-Chips; Bewertungszeile mit 5 eigenen Sternen (je 48 px), „Deine Bewertung (Anna): 4“, „Bewertung entfernen“ und „Ø 4,3 (3)“, aufklappbar mit den Einzelbewertungen; daneben das Herz. Zutaten nach Gruppen mit Abhaken (F-30), Zubereitungsschritte nummeriert mit großer Schrift, Beschreibung, Quelle, Fußzeile „angelegt von … am …, geändert von … am …“. Am Handy eine fixierte untere Leiste mit „Bearbeiten“ und, falls umgesetzt, „Kochmodus“. Das Mehr-Menü (Mehr-Icon aus dem Sprite) enthält Link kopieren (Kann), Drucken (Kann) und „In den Papierkorb“.

**Editor** – Zurück-/Abbrechen oben links. Ein durchgehendes Formular ohne Assistenten-Schritte. Reihenfolge: Foto („Foto aufnehmen“ und „Bild auswählen“, Vorschau mit Fortschrittsbalken und Entfernen) · Titel (Fokus bei „Neu“; darunter ggf. der Hinweis auf ähnliche Rezepte, F-45) · Tags (Chip-Eingabe mit Autovervollständigung, häufige Tags als antippbare Chips darunter) · Zutaten (Umschalter Zeilen/Text; Zeilen mit Menge `inputmode="decimal"`, Einheit mit Vorschlagsliste, Name, Notiz, Ziehgriff und Auf/Ab-Schaltflächen; unter 400 px Breite zweizeilig, Auf/Ab ggf. in einem Zeilenmenü, Layout aus dem M1-Artboard; Gruppe hinzufügen) · Zubereitung (Umschalter Schritte/Text) · eingeklappt „Weitere Angaben“ (Portionen und Einheit, Vorbereitungszeit, Koch-/Backzeit, Quelle, Beschreibung). Unten fixiert: „Abbrechen“ und „Speichern“; bei offener Bildschirmtastatur passt sich die Leiste über `visualViewport` an und verdeckt kein Feld (NF-07). Validierung inline; beim Speichern springt die Ansicht zum ersten Fehler. Am Tablet zweispaltig: links Foto, Titel, Tags und weitere Angaben, rechts Zutaten und Zubereitung.

**Konfliktdialog** – „Inzwischen von Anna geändert“; „Neu laden“ zeigt die Serverfassung mit markierten eigenen Änderungen und „Meine Änderung übernehmen“ je Feld; „Meine Version speichern“ überschreibt (F-07).

**Favoriten** – Wie die Liste, mit festem Filter; Suche und Chips bleiben nutzbar; eigener Leerzustand.

**Tags** – Suchfeld, Liste mit Anzahl, ungenutzte Tags am Ende. Je Zeile ein Menü: Umbenennen (inline), „Zusammenführen mit …“, Löschen. „Neuer Tag“ oben.

**Mehr** – Profil (wechseln, bearbeiten, löschen); Darstellung (System/Hell/Dunkel); „Anderes Gerät verbinden“ (URLs, QR-Code, Anleitungen für Android, iOS und die Verknüpfung auf dem Startbildschirm, Hinweis zur Browser-Kennzeichnung „Nicht sicher“); Papierkorb; Daten (Backup jetzt, Export herunterladen); Status (F-42); Über (Version, Lizenzen). Alle Unterseiten mit Zurück-Schaltfläche.

**Kochmodus (Kann)** – Vollbild, ein Zubereitungsschritt je Ansicht, „Schritt 3 von 8“, „Weiter“ über die gesamte Breite der unteren Hälfte, „Zurück“ kleiner; Wischen und Pfeiltasten; „Zutaten“ öffnet ein Sheet; Status-Hinweis zum Wach-Halten.

### 6.4 Interaktionen je Gerät

| Aspekt | Handy (< 600 px) | Tablet hochkant (600–1023 px) | Tablet quer / Desktop (≥ 1024 px) |
|---|---|---|---|
| Navigation | Untere Leiste, FAB | Untere Leiste, FAB | Navigationsleiste links, „Neues Rezept“ in der Leiste |
| Liste | 1 Spalte, große Karten | 2-spaltiges Kartenraster | Liste 360–400 px links, kompakte Karten |
| Detail | Eigene Seite, Zutaten über Schritten | Eigene Seite, Zutaten (sticky) neben Schritten | Rechte Spalte neben der Liste; Zutaten über Schritten, ab 1280 px nebeneinander |
| Editor | Eine Spalte, fixierte Speichern-Leiste | Zwei Spalten | Zwei Spalten |
| Filter | Bottom-Sheet | Bottom-Sheet | Seitliches Panel/Popover, wirkt sofort |
| Gesten | Wischen im Kochmodus, Sheet nach unten ziehen; immer mit Schaltflächen-Alternative | wie Handy | Tastatur: `/` fokussiert die Suche, Escape schließt, Pfeiltasten für Sterne und Kochmodus |
| Drehen | Zustand bleibt | Zustand bleibt, Layout wechselt | – |

### 6.5 Dark Mode

- Standard ist das Systemschema; „Mehr → Darstellung“ überschreibt es je Gerät (`localStorage`).
- Ein kleines Inline-Skript im `<head>` setzt `data-theme` vor dem ersten Paint (kein heller Blitz); die CSP erlaubt es über seinen SHA-256-Hash, den der Server beim Start aus `index.html` berechnet.
- Alle Farben kommen aus den Tokens; die Dunkel-Werte stehen in Kap. 6.7. Fotos werden nicht verändert; Platzhalter und Skeletons haben eigene Dunkel-Töne.

### 6.6 Leer-, Lade- und Fehlerzustände

| Situation | Darstellung | Handlung |
|---|---|---|
| Keine Rezepte | Illustration (Inline-SVG, `currentColor`/Tokens), „Noch keine Rezepte“ | „Erstes Rezept anlegen“ |
| Suche ohne Treffer | „Nichts gefunden für ‚Spazle‘“ + ggf. „Meintest du: Spätzle?“ | „Filter zurücksetzen“, „Rezept ‚Spazle‘ anlegen“ |
| Keine Favoriten | „Noch keine Favoriten – tippe bei einem Rezept auf das Herz“ | Link zur Liste |
| Tag ohne Rezepte | Anzahl 0, am Ende der Liste | Löschen, Umbenennen |
| Papierkorb leer | „Der Papierkorb ist leer“ | – |
| Rezept im Papierkorb (Deep-Link, Speichern) | „Im Papierkorb (gelöscht von Anna am …)“ bzw. im Editor „Von Anna in den Papierkorb gelegt – wiederherstellen und speichern?“ | „Wiederherstellen“ |
| Erstes Laden | Skeleton-Karten mit fester Höhe | – |
| Server nicht erreichbar | Banner oben: „Server nicht erreichbar – läuft der Rezepte-PC?“; letzte Liste bleibt sichtbar | „Erneut versuchen“; automatisch nach `online` |
| Zeitüberschreitung (10 s) | Toast „Das dauert zu lange“ | „Erneut versuchen“ |
| Schreibfehler | Toast mit deutscher Meldung, optimistischer Zustand wird zurückgenommen | „Erneut versuchen“ |
| Versionskonflikt | Konfliktdialog „Inzwischen von Anna geändert“ | „Neu laden“ (mit Übernahme eigener Änderungen) / „Meine Version speichern“ |
| Upload fehlgeschlagen | Hinweis am Bild; Speichern bleibt möglich | „Erneut hochladen“ |
| Entwurfsbild abgelaufen | „Foto nicht mehr vorhanden – bitte erneut aufnehmen“ | „Foto aufnehmen“ |
| Bildverarbeitung nicht verfügbar | Hinweis im Editor und unter Status | – |
| DB im Nur-Lese-Modus | Banner „Datenbank beschädigt – nur Lesen möglich“ | Verweis auf `docs/BETRIEB.md` (Wiederherstellung) |
| Neue App-Version | Banner „Neue Version verfügbar“ | „Neu laden“ |
| Nicht unterstützter Browser | Statische Hinweisseite | – |

### 6.7 Visuelles Design und Farbpalette

Die Palette ist verbindlich (Quelle: coolors.co/231f20-bb4430-7ebdc2-f3dfa2-efe6dd). Die Kontrastwerte der Vorgabe gelten als gemessen; als „nachgerechnet“ markierte Werte wurden für diese Planung berechnet (oklch-Ableitungen und WCAG-Formel) und werden im Kontrasttest (NF-13) bestätigt.

**Palette und Rollen**

| Name | Hex | Token / Rolle | Einsatzregel | Kontrast |
|---|---|---|---|---|
| Linen | #EFE6DD | `--color-bg` (hell); Textfarbe im Dark Mode | Seitenhintergrund | Raisin Black auf Linen 13,22:1 |
| Raisin Black | #231F20 | `--color-text` (hell); Hintergrund im Dark Mode | Fließtext, Icons, Fokusring (hell) | 13,22:1 auf Linen |
| Terracotta | #BB4430 | `--color-primary` | Primäraktionen (Schaltflächen, FAB), Favoriten-Herz, aktive Zustände (Icons, Indikatoren, aktive Chip-Fläche) | Auf Linen 4,28:1: für normalen Text **nicht** AA, nur für großen Text (≥ 24 px bzw. ≥ 18,66 px fett), Icons und UI-Grenzen (≥ 3:1). Weiß auf Terracotta 5,27:1 (AA) |
| Moonstone | #7EBDC2 | `--color-secondary` | Tag-Chips, sekundäre Flächen, Info-Hinweise – **nur als Fläche mit dunklem Text, in beiden Modi** | Raisin Black auf Moonstone 7,72:1; Moonstone als Text auf Linen 1,71:1 → verboten |
| Vanilla | #F3DFA2 | `--color-highlight` | Sterne (Füllung), Hervorhebungen, Hover-Flächen, Favoriten-Badge, Markierung unsicherer Parser-Zeilen – **nur als Fläche mit dunklem Text** | Raisin Black auf Vanilla 12,33:1 |

Folgerungen aus nachgerechneten Werten:

- **Neutrales Weiß:** `--color-on-primary` hell = #FFFFFF (oklch(1 0 0)), eine bewusste Ergänzung der Palette, weil Linen auf Terracotta nur ≈ 4,28:1 erreicht.
- **Weiß auf #D9634F ≈ 3,59:1:** Im Dark Mode tragen Primär-Schaltflächen Raisin Black (4,54:1, ohne Spielraum; der Wert ist durch die Nutzervorgabe fixiert).
- **Primär- und Fehlertext in normaler Größe** nutzt ein eigenes Token `--color-primary-text` (auch für `--color-danger-text`): hell z. B. #A33A29 (5,33:1 auf Linen, 5,68:1 auf der hellen Surface, nachgerechnet); dunkel z. B. #F57C67 (Terracotta per oklch um +0,08 L gegenüber #D9634F aufgehellt: 6,18:1 auf #231F20, 5,30:1 auf `--color-surface`, 4,72:1 auf `--color-surface-raised`, nachgerechnet). #D9634F selbst erreicht auf der dunklen Surface nur ≈ 3,89:1 und ist deshalb im Dark Mode nie Textfarbe auf Flächen. Die endgültigen Werte berechnet M1 per oklch mit dem Ziel ≥ 4,5:1 auf allen Flächen.
- **Sterne:** Vanilla auf Linen ≈ 1,07:1. Ein gefüllter Stern hat Vanilla-Füllung und eine 2-px-Kontur in `--color-text`; ein leerer Stern hat nur eine dünnere Kontur (1,5 px) in `--color-border-strong` (≥ 3:1). Daneben steht der Zustand als Text („Deine Bewertung: 4“). Im Dark Mode gilt dasselbe mit den dunklen Tokens.
- **Moonstone- und Vanilla-Flächen auf Linen** (Chips, Badges, Hover, Parser-Markierung) sind durch ihren Text oder ein Symbol erkennbar; wo die Fläche die einzige Begrenzung ist (Hover-Fläche, Parser-Zeile), trägt sie einen Rahmen in `--color-border-strong`. Die Parser-Markierung hat zusätzlich ein Hinweis-Symbol.
- **Terracotta auf Moonstone ≈ 2,50:1:** Icons auf Moonstone-Flächen sind immer Raisin Black.
- **Icons auf Fotos** (Herz auf der Karte) liegen auf einer runden Fläche (≥ 44 px) in `--color-surface` mit 90 % Deckkraft; das Herz hat zusätzlich eine Kontur. Terracotta auf der hellen Surface ≈ 4,56:1, #D9634F auf der dunklen Surface ≈ 3,89:1 (beide ≥ 3:1, nachgerechnet).
- **Aktive Zustände:** aktive Navigationspunkte = Icon und Indikator in `--color-primary`, Label fett in `--color-text`; aktive Filter-Chips = Fläche `--color-primary`, Schrift `--color-on-primary` und Häkchen-Icon; inaktive Tag-Chips = Moonstone-Fläche mit Raisin-Black-Schrift.

**Dark-Mode-Zuordnung**

| Token | Hell | Dunkel | Hinweis |
|---|---|---|---|
| `--color-bg` | #EFE6DD | #231F20 | – |
| `--color-text` | #231F20 | #EFE6DD | 13,22:1 in beiden Modi; auf dunkler Surface 11,33:1 (nachgerechnet) |
| `--color-primary` | #BB4430 | #D9634F (aufgehelltes Terracotta) | #BB4430 auf #231F20 wären nur 3,09:1; #D9634F erreicht 4,54:1. Flächen, Icons, großer Text |
| `--color-primary-text` / `--color-danger-text` | z. B. #A33A29 | z. B. #F57C67 | Text in normaler Größe; ≥ 4,5:1 auf bg, surface und surface-raised; Fehlertext immer mit Symbol |
| `--color-on-primary` | #FFFFFF (5,27:1) | #231F20 (4,54:1) | Schrift auf Primärflächen |
| `--color-secondary` | #7EBDC2, Text #231F20 (7,72:1) | #7EBDC2, Text #231F20 (7,72:1) | Keine Abweichung; eine andere Chip-Fläche im Dark Mode ist eine offene Frage (A19) |
| `--color-highlight` | #F3DFA2, Text #231F20 (12,33:1) | #F3DFA2, Text #231F20 (12,33:1) | Sterne siehe Folgerungen |
| `--color-surface` | Linen, per oklch um +0,02 L (z. B. #F6EDE4) | Raisin Black, per oklch um +0,05 L (z. B. #2F2B2C) | Karten |
| `--color-surface-raised` | wie surface oder heller | Raisin Black, +0,08 L (z. B. #373334) | Sheets, Dialoge, Toasts |
| `--color-border` / `--color-border-strong` | aus Raisin Black abgeleitet; strong z. B. #827D7E (3,29:1 auf Linen) | aus Linen abgeleitet; strong z. B. #90877F (4,62:1 auf #231F20, 3,53:1 auf surface-raised) | Eingabefeld-Rahmen, leere Sterne, Flächenrahmen (`strong` ≥ 3:1) |
| `--color-focus` | #231F20, 2 px + 2 px Abstand | #EFE6DD | Sichtbarer Fokus |

**Avatarfarben** (Vorschlag, endgültig im Token-Blatt aus M1; Initiale ≥ 4,5:1 in beiden Modi, NF-13):

| Token | Fläche hell / Initiale | Fläche dunkel / Initiale | Kontrast (nachgerechnet) |
|---|---|---|---|
| `--avatar-1` | #BB4430 / #FFFFFF | #D9634F / #231F20 | 5,27 / 4,54 |
| `--avatar-2` | #7EBDC2 / #231F20 | gleich | 7,72 |
| `--avatar-3` | #F3DFA2 / #231F20 | gleich | 12,33 |
| `--avatar-4` | #231F20 / #EFE6DD | #EFE6DD / #231F20 | 13,22 |
| `--avatar-5` | #A33A29 / #FFFFFF | gleich | 6,57 |
| `--avatar-6` | #216267 (Moonstone, −0,30 L) / #FFFFFF | gleich | 6,98 |

**Regeln für Tokens:** Die Basis-Tokens heißen `--color-bg`, `--color-text`, `--color-primary`, `--color-secondary` und `--color-highlight`. Ableitungen (hover, pressed, disabled, surface, border, primary-text, avatar) werden im Design-Schritt per oklch berechnet (L ± Δ, Chroma und Farbton bleiben) und als feste Werte mit der Formel als Kommentar hinterlegt; die Browser berechnen zur Laufzeit keine relativen Farben. Der Kontrasttest erzeugt die Paarliste aus `tokens.css` (NF-13).

**Zustände:** Farbe ist nie der einzige Träger. Aktive Filter-Chips haben Häkchen und Primärfläche, das Favoriten-Herz ist gefüllt statt umrandet, eigene Sterne sind gefüllt und als Text genannt, Fehler zeigen ein Symbol und Text.

**Typografie:**

- Die Schriftwahl fällt im Design-Schritt (M1) und steht nicht in den Anforderungen fest. Vorgaben: höchstens 2 Familien, selbst gehostet als WOFF2 (per `@font-face` aus `client/src/assets/fonts/`), kein CDN (das LAN kann ohne Internet sein), `font-display: swap`, Budget ≤ 100 KB gesamt, erste Ansicht ≤ 2 Dateien mit ≤ 60 KB, höchstens 1 Datei per `preload`. Ein Systemschrift-Stack ist als Rückfall und als zulässige Wahl (0 KB) erlaubt.
- Das Subset umfasst Latin inklusive äöüß, Anführungszeichen, Gedankenstriche, €, Bruchzeichen (½ ¼ ¾ ⅓ ⅔, U+00BC–00BE, U+2150–215E) und das Minuszeichen.
- Fließtext ≥ 16 px am Handy, Eingabefelder ≥ 16 px, Zubereitungsschritte ≥ 18 px am Handy, Zeilenhöhe ≥ 1,4 (Fließtext 1,5), Zeilenlänge ≤ 70 Zeichen am Tablet; Größen in rem.

**Icons:** Ein einheitliches, strichbasiertes SVG-Set (Vorschlag: Lucide, ISC-Lizenz; die endgültige Wahl fällt in M1) mit einheitlicher Strichstärke, Größen 20 und 24 px, `currentColor`, als Inline-Sprite ohne Laufzeit-Abhängigkeit. Keine Emojis und keine Textzeichen („⋯“, „+“) als Icons. Icon-Schaltflächen haben ein `aria-label`.

**Tippflächen:** ≥ 44×44 px für alles; ≥ 48×48 px für Herz, Sterne, FAB, Speichern, Checklisten-Zeilen und die Kochmodus-Steuerung; ≥ 8 px Abstand zwischen benachbarten Zielen.

**App-Icon und Favicon:** Icons 192/512 px (maskable mit Safe-Zone), `apple-touch-icon` 180 px, Favicon und `theme-color` je Farbschema entstehen in M1 als eigenes Artboard.

**Vorgehen:** Das Design entsteht in M1 mit dem design-Skill von Claude Code, bevor UI-Code geschrieben wird (Kap. 8). Die freigegebenen Artboards sind die verbindliche Vorlage (NF-16).

---

## 7. API

### 7.1 Konventionen

- Basis `/api/v1`, JSON in UTF-8, Zeiten in ISO 8601 UTC. Antworten sind immer Objekte, nie nackte Arrays.
- **Request-Header:** `X-Rezepte-Client: 1` bei allen schreibenden Anfragen (Schutz gegen Cross-Site-Anfragen, NF-21); `X-Profile-Id: <id>` bei allen schreibenden Anfragen außer `POST /profiles`, `PATCH /profiles/:id` und `DELETE /profiles/:id` (Profilverwaltung ist ohne aktives Profil möglich, z. B. in der Profilwahl); bei lesenden Anfragen optional (für `myRating`, `isFavorite`), Pflicht bei `fav=1` und `sort=myRating`. Ein vorhandener, aber unbekannter `X-Profile-Id` ergibt immer 401 `PROFILE_UNKNOWN`.
- **Response-Header:** `X-Request-Id`, `X-Data-Revision`, `X-App-Version`; `Cache-Control: no-store` für die API.
- **Fehlerformat:** `{ "error": { "code": "VALIDATION", "message": "Titel darf nicht leer sein", "details": [{ "field": "title", "message": "…" }], "requestId": "…" } }`.
- **Limits:** JSON-Body ≤ 1 MB; Upload ≤ 20 MiB (20.971.520 Bytes) und ≤ 60 MP; `limit` ≤ 100 (Standard 40).

### 7.2 Fehlercodes

| Code | HTTP | Bedeutung |
|---|---|---|
| `VALIDATION` | 400 | Schemaverletzung, mit `details[].field` (auch unbekannte oder vergebene `imageId`) |
| `BAD_REQUEST` | 400 | Client-Header fehlt, falscher Content-Type |
| `PROFILE_REQUIRED` | 401 | `X-Profile-Id` fehlt, wird aber benötigt |
| `PROFILE_UNKNOWN` | 401 | Profil existiert nicht (mehr) |
| `NOT_FOUND` | 404 | Ressource existiert nicht |
| `IN_TRASH` | 410 | Rezept liegt im Papierkorb; `details` = `{ deletedAt, deletedBy: { id, name } \| null }` |
| `VERSION_CONFLICT` | 409 | Veraltete Version; `details.current` enthält den aktuellen Stand |
| `NAME_EXISTS` | 409 | Profilname existiert (normalisiert) |
| `TAG_EXISTS` | 409 | Zielname beim Umbenennen existiert; `details` = `{ targetId, targetName, affectedRecipes }` |
| `LAST_PROFILE` | 409 | Das letzte Profil kann nicht gelöscht werden |
| `NOT_IN_TRASH` | 409 | Endgültiges Löschen nur aus dem Papierkorb |
| `PAYLOAD_TOO_LARGE` | 413 | Body bzw. Upload zu groß oder Bild mit mehr als 60 MP |
| `UNSUPPORTED_MEDIA` | 415 | Kein JPEG/PNG/WebP; `details.reason = "heic"` bei HEIC/HEIF |
| `MISDIRECTED` | 421 | Unerlaubter Host-Header (für `Accept: text/html` als deutsche HTML-Seite) |
| `IMAGES_UNAVAILABLE` | 503 | sharp nicht geladen |
| `READ_ONLY` | 503 | DB beschädigt, nur Lesen |
| `INSUFFICIENT_STORAGE` | 507 | Freier Speicher < 200 MB |
| `INTERNAL` | 500 | Unerwarteter Fehler (Details nur im Log) |

### 7.3 Profile

| Methode | Pfad | Payload | Antwort | Fehler |
|---|---|---|---|---|
| GET | `/profiles` | – | `{ profiles: [{ id, name, avatar, initials, ratingCount, favoriteCount }] }` | – |
| POST | `/profiles` | `{ name, avatar? }` | 201 `{ profile }` | 400, 409 `NAME_EXISTS` |
| PATCH | `/profiles/:id` | `{ name?, avatar? }` | 200 `{ profile }` | 400, 401 (unbekannter Header), 404, 409 `NAME_EXISTS` |
| DELETE | `/profiles/:id` | – | 204; Bewertungen und Favoriten gelöscht, `created_by`/`updated_by`/`deleted_by` → NULL | 401 (unbekannter Header), 404, 409 `LAST_PROFILE` |

### 7.4 Rezepte und Papierkorb

| Methode | Pfad | Payload / Query | Antwort | Fehler |
|---|---|---|---|---|
| GET | `/recipes` | `q`, `tags` (IDs, kommagetrennt), `tagMode` (`all` oder `any`), `fav=1`, `minRating` (1–5), `sort` (`relevance`, `newest`, `updated`, `title`, `rating`, `myRating`), `cursor`, `limit` | `{ items: RecipeCard[], nextCursor, total, didYouMean? }` | 400, 401 (`fav=1`/`myRating` ohne Profil, unbekanntes Profil) |
| GET | `/recipes/similar` | `title` | `{ items: [{ id, title, createdBy: { id, name } \| null }] }` (max. 3, nur aktive Rezepte) | 400 |
| GET | `/recipes/:id` | – | `{ recipe: RecipeDetail }` | 404, 410 `IN_TRASH` |
| POST | `/recipes` | `RecipeInput` + `createKey` | 201 `{ recipe }`; bei gleichem `createKey` 200 mit demselben Rezept | 400, 401 |
| PUT | `/recipes/:id` | `RecipeInput` + `version`; `?force=1` überschreibt | 200 `{ recipe }` | 400, 401, 404, 409 `VERSION_CONFLICT`, 410 `IN_TRASH` |
| DELETE | `/recipes/:id` | – | 204 (in den Papierkorb, `deleted_by` = Header-Profil) | 401, 404, 410 `IN_TRASH` |
| GET | `/trash` | – | `{ items: [{ id, title, deletedAt, deletedBy, purgeAt }] }` | – |
| POST | `/recipes/:id/restore` | – | 200 `{ recipe }` | 401, 404 |
| DELETE | `/trash/:id` | – | 204, endgültig; Bilddateien nach `images/.trash/` | 401, 404, 409 `NOT_IN_TRASH` |

`RecipeInput` (zod/mini, geteilt):

```json
{
  "title": "Käsespätzle",
  "description": "Schwäbischer Klassiker",
  "servings": 4, "servingsUnit": "Portionen",
  "prepMinutes": 20, "cookMinutes": 25,
  "source": "",
  "ingredients": [
    { "group": "", "amount": 400, "amountMax": null, "unit": "g", "name": "Mehl", "note": "" },
    { "group": "", "amount": null, "amountMax": null, "unit": "", "name": "Salz", "note": "" }
  ],
  "steps": [{ "text": "Mehl, Eier und Wasser zu einem zähen Teig schlagen." }],
  "tags": ["Vegetarisch", "Schwäbisch"],
  "imageId": 17,
  "createKey": "5f0c7e1a-…",
  "version": 3
}
```

Regeln: `createKey` nur bei POST, `version` nur bei PUT. Tags kommen als Namen; unbekannte Namen entstehen in derselben Transaktion (Upsert über `name_key`). Weil Umbenennen, Zusammenführen und Löschen von Tags die `version` der betroffenen Rezepte erhöhen (F-19), kann ein veralteter PUT keinen entfernten Tag wiederbeleben. `imageId: null` entfernt das Bild; eine unbekannte oder einem anderen Rezept zugeordnete `imageId` → 400 `VALIDATION` (`details[0].field = "imageId"`). PUT ersetzt das Rezept vollständig (Zutaten, Zubereitungsschritte und Tags werden neu geschrieben). Grenzen wie in F-06, F-10, F-11 und F-17. Der Server ignoriert `profileId`, `createdBy` und Ähnliches im Body. Alle rezeptbezogenen Endpunkte (inkl. Bewertung und Favorit) liefern für Rezepte im Papierkorb 410 `IN_TRASH`, außer `restore` und `DELETE /trash/:id`.

`RecipeCard`: `{ id, title, image: { urls: { s, m }, width, height } | null, tags: [{ id, name }] (max. 3), moreTags, ratingAvg, ratingCount, myRating, isFavorite, totalMinutes, updatedAt }`.

`RecipeDetail`: alle Felder aus `RecipeInput` plus `id`, `ingredients[].id`, `steps[].id`, `tags: [{ id, name }]`, `image: { id, urls: { s, m, l }, width, height } | null`, `rating: { avg, count, mine, byProfile: [{ profileId, name, stars }] }`, `isFavorite`, `createdBy`/`updatedBy: { id, name } | null`, `createdAt`, `updatedAt`, `totalMinutes`, `version`.

### 7.5 Bilder

| Methode | Pfad | Payload | Antwort | Fehler |
|---|---|---|---|---|
| POST | `/images` | Roher Body, `Content-Type: image/jpeg`, `image/png` oder `image/webp`, `Content-Length` ≤ 20 MiB | 201 `{ imageId, urls: { s, m, l }, width, height }` (noch nicht zugeordnet) | 400, 401, 413, 415, 503 `IMAGES_UNAVAILABLE`, 507 |
| GET | `/images/:id` | – | 200 `{ imageId, urls, width, height, assigned }` | 404 (gelöscht oder unbekannt) |
| GET | `/media/:file` (nicht unter `/api`) | – | WebP-Datei, `Cache-Control: public, max-age=31536000, immutable` | 404 (auch bei ungültigem Namen) |

Die Zuordnung zum Rezept erfolgt über `imageId` in `POST`/`PUT /recipes`.

### 7.6 Tags

| Methode | Pfad | Payload | Antwort | Fehler |
|---|---|---|---|---|
| GET | `/tags` | – | `{ tags: [{ id, name, count }], revision }`, sortiert nach Anzahl, dann `name_key` | – |
| POST | `/tags` | `{ name }` | 201 `{ tag }`; existiert der Schlüssel, 200 mit dem vorhandenen Tag | 400, 401 |
| PATCH | `/tags/:id` | `{ name }` | 200 `{ tag }`; betroffene Rezepte neu indexiert, `version` erhöht | 400, 401, 404, 409 `TAG_EXISTS` |
| POST | `/tags/:id/merge` | `{ intoTagId }` | 200 `{ tag, movedRecipes }`; Duplikate entfallen, der Quell-Tag wird gelöscht, betroffene Rezepte neu indexiert, `version` erhöht | 400, 401, 404 |
| DELETE | `/tags/:id` | – | 204; nur die Zuordnungen werden entfernt, betroffene Rezepte neu indexiert, `version` erhöht | 401, 404 |

### 7.7 Bewertung und Favoriten

| Methode | Pfad | Payload | Antwort | Fehler |
|---|---|---|---|---|
| PUT | `/recipes/:id/rating` | `{ stars: 1..5 }` | 200 `{ mine, avg, count }` (Upsert) | 400, 401, 404, 410 |
| DELETE | `/recipes/:id/rating` | – | 200 `{ mine: null, avg, count }` | 401, 404, 410 |
| PUT | `/recipes/:id/favorite` | – | 204 (idempotent) | 401, 404, 410 |
| DELETE | `/recipes/:id/favorite` | – | 204 (idempotent) | 401, 404, 410 |

### 7.8 Betrieb

| Methode | Pfad | Antwort | Fehler |
|---|---|---|---|
| GET | `/health` | `{ ok, status: "ok" oder "degraded" oder "read-only", version, uptimeSec, counts: { recipes, trash, images, profiles, tags }, bytes: { db, images, backups }, freeDiskBytes, lastBackupAt, lastBackupError, images: "ok" oder "unavailable", db: "ok" oder "corrupt", dataRevision }` (`counts.recipes` = aktive Rezepte ohne Papierkorb) | – |
| GET | `/revision` | `{ dataRevision }` (für den 60-s-Abgleich, F-36) | – |
| GET | `/server-info` | `{ hostname, urls: [{ url, kind: "public" oder "ip" oder "mdns" }], qrUrl, qrSvg }`, bei jedem Aufruf neu ermittelt | – |
| GET | `/backups` | `{ backups: [{ file, bytes, createdAt, kind: "auto" oder "manual" oder "pre-migration" }] }` | – |
| POST | `/backups` | 201 `{ file, bytes }` (asynchron per `db.backup()`) | 401, 503 `READ_ONLY`, 507 |
| GET | `/export` | ZIP-Stream, `Content-Disposition: attachment; filename="rezepte-export-JJJJ-MM-TT.zip"` | 500 bei einem Lesefehler (vor Streambeginn) |

Statische Auslieferung in dieser Reihenfolge:

1. `/assets/*` (Vite-Build mit Hash-Namen, inkl. Schriften): `Cache-Control: public, max-age=31536000, immutable`.
2. Vorhandene Dateien in der Wurzel von `dist/client` (aus `client/public/`: `manifest.webmanifest`, `icons/*`, `favicon.ico`, `apple-touch-icon.png`): `Cache-Control: no-cache`, korrekter Content-Type (Manifest: `application/manifest+json`).
3. GET-Pfade ohne Dateiendung, die nicht mit `/api` oder `/media` beginnen: `index.html` (SPA-Fallback, `no-cache`).
4. Alle übrigen Pfade (z. B. `/fehlt.png`): 404.

`index.html` trägt die CSP `default-src 'self'; img-src 'self' blob: data:; script-src 'self' 'sha256-…'; style-src 'self'; frame-ancestors 'none'`, dazu `X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`. Weil `style-src 'self'` auch `style`-Attribute im Markup blockiert, gilt die Regel „keine statischen `style=`-Attribute, dynamische Werte nur über die `style:`-Direktive“ (Kap. 5.6, NF-28); die E2E-Smoke-Tests gegen den Produktions-Build schlagen bei jedem `securitypolicyviolation`-Ereignis fehl (NF-29). API-Tests: `GET /manifest.webmanifest` → `application/manifest+json`; `GET /fehlt.png` → 404; `GET /rezepte/42` → `index.html`.

---

## 8. Umsetzungsplan

Jeder Meilenstein endet mit einem Ergebnis, das auf dem Handy nutzbar oder sichtbar ist. Der Aufwand gilt für eine Person mit Claude Code in Personentagen (PT). Kann-Anforderungen werden erst nach der Abnahme aller Muss- und Soll-Anforderungen angefasst. Für M2 bis M5 gilt zusätzlich als DoD: **NF-07, NF-08, NF-10, NF-11, NF-13 und NF-14 sind für alle in diesem Meilenstein gebauten Screens grün.** AK-Teile, die Funktionen späterer Meilensteine voraussetzen, werden dort nachgeprüft; die Verschiebungen sind je Meilenstein genannt.

| Meilenstein | Inhalt | Aufwand | Auf dem Handy nutzbar |
|---|---|---|---|
| M0 | Fundament und Handy-Nachweis | 1–2 PT | Technische Platzhalterseite über `http://<IP>:8080` |
| M1 | Visuelles Design mit dem design-Skill | 2–3 PT + Wartezeit | Design-Canvas (Artifact) auf dem Handy ansehen |
| M2 | Profile und Rezepte-Kern | 3–4 PT | Profil wählen, Rezept anlegen, lesen, bearbeiten, löschen |
| M3 | Bilder | 1–2 PT | Foto aufnehmen, in Liste und Detail sehen |
| M4 | Tags, Suche, Filter, Sortierung | 3 PT | Umlautsicher suchen, mit Chips filtern |
| M5 | Bewertung, Favoriten, Bedienkomfort | 2–3 PT | Bewerten, Favoriten, Textmodus, Rückgängig |
| M6 | Betrieb auf dem Windows-PC | 2 PT | App läuft als Dienst, QR-Verbindung, Backup, Export |
| M7 | Härtung und Abnahme | 2 PT | Abnahme auf allen 4 Geräteklassen |
| **Summe** | | **16–21 PT** | |

**M0 – Fundament und Handy-Nachweis (1–2 PT)**

- Lieferumfang: `package.json` (ein Paket, `packageManager: pnpm@10.34.5`, `engines`) mit allen Skripten, `.npmrc` mit `package-import-method=copy`, tsconfigs, Biome, Vitest und Size-Check-Gerüst; GitHub-Actions-Workflow für `pnpm verify`. Hono-Server mit Middleware-Kette (requestId, Host-Prüfung nach NF-21, Security-Header, Fehler), `/api/v1/health`, `/api/v1/revision`, `/api/v1/server-info`, statische Auslieferung in der Reihenfolge aus Kap. 7.8 inkl. SPA-Fallback, Logger (NF-25). DB-Schicht mit PRAGMAs, Migrationslauf und vollständiger `001_init.sql` inkl. FTS5; `shared/normalize.ts` mit Tests. Eine ungestaltete technische Platzhalterseite (Server-Status, URLs, QR-Code). Firewall-Teil von `install.ps1`. Build-Freigaben für native Module sind nicht nötig: better-sqlite3 13.0.3 und sharp 0.35.4 haben laut npm-Registry kein Install-Skript; M0 bestätigt das mit einer Installation auf dem Ziel-PC.
- DoD: Ein Handy im WLAN öffnet `http://<IP>:8080` und sieht die Platzhalterseite; better-sqlite3 und sharp laden auf dem Ziel-PC; die API-Tests zur statischen Auslieferung sind grün; `pnpm verify` ist lokal und in CI grün.

**M1 – Visuelles Design mit dem design-Skill (2–3 PT + Wartezeit; vor jedem UI-Code)**

Das Design entsteht mit dem design-Skill von Claude Code als mehrteiliger Design-Canvas (Artifact).

1. **Richtungsskizzen:** drei bewusst verschiedene Low-Fi-Richtungen als getrennte Artboards, jeweils Rezeptliste und Rezeptdetail auf 390×844, alle mit der Palette:
   - „Warm-editorial“: Serifen-Display, viel Weißraum;
   - „Klar-funktional“: Sans-Serif, dichte Listen, Suche und Chips vorne;
   - „Bildlastig“: Fotos, Kartenraster.
2. **Auswahl** durch den Nutzer (ggf. mit Kombinationswünschen).
3. **Statische Mockups** der gewählten Richtung (kein klickbarer Prototyp):
   - Pflicht-Artboards (Nutzervorgabe, 12): Handy 390×844 mit Profilwahl, Rezeptliste mit Suche und Tag-Filter, Rezeptdetail, Rezept anlegen/bearbeiten, Favoriten; Tablet 1024×768 mit Liste und Detail nebeneinander; alles hell und dunkel;
   - Ergänzungen (hell und dunkel): Tablet hochkant 768×1024 (Liste und Detail), Editor am Tablet 1024×768, Filter-Sheet am Handy, Zutaten-Zeilenlayout unter 400 px Breite (Teil des Handy-Editors);
   - ein Komponenten- und Zustandsblatt (hell und dunkel): Chips inaktiv/aktiv, Sterne leer/gefüllt, Herz auf Foto, Avatare, Toast, Banner, Dialog (inkl. Konfliktdialog), Sheet, Leerzustand, Skeleton, Eingabefehler, Zurück- und Aktualisieren-Schaltfläche, aktive Navigation;
   - ein Artboard „App-Icon und Favicon“ (192/512 maskable mit Safe-Zone, 180 apple-touch-icon, Favicon, `theme-color` je Schema);
   - ein Token-Blatt: Farben inkl. oklch-Ableitungen, `--color-primary-text`, Avatarfarben und Kontrastwerten, Typo-Skala, Abstände, Radien, Icon-Auswahl, Schriftwahl mit Dateigrößen, Kartenformat und daraus die Maße der Bildvarianten (F-15).
4. **Freigabe** durch den Nutzer; danach gehen die Werte ohne Rundung in `tokens.css` und `shared/constants.ts` über.

- DoD: Freigegebener Canvas-Link in `docs/design/README.md`; `tokens.css` enthält alle Werte; der Kontrasttest (NF-13) ist grün; Schrift und Icon-Set sind festgelegt und passen ins Budget (NF-01, NF-15); Kartenformat und Bildvarianten sind festgelegt.
- M0 und M1 können parallel laufen; M2 beginnt erst nach der Freigabe.

**M2 – Profile und Rezepte-Kern (3–4 PT)**

- Lieferumfang: Profil-API und -Screens (F-01 bis F-05); App-Shell mit Navigation, Zurück-Schaltflächen und Avatar-Sheet; Toast-Infrastruktur mit Rückgängig; Rezept-API mit Transaktionen, Versionierung, `createKey`, Papierkorb und `IN_TRASH` (F-06 bis F-08, F-11); Editor mit strukturierten Zutaten, Zubereitungsschritten, Umsortieren, Tastaturfluss, Entwurfsschutz, Konfliktdialog (F-07, F-09, F-10); Liste mit Karten, Skeletons, Aktualisieren und Paginierung; Detail (F-29); Zustände (F-33); Deep-Links und Scroll-Wiederherstellung (F-34); API-Tests; Seed-Skript mit 1.000 Rezepten.
- DoD: Am Handy ein Rezept mit 5 Zutaten anlegen, am Tablet bearbeiten, den Konflikt zweier Geräte vorführen, löschen und wiederherstellen; die AKs von F-01 bis F-11, F-29, F-33 und F-34 sind grün mit diesen Verschiebungen: F-02 (iOS-Verknüpfung → M6), F-03 (Herzen, Sterne, Favoriten-Ansicht → M5), F-06 (Tags → M4), F-08 (Bild → M3; Bewertungen und Favoriten → M5), F-09 (Bild und abgelaufenes Bild → M3), F-29 (Bild → M3; Tag-Antippen → M4; Sterne → M5), F-33 (Suche ohne Treffer → M4), F-34 (Filter in der URL → M4).

**M3 – Bilder (1–2 PT)**

- Lieferumfang: `POST /images` mit Stream in `tmp/`, Magic-Bytes- und Pixelprüfung, Warteschlange, sharp-Pipeline (einmal dekodieren, `cache(false)`, `concurrency(2)`) mit atomarem Schreiben, `GET /images/:id`, Aufräumen mit `images/.trash/` und Rückholung, `/media` mit Pfadschutz; ImagePicker mit zwei Schaltflächen, Vorschau, Fortschritt, Inaktivitäts-Timeout, Retry; `srcset`/`sizes` für Karten; Platzhalter-SVG (F-14 bis F-16, NF-06).
- DoD: Foto aufnehmen auf echtem Android-Handy, iPhone und iPad (Kamera öffnet direkt, Hochformat korrekt, HEIC kommt als JPEG an); Dateigrößen, Verarbeitungszeit, RAM-Spitze und Leerlauf-RSS nach einem Upload auf dem Ziel-PC gemessen und im Log belegt (NF-05); die in M2 verschobenen Bild-AKs von F-08, F-09 und F-29 sind grün.

**M4 – Tags, Suche, Filter, Sortierung (3 PT)**

- Lieferumfang: Tag-API inkl. Zusammenführen mit Versionserhöhung, Autovervollständigung, Tag-Seite, Start-Tags (F-17 bis F-20); FTS-Pflege inkl. Purge, Query-Builder (Präfix, Teilwort, ae/oe/ue-Varianten), Ranking, „Meintest du“ (F-21 bis F-23); Chip-Reihe, Filter-Sheet, Sortierung Grundumfang, URL-Zustand (F-24, F-26); Benchmark mit 1.000 Rezepten (NF-04).
- DoD: „kaese“, „suppe“ und „zwieb“ liefern die erwarteten Treffer am Handy; p95 ≤ 30 ms belegt; die AKs von F-17 bis F-24 und F-26 sowie die in M2 verschobenen Tag-, Such- und Filter-AKs sind grün.

**M5 – Bewertung, Favoriten, Bedienkomfort (2–3 PT)**

- Lieferumfang: Bewertungs- und Favoriten-API, Sterne (inkl. „Bewertung entfernen“) und Herz optimistisch, Favoriten-Ansicht, Einzelbewertungen (F-27, F-28); Favoriten- und Bewertungsfilter, weitere Sortierungen (F-25, F-43, F-44); Textmodus mit Parser (≥ 40 Testzeilen mit Sollwerten) und Schritt-Parser (F-12); Hinweis auf ähnliche Rezepte (F-45); Abhaken (F-30); weitere Rückgängig-Aktionen (F-35); Aktualität über Revision, 60-s-Abgleich und App-Version (F-36); Darstellungsumschalter (NF-14).
- DoD: Szenarien S5, S6, S7 und S8 laufen am Handy durch; die AKs von F-12, F-25, F-27, F-28, F-30, F-35, F-36 und F-43 bis F-45 sowie die in M2 verschobenen Bewertungs- und Favoriten-AKs sind grün.

**M6 – Betrieb auf dem Windows-PC (2 PT)**

- Lieferumfang: `install.ps1`, `uninstall.ps1`, `update.ps1` mit WinSW-Dienst, ACLs, Prüfungen (Node-Pfad, Netzprofil, mDNS, Block-Regeln für `node.exe`, reservierte Portbereiche, OneDrive-Pfad, `safe.directory`) und Health-Prüfung (NF-22, NF-23, NF-27); Start-Prüfungen, sauberes Beenden, eingeschränkter Betrieb, Nur-Lese-Modus (NF-19, NF-24); Backup-Plan mit `db.backup()`, Nachholen, Rotation, manuellem Backup (F-40); ZIP-Export (F-41); Verbinden-Seite (F-39); Status (F-42); Manifest, Icons und Meta-Tags (F-37); `docs/BETRIEB.md` und `docs/VERBINDEN.md`.
- DoD: PC-Neustart ohne Anmeldung → App vom Handy erreichbar; `taskkill` → nach ≤ 15 s wieder da; `Stop-Service` → Logzeile „shutdown: SIGINT“ und leere bzw. fehlende `-wal`-Datei (sonst Plan B aus Kap. 5.4 umsetzen); ein neues Handy ist per QR in ≤ 1 min verbunden; Wiederherstellung aus Backup inkl. Bildrückholung real durchgespielt; das in M2 verschobene iOS-AK von F-02 ist grün.

**M7 – Härtung und Abnahme (2 PT)**

- Lieferumfang: Abnahme-Checkliste auf 4 Geräteklassen (Kap. 9.4); Lighthouse (Performance, Accessibility) hell und dunkel; Design-Vergleich nach NF-16 inkl. Screenshot-Satz der Screens ohne Artboard; E2E-Smoke-Tests mit CSP-Prüfung in Chromium und WebKit; Budgetnachweise (NF-01 bis NF-05); Aufräumen der Fehlerliste; danach, falls Zeit bleibt, die Kann-Anforderungen F-13, F-31, F-32 und F-38; Release-Tag `v1.0.0` (Release 1.0) mit CHANGELOG.
- DoD: Alle Muss-AKs sind grün und protokolliert; offene Soll-Punkte sind mit dem Nutzer abgestimmt.

---

## 9. Qualitätssicherung

### 9.1 Testebenen

| Ebene | Werkzeug | Inhalt | Umfang |
|---|---|---|---|
| Unit | Vitest | `normalize`, `queryVariants`, Zutaten-Parser (Sollwerte aus `tests/fixtures/ingredient-lines.json`), Schritt-Parser, Formatierung (Zahlen, Brüche nach F-10, Datum), Skalierung und Pluralformen (falls F-13), Damerau-Levenshtein, Backup-Zeitplan mit injizierter Uhr (inkl. Sommer- und Winterzeit), Adressfilter für `server-info`, Host-Prüfung, Kontrastpaare, Farbliteral- und Emoji-Suche, Suche nach `style=`-Attributen | normalize ≥ 30 Fälle, Parser ≥ 40 Zeilen |
| API | Vitest + Hono `app.request()` gegen `:memory:`-DB | Jeder Endpunkt mit Erfolgs- und Fehlerfall; Manipulationstests (fremde `profileId`, `version=999`, veralteter PUT nach Tag-Merge, PDF als .jpg, HEIC, Pfad-Traversal, fremder Host, IP-Literal, fehlender Client-Header, doppelter `createKey`, unbekannte `imageId`, Rezept im Papierkorb); Transaktions-Rollback; FTS-Aktualisierung nach Tag-Merge und Purge; statische Auslieferung (Manifest, 404 für fehlende Dateien, SPA-Fallback); Statement-Zähler | alle Routen |
| Migration | Vitest | Leere DB und Beispiel-DB der Vorversion; Vorab-Backup; Rollback bei Fehler | je Migration |
| Bildpipeline | Vitest mit Fixtures | Größen, Orientierung, EXIF entfernt, Pixelgrenze, atomares Schreiben bei simuliertem Fehler, `.trash`-Verschiebung und Rückholung | 7 Fixtures |
| Performance | Vitest-Benchmark + Seed | p95 Liste/Suche/Detail bei 1.000 Rezepten; RAM-Spitze bei 2 Uploads; Leerlauf-RSS nach Upload | vor jedem Release |
| E2E-Smoke | Playwright (Chromium, WebKit), 390×844 und 1024×768, Produktions-Build mit CSP | Profil wählen; Rezept mit Bild anlegen; suchen und filtern; bewerten und favorisieren; zusätzlich `scrollWidth`-Prüfung auf 5 Breiten, `naturalWidth` der Kartenbilder, Abbruch bei `securitypolicyviolation` | 4 Flows |
| Manuell | Echte Geräte | Abnahme-Checkliste (9.4), Design-Vergleich (9.6) | je Release |

### 9.2 Typecheck, Lint, Gate

- `pnpm verify` = `svelte-check` + `tsc -p tsconfig.server.json --noEmit` + `tsc -p tsconfig.shared.json --noEmit` + `biome check` + `vitest run` + `node scripts/size-check.ts`; Ziel ≤ 90 s.
- GitHub Actions (ubuntu-latest, Node 24) führt `pnpm verify` bei jedem Push aus; E2E laufen lokal vor jedem Release.
- `pnpm audit --prod` vor jedem Release.

### 9.3 Testdaten

- `tests/seed.ts`: 1.000 Rezepte aus deutschen Wortlisten (Titel mit Umlauten, Komposita wie „Kürbissuppe“, „Käsekuchen“, „Weißkohlsalat“), je 10 Zutaten, 6 Zubereitungsschritte, 3 Tags aus 40; 3 Profile mit Bewertungen und Favoriten; deterministisch (fester Seed).
- Umlaut- und Sortierlisten: ['Zucchini', 'Öl', 'Birne', 'Äpfel', 'Apfelkuchen', 'Ananas'], ß/ss/sss-Varianten, „Crème brûlée“, „Michaels Nudeln“, Emojis im Titel.
- Parserzeilen (`tests/fixtures/ingredient-lines.json`, verbindliche Sollwerte): ≥ 40 echte Zeilen, u. a. „1/2 TL Salz“, „2-3 EL Olivenöl“, „1 ½ Tassen Milch“, „250 g Mehl (Type 405)“, „1 Prise Salz“, „Salz und Pfeffer“, „etwas Zimt“, „n. B. Petersilie“, „Für die Soße:“, „3 Zehen Knoblauch, fein gehackt“, „2 Esslöffel Zucker“.
- Bild-Fixtures: 12-MP-JPEG hochkant mit EXIF-Orientierung 6 und GPS; PNG mit Transparenz; WebP; HEIC-Probe; PDF mit Endung .jpg; 25-MB-Datei (erzeugt); Bild mit > 60 MP (erzeugt); beschädigtes JPEG.
- Beschädigte SQLite-Datei für den Nur-Lese-Test.

### 9.4 Manuelle Gerätetests und Abnahme-Checkliste

Testgeräte (konkrete Modelle bestätigt der Nutzer, Kap. 12): Android-Handy mit Android 12+ (Mittelklasse, mindestens 3 Jahre alt) und Chrome; iPhone mit iOS 17+ und Safari; iPad mit iPadOS 17+ und Safari; Windows-11-PC mit Edge, Chrome und Firefox.

| Prüfpunkt | Anforderung (Priorität) | Android | iPhone | iPad | Windows |
|---|---|---|---|---|---|
| QR-Code scannen öffnet `http://…` (ohne HTTPS-Warnseite), Profilwahl erscheint | F-39 (Muss) | ● | ● | ● | – |
| Verknüpfung auf dem Startbildschirm anlegen; Icon und Name stimmen; iOS fragt einmal nach dem Profil; Android öffnet im Chrome-Tab | F-37 (Soll) | ● | ● | ● | – |
| Verknüpfung ohne Browserleiste (iOS): Zurück-Schaltflächen und Aktualisieren funktionieren | F-34 (Muss) | – | ● | ● | – |
| „Foto aufnehmen“ öffnet direkt die Kamera; Foto hochkant korrekt; iPhone-Foto kommt als JPEG an | F-14 (Muss) | ● | ● | ● | – |
| „Bild auswählen“ aus Galerie bzw. Dateisystem | F-14 (Muss) | ● | ● | ● | ● |
| Fokus in einem Eingabefeld löst keinen Zoom aus; Tastatur verdeckt kein Feld im Editor | NF-15, NF-07 (Muss) | ● | ● | ● | – |
| Rezept im Textmodus erfassen (10 Zutaten), speichern | F-12 (Muss) | ● | ● | ● | ● |
| Entwurf nach Schließen des Browser-Tabs wiederherstellen | F-09 (Muss) | ● | ● | ● | ● |
| Suche „kaese“, „suppe“, „zwieb“ liefert die erwarteten Treffer | F-21, F-22 (Muss) | ● | ● | ● | ● |
| Zwei Tag-Chips mit zwei Fingertipps; Filter bleibt nach Zurück und Neuladen | F-24, F-34 (Muss) | ● | ● | ● | ● |
| Herz und Stern reagieren sofort; bei gestopptem Server Banner und Rücknahme | F-27, F-28, F-33 (Muss) | ● | ● | ● | ● |
| Zurück-Taste bzw. -Geste schließt das Sheet; Scrollposition bleibt | F-34 (Muss) | ● | ● | ● | ● |
| Tablet quer: Liste und Detail nebeneinander; hochkant: Zutaten neben Schritten; Drehen behält den Zustand | NF-08, F-29 (Muss) | – | – | ● | – |
| Dark Mode ohne hellen Blitz; manueller Umschalter wirkt | NF-14 (Muss) | ● | ● | ● | ● |
| Keine Konsolenfehler (Remote-Debugging bzw. DevTools) über `http://<IP>` | NF-26 (Muss) | ● | ● | ● | ● |
| `.local`-Adresse testen und Ergebnis dokumentieren (kein Abnahmekriterium) | NF-23 (Muss, nur Dokumentation) | ● | ● | ● | ● |
| Tastaturbedienung: Rezept anlegen, Sterne per Pfeiltasten, „Bewertung entfernen“ | NF-11 (Muss) | – | – | – | ● |
| Export-ZIP herunterladen und öffnen | F-41 (Soll) | – | – | – | ● |

● = zu prüfen. Prüfpunkte zu Soll- und Kann-Anforderungen gelten nur, sofern diese umgesetzt sind (NF-17). Jeder Punkt wird mit Datum, Gerät, Browserversion und Ergebnis in `docs/abnahme/v1.0.0.md` protokolliert.

### 9.5 Budget- und Performance-Nachweise

- Size-Check-Ausgabe (Chunks, CSS, Schriften) je Release in der CI-Ausgabe und im Abnahmeprotokoll.
- Lighthouse Mobile auf Liste, Detail und Editor, hell und dunkel, gegen den LAN-Server; Werte im Protokoll.
- RAM und CPU des Dienstes: Task-Manager nach 10 min Leerlauf, 10 min nach einem Upload und während zweier gleichzeitiger Uploads; `process.memoryUsage` im Log.
- p95 der Serverzeit aus dem Benchmark mit Seed-Daten.

### 9.6 Design-Abnahme

- Für jedes freigegebene Artboard (12 Pflicht-Artboards plus Ergänzungen aus M1) entsteht ein Screenshot der Umsetzung in gleicher Größe und gleichem Modus.
- Für Screens ohne eigenes Artboard (Tag-Seite, Papierkorb, Verbinden, Status, Konfliktdialog, Desktop ≥ 1280 px) entsteht ein eigener Screenshot-Satz in hell und dunkel.
- Eine Vergleichsliste nennt jede Abweichung (Maß > 4 px, Farbe, Schrift) mit Begründung; der Nutzer gibt Liste und Screenshot-Satz frei (NF-16).

---

## 10. Betrieb im LAN

### 10.1 Zielsystem und Ordner

- Ein Windows-10/11-PC, der dauerhaft läuft; LAN-Kabel empfohlen, stabiles WLAN möglich.
- `C:\RezepteApp\app` (Code), `C:\RezepteApp\service` (WinSW), `C:\RezepteApp\data` (alle Daten). Der Datenordner liegt **nicht** in einem OneDrive- oder anderen Cloud-Sync-Ordner (Sperrkonflikte auf `rezepte.sqlite-wal` können die DB beschädigen). Synchronisiert werden höchstens `backups\` und `images\`.

### 10.2 Voraussetzungen

- Node.js 24 LTS **maschinenweit** installiert (MSI „für alle Benutzer“ nach `C:\Program Files\nodejs` oder `winget install OpenJS.NodeJS.LTS --scope machine`). Eine Installation unter dem Benutzerprofil (z. B. per nvm) ist für den Dienst unter LocalService nicht erreichbar; `install.ps1` bricht dann ab.
- Git, pnpm 10 (`corepack enable`; die Version legt das Feld `packageManager` fest), einmalig Administratorrechte.
- Build-Freigaben für native Module (`onlyBuiltDependencies`) sind nicht erforderlich: better-sqlite3 13 und sharp 0.35 liefern ihre Binärdateien ohne Install-Skript (geprüft mit better-sqlite3 13.0.3 und sharp 0.35.4).

### 10.3 Installation (Kurzfassung von `docs/BETRIEB.md`)

Alle Schritte laufen in einer PowerShell **als Administrator**, damit Besitzer des Repository-Ordners und ausführender Benutzer bei späteren Updates übereinstimmen (sonst bricht `git` mit „detected dubious ownership“ ab).

1. `git clone https://github.com/n3t-rnr/recipe-book-v2 C:\RezepteApp\app`
2. `cd C:\RezepteApp\app` und `pnpm install --frozen-lockfile --package-import-method=copy` (die Einstellung steht zusätzlich in `.npmrc`). Das Kopieren statt Hardlinks aus dem pnpm-Store ist nötig: Store-Dateien im Benutzerprofil erben dessen Rechte und wären für LocalService nicht lesbar.
3. `pnpm build`
4. `deploy\install.ps1 -Port 8080 -DataDir C:\RezepteApp\data`
5. Die ausgegebenen URLs und den QR-Code mit dem Handy prüfen; optional eine DHCP-Reservierung im Router anlegen und einen sprechenden Computernamen setzen (z. B. `kueche-pc`).

`install.ps1` führt aus:

- **Prüfungen:** Adminrechte; Node 24.x und der Pfad liegt nicht unter `C:\Users`; `dist\client` vorhanden; `DATA_DIR` nicht unter `$env:OneDrive` oder einem Pfad mit „OneDrive“; Port frei und nicht in einem reservierten Bereich (`netsh int ipv4 show excludedportrange protocol=tcp`, Hyper-V/WSL2/Docker); bei Bedarf `git config --global --add safe.directory C:/RezepteApp/app`.
- **Ordner und Rechte:** `data\images`, `data\images\.trash`, `backups`, `logs`, `tmp` anlegen; `icacls`: LocalService (`*S-1-5-19`) erhält „Ändern“ auf `data\` sowie „Lesen und Ausführen“ auf `app\` und `service\`.
- **WinSW:** `WinSW-NET461.exe` v2.12.0 von den GitHub-Releases laden, gegen einen im Skript hinterlegten SHA-256 prüfen und als `service\RezepteApp.exe` ablegen; `RezepteApp.xml` aus der Vorlage schreiben; `RezepteApp.exe install`; Starttyp Automatisch; Dienst starten.
- **Firewall:** `New-NetFirewallRule -DisplayName 'RezepteApp' -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow`. Zusätzlich Suche nach Block-Regeln für `node.exe` (entstehen, wenn der Windows-Firewall-Dialog beim ersten `pnpm dev` abgebrochen oder für „Öffentlich“ beantwortet wurde; Block-Regeln haben Vorrang vor Allow-Regeln): `Get-NetFirewallApplicationFilter -Program '*node.exe' | Get-NetFirewallRule | Where-Object Action -eq Block`; gefundene Regeln werden gemeldet und nach Rückfrage deaktiviert.
- **Netz:** `Get-NetConnectionProfile` → Warnung bei „Public“ mit dem Befehl `Set-NetConnectionProfile -InterfaceIndex <n> -NetworkCategory Private`; mDNS-Prüfung (Registry `EnableMDNS`, Firewall-Regel „mDNS (UDP-In)“ für Privat aktiv).
- **Health-Prüfung:** bis zu 30 s auf `http://localhost:8080/api/v1/health` des laufenden Dienstes warten; damit sind die Rechte des Dienstkontos real geprüft.
- **Energie:** Hinweis auf die Energieoptionen; mit dem Schalter `-KeepAwake` wird `powercfg /change standby-timeout-ac 0` und `powercfg /change hibernate-timeout-ac 0` gesetzt.
- **Ausgabe:** URLs, QR-Code, Verweis auf `docs\VERBINDEN.md`.

### 10.4 Autostart

WinSW-Konfiguration (Vorlage; die Syntax wird gegen die WinSW-2.12-Dokumentation geprüft):

```xml
<service>
  <id>RezepteApp</id>
  <name>RezepteApp</name>
  <description>Rezepte-App im Heimnetz</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>--disable-warning=ExperimentalWarning server\main.ts</arguments>
  <workingdirectory>C:\RezepteApp\app</workingdirectory>
  <env name="NODE_ENV" value="production"/>
  <env name="PORT" value="8080"/>
  <env name="DATA_DIR" value="C:\RezepteApp\data"/>
  <serviceaccount>
    <domain>NT AUTHORITY</domain>
    <user>LocalService</user>
  </serviceaccount>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>C:\RezepteApp\data\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>3</keepFiles></log>
</service>
```

- Der Dienst startet vor jeder Anmeldung. `sc stop` bzw. `Stop-Service` lassen WinSW Strg+C an `node.exe` senden; Node erhält SIGINT, und der Server führt den WAL-Checkpoint aus (NF-24). Dass das auf dem Ziel-PC funktioniert, prüft M6 real; sonst greift Plan B (Shutdown-Endpunkt nur für `localhost`, aufgerufen über `<stopexecutable>`, Kap. 5.4).
- WinSW startet nur neu, wenn der Prozess endet. Einen hängenden Prozess erkennt es nicht; das Risiko ist gering, weil alle Operationen kurz sind und Timeouts haben (Watchdog im Backlog).
- **Notlösung ohne WinSW:** Windows-Aufgabenplanung (`deploy\install.ps1 -UseTaskScheduler`) mit Trigger „Beim Start“, Konto `NT AUTHORITY\LOCAL SERVICE` und „Unabhängig von Benutzeranmeldung“. Einschränkungen: kein verlässlicher Neustart nach einem Absturz des laufenden Prozesses („Bei Fehler neu starten“ greift verlässlich nur, wenn der Start der Aufgabe scheitert), kein sauberes Stop-Signal (`Stop-ScheduledTask` wirkt wie ein Kill). Nicht empfohlen.

### 10.5 Firewall und Netzwerkprofil

- Die Regel gilt nur für das Profil „Privat“, damit die App in fremden Netzen (Laptop unterwegs) nicht offen ist.
- Häufigster Fehler: Das Heimnetz ist in Windows als „Öffentlich“ eingestuft. `install.ps1` warnt, und `docs/BETRIEB.md` zeigt die Umstellung in Einstellungen → Netzwerk → Eigenschaften → Netzwerkprofiltyp.
- Zweithäufigster Fehler: eine Block-Regel „Node.js JavaScript Runtime“ aus einem früheren Firewall-Dialog; `install.ps1` findet sie (Kap. 10.3).
- Keine Portweiterleitung im Router; der Server ist bewusst nur im LAN erreichbar.

### 10.6 Erreichbarkeit

1. **IP-Adresse** (verlässlich, verbindlich): `http://192.168.178.20:8080`. Eine DHCP-Reservierung im Router (FRITZ!Box: Heimnetz → Netzwerk → Gerät → „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“) hält sie dauerhaft gültig. Wechselt die IP dennoch, bleibt die App über die neue IP ohne Neustart erreichbar (NF-21); Konsole und Verbinden-Seite zeigen die neue Adresse.
2. **mDNS-Name:** `http://<Computername>.local:8080`. Aktuelle Windows-10/11-Versionen beantworten mDNS für den eigenen Namen, sofern das nicht per Richtlinie (`EnableMDNS=0`) abgeschaltet ist. iOS und macOS lösen `.local` auf; aktuelle Android-Versionen über ein Update des DNS-Resolver-Moduls, das aber ausfällt, wenn „Privates DNS“ fest eingestellt ist (z. B. dns.google) oder der Router Multicast filtert. `.local` ist deshalb eine Komfortadresse, kein Abnahmekriterium (NF-23). Der NetBIOS-Name ohne `.local` funktioniert nur zwischen Windows-Rechnern und wird für Handys nicht angezeigt.
3. **Router-Name:** Viele Router vergeben DNS-Namen wie `kueche-pc.fritz.box`; sie sind über `ALLOWED_HOSTS` erlaubt (Standard `<Computername>.fritz.box`) und können als `PUBLIC_URL` gesetzt werden.
4. **QR-Code:** in der Konsole beim Start und unter „Mehr → Anderes Gerät verbinden“; er enthält die IP-URL mit ausgeschriebenem `http://` bzw. `PUBLIC_URL`, falls gesetzt. Ein verbundenes Gerät verbindet das nächste.
5. **IPv6:** `HOST` bleibt standardmäßig leer; Node lauscht dann dual-stack auf `::` und nimmt IPv4 und IPv6 an. Das ist wichtig, weil der Windows-mDNS-Responder auch AAAA-Einträge liefert und iOS/Android zuerst IPv6 versuchen. Link-Local-Adressen (fe80::) erscheinen nie in URLs oder QR-Codes.
6. **Browser-Hinweise** (in `docs/VERBINDEN.md` und auf der Verbinden-Seite):
   - Chrome und Safari zeigen in der Adressleiste „Nicht sicher“; das ist über http erwartet und unkritisch.
   - Chrome aktiviert ab Version 154 (Oktober 2026) standardmäßig „Immer sichere Verbindungen verwenden“, nimmt private Adressen (lokale IPs, Intranet-Namen) laut Ankündigung aber von der Warnung aus. Wer die strenge Variante für alle Websites eingeschaltet hat, sieht eine Warnseite und wählt „Trotzdem fortfahren“. Getippte Adressen immer mit `http://` eingeben.
   - Eine iOS-Verknüpfung auf dem Home-Bildschirm hat einen eigenen Speicher: Profil und Entwürfe aus Safari sind dort nicht vorhanden; das Profil wird einmal neu gewählt.
   - Android öffnet eine Verknüpfung über http im normalen Chrome-Tab mit Adressleiste.
   - Löst Android `.local` nicht auf → IP oder QR-Code verwenden, ggf. „Privates DNS“ auf „Automatisch“ oder „Aus“ stellen.

### 10.7 HTTP oder HTTPS

| Option | Aufwand je Gerät | Gewinnt | Kosten | Bewertung |
|---|---|---|---|---|
| A: Reines HTTP im LAN | keiner | Einfachster Betrieb; alle Kernfunktionen laufen. Die Kamera funktioniert über `<input type="file" capture>`, `localStorage`, `fetch` und History uneingeschränkt | Kein Service Worker, kein Offline, kein Installationsdialog, kein Wake Lock, `navigator.clipboard.writeText` und Web Share nicht verfügbar, `getUserMedia` blockiert; Anzeige „Nicht sicher“ | **Empfehlung für Release 1.0** |
| B: mkcert bzw. eigene CA | Root-Zertifikat auf jedem Gerät installieren (iOS: Profil installieren und unter Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen aktivieren) | Alle Browser-APIs, Offline-Lesen möglich | Einrichtung je Gerät und je neuem Gerät; das Zertifikat hängt an Name/IP; Ablauf und Erneuerung | Später, falls Offline oder Wake Lock gewünscht |
| C: Eigene Domain mit öffentlichem Zertifikat (DNS-01) und lokalem DNS-Eintrag | keiner | Echte Zertifikate ohne Vertrauensschritt | Eigene Domain, DNS-API, Ausnahme für den DNS-Rebind-Schutz im Router, automatische Erneuerung | Später, als komfortabelster HTTPS-Weg |

Konsequenzen der Entscheidung A:

- Die App verspricht weder Offline-Betrieb noch eine Installation im Sinne einer PWA; sie bietet eine Verknüpfung auf dem Startbildschirm (NF-26, F-37).
- Geschwindigkeit kommt aus HTTP-Caching (Assets und Bilder `immutable`), einem kleinen Bundle und dem In-Memory-Cache der letzten Liste.
- Der Kochmodus zeigt einen Hinweis statt eines Wake Locks.
- „Link kopieren“ nutzt Rückfallebenen.
- HTTPS ist nicht Teil von Release 1.0 und enthält keinen vorbereiteten, ungetesteten Code. Der spätere Wechsel auf B oder C bleibt klein: `@hono/node-server` startet mit `createServer: https.createServer`, und die Architektur (ein Prozess, ein Port) ändert sich nicht.

### 10.8 Energie und Windows-Updates

- Der PC darf nicht in den Ruhezustand gehen (Energieoptionen „Nie“ bei Netzbetrieb bzw. `install.ps1 -KeepAwake`); alternativ Wake-on-LAN, was die App nicht selbst leisten kann.
- Nach Windows-Updates startet der Dienst dank Starttyp Automatisch ohne Anmeldung. `docs/BETRIEB.md` enthält eine monatliche Kurzprüfung: `Get-Service RezepteApp` (Running, Automatic) und Status-Seite (letztes Backup).

### 10.9 Backup und Wiederherstellung

- **Automatisch:** täglich ab 03:00 Ortszeit per Online-Backup (`db.backup()`, asynchron) nach `data\backups\rezepte-JJJJ-MM-TT.sqlite`, 14 Generationen, verpasste Backups werden nach dem Start nachgeholt (F-40). Vor Migrationen `pre-migration-NNN.sqlite` per `VACUUM INTO` (5 Generationen). Manuelle Backups: `manual-JJJJ-MM-TT-HHMM.sqlite` (5 Generationen).
- **Bilder:** Ersetzte oder gelöschte Bilddateien bleiben 14 Tage in `data\images\.trash\` (F-16). Damit passen alle Backups der letzten 14 Tage zu den vorhandenen Bilddateien; beim Start nach einer Wiederherstellung holt der Server referenzierte Dateien automatisch zurück.
- **Vollständige Sicherung:**
  - Bei laufendem Dienst werden `data\backups\` und `data\images\` (inkl. `.trash\`) kopiert; beide sind konsistent.
  - Bei gestopptem Dienst wird der ganze Ordner `data\` kopiert.
  - Die Live-Datei `rezepte.sqlite` wird bei laufendem Dienst nicht kopiert.
- **Extern (empfohlen, A16):** Eine Skriptvorlage in `docs/BETRIEB.md` kopiert wöchentlich per `robocopy` `backups\` und `images\` auf NAS oder USB-Datenträger (Aufgabenplanung).
- **Wiederherstellung** (≤ 10 Schritte):
  1. `Stop-Service RezepteApp`
  2. `rezepte.sqlite`, `-wal` und `-shm` in `*.defekt` umbenennen
  3. Die gewünschte Backup-Datei als `data\rezepte.sqlite` kopieren
  4. Ist das Backup älter als 14 Tage oder fehlt `images\`, `images\` aus der externen Sicherung zurückkopieren
  5. `Start-Service RezepteApp` (der Start holt referenzierte Bilder aus `images\.trash\` zurück)
  6. `/api/v1/health` und die App prüfen

  Bilddateien ohne DB-Zeile verschiebt der wöchentliche Aufräumlauf nach `images\.trash\`; fehlende Bilder erscheinen als Platzhalter.
- **Export-ZIP** (F-41): für Archiv und Umzug, menschenlesbar; in Release 1.0 kein Import (Backlog).

### 10.10 Update und Deinstallation

- **Update** (`deploy\update.ps1`, als Administrator): `Stop-Service` → `git pull` → `pnpm install --frozen-lockfile --package-import-method=copy` → `pnpm build` → `Start-Service` → Health-Prüfung und Versionsanzeige. Der Dienst wird vorher gestoppt, weil geladene native Module (`.node`-Dateien) gesperrt sind. Migrationen laufen beim Start mit Vorab-Backup. Offene Clients zeigen „Neue Version verfügbar“ (F-36).
- **Rückweg:** `git checkout <vorheriger Tag>`, `pnpm install --frozen-lockfile --package-import-method=copy`, `pnpm build`, das passende `pre-migration-NNN.sqlite` zurückkopieren (Schritte wie bei der Wiederherstellung).
- **pnpm-Upgrade** (z. B. auf 12.x): nur als bewusster Schritt über das Feld `packageManager`, mit `pnpm verify` und einer Testinstallation unter LocalService.
- **Deinstallation:** `deploy\uninstall.ps1` entfernt Dienst und Firewall-Regel; `data\` bleibt unangetastet.

### 10.11 Fehlerbehebung

| Symptom | Wahrscheinliche Ursache | Lösung |
|---|---|---|
| Handy lädt nicht, PC selbst schon | Netzprofil „Öffentlich“, Firewall-Regel fehlt | Profil auf Privat stellen; `Get-NetFirewallRule -DisplayName RezepteApp` |
| Handy lädt nicht, obwohl die Regel da ist | Block-Regel für `node.exe` aus einem früheren Firewall-Dialog | `install.ps1` erneut ausführen oder Block-Regel „Node.js JavaScript Runtime“ in der Windows-Firewall deaktivieren |
| `.local` funktioniert nicht | mDNS per Richtlinie aus, Router blockiert Multicast, Android mit festem „Privates DNS“ | IP oder QR-Code verwenden; DHCP-Reservierung; Android: Einstellungen → Netzwerk → Privates DNS auf „Automatisch“ oder „Aus“ |
| Früher gespeicherte Adresse geht nicht mehr | IP hat sich geändert | DHCP-Reservierung; neuen QR-Code scannen |
| Seite „Falsche Adresse“ (421) | Aufruf über einen nicht erlaubten Hostnamen | Angezeigte URL verwenden oder Namen in `ALLOWED_HOSTS` eintragen |
| Chrome zeigt eine Warnseite | „Immer sichere Verbindungen“ für alle Websites aktiv | „Trotzdem fortfahren“ oder die Einstellung auf Standard zurücksetzen; Adresse mit `http://` eingeben |
| Dienst startet nicht: „Port belegt“ | Anderes Programm auf 8080 | Anderen Port wählen (`install.ps1 -Port …`) |
| Dienst startet nicht: „Port reserviert“ | Hyper-V, WSL2 oder Docker reservieren Portbereiche (`netsh int ipv4 show excludedportrange protocol=tcp`) | Port außerhalb der Bereiche wählen |
| Dienst startet nicht (sonstiges) | Datenordner nicht beschreibbar, Node unter dem Benutzerprofil | Meldung in `data\logs`; `install.ps1` erneut ausführen |
| `update.ps1` bricht bei `git pull` mit „detected dubious ownership“ ab | Repository als Administrator geklont, Update ohne Adminrechte (oder umgekehrt) | `update.ps1` als Administrator ausführen; `git config --global --add safe.directory C:/RezepteApp/app` |
| Upload scheitert mit „Bildverarbeitung nicht verfügbar“ | sharp lädt nicht (Node-Version, fehlende Rechte) | `pnpm install --frozen-lockfile --package-import-method=copy` erneut; Status-Seite prüfen |
| Handy-Foto wird abgelehnt | HEIC/HEIF-Datei (iPhone per Dateien-App, Android mit HEIF-Kameraeinstellung) | iPhone: Einstellungen > Kamera > Formate > Maximale Kompatibilität; Android: HEIF in der Kamera-App ausschalten |
| Banner „Datenbank beschädigt“ | Stromausfall, Datenträgerfehler, Cloud-Sync auf der Live-DB | Wiederherstellung nach 10.9 |

---

## 11. Risiken und Gegenmaßnahmen

| Nr. | Risiko | W | A | Gegenmaßnahme |
|---|---|---|---|---|
| R1 | Native Module (better-sqlite3, sharp) laden nach einem Node-Majorwechsel nicht (ABI/N-API-Kompatibilität) oder sind für das Dienstkonto nicht lesbar | niedrig | hoch | Node 24 in `engines` und `.nvmrc` pinnen; Node-Majorwechsel nur mit Testinstallation unter LocalService; Ladeprüfung in M0 und beim Start; eingeschränkter Betrieb bei sharp-Fehler (NF-24); `server/db/connection.ts` erlaubt einen Wechsel auf `node:sqlite` (enthält FTS5), sobald es stabil ist |
| R2 | Das Dienstkonto kann Node oder Module nicht lesen (Node im Benutzerprofil, pnpm-Hardlinks aus dem Store) | mittel | hoch | Node maschinenweit; `package-import-method=copy` in `.npmrc` und in allen Skripten; ACLs; `install.ps1` prüft die Health des laufenden Dienstes (NF-22) |
| R3 | Handys finden den Server nicht (Netzprofil, IP-Wechsel, `.local`, mDNS aus, Block-Regeln) | hoch | mittel | QR-Code mit IP, DHCP-Reservierung, Host-Prüfung ohne feste IP-Liste, Netzprofil-, mDNS- und Block-Regel-Prüfung im Installer, Fehlerbehebungstabelle |
| R4 | Browser verschärfen den Umgang mit http (Chrome 154 „Immer sichere Verbindungen“) | mittel | mittel | Private Adressen sind laut Ankündigung ausgenommen; `http://` explizit in QR und Doku; HTTPS-Optionen B/C in 10.7 dokumentiert |
| R5 | iOS-Verknüpfung mit eigenem Speicher: Profil und Entwürfe fehlen dort | hoch | niedrig | Profilwahl mit einem Fingertipp (F-02); Hinweis in der Verbinden-Anleitung (F-37) |
| R6 | Handy liefert HEIC/HEIF | niedrig | mittel | `accept="image/jpeg"` bei der Kamera löst die iOS-Konvertierung aus; Server-415 mit geräteneutralem Hinweis; Gerätetest in M3 |
| R7 | Kein Wake Lock über http, der Bildschirm geht beim Kochen aus | hoch | niedrig | Ehrlicher Hinweis; Kochmodus nur Kann; experimenteller Schalter; HTTPS-Pfad dokumentiert |
| R8 | Suche erfüllt Erwartungen nicht (Tippfehler, Komposita, Schreibvarianten) | mittel | mittel | Präfix + Teilwort + ae/oe/ue-Varianten + „Meintest du“; ≥ 30 Normalisierungs- und Suchtests mit deutschen Wörtern; Trigram im Backlog |
| R9 | Scope-Creep wie im Prototyp v1 (Einkaufsliste, Wochenplan, Kann-Funktionen vorziehen) | hoch | hoch | Backlog explizit; Muss nur für den Kern (F-41, F-43, F-44 als Soll); Kann erst nach Abnahme aller Muss/Soll; jeder Meilenstein mit handynutzbarer DoD |
| R10 | Design-Freigabe verzögert die UI-Arbeit | mittel | mittel | M0 parallel zu M1; M1 zeitlich begrenzt; Entscheidungen des Nutzers als klare Auswahl vorbereiten |
| R11 | Design sprengt die Budgets (Schriften, Bilder, Effekte) | mittel | mittel | Budgets als Vorgabe im Design-Schritt; Size-Check im Build; Token-Blatt mit Dateigrößen und Bildvarianten |
| R12 | Bundle wächst schleichend („nur eine kleine Bibliothek“) | mittel | mittel | Size-Check in CI (NF-01); Abhängigkeiten nur mit ADR (NF-02) |
| R13 | Gleichzeitiges Bearbeiten überschreibt Änderungen | niedrig | mittel | Serverseitige Version mit 409 und Konfliktdialog ohne Datenverlust; Tag-Änderungen erhöhen die Version; Überschreiben nur mit `force` (F-07, F-19) |
| R14 | Datenverlust (versehentliches Löschen, Plattendefekt, Stromausfall) | mittel | hoch | Papierkorb 30 Tage, tägliche Backups mit Nachholen, Bilddateien 14 Tage in `.trash`, WAL, `quick_check` und Nur-Lese-Modus, externe Kopie empfohlen, Wiederherstellung real getestet |
| R15 | Cloud-Sync (OneDrive) auf der Live-DB beschädigt Daten | mittel | hoch | Datenordner außerhalb von OneDrive; Prüfung im Installer; nur `backups\` und `images\` synchronisieren |
| R16 | PC schläft oder startet nach einem Update nicht vollständig | mittel | mittel | Energieoptionen/`-KeepAwake`; Dienst Automatisch; Banner „Server nicht erreichbar“; monatliche Kurzprüfung |
| R17 | Hängender Prozess wird nicht neu gestartet | niedrig | mittel | Kurze synchrone Operationen, Timeouts, Warteschlange für Bilder; Watchdog im Backlog |
| R18 | Gäste oder Kinder im WLAN ändern oder löschen Daten | mittel | niedrig | Vertrauensmodell dokumentiert, Gäste-WLAN empfohlen, Papierkorb und Backups; Admin-PIN im Backlog |
| R19 | Werkzeugumbrüche (TypeScript 7, Vite-Majors, Vitest 5, pnpm 12) brechen den Build | mittel | niedrig | Lockfile, TypeScript 6 und pnpm 10 gepinnt, Upgrades gezielt pro Quartal mit `pnpm verify` |
| R20 | sauberes Beenden scheitert, weil Strg+C unter WinSW nicht ankommt | niedrig | mittel | Realer Test in M6 (NF-24); Plan B mit Shutdown-Endpunkt über `<stopexecutable>`; WAL ist auch nach einem Kill konsistent (NF-19) |

W = Wahrscheinlichkeit, A = Auswirkung.

---

## 12. Annahmen und offene Punkte

Bitte bestätigen oder korrigieren; der Vorschlag gilt, bis der Nutzer ihn ändert.

| Nr. | Annahme / Frage | Vorschlag | Auswirkung, wenn anders |
|---|---|---|---|
| A1 | Zutaten sind strukturiert (Menge, Einheit, Name, Notiz, Gruppe), obwohl sie nicht ausdrücklich genannt wurden | Ja, Muss (F-10) | Freitext-Zutaten würden Skalierung und Einkaufsliste später verhindern |
| A2 | Ein Bild je Rezept genügt für Release 1.0 | Ja; mehrere Bilder im Backlog | Mehrere Bilder: +1–2 PT (Galerie, Sortierung) |
| A3 | Bewertungen sind für alle sichtbar (Durchschnitt und Einzelbewertungen mit Namen) | Ja (F-27) | Nur eigene Bewertung sichtbar: kleine UI-Änderung |
| A4 | Jedes Profil darf jedes Rezept bearbeiten und löschen | Ja, abgesichert durch Papierkorb und Backups | „Nur Autor darf löschen“ widerspräche „ohne Passwort“ |
| A5 | Portionsskalierung und Kochmodus sind Kann, weil sie nicht im genannten Umfang liegen | Kann (F-13, F-31) | Anhebung auf Soll: je ~1 PT; eine Anhebung 17–22 PT, beide 18–23 PT |
| A6 | Reines HTTP ist akzeptiert (kein Offline, kein Wake Lock, Hinweis „Nicht sicher“) | Ja (Kap. 10.7) | HTTPS in Release 1.0: +1–2 PT und Einrichtung je Gerät (Option B) bzw. eigene Domain (Option C) |
| A7 | Port 8080, Ordner `C:\RezepteApp`, Dienstname „RezepteApp“ | Ja, alles konfigurierbar | – |
| A8 | Der Server-PC läuft dauerhaft; Node.js 24 wird maschinenweit installiert; Adminrechte stehen einmalig und für Updates zur Verfügung | Ja | Ohne Adminrechte keine Firewall-Regel und kein Dienst |
| A9 | Zielgeräte: welche konkreten Modelle (Android-Handy, iPhone, iPad) stehen für die Abnahme zur Verfügung? | Mindestens Android 12+, iOS/iPadOS 17+ | Ältere Geräte: ggf. Hinweisseite statt Unterstützung |
| A10 | Start-Tags (10 Stück, F-20) | Liste wie in F-20 | Andere Liste: nur Konfiguration |
| A11 | Papierkorb 30 Tage, 14 tägliche Backups, 5 manuelle, 5 pre-migration, Bilddateien 14 Tage in `.trash` | Ja | Nur Konfiguration |
| A12 | Export ohne Import in Release 1.0; Export ist Soll | Ja; Wiederherstellung per Dateikopie | Import in Release 1.0: +1–1,5 PT |
| A13 | Standardsortierung ohne Suchbegriff | „Neueste“ | „Titel A–Z“ oder „Zuletzt geändert“: nur Konfiguration |
| A14 | Schriftwahl, Icon-Set, Kartenformat und Bildvarianten fallen im Design-Schritt (M1) innerhalb der Vorgaben | Ja | – |
| A15 | Gäste im WLAN dürfen ein Profil anlegen und alles nutzen | Ja; Gäste-WLAN empfohlen | Einschränkung bräuchte einen PIN (Backlog) |
| A16 | Wohin sollen externe Backup-Kopien gehen (NAS, USB-Datenträger, keine)? | NAS oder USB wöchentlich per Skriptvorlage | Ohne externe Kopie bleibt ein Plattendefekt ein Totalverlust |
| A17 | Computername des Server-PCs (bestimmt die `.local`-Adresse und den Standard für `ALLOWED_HOSTS`) | z. B. `kueche-pc` | – |
| A18 | Obergrenzen: 120 Zeichen Titel, 20 Tags je Rezept, 200 Zutaten, 100 Zubereitungsschritte, 20 MiB und 60 MP Upload | Ja | Nur Konstanten in `shared/constants.ts` |
| A19 | Soll im Dark Mode eine gedämpfte Chip-Fläche statt Moonstone erlaubt sein? Die Nutzervorgabe lautet „Moonstone nur als Fläche mit dunklem Text“ | Nein; Moonstone bleibt in beiden Modi Fläche mit #231F20 (7,72:1) | Abweichende Chip-Fläche nur nach ausdrücklicher Entscheidung des Nutzers, dann als eigenes Token mit Kontrastpaar |
| A20 | UI-Texte duzen durchgängig (Familien-App) | Ja (NF-10) | Siezen: nur Texte in `de.ts` |
