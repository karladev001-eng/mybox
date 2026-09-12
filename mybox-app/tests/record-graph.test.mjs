import test from "node:test";
import assert from "node:assert/strict";
import { readRecordGraph } from "../src/knowledge/record-graph.js";
import { readWorkspaceGraph, layoutWorkspaceGraph } from "../src/knowledge/record-graph.js";
import { relatedPageEdges, stepWorkspaceGraph } from "../src/knowledge/record-graph.js";

test("affinities group tags and similar content without creating PageLinks", () => {
  const nodes=[{key:"a",title:"alpha beta gamma",tags:["science"]},{key:"b",title:"other",tags:["science"]},{key:"c",title:"alpha beta gamma delta",tags:[]}];
  const links=[];
  const affinities=relatedPageEdges(nodes,links);
  assert.ok(affinities.some(e=>e.type==="tag"));
  assert.ok(affinities.some(e=>e.type==="similar"));
  assert.deepEqual(links,[]);
});
test("dragging keeps the pinned node fixed and draws connected neighbors along", () => {
  let graph={nodes:[{key:"a",x:0,y:0},{key:"b",x:65,y:0}],edges:[{source:"a",target:"b"}]};
  const pin={key:"a",x:200,y:100};
  for(let i=0;i<30;i++) graph=stepWorkspaceGraph(graph,pin,i);
  assert.equal(graph.nodes[0].x,200); assert.equal(graph.nodes[0].y,100);
  assert.ok(graph.nodes[1].y>20);
  assert.ok(graph.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
});

test("a stationary drag has bounded drift and cooling stops movement", () => {
  let graph={nodes:[{key:"a",x:0,y:0,anchorX:0,anchorY:0},{key:"b",x:65,y:0,anchorX:65,anchorY:0}],edges:[{source:"a",target:"b"}]};
  const pin={key:"a",x:2000,y:1000};
  for(let i=0;i<400;i++) graph=stepWorkspaceGraph(graph,pin,i);
  assert.ok(Math.hypot(graph.nodes[1].x-65,graph.nodes[1].y)<=160.00001);
  assert.deepEqual(stepWorkspaceGraph(graph,pin,0,0).nodes,graph.nodes);
});

test("workspace overview keeps isolated nodes and cross-project links but excludes denied destinations", async () => {
  const client = {
    listProjects: async () => ({projects: [{id:"a",name:"A"},{id:"b",name:"B"}]}),
    prepareProjectSession: async () => {},
    listPages: async id => ({pages: (id === "a" ? ["one","isolated"] : ["one","denied"]).map(id => ({id}))}),
    readPage: async (projectId,id) => {
      if(id === "denied") throw Object.assign(new Error("denied"),{code:"PROJECT_ROLE_REQUIRED"});
      return {page:{id,title:id,state:"active",blocks:[{links: projectId === "a" && id === "one" ? [{targetProjectId:"b",targetPageId:"one"},{targetProjectId:"b",targetPageId:"denied"}] : []}]}};
    },
  };
  const graph = await readWorkspaceGraph(client);
  assert.equal(graph.nodes.length,3); assert.equal(graph.edges.length,1);
  const layout = await layoutWorkspaceGraph(graph);
  assert.equal(layout.nodes.length,3);
  assert.ok(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readWorkspaceGraph(client,{signal:controller.signal}),{name:"AbortError"});
});

test("graph deduplicates block links, preserves cross-project identity and both directions", async () => {
  const data = { page: { id: "root", title: "Root", state: "active", blocks: [{ links: [{ targetPageId: "same" }, { targetPageId: "same" }, { targetPageId: "root" }] }] }, pageLinks: [{ projectId: "other", pageId: "same" }], backlinks: [{ projectId: "p", pageId: "same" }] };
  const graph = await readRecordGraph({ prepareProjectSession: async () => {}, readPage: async (projectId, id) => ({ page: { id, title: projectId, kind: "context", state: "active" } }) }, "p", data);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes.find(n => n.projectId === "p").incoming, true);
  assert.equal(graph.nodes.find(n => n.projectId === "p").outgoing, true);
  assert.equal(graph.nodes.find(n => n.projectId === "other").incoming, false);
});

test("graph never exposes denied, missing or trashed destination titles, and reports storage failure", async () => {
  const data = { page: { id: "root", title: "Root", state: "active" }, pageLinks: ["denied", "gone", "trash"].map(pageId => ({ pageId })) };
  const client = { prepareProjectSession: async () => {}, readPage: async (_, id) => {
    if (id === "trash") return { page: { title: "Hidden", state: "trash" } };
    throw Object.assign(new Error("Hidden"), { code: id === "denied" ? "PROJECT_ROLE_REQUIRED" : "PAGE_NOT_FOUND" });
  } };
  assert.deepEqual((await readRecordGraph(client, "p", data)).nodes, []);
  client.readPage = async () => { throw new Error("disk failure"); };
  await assert.rejects(readRecordGraph(client, "p", data), /disk failure/);
});

test("graph retains more than one visual page of neighbors and excludes a trashed center", async () => {
  const data = { page: { id: "root", title: "Root", state: "active" }, backlinks: Array.from({ length: 31 }, (_, i) => ({ pageId: String(i) })) };
  const client = { prepareProjectSession: async () => {}, readPage: async (_, id) => ({ page: { id, title: id, state: "active" } }) };
  assert.equal((await readRecordGraph(client, "p", data)).nodes.length, 31);
  data.page.state = "trash";
  assert.equal((await readRecordGraph(client, "p", data)).nodes.length, 0);
});
