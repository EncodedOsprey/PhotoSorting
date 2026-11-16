// The photos the photographer has chosen, in the order they were added.

export interface SelectedPhoto {
  /** fileKey(file): stable identity used for de-duplication and the analysis cache. */
  key: string;
  file: File;
  /** 0-based position in the order the photos were added. */
  order: number;
}

export interface MergeResult {
  selection: SelectedPhoto[];
  /** Newly added photos. */
  added: number;
  /** Files that were already selected (same name, size and date). */
  duplicates: number;
  /** Files that aren't images. */
  skipped: number;
}

export interface MergeDeps {
  isImage: (file: File) => boolean;
  keyOf: (file: File) => string;
}

/** Appends image files that aren't selected yet, giving them increasing `order` values. */
export function mergeFiles(existing: readonly SelectedPhoto[], incoming: Iterable<File>, deps: MergeDeps): MergeResult {
  const selection = existing.slice();
  const keys = new Set(existing.map((photo) => photo.key));
  let nextOrder = existing.reduce((max, photo) => Math.max(max, photo.order + 1), 0);
  let added = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const file of incoming) {
    if (!deps.isImage(file)) {
      skipped += 1;
      continue;
    }
    const key = deps.keyOf(file);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    keys.add(key);
    selection.push({ key, file, order: nextOrder++ });
    added += 1;
  }
  return { selection, added, duplicates, skipped };
}

/** Short user-facing note about what happened when files were added, or null when nothing needs saying. */
export function mergeNote({ added, duplicates, skipped }: Omit<MergeResult, 'selection'>): string | null {
  const parts: string[] = [];
  if (duplicates > 0) parts.push(`${duplicates} already added`);
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'file isn’t a photo' : 'files aren’t photos'}`);
  if (parts.length === 0) return null;
  const lead = added > 0 ? `Added ${added} ${added === 1 ? 'photo' : 'photos'}` : 'No new photos added';
  return `${lead} · ${parts.join(' · ')}`;
}
