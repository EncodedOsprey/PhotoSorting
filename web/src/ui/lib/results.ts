// Groups selection picks into the sections shown on the Results screen, and edits picks (keep/remove/swap).
import {
  CATEGORY_INFO,
  type PhotoPick,
  type SelectionCategory,
  type SelectionPlan,
} from '../../core/types';

export const FILL_SECTION_TITLE = 'More Great Shots';

export interface ResultSection {
  /** Stable React key: the category, or 'fill' for the remainder. */
  key: string;
  /** The category the photos were scored for ('bestOverall' for the remainder fill). */
  category: SelectionCategory;
  title: string;
  /** True for the "fill the rest with best overall" section. */
  isFill: boolean;
  /** Indices into the picks array, best first. */
  slots: number[];
  /** How many photos the selector tried to find for this section. */
  requested: number;
}

const wholeCount = (count: number): number => (count > 0 ? Math.floor(count) : 0);

/**
 * Sections in plan order, then the remainder fill. Mirrors how selectPhotos spends the total: each request
 * wants min(count, what's left of the total); the fill wants whatever is left after the requests.
 */
export function buildSections(plan: SelectionPlan, picks: readonly PhotoPick<unknown>[]): ResultSection[] {
  const total = wholeCount(plan.totalCount);
  const assigned = new Uint8Array(picks.length);
  const sections: ResultSection[] = [];
  const seen = new Set<SelectionCategory>();
  let picked = 0;

  for (const { category, count } of plan.requests) {
    if (seen.has(category)) continue;
    seen.add(category);
    const remaining = total - picked;
    if (remaining <= 0) break;
    const wanted = Math.min(wholeCount(count), remaining);
    if (wanted <= 0) continue;
    const slots: number[] = [];
    for (let i = 0; i < picks.length && slots.length < wanted; i++) {
      if (!assigned[i] && picks[i].category === category) {
        assigned[i] = 1;
        slots.push(i);
      }
    }
    picked += slots.length;
    sections.push({ key: category, category, title: CATEGORY_INFO[category].displayName, isFill: false, slots, requested: wanted });
  }

  const leftover: number[] = [];
  for (let i = 0; i < picks.length; i++) if (!assigned[i]) leftover.push(i);
  const remaining = Math.max(0, total - picked);
  if ((plan.fillRemainderWithBestOverall && remaining > 0) || leftover.length > 0) {
    sections.push({
      key: 'fill',
      category: 'bestOverall',
      title: FILL_SECTION_TITLE,
      isFill: true,
      slots: leftover,
      requested: Math.max(plan.fillRemainderWithBestOverall ? remaining : 0, leftover.length),
    });
  }
  return sections;
}

/** What a category needs, used to explain shortfalls ("not enough photos with 3+ people"). */
const SHORTFALL_NEEDS: Readonly<Record<SelectionCategory, string>> = {
  bestSmiles: 'photos with faces',
  eyesOpen: 'photos with faces',
  groupShots: 'photos with 3+ people',
  portraits: 'close-ups of one or two people',
  noPeople: 'photos without people',
  sharpest: 'photos',
  wellExposed: 'photos',
  bestOverall: 'photos',
};

export interface Shortfall {
  text: string;
  /** 'pickedEarlier': matching photos went to categories with an earlier turn. */
  reason: 'notEnough' | 'pickedEarlier' | 'nearDuplicates';
}

/** Lets a shortfall say where the matching photos went, rather than just "not enough". */
export interface ShortfallContext<ID> {
  sections: readonly ResultSection[];
  picks: readonly PhotoPick<ID>[];
  /** Every photo that qualifies for the section's category and passes the plan's filters. */
  eligible: ReadonlySet<ID>;
}

const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/**
 * Why a section has fewer photos than requested, or null when it's complete: "Only 2 of 4 — not enough photos with
 * 3+ people", or with `context`, "None left — photos with 3+ people were picked for Best Smiles first" when earlier
 * categories took them, or "… are near-duplicates of other picks".
 */
export function shortfall<ID>(section: ResultSection, context?: ShortfallContext<ID>): Shortfall | null {
  const found = section.slots.length;
  if (found >= section.requested) return null;
  const only = `Only ${found} of ${section.requested}`;
  const needs = section.isFill ? 'photos' : SHORTFALL_NEEDS[section.category];
  if (context && !section.isFill) {
    const left = found === 0 ? 'None left' : only;
    const which = found === 0 ? needs : `other ${needs}`;
    const index = context.sections.indexOf(section);
    const takers = context.sections
      .slice(0, Math.max(0, index))
      .filter((other) => !other.isFill && other.slots.some((slot) => context.eligible.has(context.picks[slot].id)));
    if (takers.length > 0) {
      const names = listFormat.format(takers.map((other) => other.title));
      return { text: `${left} — ${which} were picked for ${names} first`, reason: 'pickedEarlier' };
    }
    const picked = new Set(context.picks.map((pick) => pick.id));
    for (const id of context.eligible) {
      if (!picked.has(id)) return { text: `${left} — ${which} are near-duplicates of other picks`, reason: 'nearDuplicates' };
    }
  }
  return { text: `${found === 0 ? 'None found' : only} — not enough ${needs === 'photos' ? 'photos left' : needs}`, reason: 'notEnough' };
}

/** Picked ids the photographer kept, in pick order without repeats. */
export function keptIds<ID>(picks: readonly PhotoPick<ID>[], removed: ReadonlySet<ID>): ID[] {
  const seen = new Set<ID>();
  const ids: ID[] = [];
  for (const { id } of picks) {
    if (removed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function keptInSection<ID>(section: ResultSection, picks: readonly PhotoPick<ID>[], removed: ReadonlySet<ID>): number {
  return section.slots.reduce((sum, slot) => sum + (removed.has(picks[slot].id) ? 0 : 1), 0);
}

/** Replaces the photo in one slot (same category), returning new picks and removed-set. The new photo is kept. */
export function swapPick<ID>(
  picks: readonly PhotoPick<ID>[],
  removed: ReadonlySet<ID>,
  slot: number,
  replacement: { id: ID; score: number },
): { picks: PhotoPick<ID>[]; removed: Set<ID> } {
  const next = picks.slice();
  const previous = next[slot];
  if (!previous) return { picks: next, removed: new Set(removed) };
  next[slot] = { id: replacement.id, category: previous.category, score: replacement.score };
  const nextRemoved = new Set(removed);
  nextRemoved.delete(previous.id);
  nextRemoved.delete(replacement.id);
  return { picks: next, removed: nextRemoved };
}

export function setKept<ID>(removed: ReadonlySet<ID>, id: ID, kept: boolean): Set<ID> {
  const next = new Set(removed);
  if (kept) next.delete(id);
  else next.add(id);
  return next;
}
