// The photographer's selection preset: what the Setup screen edits and what is persisted in localStorage.
import { requestedCount } from '../../core';
import { SELECTION_CATEGORIES, type SelectionCategory, type SelectionPlan } from '../../core/types';

export const SETTINGS_STORAGE_KEY = 'photosorting.settings.v1';
const SETTINGS_VERSION = 1;

export const TOTAL_MIN = 1;
export const TOTAL_MAX = 999;
export const COUNT_MIN = 1;
export const COUNT_MAX = 999;
export const DEFAULT_LOOSENESS = 0.5;

/** One row of the category list. Disabled rows keep their count and position. */
export interface CategorySetting {
  category: SelectionCategory;
  enabled: boolean;
  count: number;
}

export interface PlanSettings {
  totalCount: number;
  /** Every category exactly once, in priority order (earlier rows get first pick). */
  categories: CategorySetting[];
  fillRemainder: boolean;
  avoidNearDuplicates: boolean;
  /** 0 = only nearly identical shots count as duplicates ... 1 = anything from the same scene. */
  duplicateLooseness: number;
  skipBlurry: boolean;
  skipClosedEyes: boolean;
}

const DEFAULT_ORDER: readonly CategorySetting[] = [
  { category: 'bestSmiles', enabled: true, count: 8 },
  { category: 'groupShots', enabled: true, count: 4 },
  { category: 'portraits', enabled: true, count: 4 },
  { category: 'eyesOpen', enabled: false, count: 4 },
  { category: 'sharpest', enabled: false, count: 4 },
  { category: 'wellExposed', enabled: false, count: 4 },
  { category: 'noPeople', enabled: false, count: 4 },
  { category: 'bestOverall', enabled: false, count: 4 },
];

export function defaultSettings(): PlanSettings {
  return {
    totalCount: 20,
    categories: DEFAULT_ORDER.map((row) => ({ ...row })),
    fillRemainder: true,
    avoidNearDuplicates: true,
    duplicateLooseness: DEFAULT_LOOSENESS,
    skipBlurry: true,
    skipClosedEyes: false,
  };
}

/** Rounds and clamps; NaN and infinities give `min`. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCategory = (value: unknown): value is SelectionCategory =>
  typeof value === 'string' && (SELECTION_CATEGORIES as readonly string[]).includes(value);

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampInt(value, min, max) : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Unknown or repeated rows are dropped and missing categories are appended (disabled). */
function normalizeCategories(value: unknown): CategorySetting[] {
  if (!Array.isArray(value)) return defaultSettings().categories;
  const defaults = new Map(DEFAULT_ORDER.map((row) => [row.category, row]));
  const rows: CategorySetting[] = [];
  const seen = new Set<SelectionCategory>();
  for (const item of value) {
    if (!isRecord(item) || !isCategory(item.category) || seen.has(item.category)) continue;
    seen.add(item.category);
    rows.push({
      category: item.category,
      enabled: boolOr(item.enabled, false),
      count: numberOr(item.count, defaults.get(item.category)!.count, COUNT_MIN, COUNT_MAX),
    });
  }
  if (rows.length === 0) return defaultSettings().categories;
  for (const row of DEFAULT_ORDER) {
    if (!seen.has(row.category)) rows.push({ ...row, enabled: false });
  }
  return rows;
}

/** Turns anything (old, partial or hand-edited data) into valid settings; bad fields fall back to defaults. */
export function normalizeSettings(value: unknown): PlanSettings {
  const defaults = defaultSettings();
  if (!isRecord(value)) return defaults;
  const looseness =
    typeof value.duplicateLooseness === 'number' && Number.isFinite(value.duplicateLooseness)
      ? Math.min(1, Math.max(0, value.duplicateLooseness))
      : defaults.duplicateLooseness;
  return {
    totalCount: numberOr(value.totalCount, defaults.totalCount, TOTAL_MIN, TOTAL_MAX),
    categories: normalizeCategories(value.categories),
    fillRemainder: boolOr(value.fillRemainder, defaults.fillRemainder),
    avoidNearDuplicates: boolOr(value.avoidNearDuplicates, defaults.avoidNearDuplicates),
    duplicateLooseness: looseness,
    skipBlurry: boolOr(value.skipBlurry, defaults.skipBlurry),
    skipClosedEyes: boolOr(value.skipClosedEyes, defaults.skipClosedEyes),
  };
}

