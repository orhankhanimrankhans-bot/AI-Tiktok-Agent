"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PrepareContentJobs,registerPrepareContentJobs}=require('./prepareContentJobs');
const {PrepareContentError}=require('./openaiPrepareContent');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prepare-job-'));const stores=[];t.after(()=>{for(const s of stores)s.db.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,store:(now)=>{const s=new PrepareContentJobs(path.join(dir,'jobs.sqlite3'),now);stores.push(s);return s;}};}
const a={ownerType:'additional',ownerId:'a'},b={ownerType:'additional',ownerId:'b'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('one execution survives polling across SQLite connections and cannot be read across workspaces',async t=>{
 const f=setup(t),store=f.store(),other=f.store();let calls=0,done;const run=()=>{calls++;return new Promise(resolve=>done=resolve);};const key=randomUUID(),body={binary:{referenceId:'original'}};
 const job=store.start(a,key,body,run);assert.equal(other.get(a,job.jobId).state,'running');assert.equal(other.get(b,job.jobId),null);
 assert.equal(other.start(a,key,body,run).jobId,job.jobId);await tick();assert.equal(calls,1);
 assert.throws(()=>other.start(a,key,{different:true},run),{code:'job_request_conflict'});
 const result={title:'Car',caption:'Caption',hashtags:['#car'],socialCaption:'Caption #car',socialCaptionWithHashtags:'Caption #car'};
 done(result);await tick();assert.deepEqual(other.get(a,job.jobId).result,result);assert.equal(calls,1);
 const second=other.start(b,key,body,async()=>result);assert.notEqual(second.jobId,job.jobId);await tick();
});
test('provider errors remain classified and unknown exceptions do not leak secrets',async t=>{
 const store=setup(t).store();for(const error of [new PrepareContentError(429,'gemini_rate_limited','Gemini quota or rate limit reached.'),new Error('SECRET')]){
 const job=store.start(a,randomUUID(),{},async()=>{throw error;});await tick();const result=store.get(a,job.jobId);assert.equal(result.state,'failed');assert.doesNotMatch(JSON.stringify(result),/SECRET/);
 if(error instanceof PrepareContentError)assert.equal(result.failure.code,error.code);
 }
});
test('abandoned jobs expire without restarting provider work; capacity is bounded',async t=>{
 let now=0;const store=setup(t).store(()=>now);let done;const run=()=>new Promise(resolve=>done=resolve);const first=store.start(a,randomUUID(),{},run);store.start(a,randomUUID(),{},async()=>({}));
 assert.throws(()=>store.start(a,randomUUID(),{},run),{code:'prepare_content_busy'});await tick();now=61000;
 assert.equal(store.get(a,first.jobId).failure.code,'prepare_content_job_interrupted');done({title:'late'});await tick();assert.equal(store.get(a,first.jobId).state,'failed');now=3600001;assert.equal(store.get(a,first.jobId),null);
});
test('HTTP submission returns 202 before a slow provider; polling returns only owner results',async t=>{
 const express=require('express');const {dir,store:makeStore}=setup(t),store=makeStore();const ref='bin_1234567890123456';fs.writeFileSync(path.join(dir,ref),'test');const app=express();app.use(express.json());let done,calls=0;
 registerPrepareContentJobs(app,{getStore:()=>store,getOwner:req=>req.get('x-test-owner')==='b'?b:req.get('x-test-owner')==='a'?a:null,binaryDir:dir,getService:()=>({apiKey:'secret',model:'unchanged',prepare:(_request,owner)=>{assert.deepEqual(owner,a);calls++;return new Promise(resolve=>done=resolve);}})});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));const base=`http://127.0.0.1:${server.address().port}/api/ai/prepare-content/jobs`;
 const body={binary:{referenceId:ref},mimeType:'video/mp4',titleInstructions:'Title',captionInstructions:'Caption',language:'English',tone:'Natural',hashtagCount:1};
 const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json','x-test-owner':'a','X-Corex-Job-Request':randomUUID()},body:JSON.stringify(body)});assert.equal(response.status,202);const job=await response.json();assert.equal(calls,1);
 assert.equal((await fetch(base+'/'+job.jobId)).status,401);assert.equal((await fetch(base+'/'+job.jobId,{headers:{'x-test-owner':'b'}})).status,404);
 done({title:'Ready'});await tick();const result=await(await fetch(base+'/'+job.jobId,{headers:{'x-test-owner':'a'}})).json();assert.equal(result.result.title,'Ready');assert.equal(calls,1);
});
