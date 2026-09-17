import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { workflowDraftKey, canStartNewDraft } from "./workflowDraftIdentity.js";
import { publishLocalWorkflow } from "./localWorkflowPublish.js";
import { listWorkflows } from "./workflowApi.js";
const require=createRequire(import.meta.url);
const {DatabaseSync}=require("node:sqlite");
const {createWorkflowStore}=require("../../server/workflowStore.js");
const source=fs.readFileSync(new URL("./App.jsx",import.meta.url),"utf8");
test("draft identity separates Admin and Additional profiles and rejects unknown ownership",()=>{
 const keys=[{role:"admin"},{role:"additional",profileId:"a"},{role:"additional",profileId:"b"}].map(workflowDraftKey);
 assert.equal(new Set(keys).size,3);assert.ok(keys.every(k=>k!=="jarvis_workflow_v2"));
 assert.equal(workflowDraftKey(null),null);assert.equal(workflowDraftKey({role:"additional"}),null);
 assert.match(source,/<WorkspaceApp key=\{key\}/);
 assert.doesNotMatch(source,/jarvis_workflow_v2/);
});
test("New refuses to discard unpublished or dirty workflows",()=>{
 assert.equal(canStartNewDraft("local",[{id:"a"}],false),false);
 assert.equal(canStartNewDraft("server",[{id:"a"}],true),false);
 assert.equal(canStartNewDraft("server",[{id:"a"}],false),true);
 assert.equal(canStartNewDraft("local",[],false),true);
});
for(const owner of [{ownerType:"additional",ownerId:"a"},{ownerType:"admin",ownerId:"primary"}])test(owner.ownerType+" creates A and B and updates only A; manager lists both",async()=>{
 const db=new DatabaseSync(":memory:"),store=createWorkflowStore({database:db});
 try{
  const requests=[];
  const fetcher=async(url,options={})=>{
   const id=url.split("/api/workflows/")[1];const body=options.body?JSON.parse(options.body):null;requests.push(options.method||"GET");
   const data=options.method==="POST"?store.createWorkflow(body,owner):options.method==="PATCH"?store.updateWorkflow(id,body,owner):{workflows:store.listWorkflows({owner}).items};
   return {ok:true,json:async()=>data};
  };
  const input={nodes:[{id:"trigger",name:"Schedule Trigger",config:{rules:[]}}],connections:[]};
  const a=await publishLocalWorkflow(fetcher,"",{...input,name:"A"}),beforeA=store.getWorkflow(a.id,owner);
  const b=await publishLocalWorkflow(fetcher,"",{...input,name:"B"}),beforeB=store.getWorkflow(b.id,owner);
  assert.notEqual(a.id,b.id);assert.deepEqual(store.getWorkflow(a.id,owner),beforeA);
  await publishLocalWorkflow(fetcher,"",{...input,name:"Edited A",serverWorkflowId:a.id});
  assert.deepEqual(store.getWorkflow(b.id,owner),beforeB);
  assert.equal((await listWorkflows(fetcher,"")).length,2);
  assert.deepEqual(requests,["POST","POST","PATCH","GET"]);
 }finally{db.close();}
});
test("actual publish handler stores returned definition and completes refresh without ReferenceError",async()=>{
 const events=[],noop=()=>{},workflow={id:"wf_1234567890",name:"A",nodes:[{id:"returned"}],connections:[],status:"DRAFT"};
 const callback=source.slice(source.indexOf("  const publishWorkflow ="),source.indexOf("  const openNextNodePicker =")).trim().replace("const publishWorkflow =","globalThis.publishWorkflow =");
 for(const mode of ["local","server"]){
 const ctx={publishInFlightRef:{current:false},runSingleFlightPublish:(_l,fn)=>fn(),setIsPublishing:noop,setWorkflowNotice:x=>events.push(x),buildLocalPublishPayload:x=>x,editorWorkflowSource:mode,activeServerWorkflow:{id:workflow.id},loadStoredLocalWorkflow:()=>({serverWorkflowId:"wf_unrelated123"}),canvasNodesRef:{current:[]},connectionsRef:{current:[]},publishLocalWorkflow:async(_f,_b,input)=>{assert.equal(input.serverWorkflowId,mode==="local"?null:workflow.id);return workflow;},fetch:noop,API_BASE_URL:"",validateStoredWorkflow:x=>x,setEditorWorkflowSource:noop,setActiveServerWorkflow:noop,storeWorkflowLinkage:x=>{assert.deepEqual(x.nodes,workflow.nodes);events.push("saved");},setSelectedManagedWorkflowId:noop,setWorkflowManagerRefreshKey:()=>events.push("refreshed"),editorDefinitionBaselineRef:{},definitionFingerprint:noop,setWorkflowDirty:noop,Date};
 vm.createContext(ctx);vm.runInContext(callback,ctx);await ctx.publishWorkflow();
 }
 assert.equal(events.filter(x=>x==="saved").length,2);assert.equal(events.filter(x=>x==="refreshed").length,2);
 assert.ok(events.filter(x=>typeof x==="object").every(x=>x.status!=="error"));
});
test("actual draft read/write helpers isolate all three workspace stores without claiming legacy data",async()=>{
 const {normalizeSavedWorkflow,workflowForStorage}=await import("./workflowStorage.js");
 const values=new Map([["jarvis_workflow_v2",JSON.stringify({name:"Legacy",nodes:[]})]]);
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const load=source.slice(source.indexOf("function loadStoredLocalWorkflow()"),source.indexOf("function storeWorkflowLinkage("));
 const write=source.slice(source.indexOf("function storeWorkflowLinkage("),source.indexOf("  const credentialWorkspaceKey"));
 const sessions=[{role:"admin"},{role:"additional",profileId:"a"},{role:"additional",profileId:"b"}];
 for(const [i,session] of sessions.entries()){
  const ctx={WORKFLOW_STORAGE_KEY:workflowDraftKey(session),localStorage:storage,normalizeSavedWorkflow,workflowForStorage};
  vm.createContext(ctx);vm.runInContext(load+"\n"+write,ctx);
  assert.equal(ctx.loadStoredLocalWorkflow(),null);
  ctx.storeWorkflowLinkage({name:"Draft "+i,nodes:[],connections:[],serverWorkflowId:"wf_123456789"+i});
 }
 for(const [i,session] of sessions.entries())assert.equal(JSON.parse(values.get(workflowDraftKey(session))).name,"Draft "+i);
 assert.equal(JSON.parse(values.get("jarvis_workflow_v2")).name,"Legacy");
});
