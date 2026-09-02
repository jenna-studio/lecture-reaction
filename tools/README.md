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
