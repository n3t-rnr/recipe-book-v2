/**
 * Test data (Kap. 9.3): deterministic German recipes for manual tests and the NF-04 benchmark.
 *
 *   pnpm seed [--count 1000] [--data-dir <dir>] [--force]
 *
 * Opens the database like server/main.ts (PRAGMAs, migrations) and refuses to touch a database
 * that already has recipes unless --force is given; with --force the data is added on top and
 * existing profiles or tags with the same name are reused. Stop the server first.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/config.ts';
import { closeDatabase, openDatabase } from '../server/db/connection.ts';
import { reindexAll } from '../server/db/fts.ts';
import { MIGRATIONS_DIR, runMigrations } from '../server/db/migrate.ts';
import { bumpDataRevision, setMeta } from '../server/db/repos/meta.ts';
import { allocateProfileId } from '../server/db/repos/profiles.ts';
import { allocateRecipeId } from '../server/db/repos/recipes.ts';
import type { DB } from '../server/db/types.ts';
import { createFileLogger } from '../server/log.ts';
import { dataPaths, ensureDataDirs } from '../server/paths.ts';
import { normalize } from '../shared/normalize.ts';
import type { AvatarToken } from '../shared/schemas.ts';

export interface SeedOptions {
  /** Number of recipes (default 1000). */
  count?: number;
  /** Reference time; all timestamps lie before it (default: now). */
  now?: Date;
  /** PRNG seed (default 42). Same seed, count and now → identical data. */
  seed?: number;
}

