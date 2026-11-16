import type { CSSProperties } from 'react';

interface SliderProps {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Visible label element id. */
  labelledBy: string;
  /** Spoken description of the current value. */
  valueText: string;
  minLabel: string;
  maxLabel: string;
}

export function Slider({ id, value, onChange, min = 0, max = 1, step = 0.05, labelledBy, valueText, minLabel, maxLabel }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider">
      <input
        id={id}
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-labelledby={labelledBy}
        aria-valuetext={valueText}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="slider__labels" aria-hidden="true">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
