import { Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampInt } from '../state/planSettings';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Accessible name of the number, e.g. "Total photos". */
  label: string;
  id?: string;
  describedBy?: string;
}

const HOLD_DELAY_MS = 450;
const FIRST_REPEAT_MS = 160;
const FASTEST_REPEAT_MS = 45;

/** −/+ buttons around a number you can also type. Holding a button repeats, speeding up. */
export function Stepper({ value, min, max, onChange, label, id, describedBy }: StepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const valueRef = useRef(value);
  const timer = useRef<number | undefined>(undefined);
  const repeated = useRef(false);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const step = (delta: number): number => {
    const next = clampInt(valueRef.current + delta, min, max);
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChange(next);
    }
    return next;
  };

  const stopRepeat = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const startRepeat = (delta: number, event: PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (event.button !== 0) return;
    stopRepeat();
    repeated.current = false;
    let interval = FIRST_REPEAT_MS;
    const tick = () => {
      repeated.current = true;
      const next = step(delta);
      if (next <= min || next >= max) {
        stopRepeat();
        return;
      }
      interval = Math.max(FASTEST_REPEAT_MS, interval * 0.85);
      timer.current = window.setTimeout(tick, interval);
    };
    timer.current = window.setTimeout(tick, HOLD_DELAY_MS);
  };

  const endRepeat = () => {
    stopRepeat();
    suppressClick.current = repeated.current;
    repeated.current = false;
  };

  const cancelRepeat = () => {
    stopRepeat();
    repeated.current = false;
  };

  const click = (delta: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    step(delta);
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(parsed)) {
      const next = clampInt(parsed, min, max);
      valueRef.current = next;
      if (next !== value) onChange(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setDraft(null);
      step(event.key === 'ArrowUp' ? 1 : -1);
    }
  };

  const preventContextMenu = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => click(-1)}
        onPointerDown={(event) => startRepeat(-1, event)}
        onPointerUp={endRepeat}
        onPointerLeave={cancelRepeat}
        onPointerCancel={cancelRepeat}
        onContextMenu={preventContextMenu}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        id={id}
        className="stepper__value"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        role="spinbutton"
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        value={draft ?? String(value)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.currentTarget.value.replace(/\D/g, '').slice(0, String(max).length))}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="stepper__button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => click(1)}
        onPointerDown={(event) => startRepeat(1, event)}
        onPointerUp={endRepeat}
        onPointerLeave={cancelRepeat}
        onPointerCancel={cancelRepeat}
        onContextMenu={preventContextMenu}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
