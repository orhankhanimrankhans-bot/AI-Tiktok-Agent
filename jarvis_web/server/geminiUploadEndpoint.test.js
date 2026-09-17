const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {GoogleGenAI}=require("@google/genai");
const {developerUploadConfig,classifyUpload}=require("./geminiVideoAnalysis");
test("installed SDK reproduces bad initialization path and corrected upload completes with versioned model API unchanged",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sdk-upload-route-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,"fixture.mp4");fs.writeFileSync(file,Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]));
 const original=global.fetch,requests=[];t.after(()=>global.fetch=original);
 // All requests are intercepted; no network, real key or user video is used.
 global.fetch=async(input,options={})=>{
  const url=new URL(typeof input==="string"?input:input.url||String(input)),headers=new Headers(options.headers);
  requests.push({path:url.pathname,method:options.method,headers});
  if(url.pathname==="/v1beta/upload/v1beta/files")return new Response(JSON.stringify({error:{code:404,status:"NOT_FOUND",message:"not found"}}),{status:404,headers:{"content-type":"application/json"}});
  if(url.pathname==="/upload/v1beta/files"){
   assert.equal(headers.get("x-goog-upload-protocol"),"resumable");assert.equal(headers.get("x-goog-upload-command"),"start");
   assert.equal(headers.get("x-goog-upload-header-content-length"),String(fs.statSync(file).size));
   assert.equal(headers.get("x-goog-upload-header-content-type"),"video/mp4");
   return new Response("",{status:200,headers:{"x-goog-upload-url":"https://generativelanguage.googleapis.com/test-transfer"}});
  }
  if(url.pathname==="/test-transfer"){
   assert.match(headers.get("x-goog-upload-command"),/finalize/);
   return new Response(JSON.stringify({file:{name:"files/test",uri:"test-uri",state:"ACTIVE"}}),{status:200,headers:{"content-type":"application/json","x-goog-upload-status":"final"}});
  }
  if(url.pathname==="/v1beta/models/gemini-2.5-flash:generateContent")return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"ok"}]},finishReason:"STOP"}]}),{status:200,headers:{"content-type":"application/json"}});
  assert.fail("Unexpected SDK path: "+url.pathname);
 };
 const client=new GoogleGenAI({apiKey:"inert-test-key"});
 await assert.rejects(client.files.upload({file,config:{mimeType:"video/mp4",httpOptions:{retryOptions:{attempts:1},timeout:1000}}}),e=>{assert.equal(e.name,"ApiError");assert.equal(e.status,404);assert.equal(classifyUpload(e).retryable,false);return true;});
 assert.equal(requests.length,1);assert.equal(requests[0].headers.get("x-goog-upload-protocol"),null);
 const result=await client.files.upload({file,config:developerUploadConfig(file,"video/mp4",fs.statSync(file).size,1000)});
 assert.equal(result.name,"files/test");
 await client.models.generateContent({model:"gemini-2.5-flash",contents:"test"});
 assert.deepEqual(requests.map(r=>r.path),["/v1beta/upload/v1beta/files","/upload/v1beta/files","/test-transfer","/v1beta/models/gemini-2.5-flash:generateContent"]);
 console.log("Sanitized SDK route reproduction: old initialization 404; corrected initialization and finalization 200.");
});
