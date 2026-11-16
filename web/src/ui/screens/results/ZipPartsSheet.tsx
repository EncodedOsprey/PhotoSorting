import { CircleCheck } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { formatBytes, photoRange } from '../../lib/format';
import type { ZipPartsState } from './useSaveActions';

interface ZipPartsSheetProps {
  state: ZipPartsState;
  onDownload: (index: number) => void;
  onClose: () => void;
}

/** Photos too big for one ZIP file come as several smaller ones, each downloaded with its own tap. */
export function ZipPartsSheet({ state, onDownload, onClose }: ZipPartsSheetProps) {
  const { plan, offset, reason, downloaded, zipping } = state;
  const total = plan.names.length;
  return (
    <Sheet onClose={onClose} title={`Download ${total} Photos`} titleId="zip-parts-title" className="batch">
      <p className="batch-intro">
        {reason ? `${reason} ` : null}
        One ZIP file with all {total} photos would be too big for iPhone, so they come in {plan.parts.length} smaller ZIP
        files. Download them one at a time.
      </p>
      <div className="group">
        <ul className="card batch-list">
          {plan.parts.map((part, index) => {
            const done = downloaded.has(index);
            const labelId = `zip-part-${index}`;
            return (
              <li className="row batch-row" key={part.start}>
                <div className="row__text">
                  <span className="row__label" id={labelId}>
                    {photoRange(offset + part.start, offset + part.end)}
                  </span>
                  <span className="row__detail">
                    {formatBytes(part.bytes)}
                    {done ? (
                      <>
                        {' · '}
                        <span className="batch-row__done">
                          <CircleCheck aria-hidden="true" /> Downloaded
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  className={done ? 'btn btn--gray btn--small' : 'btn btn--tinted btn--small'}
                  disabled={zipping !== null}
                  aria-describedby={labelId}
                  onClick={() => onDownload(index)}
                >
                  {zipping?.part === index ? `Zipping ${zipping.completed} of ${zipping.total}` : 'Download'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
