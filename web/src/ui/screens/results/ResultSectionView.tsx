import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { CategoryIcon } from '../../components/CategoryIcon';
import { keptInSection, shortfall, type ResultSection } from '../../lib/results';
import { eligibleKeys } from '../../lib/selection';
import type { ResultsModel } from '../../state/resultsModel';
import { PhotoTile } from './PhotoTile';

interface ResultSectionViewProps {
  section: ResultSection;
  model: ResultsModel;
  onOpen: (slot: number) => void;
}

/** One category of picks: header with "kept of requested", a shortfall note and the thumbnail grid. */
export function ResultSectionView({ section, model, onOpen }: ResultSectionViewProps) {
  const titleId = `section-${section.key}`;
  const kept = keptInSection(section, model.picks, model.removed);
  const short = section.slots.length < section.requested && !section.isFill;
  const eligible = useMemo(
    () => (short ? eligibleKeys(model.photos, section.category, model.plan) : null),
    [short, model.photos, section.category, model.plan],
  );
  const note = shortfall(section, eligible ? { sections: model.sections, picks: model.picks, eligible } : undefined);
  return (
    <section className="result-section" data-section={section.key} aria-labelledby={titleId}>
      <div className="result-section__header">
        <CategoryIcon category={section.category} fill={section.isFill} small />
        <h2 className="result-section__title" id={titleId}>
          {section.title}
        </h2>
        <span className="result-section__count" data-testid="section-count" aria-label={`${kept} of ${section.requested} photos`}>
          {kept} of {section.requested}
        </span>
      </div>
      {note ? (
        <p className="result-section__note" data-testid="section-note">
          <TriangleAlert aria-hidden="true" />
          <span>{note.text}</span>
        </p>
      ) : null}
      {section.slots.length > 0 ? (
        <ul className="photo-grid" aria-labelledby={titleId}>
          {section.slots.map((slot) => {
            const pick = model.picks[slot];
            const photo = model.byKey.get(pick.id);
            if (!photo) return null;
            return (
              <PhotoTile
                key={`${slot}-${pick.id}`}
                photo={photo}
                slot={slot}
                score={pick.score}
                removed={model.removed.has(pick.id)}
                onOpen={onOpen}
              />
            );
          })}
        </ul>
      ) : (
        <p className="card result-section__empty">
          {note?.reason === 'pickedEarlier'
            ? `To give ${section.title} first pick, tap Adjust Criteria, then Edit Order.`
            : 'No photos in this category.'}
        </p>
      )}
    </section>
  );
}
