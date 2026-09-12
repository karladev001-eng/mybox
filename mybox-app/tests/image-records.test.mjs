import test from "node:test";
import assert from "node:assert/strict";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";
import { createKnowledgeClient } from "../src/knowledge/client.js";
import { createKnowledgeImageStore } from "../src/core/knowledge-image-store.js";
import { createImageStudioApp } from "../src/image-studio/app.js";
import { createProjectDoc, seedPage, readPage } from "../src/knowledge/yjs-document.js";
const png = btoa(String.fromCharCode(137,80,78,71,13,10,26,10,1,2,3));
const template = {id:"template-old",name:"Sample",category:"world",prompt:"forest",source:"local",revision:1,state:"active",createdAt:"2026-01-01",updatedAt:"2026-01-01"};
const generation = {id:"generation-old",state:"complete",createdAt:"2026-01-02",updatedAt:"2026-01-02",input:{subject:"forest",ratio:"auto",selections:{world:"template-old"},references:[]},finalPrompt:"exact forest prompt",resource:{appId:"image-studio",resourceId:"old.png",mediaType:"image/png"},actual:{width:10,height:10},error:null};
async function setup(raw = {schemaVersion:1,templates:[template],generations:[generation]}) {
 const host = new AppHost({storageDriver:new MemoryStorageDriver()}); host.register(createKnowledgeApp());
 const client = createKnowledgeClient({appRuntime:{host}});
 const {project} = await client.createProject("Record");
 let checkpoint,backup,missing=false;
 const owner={readRaw:async()=>raw,readBackup:async()=>backup,writeBackup:async(v)=>{backup??=structuredClone(v)},readCheckpoint:async()=>structuredClone(checkpoint),writeCheckpoint:async(v)=>{checkpoint=structuredClone(v)}};
 const store = createKnowledgeImageStore({client,getDefaultProject:async()=>project.id,readLegacyImage:async()=>missing?null:`data:image/png;base64,${png}`,materializeImage:async()=>({resourceId:"cache.png"})});
 return {host,client,project,store,owner,setMissing:(v)=>{missing=v},checkpoint:()=>checkpoint,backup:()=>backup};
}
test("Image migration retains IDs, exact records and originals, links Pages and is restartable",async()=>{
 const f=await setup();f.setMissing(true);
 await assert.rejects(f.store.load(f.owner),/画像原本/);
 assert.notEqual(f.checkpoint().phase,"complete");assert.deepEqual(f.backup().generations,[generation]);
 f.setMissing(false);
 const state=await f.store.load(f.owner);
 assert.equal(state.generations[0].id,generation.id);
 assert.equal(state.generations[0].finalPrompt,generation.finalPrompt);
 assert.equal(state.templates[0].id,template.id);
 assert.equal(f.checkpoint().phase,"complete");
 assert.equal(await f.store.readResource(state.generations[0].resource.resourceId),`data:image/png;base64,${png}`);
 const before=(await f.client.listPages(f.project.id,true)).pages;
 await f.store.load(f.owner);
 assert.equal((await f.client.listPages(f.project.id,true)).pages.length,before.length);
 const {page,pageLinks}=await f.client.readPage(f.project.id,generation.id);
 assert.ok(pageLinks.some((l)=>l.pageId===template.id));
 const doc=createProjectDoc({projectId:f.project.id});seedPage(doc,page);
 assert.deepEqual(readPage(doc,page.id).imageRecord,page.imageRecord);doc.destroy();
 await assert.rejects(f.client.invoke("knowledge.image-record.save.v1",{projectId:f.project.id,pageId:page.id,kind:"generation",record:{...page.imageRecord,finalPrompt:"changed"},expectedRevision:page.revision}),/完了した/);
});
test("empty Image migration and new template writes use Knowledge as the only record store",async()=>{
 const f=await setup({schemaVersion:1,templates:[],generations:[]});
 await f.store.load(f.owner);
 const saved=await f.store.save({template,state:{templates:[template]}});
 const state=await f.store.load(f.owner);
 assert.equal(state.templates[0].prompt,"forest");
 await f.client.moveToTrash(f.project.id,saved.template.knowledge.pageId,saved.template.knowledge.revision);
 assert.equal((await f.store.load(f.owner)).templates[0].state,"trash");
});


