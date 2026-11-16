import { describe, expect, it } from 'vitest';
import { mergeFiles, mergeNote } from './photoSelection';

const file = (name: string, type = 'image/jpeg') => new File(['x'], name, { type, lastModified: 1 });
const deps = { isImage: (f: File) => f.type.startsWith('image/'), keyOf: (f: File) => f.name };

describe('mergeFiles', () => {
  it('appends new images with increasing order, skipping duplicates and non-images', () => {
    const first = mergeFiles([], [file('a.jpg'), file('b.jpg'), file('a.jpg')], deps);
    expect(first.selection.map((p) => [p.key, p.order])).toEqual([
      ['a.jpg', 0],
      ['b.jpg', 1],
    ]);
    expect(first).toMatchObject({ added: 2, duplicates: 1, skipped: 0 });

    const second = mergeFiles(first.selection, [file('b.jpg'), file('notes.txt', 'text/plain'), file('c.jpg')], deps);
    expect(second.selection.map((p) => [p.key, p.order])).toEqual([
      ['a.jpg', 0],
      ['b.jpg', 1],
      ['c.jpg', 2],
    ]);
    expect(second).toMatchObject({ added: 1, duplicates: 1, skipped: 1 });
    expect(first.selection).toHaveLength(2);
  });

  it('continues after the highest order even when earlier photos were removed', () => {
    const existing = [{ key: 'z', file: file('z.jpg'), order: 7 }];
    expect(mergeFiles(existing, [file('y.jpg')], deps).selection[1].order).toBe(8);
  });
});

describe('mergeNote', () => {
  it('only speaks up about duplicates and skipped files', () => {
    expect(mergeNote({ added: 5, duplicates: 0, skipped: 0 })).toBeNull();
    expect(mergeNote({ added: 3, duplicates: 2, skipped: 1 })).toBe('Added 3 photos · 2 already added · 1 file isn’t a photo');
    expect(mergeNote({ added: 0, duplicates: 4, skipped: 2 })).toBe('No new photos added · 4 already added · 2 files aren’t photos');
  });
});
