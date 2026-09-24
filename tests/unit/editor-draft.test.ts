// Draft protection of the editor (F-09): save/restore with a fake storage, expiry, broken entries and
// the zod-parsed payload of client/src/lib/editor.ts.
import { describe, expect, it } from 'vitest';
import {
  DRAFT_MAX_AGE_MS,
  draftKey,
  pruneDrafts,
  readDraft,
  removeDraft,
  type StorageLike,
  writeDraft,
} from '../../client/src/lib/draft.ts';
import {
  cloneForm,
  deletedWhen,
  draftWhen,
  type EditorDraft,
  emptyGroup,
  emptyIngredient,
  emptyStep,
  formKey,
  newForm,
  parseEditorDraft,
} from '../../client/src/lib/editor.ts';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const NOW = new Date('2026-09-23T12:00:00.000Z');

function sampleDraft(): EditorDraft {
  const form = newForm('Käsespätzle');
  form.tags = ['Vegetarisch'];
  form.items = [
    emptyGroup('Für den Teig'),
    { ...emptyIngredient(), amount: '400', unit: 'g', name: 'Mehl' },
    { ...emptyIngredient(), amount: '2–3', unit: '', name: 'Eier' },
  ];
  form.steps = [emptyStep('Teig schlagen.')];
  form.imageId = 17;
  return { form, base: null, version: null, createKey: 'abcdef1234567890', conflict: null };
}

describe('draft keys (F-09)', () => {
  it('uses draft:new and draft:<id>', () => {
    expect(draftKey(null)).toBe('draft:new');
    expect(draftKey(42)).toBe('draft:42');
  });
});

describe('writeDraft / readDraft', () => {
  it('restores every field, including rows, steps, tags, image and createKey', () => {
    const storage = new FakeStorage();
    const draft = sampleDraft();
    expect(writeDraft(storage, 'draft:new', draft, NOW)).toBe(true);
    const restored = readDraft(storage, 'draft:new', parseEditorDraft, new Date(NOW.getTime() + 60_000));
    expect(restored?.savedAt).toBe(NOW.toISOString());
    expect(restored?.data.createKey).toBe('abcdef1234567890');
    expect(restored?.data.form.imageId).toBe(17);
    expect(formKey(restored?.data.form ?? newForm())).toBe(formKey(draft.form));
    // Restored rows get fresh keys, so they never collide with rows created in this session.
    expect(restored?.data.form.items.map((i) => i.key)).not.toEqual(draft.form.items.map((i) => i.key));
  });

  it('keeps the base version and pending conflict offers of an edit', () => {
    const storage = new FakeStorage();
    const base = newForm('Alt');
    const mine = cloneForm(base);
    mine.title = 'Neu';
    const draft: EditorDraft = {
      form: base,
      base,
      version: 3,
      createKey: null,
      conflict: { mine, fields: ['title'] },
    };
    writeDraft(storage, draftKey(7), draft, NOW);
    const restored = readDraft(storage, draftKey(7), parseEditorDraft, NOW)?.data;
    expect(restored?.version).toBe(3);
    expect(restored?.base?.title).toBe('Alt');
    expect(restored?.conflict?.fields).toEqual(['title']);
    expect(restored?.conflict?.mine.title).toBe('Neu');
  });

  it('drops expired drafts (older than 30 days)', () => {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:new', sampleDraft(), NOW);
    const justInTime = new Date(NOW.getTime() + DRAFT_MAX_AGE_MS);
    expect(readDraft(storage, 'draft:new', parseEditorDraft, justInTime)).not.toBeNull();
    const tooLate = new Date(NOW.getTime() + DRAFT_MAX_AGE_MS + 1);
    expect(readDraft(storage, 'draft:new', parseEditorDraft, tooLate)).toBeNull();
    expect(storage.getItem('draft:new')).toBeNull();
  });

  it('removes unreadable or foreign entries instead of failing', () => {
    const storage = new FakeStorage();
    storage.setItem('draft:1', '{not json');
    storage.setItem('draft:2', JSON.stringify({ v: 99, savedAt: NOW.toISOString(), data: {} }));
    storage.setItem('draft:3', JSON.stringify({ v: 1, savedAt: NOW.toISOString(), data: { form: 'x' } }));
    for (const key of ['draft:1', 'draft:2', 'draft:3']) {
      expect(readDraft(storage, key, parseEditorDraft, NOW)).toBeNull();
      expect(storage.getItem(key)).toBeNull();
    }
    expect(readDraft(storage, 'draft:4', parseEditorDraft, NOW)).toBeNull();
  });

  it('survives blocked or full storage', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    expect(writeDraft(storage, 'draft:new', sampleDraft(), NOW)).toBe(false);
    expect(writeDraft(null, 'draft:new', sampleDraft(), NOW)).toBe(false);
    expect(readDraft(null, 'draft:new', parseEditorDraft, NOW)).toBeNull();
    expect(() => removeDraft(null, 'draft:new')).not.toThrow();
  });

  it('is removed after a successful save', () => {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:5', sampleDraft(), NOW);
    removeDraft(storage, 'draft:5');
    expect(readDraft(storage, 'draft:5', parseEditorDraft, NOW)).toBeNull();
  });
});

describe('pruneDrafts', () => {
  it('removes expired drafts of other recipes and keeps everything else', () => {
    const storage = new FakeStorage();
    const old = new Date(NOW.getTime() - DRAFT_MAX_AGE_MS - 1000);
    writeDraft(storage, 'draft:1', sampleDraft(), old);
    writeDraft(storage, 'draft:2', sampleDraft(), NOW);
    storage.setItem('draft:3', 'kaputt');
    storage.setItem('profileId', '4');
    expect(pruneDrafts(storage, NOW)).toBe(2);
    expect([...storage.map.keys()].sort()).toEqual(['draft:2', 'profileId']);
  });
});

describe('draft prompt time (NF-10)', () => {
  it('says today, yesterday or the date', () => {
    const now = new Date(2026, 8, 23, 18, 0);
    expect(draftWhen(new Date(2026, 8, 23, 14, 5).toISOString(), now)).toBe('von heute, 14:05');
    expect(draftWhen(new Date(2026, 8, 22, 9, 30).toISOString(), now)).toBe('von gestern, 09:30');
    expect(draftWhen(new Date(2026, 2, 12, 18, 0).toISOString(), now)).toBe('vom 12.03.2026, 18:00');
  });

  it('phrases the trash date for "Im Papierkorb (gelöscht von …)"', () => {
    const now = new Date(2026, 8, 23, 18, 0);
    expect(deletedWhen(new Date(2026, 8, 23, 9, 0).toISOString(), now)).toBe('heute');
    expect(deletedWhen(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toBe('vor 3 Tagen');
    expect(deletedWhen(new Date(2026, 2, 12, 9, 0).toISOString(), now)).toBe('am 12.03.2026');
  });
});
