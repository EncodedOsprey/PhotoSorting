import { ScanFace } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AnalyzedPhoto } from '../../../analysis/types';
import { CATEGORY_INFO } from '../../../core/types';
import { CATEGORY_STYLE } from '../../components/CategoryIcon';
import { MetricBar } from '../../components/MetricBar';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { SwitchRow } from '../../components/Switch';
import { usePreviewUrl } from '../../hooks/usePreviewUrl';
import { formatCaptureTime, plural, scoreValue } from '../../lib/format';
import type { ResultSection } from '../../lib/results';
import { rankAlternatives } from '../../lib/selection';
import type { ResultsModel } from '../../state/resultsModel';

const MAX_FACES_LISTED = 6;
const ALTERNATIVES = 6;

interface DetailSheetProps {
  model: ResultsModel;
  slot: number;
  section: ResultSection;
  onClose: () => void;
  onKeep: (id: string, kept: boolean) => void;
  onSwap: (slot: number, replacement: { id: string; score: number }) => void;
}

/** A pick up close: large preview, face boxes, the scores behind it, Keep, and better-or-similar alternatives. */
export function DetailSheet({ model, slot, section, onClose, onKeep, onSwap }: DetailSheetProps) {
  const pick = model.picks[slot];
  const photo = pick ? model.byKey.get(pick.id) : undefined;
  const mediaRef = useRef<HTMLDivElement>(null);
  const pickedKeys = useMemo(() => new Set(model.picks.map((p) => p.id)), [model.picks]);
  const category = pick?.category ?? section.category;
  const alternatives = useMemo(
    () => rankAlternatives(model.photos, category, pickedKeys, model.plan, ALTERNATIVES),
    [model.photos, category, pickedKeys, model.plan],
  );
  if (!pick || !photo) return null;

  const kept = !model.removed.has(pick.id);
  const swap = (replacement: { id: string; score: number }) => {
    onSwap(slot, replacement);
    // The tapped button disappears with the swap: keep focus in the sheet, and bring the new photo into view.
    mediaRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    mediaRef.current?.closest('.sheet__body')?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <Sheet onClose={onClose} title={section.title} titleId="detail-title" className="sheet--full detail">
      <div ref={mediaRef}>
        <DetailMedia key={photo.key} photo={photo} kept={kept} />
      </div>
      <div className="detail__sections">
        <div className="group">
          <div className="card">
            <SwitchRow
              id="detail-keep"
              label="Keep in selection"
              detail={kept ? 'Included when you save or share.' : 'Left out when you save or share.'}
              checked={kept}
              onChange={(value) => onKeep(pick.id, value)}
            />
          </div>
        </div>
        <Section id="detail-scores" title="Scores">
          <Metrics photo={photo} score={pick.score} scoreLabel={section.isFill ? 'Overall score' : `${CATEGORY_INFO[category].displayName} score`} color={section.isFill ? undefined : CATEGORY_STYLE[category].color} />
        </Section>
        <Section id="detail-info" title="Details">
          <InfoRows photo={photo} />
        </Section>
        <Section
          id="detail-alternatives"
          title="Alternatives"
          footer={
            <p className="group__footer">
              The best photos for {section.isFill ? 'overall quality' : CATEGORY_INFO[category].displayName} that aren’t
              picked yet.
            </p>
          }
        >
          {alternatives.length > 0 ? (
            <ul className="alternatives">
              {alternatives.map(({ photo: alternative, score }) => (
                <li className="row alternative" key={alternative.key} data-name={alternative.name}>
                  <img className="alternative__thumb" src={alternative.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  <div className="row__text">
                    <span className="row__label">{alternative.name}</span>
                    <span className="row__detail">Score {scoreValue(score)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--tinted btn--small"
                    aria-label={`Use ${alternative.name} instead`}
                    onClick={() => swap({ id: alternative.key, score })}
                  >
                    Use this instead
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="alternatives-empty">No other photos qualify for this category.</p>
          )}
        </Section>
      </div>
    </Sheet>
  );
}

function DetailMedia({ photo, kept }: { photo: AnalyzedPhoto; kept: boolean }) {
  const preview = usePreviewUrl(photo.file, 1600);
  const [showFaces, setShowFaces] = useState(false);
  const aspect = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;
  const frameStyle: CSSProperties = { aspectRatio: `${aspect}`, width: `min(100%, ${(52 * aspect).toFixed(2)}vh)` };
  const hasFaces = photo.faces.length > 0;
  return (
    <div className="detail__media">
      <div className={kept ? 'detail__frame' : 'detail__frame detail__frame--removed'} style={frameStyle}>
        <img src={photo.thumbnailUrl} alt={preview ? '' : photo.name} />
        {preview ? <img className="detail__preview" src={preview} alt={photo.name} data-testid="detail-preview" /> : null}
        {showFaces
          ? photo.faces.map((face, index) => (
              <div
                className="face-box"
                key={index}
                style={{
                  left: `${face.box.x * 100}%`,
                  top: `${face.box.y * 100}%`,
                  width: `${face.box.width * 100}%`,
                  height: `${face.box.height * 100}%`,
                }}
              >
                <span className="face-box__label">{index + 1}</span>
              </div>
            ))
          : null}
      </div>
      <div className="detail__caption">
        <span className="detail__name">{photo.name}</span>
        {hasFaces ? (
          <button type="button" className="btn btn--plain btn--small" aria-pressed={showFaces} onClick={() => setShowFaces((value) => !value)}>
            <ScanFace aria-hidden="true" />
            {showFaces ? 'Hide Faces' : 'Show Faces'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Metrics({ photo, score, scoreLabel, color }: { photo: AnalyzedPhoto; score: number; scoreLabel: string; color?: string }) {
  const faces = photo.metrics.faces;
  return (
    <div className="metrics">
      <div className="metric--score">
        <MetricBar label={scoreLabel} value={score} display={String(scoreValue(score))} color={color} />
      </div>
      <div className="metrics__faces">
        <span>Faces</span>
        <span>{faces.length === 0 ? 'None' : faces.length}</span>
      </div>
      {faces.slice(0, MAX_FACES_LISTED).map((face, index) => (
        <div className="metrics__face" key={index}>
          <h4>Face {index + 1}</h4>
          <MetricBar label="Smile" value={face.smile} color="#ff9500" />
          {face.eyesVisible === false ? (
            <div className="metric">
              <div className="metric__top">
                <span>Eyes</span>
                <span className="metric__value">Hidden by sunglasses</span>
              </div>
            </div>
          ) : (
            <MetricBar label="Eyes open" value={face.eyesOpen} color="#007aff" />
          )}
        </div>
      ))}
      {faces.length > MAX_FACES_LISTED ? (
        <p className="metrics__more">and {plural(faces.length - MAX_FACES_LISTED, 'more face')}</p>
      ) : null}
      <MetricBar label="Sharpness" value={photo.metrics.sharpness} color="#5856d6" />
      <MetricBar label="Exposure" value={photo.metrics.exposure} color="#f5a300" />
    </div>
  );
}

function InfoRows({ photo }: { photo: AnalyzedPhoto }) {
  const taken = formatCaptureTime(photo.capturedAt);
  return (
    <>
      {taken ? (
        <div className="row info-row">
          <span className="row__text">Taken</span>
          <span className="row__value">{taken}</span>
        </div>
      ) : null}
      <div className="row info-row">
        <span className="row__text">File</span>
        <span className="row__value" title={photo.name}>
          {photo.name}
        </span>
      </div>
      {photo.width > 0 && photo.height > 0 ? (
        <div className="row info-row">
          <span className="row__text">Size</span>
          <span className="row__value">
            {photo.width} × {photo.height}
          </span>
        </div>
      ) : null}
    </>
  );
}
