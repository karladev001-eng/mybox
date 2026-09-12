import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createImageStudioApp } from "../src/image-studio/app.js";
import { ImageStudioView } from "../src/image-studio/ImageStudioView.jsx";
import "../src/styles.css";

// Optional local JSON: {state: {templates: [], generations: []}, resourceId, data}.
// All record/provider writes are disabled; imported data stays in browser memory.
function runtimeFor(snapshot, failed) {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createImageStudioApp({ recordStore: {
    load: async () => {
      if (failed) throw new Error("QA: 履歴の読み込み失敗");
      return snapshot?.state ?? { schemaVersion: 1, templates: [], generations: [] };
    },
    save: async () => { throw new Error("QA: record writes disabled"); },
  }, generator: { generate: async () => { throw new Error("QA: provider disabled"); } } }));
  return { host, readImageRecordResource: async id => {
    if (id === snapshot?.resourceId) return snapshot.data;
    throw new Error("QA: preview original not supplied");
  } };
}
function Preview() {
  const [snapshot, setSnapshot] = useState(null);
  const [failed, setFailed] = useState(true);
  const [runtime, setRuntime] = useState(() => runtimeFor(null, true));
  const [version, setVersion] = useState(0);
  function reset(next, failure) { setSnapshot(next); setFailed(failure); setRuntime(runtimeFor(next, failure)); setVersion(v => v + 1); }
  return <>
    <div style={{ position: "fixed", bottom: 0, left: 0, zIndex: 1000, background: "var(--surface)", color: "var(--text)", padding: 8 }}>
      <label><input type="checkbox" checked={failed} onChange={e => reset(snapshot, e.target.checked)} />QA 履歴エラー</label>
      <label>検証コピー<input type="file" accept="application/json,.json" onChange={async e => { const file = e.target.files[0]; if (file) reset(JSON.parse(await file.text()), false); }} /></label>
      <button onClick={() => reset(snapshot, failed)}>QA 開き直す</button>
    </div>
    <ImageStudioView key={version} appRuntime={runtime} />
  </>;
}
createRoot(document.getElementById("root")).render(<Preview />);
