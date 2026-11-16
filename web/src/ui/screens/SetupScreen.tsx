import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { InstallTip } from '../components/InstallTip';
import { ScreenHeader } from '../components/ScreenHeader';
import { findStatus } from '../lib/findStatus';
import type { PlanSettings } from '../state/planSettings';
import { CategoriesSection } from './setup/CategoriesSection';
import { OptionsSection } from './setup/OptionsSection';
import { PhotosSection } from './setup/PhotosSection';
import { TotalSection } from './setup/TotalSection';

interface SetupScreenProps {
  settings: PlanSettings;
  onSettingsChange: (update: (settings: PlanSettings) => PlanSettings) => void;
  photoCount: number;
  processedCount: number;
  onAddFiles: (files: File[]) => void;
  onClearPhotos: () => void;
  onFind: () => void;
  /** Shown above everything else (the app update banner). */
  banner?: ReactNode;
}

export function SetupScreen({
  settings,
  onSettingsChange,
  photoCount,
  processedCount,
  onAddFiles,
  onClearPhotos,
  onFind,
  banner,
}: SetupScreenProps) {
  const status = findStatus(photoCount, processedCount, settings);
  return (
    <div className="screen" data-screen="setup">
      <div className="screen__backdrop" aria-hidden="true" />
      <ScreenHeader
        title="PhotoSorting"
        subtitle="Pick the best photos from your shoot. Everything happens on this iPhone — photos are never uploaded."
      />
      <main className="screen__content">
        <SetupBanners banner={banner} />
        <PhotosSection count={photoCount} processedCount={processedCount} onAddFiles={onAddFiles} onClear={onClearPhotos} />
        <TotalSection settings={settings} onChange={onSettingsChange} />
        <CategoriesSection settings={settings} onChange={onSettingsChange} />
        <OptionsSection settings={settings} onChange={onSettingsChange} />
      </main>
      <div className="bottom-bar">
        <div className="bottom-bar__inner">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={status.blocked}
            aria-describedby="find-note"
            onClick={onFind}
          >
            <Sparkles aria-hidden="true" />
            Find Best Photos
          </button>
          <p id="find-note" className="bottom-bar__note" aria-live="polite">
            {status.note}
          </p>
        </div>
      </div>
    </div>
  );
}

function SetupBanners({ banner }: { banner?: ReactNode }) {
  return (
    <div className="group banner-group">
      {banner}
      <InstallTip />
    </div>
  );
}
