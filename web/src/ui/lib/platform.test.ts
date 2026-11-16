import { describe, expect, it } from 'vitest';
import { isIOS, isStandalone, shouldShowInstallTip } from './platform';

const iPhone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1' };
const iPadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const mac = { ...iPadOS, maxTouchPoints: 0 };
const pixel = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' };
const noMedia = () => ({ matches: false });

describe('platform', () => {
  it('detects iPhone and iPad', () => {
    expect(isIOS(iPhone)).toBe(true);
    expect(isIOS(iPadOS)).toBe(true);
    expect(isIOS(mac)).toBe(false);
    expect(isIOS(pixel)).toBe(false);
  });

  it('detects the Home Screen app', () => {
    expect(isStandalone({ ...iPhone, standalone: true }, noMedia)).toBe(true);
    expect(isStandalone(iPhone, () => ({ matches: true }))).toBe(true);
    expect(isStandalone(iPhone, noMedia)).toBe(false);
  });

  it('suggests installing only in iOS browsers', () => {
    expect(shouldShowInstallTip(iPhone, false)).toBe(true);
    expect(shouldShowInstallTip(iPhone, true)).toBe(false);
    expect(shouldShowInstallTip(pixel, false)).toBe(false);
  });
});
