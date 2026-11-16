import { ChevronLeft, ChevronRight, CircleAlert, Copy, Download, ImageOff, Share } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionSheet } from '../components/ActionSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { useToast } from '../components/Toast';
import { plural } from '../lib/format';
import { keptIds, setKept, swapPick } from '../lib/results';
import { SHARE_BATCH_SIZE, canShareFiles, shareBatches } from '../lib/share';
import type { ResultsModel } from '../state/resultsModel';
import { BatchShareSheet } from './results/BatchShareSheet';
import { DetailSheet } from './results/DetailSheet';
import { ResultSectionView } from './results/ResultSectionView';
import { useSaveActions } from './results/useSaveActions';
import { ZipPartsSheet } from './results/ZipPartsSheet';

interface ResultsScreenProps {
  model: ResultsModel;
  onModelChange: (update: (model: ResultsModel) => ResultsModel) => void;
  onAdjust: () => void;
  onStartOver: () => void;
}

export function ResultsScreen({ model, onModelChange, onAdjust, onStartOver }: ResultsScreenProps) {
  const toast = useToast();
  const { zipProgress, saveAsZip, zipParts, downloadZipPart, closeZipParts, share, copyNames } = useSaveActions();
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [batchShared, setBatchShared] = useState<ReadonlySet<number> | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);

  const kept = useMemo(
    () => keptIds(model.picks, model.removed).flatMap((id) => model.byKey.get(id) ?? []),
    [model.picks, model.removed, model.byKey],
  );
  const files = kept.map((photo) => photo.file);
  const openSection = openSlot === null ? undefined : model.sections.find((section) => section.slots.includes(openSlot));

  const save = () => {
    if (files.length === 0) return;
    if (!canShareFiles(files.slice(0, SHARE_BATCH_SIZE))) {
      saveAsZip(files, { reason: 'Saving to Photos isn’t available in this browser.' });
      return;
    }
    if (files.length > SHARE_BATCH_SIZE) {
      setBatchShared(new Set());
      return;
    }
    share(files);
  };

  const keep = (id: string, value: boolean) => onModelChange((current) => ({ ...current, removed: setKept(current.removed, id, value) }));

  const swap = (slot: number, replacement: { id: string; score: number }) => {
    onModelChange((current) => ({ ...current, ...swapPick(current.picks, current.removed, slot, replacement) }));
    const name = model.byKey.get(replacement.id)?.name;
    if (name) toast.show({ text: `Now using ${name}`, tone: 'success' });
  };

  const summary = `${plural(kept.length, 'photo')} selected from ${model.selectionCount}`;
  const saveLabel = files.length === 0 ? 'Save Photos' : `Save ${plural(files.length, 'Photo')}`;

  return (
    <div className="screen" data-screen="results">
      <div className="screen__backdrop" aria-hidden="true" />
      <ScreenHeader
        title="Your Picks"
        subtitle={<span data-testid="results-summary">{summary}</span>}
        compactTitleOnWideOnly
        leading={
          <button type="button" className="btn btn--plain" onClick={onAdjust}>
            <ChevronLeft aria-hidden="true" />
            Adjust Criteria
          </button>
        }
        trailing={
          <button type="button" className="btn btn--plain" onClick={() => setConfirmStartOver(true)}>
            Start Over
          </button>
        }
      />
      <main className="screen__content">
        {model.failures.length > 0 ? <Failures failures={model.failures} /> : null}
        {model.picks.length === 0 ? (
          <div className="group">
            <div className="card empty-state">
              <ImageOff aria-hidden="true" />
              <p className="empty-state__title">No photos match these criteria</p>
              <p className="empty-state__text">Try other categories, or turn on “Fill the rest with best overall”.</p>
              <button type="button" className="btn btn--tinted" onClick={onAdjust}>
                Adjust Criteria
              </button>
            </div>
          </div>
        ) : (
          <>
            {model.sections.map((section) => (
              <ResultSectionView key={section.key} section={section} model={model} onOpen={setOpenSlot} />
            ))}
            <p className="results-end">Tap a photo to see its scores or swap it for an alternative.</p>
          </>
        )}
      </main>
      <div className="bottom-bar">
        <div className="bottom-bar__inner">
          <button type="button" className="btn btn--primary btn--block" disabled={files.length === 0} onClick={save}>
            <Share aria-hidden="true" />
            {saveLabel}
          </button>
          <div className="bottom-bar__actions">
            <button
              type="button"
              className="btn btn--tinted btn--small"
              disabled={files.length === 0 || zipProgress !== null}
              onClick={() => saveAsZip(files)}
            >
              <Download aria-hidden="true" />
              {zipProgress ? `Zipping ${zipProgress.completed} of ${zipProgress.total}` : 'Download ZIP'}
            </button>
            <button
              type="button"
              className="btn btn--tinted btn--small"
              disabled={files.length === 0}
              onClick={() => copyNames(kept.map((photo) => photo.name))}
            >
              <Copy aria-hidden="true" />
              Copy File Names
            </button>
          </div>
        </div>
      </div>
      {openSlot !== null && openSection ? (
        <DetailSheet
          model={model}
          slot={openSlot}
          section={openSection}
          onClose={() => setOpenSlot(null)}
          onKeep={keep}
          onSwap={swap}
        />
      ) : null}
      {/* A ZIP download offered after a batch failed to share replaces the batches until it's closed. */}
      {zipParts ? (
        <ZipPartsSheet state={zipParts} onDownload={(index) => void downloadZipPart(index)} onClose={closeZipParts} />
      ) : batchShared ? (
        <BatchShareSheet
          batches={shareBatches(files.length)}
          shared={batchShared}
          onShare={(batch, index) =>
            share(files.slice(batch.start, batch.end), {
              offset: batch.start,
              onShared: () => setBatchShared((current) => (current ? new Set(current).add(index) : current)),
            })
          }
          onClose={() => setBatchShared(null)}
        />
      ) : null}
      {confirmStartOver ? (
        <ActionSheet
          title="Start over?"
          message="This clears the chosen photos and their analysis. Your criteria are kept."
          actions={[
            {
              label: 'Start Over',
              destructive: true,
              onSelect: () => {
                setConfirmStartOver(false);
                onStartOver();
              },
            },
          ]}
          onCancel={() => setConfirmStartOver(false)}
        />
      ) : null}
    </div>
  );
}

function Failures({ failures }: { failures: ResultsModel['failures'] }) {
  return (
    <div className="group results-failures">
      <details className="card disclosure" data-testid="failures">
        <summary>
          <CircleAlert aria-hidden="true" />
          {failures.length === 1 ? '1 photo couldn’t be opened' : `${failures.length} photos couldn’t be opened`}
          <ChevronRight className="disclosure__chevron" aria-hidden="true" />
        </summary>
        <div className="disclosure__body">
          <ul className="failure-list">
            {failures.map((failure) => (
              <li key={failure.key}>
                <strong>{failure.name}</strong>
                <span>{failure.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
