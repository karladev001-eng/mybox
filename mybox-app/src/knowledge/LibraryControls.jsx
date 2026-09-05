import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DownloadSimple, FilePlus } from "@phosphor-icons/react";
import { RecordAction } from "../RecordAction.jsx";
import { MAX_FILE_BYTES } from "./library.js";
const PdfPreview = lazy(() => import("./PdfPreview.jsx"));

export function LibraryToolbar({ projectId, client, readOnly, onCreated, onError }) {
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  return <div className="file-import-action">
    <RecordAction label="Fileを取り込む（20 MBまで）" icon={FilePlus} disabled={readOnly || busy} onClick={() => fileInput.current?.click()} />
    <input ref={fileInput} type="file" hidden onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true);
      try {
        if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("空ではない20 MB以下のFileを選択してください");
        const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Fileを読み込めません")); reader.readAsDataURL(file); });
        const { page } = await client.invoke("knowledge.file.import.v1", { projectId, fileId: `file-${crypto.randomUUID()}`, name: file.name, base64 });
        await onCreated(page);
      } catch (error) { onError(error.message); } finally { setBusy(false); }
    }} />
    {busy && <small role="status">保存中…</small>}
  </div>;
}

export function LibraryDetails({ page, client }) {
  const [original, setOriginal] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    if (page.kind !== "file") return;
    let active = true, url;
    client.invoke("knowledge.file.read.v1", { projectId: page.projectId, pageId: page.id }).then((file) => {
      if (!active) return;
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
      setOriginal({ ...file, url });
    }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [client, page.id, page.projectId, page.kind]);
  if (page.kind !== "file") return null;
  return <section className="library-details library-file" aria-label="File表示">
    {error ? <p role="alert">{error}</p> : !original ? <p role="status">Fileを表示しています…</p> : <>
      {original.mediaType.startsWith("image/") ? <img src={original.url} alt={original.name} /> : original.mediaType === "application/pdf" ? <Suspense fallback={<p role="status">PDFを準備しています…</p>}><PdfPreview base64={original.base64} name={original.name} /></Suspense> : <p>この形式は原本をダウンロードして開けます。</p>}
      <RecordAction icon={DownloadSimple} label="原本をダウンロード" onClick={() => { const anchor = document.createElement("a"); anchor.href = original.url; anchor.download = original.name; anchor.click(); }} />
    </>}
  </section>;
}
