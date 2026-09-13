import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {KnowledgeView} from '../src/knowledge/KnowledgeView.jsx';
import {createSharedAppRuntime} from '../src/core/app-runtime.js';
import '../src/styles.css';
import '../src/knowledge/knowledge.css';
const runtime=createSharedAppRuntime({enableWorkflows:false});
const invoke=runtime.host.invoke.bind(runtime.host);
if (new URLSearchParams(location.search).has('blocks')) {
 const options={actor:{type:'user',id:'local-user'}};
 const {projects}=await invoke('knowledge.project.list',{},options);
 const projectId=projects[0].id;
 let {page}=await invoke('knowledge.page.create',{projectId,title:'Block movement QA'},options);
 ({page}=await invoke('knowledge.page.update',{projectId,pageId:page.id,expectedRevision:page.revision,mutation:{type:'markdown-set',mode:'replace',markdown:'Alpha\n\nBeta\n\nGamma\n\nDelta\n\nEpsilon'}},options));
 await invoke('knowledge.view-state.update',{projectId,pageId:page.id},options);
}
const controls={delay:false,fail:false};
runtime.host.invoke=async (id,input,options)=>{
 if(id==='knowledge.page.update') {
   if(controls.delay) await new Promise(r=>setTimeout(r,1500));
   if(controls.fail) throw new Error('QA: simulated save failure');
 }
 return invoke(id,input,options);
};
function Preview(){const [theme,setTheme]=useState('graphite');return <>
<div style={{position:'fixed',bottom:0,right:0,zIndex:1000,background:'var(--surface)',color:'var(--text)',padding:8}}>
<label><input type="checkbox" onChange={e=>controls.delay=e.target.checked}/>保存を1.5秒遅延</label>
<label><input type="checkbox" onChange={e=>controls.fail=e.target.checked}/>保存を失敗</label>
<button onClick={()=>{const next=theme==='graphite'?'light':'graphite';setTheme(next);document.documentElement.dataset.theme=next;}}>QAテーマ: {theme}</button>
</div><KnowledgeView appRuntime={runtime}/></>;}
createRoot(document.getElementById('root')).render(<Preview/>);
