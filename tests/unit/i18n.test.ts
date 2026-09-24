// NF-10: every server error code has a German text in de.ts; UI texts use the informal "du".
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_TEXTS } from '../../client/src/i18n/de.ts';
import { ERROR_CODES } from '../../shared/error-codes.ts';

const DE_SOURCE = fs.readFileSync(new URL('../../client/src/i18n/de.ts', import.meta.url), 'utf8');

describe('error texts (NF-10 AK)', () => {
  it('have a German text for every server error code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TEXTS[code], code).toBeTypeOf('string');
      expect(ERROR_TEXTS[code].trim().length, code).toBeGreaterThan(0);
    }
  });

  it('cover the client-side failures NETWORK and TIMEOUT (Kap. 6.6)', () => {
    expect(ERROR_TEXTS.NETWORK).toBe('Server nicht erreichbar – läuft der Rezepte-PC?');
    expect(ERROR_TEXTS.TIMEOUT).toBe('Das dauert zu lange');
  });

  it('contain no unknown codes', () => {
    const known = new Set<string>([...ERROR_CODES, 'NETWORK', 'TIMEOUT']);
    expect(Object.keys(ERROR_TEXTS).filter((code) => !known.has(code))).toEqual([]);
  });

  it('use the texts required by the acceptance criteria', () => {
    expect(ERROR_TEXTS.NAME_EXISTS).toBe('Name bereits vergeben');
    expect(ERROR_TEXTS.PROFILE_UNKNOWN).toBe('Profil nicht mehr vorhanden');
    expect(ERROR_TEXTS.READ_ONLY).toBe('Datenbank beschädigt – nur Lesen möglich');
  });
});

describe('de.ts wording (NF-10 AK)', () => {
  it('never uses the formal address ("Sie", "Ihre", "Meinten")', () => {
    const lines = DE_SOURCE.split(/\r?\n/);
    const hits = lines.flatMap((line, i) =>
      /\bSie\b|\bIhre[nmrs]?\b|\bIhnen\b|\bMeinten\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
    );
    expect(hits).toEqual([]);
  });

  it('uses typographic dashes and ellipses, no ASCII placeholders', () => {
    const strings = [...DE_SOURCE.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '');
    expect(strings.filter((s) => s.includes('...'))).toEqual([]);
    expect(strings.filter((s) => / - /.test(s))).toEqual([]);
  });
});
