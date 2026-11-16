import { memo } from 'react';
import type { AnalyzedPhoto } from '../../../analysis/types';
import { scoreValue } from '../../lib/format';

interface PhotoTileProps {
  photo: AnalyzedPhoto;
  slot: number;
  score: number;
  removed: boolean;
  onOpen: (slot: number) => void;
}

/** A square thumbnail of a pick with its score. */
export const PhotoTile = memo(function PhotoTile({ photo, slot, score, removed, onOpen }: PhotoTileProps) {
  const value = scoreValue(score);
  return (
    <li className={removed ? 'photo-tile photo-tile--removed' : 'photo-tile'} data-name={photo.name} data-removed={removed || undefined}>
      <button
        type="button"
        className="photo-tile__button"
        aria-label={`${photo.name}, score ${value}${removed ? ', removed' : ''}`}
        onClick={() => onOpen(slot)}
      >
        <img src={photo.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false} />
      </button>
      <span className="photo-tile__score" aria-hidden="true">
        {value}
      </span>
      {removed ? (
        <span className="photo-tile__removed" aria-hidden="true">
          Removed
        </span>
      ) : null}
    </li>
  );
});
