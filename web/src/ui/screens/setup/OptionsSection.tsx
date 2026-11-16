import { Section } from '../../components/Section';
import { Slider } from '../../components/Slider';
import { SwitchRow } from '../../components/Switch';
import { loosenessLabel, type PlanSettings } from '../../state/planSettings';

interface OptionsSectionProps {
  settings: PlanSettings;
  onChange: (update: (settings: PlanSettings) => PlanSettings) => void;
}

export function OptionsSection({ settings, onChange }: OptionsSectionProps) {
  const set = <K extends keyof PlanSettings>(key: K) => (value: PlanSettings[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  return (
    <Section id="options-title" title="Options">
      <SwitchRow
        id="option-fill"
        label="Fill the rest with best overall"
        detail="Tops up to the total with the best remaining photos."
        checked={settings.fillRemainder}
        onChange={set('fillRemainder')}
      />
      <SwitchRow
        id="option-duplicates"
        label="Avoid near-duplicates"
        detail="Keeps only the best of a burst or very similar shots."
        checked={settings.avoidNearDuplicates}
        onChange={set('avoidNearDuplicates')}
      />
      {settings.avoidNearDuplicates ? (
        <div className="row slider-row">
          <div className="slider-row__top">
            <span className="row__label" id="duplicate-sensitivity-label">
              Duplicate sensitivity
            </span>
            <span className="slider-row__value" aria-hidden="true">
              {loosenessLabel(settings.duplicateLooseness)}
            </span>
          </div>
          <Slider
            id="duplicate-sensitivity"
            labelledBy="duplicate-sensitivity-label"
            value={settings.duplicateLooseness}
            valueText={loosenessLabel(settings.duplicateLooseness)}
            minLabel="Nearly identical"
            maxLabel="Same scene"
            onChange={set('duplicateLooseness')}
          />
        </div>
      ) : null}
      <SwitchRow
        id="option-blurry"
        label="Skip blurry photos"
        detail="Leaves out photos that are out of focus or shaken."
        checked={settings.skipBlurry}
        onChange={set('skipBlurry')}
      />
      <SwitchRow
        id="option-closed-eyes"
        label="Skip closed eyes"
        detail="Leaves out photos where someone’s eyes are closed."
        checked={settings.skipClosedEyes}
        onChange={set('skipClosedEyes')}
      />
    </Section>
  );
}
