import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { fileKey, isProbablyImage, releaseAnalyzedPhoto } from '../analysis/files';
import { loadAnalyzer } from './analyzerFactory';
import { useToast } from './components/Toast';
import { useBeforeUnload } from './hooks/useBeforeUnload';
import { usePersistentSettings } from './hooks/usePersistentSettings';
import { useWakeLock } from './hooks/useWakeLock';
import { estimateRemainingSeconds, plural } from './lib/format';
import { UpdateBanner } from './pwa/UpdateBanner';
import { useAppUpdate } from './pwa/useAppUpdate';
import { AnalyzingScreen, INITIAL_ANALYSIS_VIEW, type AnalysisView } from './screens/AnalyzingScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { AnalysisController, engineLoadedBefore } from './state/analysisController';
import { mergeFiles, mergeNote, type SelectedPhoto } from './state/photoSelection';
import { buildResults, type ResultsModel } from './state/resultsModel';

type Screen = 'setup' | 'analyzing' | 'results';

const ENGINE_ERROR_TITLE = 'Couldn’t Load the Analysis Engine';
const ENGINE_ERROR_FIRST_LOAD =
  'The first time, PhotoSorting downloads its analysis engine (about 18 MB). Check your internet connection and try again.';
const ENGINE_ERROR_AGAIN = 'Check your internet connection and try again. If it keeps happening, close PhotoSorting and open it again.';
const ANALYSIS_ERROR_TITLE = 'Analysis Stopped';

export function PhotoSortingApp() {
  const toast = useToast();
  const [settings, setSettings] = usePersistentSettings();
  const [selection, setSelection] = useState<SelectedPhoto[]>([]);
  const [screen, setScreen] = useState<Screen>('setup');
  const [view, setView] = useState<AnalysisView>(INITIAL_ANALYSIS_VIEW);
  const [results, setResults] = useState<ResultsModel | null>(null);
  // The analysis cache lives outside React state: going back to adjust the criteria never re-analyzes a photo.
  const [controller] = useState(() => new AnalysisController(loadAnalyzer, releaseAnalyzedPhoto));
  const processed = useSyncExternalStore(controller.subscribe, controller.processedKeys);
  const runId = useRef(0);
  const screenRef = useRef<Screen>('setup');
  const setupScroll = useRef(0);
  const navigated = useRef(false);
  const { updateAvailable, reload } = useAppUpdate();

  const analyzing = screen === 'analyzing' && view.stage !== 'error';
  useWakeLock(analyzing);
  useBeforeUnload(analyzing);

  const processedCount = useMemo(
    () => selection.reduce((count, photo) => count + (processed.has(photo.key) ? 1 : 0), 0),
    [selection, processed],
  );

  // Each screen starts at the top, except Setup, which returns to where it was left.
  useLayoutEffect(() => {
    if (!navigated.current) return;
    window.scrollTo(0, screen === 'setup' ? setupScroll.current : 0);
    document.querySelector<HTMLElement>(`[data-screen="${screen}"] h1`)?.focus({ preventScroll: true });
  }, [screen]);

  const navigate = (next: Screen) => {
    if (screenRef.current === 'setup' && next !== 'setup') setupScroll.current = window.scrollY;
    screenRef.current = next;
    navigated.current = true;
    setScreen(next);
  };

  const showResults = (current: readonly SelectedPhoto[]) => {
    setResults(buildResults(current, controller, settings));
    navigate('results');
  };

  const find = async () => {
    const id = ++runId.current;
    const current = selection;
    controller.retain(new Set(current.map((photo) => photo.key)));
    const missing = controller.missing(current);
    if (missing.length === 0) {
      showResults(current);
      return;
    }
    const isCurrent = () => runId.current === id;
    setView({
      ...INITIAL_ANALYSIS_VIEW,
      stage: controller.engineReady ? 'analyzing' : 'engine',
      firstLoad: !engineLoadedBefore(),
      total: missing.length,
    });
    navigate('analyzing');

    let startedAt = performance.now();
    const outcome = await controller.run(current, {
      onEngineLoading: () => {
        if (isCurrent()) setView((previous) => ({ ...previous, stage: 'engine' }));
      },
      onAnalysisStart: (total) => {
        startedAt = performance.now();
        if (isCurrent()) setView((previous) => ({ ...previous, stage: 'analyzing', total, completed: 0, failed: 0 }));
      },
      onProgress: (progress) => {
        if (!isCurrent()) return;
        const remainingSeconds = estimateRemainingSeconds(progress.completed, progress.total, performance.now() - startedAt);
        setView((previous) => ({
          ...previous,
          stage: 'analyzing',
          completed: progress.completed,
          total: progress.total,
          failed: progress.failed,
          thumbnailUrl: progress.current?.thumbnailUrl ?? previous.thumbnailUrl,
          remainingSeconds,
        }));
      },
    });
    if (!isCurrent()) return;
    if (outcome.status === 'done') {
      showResults(current);
    } else if (outcome.status === 'error') {
      setView((previous) => ({
        ...previous,
        stage: 'error',
        error:
          previous.stage === 'engine'
            ? { title: ENGINE_ERROR_TITLE, message: previous.firstLoad ? ENGINE_ERROR_FIRST_LOAD : ENGINE_ERROR_AGAIN }
            : { title: ANALYSIS_ERROR_TITLE, message: outcome.message },
      }));
    } else {
      navigate('setup');
    }
  };

  const cancel = () => {
    const id = ++runId.current;
    const current = selection;
    controller.cancel();
    navigate('setup');
    // The photo in progress is finished and cached first, so count once the run has settled.
    void controller.idle().then(() => {
      if (runId.current !== id) return;
      const kept = current.length - controller.missing(current).length;
      toast.show({
        text:
          kept === 0
            ? 'Stopped.'
            : kept === 1
              ? 'Stopped. The photo analyzed so far is kept.'
              : `Stopped. The ${kept} photos analyzed so far are kept.`,
      });
    });
  };

  const addFiles = (files: File[]) => {
    const merged = mergeFiles(selection, files, { isImage: isProbablyImage, keyOf: fileKey });
    setSelection(merged.selection);
    const note = mergeNote(merged);
    if (note) toast.show({ text: note });
  };

  const clearPhotos = () => {
    const previous = selection;
    setSelection([]);
    toast.show({
      text: `Cleared ${plural(previous.length, 'photo')}`,
      action: { label: 'Undo', onClick: () => setSelection((current) => (current.length === 0 ? previous : current)) },
    });
  };

  const adjust = () => {
    setResults(null);
    navigate('setup');
  };

  const startOver = () => {
    runId.current++;
    controller.clear();
    setSelection([]);
    setResults(null);
    setupScroll.current = 0;
    navigate('setup');
  };

  if (screen === 'analyzing') {
    return <AnalyzingScreen view={view} onCancel={cancel} onRetry={() => void find()} onBack={() => navigate('setup')} />;
  }
  if (screen === 'results' && results) {
    return (
      <ResultsScreen
        model={results}
        onModelChange={(update) => setResults((current) => (current ? update(current) : current))}
        onAdjust={adjust}
        onStartOver={startOver}
      />
    );
  }
  return (
    <SetupScreen
      settings={settings}
      onSettingsChange={setSettings}
      photoCount={selection.length}
      processedCount={processedCount}
      onAddFiles={addFiles}
      onClearPhotos={clearPhotos}
      onFind={() => void find()}
      banner={updateAvailable ? <UpdateBanner onReload={reload} /> : null}
    />
  );
}
