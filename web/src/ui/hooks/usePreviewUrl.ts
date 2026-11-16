import { useEffect, useState } from 'react';
import { createPreviewUrl } from '../../analysis/preview';

/** A large preview of `file` (object URL, revoked when the file changes or on unmount); null until it's ready. */
export function usePreviewUrl(file: File | null, maxEdge = 1600): string | null {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    let active = true;
    let created: string | null = null;
    createPreviewUrl(file, maxEdge).then(
      (url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setPreview({ file, url });
      },
      () => {
        // Keep showing the thumbnail.
      },
    );
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file, maxEdge]);
  return preview && preview.file === file ? preview.url : null;
}
