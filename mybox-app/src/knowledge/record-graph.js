export const graphKey = (projectId, pageId) => JSON.stringify([projectId, pageId]);

export async function readWorkspaceGraph(client, { signal } = {}) {
  const { projects } = await client.listProjects();
  const nodes = [], rawEdges = [];
  for (const project of projects) {
    signal?.throwIfAborted();
    await client.prepareProjectSession(project.id);
    const { pages } = await client.listPages(project.id);
    for (let start = 0; start < pages.length; start += 8) {
      signal?.throwIfAborted();
      const results = await Promise.all(pages.slice(start, start + 8).map(async (summary) => {
        try { return await client.readPage(project.id, summary.id); }
        catch (error) {
          if (["PAGE_NOT_FOUND", "PROJECT_ROLE_REQUIRED", "PROJECT_NOT_FOUND", "FORBIDDEN"].includes(error?.code)) return null;
          throw error;
        }
      }));
      for (const result of results) {
        if (!result || result.page.state === "trash") continue;
        const page = result.page, key = graphKey(project.id, page.id);
        nodes.push({ key, projectId: project.id, projectName: project.name, pageId: page.id, title: page.title, kind: page.kind ?? "note", tags: (result.tags ?? []).map(tag => tag.label.normalize("NFKC").toLocaleLowerCase()), text: `${page.title} ${(page.blocks ?? []).map(block => block.text ?? "").join(" ").slice(0, 6000)}` });
        for (const block of page.blocks ?? []) for (const link of block.links ?? []) {
          rawEdges.push({ source: key, target: graphKey(link.targetProjectId ?? project.id, link.targetPageId) });
        }
      }
    }
  }
  const available = new Set(nodes.map(node => node.key)), seen = new Set();
  const edges = rawEdges.filter(edge => {
    const id = JSON.stringify([edge.source, edge.target]);
    if (edge.source === edge.target || !available.has(edge.target) || seen.has(id)) return false;
    seen.add(id); return true;
  });
  return { nodes, edges, affinities: relatedPageEdges(nodes, edges) };
}

export function relatedPageEdges(nodes, links) {
  const edges = [], seen = new Set(links.map(e => JSON.stringify([e.source,e.target].sort())));
  const add = (a,b,type,weight) => { const key=JSON.stringify([a,b].sort()); if(a===b || seen.has(key)) return; seen.add(key); edges.push({source:a,target:b,type,weight}); };
  const tags = new Map(), index = new Map();
  const terms = nodes.map(node => {
    for(const tag of node.tags ?? []) { const first=tags.get(tag); if(first) add(first,node.key,"tag",.75); else tags.set(tag,node.key); }
    const normalized=(node.text ?? node.title).normalize("NFKC").toLocaleLowerCase();
    const words=new Set(normalized.match(/[a-z0-9]{3,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}/gu) ?? []);
    for(const word of words) { const list=index.get(word) ?? []; list.push(node.key); index.set(word,list); }
    return words;
  });
  const byKey=new Map(nodes.map((node,i)=>[node.key,i]));
  nodes.forEach((node,i)=>{
    const scores=new Map();
    for(const word of terms[i]) {
      const list=index.get(word);
      if(list.length > Math.max(10,nodes.length*.4)) continue;
      for(const key of list.slice(0,128)) if(key!==node.key) scores.set(key,(scores.get(key)??0)+1);
    }
    [...scores].map(([key,count])=>({key,count,score:count/Math.max(1,terms[i].size+terms[byKey.get(key)].size-count)}))
      .filter(x=>x.count>=2 && x.score>=.12).sort((a,b)=>b.score-a.score).slice(0,3).forEach(x=>add(node.key,x.key,"similar",.35));
  });
  return edges;
}

