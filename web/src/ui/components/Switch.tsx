import type { ReactNode } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** id of the element that labels this switch (tapping a <label htmlFor> toggles it too). */
  id?: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
}

/** An iOS-style on/off switch. */
export function Switch({ checked, onChange, id, label, labelledBy, describedBy, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}

interface SwitchRowProps {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A list row with a label and a switch; tapping the label toggles the switch. */
export function SwitchRow({ id, label, detail, icon, checked, onChange, disabled }: SwitchRowProps) {
  return (
    <div className={icon ? 'row row--icon' : 'row'}>
      {icon}
      <div className="row__text">
        <label className="row__label" id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        {detail ? (
          <span className="row__detail" id={`${id}-detail`}>
            {detail}
          </span>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-label`}
        describedBy={detail ? `${id}-detail` : undefined}
        disabled={disabled}
      />
    </div>
  );
}
