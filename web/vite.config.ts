import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the same build works at any path (e.g. https://<user>.github.io/PhotoSorting/).
  base: './',
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the photographer taps Reload (src/ui/pwa/useAppUpdate.ts), so an update can never
      // reload the page in the middle of an analysis.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'PhotoSorting',
        short_name: 'PhotoSorting',
        description: 'Pick the best photos from a shoot, right on your iPhone. Photos never leave your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#4338ca',
        theme_color: '#4338ca',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything, including the ~19 MB analysis engine (public/mediapipe: WASM runtime + face model;
        // public/models: eye models), so analysis works offline once the app has been opened online, even if no
        // analysis ran then. Unchanged files keep their revision, so updates don't download the engine again.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,wasm,task,onnx}'],
        maximumFileSizeToCacheInBytes: 24 * 1024 * 1024,
        // Control the page that installed the service worker right away, not just after a reload. Updates still wait
        // for the photographer to tap Reload.
        clientsClaim: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
