// Pure helpers of the M2 screens (client/src/lib/screens.ts): footer "angelegt von … am …" (F-29),
// remaining trash days (F-08), ingredient groups (F-10), source links (F-29, NF-21), 410 details (F-33).
import { describe, expect, it } from 'vitest';
import { ds } from '../../client/src/i18n/de-screens.ts';
import { dl } from '../../client/src/i18n/de-screens-lazy.ts';
import {
  footerText,
  formatUptime,
  groupIngredients,
  onDate,
  parseInTrash,
  personName,
  remainingDays,
  sourceHref,
} from '../../client/src/lib/screens.ts';
import type { IngredientDetail } from '../../shared/types.ts';

// Local noon avoids calendar edge cases in every time zone the tests may run in.
const NOW = new Date(2026, 8, 23, 12, 0, 0);

function localIso(year: number, month: number, day: number, hour = 10): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

describe('personName (F-04, F-29)', () => {
  it('shows the name, or "unbekannt" for a deleted profile', () => {
    expect(personName({ id: 1, name: 'Anna' })).toBe('Anna');
    expect(personName(null)).toBe('unbekannt');
  });
});

describe('onDate (NF-10)', () => {
  it('puts "am" before an absolute date only', () => {
    expect(onDate(localIso(2026, 3, 12), NOW)).toBe('am 12.03.2026');
    expect(onDate(localIso(2026, 9, 23, 8), NOW)).toBe('heute');
    expect(onDate(localIso(2026, 9, 22), NOW)).toBe('gestern');
    expect(onDate(localIso(2026, 9, 20), NOW)).toBe('vor 3 Tagen');
  });
});

describe('footerText (F-29)', () => {
  it('names author and last editor with their dates', () => {
    const text = footerText(
      {
        createdBy: { id: 1, name: 'Sebastian' },
        createdAt: localIso(2026, 3, 12),
        updatedBy: { id: 2, name: 'Anna' },
        updatedAt: localIso(2026, 9, 20),
      },
      NOW,
    );
    expect(text).toBe('Angelegt von Sebastian am 12.03.2026 · geändert von Anna vor 3 Tagen');
  });

  it('shows "unbekannt" for deleted profiles and never "null"', () => {
    const text = footerText(
      {
        createdBy: null,
        createdAt: localIso(2026, 3, 12),
        updatedBy: null,
        updatedAt: localIso(2026, 3, 14),
      },
      NOW,
    );
    expect(text).toBe('Angelegt von unbekannt am 12.03.2026 · geändert von unbekannt am 14.03.2026');
    expect(text).not.toContain('null');
  });

  it('omits the change part while the recipe is unchanged', () => {
    const at = localIso(2026, 9, 23, 9);
    expect(
      footerText({ createdBy: { id: 1, name: 'Anna' }, createdAt: at, updatedBy: null, updatedAt: at }, NOW),
    ).toBe('Angelegt von Anna heute');
  });
});

describe('remainingDays (F-08 Resttage)', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('counts whole days up to the purge, rounded up', () => {
    expect(remainingDays('2026-10-23T12:00:00.000Z', now)).toBe(30);
    expect(remainingDays('2026-10-23T11:59:59.000Z', now)).toBe(30);
    expect(remainingDays('2026-09-24T12:00:00.000Z', now)).toBe(1);
    expect(remainingDays('2026-09-23T18:00:00.000Z', now)).toBe(1);
  });

  it('is 0 when the purge is due or the date is unreadable', () => {
    expect(remainingDays('2026-09-23T12:00:00.000Z', now)).toBe(0);
    expect(remainingDays('2026-09-01T00:00:00.000Z', now)).toBe(0);
    expect(remainingDays('kein Datum', now)).toBe(0);
  });

  it('has matching texts', () => {
    expect(dl.trash.remaining(30)).toBe('noch 30 Tage');
    expect(dl.trash.remaining(1)).toBe('noch 1 Tag');
    expect(dl.trash.remaining(0)).toBe('wird heute endgültig gelöscht');
  });
});

