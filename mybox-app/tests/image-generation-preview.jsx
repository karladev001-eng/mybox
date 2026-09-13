import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createImageStudioApp } from "../src/image-studio/app.js";
import { ImageStudioView } from "../src/image-studio/ImageStudioView.jsx";
import "../src/styles.css";

const controls = { fail: false, calls: 0 };
const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#203330"/><text x="256" y="270" text-anchor="middle" fill="#9cdecb" font-size="56">QA</text></svg>');
host.register(createImageStudioApp({ generator: { generate: async () => {
  controls.calls++;
  await new Promise(resolve => setTimeout(resolve, 5000));
  if (controls.fail) throw new Error("QA: simulated provider failure");
  return {resource:{appId:"knowledge",resourceId:`knowledge-file:qa:${controls.calls}`,mediaType:"image/svg+xml"},actual:{width:512,height:512}};
} } }));
const runtime = { host, readImageRecordResource: async () => image };
function Preview() {
  const [shown, setShown] = useState(true);
  const [light, setLight] = useState(false);
  return <>
    {shown && <ImageStudioView appRuntime={runtime} onClose={() => setShown(false)} />}
    <div style={{position:"fixed",bottom:0,left:0,zIndex:1000,padding:8,background:"var(--surface)",color:"var(--text)"}}>
      <label><input type="checkbox" onChange={e => controls.fail=e.target.checked} />QA 生成失敗</label>
      <button onClick={() => setShown(value => !value)}>{shown ? "QA Imageを閉じる" : "QA Imageを開く"}</button>
      <button onClick={() => { document.documentElement.dataset.theme=light?"graphite":"light";setLight(!light); }}>QA テーマ切替</button>
    </div>
  </>;
}
createRoot(document.getElementById("root")).render(<Preview />);
