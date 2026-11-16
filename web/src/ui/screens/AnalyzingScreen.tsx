import { CloudOff, ScanSearch, Smartphone } from 'lucide-react';
import { ProgressBar } from '../components/ProgressBar';
import { remainingText } from '../lib/format';

export interface AnalysisView {
  /** 'engine': the analysis engine is loading; 'error': it (or the analysis) failed. */
  stage: 'engine' | 'analyzing' | 'error';
  /** The engine hasn't loaded on this device before, so it's being downloaded. */
  firstLoad: boolean;
  completed: number;
  total: number;
  failed: number;
  /** The most recently analyzed photo. */
  thumbnailUrl: string | null;
  remainingSeconds: number | null;
  error: { title: string; message: string } | null;
}

export const INITIAL_ANALYSIS_VIEW: AnalysisView = {
  stage: 'engine',
  firstLoad: false,
  completed: 0,
  total: 0,
  failed: 0,
  thumbnailUrl: null,
  remainingSeconds: null,
  error: null,
};

export const FIRST_LOAD_MESSAGE = 'Loading the analysis engine (about 18 MB, first time only)…';
export const ENGINE_START_MESSAGE = 'Starting the analysis engine…';

interface AnalyzingScreenProps {
  view: AnalysisView;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}

export function AnalyzingScreen({ view, onCancel, onRetry, onBack }: AnalyzingScreenProps) {
  return (
    <div className="analyzing" data-screen="analyzing" data-stage={view.stage}>
      <main className="analyzing__inner">
        <div className="analyzing__stack" aria-hidden="true">
          <div className="analyzing__card">
            {view.stage === 'error' ? (
              <CloudOff />
            ) : view.stage === 'engine' ? (
              <span className="spinner" />
            ) : view.thumbnailUrl ? (
              <img src={view.thumbnailUrl} alt="" />
            ) : (
              <ScanSearch />
            )}
          </div>
        </div>
        {view.stage === 'error' && view.error ? <ErrorState error={view.error} onRetry={onRetry} onBack={onBack} /> : <Progress view={view} onCancel={onCancel} />}
      </main>
    </div>
  );
}

function Progress({ view, onCancel }: { view: AnalysisView; onCancel: () => void }) {
  const loading = view.stage === 'engine';
  const current = Math.min(view.completed + 1, view.total);
  const status = loading
    ? view.firstLoad
      ? FIRST_LOAD_MESSAGE
      : ENGINE_START_MESSAGE
    : (remainingText(view.remainingSeconds) ?? 'Estimating time left…');
  return (
    <>
      <h1 className="analyzing__title" tabIndex={-1} data-testid="analyzing-title">
        {loading ? 'Getting Ready…' : `Analyzing ${current} of ${view.total}`}
      </h1>
      {loading ? (
        <div className="progress progress--indeterminate" role="progressbar" aria-label="Loading the analysis engine">
          <div className="progress__bar" />
        </div>
      ) : (
        <ProgressBar
          value={view.total > 0 ? view.completed / view.total : 0}
          label="Analysis progress"
          valueText={`${view.completed} of ${view.total} photos analyzed`}
        />
      )}
      <p className="analyzing__status" aria-live="polite">
        {status}
        {view.failed > 0 ? (
          <>
            <br />
            {view.failed === 1 ? '1 photo couldn’t be opened' : `${view.failed} photos couldn’t be opened`}
          </>
        ) : null}
      </p>
      <p className="analyzing__note">
        <Smartphone aria-hidden="true" />
        <span>Keep PhotoSorting open until it finishes. Your photos stay on this iPhone.</span>
      </p>
      <div className="analyzing__actions">
        <button type="button" className="btn btn--glass" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function ErrorState({ error, onRetry, onBack }: { error: { title: string; message: string }; onRetry: () => void; onBack: () => void }) {
  return (
    <>
      <h1 className="analyzing__title" tabIndex={-1}>
        {error.title}
      </h1>
      <p className="analyzing__message" role="alert">
        {error.message}
      </p>
      <div className="analyzing__actions">
        <button type="button" className="btn btn--light" onClick={onRetry}>
          Try Again
        </button>
        <button type="button" className="btn btn--glass" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