export function stepWorkspaceGraph(graph, pinned = null, step = 0, alpha = 1) {
  const nodes=graph.nodes.map(node=>({...node})), byKey=new Map(nodes.map(node=>[node.key,node]));
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i]; if(node.key===pinned?.key) { node.x=pinned.x; node.y=pinned.y; continue; }
    let fx=-node.x*.001,fy=-node.y*.001;
    const stride=Math.max(1,Math.floor(nodes.length/100));
    for(let j=step%stride;j<nodes.length;j+=stride) { if(i===j) continue; const dx=node.x-nodes[j].x,dy=node.y-nodes[j].y,d2=Math.max(25,dx*dx+dy*dy); fx+=dx*140/d2;fy+=dy*140/d2; }
    node.x+=Math.max(-8,Math.min(8,fx));node.y+=Math.max(-8,Math.min(8,fy));
  }
  for(const edge of [...graph.edges,...(graph.affinities??[])]) {
    const a=byKey.get(edge.source),b=byKey.get(edge.target); if(!a||!b) continue;
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),force=(d-65)/d*.04*(edge.weight??1);
    if(a.key!==pinned?.key) {a.x+=dx*force;a.y+=dy*force;}
    if(b.key!==pinned?.key) {b.x-=dx*force;b.y-=dy*force;}
  }
  nodes.forEach((node,i)=>{
    if(node.key===pinned?.key) return;
    const original=graph.nodes[i];
    node.x=original.x+(node.x-original.x)*alpha;
    node.y=original.y+(node.y-original.y)*alpha;
    if(Number.isFinite(node.anchorX)) {
      node.x+=(node.anchorX-node.x)*.025*alpha; node.y+=(node.anchorY-node.y)*.025*alpha;
      const dx=node.x-node.anchorX,dy=node.y-node.anchorY,d=Math.hypot(dx,dy);
      if(d>160) {node.x=node.anchorX+dx/d*160;node.y=node.anchorY+dy/d*160;}
    }
  });
  return {...graph,nodes};
}

// Stable bounded force layout. Large graphs sample repulsion, never Page records.
export async function layoutWorkspaceGraph(graph, signal) {
  const nodes = graph.nodes.map((node, index) => ({ ...node, x: Math.cos(index * 2.39996) * Math.sqrt(index + 1) * 24, y: Math.sin(index * 2.39996) * Math.sqrt(index + 1) * 24 }));
  let result = {...graph,nodes};
  for(let step=0;step<120;step++) {
    signal?.throwIfAborted(); result=stepWorkspaceGraph(result,null,step);
    if(step%5===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return result;
}
export async function readRecordGraph(client, projectId, data) {
  const center = { projectId, pageId: data.page.id, title: data.page.title, kind: data.page.kind ?? "note" };
  if (data.page.state === "trash") return { center, nodes: [] };
  const candidates = new Map();
  const add = (link, direction) => {
    const targetProject = link.projectId ?? projectId;
    const key = graphKey(targetProject, link.pageId);
    if (!link.pageId || key === graphKey(projectId, data.page.id)) return;
    const node = candidates.get(key) ?? { projectId: targetProject, pageId: link.pageId, incoming: false, outgoing: false };
    node[direction] = true;
    candidates.set(key, node);
  };
  for (const link of data.pageLinks ?? []) add(link, "outgoing");
  for (const block of data.page.blocks ?? []) for (const link of block.links ?? []) {
    add({ projectId: link.targetProjectId ?? projectId, pageId: link.targetPageId }, "outgoing");
  }
  for (const link of data.backlinks ?? []) add(link, "incoming");
  const nodes = [];
  // Bound concurrent session preparation and avoid loading original media.
  const entries = [...candidates.values()];
  for (let offset = 0; offset < entries.length; offset += 6) {
    const batch = await Promise.all(entries.slice(offset, offset + 6).map(async (node) => {
      try {
        await client.prepareProjectSession(node.projectId);
        const result = await client.readPage(node.projectId, node.pageId);
        if (result.page.state === "trash") return null;
        return { ...node, title: result.page.title, kind: result.page.kind ?? "note" };
      } catch (error) {
        if (["PAGE_NOT_FOUND", "PROJECT_NOT_FOUND", "PROJECT_ROLE_REQUIRED", "FORBIDDEN"].includes(error?.code)) return null;
        throw error;
      }
    }));
    nodes.push(...batch.filter(Boolean));
  }
  return { center, nodes: nodes.sort((a, b) => a.title.localeCompare(b.title) || graphKey(a.projectId, a.pageId).localeCompare(graphKey(b.projectId, b.pageId))) };
}
