const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {analyzeVideo}=require("./geminiVideoAnalysis");
const d=require("./geminiUploadDiagnostics");
test("upload 404 logs safe correlated substages and metadata without retry or secrets",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"upload-diag-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const referenceId="bin_1234567890123456";fs.writeFileSync(path.join(dir,referenceId),"private-video-content");
 const records=[];let calls=0;
 const error=Object.assign(new Error(JSON.stringify({error:{code:404,status:"NOT_FOUND",message:"https://signed.example/?token=SECRET api-key SECRET"}})),{name:"ApiError",status:404,cause:Object.assign(new Error("Bearer SECRET"),{code:"SECRET"})});
 error.stack="ApiError SECRET at fetchUploadUrl (https://signed.example/SECRET)";
 await assert.rejects(analyzeVideo({binaryDir:dir,binary:{referenceId},mimeType:"video/mp4",fileExtension:".mp4",apiKey:"SECRET",logger:{info:(_m,x)=>records.push(x),error(){}},createClient:()=>({files:{upload:async()=>{calls++;throw error;}}}),sleep:async()=>assert.fail("404 must not retry")}),{code:"gemini_upload_failed"});
 assert.equal(calls,1);assert.equal(new Set(records.map(r=>r.correlationId)).size,1);
 assert.match(records[0].correlationId,/^[a-f0-9-]{36}$/);
 assert.ok(records.every(r=>r.attempt===1&&r.exists&&r.readable&&r.byteSize===21&&r.extension===".mp4"&&r.declaredMime==="video/mp4"));
 const last=records.at(-1);assert.equal(last.substage,"sdk_upload_initialization");assert.equal(last.causes[0].httpStatus,404);assert.equal(last.causes[0].providerStatus,"NOT_FOUND");assert.equal(last.willRetry,false);assert.equal(last.retryable,false);
 assert.doesNotMatch(JSON.stringify(records),/SECRET|https:|Bearer|private-video-content|bin_123|signed.example/);
});
test("bounded allowlists reject secrets in class/code/status and recognize known substages",()=>{
 const e={name:"SECRET",code:"https://secret",error:{status:"SECRET",code:"SECRET"}};e.cause=e;
 assert.deepEqual(d.causes(e),[{name:"OtherError",httpStatus:undefined,code:undefined,providerCode:undefined,providerStatus:undefined}]);
 assert.equal(d.substage({stack:"at uploadFileFromPathInternal"},"sdk_upload_unknown"),"transfer_finalization");
 assert.equal(d.substage({stack:"at uploadFileFromPath"},"sdk_upload_unknown"),"provider_file_response_handling");
 assert.equal(d.substage({stack:"at unrelated"},"sdk_upload_unknown"),"sdk_upload_unknown");
 assert.notEqual(d.newCorrelationId(),d.newCorrelationId());
 assert.doesNotThrow(()=>d.emit({info(){throw Error("logger unavailable");}},{}));
});
