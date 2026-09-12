import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { graphKey, readWorkspaceGraph, layoutWorkspaceGraph, stepWorkspaceGraph } from "./record-graph.js";
import "./record-graph.css";

const kinds = { note: "Note", conversation: "会話", context: "Context", file: "File", prompt: "Prompt", generation: "生成" };
export function RecordGraph({ client, projectId, data, onOpen, visible = true, pageWidth = 56, onPageWidthChange }) {
  const [resizing, setResizing] = useState(false);
  const resize = value => onPageWidthChange?.(Math.max(20, Math.min(80, value)));
  const [graph, setGraph] = useState(null), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [refresh, setRefresh] = useState(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [hover, setHover] = useState(null); const [pixelScale,setPixelScale]=useState(1);
  const drag = useRef(null), toggle = useRef(null), viewport = useRef(null);
  const pin = useRef(null), animation = useRef(null), skipClick = useRef(false);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  const relax = () => {
    cancelAnimationFrame(animation.current);
    let frames=0;
    const tick=()=>{ const step=frames++; const alpha=Math.pow(.95,step); setGraph(value=>value ? stepWorkspaceGraph(value,pin.current,step,alpha) : value); if(frames<105) animation.current=requestAnimationFrame(tick); };
    animation.current=requestAnimationFrame(tick);
  };
  const finishDrag = () => { if(pin.current) {pin.current=null;relax();} drag.current=null; };
  useEffect(() => { if(!visible) {cancelAnimationFrame(animation.current);pin.current=null;drag.current=null;} }, [visible]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer=new ResizeObserver(() => {const box=element.getBoundingClientRect();setPixelScale(Math.max(.1,Math.min(box.width/1000,box.height/600)));}); observer.observe(element);
    const wheel = event => {
      event.preventDefault();
      setCamera(c => ({ ...c, zoom: Math.max(.08, Math.min(12, c.zoom * (event.deltaY < 0 ? 1.12 : .89))) }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {observer.disconnect();element.removeEventListener("wheel", wheel);};
  }, [graph]);
  const fit = (result) => {
    const extent = result.nodes.reduce((extent,n) => Math.max(extent, Math.abs(n.x) * 1.5, Math.abs(n.y) * 2.5), 200) + 80;
    setCamera({ x: 0, y: 0, zoom: 700 / extent });
  };
  useEffect(() => {
    const controller = new AbortController();
    setGraph(null); setError("");
    readWorkspaceGraph(client, { signal: controller.signal }).then(result => layoutWorkspaceGraph(result, controller.signal)).then(result => {
      if (controller.signal.aborted) return;
      setGraph(result); fit(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason?.message || "グラフを読み込めませんでした"); });
    return () => controller.abort();
  }, [client, refresh]);
  const byKey = useMemo(() => new Map(graph?.nodes.map(n => [n.key, n]) ?? []), [graph]);
  const current = graphKey(projectId, data.page.id);
  const matches = node => !query || `${node.title} ${node.projectName} ${kinds[node.kind]}`.normalize("NFKC").toLocaleLowerCase().includes(query.normalize("NFKC").toLocaleLowerCase());
  const zoom = factor => setCamera(c => ({ ...c, zoom: Math.max(.08, Math.min(12, c.zoom * factor)) }));
  const open = async node => { await onOpen(node.projectId, node.pageId);  toggle.current?.focus(); };
  const action = (label, Icon, handler, disabled = false) => <button type="button" aria-label={label} data-tooltip={label} onClick={handler} disabled={disabled}><Icon size={16} aria-hidden="true" /></button>;
  return <section hidden={!visible} className="record-graph" aria-label="全Pageのグラフ">
    <div className="record-graph-divider" data-resizing={resizing} role="separator" aria-label="Pageとグラフの幅を調整" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(pageWidth)} aria-valuetext={`Page ${Math.round(pageWidth)}%`} tabIndex={0}
      onPointerDown={event => { if(event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
      onPointerMove={event => { if(!resizing) return; const bounds=event.currentTarget.closest(".knowledge-editor").getBoundingClientRect(); resize((event.clientX-bounds.left)/bounds.width*100); }}
      onPointerUp={event => { setResizing(false); if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)}
      onDoubleClick={() => resize(56)}
      onKeyDown={event => { if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return; event.preventDefault(); resize(event.key==="Home"?20:event.key==="End"?80:pageWidth+(event.key==="ArrowLeft"?-2:2)); }} />
    <header className="record-graph-toolbar">
      <label className="record-graph-search"><MagnifyingGlass size={16} aria-hidden="true" /><input ref={toggle} aria-label="グラフ内を検索" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <span>{graph ? `${graph.nodes.length} Pages · ${graph.edges.length} Links` : ""}</span>
      {action("更新", ArrowClockwise, () => setRefresh(r => r + 1), !graph && !error)}
    </header>      {error ? <p role="alert">{error}</p> : !graph ? <p role="status">読み込み中…</p> : <>
        <svg ref={viewport} className="record-graph-canvas" viewBox="-500 -300 1000 600" role="group" aria-label="Pageのつながり" tabIndex={0}
          onKeyDown={event => { const directions = { ArrowLeft: [40,0], ArrowRight: [-40,0], ArrowUp: [0,40], ArrowDown: [0,-40] }; if (event.target !== event.currentTarget) return; if (directions[event.key]) { event.preventDefault(); const [x,y] = directions[event.key]; setCamera(c => ({...c,x:c.x+x,y:c.y+y})); } if (event.key === "+" || event.key === "=") zoom(1.25); if (event.key === "-") zoom(.8); }}
          onPointerDown={event => { const target=event.target.closest('[data-node]'); const node=target ? byKey.get(target.dataset.node) : null; skipClick.current=false; if(node) {setGraph(value=>({...value,nodes:value.nodes.map(n=>({...n,anchorX:n.x,anchorY:n.y}))}));pin.current={key:node.key,x:node.x,y:node.y};relax();} drag.current = { x:event.clientX,y:event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (!drag.current) return; const box = event.currentTarget.getBoundingClientRect(); const scale = Math.min(box.width / 1000, box.height / 600); const dx=(event.clientX-drag.current.x)/scale, dy=(event.clientY-drag.current.y)/scale; if(pin.current) {pin.current={...pin.current,x:pin.current.x+dx/camera.zoom,y:pin.current.y+dy/camera.zoom}; if(Math.abs(dx)+Math.abs(dy)>1) skipClick.current=true;relax();} else setCamera(c => ({...c,x:c.x+dx,y:c.y+dy})); drag.current = {x:event.clientX,y:event.clientY}; }}
          onPointerUp={() => { const key=pin.current?.key; const moved=skipClick.current; finishDrag(); if(key && !moved) {skipClick.current=true;open(byKey.get(key));} }} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
            {[...graph.edges,...(graph.affinities ?? [])].map(edge => { const a=byKey.get(edge.source), b=byKey.get(edge.target); return <line key={JSON.stringify(edge)} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`${edge.type ?? "link"} ${hover === a.key || hover === b.key ? "highlight" : ""}`} />; })}
            {graph.nodes.map(node => <g key={node.key} data-node={node.key} className={`record-graph-node kind-${node.kind} ${matches(node) ? "" : "dimmed"} ${node.key === current ? "current" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={matches(node) ? 0 : -1} aria-label={`${node.title}・${node.projectName}・${kinds[node.kind]}`} onClick={() => { if(!skipClick.current) open(node); }} onKeyDown={event => { if(event.altKey && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) { event.preventDefault(); pin.current={key:node.key,x:node.x+(event.key==="ArrowLeft"?-30:event.key==="ArrowRight"?30:0),y:node.y+(event.key==="ArrowUp"?-30:event.key==="ArrowDown"?30:0)}; setGraph(value=>stepWorkspaceGraph(value,pin.current)); pin.current=null;relax(); } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(node); } }} onPointerEnter={() => setHover(node.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(node.key)} onBlur={() => setHover(null)}>
              <circle className="hit" r={20 / (camera.zoom * pixelScale)} /><circle r={(node.key === current ? 6 : 4) / (camera.zoom * pixelScale)} />
              {(graph.nodes.length < 70 || hover === node.key || node.key === current || (query && matches(node))) && <text x={10 / (camera.zoom * pixelScale)} y={4 / (camera.zoom * pixelScale)} fontSize={12 / (camera.zoom * pixelScale)}>{node.title}</text>}
              <title>{node.title} · {node.projectName} · {kinds[node.kind]}</title>
            </g>)}
          </g>
        </svg>
      </>}
  </section>;
}
