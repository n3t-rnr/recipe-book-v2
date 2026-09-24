import type { ValidationDetail } from './error-codes.ts';

/** Minimal structural view of a zod issue, so this file does not import zod itself. */
interface IssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  expected?: string;
  format?: string;
}

const FIELD_NAMES: Record<string, string> = {
  title: 'Titel',
  name: 'Name',
  description: 'Beschreibung',
  servings: 'Portionen',
  servingsUnit: 'Portionseinheit',
  prepMinutes: 'Vorbereitungszeit',
  cookMinutes: 'Koch- oder Backzeit',
  source: 'Quelle',
  ingredients: 'Zutaten',
  steps: 'Zubereitungsschritte',
  tags: 'Tags',
  imageId: 'Bild',
  amount: 'Menge',
  amountMax: 'Obergrenze',
  unit: 'Einheit',
  note: 'Notiz',
  group: 'Gruppe',
  text: 'Schritt',
  version: 'Version',
  createKey: 'Anlageschlüssel',
  avatar: 'Farbe',
};

function label(path: PropertyKey[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i];
    if (typeof key === 'string' && FIELD_NAMES[key]) return FIELD_NAMES[key];
  }
  return 'Eingabe';
}

/** German message for one issue (NF-10). Custom refine messages are already German and kept. */
export function issueMessage(issue: IssueLike): string {
  const what = label(issue.path);
  const min = issue.minimum === undefined ? undefined : Number(issue.minimum);
  const max = issue.maximum === undefined ? undefined : Number(issue.maximum);
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string')
        return min === 1 ? `${what} darf nicht leer sein` : `${what} ist zu kurz`;
      if (issue.origin === 'array') return `${what}: mindestens ${min} nötig`;
      return `${what} muss mindestens ${String(min).replace('.', ',')} sein`;
    case 'too_big':
      if (issue.origin === 'string') return `${what} darf höchstens ${max} Zeichen lang sein`;
      if (issue.origin === 'array') return `${what}: höchstens ${max} erlaubt`;
      return `${what} darf höchstens ${String(max).replace('.', ',')} sein`;
    case 'invalid_type':
      return issue.expected === 'int'
        ? `${what} muss eine ganze Zahl sein`
        : `${what} hat ein ungültiges Format`;
    case 'invalid_format':
      return `${what} enthält unerlaubte Zeichen`;
    case 'invalid_value':
      return `${what} hat einen ungültigen Wert`;
    case 'custom':
      return issue.message;
    default:
      return `${what} ist ungültig`;
  }
}

/** Converts zod issues into the API's details format: [{ field: "ingredients.2.name", message }]. */
export function toValidationDetails(issues: readonly IssueLike[]): ValidationDetail[] {
  return issues.map((issue) => ({
    field: issue.path.map((p) => String(p)).join('.'),
    message: issueMessage(issue),
  }));
}
