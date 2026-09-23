"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,execFile}=require('node:child_process'),{once}=require('node:events'),{promisify}=require('node:util');
const {DatabaseSync}=require('node:sqlite');
const {FacebookCredentialStore:ProductionStore}=require('../candidate-review/baseline-store/facebookCredentialStore');

test('real HTTP: config CRUD, OAuth callback, Graph use, legacy compatibility and secret-safe responses', {timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corex-meta-only-http-'));
 const dbPath=path.join(dir,'credentials.sqlite3'),db=new DatabaseSync(dbPath);
 const old=new ProductionStore({db,encryptionSecret:'http-test-encryption-secret'});old.open();
 const legacy=old.save({id:ProductionStore.generateId(),accountId:'800001',pageId:'700001',pageName:'Legacy Page',tokens:{userAccessToken:'http-private-legacy-user',pageAccessTokens:{700001:'http-private-legacy-page'}}},{ownerType:'admin',ownerId:'primary'});
 const legacyBefore=db.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(legacy.id);db.close();
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--require',path.join(__dirname,'testFixtures/metaProvider.cjs'),path.join(__dirname,'index.js')],{cwd:dir,windowsHide:true,env:{...process.env,NODE_TEST_CONTEXT:'',NODE_ENV:'development',PORT:String(port),CLIENT_URL:base,JARVIS_DB_PATH:dbPath,WORKFLOW_DB_PATH:path.join(dir,'workflows.sqlite3'),BINARY_DATA_DIR:path.join(dir,'binary-data'),SESSION_SECRET:'http-test-session-secret',CREDENTIAL_ENCRYPTION_SECRET:'http-test-encryption-secret',META_APP_ID:'999999',META_APP_SECRET:'http-private-global-must-not-be-used',GEMINI_API_KEY:'',OPENAI_API_KEY:'inert-http-fixture-key',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
 let logs='',bodies='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 t.after(async()=>{if(child.exitCode===null){const end=once(child,'exit');child.kill();await end;}fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;for(let i=0;i<180;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,`Fixture server starts: ${logs}`);
 async function request(cookie,method,route,body){const r=await fetch(base+route,{method,redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();bodies+=text;let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0],setCookie:r.headers.get('set-cookie'),location:r.headers.get('location'),cache:r.headers.get('cache-control')};}
 assert.equal((await request(null,'GET','/api/facebook/meta-config')).status,401);
 const password='Meta-only-test-password!2026';const admin=await request(null,'POST','/api/security/setup',{password,confirmPassword:password,email:'admin@example.test'});assert.equal(admin.status,201);assert.match(admin.setCookie,/HttpOnly/i);
 const users=[];for(const name of ['a','b','c']){const profile=await request(admin.cookie,'POST','/api/security/children',{displayName:name,email:`${name}@example.test`,password,permissions:{view_facebook:true,publish_facebook:true}});assert.equal(profile.status,201);const login=await request(null,'POST','/api/security/login',{role:'additional',profileId:profile.data.id,password});assert.equal(login.status,200);users.push(login);}
 const [a,b,c]=users;assert.notEqual(a.data.session.workspaceId,b.data.session.workspaceId);
 const legacyResult=await request(admin.cookie,'POST','/api/facebook/graph/me',{credentialId:legacy.id});assert.equal(legacyResult.status,200);assert.equal(legacyResult.data.id,'800001');assert.equal((await request(admin.cookie,'GET','/api/facebook/meta-config')).data.configured,false);
 for(const route of ['/api/facebook/graph/me','/api/facebook/graph/pages','/api/facebook/reels/publish'])assert.equal((await request(a.cookie,'POST',route,{credentialId:legacy.id,binary:{referenceId:'fixture'}})).status,404);
 assert.equal((await request(c.cookie,'GET','/api/facebook/auth/start')).data.code,'META_APP_NOT_CONFIGURED');
 const config=id=>({appId:id,appSecret:'http-private-app-'+id,graphVersion:'v26.0',redirectUri:base+'/api/facebook/auth/callback'});
 assert.equal((await request(a.cookie,'PUT','/api/facebook/meta-config',config('111111'))).status,200);assert.equal((await request(b.cookie,'PUT','/api/facebook/meta-config',config('222222'))).status,200);
 assert.equal((await request(a.cookie,'GET',`/api/facebook/meta-config?ownerId=${b.data.session.profileId}`)).data.appId,'111111');
 assert.equal((await request(a.cookie,'PUT','/api/facebook/meta-config',{...config('333333'),ownerId:b.data.session.profileId})).status,400);
 assert.equal((await request(a.cookie,'PUT',`/api/facebook/meta-config?ownerId=${b.data.session.profileId}`,config('111111'))).status,200);assert.equal((await request(b.cookie,'GET','/api/facebook/meta-config')).data.appId,'222222');
 const flowA=await request(a.cookie,'GET','/api/facebook/auth/start?mode=popup'),flowB=await request(b.cookie,'GET','/api/facebook/auth/start?mode=popup');assert.equal(flowA.status,302);assert.equal(new URL(flowA.location).searchParams.get('client_id'),'111111');assert.equal(new URL(flowB.location).searchParams.get('client_id'),'222222');
 const stateA=new URL(flowA.location).searchParams.get('state'),stateB=new URL(flowB.location).searchParams.get('state');
 assert.equal((await request(b.cookie,'GET',`/api/facebook/auth/callback?state=${stateA}&code=fixture`)).status,302);
 const connectedA=await request(a.cookie,'GET',`/api/facebook/auth/callback?state=${stateA}&code=fixture`);assert.equal(connectedA.status,200);assert.match(connectedA.data,/connected/);
 assert.equal((await request(a.cookie,'GET',`/api/facebook/auth/callback?state=${stateA}&code=fixture`)).status,302);
 assert.equal((await request(b.cookie,'GET',`/api/facebook/auth/callback?state=${stateB}&code=fixture`)).status,200);
 const ca=(await request(a.cookie,'GET','/api/facebook/credentials')).data.credentials,cb=(await request(b.cookie,'GET','/api/facebook/credentials')).data.credentials;assert.equal(ca.length,1);assert.equal(cb.length,1);assert.equal(ca[0].appId,'111111');assert.equal(cb[0].appId,'222222');assert.notEqual(ca[0].id,cb[0].id);
 assert.equal((await request(a.cookie,'GET',`/api/facebook/credentials/${cb[0].id}`)).status,404);

 for (const method of ['GET','POST']) {
  const route='/api/facebook/credentials/'+cb[0].id+'/pages';
  assert.equal((await request(null,method,route,method==='POST'?{pageId:'700002'}:undefined)).status,401);
  assert.equal((await request(a.cookie,method,route,method==='POST'?{pageId:'700002'}:undefined)).status,404);
 }
 const pageList=await request(a.cookie,'GET','/api/facebook/credentials/'+ca[0].id+'/pages');
 assert.equal(pageList.status,200);assert.equal(pageList.cache,'private, no-store');
 assert.ok(pageList.data.pages.some(p=>p.connected));
 const duplicate=await request(a.cookie,'POST','/api/facebook/credentials/'+ca[0].id+'/pages',{pageId:ca[0].pageId});
 assert.equal(duplicate.status,200);assert.equal(duplicate.data.created,false);
 assert.equal((await request(a.cookie,'DELETE',`/api/facebook/credentials/${cb[0].id}`)).status,404);
 assert.equal((await request(a.cookie,'PATCH',`/api/facebook/credentials/${cb[0].id}/manual`,{name:'wrong user'})).status,404);
 assert.equal((await request(a.cookie,'GET',`/api/facebook/auth/start?credentialId=${cb[0].id}`)).status,404);
 for(const endpoint of ['me','pages','page'])assert.equal((await request(a.cookie,'POST',`/api/facebook/graph/${endpoint}`,{credentialId:cb[0].id,pageId:'700002'})).status,404);
 assert.equal((await request(a.cookie,'POST','/api/facebook/graph/pages',{credentialId:ca[0].id})).status,200);
 assert.equal((await request(b.cookie,'POST','/api/facebook/graph/me',{credentialId:cb[0].id})).data.id,'800002');
 assert.equal((await request(a.cookie,'DELETE',`/api/facebook/meta-config?ownerId=${b.data.session.profileId}`)).status,200);assert.equal((await request(b.cookie,'GET','/api/facebook/meta-config')).data.appId,'222222');
 assert.equal((await request(a.cookie,'POST','/api/facebook/graph/me',{credentialId:ca[0].id})).status,200); // owned tokens survive config removal
 const profile=await request(admin.cookie,'POST','/api/security/children',{displayName:'viewer',email:'viewer@example.test',password,permissions:{view_facebook:true}});const viewer=await request(null,'POST','/api/security/login',{role:'additional',profileId:profile.data.id,password});assert.equal((await request(viewer.cookie,'PUT','/api/facebook/meta-config',config('333333'))).status,403);
 const build=await request(null,'GET','/api/system/build');assert.equal(build.status,200);assert.equal(build.data.version,require('../shared/buildVersion.json').version);assert.match(build.cache,/no-store/);
 const verified=await promisify(execFile)(process.execPath,[path.join(__dirname,'../scripts/verify-corex-build.mjs'),base],{windowsHide:true});assert.equal(JSON.parse(verified.stdout).passed,true);
 assert.doesNotMatch(bodies,/http-private-|appSecret|access_token|refresh_token|session_token|token_ciphertext/);assert.doesNotMatch(logs,/http-private-/);
 const check=new DatabaseSync(dbPath);try{assert.deepEqual(check.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(legacy.id),legacyBefore);}finally{check.close();}
});
