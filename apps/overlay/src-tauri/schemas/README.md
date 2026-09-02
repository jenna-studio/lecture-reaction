# schemas/

`tauri-config.schema.json` is a vendored copy of <https://schema.tauri.app/config/2>.

`tauri.conf.json` points at it rather than the URL so the editor resolves the
schema offline and without VS Code's Workspace Trust, which blocks remote
schema downloads in Restricted Mode.

Refresh it when upgrading Tauri:

```sh
curl -fsSL https://schema.tauri.app/config/2 \
  -o apps/overlay/src-tauri/schemas/tauri-config.schema.json
```

Note this is NOT the same as `gen/schemas/desktop-schema.json`, which is the
*capability* schema (`CapabilityFile`) used by `capabilities/*.json`.