test("generation persists exact input before provider execution, uses snapshots, and rejects Viewer writes", async () => {
 const f=await setup({schemaVersion:1,templates:[],generations:[]});
 let calls=0;
 f.host.register(createImageStudioApp({recordStore:f.store,generator:{generate:async(input)=>{
   calls++;
   const {page}=await f.client.readPage(f.project.id,input.generationId);
   assert.equal(page.imageRecord.finalPrompt,input.prompt);
   assert.equal(page.imageRecord.state,"generating");
   return {resource:generation.resource,actual:{width:10,height:10}};
 }}}));
 const {generation:result}=await f.host.invoke("image-studio.generation.create",{subject:"forest",ratio:"auto",promptOverride:"Exact input"});
 assert.equal(calls,1);assert.equal(result.state,"complete");
 const {page}=await f.client.readPage(f.project.id,result.knowledge.pageId);
 assert.equal(page.imageRecord.finalPrompt,"Exact input");
 await assert.rejects(f.host.invoke("knowledge.image-record.save.v1",{projectId:f.project.id,pageId:page.id,kind:"generation",record:page.imageRecord},{actor:{type:"user",id:"viewer"}}),/role/);
 await f.client.moveToTrash(f.project.id,page.id,page.revision);
 assert.equal((await f.store.load(f.owner)).generations[0].state,"trash");
});
test("record persistence failure stops the model, and old interrupted attempts become unknown",async()=>{
 const f=await setup({schemaVersion:1,templates:[],generations:[]});let calls=0;
 f.host.register(createImageStudioApp({recordStore:{load:f.store.load,save:async()=>{throw new Error("disk full")}},generator:{generate:async()=>{calls++}}}));
 await assert.rejects(f.host.invoke("image-studio.generation.create",{subject:"forest",ratio:"auto"}),/disk full/);
 assert.equal(calls,0);
 const interrupted=await setup({schemaVersion:1,templates:[],generations:[{...generation,state:"generating",resource:null}]});
 assert.equal((await interrupted.store.load(interrupted.owner)).generations[0].state,"unknown");
 assert.equal((await interrupted.store.load(interrupted.owner)).generations[0].state,"unknown");
});
test("large migrations preserve same-titled templates and map Page ID collisions",async()=>{
 const records=Array.from({length:205},(_,i)=>({...template,id:`template-${i}`}));
 const f=await setup({schemaVersion:1,templates:records,generations:[]});
 await f.client.invoke("knowledge.page.create",{projectId:f.project.id,title:"Existing"});
 const raw=await f.client.listPages(f.project.id,true);
 records[0].id=raw.pages[0].id;
 const state=await f.store.load(f.owner);
 assert.equal(state.templates.length,205);
 assert.equal(new Set((await f.client.listPages(f.project.id,true)).pages.map((p)=>p.title)).size,206);
 assert.notEqual(state.templates.find((t)=>t.id===records[0].id).knowledge.pageId,records[0].id);
 assert.equal((await f.store.load(f.owner)).templates.length,205);
});

test("duplicate legacy identities get durable mappings without dropping records", async () => {
 const f=await setup({schemaVersion:1,templates:[template,{...template,prompt:"second"}],generations:[]});
 const first=await f.store.load(f.owner);
 assert.equal(first.templates.length,2);
 assert.equal(new Set(first.templates.map((t)=>t.id)).size,2);
 const again=await f.store.load(f.owner);
 assert.deepEqual(again.templates.map((t)=>t.id),first.templates.map((t)=>t.id));
});


test("parallel Image loads share a failed migration without automatic retries", async () => {
 const f=await setup();let attempts=0;
 const owner={...f.owner,readRaw:async()=>{attempts++;throw new Error("offline backup");}};
 const result=await Promise.allSettled([f.store.load(owner),f.store.load(owner),f.store.load(owner)]);
 assert.equal(attempts,1);
 assert.ok(result.every(r=>r.status==="rejected"&&r.reason.message==="offline backup"));
 await assert.rejects(f.store.load(owner),/offline backup/);
 assert.equal(attempts,2);
});

test("migration lists identities once and never reads prior generations individually", async () => {
 const raw={schemaVersion:1,templates:[template],generations:Array.from({length:60},(_,i)=>({...generation,id:`old-${i}`}))};
 const f=await setup(raw);let pageLists=0,pageReads=0,recordLists=0;
 const client={...f.client,listPages:async(...args)=>{pageLists++;return f.client.listPages(...args);},readPage:async(...args)=>{pageReads++;return f.client.readPage(...args);},invoke:async(id,...args)=>{if(id==="knowledge.image-record.list.v1")recordLists++;return f.client.invoke(id,...args);}};
 const store=createKnowledgeImageStore({client,getDefaultProject:async()=>f.project.id,readLegacyImage:async()=>`data:image/png;base64,${png}`});
 const state=await store.load(f.owner);
 assert.equal(state.generations.length,60);
 assert.equal(pageReads,0);
 assert.equal(pageLists,(await f.client.listProjects()).projects.length);
 assert.ok(recordLists<=4);
 const list=await f.client.invoke("knowledge.image-record.list.v1",{projectId:f.project.id,kinds:["prompt"]});
 assert.equal(list.pages.length,1);assert.equal(list.pages[0].kind,"prompt");
 await assert.rejects(f.host.invoke("knowledge.image-record.list.v1",{projectId:f.project.id},{actor:{type:"user",id:"outsider"}}),/role/);
});
