import { RefreshCw } from 'lucide-react';
import { TileIcon } from '../components/CategoryIcon';

/** Offers to load a new version of the app (shown on the Setup screen only). */
export function UpdateBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="card banner" role="status">
      <TileIcon Icon={RefreshCw} color="#34c759" small />
      <p className="banner__text">
        <strong>Update available</strong>
        <span>Reload to use the new version.</span>
      </p>
      <button type="button" className="btn btn--tinted btn--small" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
