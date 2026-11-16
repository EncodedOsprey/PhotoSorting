import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../hooks/useModal';

interface SheetProps {
  /** Called after the sheet has animated away. */
  onClose: () => void;
  title: ReactNode;
  titleId: string;
  /** Extra header controls, before the close button. */
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
}

const CLOSE_FALLBACK_MS = 450;

/** A slide-up modal sheet. Close with the button, Escape, a tap outside or by swiping the top part down. */
export function Sheet({ onClose, title, titleId, headerActions, children, className }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closingRef = useRef(false);
  const fallback = useRef<number | undefined>(undefined);
  const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; velocity: number } | null>(null);

  const finish = useCallback(() => {
    window.clearTimeout(fallback.current);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.classList.remove('sheet--dragging');
      sheet.classList.add('sheet--settling');
      sheet.style.transform = 'translateY(100%)';
    }
    fallback.current = window.setTimeout(finish, CLOSE_FALLBACK_MS);
  }, [finish]);

  useEffect(() => () => window.clearTimeout(fallback.current), []);

  useModal(sheetRef, requestClose);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target as Element).closest('button, a, input')) return;
    drag.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheetRef.current?.classList.add('sheet--dragging');
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const sheet = sheetRef.current;
    if (!state || !sheet || event.pointerId !== state.id) return;
    const elapsed = event.timeStamp - state.lastT;
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    const offset = event.clientY - state.startY;
    // Rubber-band when pulled up.
    sheet.style.transform = `translateY(${offset >= 0 ? offset : -Math.sqrt(-offset) * 2}px)`;
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const sheet = sheetRef.current;
    if (!state || !sheet || event.pointerId !== state.id) return;
    drag.current = null;
    const offset = Math.max(0, event.clientY - state.startY);
    sheet.classList.remove('sheet--dragging');
    if (event.type === 'pointerup' && (offset > Math.min(160, sheet.offsetHeight * 0.25) || (state.velocity > 0.5 && offset > 24))) {
      requestClose();
      return;
    }
    sheet.classList.add('sheet--settling');
    sheet.style.transform = '';
  };

  return createPortal(
    <>
      <div
        className="sheet-backdrop"
        style={closing ? { opacity: 0, transition: 'opacity 0.3s' } : undefined}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={className ? `sheet ${className}` : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
          event.currentTarget.classList.remove('sheet--settling');
          if (closingRef.current) finish();
        }}
      >
        <div
          className={scrolled ? 'sheet__handle sheet__handle--scrolled' : 'sheet__handle'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__header">
            <h2 className="sheet__title" id={titleId}>
              {title}
            </h2>
            {headerActions}
            <button type="button" className="icon-button icon-button--filled" aria-label="Close" onClick={requestClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="sheet__body" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