/** Parses the stored JSON. Missing, corrupted or other-version data gives the defaults. */
export function parseSettings(raw: string | null | undefined): PlanSettings {
  if (!raw) return defaultSettings();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  if (!isRecord(data) || data.version !== SETTINGS_VERSION) return defaultSettings();
  return normalizeSettings(data.settings);
}

export function serializeSettings(settings: PlanSettings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, settings });
}

export function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): PlanSettings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(
  settings: PlanSettings,
  storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Storage full or disabled: settings just won't persist.
  }
}

/** The plan handed to the selector: enabled categories in priority order. */
export function toSelectionPlan(settings: PlanSettings): SelectionPlan {
  return {
    totalCount: settings.totalCount,
    requests: settings.categories
      .filter((row) => row.enabled)
      .map((row) => ({ category: row.category, count: row.count })),
    fillRemainderWithBestOverall: settings.fillRemainder,
    avoidNearDuplicates: settings.avoidNearDuplicates,
    excludeBlurry: settings.skipBlurry,
    excludeClosedEyes: settings.skipClosedEyes,
  };
}

export function updateCategory(
  settings: PlanSettings,
  category: SelectionCategory,
  patch: Partial<Omit<CategorySetting, 'category'>>,
): PlanSettings {
  return {
    ...settings,
    categories: settings.categories.map((row) => (row.category === category ? { ...row, ...patch } : row)),
  };
}

/** Moves a category up (-1) or down (+1) in priority. Out-of-range moves return the settings unchanged. */
export function moveCategory(settings: PlanSettings, category: SelectionCategory, delta: -1 | 1): PlanSettings {
  const from = settings.categories.findIndex((row) => row.category === category);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= settings.categories.length) return settings;
  const categories = settings.categories.slice();
  [categories[from], categories[to]] = [categories[to], categories[from]];
  return { ...settings, categories };
}

export interface AssignmentSummary {
  assigned: number;
  total: number;
  /** Photos not covered by category counts (0 when the counts reach or exceed the total). */
  remainder: number;
  text: string;
}

/** "14 of 20 assigned · 6 filled with Best Overall" (or "· 6 left unassigned" when filling is off). */
export function assignmentSummary(settings: PlanSettings): AssignmentSummary {
  const plan = toSelectionPlan(settings);
  const assigned = requestedCount(plan);
  const total = plan.totalCount;
  const remainder = Math.max(0, total - assigned);
  let text = `${assigned} of ${total} assigned`;
  if (remainder > 0) {
    text += settings.fillRemainder ? ` · ${remainder} filled with Best Overall` : ` · ${remainder} left unassigned`;
  }
  return { assigned, total, remainder, text };
}

export interface Allocation {
  /** What each enabled category can get, in priority order, once earlier ones have taken their share. */
  categories: { category: SelectionCategory; count: number }[];
  /** Left over and filled with Best Overall (fill on). */
  fill: number;
  /** Left over and not assigned (fill off). */
  unassigned: number;
  /** How far the category counts exceed the total. */
  over: number;
}

/** How the total is shared out, for the allocation bar. */
export function allocation(settings: PlanSettings): Allocation {
  let left = settings.totalCount;
  let requested = 0;
  const categories: Allocation['categories'] = [];
  for (const row of settings.categories) {
    if (!row.enabled) continue;
    requested += row.count;
    const count = Math.min(row.count, Math.max(0, left));
    left -= count;
    if (count > 0) categories.push({ category: row.category, count });
  }
  const rest = Math.max(0, left);
  return {
    categories,
    fill: settings.fillRemainder ? rest : 0,
    unassigned: settings.fillRemainder ? 0 : rest,
    over: Math.max(0, requested - settings.totalCount),
  };
}

/** True when the plan can't pick anything: no category is on and filling is off. */
export function picksNothing(settings: PlanSettings): boolean {
  return !settings.fillRemainder && settings.categories.every((row) => !row.enabled);
}

/** Describes a duplicate-sensitivity slider value for assistive technology. */
export function loosenessLabel(looseness: number): string {
  if (looseness < 0.2) return 'Only nearly identical shots';
  if (looseness < 0.45) return 'Very similar shots';
  if (looseness <= 0.65) return 'Similar shots';
  if (looseness < 0.85) return 'Loosely similar shots';
  return 'Anything from the same scene';
}
