import type { CSSProperties } from 'react';
import { clamp01 } from '../lib/format';

interface MetricBarProps {
  label: string;
  /** 0…1 */
  value: number;
  /** Shown on the right; defaults to a percentage. */
  display?: string;
  color?: string;
}

/** A labelled horizontal bar for a 0…1 score. */
export function MetricBar({ label, value, display, color }: MetricBarProps) {
  const pct = Math.round(clamp01(value) * 100);
  const text = display ?? `${pct}%`;
  return (
    <div className="metric">
      <div className="metric__top" aria-hidden="true">
        <span>{label}</span>
        <span className="metric__value">{text}</span>
      </div>
      <div
        className="metric__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={text}
      >
        <div className="metric__fill" style={{ width: `${pct}%`, ...(color ? { '--metric-color': color } : {}) } as CSSProperties} />
      </div>
    </div>
  );
}
