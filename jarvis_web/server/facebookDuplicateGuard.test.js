"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { FacebookDuplicateGuard } = require("./facebookDuplicateGuard");
const { publishPageReel } = require("./facebookReels");
const owner = { ownerType: "admin", ownerId: "primary" };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-dedup-"));
  const db = new DatabaseSync(path.join(dir,"db.sqlite"));
  const guard = new FacebookDuplicateGuard(db); guard.open();
  const referenceId = "bin_1234567890123456789012";
  fs.writeFileSync(path.join(dir,referenceId),"video contents");
  t.after(() => { db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  let starts = 0, finishes = 0;
  const service = {
    pageIdentity: async () => ({ id:"123456",name:"Page" }),
    startPageReelUpload: async () => { starts++; return { videoId:"987654",uploadUrl:"https://rupload.facebook.com/video-upload/test" }; },
    finishPageReelUpload: async () => { finishes++; },
    reelStatus: async () => ({ status:{ video_status:"published", publishing_phase:{status:"complete"} } }),
  };
  const options = { owner, duplicateGuard:guard, binaryDir:dir, service,
    credential:{ pageId:"123456",authMode:"manual_access_token",tokens:{pageAccessToken:"secret"} },
    request:{ binary:{property:"data",referenceId},fileName:"video.mp4",mimeType:"video/mp4",sourceFileId:"drive-one" },
    uploadFetch:async (_url,config) => { for await (const chunk of config.body) assert.ok(chunk.length); return {ok:true,status:200,text:async()=>JSON.stringify({success:true})}; },
    maxAttempts:1 };
  return { db,guard,dir,options,counts:()=>({starts,finishes}) };
}
test("same Page video is reused after success even with a new source ID or title",async t=>{
  const f=fixture(t); const first=await publishPageReel(f.options);
  const second=await publishPageReel({...f.options,request:{...f.options.request,sourceFileId:"copied-file",title:"new caption"}});
  assert.equal(first.status,"published"); assert.equal(second.duplicateBlocked,true);
  assert.equal(second.videoId,first.videoId); assert.deepEqual(f.counts(),{starts:1,finishes:1});
});
test("concurrent requests and restart never initialize a second upload",async t=>{
  const f=fixture(t);
  let attempts=0;
  f.options.service.startPageReelUpload=async()=>{attempts++;throw new Error("lost connection after submission");};
  const results=await Promise.allSettled([publishPageReel(f.options),publishPageReel(f.options)]);
  assert.ok(results.every(r=>r.status==="rejected"));
  assert.equal(attempts,1);
  const reopened=new FacebookDuplicateGuard(f.db); reopened.open();
  await assert.rejects(publishPageReel({...f.options,duplicateGuard:reopened}),e=>e.code==="facebook_duplicate_pending");
  assert.equal(attempts,1);
});
test("processing failure retries only status and can recover completed upload",async t=>{
  const f=fixture(t); const status=f.options.service.reelStatus;
  f.options.service.reelStatus=async()=>({status:{video_status:"processing"}});
  await assert.rejects(publishPageReel(f.options),e=>e.code==="reel_processing_timeout");
  await assert.rejects(publishPageReel(f.options),e=>e.code==="facebook_duplicate_pending");
  f.options.service.reelStatus=status;
  assert.equal((await publishPageReel(f.options)).duplicateBlocked,true);
  assert.deepEqual(f.counts(),{starts:1,finishes:1});
});
test("all owner types are protected and different destinations remain independent",t=>{
  const f=fixture(t);
  for(const ownerType of ["admin","child","additional"]){
    const input={owner:{ownerType,ownerId:"user"},pageId:"123456",sourceId:"file",digest:"hash"};
    assert.equal(f.guard.reserve(input).acquired,true);
    assert.equal(f.guard.reserve(input).acquired,false);
    assert.equal(f.guard.reserve({...input,pageId:"234567"}).acquired,true);
  }
});
test("historical source IDs seed protection without claiming unverified success",t=>{
  const f=fixture(t);
  f.db.exec(`CREATE TABLE facebook_publications(owner_type TEXT,owner_id TEXT,expected_page_id TEXT,source_file_id TEXT,video_id TEXT);
    INSERT INTO facebook_publications VALUES('admin','primary','123456','old-file','987654');`);
  f.guard.open(); f.guard.open();
  const claim=f.guard.reserve({owner,pageId:"123456",sourceId:"old-file",digest:"old-hash"});
  assert.equal(claim.acquired,false); assert.equal(claim.video_id,"987654"); assert.equal(claim.result_json,null);
  assert.equal(f.guard.reserve({owner,pageId:"123456",sourceId:"copy",digest:"old-hash"}).acquired,false);
});
