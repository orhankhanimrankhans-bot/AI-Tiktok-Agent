const test = require("node:test"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { TikTokStore, hash } = require("./tiktokStore");
const { createTikTokWorkflowService } = require("./tiktokWorkflow");
const { createFacebookTikTokCrosspost } = require("./facebookTikTokCrosspost");
const { createFacebookTikTokSource, mediaUrl, boundedBytes } = require("./facebookTikTokSource");
const owner = { ownerType: "admin", ownerId: "primary" }, other = { ownerType: "additional", ownerId: "other" };
const fields = { title: "Reviewed Facebook caption", privacy_level: "SELF_ONLY", consent: true, musicConsent: true };
function movie() {
  const b = Buffer.alloc(52); b.writeUInt32BE(12); b.write("ftyp", 4); b.write("isom", 8); b.writeUInt32BE(40,12); b.write("moov",16); b.writeUInt32BE(32,20); b.write("mvhd",24); b.writeUInt32BE(1000,40); b.writeUInt32BE(10000,44); return b;
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fbtt-")), store = new TikTokStore(new DatabaseSync(":memory:"), "secret");
  let denied = false, time = Date.now(), outcome = "PUBLISH_COMPLETE", lost = false;
  const calls = [], registered = new Map();
  const config = { configured: true, clientKey: "key", clientSecret: "secret", redirectUri: "https://corex.test/api/tiktok/auth/callback", directPostEnabled: true, directPostPublicEnabled: false };
  const configHash = hash(JSON.stringify([config.clientKey, config.clientSecret, config.redirectUri]));
  const account = hash("creator" + configHash);
  store.save(owner, { openId: "creator", configHash, accessToken: "never-expose", scopes: "user.info.basic,video.upload,video.publish" });
  const authorize = () => { if (denied) throw new Error("revoked"); };
  const api = { access: async a => a, request: async route => {
    calls.push(route);
    if (route.includes("creator_info")) return { data: { creator_nickname: "Creator", privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], max_video_post_duration_sec: 60, comment_disabled: false, duet_disabled: false, stitch_disabled: false } };
    if (route.includes("init/")) { if (lost) throw new Error("response lost"); return { data: { publish_id: "post-1" } }; }
    return { data: { status: outcome } };
  } };
  const tiktok = createTikTokWorkflowService({ store, config, api, binaryDirectory: dir, authorizeOwner: authorize, sleep: async () => {}, requireMedia: (reference, who) => assert.deepEqual(registered.get(reference), who) });
  const source = { validate: (o,c,p) => { assert.equal(c,"credential"); assert.equal(p,"123"); },
    list: async () => ({ videos: [{ id: "456", caption: "Original caption", createdAt: time }], limited: false }), download: async () => movie() };
  const deps = { db: store.db, source, tiktok, authorize, registerMedia: (result,o) => registered.set(result.binary.referenceId,o), binaryDirectory: dir, now: () => time };
  const service = createFacebookTikTokCrosspost(deps);
  t.after(async () => { service.stop(); store.db.close(); const resolved = path.resolve(dir); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true }); });
  const route = await service.create(owner, { credential: "credential", page: "123", account });
  await service.scan(owner, route.id);
  const item = service.list(owner).items[0];
  const approve = async () => { await service.review(owner, item.id); await service.approve(owner, item.id, fields); };
  return { service, deps, store, route, item, account, calls, approve, dir, revoke: () => { denied = true; }, setTime: v => { time = v; }, now: () => time, setOutcome: v => { outcome = v; }, lose: () => { lost = true; } };
}
test("discovery deduplicates and cannot schedule unreviewed videos", async t => {
  const f = await fixture(t);
  await f.service.scan(owner,f.route.id); await f.service.toggle(owner,f.route.id,true); await f.service.tick();
  assert.equal(f.service.list(owner).items.length,1);
  assert.equal(f.service.list(owner).items[0].status,"NEEDS_REVIEW");
  await assert.rejects(f.service.schedule(owner,f.item.id,f.now()),/review and approve/i);
  assert.equal(f.calls.filter(r=>r.includes("init/")).length,0);
  const duplicate = await f.service.create(owner,{credential:"credential",page:"123",account:f.account}); assert.equal(duplicate.id,f.route.id);
});
test("review requires music consent and preserves private-only audit gate", async t => {
  const f=await fixture(t); await f.service.review(owner,f.item.id);
  await assert.rejects(f.service.approve(owner,f.item.id,{...fields,musicConsent:false}));
  await assert.rejects(f.service.approve(owner,f.item.id,{...fields,privacy_level:"PUBLIC_TO_EVERYONE"}));
  await f.service.approve(owner,f.item.id,fields); assert.equal(f.service.list(owner).items[0].status,"APPROVED");
  assert.equal(f.calls.filter(r=>r.includes("init/")).length,0);
});
test("schedule survives service restart and publishes exactly once", async t => {
  const f=await fixture(t); await f.approve();
  await f.service.schedule(owner,f.item.id,f.now()+60000); await f.service.tick(); assert.equal(f.calls.filter(r=>r.includes("init/")).length,0);
  const restarted=createFacebookTikTokCrosspost(f.deps); f.setTime(f.now()+60001); await restarted.tick(); await restarted.tick();
  assert.equal(restarted.list(owner).items[0].status,"PUBLISHED"); assert.equal(f.calls.filter(r=>r.includes("init/")).length,1);
  await assert.rejects(restarted.schedule(owner,f.item.id,f.now()));
  await restarted.cancel(owner,f.item.id,true); await restarted.scan(owner,f.route.id); assert.equal(restarted.list(owner).items[0].status,"PUBLISHED");
});
test("lost provider response and processing never trigger duplicate uploads", async t => {
  const f=await fixture(t); await f.approve(); f.lose(); await f.service.schedule(owner,f.item.id,f.now()); await f.service.tick();
  assert.equal(f.service.list(owner).items[0].status,"OUTCOME_UNCERTAIN");
  await f.service.tick(); await assert.rejects(f.service.cancel(owner,f.item.id,true));
  assert.equal(f.calls.filter(r=>r.includes("init/")).length,1);
});
test("processing eventually becomes published using status only", async t => {
  const f=await fixture(t); await f.approve(); f.setOutcome("PROCESSING_DOWNLOAD"); await f.service.schedule(owner,f.item.id,f.now()); await f.service.tick();
  assert.equal(f.service.list(owner).items[0].status,"PROCESSING_DOWNLOAD");
  f.setOutcome("PUBLISH_COMPLETE"); await f.service.tick(); assert.equal(f.service.list(owner).items[0].status,"PUBLISHED"); assert.equal(f.calls.filter(r=>r.includes("init/")).length,1);
});
test("owner isolation, revocation and schedule cancellation prevent publication", async t => {
  const f=await fixture(t); assert.equal(f.service.list(other).items.length,0);
  await assert.rejects(f.service.review(other,f.item.id)); await assert.rejects(f.service.scan(other,f.route.id));
  await f.approve(); await f.service.schedule(owner,f.item.id,f.now()); await f.service.cancel(owner,f.item.id); await f.service.tick();
  assert.equal(f.calls.filter(r=>r.includes("init/")).length,0);
  await f.approve(); await f.service.schedule(owner,f.item.id,f.now()); f.revoke(); await f.service.tick(); assert.equal(f.calls.filter(r=>r.includes("init/")).length,0);
});
test("concurrent publication and foreign approval IDs cannot cross items", async t => {
  const f=await fixture(t); await f.service.review(owner,f.item.id);
  await f.service.approve(owner,f.item.id,{...fields,reviewId:"foreign"});
  await f.service.schedule(owner,f.item.id,f.now());
  await Promise.allSettled([f.service.publish(owner,f.item.id),f.service.publish(owner,f.item.id)]);
  assert.equal(f.calls.filter(r=>r.includes("init/")).length,1);
});
test("source URLs reject arbitrary hosts, credentials, redirects and oversized responses",async()=>{
  for(const value of ["http://video.fbcdn.net/x","https://localhost/x","https://127.0.0.1/x","https://fbcdn.net.evil.test/x","https://user@video.fbcdn.net/x","https://video.fbcdn.net:444/x"]) assert.throws(()=>mediaUrl(value));
  assert.equal(mediaUrl("https://video.fbcdn.net/x").hostname,"video.fbcdn.net");
  await assert.rejects(boundedBytes(new Response("12345"),4));
  const seen=[];
  const source=createFacebookTikTokSource({credentialStore:{get:()=>({pageId:"123",authMode:"manual_access_token",tokens:{pageAccessToken:"secret"}})},graphServiceFactory:()=>({baseUrl:"https://graph.facebook.com/v24.0"}), fetchImpl:async(url,options)=>{
    seen.push({url:String(url),options}); return new Response(JSON.stringify({id:"456",from:{id:"999"},source:"https://video.fbcdn.net/x"}));
  }});
  await assert.rejects(source.download(owner,"credential","123","456"),/does not belong/); assert.equal(seen.length,1);assert.equal(seen[0].options.redirect,"error");
});
test("Graph pagination uses fixed endpoint cursors and keeps source URLs off listing responses",async()=>{
  const seen=[]; const source=createFacebookTikTokSource({credentialStore:{get:()=>({pageId:"123",authMode:"manual_access_token",tokens:{pageAccessToken:"secret"}})},graphServiceFactory:()=>({baseUrl:"https://graph.facebook.com/v24.0"}),fetchImpl:async(url)=>{
    seen.push(String(url));return new Response(JSON.stringify({data:[{id:seen.length===1?"456":"789",description:"caption",source:"secret-url"}],...(seen.length===1?{paging:{next:"https://evil.test/",cursors:{after:"cursor"}}}:{})}));
  }});
  const result=await source.list(owner,"credential","123");assert.equal(result.videos.length,2);assert.ok(seen.every(u=>u.startsWith("https://graph.facebook.com/v24.0/123/videos?")));assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test("HTTP endpoints keep authentication, existing permissions, CSRF and workspace boundaries",async t=>{
  const express=require("express"),{registerFacebookTikTokRoutes}=require("./facebookTikTokRoutes"),f=await fixture(t),app=express();app.use(express.json());
  app.use((req,res,next)=>{const role=req.get("X-Test-Role");req.session=role?{jarvisAuth:role==="admin"?{role,authVersion:1}:{role:"additional",profileId:role}}:{};next();});
  const security={securityState:()=>"enabled",settings:()=>({auth_version:1}),getChild:id=>({enabled:true,permissions:{view_facebook:id!=="denied",manage_workflow_credentials:true,run_workflow:true}})};
  registerFacebookTikTokRoutes(app,{getService:()=>f.service,getAccessStore:()=>security,clientUrl:"https://corex.test"});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/api/crosspost/facebook-tiktok`,headers={"X-Test-Role":"admin",Origin:"https://corex.test","X-Corex-Crosspost":"1","Content-Type":"application/json"};
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,"X-Test-Role":"denied"}})).status,403);
  assert.equal((await fetch(`${url}/routes/${f.route.id}/scan`,{method:"POST",headers:{...headers,Origin:"https://evil.test"},body:"{}"})).status,403);
  assert.equal((await fetch(`${url}/routes/${f.route.id}/scan`,{method:"POST",headers:{...headers,"X-Test-Role":"other"},body:"{}"})).status,404);
  const data=await(await fetch(url,{headers})).json();assert.equal(data.items.length,1);assert.doesNotMatch(JSON.stringify(data),/never-expose|reference|source_url/);
});
