const test = require("node:test"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { TikTokStore, hash } = require("./tiktokStore");
const { createTikTokWorkflowService } = require("./tiktokWorkflow");
const { postInfo, movieDuration } = require("./tiktokDirect");
const owner = { ownerType: "admin", ownerId: "primary" }, other = { ownerType: "additional", ownerId: "other" };
function movie(seconds = 10) {
  const bytes = Buffer.alloc(44); bytes.writeUInt32BE(12, 0); bytes.write("ftyp", 4); bytes.write("isom", 8);
  bytes.writeUInt32BE(32, 12); bytes.write("moov", 16); bytes.writeUInt32BE(24, 20); bytes.write("mvhd", 24);
  // version/flags at 28, creation at 32, modification at 36, timescale at 40.
  const video = Buffer.concat([bytes, Buffer.alloc(8)]); video.writeUInt32BE(40,12);video.writeUInt32BE(32,20);
  video.writeUInt32BE(1000,40);video.writeUInt32BE(seconds*1000,44);return video;
}
const info = { creator_nickname: "Test creator", privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], max_video_post_duration_sec: 60, comment_disabled: false, duet_disabled: true, stitch_disabled: false };
const fields = { title: "Reviewed caption", privacy_level: "SELF_ONLY", consent: true, musicConsent: true };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-direct-"));
  const store = new TikTokStore(new DatabaseSync(":memory:"), "secret");
  t.after(async () => { store.db.close(); await fs.rm(dir, { recursive: true }); });
  const config = { configured: true, clientKey: "key", clientSecret: "secret", redirectUri: "https://corex.test/api/tiktok/auth/callback", directPostEnabled: true, directPostPublicEnabled: false };
  const configHash = hash(JSON.stringify([config.clientKey,config.clientSecret,config.redirectUri]));
  store.save(owner, { openId: "creator", configHash, accessToken: "do-not-expose", scopes: "user.info.basic,video.upload,video.publish" });
  const reference = "bin_abcdefghijklmnopqrstuv";
  await fs.writeFile(path.join(dir,reference), movie());
  const request = { operation: "Direct Post", credentialId: hash("creator"+configHash), binaryProperty: "data", binary: { property: "data", referenceId: reference }, sourceFileId: "drive-source", mimeType: "video/mp4" };
  let providerStatus = "PUBLISH_COMPLETE", unavailable = false, denied = false; const calls = [];
  const api = { access: async value => value, request: async (route, options) => {
    calls.push({ route, options });
    if (route.includes("creator_info")) return { data: info };
    if (route.includes("init/")) { if (unavailable) throw new Error("network lost"); return { data: { publish_id: "provider-post" } }; }
    return { data: { status: providerStatus } };
  } };
  const service = createTikTokWorkflowService({ store, config, api, binaryDirectory: dir, sleep: async()=>{},
    authorizeOwner: () => { if (denied) throw new Error("revoked"); }, requireMedia: async (ref, who) => { assert.deepEqual(who,owner); assert.equal(ref,reference); } });
  const approve = async () => { const value = await service.direct.review(request,owner); await service.direct.approve({ ...fields, reviewId: value.id },owner); return value; };
  return { service,store,config,request,dir,reference,calls,approve,setStatus: value=>{providerStatus=value;},loseResponse:()=>{unavailable=true;},revoke:()=>{denied=true;} };
}
test("Direct Post requires an exact reviewed video and confirms publication before archive",async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.uploadVideo(f.request,owner),e=>e.code==="tiktok_review_required");
  await f.approve();const result=await f.service.uploadVideo(f.request,owner);
  assert.equal(result.status,"direct_published");assert.equal(result.postStatus,"PUBLISH_COMPLETE");assert.equal(result.sourceFileId,"drive-source");
  const init=f.calls.find(x=>x.route.includes('init/'));
  assert.equal(init.options.body.source_info.source,"PULL_FROM_URL");assert.equal(init.options.body.post_info.disable_comment,true);
  assert.equal(init.options.body.post_info.privacy_level,"SELF_ONLY");assert.doesNotMatch(JSON.stringify(result),/do-not-expose|video_url/);
  await f.service.uploadVideo(f.request,owner);assert.equal(f.calls.filter(x=>x.route.includes('init/')).length,1);
});
test("private testing, missing consent, disabled interactions and commercial disclosure fail closed",()=>{
  for (const patch of [{privacy_level:""},{privacy_level:"PUBLIC_TO_EVERYONE"},{allow_duet:true},{discloseCommercial:true},{discloseCommercial:true,brand_content_toggle:true},{title:"a".repeat(2201)}]) assert.throws(()=>postInfo({...fields,...patch},info,10,false));
  assert.throws(()=>postInfo(fields,info,61,false));
  assert.equal(postInfo({...fields,privacy_level:"PUBLIC_TO_EVERYONE"},info,10,true).privacy_level,"PUBLIC_TO_EVERYONE");
  assert.equal(movieDuration(movie()),10);assert.throws(()=>movieDuration(Buffer.from('not a movie')));
});
test("review is workspace-bound, consent-bound, expiry-bound and cannot approve modified bytes",async t=>{
  const f=await fixture(t),r=await f.service.direct.review(f.request,owner);
  await assert.rejects(f.service.direct.preview(other,r.id));
  await assert.rejects(f.service.direct.approve({...fields,reviewId:r.id,consent:false},owner));
  await assert.rejects(f.service.direct.approve({...fields,reviewId:r.id,musicConsent:false},owner));
  await fs.writeFile(path.join(f.dir,f.reference),movie(11));
  await assert.rejects(f.service.direct.approve({...fields,reviewId:r.id},owner),e=>e.code==='tiktok_video_changed');
  f.store.db.exec('UPDATE tiktok_direct_reviews SET expires_at=0');
  await assert.rejects(f.service.direct.preview(owner,r.id));
  assert.equal(f.calls.filter(x=>x.route.includes('init/')).length,0);
});
test("pending, failed and inbox statuses never report direct publication; retry never resends",async t=>{
  const f=await fixture(t);await f.approve();f.setStatus('PROCESSING_DOWNLOAD');
  await assert.rejects(f.service.uploadVideo(f.request,owner),e=>e.code==='tiktok_post_pending');
  f.setStatus('SEND_TO_USER_INBOX');await assert.rejects(f.service.uploadVideo(f.request,owner),e=>e.code==='tiktok_unknown_status');
  f.setStatus('FAILED');await assert.rejects(f.service.uploadVideo(f.request,owner));
  assert.equal(f.calls.filter(x=>x.route.includes('init/')).length,1);
});
test("uncertain init survives retries and never initializes twice",async t=>{
  const f=await fixture(t);await f.approve();f.loseResponse();
  await assert.rejects(f.service.uploadVideo(f.request,owner));await assert.rejects(f.service.uploadVideo(f.request,owner));
  assert.equal(f.calls.filter(x=>x.route.includes('init/')).length,1);
});
test("media capabilities require consent, expire, and stop working after revocation",async t=>{
  const f=await fixture(t);await f.approve();f.setStatus('PROCESSING_DOWNLOAD');
  await assert.rejects(f.service.uploadVideo(f.request,owner));
  const token=new URL(f.calls.find(x=>x.route.includes('init/')).options.body.source_info.video_url).pathname.split('/').pop();
  assert.equal((await f.service.direct.publicMedia(token)).bytes.length,movie().length);
  await assert.rejects(f.service.direct.publicMedia('bad'));
  f.revoke();await assert.rejects(f.service.direct.publicMedia(token));
  f.store.db.exec('UPDATE tiktok_direct_media SET expires_at=0');await assert.rejects(f.service.direct.publicMedia(token));
});
test("expired and cancelled approvals cannot publish; disconnect removes direct records",async t=>{
  const f=await fixture(t),r=await f.approve();
  f.store.db.exec('UPDATE tiktok_direct_reviews SET expires_at=0');await assert.rejects(f.service.uploadVideo(f.request,owner));
  f.service.direct.cancel(owner,r.id);await assert.rejects(f.service.uploadVideo(f.request,owner));
  f.service.direct.remove(owner);assert.deepEqual(f.service.direct.recent(owner),[]);
});
test("Direct HTTP routes require login and CSRF; preview never leaks across workspaces",async t=>{
  const express=require('express'),{registerTikTokRoutes}=require('./tiktokRoutes');
  const f=await fixture(t),app=express();app.use(express.json());
  app.use((req,res,next)=>{req.sessionID='test';const role=req.get('X-Test-Role');req.session=role?{jarvisAuth:role==='admin'?{role,authVersion:1}:{role:'additional',profileId:'other'}}:{};next();});
  const security={settings:()=>({auth_version:1}),getChild:()=>({enabled:true,permissions:{manage_workflow_credentials:true,run_workflow:true}})};
  registerTikTokRoutes(app,{getStore:()=>f.store,getAccessStore:()=>security,getWorkflowService:()=>f.service,clientUrl:'https://corex.test',config:f.config});
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/tiktok`;
  const headers={'X-Test-Role':'admin',Origin:'https://corex.test','X-Corex-TikTok':'1','Content-Type':'application/json'};
  for(const route of ['/direct/posts','/direct/reviews/unknown/preview'])assert.equal((await fetch(base+route)).status,401);
  assert.equal((await fetch(base+'/direct/review',{method:'POST',headers:{...headers,Origin:'https://foreign.test'},body:JSON.stringify(f.request)})).status,403);
  const response=await fetch(base+'/direct/review',{method:'POST',headers,body:JSON.stringify(f.request)});assert.equal(response.status,200);const review=await response.json();
  assert.equal((await fetch(base+`/direct/reviews/${review.id}/preview`,{headers})).status,200);
  assert.equal((await fetch(base+`/direct/reviews/${review.id}/preview`,{headers:{...headers,'X-Test-Role':'other'}})).status,404);
  assert.equal((await fetch(base+'/media/invalid')).status,404);
  assert.equal((await fetch(base+'/direct/approve',{method:'POST',headers,body:JSON.stringify({...fields,reviewId:review.id,consent:false})})).status,400);
  assert.equal(f.calls.filter(x=>x.route.includes('init/')).length,0);
});
