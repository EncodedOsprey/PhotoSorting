// The data behind the Results screen.
import type { AnalysisFailure, AnalyzedPhoto } from '../../analysis/types';
import type { PhotoPick, SelectionPlan } from '../../core/types';
import { buildSections, type ResultSection } from '../lib/results';
import { runSelection } from '../lib/selection';
import { toSelectionPlan, type PlanSettings } from './planSettings';
import type { SelectedPhoto } from './photoSelection';

export interface ResultsModel {
  plan: SelectionPlan;
  /** Analyzed photos of the current selection in selection order (`order` is the position in the selection). */
  photos: AnalyzedPhoto[];
  byKey: ReadonlyMap<string, AnalyzedPhoto>;
  picks: PhotoPick<string>[];
  /** Picks the photographer took out of the selection. */
  removed: ReadonlySet<string>;
  sections: ResultSection[];
  /** How many photos were chosen on the Setup screen. */
  selectionCount: number;
  failures: AnalysisFailure[];
}

export interface AnalysisCache {
  photos: ReadonlyMap<string, AnalyzedPhoto>;
  failures: ReadonlyMap<string, AnalysisFailure>;
}

/** Runs the selection over the cached analysis of the selected photos. */
export function buildResults(selection: readonly SelectedPhoto[], cache: AnalysisCache, settings: PlanSettings): ResultsModel {
  const plan = toSelectionPlan(settings);
  const photos: AnalyzedPhoto[] = [];
  const failures: AnalysisFailure[] = [];
  for (const selected of selection) {
    const photo = cache.photos.get(selected.key);
    if (photo) photos.push(photo.order === selected.order ? photo : { ...photo, order: selected.order });
    const failure = cache.failures.get(selected.key);
    if (failure) failures.push(failure);
  }
  const { result } = runSelection(photos, plan, settings.duplicateLooseness);
  return {
    plan,
    photos,
    byKey: new Map(photos.map((photo) => [photo.key, photo])),
    picks: result.picks,
    removed: new Set(),
    sections: buildSections(plan, result.picks),
    selectionCount: selection.length,
    failures,
  };
}
