# tools

## make-icon.mjs

Regenerates the app icon source from a hand-placed 32x32 pixel grid, so the
icon stays editable as pixel art rather than an opaque binary. No image
library: it scales the grid 32x and writes the PNG with `node:zlib`.

```sh
node tools/make-icon.mjs tools/icon-src.png
cd apps/overlay && pnpm exec tauri icon ../../tools/icon-src.png
```

The second command regenerates every platform size into
`apps/overlay/src-tauri/icons/`, which `tauri::generate_context!` requires at
compile time — a missing `32x32.png` fails the Rust build, not the JS build.

## build-macos-app.mjs

Packages the movable macOS app: `pnpm build:macos:app`.

```sh
pnpm build:macos:app   # -> dist/Lecture-React-macOS-Universal{,.zip}
```

It builds both Mac architectures and combines them, so one `.app` runs on Apple
Silicon and Intel. Three details are load-bearing:

- Tauri compiles each architecture separately and wants a sidecar named for each
  triple, so `build-server-binary.mjs` writes both thin servers *and* a `lipo`'d
  universal one. Tauri only copies one architecture's sidecar into the bundle, so
  this script swaps the universal binary in afterwards.
- `lipo` invalidates any signature on the slices, and Apple Silicon refuses to run
  unsigned code at all — so the finished bundle is re-signed ad hoc. That is enough
  to launch; it is not notarization, and the first open still needs right-click →
  Open.
- The archive is built with `ditto`, not `zip`. Only `ditto` keeps the bundle's
  symlinks and executable bits intact, and a mangled `.app` will not launch.
