import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ToastOptions {
  text: string;
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it hides itself (default 3.5 s, 8 s with an action). */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (toast: ToastOptions) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, hide: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert };

/** Shows one short message at a time near the top of the screen, announced politely by VoiceOver. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => setToast({ ...options, id: nextId.current++ }), []);
  const hide = useCallback(() => setToast(null), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.duration ?? (toast.action ? 8000 : 3500);
    if (!Number.isFinite(duration)) return;
    const timer = window.setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const Icon = ICONS[toast?.tone ?? 'info'];
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
          {toast ? (
            <div className="toast" key={toast.id}>
              <Icon aria-hidden="true" />
              <span className="toast__text">{toast.text}</span>
              {toast.action ? (
                <button
                  type="button"
                  className="toast__action"
                  onClick={() => {
                    toast.action?.onClick();
                    hide();
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button type="button" className="icon-button toast__close" aria-label="Dismiss" onClick={hide}>
                <X aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
