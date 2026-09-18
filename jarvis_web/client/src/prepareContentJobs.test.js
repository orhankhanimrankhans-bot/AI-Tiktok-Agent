import test from 'node:test';import assert from 'node:assert/strict';import {executePrepareContentJob} from './prepareContentJobs.js';import {mergePreparedContent} from './prepareContentConfig.js';
const id='11111111-1111-4111-8111-111111111111';const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('slow work uses one submission and short polls, preserving output and binary handoff',async()=>{
 let now=0,posts=0,gets=0;const result={title:'Car',caption:'Caption',hashtags:['#car'],socialCaption:'combined',socialCaptionWithHashtags:'combined'};
 const output=await executePrepareContentJob('',{binary:{referenceId:'binary'}},{requestId:id,now:()=>now,sleep:async ms=>now+=ms,fetchImpl:async(url,options)=>{
 assert.equal(options.credentials,'include');if(options.method==='POST'){posts++;return json({jobId:id,state:'running'},202);}gets++;return json(gets<60?{state:'running'}:{state:'succeeded',result});
 }});assert.equal(posts,1);assert.equal(gets,60);assert.equal(now,120000);assert.deepEqual(output,result);const input={binary:{referenceId:'binary'},fileName:'video.mp4'};assert.deepEqual(mergePreparedContent(input,output).binary,input.binary);
});
test('lost submission response reuses idempotency key; transient poll 504 does not resubmit',async()=>{
 let posts=0,gets=0;const keys=[];
 const output=await executePrepareContentJob('',{}, {requestId:id,sleep:async()=>{},fetchImpl:async(url,options)=>{
 if(options.method==='POST'){keys.push(options.headers['X-Corex-Job-Request']);if(++posts===1)throw new TypeError('network');return json({jobId:id},202);}
 if(++gets===1)return new Response('<html>SECRET</html>',{status:504,headers:{'Content-Type':'text/html'}});return json({state:'succeeded',result:{title:'Ready'}});
 }});assert.deepEqual(keys,[id,id]);assert.equal(posts,2);assert.equal(output.title,'Ready');
});
test('provider failure is surfaced, no manual re-execution or hidden resubmission',async()=>{
 let calls=0;await assert.rejects(executePrepareContentJob('',{},{requestId:id,sleep:async()=>{},fetchImpl:async()=>++calls===1?json({jobId:id},202):json({state:'failed',failure:{error:'Gemini quota reached.'}})}),{message:'Gemini quota reached.'});assert.equal(calls,2);
});
test('authentication loss stops polling without resubmitting',async()=>{
 let calls=0;await assert.rejects(executePrepareContentJob('',{},{requestId:id,sleep:async()=>{},fetchImpl:async()=>++calls===1?json({jobId:id},202):json({error:'Authentication required.'},401)}),{message:'Authentication required.'});assert.equal(calls,2);
});
