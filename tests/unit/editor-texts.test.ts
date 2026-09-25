// NF-10 for the editor texts (client/src/i18n/de-editor.ts, loaded with the lazy editor chunk only):
// the same wording rules as tests/unit/i18n.test.ts applies to de.ts.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deEditor } from '../../client/src/i18n/de-editor.ts';

const SOURCE = fs.readFileSync(new URL('../../client/src/i18n/de-editor.ts', import.meta.url), 'utf8');

describe('de-editor.ts wording (NF-10 AK)', () => {
  it('never uses the formal address ("Sie", "Ihre", "Meinten")', () => {
    const hits = SOURCE.split(/\r?\n/).flatMap((line, i) =>
      /\bSie\b|\bIhre[nmrs]?\b|\bIhnen\b|\bMeinten\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
    );
    expect(hits).toEqual([]);
  });

  it('uses typographic dashes and ellipses, no ASCII placeholders', () => {
    const strings = [...SOURCE.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '');
    expect(strings.filter((s) => s.includes('...'))).toEqual([]);
    expect(strings.filter((s) => / - /.test(s))).toEqual([]);
  });

  it('uses the texts required by the acceptance criteria', () => {
    expect(deEditor.title.missing).toBe('Bitte gib einen Titel ein.');
    expect(deEditor.discard.title).toBe('Änderungen verwerfen?');
    expect(deEditor.conflict.title('Anna')).toBe('Inzwischen von Anna geändert');
    expect(deEditor.conflict.reload).toBe('Neu laden');
    expect(deEditor.conflict.force).toBe('Meine Version speichern');
    expect(deEditor.conflict.takeOver).toBe('Meine Änderung übernehmen');
    expect(deEditor.trash.title('Anna')).toBe(
      'Von Anna in den Papierkorb gelegt – wiederherstellen und speichern?',
    );
    expect(deEditor.draft.title('vom 12.03.2026, 18:00')).toBe(
      'Entwurf vom 12.03.2026, 18:00 wiederherstellen?',
    );
    expect(deEditor.saving.retry).toBe('Erneut versuchen');
  });

  it('uses the photo texts of F-14, F-09 and the artboards', () => {
    expect(deEditor.photo.take).toBe('Foto aufnehmen');
    expect(deEditor.photo.choose).toBe('Bild auswählen');
    expect(deEditor.photo.empty).toBe('Noch kein Foto');
    expect(deEditor.photo.emptyHint).toBe('Ohne Foto zeigt die App ein Platzhalterbild.');
    expect(deEditor.photo.tooLarge).toBe('Bild zu groß (max. 20 MB)');
    expect(deEditor.photo.gone).toBe('Foto nicht mehr vorhanden – bitte erneut aufnehmen');
    expect(deEditor.photo.retry).toBe('Erneut hochladen');
    // "Wird hochgeladen … 72 %" with a no-break space before the percent sign.
    expect(deEditor.photo.uploading(72)).toBe('Wird hochgeladen … 72 %');
  });

  it('uses the tag texts of F-17, F-18 and the artboard tagEditor()', () => {
    expect(deEditor.tags.placeholder).toBe('Tag hinzufügen …');
    expect(deEditor.tags.frequent).toBe('Häufig verwendet');
    expect(deEditor.tags.suggestions).toBe('Vorschläge');
    expect(deEditor.tags.hint).toBe(
      'Enter oder Komma fügt den Tag hinzu. Mit den Pfeiltasten wählst du einen Vorschlag.',
    );
    // A suggestion reads „Vegetarisch, 12 Rezepte“ (the chip shows „Vegetarisch 12“, F-18 AK1).
    expect(deEditor.tags.option('Vegetarisch', 12)).toBe('Vegetarisch, 12 Rezepte');
    expect(deEditor.tags.option('Vegan', 1)).toBe('Vegan, 1 Rezept');
    expect(deEditor.tags.option('Suppe', 0)).toBe('Suppe, 0 Rezepte');
    expect(deEditor.tags.add('Schnell')).toBe('Schnell hinzufügen');
    expect(deEditor.tags.added('Süßspeise')).toBe('Tag „Süßspeise“ hinzugefügt');
    expect(deEditor.tags.limit(20)).toBe('Höchstens 20 Tags pro Rezept');
  });

  it('lists the unit suggestions of F-10', () => {
    expect(deEditor.unitSuggestions).toEqual([
      'g',
      'kg',
      'ml',
      'l',
      'EL',
      'TL',
      'Stück',
      'Prise',
      'Bund',
      'Zehe',
      'Dose',
      'Packung',
      'Tasse',
      'Scheibe',
      'Msp.',
    ]);
  });
});
