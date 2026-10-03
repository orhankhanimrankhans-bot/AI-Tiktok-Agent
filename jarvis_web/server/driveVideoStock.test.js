const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createDriveVideoStock, discoverSources, countFolder, statusFor, isVideo, SIX_HOURS } = require("./driveVideoStock");
const owner = { ownerType: "admin", ownerId: "primary" };
const workflow = (who = owner, folderId = "folder") => ({ ...who, nodes: [{ name: "Search Files and Folders", config: { folderId, credentialId: "credential" } }, { name: "Move File", config: { folderId: "posted" } }] });
test("exact stock boundaries and supported media", () => {
  for (const [n,s] of [[20,"HEALTHY"],[11,"HEALTHY"],[10,"LOW"],[6,"LOW"],[5,"CRITICAL"],[1,"CRITICAL"],[0,"CRITICAL"]]) assert.equal(statusFor(n),s);
  for (const ext of ["MP4","mov","mkv","webm","avi","m4v"]) assert.ok(isVideo({name:`test.${ext}`}));
  assert.equal(isVideo({ name:"image.png",mimeType:"image/png" }),false);
  assert.equal(isVideo({ name:"fake.mp4",mimeType:"application/vnd.google-apps.folder" }),false);
});
test("discovery includes only configured source nodes and isolates owners", () => {
  assert.equal(discoverSources([workflow(),workflow()]).length,1);
  assert.equal(discoverSources([workflow(),workflow({ownerType:"additional",ownerId:"other"})]).length,2);
});
test("metadata-only pagination, real name, nonvideo exclusion, empty folder", async () => {
  let calls=0;
  const args = { source:{...owner,folderId:"folder",credentialId:"credential"}, credentialStore:{ get:async (_id,opts)=>{assert.deepEqual(opts.owner,owner);return {tokens:{},id:"credential"};} }, createOAuthClient:()=>({setCredentials(){},on(){}}), createDriveClient:()=>({files:{get:async()=>({data:{name:"Real folder",mimeType:"application/vnd.google-apps.folder"}}),list:async params=>{calls++;assert.ok(params.q.includes("trashed = false"));return {data:params.pageToken?{files:[{name:"b.mov"}]}:{files:[{name:"a.mp4"},{name:"a.txt"}],nextPageToken:"next"}};}}}) };
  assert.deepEqual(await countFolder(args),{name:"Real folder",count:2}); assert.equal(calls,2);
  args.createDriveClient=()=>({files:{get:async()=>({data:{name:"Empty",mimeType:"application/vnd.google-apps.folder"}}),list:async()=>({data:{files:[]}})}});
  assert.deepEqual(await countFolder(args),{name:"Empty",count:0});
});
test("persistence, six-hour due check, all transitions, errors preserve last success, owner isolation", async () => {
  const db=new DatabaseSync(":memory:");let time=1000,value=20,fail=false,calls=0;const logs=[];
  const other={ownerType:"additional",ownerId:"other"};
  const options={db,listWorkflows:()=>[workflow(),workflow(other)],authorize:()=>{},now:()=>time,logger:{info:(_msg,event)=>logs.push(event),error(){}},count:async()=>{calls++;if(fail)throw Error("secret token");return {name:"Real",count:value};}};
  let service=createDriveVideoStock(options);
  await service.scan(owner);assert.equal(calls,1);await service.scan(owner);assert.equal(calls,1);
  assert.equal(service.snapshot(other).folders[0].count,null);
  service=createDriveVideoStock(options);await service.scan(owner);assert.equal(calls,1);
  time+=SIX_HOURS;await service.scan(owner);assert.equal(calls,2);assert.equal(logs.length,1);
  for (const n of [10,5,20,5,10,20]) {value=n;await service.scan(owner,true);}
  assert.equal(logs.length,7);
  const success=service.snapshot(owner).folders[0].lastSuccess;time++;fail=true;await service.scan(owner,true);
  const row=service.snapshot(owner).folders[0];assert.equal(row.count,20);assert.equal(row.lastSuccess,success);assert.equal(row.status,"UNAVAILABLE");assert.ok(!row.error.includes("secret"));
  fail=false;await service.scan(owner,true);assert.equal(service.snapshot(owner).folders[0].status,"HEALTHY");db.close();
});
test("shared persistent lock prevents overlapping scans and authorization is enforced", async () => {
  const db=new DatabaseSync(":memory:");let release;const pending=new Promise(r=>release=r);
  const options={db,listWorkflows:()=>[workflow()],authorize:who=>{if(who.ownerId!=="primary")throw Error("denied");},count:async()=>{await pending;return {name:"Folder",count:1};},logger:{info(){},error(){}}};
  const a=createDriveVideoStock(options),b=createDriveVideoStock(options);const run=a.scan(owner,true);
  assert.equal(await b.scan(owner,true),false);assert.throws(()=>a.snapshot({ownerType:"additional",ownerId:"other"}));release();await run;db.close();
});
test("missing folder, permission, quota and network failures never report zero", async () => {
  for (const code of [404,403,429,"ETIMEDOUT"]) {
    const db=new DatabaseSync(":memory:");
    const service=createDriveVideoStock({db,listWorkflows:()=>[workflow()],authorize:()=>{},count:async()=>{throw Object.assign(Error("provider secret"),{code});}});
    await service.scan(owner);const row=service.snapshot(owner).folders[0];assert.equal(row.count,null);assert.equal(row.status,"UNAVAILABLE");assert.equal(row.lastSuccess,null);db.close();
  }
});
