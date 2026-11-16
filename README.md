# PhotoSorting

PhotoSorting looks through the photos from a shoot and picks the best ones for you, in categories such as best smiles, eyes open, sharpest and best exposure. You choose how many photos you want in total and how many from each category. All analysis runs on your iPhone, and your photos are never uploaded anywhere.

There are two versions:

- **Web app (recommended, no Mac needed):** runs in Safari on any iPhone and can be added to the Home Screen like a normal app. Open **https://encodedosprey.github.io/PhotoSorting/**.
- **Native iOS app:** a SwiftUI app that reads albums and date ranges straight from the Photos library. It needs a Mac with Xcode to install. See [Native iOS app](#native-ios-app-needs-a-mac).

## Use it on your iPhone

1. Open **https://encodedosprey.github.io/PhotoSorting/** in **Safari**.
2. Optional: tap **Share**, then **Add to Home Screen**. PhotoSorting then opens full screen like an app and works offline after the first visit.
3. Tap **Choose Photos**. In the photo picker, use **Search** (for example a date, place or person) or **Albums** to find the shoot. Tap **Select All**, or drag a finger across the photos to select many at once.
4. Under **What to Pick**, set **Total photos** and how many you want from each category, and turn options on or off.
5. Tap **Find Best Photos**. Keep the screen on while it works; analysis speed depends on your iPhone.
6. Review **Your Picks**. Tap a photo to see its scores or swap it for an alternative.
7. Tap **Save Photos** and choose **Save Images** in the share sheet. iPhone saves up to 40 photos at a time, so larger selections are split into batches. You can also **Download ZIP** or **Copy File Names** (handy for finding the picks in Lightroom or another editor). Picks over 200 MB download as several ZIP files, one tap each, so Safari doesn't run out of memory.

Saving creates new copies in your Photos library. Your original photos are never changed or deleted.

## Features

### Categories

| Category | What it looks for |
| --- | --- |
| Best Smiles | Everyone smiling, with eyes open |
| Eyes Open | No blinks: every face has open eyes |
| Sharpest Focus | Crisp focus with no motion blur |
| Best Exposure | Balanced brightness, no blown highlights or crushed shadows |
| Group Shots | Three or more people, all looking good |
| Portraits | One or two people, close up, high face quality |
| Scenery & Details | Venue, decor, detail and landscape shots without faces |
| Best Overall | Highest combined quality score |

### Counts and options
- A **total count** plus a **count for each category**. Categories are filled in **priority order**.
- **Fill the rest with best overall**: if the category counts add up to less than the total, the remaining slots go to the best overall photos.
- **Avoid near-duplicates**: skips shots that look almost the same as one already picked, such as burst shots or retakes.
- **Skip blurry photos** and **Skip closed eyes** remove those shots before anything is picked.

## Privacy

All analysis runs on your device. In the web app it runs inside Safari using Google's MediaPipe face landmark model and canvas-based image measurements. The site is a set of static files that includes the face model, so there is no server to send photos to and your photos never leave your iPhone.

## How selection works

1. The app analyzes each photo and scores it for every category.
2. If hard filters are on, it removes blurry shots and closed-eye shots first.
3. It works through the categories in priority order. For each category, it picks the top-scoring eligible photos that haven't been chosen yet, until that category's count is met. When near-duplicate avoidance is on, it skips photos that are too similar to one already picked.
4. If the total isn't reached yet, it fills the rest with the best overall photos, using the same duplicate rules.
5. If a category or the total can't be filled with eligible photos, the app reports the shortfall.

## Project structure

```
web/                      Web app (React + TypeScript + Vite PWA)
  src/core/               Platform-independent scoring and selection (port of PhotoSortingCore)
  src/analysis/           In-browser photo analysis (MediaPipe faces, sharpness, exposure, similarity)
  src/ui/                 Screens, components and app state
  e2e/                    Playwright tests (WebKit and Chromium) and public-domain test photos
  scripts/                Asset preparation (MediaPipe WASM and face model)
PhotoSorting/             Native iOS app (SwiftUI)
PhotoSortingCore/         Swift package with platform-independent logic, plus unit tests
project.yml               XcodeGen project spec for the native app
.github/workflows/web.yml Web app CI and GitHub Pages deployment
.github/workflows/ci.yml  Native CI: core tests on Linux, iOS app build on macOS
```

## Web app development

Requires Node.js 24 LTS (24.15 or later).

```sh
cd web
npm ci
npm run dev          # http://localhost:5173 (first run downloads the face model)
npm test             # unit tests (Vitest)
npm run lint
npm run typecheck
npx playwright install --with-deps webkit chromium
npm run test:e2e     # browser tests: analysis engine and app, in WebKit (iPhone) and Chromium
npm run build        # production build in web/dist
```

`npm run dev` and `npm run build` first run `scripts/prepare-assets.mjs`. It copies the MediaPipe WASM runtime into `public/mediapipe/` and downloads Google's `face_landmarker.task` model, checking it against a pinned SHA-256 hash. To work offline, set `FACE_MODEL_PATH=/path/to/face_landmarker.task`.

Every push to `main` that changes `web/` runs `.github/workflows/web.yml`. It runs the tests, builds the site and deploys it to GitHub Pages. This requires **Settings → Pages → Source: GitHub Actions**.

## Native iOS app (needs a Mac)

The native app reads albums or a date range directly from the Photos library and can save the picks to a new album or mark them as Favorites.

### Requirements

- Xcode 16 or later
- iPhone running iOS 17 or later (the app supports iPhone only)
- Aesthetics scoring uses the iOS 18 Vision API when it's available. On iOS 17 the app uses the other signals.

### Run on your iPhone

1. Open `PhotoSorting.xcodeproj` in Xcode.
2. Select the **PhotoSorting** target. Under **Signing & Capabilities**, choose your **Team**. A free Apple ID works.
3. Connect your iPhone and select it as the run destination.
4. The first time you run on a device, turn on **Developer Mode** on the iPhone. Go to **Settings → Privacy & Security → Developer Mode**, turn it on, then restart the iPhone and confirm. With a free account, you might also need to trust the developer under **Settings → General → VPN & Device Management**.
5. Press **Run** (⌘R).

The Xcode project is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen). To regenerate it:

```sh
brew install xcodegen
xcodegen generate
```

### Running the Swift core tests

```sh
cd PhotoSortingCore
swift test
```

These tests run on macOS or Linux and don't need Xcode.
