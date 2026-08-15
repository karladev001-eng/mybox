# Tauri Desktop Host

This package turns the React client into the MyBox desktop application and owns
native security boundaries.

- `tauri.conf.json`: window, build, and bundle configuration.
- `Cargo.toml`: Rust dependencies and package metadata.
- `src/`: application entry point and native commands.
- `capabilities/`: permissions granted to the main window.
- `icons/`: generated desktop application icons.

Read `src/README.md` for workspace persistence work and `capabilities/README.md`
before adding a native plugin. App-specific business logic does not belong here.
