import { useEffect, useState } from "react";

export function AssistantResizeHandle({ width, onChange }) {
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const maximum = Math.max(320, viewport - 360);
  const actual = Math.min(maximum, Math.max(320, width));
  const update = (value) => onChange(Math.min(maximum, Math.max(320, value)));
  return <div className={`assistant-resize-handle${dragging ? " dragging" : ""}`}
    role="separator" aria-label="アシスタントの幅" aria-orientation="vertical"
    aria-valuemin={320} aria-valuemax={maximum} aria-valuenow={actual}
    aria-valuetext={`${actual}ピクセル`} tabIndex={0}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={(event) => { if (dragging) update(window.innerWidth - event.clientX); }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
    onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
    onKeyDown={(event) => {
      const next = event.key === "ArrowLeft" ? actual + 24 : event.key === "ArrowRight" ? actual - 24 : event.key === "Home" ? 320 : event.key === "End" ? maximum : null;
      if (next !== null) { event.preventDefault(); update(next); }
    }} />;
}
