import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { RecordAction } from "../RecordAction.jsx";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ base64, name }) {
  const [pdf, setPdf] = useState(null), [pageNumber, setPageNumber] = useState(1), [width, setWidth] = useState(640), [error, setError] = useState("");
  const wrap = useRef(null), canvas = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    if (wrap.current) observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    const task = getDocument({ data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), isEvalSupported: false, useSystemFonts: true, useWorkerFetch: false });
    task.onPassword = () => { if (active) setError("パスワード付きPDFは原本をダウンロードして開いてください。"); task.destroy(); };
    task.promise.then((value) => { if (active) setPdf(value); }).catch(() => { if (active) setError((previous) => previous || "PDFを表示できません。原本をダウンロードして確認してください。"); });
    return () => { active = false; task.destroy(); };
  }, [base64]);
  useEffect(() => {
    if (!pdf) return;
    let active = true, render;
    pdf.getPage(pageNumber).then(async (page) => {
      if (!active || !canvas.current) return;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(width / original.width, 4000 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4000 / Math.max(viewport.width, viewport.height));
      const target = canvas.current;
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      render = page.render({ canvasContext: target.getContext("2d"), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
    }).catch((reason) => { if (active && reason.name !== "RenderingCancelledException") setError("PDFのページを表示できません。"); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, pageNumber, width]);
  return <div ref={wrap} className="pdf-preview">
    {error ? <p role="alert">{error}</p> : <>
      {!pdf && <p role="status">PDFを表示しています…</p>}
      {pdf?.numPages > 1 && <div className="record-actions" aria-label="PDFのページ移動">
        <RecordAction icon={CaretLeft} label="PDFの前のページ" disabled={pageNumber === 1} onClick={() => setPageNumber((n) => n - 1)} />
        <span>{pageNumber} / {pdf.numPages}</span>
        <RecordAction icon={CaretRight} label="PDFの次のページ" disabled={pageNumber === pdf.numPages} onClick={() => setPageNumber((n) => n + 1)} />
      </div>}
      <canvas key={pageNumber} ref={canvas} role="img" aria-label={`${name}・${pageNumber}ページ`} />
    </>}
  </div>;
}
