import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { CATEGORY_INFO, type SelectionCategory } from '../../../core/types';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Section } from '../../components/Section';
import { Stepper } from '../../components/Stepper';
import { Switch } from '../../components/Switch';
import {
  COUNT_MAX,
  COUNT_MIN,
  moveCategory,
  updateCategory,
  type CategorySetting,
  type PlanSettings,
} from '../../state/planSettings';

interface CategoriesSectionProps {
  settings: PlanSettings;
  onChange: (update: (settings: PlanSettings) => PlanSettings) => void;
}

/** One row per category in priority order: on/off, how many photos, and (in Edit Order mode) up/down. */
export function CategoriesSection({ settings, onChange }: CategoriesSectionProps) {
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const rows = settings.categories;

  const move = (category: SelectionCategory, delta: -1 | 1) => {
    const from = rows.findIndex((row) => row.category === category);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= rows.length) return;
    onChange((current) => moveCategory(current, category, delta));
    setAnnouncement(`${CATEGORY_INFO[category].displayName} moved to position ${to + 1} of ${rows.length}`);
  };

  return (
    <Section
      id="categories-title"
      title="Categories"
      action={
        <button
          type="button"
          className="btn btn--plain"
          aria-pressed={editing}
          onClick={() => {
            setEditing((value) => !value);
            setAnnouncement('');
          }}
        >
          {editing ? 'Done' : 'Edit Order'}
        </button>
      }
      footer={
        <>
          <p className="group__footer">
            Categories are filled from the top: earlier ones get first pick, and each photo is used only once.
            {editing ? ' Use the arrows to change the order.' : ' Tap Edit Order to change the order.'}
          </p>
          <p className="visually-hidden" aria-live="polite">
            {announcement}
          </p>
        </>
      }
    >
      <ul className="category-list" data-editing={editing || undefined}>
        {rows.map((row, index) => (
          <CategoryRow
            key={row.category}
            row={row}
            index={index}
            count={rows.length}
            editing={editing}
            onToggle={(enabled) => onChange((current) => updateCategory(current, row.category, { enabled }))}
            onCount={(count) => onChange((current) => updateCategory(current, row.category, { count }))}
            onMove={(delta) => move(row.category, delta)}
          />
        ))}
      </ul>
    </Section>
  );
}

interface CategoryRowProps {
  row: CategorySetting;
  index: number;
  count: number;
  editing: boolean;
  onToggle: (enabled: boolean) => void;
  onCount: (count: number) => void;
  onMove: (delta: -1 | 1) => void;
}

function CategoryRow({ row, index, count, editing, onToggle, onCount, onMove }: CategoryRowProps) {
  const info = CATEGORY_INFO[row.category];
  const id = `category-${row.category}`;
  const first = index === 0;
  const last = index === count - 1;
  return (
    <li className={row.enabled ? 'category' : 'category category--off'} data-category={row.category}>
      <div className="row row--icon">
        <CategoryIcon category={row.category} />
        <div className="row__text">
          <label className="row__label" id={`${id}-label`} htmlFor={editing ? undefined : `${id}-switch`}>
            {info.displayName}
          </label>
          <span className="row__detail" id={`${id}-detail`}>
            {info.summary}
          </span>
        </div>
        {editing ? (
          <div className="reorder">
            {/* aria-disabled rather than disabled keeps focus on the button when it reaches the end. */}
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${info.displayName} up`}
              aria-disabled={first}
              onClick={() => !first && onMove(-1)}
            >
              <ChevronUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${info.displayName} down`}
              aria-disabled={last}
              onClick={() => !last && onMove(1)}
            >
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Switch
            id={`${id}-switch`}
            checked={row.enabled}
            onChange={onToggle}
            labelledBy={`${id}-label`}
            describedBy={`${id}-detail`}
          />
        )}
      </div>
      {row.enabled && !editing ? (
        <div className="category__count">
          <span className="category__count-label" aria-hidden="true">
            Photos
          </span>
          <Stepper
            id={`${id}-count`}
            label={`${info.displayName} photos`}
            value={row.count}
            min={COUNT_MIN}
            max={COUNT_MAX}
            onChange={onCount}
          />
        </div>
      ) : null}
    </li>
  );
}
