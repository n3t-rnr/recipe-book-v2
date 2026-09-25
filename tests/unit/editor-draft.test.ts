// Draft protection of the editor (F-09): save/restore with a fake storage, expiry, broken entries, the
// zod-parsed payload of client/src/lib/editor.ts and the check of a restored draft's photo (F-09 AK).
import { describe, expect, it } from 'vitest';
import {
  DRAFT_MAX_AGE_MS,
  draftKey,
  draftSync,
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
  verifyDraftImage,
} from '../../client/src/lib/editor.ts';
import type { DetailImage } from '../../shared/types.ts';

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

function photo(id: number): DetailImage {
  const key = String(id).padStart(16, '0');
  return {
    id,
    urls: { s: `/media/${key}-s.webp`, m: `/media/${key}-m.webp`, l: `/media/${key}-l.webp` },
    width: 2048,
    height: 1536,
  };
}

function sampleDraft(): EditorDraft {
  const form = newForm('Käsespätzle');
  form.tags = ['Vegetarisch'];
  form.items = [
    emptyGroup('Für den Teig'),
    { ...emptyIngredient(), amount: '400', unit: 'g', name: 'Mehl' },
    { ...emptyIngredient(), amount: '2–3', unit: '', name: 'Eier' },
  ];
  form.steps = [emptyStep('Teig schlagen.')];
  form.image = photo(17);
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
    expect(restored?.data.form.image).toEqual(photo(17));
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

describe('draftSync: the stored draft follows the form (F-09)', () => {
  it('writes a changed payload once and removes its own draft when the form is back at its start', () => {
    const storage = new FakeStorage();
    const writes: string[] = [];
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      writes.push(key);
      setItem(key, value);
    };
    const sync = draftSync(storage, 'draft:new');
    const draft = sampleDraft();
    sync.keep(draft, NOW);
    sync.keep(draft, new Date(NOW.getTime() + 2000));
    expect(writes).toEqual(['draft:new']);
    draft.form.title = 'Käsespätzle mit Röstzwiebeln';
    sync.keep(draft, NOW);
    expect(writes).toHaveLength(2);
    sync.drop();
    expect(storage.getItem('draft:new')).toBeNull();
  });

  it('leaves the storage alone while it has neither written nor adopted a draft', () => {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:new', sampleDraft(), NOW);
    draftSync(storage, 'draft:new').drop();
    // Not this editor's draft yet (e.g. still offered in the dialog): it stays.
    expect(storage.getItem('draft:new')).not.toBeNull();
  });

  it('retries a write that failed (full storage) instead of taking it as done', () => {
    const storage = new FakeStorage();
    const sync = draftSync(storage, 'draft:new');
    storage.failWrites = true;
    sync.keep(sampleDraft(), NOW);
    storage.failWrites = false;
    sync.keep(sampleDraft(), NOW);
    expect(readDraft(storage, 'draft:new', parseEditorDraft, NOW)).not.toBeNull();
  });

  it('rewrites an adopted draft with the next change, even when the payload is the same', () => {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:new', sampleDraft(), NOW);
    const sync = draftSync(storage, 'draft:new');
    sync.adopt();
    const later = new Date(NOW.getTime() + 60_000);
    sync.keep(sampleDraft(), later);
    expect(readDraft(storage, 'draft:new', parseEditorDraft, later)?.savedAt).toBe(later.toISOString());
  });

  it('removes a restored draft whose only change was a photo that expired (not offered again)', async () => {
    // The editor for a new recipe: the start is an empty form; the draft held nothing but a photo.
    const storage = new FakeStorage();
    const start = newForm();
    const draft: EditorDraft = {
      form: { ...cloneForm(start), image: photo(17) },
      base: null,
      version: null,
      createKey: 'abcdef1234567890',
      conflict: null,
    };
    writeDraft(storage, 'draft:new', draft, NOW);
    const restored = readDraft(storage, 'draft:new', parseEditorDraft, NOW)?.data;
    if (!restored) throw new Error('draft must restore');
    const sync = draftSync(storage, 'draft:new');
    sync.adopt();
    expect(await verifyDraftImage(restored.form, null, async () => 'missing')).toBe(true);
    // The editor's autosave: the form is back at its start, so the draft goes.
    expect(formKey(restored.form)).toBe(formKey(start));
    sync.drop();
    expect(readDraft(storage, 'draft:new', parseEditorDraft, NOW)).toBeNull();
  });

  it('stores a restored draft without its expired photo when it holds more', async () => {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:new', sampleDraft(), NOW);
    const restored = readDraft(storage, 'draft:new', parseEditorDraft, NOW)?.data;
    if (!restored) throw new Error('draft must restore');
    const sync = draftSync(storage, 'draft:new');
    sync.adopt();
    await verifyDraftImage(restored.form, null, async () => 'missing');
    sync.keep(restored, NOW);
    const again = readDraft(storage, 'draft:new', parseEditorDraft, NOW)?.data;
    expect(again?.form.image).toBeNull();
    expect(again?.form.title).toBe('Käsespätzle');
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

describe('photo of a restored draft (F-09 AK)', () => {
  function stored(draft: EditorDraft): EditorDraft {
    const storage = new FakeStorage();
    writeDraft(storage, 'draft:new', draft, NOW);
    const restored = readDraft(storage, 'draft:new', parseEditorDraft, NOW)?.data;
    if (!restored) throw new Error('draft must restore');
    return restored;
  }

  it('drops a photo the server deleted meanwhile (GET /images/:id → 404)', async () => {
    const draft = stored(sampleDraft());
    const asked: number[] = [];
    const gone = await verifyDraftImage(draft.form, draft.base, async (id) => {
      asked.push(id);
      return 'missing';
    });
    expect(asked).toEqual([17]);
    expect(gone).toBe(true);
    expect(draft.form.image).toBeNull();
    // The rest of the draft stays.
    expect(draft.form.title).toBe('Käsespätzle');
    expect(draft.form.items).toHaveLength(3);
  });

  it('keeps a photo that still exists or could not be checked (offline)', async () => {
    for (const state of ['present', 'unknown'] as const) {
      const draft = stored(sampleDraft());
      expect(await verifyDraftImage(draft.form, draft.base, async () => state)).toBe(false);
      expect(draft.form.image?.id).toBe(17);
    }
  });

  it('does not check a draft without a photo or the recipe’s own photo', async () => {
    const lookup = async (): Promise<'missing'> => {
      throw new Error('no lookup expected');
    };
    const empty = sampleDraft();
    empty.form.image = null;
    expect(await verifyDraftImage(empty.form, null, lookup)).toBe(false);
    // Edit mode: the photo came with the loaded version (base); the version check guards it.
    const edit = sampleDraft();
    edit.base = cloneForm(edit.form);
    expect(await verifyDraftImage(edit.form, edit.base, lookup)).toBe(false);
    expect(edit.form.image?.id).toBe(17);
  });

  it('keeps a photo chosen while the check was running', async () => {
    const draft = stored(sampleDraft());
    const check = verifyDraftImage(draft.form, null, async () => {
      draft.form.image = photo(18);
      return 'missing';
    });
    expect(await check).toBe(false);
    expect(draft.form.image?.id).toBe(18);
  });

  it('reads drafts written before M3: without a photo they restore, with an id only they are dropped', () => {
    const legacy = (imageId: number | null): unknown => {
      const { image: _image, ...form } = sampleDraft().form;
      return { form: { ...form, imageId }, base: null, version: null, createKey: 'k', conflict: null };
    };
    expect(parseEditorDraft(legacy(null))?.form.image).toBeNull();
    // The preview URLs are unknown; restoring would silently drop the photo on save.
    expect(parseEditorDraft(legacy(17))).toBeNull();
  });
});
