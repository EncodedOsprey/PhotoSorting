// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planZip } from '../../lib/zip';
import type { ZipPartsState } from './useSaveActions';
import { ZipPartsSheet } from './ZipPartsSheet';

afterEach(cleanup);

const MB = 1024 * 1024;
const files = Array.from({ length: 6 }, (_, index) => new File([], `IMG_${index}.JPG`));
// Six 45 MB photos: two ZIP files, of photos 1–4 and 5–6.
const plan = planZip(files.map((file) => ({ name: file.name, size: 45 * MB })));

function renderSheet(state: Partial<ZipPartsState>) {
  const onDownload = vi.fn();
  render(
    <ZipPartsSheet
      state={{ files, plan, offset: 0, downloaded: new Set(), zipping: null, ...state }}
      onDownload={onDownload}
      onClose={() => {}}
    />,
  );
  const rows = within(screen.getByRole('dialog', { name: 'Download 6 Photos' })).getAllByRole('listitem');
  return { rows, buttons: rows.map((row) => within(row).getByRole('button')), onDownload };
}

describe('ZipPartsSheet', () => {
  it('lists each ZIP file with its photos and size, and explains why there are several', () => {
    const { rows, buttons, onDownload } = renderSheet({ reason: 'Saving to Photos isn’t available in this browser.', offset: 40 });
    expect(screen.getByRole('dialog').textContent).toContain(
      'Saving to Photos isn’t available in this browser. One ZIP file with all 6 photos would be too big for iPhone',
    );
    const text = (selector: string) => rows.map((row) => row.querySelector(selector)?.textContent);
    expect(text('.row__label')).toEqual(['Photos 41–44', 'Photos 45–46']);
    expect(text('.row__detail')).toEqual(['189 MB', '94 MB']);
    expect(buttons.map((button) => button.textContent)).toEqual(['Download', 'Download']);
    buttons[1].click();
    expect(onDownload).toHaveBeenCalledWith(1);
  });

  it('shows progress on the part being zipped, with every button disabled, and marks downloaded parts', () => {
    const { rows, buttons } = renderSheet({ downloaded: new Set([0]), zipping: { part: 1, completed: 1, total: 2 } });
    expect(rows[0].textContent).toContain('Downloaded');
    expect(rows[1].textContent).not.toContain('Downloaded');
    expect(buttons.map((button) => button.textContent)).toEqual(['Download', 'Zipping 1 of 2']);
    expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
