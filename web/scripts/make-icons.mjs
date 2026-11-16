// Draws the PhotoSorting app icon as SVG and rasterizes it with Playwright's Chromium.
// Usage (from web/): node scripts/make-icons.mjs
// Writes public/icons/: favicon.svg, apple-touch-icon.png (180, opaque), icon-192.png, icon-512.png and
// icon-maskable-512.png (artwork inside the maskable safe zone).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));

/** Points of a five-pointed star centred on (cx, cy). */
function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * Stacked photo cards with a gold star on an indigo → violet → pink gradient, on a 1024 canvas.
 * `scale` shrinks the artwork (not the background) for the maskable icon; `radius` rounds the corners (favicon).
 */
function iconSvg({ scale = 1, radius = 0 } = {}) {
  const artwork = `
    <g filter="url(#shadow)">
      <rect x="277" y="232" width="470" height="560" rx="40" fill="#fff" fill-opacity="0.3" transform="rotate(-13 512 512)"/>
      <rect x="277" y="232" width="470" height="560" rx="40" fill="#fff" fill-opacity="0.55" transform="rotate(9 512 512)"/>
      <g transform="rotate(-3 512 512)">
        <rect x="277" y="232" width="470" height="560" rx="40" fill="#fff"/>
        <g clip-path="url(#photo)">
          <rect x="313" y="268" width="398" height="398" fill="url(#sky)"/>
          <circle cx="606" cy="372" r="46" fill="#fff4c2"/>
          <path d="M313 666 L313 560 L420 452 L520 548 L566 506 L711 640 L711 666 Z" fill="#6d5df5"/>
          <path d="M313 666 L313 604 L392 548 L470 600 L560 560 L711 652 L711 666 Z" fill="#4338ca"/>
        </g>
      </g>
    </g>
    <g filter="url(#shadow)">
      <circle cx="726" cy="716" r="128" fill="url(#gold)" stroke="#fff" stroke-width="22"/>
      <polygon points="${starPoints(726, 722, 76, 36)}" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>
    </g>`;
  const offset = (1024 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="0.55" stop-color="#6d32e0"/>
      <stop offset="1" stop-color="#b5179e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.92" cy="0.98" r="0.75">
      <stop offset="0" stop-color="#f472b6" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#f472b6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shine" cx="0.12" cy="0.02" r="0.7">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7cc4fa"/>
      <stop offset="1" stop-color="#d9c8ff"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd84d"/>
      <stop offset="1" stop-color="#ff9f0a"/>
    </linearGradient>
    <clipPath id="photo"><rect x="313" y="268" width="398" height="398" rx="14"/></clipPath>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#1b0b4d" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="${radius}" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="${radius}" fill="url(#glow)"/>
  <rect width="1024" height="1024" rx="${radius}" fill="url(#shine)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <g transform="translate(-22 -18)">${artwork}
    </g>
  </g>
</svg>
`;
}

/** Encodes RGBA pixels as an RGB PNG (no alpha channel: iOS wants opaque touch icons). */
function encodeOpaquePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = row + 1 + x * 3;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, svg: iconSvg() },
  { file: 'icon-192.png', size: 192, svg: iconSvg() },
  { file: 'icon-512.png', size: 512, svg: iconSvg() },
  // Maskable icons may be cropped to a circle of 80% diameter; keep the artwork inside it.
  { file: 'icon-maskable-512.png', size: 512, svg: iconSvg({ scale: 0.78 }) },
];

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'favicon.svg'), iconSvg({ radius: 228 }));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { file, size, svg } of TARGETS) {
    // Draw the SVG onto a canvas at the exact size and read the pixels back.
    const pixels = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.fillStyle = '#4f46e5';
        context.fillRect(0, 0, size, size);
        context.drawImage(image, 0, 0, size, size);
        return Array.from(context.getImageData(0, 0, size, size).data);
      },
      { svg, size },
    );
    await writeFile(path.join(OUT_DIR, file), encodeOpaquePng(size, size, Uint8Array.from(pixels)));
    console.log(`icons/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
console.log('icons/favicon.svg');
