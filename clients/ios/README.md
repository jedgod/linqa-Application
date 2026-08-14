# Linqa iOS Client

Native iOS client for Linqa.

## Status

**UI shell with mock data — Swift sources only, no `.xcodeproj` yet.** This repo was authored outside Xcode/macOS, so a `project.pbxproj` was not hand-generated (too easy to corrupt without Xcode to verify it). The SwiftUI source itself is a complete, functional UI, not a placeholder screen.

- Conversation list, chat screen, and settings/device-management screen are functional against in-memory mock data (`Services/MockData.swift`), using `NavigationStack` for push navigation and a sheet for settings
- `Services/CoreBridge.swift` mirrors the `async` API the real UniFFI-generated bindings will expose, so swapping in the real core later shouldn't require UI changes
- Rust core is not yet compiled for iOS (requires Xcode + UniFFI) — no native library is linked
- No network / transport layer

### To open this in Xcode

1. File → New → Project → iOS App named `Linqa`, interface **SwiftUI**, in this `ios/` directory (or point it here) — this generates `Linqa.xcodeproj`.
2. Delete the auto-generated `ContentView.swift`/`LinqaApp.swift` and drag the existing `Linqa/` folder (Models, Services, Views) into the project navigator, "Create groups", targeting the app target.
3. Set the deployment target to iOS 17+ (the views use `NavigationStack.navigationDestination` and two-parameter `onChange`).

## Planned Architecture

```
ios/
├── Linqa/
│   ├── LinqaApp.swift          # @main entry
│   ├── Views/                  # SwiftUI views + theme + shared components
│   ├── Services/               # CoreBridge, MockData, Format
│   ├── Models/
│   └── Resources/
├── Linqa.xcodeproj/            # (to be generated in Xcode — see above)
├── LinqaTests/
└── README.md
```

## Dependencies (planned)

- Swift + SwiftUI
- linqa-core via UniFFI-generated Swift bindings
- Static / dynamic library built for `iphoneos` + `iphonesimulator` (and optionally Mac Catalyst)

## Integration with Rust Core

1. Build `linqa-core` as a static or dynamic library for iOS architectures.
2. Generate Swift bindings from `core/uniffi/linqa_core.udl`.
3. Add the generated module and the native library to the Xcode project.
4. All cryptographic operations go through the generated Swift API; the UI never implements crypto itself.

## Current Blockers

- No Xcode / iOS SDK in the present environment
- Real OpenMLS + hybrid PQC provider not implemented
- No server / relay to talk to

See the top-level `docs/` and `core/uniffi/` for the shared design.
