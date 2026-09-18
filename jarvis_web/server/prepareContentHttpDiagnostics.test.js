"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {trackPrepareContentHttp}=require('./prepareContentHttpDiagnostics');
function fixture(){const req=new EventEmitter(),res=new EventEmitter(),logs=[];let clock=0;req.headers={authorization:'SECRET'};req.body={prompt:'SECRET'};res.statusCode=200;res.setHeader=(name,value)=>{res.header=value;};res.json=function(body){this.body=body;return this;};trackPrepareContentHttp(req,res,{info:(_,e)=>logs.push(e)},()=>clock);return{req,res,logs,advance:()=>clock=95000};}
test('finish and normal close include timestamps, duration, status and safe correlation',()=>{
 const {res,logs,advance}=fixture();advance();const payload={title:'SECRET'};assert.equal(res.json(payload),res);res.writableFinished=true;res.emit('finish');res.emit('close');
 assert.deepEqual(logs.map(e=>e.event),['request_start','json_attempt','response_finish','response_close']);assert.ok(logs.every(e=>e.correlationId===res.header));assert.equal(logs[2].elapsedMs,95000);assert.equal(logs[2].status,200);assert.equal(logs[3].disconnected,false);assert.doesNotMatch(JSON.stringify(logs),/SECRET|prompt|authorization/);
});
test('abort/early close records a later JSON attempt without changing its behavior',()=>{
 const {req,res,logs,advance}=fixture();advance();req.aborted=true;req.emit('aborted');res.destroyed=true;res.emit('close');res.statusCode=429;res.json({error:'SECRET'});
 assert.equal(logs.at(-1).jsonAttemptedAfterDisconnect,true);assert.equal(logs.at(-1).status,429);assert.equal(logs.at(-1).elapsedMs,95000);assert.equal(logs.find(e=>e.event==='response_close').disconnected,true);assert.doesNotMatch(JSON.stringify(logs),/SECRET/);
});
test('diagnostic logging failure does not interfere with JSON response',()=>{
 const req=new EventEmitter(),res=new EventEmitter();res.statusCode=200;res.setHeader=()=>{};res.json=body=>body;
 trackPrepareContentHttp(req,res,{info(){throw Error('logger');}});assert.deepEqual(res.json({ok:true}),{ok:true});
});
