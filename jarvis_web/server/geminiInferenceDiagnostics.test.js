"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {metadata,observe}=require("./geminiInferenceDiagnostics");
const {classifyFailure,analyzeVideo}=require("./geminiVideoAnalysis");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
function quotaError(){return Object.assign(new Error(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"SECRET https://secret.invalid",details:[
 {"@type":"type.googleapis.com/google.rpc.QuotaFailure",violations:[{quotaId:"GenerateContentRequestsPerMinutePerProjectPerModel-FreeTier",subject:"SECRET",description:"SECRET"},{quotaId:"SECRET",quotaMetric:"SECRET"}]},
 {"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"42.5s"}]}})),{name:"ApiError",status:429,headers:{"retry-after":"60",Authorization:"SECRET"},cause:Object.assign(new Error("SECRET"),{code:"ECONNRESET"})});}
test("429 quota and retry guidance are allowlisted; raw responses and secrets excluded",()=>{
 const data=metadata(quotaError());assert.equal(data.causes[0].httpStatus,429);assert.equal(data.causes[0].providerStatus,"RESOURCE_EXHAUSTED");assert.equal(data.causes[1].code,"ECONNRESET");
 assert.deepEqual(data.quotas,[{limitIdentifier:"GenerateContentRequestsPerMinutePerProjectPerModel-FreeTier",category:"RPM"}]);assert.equal(data.retryAfterSeconds,60);assert.equal(data.retryDelaySeconds,42.5);
 assert.doesNotMatch(JSON.stringify(data),/SECRET|https:|Authorization|message|subject|description/);
 const e=quotaError();e.headers['retry-after']='https://secret.invalid';assert.equal(metadata(e).retryAfterSeconds,undefined);e.cause=e;assert.equal(metadata(e).causes.length,1);
});
test("overlapping calls have balanced per-process counts and logger failure does not affect behavior",async()=>{
 const events=[],releases=[];const options={logger:{info:(_,e)=>events.push(e)},correlationId:"test",attempt:1,model:"gemini-2.5-flash",fileActive:true,classify:e=>classifyFailure(e,"generateContent"),maxAttempts:4};
 const first=observe(options,()=>new Promise(resolve=>releases.push(resolve)));const second=observe({...options,correlationId:"second"},()=>new Promise(resolve=>releases.push(resolve)));
 assert.deepEqual(events.map(e=>e.concurrentInferenceCalls),[1,2]);releases[0](1);await first;releases[1](2);await second;
 assert.deepEqual(events.filter(e=>e.event==='end').map(e=>e.concurrentInferenceCalls),[1,0]);
 assert.equal(await observe({...options,logger:{info(){throw Error('logger');}}},async()=>3),3);
});
test("real analysis retries retain correlation, ACTIVE state, policy and sanitized failure metadata",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gemini-inference-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const referenceId='bin_1234567890123456';fs.writeFileSync(path.join(dir,referenceId),'mock');
 const logs=[],delays=[];let uploads=0,calls=0,now=0; const cooldown=require('./geminiRetryDelay').createCooldown(()=>now);
 await assert.rejects(analyzeVideo({binaryDir:dir,binary:{referenceId},mimeType:'video/mp4',apiKey:'SECRET',cooldown,sleep:async ms=>{delays.push(ms);now+=ms;},logger:{info:(label,e)=>logs.push({label,...e})},createClient:()=>({files:{upload:async()=>{uploads++;return{name:'files/SECRET',uri:'https://secret.invalid',state:'ACTIVE'};},delete:async()=>{}},models:{generateContent:async()=>{calls++;throw quotaError();}}})}),{code:'gemini_rate_limited'});
 const inference=logs.filter(e=>e.label==='[GeminiInferenceDiagnostic]'),failures=inference.filter(e=>e.event==='failure');
 assert.equal(uploads,1);assert.equal(calls,4);assert.deepEqual(delays,[60000,60000,60000]);assert.deepEqual(failures.map(e=>e.attempt),[1,2,3,4]);assert.deepEqual(failures.map(e=>e.willRetry),[true,true,true,false]);assert.equal(failures[3].classificationReason,'budget_exhausted');
 assert.ok(inference.every(e=>e.fileActive&&e.model==='gemini-2.5-flash'&&e.correlationId===logs[0].correlationId));assert.match(inference[0].correlationId,/^[a-f0-9-]{36}$/);assert.equal(inference.at(-1).concurrentInferenceCalls,0);assert.doesNotMatch(JSON.stringify(logs),/SECRET|https:|authorization/i);
});
