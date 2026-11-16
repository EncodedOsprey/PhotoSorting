import { CircleCheck } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { plural } from '../../lib/format';
import { SHARE_BATCH_SIZE, type ShareBatch } from '../../lib/share';

interface BatchShareSheetProps {
  batches: ShareBatch[];
  /** Indexes of batches that have been shared. */
  shared: ReadonlySet<number>;
  /** Must open the share sheet synchronously (it's called straight from the tap). */
  onShare: (batch: ShareBatch, index: number) => void;
  onClose: () => void;
}

/** Large selections are shared in batches of 40, which iOS handles reliably. */
export function BatchShareSheet({ batches, shared, onShare, onClose }: BatchShareSheetProps) {
  const total = batches.length > 0 ? batches[batches.length - 1].end : 0;
  return (
    <Sheet onClose={onClose} title={`Save ${total} Photos`} titleId="batch-title" className="batch">
      <p className="batch-intro">
        iPhone saves up to {SHARE_BATCH_SIZE} photos at a time. Share each batch and choose “Save Images” in the share
        sheet.
      </p>
      <div className="group">
        <ul className="card batch-list">
          {batches.map((batch, index) => {
            const done = shared.has(index);
            return (
              <li className="row batch-row" key={batch.start}>
                <div className="row__text">
                  <span className="row__label">
                    Photos {batch.start + 1}–{batch.end}
                  </span>
                  <span className={done ? 'row__detail batch-row__done' : 'row__detail'}>
                    {done ? (
                      <>
                        <CircleCheck aria-hidden="true" /> Shared
                      </>
                    ) : (
                      plural(batch.end - batch.start, 'photo')
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={done ? 'btn btn--gray btn--small' : 'btn btn--tinted btn--small'}
                  onClick={() => onShare(batch, index)}
                >
                  {batch.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