export interface SeedSummary {
  recipes: number;
  profiles: number;
  tags: number;
  ingredients: number;
  steps: number;
  ratings: number;
  favorites: number;
  indexed: number;
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness

/** mulberry32: tiny, fast and good enough for test data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** n distinct items in random order (partial Fisher-Yates). */
  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    const out: T[] = [];
    for (let i = 0; i < n && copy.length > 0; i++) {
      const [item] = copy.splice(Math.floor(this.next() * copy.length), 1);
      if (item !== undefined) out.push(item);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Word lists

type Kind = 'savory' | 'sweet';
/** Grammatical gender of the dish word, for the adjective ending (strong inflection, no article). */
type Gender = 'f' | 'm' | 'n' | 'pl';

interface Main {
  /** First part of the compound: "Kürbis" + "suppe". */
  prefix: string;
  ingredient: string;
  unit: string;
  amount: number;
  kinds: readonly Kind[];
}

interface Dish {
  word: string;
  gender: Gender;
  kind: Kind;
  /** Baked dishes get the ingredient groups "Für den Teig" / "Für den Belag". */
  baked?: boolean;
}

interface Pantry {
  name: string;
  unit: string;
  /** null = "nach Belieben", no amount. */
  amounts: readonly number[] | null;
}

const MAINS: readonly Main[] = [
  { prefix: 'Kürbis', ingredient: 'Hokkaido-Kürbis', unit: 'g', amount: 800, kinds: ['savory'] },
  { prefix: 'Käse', ingredient: 'Bergkäse', unit: 'g', amount: 200, kinds: ['savory'] },
  { prefix: 'Weißkohl', ingredient: 'Weißkohl', unit: 'g', amount: 500, kinds: ['savory'] },
  { prefix: 'Kartoffel', ingredient: 'Kartoffeln', unit: 'g', amount: 750, kinds: ['savory'] },
  { prefix: 'Tomaten', ingredient: 'Tomaten', unit: 'g', amount: 500, kinds: ['savory'] },
  { prefix: 'Zwiebel', ingredient: 'Zwiebeln', unit: '', amount: 4, kinds: ['savory'] },
  { prefix: 'Linsen', ingredient: 'rote Linsen', unit: 'g', amount: 250, kinds: ['savory'] },
  { prefix: 'Möhren', ingredient: 'Möhren', unit: 'g', amount: 400, kinds: ['savory'] },
  { prefix: 'Spinat', ingredient: 'Blattspinat', unit: 'g', amount: 300, kinds: ['savory'] },
  { prefix: 'Pilz', ingredient: 'Champignons', unit: 'g', amount: 400, kinds: ['savory'] },
  { prefix: 'Brokkoli', ingredient: 'Brokkoli', unit: 'g', amount: 500, kinds: ['savory'] },
  { prefix: 'Zucchini', ingredient: 'Zucchini', unit: '', amount: 2, kinds: ['savory'] },
  { prefix: 'Bärlauch', ingredient: 'Bärlauch', unit: 'Bund', amount: 1, kinds: ['savory'] },
  { prefix: 'Hähnchen', ingredient: 'Hähnchenbrust', unit: 'g', amount: 400, kinds: ['savory'] },
  { prefix: 'Lachs', ingredient: 'Lachsfilet', unit: 'g', amount: 300, kinds: ['savory'] },
  { prefix: 'Grünkohl', ingredient: 'Grünkohl', unit: 'g', amount: 600, kinds: ['savory'] },
  { prefix: 'Rotkohl', ingredient: 'Rotkohl', unit: 'g', amount: 500, kinds: ['savory'] },
  { prefix: 'Spargel', ingredient: 'weißer Spargel', unit: 'g', amount: 500, kinds: ['savory'] },
  { prefix: 'Blumenkohl', ingredient: 'Blumenkohl', unit: '', amount: 1, kinds: ['savory'] },
  { prefix: 'Süßkartoffel', ingredient: 'Süßkartoffeln', unit: 'g', amount: 600, kinds: ['savory'] },
  { prefix: 'Paprika', ingredient: 'rote Paprika', unit: '', amount: 2, kinds: ['savory'] },
  { prefix: 'Lauch', ingredient: 'Lauch', unit: 'Stangen', amount: 2, kinds: ['savory'] },
  { prefix: 'Erbsen', ingredient: 'Erbsen (TK)', unit: 'g', amount: 300, kinds: ['savory'] },
  { prefix: 'Sellerie', ingredient: 'Knollensellerie', unit: 'g', amount: 400, kinds: ['savory'] },
  { prefix: 'Apfel', ingredient: 'Äpfel', unit: '', amount: 4, kinds: ['sweet'] },
  { prefix: 'Rhabarber', ingredient: 'Rhabarber', unit: 'g', amount: 500, kinds: ['sweet'] },
  { prefix: 'Erdbeer', ingredient: 'Erdbeeren', unit: 'g', amount: 500, kinds: ['sweet'] },
  { prefix: 'Pflaumen', ingredient: 'Pflaumen', unit: 'g', amount: 750, kinds: ['sweet'] },
  { prefix: 'Kirsch', ingredient: 'Sauerkirschen', unit: 'g', amount: 400, kinds: ['sweet'] },
  { prefix: 'Mohn', ingredient: 'gemahlener Mohn', unit: 'g', amount: 150, kinds: ['sweet'] },
  { prefix: 'Nuss', ingredient: 'gemahlene Haselnüsse', unit: 'g', amount: 150, kinds: ['sweet'] },
  { prefix: 'Schoko', ingredient: 'Zartbitterschokolade', unit: 'g', amount: 200, kinds: ['sweet'] },
  { prefix: 'Quark', ingredient: 'Magerquark', unit: 'g', amount: 500, kinds: ['sweet'] },
  { prefix: 'Zitronen', ingredient: 'Bio-Zitronen', unit: '', amount: 2, kinds: ['sweet'] },
  { prefix: 'Himbeer', ingredient: 'Himbeeren', unit: 'g', amount: 300, kinds: ['sweet'] },
  { prefix: 'Birnen', ingredient: 'Birnen', unit: '', amount: 3, kinds: ['sweet'] },
  { prefix: 'Käse', ingredient: 'Magerquark', unit: 'g', amount: 750, kinds: ['sweet'] },
];

const DISHES: readonly Dish[] = [
  { word: 'suppe', gender: 'f', kind: 'savory' },
  { word: 'salat', gender: 'm', kind: 'savory' },
  { word: 'auflauf', gender: 'm', kind: 'savory' },
  { word: 'eintopf', gender: 'm', kind: 'savory' },
  { word: 'pfanne', gender: 'f', kind: 'savory' },
  { word: 'gratin', gender: 'n', kind: 'savory' },
  { word: 'quiche', gender: 'f', kind: 'savory', baked: true },
  { word: 'risotto', gender: 'n', kind: 'savory' },
  { word: 'curry', gender: 'n', kind: 'savory' },
  { word: 'püree', gender: 'n', kind: 'savory' },
  { word: 'bratlinge', gender: 'pl', kind: 'savory' },
  { word: 'lasagne', gender: 'f', kind: 'savory' },
  { word: 'spätzle', gender: 'pl', kind: 'savory' },
  { word: 'knödel', gender: 'pl', kind: 'savory' },
  { word: 'strudel', gender: 'm', kind: 'savory', baked: true },
  { word: 'kuchen', gender: 'm', kind: 'sweet', baked: true },
  { word: 'torte', gender: 'f', kind: 'sweet', baked: true },
  { word: 'strudel', gender: 'm', kind: 'sweet', baked: true },
  { word: 'muffins', gender: 'pl', kind: 'sweet', baked: true },
  { word: 'crumble', gender: 'm', kind: 'sweet' },
  { word: 'kompott', gender: 'n', kind: 'sweet' },
  { word: 'tarte', gender: 'f', kind: 'sweet', baked: true },
  { word: 'creme', gender: 'f', kind: 'sweet' },
  { word: 'pfannkuchen', gender: 'pl', kind: 'sweet' },
  { word: 'schnitten', gender: 'pl', kind: 'sweet', baked: true },
];

/** Adjective stems; the ending follows the dish gender ("Schnelle Kürbissuppe", "Feiner Apfelstrudel"). */
const ADJECTIVES = [
  'schnell',
  'fein',
  'klassisch',
  'rustikal',
  'leicht',
  'einfach',
  'schwäbisch',
  'bayerisch',
  'fränkisch',
  'badisch',
  'hausgemacht',
  'herbstlich',
  'sommerlich',
  'würzig',
  'cremig',
];
const ENDINGS: Record<Gender, string> = { f: 'e', m: 'er', n: 'es', pl: 'e' };
const OWNERS = ['Omas', 'Opas', 'Tante Hildes', 'Michaels', 'Jürgens'];
const EXTRAS: Record<Kind, readonly string[]> = {
  savory: [
    'Ingwer',
    'Feta',
    'Speck',
    'Kräuterquark',
    'Röstzwiebeln',
    'Walnüssen',
    'Schmand',
    'Crème fraîche',
  ],
  sweet: ['Streuseln', 'Vanillesoße', 'Sahnehaube', 'Zimt', 'Mandeln', 'Baiser', 'Puderzucker'],
};

/** Fixed first titles, so the search examples of F-21 to F-23 and F-26 always exist. */
const ANCHORS: readonly { title: string; main: string; dish: string; kind: Kind }[] = [
  { title: 'Kürbissuppe', main: 'Kürbis', dish: 'suppe', kind: 'savory' },
  { title: 'Käsekuchen', main: 'Käse', dish: 'kuchen', kind: 'sweet' },
  { title: 'Weißkohlsalat', main: 'Weißkohl', dish: 'salat', kind: 'savory' },
  { title: 'Apfelstrudel', main: 'Apfel', dish: 'strudel', kind: 'sweet' },
  { title: 'Käsespätzle', main: 'Käse', dish: 'spätzle', kind: 'savory' },
  { title: 'Tomatensuppe', main: 'Tomaten', dish: 'suppe', kind: 'savory' },
  { title: 'Zwiebelkuchen', main: 'Zwiebel', dish: 'quiche', kind: 'savory' },
  { title: 'Crème brûlée', main: 'Quark', dish: 'creme', kind: 'sweet' },
  { title: 'Michaels Nudeln', main: 'Tomaten', dish: 'pfanne', kind: 'savory' },
  { title: 'Lasagne', main: 'Tomaten', dish: 'lasagne', kind: 'savory' },
  { title: 'Süßspeise mit Äpfeln', main: 'Apfel', dish: 'kompott', kind: 'sweet' },
];

const PANTRY: Record<Kind, readonly Pantry[]> = {
  savory: [
    { name: 'Zwiebeln', unit: '', amounts: [1, 2] },
    { name: 'Knoblauchzehen', unit: '', amounts: [2, 3] },
    { name: 'Olivenöl', unit: 'EL', amounts: [2, 3] },
    { name: 'Butter', unit: 'g', amounts: [20, 30, 50] },
    { name: 'Gemüsebrühe', unit: 'ml', amounts: [250, 500, 750] },
    { name: 'Sahne', unit: 'ml', amounts: [100, 200] },
    { name: 'Crème fraîche', unit: 'g', amounts: [150, 200] },
    { name: 'Parmesankäse', unit: 'g', amounts: [50, 80] },
    { name: 'Petersilie', unit: 'Bund', amounts: [1] },
    { name: 'Schnittlauch', unit: 'Bund', amounts: [1] },
    { name: 'Dill', unit: 'Bund', amounts: [1] },
    { name: 'Thymian', unit: 'Zweige', amounts: [2, 3] },
    { name: 'Lorbeerblätter', unit: '', amounts: [2] },
    { name: 'Tomatenmark', unit: 'EL', amounts: [1, 2] },
    { name: 'Weißwein', unit: 'ml', amounts: [100] },
    { name: 'Speckwürfel', unit: 'g', amounts: [100, 150] },
    { name: 'Senf', unit: 'TL', amounts: [1, 2] },
    { name: 'Paprikapulver', unit: 'TL', amounts: [1] },
    { name: 'Kümmel', unit: 'TL', amounts: [1] },
    { name: 'Muskatnuss', unit: '', amounts: null },
    { name: 'Salz', unit: '', amounts: null },
    { name: 'Pfeffer', unit: '', amounts: null },
    { name: 'Ingwer', unit: 'g', amounts: [20, 30] },
    { name: 'Kokosmilch', unit: 'ml', amounts: [400] },
    { name: 'Currypaste', unit: 'EL', amounts: [1, 2] },
    { name: 'Frühlingszwiebeln', unit: '', amounts: [2, 3] },
    { name: 'Eier', unit: '', amounts: [2, 3] },
    { name: 'Mehl', unit: 'g', amounts: [50, 100] },
    { name: 'Milch', unit: 'ml', amounts: [200, 250] },
    { name: 'Weißweinessig', unit: 'EL', amounts: [2] },
    { name: 'Honig', unit: 'TL', amounts: [1, 2] },
    { name: 'Chiliflocken', unit: 'Prise', amounts: [1] },
    { name: 'Schafskäse', unit: 'g', amounts: [150, 200] },
    { name: 'Kichererbsen', unit: 'g', amounts: [400] },
    { name: 'Sojasoße', unit: 'EL', amounts: [2, 3] },
    { name: 'Gouda', unit: 'g', amounts: [100, 150] },
  ],
  sweet: [
    { name: 'Mehl', unit: 'g', amounts: [200, 250, 300] },
    { name: 'Zucker', unit: 'g', amounts: [75, 100, 150] },
    { name: 'Butter', unit: 'g', amounts: [100, 125, 200] },
    { name: 'Eier', unit: '', amounts: [2, 3, 4] },
    { name: 'Milch', unit: 'ml', amounts: [100, 250] },
    { name: 'Backpulver', unit: 'Päckchen', amounts: [1] },
    { name: 'Vanillezucker', unit: 'Päckchen', amounts: [1] },
    { name: 'Salz', unit: 'Prise', amounts: [1] },
    { name: 'Zimt', unit: 'TL', amounts: [1] },
    { name: 'Sahne', unit: 'ml', amounts: [200] },
    { name: 'Puderzucker', unit: 'EL', amounts: [2, 3] },
    { name: 'gemahlene Mandeln', unit: 'g', amounts: [50, 100] },
    { name: 'Rosinen', unit: 'g', amounts: [50] },
    { name: 'Zitronenabrieb', unit: 'TL', amounts: [1] },
    { name: 'Speisestärke', unit: 'EL', amounts: [2] },
    { name: 'Trockenhefe', unit: 'Päckchen', amounts: [1] },
    { name: 'Haferflocken', unit: 'g', amounts: [100] },
    { name: 'Honig', unit: 'EL', amounts: [2] },
    { name: 'Schmand', unit: 'g', amounts: [200] },
    { name: 'brauner Zucker', unit: 'g', amounts: [50] },
    { name: 'Kakaopulver', unit: 'EL', amounts: [2] },
    { name: 'Naturjoghurt', unit: 'g', amounts: [150] },
    { name: 'Rum', unit: 'EL', amounts: [2] },
    { name: 'Walnüsse', unit: 'g', amounts: [50] },
  ],
};

const NOTES = ['fein gehackt', 'gewürfelt', 'zimmerwarm', 'gerieben', 'geschält', 'nach Belieben'];
const HERBS = ['Petersilie', 'Schnittlauch', 'Dill', 'Kresse', 'Basilikum'];
const LIQUIDS = ['Gemüsebrühe', 'Weißwein', 'Sahne', 'Wasser'];
const SPICES = ['Muskatnuss', 'Paprikapulver', 'Kümmel', 'Zitronensaft', 'Chiliflocken', 'Majoran'];

const STEPS: Record<Kind, readonly string[]> = {
  savory: [
    'Den Backofen auf {temp} °C Ober-/Unterhitze vorheizen.',
    '{main} waschen, putzen und in mundgerechte Stücke schneiden.',
    'Zwiebeln und Knoblauch schälen und fein würfeln.',
    'In einem großen Topf etwas Öl erhitzen und die Zwiebeln darin glasig dünsten.',
    '{main} dazugeben und etwa {min} Minuten unter Rühren anbraten.',
    'Mit {liquid} ablöschen und zugedeckt {min} Minuten köcheln lassen.',
    'Mit Salz, Pfeffer und etwas {spice} kräftig abschmecken.',
    '{b} unterheben und alles kurz ziehen lassen.',
    'In eine gefettete Auflaufform füllen und {min} Minuten goldbraun überbacken.',
    'Auf vorgewärmten Tellern anrichten und mit {herb} bestreuen.',
  ],
  sweet: [
    'Den Backofen auf {temp} °C Umluft vorheizen und die Form einfetten.',
    '{a}, {b} und {c} in einer Schüssel gründlich verrühren.',
    'Die Eier nacheinander unterrühren, bis ein glatter Teig entsteht.',
    '{main} waschen, trocken tupfen und in Stücke schneiden.',
    'Den Teig in die Form geben und glatt streichen.',
    '{main} gleichmäßig darauf verteilen und leicht andrücken.',
    'Im Ofen etwa {min} Minuten backen, bis die Oberfläche goldbraun ist.',
    'Stäbchenprobe machen und bei Bedarf noch einige Minuten weiterbacken.',
    'Vollständig auskühlen lassen und mit Puderzucker bestäuben.',
    'Dazu passt geschlagene Sahne oder eine Kugel Vanilleeis.',
  ],
};

const DESCRIPTIONS = [
  '',
  '',
  'Ein schnelles Gericht für jeden Tag.',
  'Schmeckt am nächsten Tag noch besser.',
  'Rezept von Oma, leicht abgewandelt.',
  'Perfekt für kalte Herbstabende.',
  'Lässt sich gut vorbereiten und einfrieren.',
  'Kommt bei Kindern immer gut an.',
  'Für Gäste einfach die doppelte Menge nehmen.',
];

/** 40 tags (Kap. 9.3: "3 Tags aus 40"). */
const TAGS = [
  'Vegetarisch',
  'Vegan',
  'Schnell',
  'Einfach',
  'Dessert',
  'Frühstück',
  'Mittagessen',
  'Abendessen',
  'Suppe',
  'Salat',
  'Backen',
  'Kuchen',
  'Brot',
  'Hauptgericht',
  'Beilage',
  'Snack',
  'Party',
  'Weihnachten',
  'Ostern',
  'Sommer',
  'Herbst',
  'Winter',
  'Frühling',
  'Glutenfrei',
  'Laktosefrei',
  'Low Carb',
  'Scharf',
  'Süß',
  'Herzhaft',
  'Italienisch',
  'Asiatisch',
  'Französisch',
  'Schwäbisch',
  'Bayerisch',
  'Österreichisch',
  'Omas Klassiker',
  'Meal Prep',
  'Grillen',
  'Kinder',
  'Günstig',
];

const PROFILES: readonly { name: string; avatar: AvatarToken }[] = [
  { name: 'Sebastian', avatar: 'avatar-1' },
  { name: 'Anna', avatar: 'avatar-2' },
  { name: 'Jonas', avatar: 'avatar-3' },
];

const STAR_WEIGHTS = [1, 2, 3, 3, 4, 4, 4, 5, 5, 5];
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------------------------
// Generation

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase('de') + s.slice(1);
}

interface Plan {
  title: string;
  kind: Kind;
  main: Main;
  dish: Dish;
}

function findMain(prefix: string, kind: Kind): Main {
  const main = MAINS.find((m) => m.prefix === prefix && m.kinds.includes(kind));
  if (!main) throw new Error(`unknown main ${prefix}`);
  return main;
}

function findDish(word: string, kind: Kind): Dish {
  const dish = DISHES.find((d) => d.word === word && d.kind === kind);
  if (!dish) throw new Error(`unknown dish ${word}`);
  return dish;
}

function planRecipe(rnd: Random, index: number): Plan {
  const anchor = ANCHORS[index];
  if (anchor) {
    return {
      title: anchor.title,
      kind: anchor.kind,
      main: findMain(anchor.main, anchor.kind),
      dish: findDish(anchor.dish, anchor.kind),
    };
  }
  const kind: Kind = rnd.chance(0.65) ? 'savory' : 'sweet';
  const main = rnd.pick(MAINS.filter((m) => m.kinds.includes(kind)));
  const dish = rnd.pick(DISHES.filter((d) => d.kind === kind));
  const compound = `${main.prefix}${dish.word}`;
  const roll = rnd.next();
  let title: string;
  if (roll < 0.45) title = compound;
  else if (roll < 0.7) title = `${capitalize(rnd.pick(ADJECTIVES))}${ENDINGS[dish.gender]} ${compound}`;
  else if (roll < 0.85) title = `${rnd.pick(OWNERS)} ${compound}`;
  else title = `${compound} mit ${rnd.pick(EXTRAS[kind])}`;
  return { title, kind, main, dish };
}

interface IngredientRow {
  group: string;
  amount: number | null;
  amountMax: number | null;
  unit: string;
  name: string;
  note: string;
}

function ingredientsFor(rnd: Random, plan: Plan): IngredientRow[] {
  const pantry = rnd.sample(
    PANTRY[plan.kind].filter((p) => p.name !== plan.main.ingredient),
    9,
  );
  const toRow = (p: Pantry, group: string): IngredientRow => {
    const amount = p.amounts ? rnd.pick(p.amounts) : null;
    // Ranges like "2–3 EL" for small countable amounts.
    const ranged = amount !== null && amount <= 3 && p.unit !== 'Päckchen' && rnd.chance(0.2);
    return {
      group,
      amount,
      amountMax: ranged && amount !== null ? amount + 1 : null,
      unit: p.unit,
      name: p.name,
      note: rnd.chance(0.15) ? rnd.pick(NOTES) : '',
    };
  };
  const main: IngredientRow = {
    group: '',
    amount: plan.main.amount,
    amountMax: null,
    unit: plan.main.unit,
    name: plan.main.ingredient,
    note: '',
  };
  if (plan.dish.baked) {
    const dough = pantry.slice(0, 5).map((p) => toRow(p, 'Für den Teig'));
    const topping = pantry.slice(5).map((p) => toRow(p, 'Für den Belag'));
    return [...dough, { ...main, group: 'Für den Belag' }, ...topping];
  }
  return [main, ...pantry.map((p) => toRow(p, ''))];
}

function stepsFor(rnd: Random, plan: Plan, ingredients: IngredientRow[]): string[] {
  const templates = STEPS[plan.kind];
  // Six of ten templates, kept in their natural order.
  const picked = rnd
    .sample(
      templates.map((_, i) => i),
      6,
    )
    .sort((a, b) => a - b);
  const others = ingredients.filter((i) => i.name !== plan.main.ingredient).map((i) => i.name);
  const values: Record<string, () => string> = {
    main: () => plan.main.ingredient,
    a: () => others[0] ?? 'Zwiebeln',
    b: () => others[1] ?? 'Knoblauch',
    c: () => others[2] ?? 'Salz',
    temp: () => String(rnd.pick([160, 175, 180, 200, 220])),
    min: () => String(rnd.pick([5, 10, 15, 20, 25, 30, 40, 45])),
    liquid: () => rnd.pick(LIQUIDS),
    herb: () => rnd.pick(HERBS),
    spice: () => rnd.pick(SPICES),
  };
  return picked.map((i) =>
    capitalize((templates[i] ?? '').replace(/\{(\w+)\}/g, (_, key: string) => values[key]?.() ?? key)),
  );
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Inserts profiles, tags and `count` recipes with ingredients, steps, tags, ratings and favorites
 * in one transaction (plain SQL, *_key via normalize()) and rebuilds the FTS index inside it.
 * The database must already be migrated. Deterministic for equal options.
 */
export function seed(db: DB, options: SeedOptions = {}): SeedSummary {
  const count = options.count ?? 1000;
  const nowMs = (options.now ?? new Date()).getTime();
  const rnd = new Random(options.seed ?? 42);

  const insertProfile = db.prepare(
    'INSERT INTO profiles(id, name, name_key, avatar, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const profileId = db.prepare('SELECT id FROM profiles WHERE name_key = ?').pluck();
  const insertTag = db.prepare(
    'INSERT INTO tags(name, name_key) VALUES (?, ?) ON CONFLICT(name_key) DO NOTHING',
  );
  const tagId = db.prepare('SELECT id FROM tags WHERE name_key = ?').pluck();
  const insertRecipe = db.prepare(
    `INSERT INTO recipes(id, title, title_key, description, servings, servings_unit, prep_minutes,
       cook_minutes, source, version, created_by, updated_by, created_at, updated_at)
     VALUES (@id, @title, @titleKey, @description, @servings, @servingsUnit, @prep, @cook, @source,
       @version, @createdBy, @updatedBy, @createdAt, @updatedAt)`,
  );
  const insertIngredient = db.prepare(
    `INSERT INTO ingredients(recipe_id, position, group_name, amount, amount_max, unit, name, name_key, note)
     VALUES (@recipeId, @position, @group, @amount, @amountMax, @unit, @name, @nameKey, @note)`,
  );
  const insertStep = db.prepare('INSERT INTO steps(recipe_id, position, text) VALUES (?, ?, ?)');
  const insertRecipeTag = db.prepare('INSERT INTO recipe_tags(recipe_id, tag_id) VALUES (?, ?)');
  const insertRating = db.prepare('INSERT INTO ratings(profile_id, recipe_id, stars) VALUES (?, ?, ?)');
  const insertFavorite = db.prepare('INSERT INTO favorites(profile_id, recipe_id) VALUES (?, ?)');

  return db.transaction((): SeedSummary => {
    const summary: SeedSummary = {
      recipes: 0,
      profiles: PROFILES.length,
      tags: TAGS.length,
      ingredients: 0,
      steps: 0,
      ratings: 0,
      favorites: 0,
      indexed: 0,
    };

    // Ids come from the app's counters, so --force never hands out the id of a deleted profile
    // or purged recipe again (F-05, F-08).
    const profileIds = PROFILES.map((p, i) => {
      const key = normalize(p.name);
      const existing = profileId.get(key) as number | undefined;
      if (existing !== undefined) return existing;
      const id = allocateProfileId(db);
      // Profile tiles are ordered by created_at (Kap. 4.3): Sebastian, Anna, Jonas.
      insertProfile.run(id, p.name, key, p.avatar, iso(nowMs - 800 * 24 * HOUR_MS + i * 60_000));
      return id;
    });
    const tagIds = TAGS.map((name) => {
      const key = normalize(name);
      insertTag.run(name, key);
      return tagId.get(key) as number;
    });

    // Recipes are spread over the past ~2 years, oldest first, so ids grow with created_at.
    const spanMs = 17 * HOUR_MS;
    for (let i = 0; i < count; i++) {
      const plan = planRecipe(rnd, i);
      const createdMs = nowMs - (count - i) * spanMs - rnd.int(0, 3 * 60) * 60_000;
      const edited = rnd.chance(0.4);
      const updatedMs = edited ? createdMs + Math.floor(rnd.next() * (nowMs - createdMs)) : createdMs;
      const createdBy = rnd.pick(profileIds);
      const piece = plan.dish.baked && plan.kind === 'sweet';
      const recipeId = allocateRecipeId(db);
      insertRecipe.run({
        id: recipeId,
        title: plan.title,
        titleKey: normalize(plan.title),
        description: rnd.pick(DESCRIPTIONS),
        servings: rnd.chance(0.05) ? null : piece ? 12 : rnd.pick([2, 3, 4, 4, 6]),
        servingsUnit: piece ? 'Stück' : 'Portionen',
        prep: rnd.chance(0.1) ? null : rnd.pick([10, 15, 20, 25, 30, 45]),
        cook: rnd.chance(0.15) ? null : rnd.pick([15, 20, 25, 30, 40, 45, 60, 90]),
        source: rnd.pick(['', '', '', 'Omas Kochbuch S. 12', `https://example.org/rezepte/${i + 1}`]),
        version: edited ? rnd.int(2, 4) : 1,
        createdBy,
        updatedBy: edited ? rnd.pick(profileIds) : createdBy,
        createdAt: iso(createdMs),
        updatedAt: iso(updatedMs),
      });
      summary.recipes++;

      const ingredients = ingredientsFor(rnd, plan);
      ingredients.forEach((ing, position) => {
        insertIngredient.run({ recipeId, position, ...ing, nameKey: normalize(ing.name) });
      });
      summary.ingredients += ingredients.length;

      const steps = stepsFor(rnd, plan, ingredients);
      steps.forEach((text, position) => {
        insertStep.run(recipeId, position, text);
      });
      summary.steps += steps.length;

      for (const tag of rnd.sample(tagIds, 3)) insertRecipeTag.run(recipeId, tag);

      for (const pid of profileIds) {
        if (rnd.chance(0.3)) {
          insertRating.run(pid, recipeId, rnd.pick(STAR_WEIGHTS));
          summary.ratings++;
        }
        if (rnd.chance(0.08)) {
          insertFavorite.run(pid, recipeId);
          summary.favorites++;
        }
      }
    }

    setMeta(db, 'seeded', iso(nowMs));
    bumpDataRevision(db);
    // Nested transaction = savepoint: recipes and index are committed together.
    summary.indexed = reindexAll(db);
    return summary;
  })();
}

// ---------------------------------------------------------------------------------------------
// CLI

const USAGE = 'Aufruf: pnpm seed [--count 1000] [--data-dir <Ordner>] [--force]';

function fmt(n: number): string {
  return n.toLocaleString('de-DE');
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(argv: string[]): void {
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(argv);
  } catch (err) {
    // parseArgs reports in English ("Unknown option '--x'"); the frame stays German.
    fail(`Ungültiger Aufruf: ${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const count = Number(args.count ?? '1000');
  if (!Number.isInteger(count) || count < 1 || count > 100_000) {
    fail(`--count muss eine ganze Zahl zwischen 1 und 100.000 sein.\n${USAGE}`);
  }

  const config = loadConfig();
  const dataDir = args.dataDir ? path.resolve(args.dataDir) : config.dataDir;
  const paths = dataPaths(dataDir);
  ensureDataDirs(paths);
  const log = createFileLogger({ dir: paths.logs, level: config.logLevel, console: false });

  const { db, status } = openDatabase(paths.db, log);
  if (status !== 'ok') {
    closeDatabase(db, log);
    fail(`Die Datenbank ${paths.db} ist beschädigt; Testdaten werden nicht angelegt.`);
  }
  try {
    runMigrations(db, { migrationsDir: MIGRATIONS_DIR, backupsDir: paths.backups, log });
    const existing = db.prepare('SELECT count(*) FROM recipes').pluck().get() as number;
    if (existing > 0 && !args.force) {
      // No process.exit here: the finally block must still close the database cleanly.
      process.stderr.write(
        `In ${paths.db} gibt es schon ${fmt(existing)} Rezepte. Mit --force werden die Testdaten zusätzlich angelegt.\n`,
      );
      process.exitCode = 1;
      return;
    }
    const started = performance.now();
    const s = seed(db, { count });
    const seconds = ((performance.now() - started) / 1000).toFixed(1).replace('.', ',');
    log.info('seeded', { ...s, dataDir });
    process.stdout.write(
      [
        `Testdaten angelegt in ${paths.db} (${seconds} s):`,
        `  ${plural(s.recipes, 'Rezept', 'Rezepte')} mit ${fmt(s.ingredients)} Zutaten und ${fmt(s.steps)} Zubereitungsschritten`,
        `  ${fmt(s.profiles)} Profile (${PROFILES.map((p) => p.name).join(', ')}), ${fmt(s.tags)} Tags`,
        `  ${plural(s.ratings, 'Bewertung', 'Bewertungen')}, ${plural(s.favorites, 'Favorit', 'Favoriten')}`,
        `  Suchindex: ${plural(s.indexed, 'Rezept', 'Rezepte')}`,
        '',
      ].join('\n'),
    );
  } finally {
    closeDatabase(db, log);
  }
}

function parseCli(argv: string[]): { count?: string; dataDir?: string; force: boolean; help: boolean } {
  const { values } = parseArgs({
    args: argv,
    options: {
      count: { type: 'string' },
      'data-dir': { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    ...(values.count === undefined ? {} : { count: values.count }),
    ...(values['data-dir'] === undefined ? {} : { dataDir: values['data-dir'] }),
    force: values.force,
    help: values.help,
  };
}

// Run only as a script (node tests/seed.ts), not when a test imports seed().
const entry = process.argv[1];
if (entry && path.resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main(process.argv.slice(2));
}