describe('groupIngredients (F-10, F-29)', () => {
  const ing = (id: number, group: string, name: string): IngredientDetail => ({
    id,
    group,
    amount: null,
    amountMax: null,
    unit: '',
    name,
    note: '',
  });

  it('keeps the order and starts a section at every group change', () => {
    const groups = groupIngredients([
      ing(1, '', 'Salz'),
      ing(2, 'Für den Teig', 'Mehl'),
      ing(3, 'Für den Teig', 'Eier'),
      ing(4, 'Für die Soße', 'Sahne'),
    ]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.name)])).toEqual([
      ['', ['Salz']],
      ['Für den Teig', ['Mehl', 'Eier']],
      ['Für die Soße', ['Sahne']],
    ]);
  });

  it('treats blank group names as "no heading"', () => {
    expect(groupIngredients([ing(1, '  ', 'Pfeffer')])).toEqual([
      { group: '', items: [ing(1, '  ', 'Pfeffer')] },
    ]);
    expect(groupIngredients([])).toEqual([]);
  });
});

describe('sourceHref (F-29 AK, NF-21)', () => {
  it('links only http and https sources', () => {
    expect(sourceHref('https://example.org/rezept')).toBe('https://example.org/rezept');
    expect(sourceHref('  http://example.org/a b ')).toBe('http://example.org/a%20b');
    expect(sourceHref('Omas Kochbuch S. 12')).toBeNull();
    expect(sourceHref('javascript:alert(1)')).toBeNull();
    expect(sourceHref('JAVASCRIPT://example.org/%0Aalert(1)')).toBeNull();
    expect(sourceHref('https://')).toBeNull();
    expect(sourceHref('')).toBeNull();
  });
});

describe('parseInTrash (410 IN_TRASH details, F-33)', () => {
  it('reads deletedAt and deletedBy', () => {
    expect(
      parseInTrash({ deletedAt: '2026-09-20T10:00:00.000Z', deletedBy: { id: 2, name: 'Anna' } }),
    ).toEqual({
      deletedAt: '2026-09-20T10:00:00.000Z',
      deletedBy: { id: 2, name: 'Anna' },
    });
    expect(parseInTrash({ deletedAt: '2026-09-20T10:00:00.000Z', deletedBy: null })).toEqual({
      deletedAt: '2026-09-20T10:00:00.000Z',
      deletedBy: null,
    });
  });

  it('rejects malformed details instead of trusting them', () => {
    expect(parseInTrash(undefined)).toBeNull();
    expect(parseInTrash('x')).toBeNull();
    expect(parseInTrash({ deletedBy: null })).toBeNull();
    expect(
      parseInTrash({ deletedAt: '2026-09-20T10:00:00.000Z', deletedBy: { id: '2', name: 'Anna' } }),
    ).toBeNull();
  });

  it('builds the detail text of F-33', () => {
    const info = parseInTrash({ deletedAt: localIso(2026, 3, 12), deletedBy: { id: 2, name: 'Anna' } });
    expect(info).not.toBeNull();
    if (!info) return;
    expect(dl.detail.inTrash(personName(info.deletedBy), onDate(info.deletedAt, NOW))).toBe(
      'Im Papierkorb (gelöscht von Anna am 12.03.2026)',
    );
  });
});

describe('formatUptime (status page)', () => {
  it('shows minutes, hours or days', () => {
    expect(formatUptime(30)).toBe('unter 1 min');
    expect(formatUptime(12 * 60)).toBe('12 min');
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(formatUptime(2 * 86400 + 4 * 3600)).toBe('2 Tage 4 h');
    expect(formatUptime(86400)).toBe('1 Tag 0 h');
  });
});

describe('list texts', () => {
  it('counts recipes with the German thousands separator', () => {
    expect(ds.list.count(1)).toBe('1 Rezept');
    expect(ds.list.count(38)).toBe('38 Rezepte');
    expect(ds.list.count(1000)).toBe('1.000 Rezepte');
  });

  it('use the texts required by the acceptance criteria', () => {
    expect(ds.list.emptyTitle).toBe('Noch keine Rezepte');
    expect(ds.list.emptyAction).toBe('Erstes Rezept anlegen');
    expect(ds.favorites.empty).toBe('Noch keine Favoriten – tippe bei einem Rezept auf das Herz');
    expect(dl.detail.deleted).toBe('Rezept gelöscht');
    expect(dl.trash.empty).toBe('Der Papierkorb ist leer');
    expect(dl.more.deleteText(3, 1)).toBe(
      'Dabei gehen 3 Bewertungen und 1 Favorit verloren. Die Rezepte bleiben erhalten.',
    );
  });
});
