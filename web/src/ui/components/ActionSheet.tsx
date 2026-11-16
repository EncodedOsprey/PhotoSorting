import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../hooks/useModal';

export interface ActionSheetAction {
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

interface ActionSheetProps {
  title: string;
  message?: string;
  actions: ActionSheetAction[];
  onCancel: () => void;
  cancelLabel?: string;
}

/** An iOS-style action sheet for confirmations. */
export function ActionSheet({ title, message, actions, onCancel, cancelLabel = 'Cancel' }: ActionSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useModal(ref, onCancel);

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onCancel} aria-hidden="true" />
      <div
        ref={ref}
        className="action-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
      >
        <div className="action-sheet__group">
          <div className="action-sheet__message">
            <strong id={titleId}>{title}</strong>
            {message ? <span id={messageId}>{message}</span> : null}
          </div>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.destructive ? 'action-sheet__button action-sheet__button--destructive' : 'action-sheet__button'}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="action-sheet__group action-sheet__cancel">
          <button type="button" className="action-sheet__button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
