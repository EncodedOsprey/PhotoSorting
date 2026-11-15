# PhotoSorting

PhotoSorting is a SwiftUI iPhone app that looks through a photo shoot in your Photos library and picks the best shots for you, sorted into categories such as best smiles, eyes open, sharpest and best exposure. You choose how many photos you want in total and per category. All analysis runs on your iPhone using Apple's Vision and Core Image frameworks.

## Features

### Sources
- **Album**: pick an album from your library, with search.
- **Shoot date range**: analyze every photo taken between two dates.
- **Hand-pick**: choose photos with the system Photos picker, which includes Photos search.

### Categories

| Category | What it looks for |
| --- | --- |
| Best smiles | Faces with strong, natural smiles |
| Eyes open | Every detected face has its eyes open |
| Sharpest | In-focus, crisp detail with no motion blur |
| Best exposure | Balanced brightness without blown highlights or crushed shadows |
| Group shots | Photos with several people |
| Portraits | Photos with one person as the main subject |
| Scenery / no people | Photos without people |
| Best overall | A combined score across all the quality signals |

### Counts and selection controls
- **Total count** plus a **count for each category**. Categories are filled in **priority order**.
- **Remainder fill**: if the category counts add up to less than the total, the remaining slots go to the best overall photos.
- **Near-duplicate avoidance**: when this is on, the app skips shots that look almost the same as one it already picked.
- **Hard filters**: you can exclude blurry shots and shots where someone's eyes are closed.

### Results and export
- Review the picks grouped by category before you export them.
- Save the picks to a **new album** or mark them as **Favorites**.

## Privacy

All analysis runs on your iPhone. Photos never leave your device. The app asks for Photos access only to read your shoot and to save the album you request.

## Requirements

- Xcode 16 or later
- iPhone running iOS 17 or later (the app supports iPhone only)
- Aesthetics scoring uses the iOS 18 Vision API when it's available. On iOS 17 the app uses the other signals.

## Run on your iPhone

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

## How selection works

1. The app analyzes each photo in the source and scores it for every category.
2. If hard filters are on, it removes blurry shots and closed-eye shots first.
3. It works through the categories in priority order. For each category, it picks the top-scoring eligible photos that haven't been chosen yet, until that category's count is met. When near-duplicate avoidance is on, it skips photos that are too similar to one already picked.
4. If the total isn't reached yet, it fills the rest with the best overall photos, using the same duplicate rules.
5. If a category or the total can't be filled with eligible photos, the app reports the shortfall.

## Project structure

```
PhotoSorting/            iOS app (SwiftUI)
  App/                   App entry point
  Models/                App-level models and state
  Services/              Photos library access, Vision/Core Image analysis, export
  Views/                 SwiftUI screens
  Resources/             Asset catalog (app icon, accent color)
PhotoSortingCore/        Local Swift package with platform-independent logic (scoring, selection), plus unit tests
project.yml              XcodeGen project spec
.github/workflows/ci.yml CI: core tests on Linux, iOS app build on macOS
```

## Running core tests

```sh
cd PhotoSortingCore
swift test
```

These tests run on macOS or Linux and don't need Xcode.
