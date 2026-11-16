import { ChevronRight, ImagePlus, Images, Plus, Search } from 'lucide-react';
import { useRef } from 'react';
import { TileIcon } from '../../components/CategoryIcon';
import { Section } from '../../components/Section';
import { plural } from '../../lib/format';

interface PhotosSectionProps {
  count: number;
  /** Selected photos that are already analyzed (or couldn't be opened). */
  processedCount: number;
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
}

function statusDetail(count: number, processed: number): string {
  if (count === 0) return 'Choose the photos from your shoot.';
  if (processed === 0) return 'Ready to analyze.';
  if (processed >= count) return 'All analyzed — results are instant.';
  return `${processed} already analyzed · ${count - processed} new`;
}

/** Choosing the shoot's photos with the system photo picker. Originals aren't previewed (memory). */
export function PhotosSection({ count, processedCount, onAddFiles, onClear }: PhotosSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Opened straight from the tap: iOS only shows the picker for a user gesture.
  const choose = () => inputRef.current?.click();

  return (
    <Section id="photos-title" title="Photos">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(event) => {
          const input = event.currentTarget;
          const files = input.files ? [...input.files] : [];
          // Reset so choosing the same files again still fires a change event.
          input.value = '';
          if (files.length > 0) onAddFiles(files);
        }}
      />
      <div className="row photos-status">
        <TileIcon Icon={count > 0 ? Images : ImagePlus} color="#007aff" />
        <div className="row__text">
          <span className="photos-status__count" data-testid="photo-count">
            {count > 0 ? `${plural(count, 'photo')} selected` : 'No photos yet'}
          </span>
          <span className="row__detail">{statusDetail(count, processedCount)}</span>
        </div>
      </div>
      <div className="photos-actions">
        {count === 0 ? (
          <button type="button" className="btn btn--primary btn--block" onClick={choose}>
            <ImagePlus aria-hidden="true" />
            Choose Photos
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--tinted" onClick={choose}>
              <Plus aria-hidden="true" />
              Add More
            </button>
            <button type="button" className="btn btn--gray" onClick={onClear}>
              Clear
            </button>
          </>
        )}
      </div>
      <details className="disclosure">
        <summary>
          <Search aria-hidden="true" />
          Finding your shoot
          <ChevronRight className="disclosure__chevron" aria-hidden="true" />
        </summary>
        <div className="disclosure__body">
          <ol className="help-steps">
            <li>
              In the picker, tap <strong>Albums</strong> or <strong>Search</strong> — search for a place, a date like
              “June 14”, or a person.
            </li>
            <li>Drag a finger across the photos to select many at once.</li>
            <li>
              Tap <strong>Add</strong>. You can add more photos later.
            </li>
          </ol>
          <p className="help-note">
            Photos on an SD card reader: tap <strong>Choose Files</strong>, open the card in Files, then tap{' '}
            <strong>Select All</strong>.
          </p>
        </div>
      </details>
    </Section>
  );
}
