import { useEffect, useMemo, useRef, useState } from "react";
import { pageHeadings } from "./page-outline.js";

export function PageOutline({ page }) {
  const entries = useMemo(() => pageHeadings(page.blocks), [page.blocks]);
  const [open, setOpen] = useState(false), [active, setActive] = useState(null);
  const root = useRef(null);
  useEffect(() => {
    const editor = root.current?.closest(".knowledge-editor");
    if (!editor) return;
    const update = () => {
      const top = editor.getBoundingClientRect().top + 110;
      let current = entries[0]?.id;
      for (const entry of entries) {
        const element = document.getElementById(`record-${entry.id}`);
        if (element && element.getBoundingClientRect().top <= top) current = entry.id;
      }
      setActive(current);
    };
    update(); editor.addEventListener("scroll", update, { passive: true });
    return () => editor.removeEventListener("scroll", update);
  }, [entries]);
  if (!entries.length) return null;
  return <nav ref={root} className="page-outline" aria-label="目次"
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); root.current.querySelector("button")?.focus(); } }}>
    <button type="button" className="page-outline-trigger" aria-label="目次を開く" aria-expanded={open} onClick={() => setOpen(true)}>
      {entries.slice(0, 24).map((entry) => <span key={entry.id} className={active === entry.id ? "active" : ""} style={{ width: 22 - (entry.level - 1) * 5 }} />)}
    </button>
    {open && <div className="page-outline-popup"><span>目次</span>{entries.map((entry) => <button key={entry.id} type="button" aria-current={entry.id === active ? "location" : undefined}
      style={{ paddingLeft: 10 + (entry.level - 1) * 12 }} onClick={() => {
        const target = document.getElementById(`record-${entry.id}`);
        target?.scrollIntoView({ block: "start" }); setActive(entry.id);
      }}>{entry.title}</button>)}</div>}
  </nav>;
}
