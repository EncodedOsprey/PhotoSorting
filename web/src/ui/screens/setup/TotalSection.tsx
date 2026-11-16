import { CircleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { planIssueMessage, validatePlan } from '../../../core';
import { CATEGORY_STYLE, FILL_STYLE } from '../../components/CategoryIcon';
import { Section } from '../../components/Section';
import { Stepper } from '../../components/Stepper';
import {
  TOTAL_MAX,
  TOTAL_MIN,
  allocation,
  assignmentSummary,
  clampInt,
  toSelectionPlan,
  type PlanSettings,
} from '../../state/planSettings';

interface TotalSectionProps {
  settings: PlanSettings;
  onChange: (update: (settings: PlanSettings) => PlanSettings) => void;
}

/** The total number of photos, how it's shared out between the categories, and any problem with the numbers. */
export function TotalSection({ settings, onChange }: TotalSectionProps) {
  const summary = assignmentSummary(settings);
  const shares = allocation(settings);
  const issues = validatePlan(toSelectionPlan(settings));
  const exceeded = issues.find((issue) => issue.kind === 'quotasExceedTotal');
  const fixTotal = exceeded?.kind === 'quotasExceedTotal' ? clampInt(exceeded.requested, TOTAL_MIN, TOTAL_MAX) : null;

  return (
    <Section id="pick-title" title="What to Pick" card={false}>
      <div className="card">
        <div className="row total-row">
          <div className="row__text">
            <span className="row__label" id="total-label">
              Total photos
            </span>
            <span className="row__detail">How many to pick in all</span>
          </div>
          <Stepper
            id="total-count"
            label="Total photos"
            value={settings.totalCount}
            min={TOTAL_MIN}
            max={TOTAL_MAX}
            describedBy="allocation-text"
            onChange={(totalCount) => onChange((current) => ({ ...current, totalCount }))}
          />
        </div>
        <div className="allocation">
          <div className="allocation__bar" aria-hidden="true">
            {shares.categories.map(({ category, count }) => (
              <span
                key={category}
                className="allocation__segment"
                style={{ flexGrow: count, '--segment': CATEGORY_STYLE[category].color } as CSSProperties}
              />
            ))}
            {shares.fill > 0 ? (
              <span
                className="allocation__segment allocation__segment--fill"
                style={{ flexGrow: shares.fill, '--segment': FILL_STYLE.color } as CSSProperties}
              />
            ) : null}
            {shares.unassigned > 0 ? <span className="allocation__segment" style={{ flexGrow: shares.unassigned, background: 'none' }} /> : null}
            {shares.over > 0 ? <span className="allocation__segment allocation__segment--over" style={{ flexGrow: shares.over }} /> : null}
          </div>
          <p
            id="allocation-text"
            className={shares.over > 0 ? 'allocation__text allocation__text--over' : 'allocation__text'}
            data-testid="assignment-summary"
          >
            {summary.text}
          </p>
        </div>
      </div>
      {issues.length > 0 ? (
        <div className="plan-issue" role="alert">
          {issues.map((issue) => (
            <div className="callout" key={issue.kind}>
              <CircleAlert aria-hidden="true" />
              <span>{planIssueMessage(issue)}</span>
              {issue.kind === 'quotasExceedTotal' && fixTotal !== null && fixTotal !== settings.totalCount ? (
                <button
                  type="button"
                  className="btn btn--tinted btn--small"
                  onClick={() => onChange((current) => ({ ...current, totalCount: fixTotal }))}
                >
                  Make Total {fixTotal}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
