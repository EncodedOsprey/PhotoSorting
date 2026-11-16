// What the "Find Best Photos" button says about the current setup.
import { planIssueMessage, validatePlan } from '../../core';
import { picksNothing, toSelectionPlan, type PlanSettings } from '../state/planSettings';
import { plural } from './format';

export interface FindStatus {
  /** The button is disabled; `note` says why. */
  blocked: boolean;
  note: string;
}

/** `count` photos are selected, `processed` of them already analyzed (or unreadable). */
export function findStatus(count: number, processed: number, settings: PlanSettings): FindStatus {
  if (count === 0) return { blocked: true, note: 'Choose photos to get started.' };
  const issues = validatePlan(toSelectionPlan(settings));
  if (issues.length > 0) return { blocked: true, note: planIssueMessage(issues[0]) };
  if (picksNothing(settings)) {
    return { blocked: true, note: 'Turn on a category or “Fill the rest with best overall”.' };
  }
  if (processed >= count) return { blocked: false, note: 'Already analyzed — results are instant.' };
  if (processed > 0) return { blocked: false, note: `${plural(count - processed, 'new photo')} to analyze · ${processed} done` };
  return { blocked: false, note: `${plural(count, 'photo')} to analyze on this iPhone` };
}
