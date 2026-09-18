"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {guidance,createCooldown}=require('./geminiRetryDelay');
const {analyzeVideo}=require('./geminiVideoAnalysis');
const facts={primaryObject:'car',secondaryObject:'',action:'car moving',scene:'road',visibleDetails:['car'],confidence:0.9};
function failure(delay,status=429){return Object.assign(new Error('provider'),{status,error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:delay},{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaMetric:'generativelanguage.googleapis.com/generate_content_paid_tier_requests'}]}]}});}
function setup(t){const binaryDir=fs.mkdtempSync(path.join(os.tmpdir(),'retry-delay-'));t.after(()=>fs.rmSync(binaryDir,{recursive:true,force:true}));const referenceId='bin_1234567890123456';fs.writeFileSync(path.join(binaryDir,referenceId),'mock video');return {binaryDir,binary:{referenceId},mimeType:'video/mp4',apiKey:'test',logger:{}};}
test('validated delays ignore malformed, negative, missing and absurd values and cap excessive values',()=>{
 for(const value of [undefined,'bad','-1s',-1,Infinity,NaN,{},'999999999999s']) assert.equal(guidance(failure(value)).delayMs,0);
 assert.equal(guidance(failure('46s')).delayMs,46000);assert.equal(guidance(failure('300s')).delayMs,120000);
});
test('provider delay or configured backoff wins; upload reused and success stops retries',async t=>{
 for(const [value,expected] of [['46s',46000],['1s',3000],[undefined,3000],['bad',3000],['-2s',3000],['300s',120000]]){
  let now=0,uploads=0,calls=0;const delays=[],cooldown=createCooldown(()=>now);
  const result=await analyzeVideo({...setup(t),cooldown,sleep:async ms=>{delays.push(ms);now+=ms;},createClient:()=>({files:{upload:async()=>{uploads++;return{name:'files/test',uri:'uri',state:'ACTIVE'};},delete:async()=>{}},models:{generateContent:async()=>{if(++calls===1)throw failure(value);return{text:JSON.stringify(facts)};}}})});
  assert.deepEqual(result,facts);assert.deepEqual(delays,[expected]);assert.equal(uploads,1);assert.equal(calls,2);
 }
});
test('shared cooldown blocks a second inference, expires, and does not affect later successes',async t=>{
 let now=0;const cooldown=createCooldown(()=>now),input=setup(t);let calls=0;
 const client={files:{upload:async()=>({name:'files/test',uri:'uri',state:'ACTIVE'}),delete:async()=>{}},models:{generateContent:async()=>{calls++;return{text:JSON.stringify(facts)};}}};
 let release;cooldown.record(46000);
 const pending=analyzeVideo({...input,cooldown,createClient:()=>client,sleep:ms=>new Promise(resolve=>{assert.equal(ms,46000);release=()=>{now+=ms;resolve();};})});
 while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);release();await pending;assert.equal(calls,1);
 await analyzeVideo({...input,cooldown,createClient:()=>client,sleep:()=>assert.fail('expired cooldown must not sleep')});assert.equal(calls,2);
});
test('four attempts maximum with provider guidance and no duplicate upload',async t=>{
 let now=0,calls=0,uploads=0;const sleeps=[],cooldown=createCooldown(()=>now);
 await assert.rejects(analyzeVideo({...setup(t),cooldown,sleep:async ms=>{sleeps.push(ms);now+=ms;},createClient:()=>({files:{upload:async()=>{uploads++;return{name:'files/test',uri:'uri',state:'ACTIVE'};},delete:async()=>{}},models:{generateContent:async()=>{calls++;throw failure('46s');}}})}),{code:'gemini_rate_limited'});
 assert.equal(calls,4);assert.equal(uploads,1);assert.deepEqual(sleeps,[46000,46000,46000]);
 const waits=[]; await analyzeVideo({...setup(t),cooldown,sleep:async ms=>{waits.push(ms);now+=ms;},createClient:()=>({files:{upload:async()=>({name:"files/second",uri:"second",state:"ACTIVE"}),delete:async()=>{}},models:{generateContent:async()=>({text:JSON.stringify(facts)})}})});
 assert.deepEqual(waits,[46000]);
});
test('permanent inference errors ignore provider guidance',async t=>{
 let records=0,calls=0;await assert.rejects(analyzeVideo({...setup(t),cooldown:{wait:async()=>{},record:()=>records++},sleep:()=>assert.fail('no retry'),createClient:()=>({files:{upload:async()=>({name:'files/test',uri:'uri',state:'ACTIVE'}),delete:async()=>{}},models:{generateContent:async()=>{calls++;throw failure('46s',403);}}})}),{code:'gemini_permission_denied'});assert.equal(calls,1);assert.equal(records,0);
});
test('repeated cooldown extensions have a bounded wait',async()=>{
 let now=0;const cooldown=createCooldown(()=>now);cooldown.record(120000);
 await assert.rejects(cooldown.wait(async ms=>{now+=ms;cooldown.record(120000);}),{code:'gemini_cooldown_wait_timeout'});
 assert.equal(now,120000);
});
