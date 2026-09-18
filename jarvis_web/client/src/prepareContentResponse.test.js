import test from 'node:test';
import assert from 'node:assert/strict';
import { readPrepareContentResponse } from './prepareContentResponse.js';
const response=(status,body,type='application/json')=>new Response(body,{status,headers:{'Content-Type':type}});
test('200 JSON and JSON-compatible media types preserve successful data',async()=>{
 const data={title:'Title',caption:'Caption',hashtags:['#tag'],binary:{referenceId:'test'}};
 for(const type of ['application/json; charset=utf-8','application/problem+json']) assert.deepEqual(await readPrepareContentResponse(response(200,JSON.stringify(data),type)),data);
});
test('JSON 4xx/5xx errors retain normal application messages',async()=>{
 for(const status of [400,429,500,503]) await assert.rejects(readPrepareContentResponse(response(status,JSON.stringify({error:'Safe application error'}))),{message:'Safe application error'});
});
test('HTML 502/503/504 and malformed bodies never expose raw HTML or parser errors',async()=>{
 for(const status of [502,503,504,200]) for(const type of ['text/html','application/json','text/plain']) {
  const logs=[];const r=response(status,'<html>SECRET token cookie https://private.invalid</html>',type);
  await assert.rejects(readPrepareContentResponse(r,{warn:(_,d)=>logs.push(d)}),error=>{
   assert.equal(error.message,`Prepare Content received an unexpected server response (HTTP ${status}).`);
   assert.equal(error.diagnostic.status,status);assert.doesNotMatch(JSON.stringify(error),/SECRET|cookie|https:|<html>|Unexpected token/);return true;
  });
  assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/SECRET|cookie|https:|<html>/);
  if(type!=='application/json') assert.equal(r.bodyUsed,false);
 }
});
test('only validated HTTP correlation IDs reach frontend diagnostics',async()=>{
 const r=response(504,'SECRET','text/html');r.headers.set('X-Corex-Request-Id','secret-cookie');let seen;
 await assert.rejects(readPrepareContentResponse(r,{warn:(_,d)=>seen=d}));assert.equal(seen.correlationId,undefined);
});

test('response guard is wired only to the Prepare Content fetch',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./App.jsx',import.meta.url),'utf8');
 const start=source.indexOf('const response = await fetch(`${API_BASE_URL}/api/ai/prepare-content`');
 const end=source.indexOf('return mergePreparedContent',start);const region=source.slice(start,end);
 assert.match(region,/await readPrepareContentResponse\(response\)/);assert.doesNotMatch(region,/response\.json\(/);
 assert.equal((source.match(/await readPrepareContentResponse\(response\)/g)||[]).length,1);
});
