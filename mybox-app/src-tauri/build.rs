use std::path::Path;
use std::process::Command;

fn main() {
    build_sync_server();
    tauri_build::build()
}

/// Bundles `sync-server/` into the single-file Worker script `cloudflare.rs`
/// embeds via `include_str!`. Only rebuilds if dependencies are already
/// installed — this must never perform a network install during
/// `cargo build` — so CI and release builds run `npm ci` in `sync-server/` as
/// an explicit prior step (see `.github/workflows/release.yml`).
fn build_sync_server() {
    let sync_server_dir = Path::new("../../sync-server");
    println!("cargo:rerun-if-changed={}", sync_server_dir.join("src").display());
    println!("cargo:rerun-if-changed={}", sync_server_dir.join("package.json").display());

    let bundle = sync_server_dir.join("dist/worker.js");
    if sync_server_dir.join("node_modules").exists() {
        let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
        match Command::new(npm).args(["run", "build"]).current_dir(sync_server_dir).status() {
            Ok(status) if status.success() => {}
            Ok(status) => println!(
                "cargo:warning=sync-server build exited with {status}; using its existing dist/worker.js if present"
            ),
            Err(error) => println!("cargo:warning=could not run npm to build sync-server: {error}"),
        }
    }

    if !bundle.exists() {
        panic!(
            "{} is missing. Run `npm install && npm run build` in sync-server/ before building src-tauri.",
            bundle.display(),
        );
    }
}
