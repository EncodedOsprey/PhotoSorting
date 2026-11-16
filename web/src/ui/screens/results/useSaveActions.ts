import { useRef, useState } from 'react';
import { useToast } from '../../components/Toast';
import { plural } from '../../lib/format';
import { isShareCancelled, saveHint, shareFiles } from '../../lib/share';
import { createZip, downloadBlob, planZip, zipFileName, type ZipPlan, type ZipProgress } from '../../lib/zip';

/** Photos too big for one ZIP file, downloaded as several smaller ones from a sheet. */
export interface ZipPartsState {
  files: readonly File[];
  plan: ZipPlan;
  /** How many photos come before these ones, when they're one share batch of the picks (photos 41–80). */
  offset: number;
  /** Why the photos are downloaded instead of shared, if they are. */
  reason?: string;
  /** Indexes of parts that have been downloaded. */
  downloaded: ReadonlySet<number>;
  /** The part being zipped, and how many of its photos are done. */
  zipping: { part: number; completed: number; total: number } | null;
}

/** Share, ZIP download and copy-names for the kept picks, with toasts for feedback. */
export function useSaveActions() {
  const toast = useToast();
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);
  const [zipParts, setZipParts] = useState<ZipPartsState | null>(null);
  const zipping = useRef(false);
  const partZip = useRef<AbortController | null>(null);

  const downloadZip = async (files: readonly File[], note?: string) => {
    if (zipping.current || files.length === 0) return;
    zipping.current = true;
    setZipProgress({ completed: 0, total: files.length });
    try {
      const blob = await createZip(files, { onProgress: setZipProgress });
      downloadBlob(blob, zipFileName());
      const done = `Downloaded ${plural(files.length, 'photo')} as a ZIP file.`;
      toast.show({ text: note ? `${done} ${note}` : done, tone: 'success' });
    } catch {
      toast.show({ text: 'Couldn’t create the ZIP file. Try again with fewer photos.', tone: 'error' });
    } finally {
      zipping.current = false;
      setZipProgress(null);
    }
  };

  /**
   * Downloads the photos as one ZIP file or, when that would be too big for iPhone's memory, opens a sheet that
   * downloads them as several smaller ZIP files. `reason` explains why they're downloaded instead of shared.
   */
  const saveAsZip = (files: readonly File[], { reason, offset = 0 }: { reason?: string; offset?: number } = {}) => {
    if (files.length === 0 || zipping.current) return;
    const plan = planZip(files);
    if (plan.parts.length > 1) {
      setZipParts({ files, plan, offset, reason, downloaded: new Set(), zipping: null });
      return;
    }
    if (reason) toast.show({ text: `${reason} Downloading a ZIP file instead…` });
    void downloadZip(files, reason);
  };

  const downloadZipPart = async (index: number) => {
    const state = zipParts;
    const part = state?.plan.parts[index];
    if (!state || !part || zipping.current) return;
    zipping.current = true;
    const controller = new AbortController();
    partZip.current = controller;
    const update = (change: (current: ZipPartsState) => ZipPartsState) =>
      setZipParts((current) => (current?.plan === state.plan ? change(current) : current));
    const total = part.end - part.start;
    const count = state.plan.parts.length;
    update((current) => ({ ...current, zipping: { part: index, completed: 0, total } }));
    try {
      const blob = await createZip(state.files.slice(part.start, part.end), {
        names: state.plan.names.slice(part.start, part.end),
        signal: controller.signal,
        onProgress: ({ completed }) => update((current) => ({ ...current, zipping: { part: index, completed, total } })),
      });
      if (controller.signal.aborted) return;
      downloadBlob(blob, zipFileName(new Date(), { index, count }));
      update((current) => ({ ...current, zipping: null, downloaded: new Set(current.downloaded).add(index) }));
      toast.show({ text: `Downloaded ZIP file ${index + 1} of ${count}.`, tone: 'success' });
    } catch {
      update((current) => ({ ...current, zipping: null }));
      if (!controller.signal.aborted) toast.show({ text: 'Couldn’t create the ZIP file. Try again.', tone: 'error' });
    } finally {
      zipping.current = false;
      if (partZip.current === controller) partZip.current = null;
    }
  };

  /** Closing the sheet stops a part that's still being zipped. */
  const closeZipParts = () => {
    partZip.current?.abort();
    setZipParts(null);
  };

  const shareFailed = (files: readonly File[], offset: number) =>
    toast.show({
      text: 'Couldn’t open the share sheet. You can download the photos as a ZIP file instead.',
      tone: 'error',
      action: { label: 'Download ZIP', onClick: () => saveAsZip(files, { offset }) },
    });

  /**
   * Opens the share sheet. Must run synchronously inside the tap handler (no awaits before it). `offset` is the number
   * of photos before these ones, when they're one batch of the picks.
   */
  const share = (files: readonly File[], { onShared, offset = 0 }: { onShared?: () => void; offset?: number } = {}) => {
    let sharing: Promise<void>;
    try {
      sharing = shareFiles(files);
    } catch {
      shareFailed(files, offset);
      return;
    }
    toast.show({ text: saveHint(files.length), duration: Infinity });
    sharing.then(
      () => {
        onShared?.();
        toast.show({ text: `Shared ${plural(files.length, 'photo')}. Saved images are added to Photos as copies.`, tone: 'success' });
      },
      (error: unknown) => {
        if (isShareCancelled(error)) toast.hide();
        else shareFailed(files, offset);
      },
    );
  };

  const copyNames = (names: readonly string[]) => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      toast.show({ text: 'Copying isn’t available in this browser.', tone: 'error' });
      return;
    }
    clipboard.writeText(names.join('\n')).then(
      () => toast.show({ text: `Copied ${plural(names.length, 'file name')}.`, tone: 'success' }),
      () => toast.show({ text: 'Couldn’t copy the file names.', tone: 'error' }),
    );
  };

  return { zipProgress, saveAsZip, zipParts, downloadZipPart, closeZipParts, share, copyNames };
}
