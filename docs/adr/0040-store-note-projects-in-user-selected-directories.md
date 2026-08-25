# ADR 0040: Store Note Projects in User-selected directories

- Status: Accepted
- Date: 2026-08-25

## Context

Note initially keeps every Project in the App's common local state. Users need
to choose a different authoritative location for one Project, including a
directory managed by Google Drive, OneDrive, Dropbox, or Syncthing, and open the
same Project store from another device.

This is independent from collaboration. A Project stored in Google Drive may
also be shared through the Cloudflare sync server, and a Project kept inside
MyBox may be shared in the same way.

Putting one mutable database or JSON file in a synchronized directory is unsafe:
desktop cloud clients replace whole files and create conflicted copies without
database locking. The Project store therefore needs a file layout whose writes
can be merged instead of overwritten.

## Decision

**Every Note Project has one authoritative Project store.** Its
location is either MyBox's private application-data directory or a directory the
User selects. Existing Projects that still live only in the common App JSON are
seeded into individual Project stores under the Note workspace when first listed.

A Project store contains a non-secret versioned manifest and append-only Yjs
update files. Every write has a globally unique filename, so two offline devices
never replace the same object. Opening an existing Project store attaches its
stable Project ID to the device's local catalog; Yjs reconstructs and merges the
Project from the files delivered by the cloud desktop client.

The native Host owns Project-store paths, validates manifests and symlinks, and
performs bounded atomic file access. Note receives the current path only for the
User-facing Project settings row; App Operations receive no path. Update
transport still uses only opaque update IDs/bytes. Changing the location copies
the existing update set and writes a full current Page snapshot to the new store
before the Host switches its local catalog record. The old directory is retained
as a recoverable copy and is never deleted implicitly.

Each Project store has its own directory, named exactly after the Project. A
selected directory is the parent of that Project directory; the Host does not
insert a shared wrapper directory or expose the stable Project ID as its folder
name. Names that are not safe as one Windows directory component are rejected
before any store is created. Renaming a Project copies its store to a sibling
directory with the new name and then switches the catalog, retaining the prior
directory as a recoverable copy under the same rule as a location change.

**Cloudflare sharing is a separate transport on the same Yjs document.** A
Project-store transport persists every document update, while the WebSocket
transport exchanges the same updates with authorized collaborators. Either or
both may be connected. An update arriving from Cloudflare is persisted to the
Project store; an update arriving through a cloud-backed Project store is sent
to Cloudflare when collaboration is enabled.

Cloud storage account authentication and file delivery remain the responsibility
of Google Drive Desktop or the equivalent client. Cloudflare continues to own
member roles, invitations, presence, and immediate delivery between different
accounts.

## Consequences

- "保存場所" and "共同編集" are independent controls.
- The same Project folder can be opened on another device without Cloudflare.
- A cloud-stored Project can simultaneously use Cloudflare collaboration.
- Cloud-directory delivery is eventually consistent; Cloudflare remains the
  live collaboration path.
- The selected storage provider can read unencrypted Project content.
- Append-only updates grow over time. Safe compaction requires a retention and
  device-acknowledgement design and is deferred.

## Implementation notes

- Project設定ではWindowsの内部的な拡張長パス接頭辞（`\\?\`）を表示から除き、通常のドライブパスまたはUNCパスとして示す。保存先の解決やファイルアクセスには正規化前の`PathBuf`を使い続ける。
- 保存場所の変更では、未共有でApp内部JSONだけにあるProjectもTrashを含む全PageをYjsスナップショットへ変換し、Native Hostが新しいProjectディレクトリへ書き終えてから接続設定を切り替える。
- 旧実装の`MyBox Projects/<Project ID>`ディレクトリは起動時のstore一覧で検出する。Note clientがローカルJSONの全Pageをスナップショット化してProject名のディレクトリへコピーし、接続先を自動更新する。
- 共通`apps/knowledge/state.json`だけに残る既存Projectもworkspaceの復元完了後のstore一覧読み込み時に検出し、Trashを含む全Pageを`apps/knowledge/<Project名>`へ書いてからProject storeとして登録する。旧App-data内storeも同じworkspace配下へ移す。
- Project storeへ接続した後のPage作成・一覧・件数はローカルJSONではなく同じYjs documentを参照する。これにより保存先移行後のPageが一覧から消えたり、見えないローカルPageとタイトル競合したりしない。
- Project storeまたはCloudflareへ接続したProjectのTrash移動・復元・完全削除も同じYjs documentへ適用する。ローカルJSONのrevisionやPage有無を判定に使わない。
- メンバー設定はアカウント名、Role、色を固定列にした表として表示し、共有中のOwnerは見出し横の招待ボタンから既存の一度限り招待フローを開く。

`src-tauri/src/project_stores.rs` owns manifests, paths, location changes, and
bounded atomic update files. `src/desktop/project-stores.js` owns the native
directory picker. `knowledge/project-store-client.js` persists the same Yjs
document that `sync-client.js` exchanges with Cloudflare. `client.js` composes
both transports without exposing either one to App Operations. The settings UI
may request the active local path from the native bridge for display only.
