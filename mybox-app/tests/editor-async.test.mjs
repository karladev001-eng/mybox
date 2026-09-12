import test from "node:test";
import assert from "node:assert/strict";
import { createEditorWriteQueue, createLatestRequest } from "../src/knowledge/editor-async.js";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const page = (id, revision=0) => ({projectId:"project",id,revision,blocks:[]});

test("latest request ignores old completions and invalidates on Project changes", async () => {
  const guard=createLatestRequest(); const slow=deferred(); let visible="";
  const first=guard.begin(); const pending=slow.promise.then(v=>{if(first())visible=v;});
  const second=guard.begin(); if(second())visible="second";
  slow.resolve("first"); await pending; assert.equal(visible,"second");
  guard.invalidate(); assert.equal(second(),false);
});

test("queued edits keep their original Page and use acknowledged revisions", async () => {
  const gate=deferred(); const calls=[]; const counts=[];
  const queue=createEditorWriteQueue({onPending:n=>counts.push(n),update:async(p,m)=>{calls.push([p.id,p.revision,m.text]);if(calls.length===1)await gate.promise;return {page:{...p,revision:p.revision+1}};}});
  const source=page("A"); const edit={text:"first"};
  const a=queue.enqueue(source,edit);const b=queue.enqueue(source,{text:"second"});
  const c=queue.enqueue(page("B"),{text:"third"});
  source.id="changed outside";edit.text="changed outside";
  await Promise.resolve();assert.deepEqual(calls,[["A",0,"first"]]);
  gate.resolve();await Promise.all([a,b,c]);await queue.settled;
  assert.deepEqual(calls,[["A",0,"first"],["A",1,"second"],["B",0,"third"]]);
  assert.deepEqual(counts,[1,2,3,2,1,0]);
});

test("failed writes reject without stopping later edits or leaving saving stuck", async () => {
  let attempts=0; const counts=[];
  const queue=createEditorWriteQueue({onPending:n=>counts.push(n),update:async(p)=>{if(++attempts===1)throw Error("offline");return {page:{...p,revision:1}};}});
  const first=queue.enqueue(page("A"),{});const second=queue.enqueue(page("A"),{});
  await assert.rejects(first,/offline/);await second;await queue.settled;
  assert.equal(attempts,2);assert.deepEqual(counts,[1,2,1,0]);
});

test("a new idle batch uses current revision rather than retaining old state", async () => {
  const revisions=[];
  const queue=createEditorWriteQueue({update:async(p)=>{revisions.push(p.revision);return {page:{...p,revision:p.revision+1}};}});
  await queue.enqueue(page("A"),{});await queue.settled;
  await queue.enqueue(page("A",8),{});await queue.settled;
  assert.deepEqual(revisions,[0,8]);
});

test("acknowledgements are delivered before the next queued edit starts", async () => {
  const order=[];
  const queue=createEditorWriteQueue({update:async(p)=>{order.push("write");return {page:{...p,revision:p.revision+1}};}});
  const a=queue.enqueue(page("A"),{},()=>order.push("visible"));
  const b=queue.enqueue(page("A"),{},()=>order.push("visible"));
  await Promise.all([a,b]);await queue.settled;
  assert.deepEqual(order,["write","visible","write","visible"]);
});
