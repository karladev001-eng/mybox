# Desktop Icons

Contains application icons generated from `../app-icon.png`. Re-run
`npm exec tauri icon src-tauri/app-icon.png` when the source artwork changes;
do not edit generated raster and platform icon files manually.

The source keeps its opaque light plate on purpose. A transparent dark mark
disappears against a dark taskbar, which is where this icon is actually seen.
The in-app mark in `../../public/assets/` is the transparent light-ink variant
for the dark shell.
