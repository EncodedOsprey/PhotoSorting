interface ProgressBarProps {
  /** 0…1 */
  value: number;
  label: string;
  valueText?: string;
  className?: string;
}

export function ProgressBar({ value, label, valueText, className }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={className ? `progress ${className}` : 'progress'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
    >
      <div className="progress__bar" style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
