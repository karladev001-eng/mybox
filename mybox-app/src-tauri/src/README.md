# Native Source

- `main.rs`: thin executable entry point.
- `lib.rs`: Tauri builder, plugins, and command registration.
- `workspace.rs`: workspace selection plus app-scoped JSON persistence.

Native commands are host capabilities. Validate every app ID and relative key,
reject symlinks and path traversal, and never accept an unrestricted path from an
app operation.
