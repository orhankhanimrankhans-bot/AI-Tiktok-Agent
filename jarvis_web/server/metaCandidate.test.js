"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {MetaAppConfigStore}=require('./metaAppConfigStore');
const {FacebookCredentialStore}=require('./facebookCredentialStore');
const {FacebookCredentialStore:ProductionStore}=require('../candidate-review/baseline-store/facebookCredentialStore');
const {createFacebookExecutionContext}=require('./facebookExecutionContext');
const {FacebookGraphService}=require('./facebookGraph');
const {publicMetaData,secretValues}=require('./metaPublicData');
const {validateMetaTokenApp,exchangeMetaCode}=require('./metaTokenValidation');
const A={ownerType:'additional',ownerId:'a'},B={ownerType:'additional',ownerId:'b'},ADMIN={ownerType:'admin',ownerId:'primary'};
const secret='candidate-test-encryption-key';
const config=(id)=>({appId:id,appSecret:'private-app-secret-'+id,graphVersion:'v26.0',redirectUri:'https://corex.example/api/facebook/auth/callback'});
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const meta=new MetaAppConfigStore({db,encryptionSecret:secret});meta.open();const store=new FacebookCredentialStore({db,encryptionSecret:secret});store.open();return {db,meta,store};}
function credential(store,owner=A){return store.save({id:FacebookCredentialStore.generateId(),accountId:'100001',pageId:'200001',pageName:'Private Page',tokens:{userAccessToken:'private-user-token',pageAccessTokens:{200001:'private-page-token'}}},owner);}

test('workspace Meta configuration is encrypted, owner-only, and rejects body ownership overrides',t=>{
 const {db,meta}=fixture(t);meta.save(config('111111'),A);meta.save(config('222222'),B);
 assert.equal(meta.public(A).appId,'111111');assert.equal(meta.public(B).appId,'222222');
 assert.equal(meta.public(ADMIN).configured,false);assert.throws(()=>meta.public());
 for(const override of [{ownerId:'b'},{ownerType:'admin'},{workspaceId:'additional:b'}])assert.throws(()=>meta.save({...config('333333'),...override},A),e=>e.code==='invalid_meta_config');
 const before=meta.public(B);meta.save(config('444444'),A);meta.remove(A);assert.deepEqual(meta.public(B),before);
 const row=db.prepare('SELECT * FROM meta_app_configs').get();assert.doesNotMatch(JSON.stringify(row),/private-app-secret/);assert.doesNotMatch(JSON.stringify(meta.public(B)),/appSecret|private-app-secret/);
});

test('OAuth state is opaque, workspace/session-bound, one-use and invalidated by configuration changes',t=>{
 const {meta}=fixture(t);meta.save(config('111111'),A);meta.save(config('222222'),B);
 const {state}=meta.begin(A,'session-a');assert.match(state,/^[\w-]{43}$/);assert.equal(meta.consume(state,B,'session-b'),null);assert.equal(meta.consume(state,A,'other-session'),null);
 const consumed=meta.consume(state,A,'session-a');assert.equal(consumed.ownerId,'a');assert.equal(consumed.config.appId,'111111');assert.equal(meta.consume(state,A,'session-a'),null);
 const next=meta.begin(A,'session-a').state;meta.save(config('111111'),A);assert.equal(meta.consume(next,A,'session-a'),null);
 const expiring=meta.begin(A,'session-a').state;meta.db.prepare('UPDATE meta_oauth_flows SET expires_at=0').run();assert.equal(meta.consume(expiring,A,'session-a'),null);
});

test('missing Meta configuration never falls back to admin or process-wide credentials',t=>{
 const {meta}=fixture(t);meta.save(config('111111'),ADMIN);
 assert.throws(()=>meta.require(A),e=>e.code==='META_APP_NOT_CONFIGURED');assert.throws(()=>meta.begin(A,'session-a'),e=>e.code==='META_APP_NOT_CONFIGURED');
 assert.throws(()=>meta.require(),e=>e.code==='workspace_required');
});

test('foreign credential IDs cannot be read, deleted, updated, overwritten or refreshed',t=>{
 const {store,db}=fixture(t);const c=credential(store);const before=db.prepare('SELECT * FROM facebook_credentials').get();
 assert.equal(store.get(c.id,{owner:B,includeTokens:true}),null);assert.equal(store.delete(c.id,B),false);assert.deepEqual(store.list(B),[]);
 assert.equal(store.updateManual({id:c.id,name:'stolen'},B),null);
 assert.throws(()=>store.save({...c,tokens:{userAccessToken:'replacement'}},B),/another workspace/);
 assert.throws(()=>store.saveManual({id:c.id,name:'stolen',pageId:'300001',accessToken:'replacement'},B),/another workspace/);
 assert.throws(()=>store.refreshPageTokens(store.get(c.id,{owner:A,includeTokens:true}),{200001:'replacement'},B));
 assert.deepEqual(db.prepare('SELECT * FROM facebook_credentials').get(),before);
 assert.throws(()=>store.get(c.id),e=>e.code==='workspace_required');assert.throws(()=>store.list(),e=>e.code==='workspace_required');
});

test('foreign Graph, Page refresh and publishing attempts never reach a provider',async t=>{
 const {store}=fixture(t),c=credential(store);let calls=0;
 const ctx=createFacebookExecutionContext({credentialStore:store,graphServiceFactory(){calls++;throw Error('provider must not run')},publishPageReel(){calls++;},binaryDirectory:'fixture',validateCredentialId:FacebookCredentialStore.isValidId});
 for(const endpoint of ['me','pages','page'])await assert.rejects(ctx.graphRequest({credentialId:c.id,method:'POST',endpoint,body:{pageId:'200001'}},B),e=>e.statusCode===404);
 await assert.rejects(ctx.publishReel({credentialId:c.id,binary:{referenceId:'fixture'}},B),e=>e.statusCode===404);
 assert.equal(calls,0);assert.throws(()=>ctx.resolveCredential(c.id),e=>e.code==='workspace_required');
});

test('legacy owned credentials publish and refresh without a Meta configuration or forced migration',async t=>{
 const {store,db,meta}=fixture(t),c=credential(store);assert.equal(meta.public(A).configured,false);
 const before=db.prepare('SELECT token_ciphertext,token_iv,token_tag FROM facebook_credentials').get();
 let published=false;
 const ctx=createFacebookExecutionContext({credentialStore:store,graphServiceFactory:(owner,record)=>{assert.deepEqual(owner,A);assert.equal(record.id,c.id);return {pages:async()=>({pages:[{id:'200001',name:'Private Page'}],pageTokens:{200001:'refreshed-page-token'}})}},publishPageReel:async({credential})=>{assert.equal(credential.tokens.pageAccessTokens['200001'],'private-page-token');published=true;return {success:true,videoId:'300001'}},binaryDirectory:'fixture',validateCredentialId:FacebookCredentialStore.isValidId});
 const result=await ctx.publishReel({credentialId:c.id,binary:{referenceId:'fixture'}},A);assert.equal(result.success,true);assert.ok(published);
 assert.deepEqual(db.prepare('SELECT token_ciphertext,token_iv,token_tag FROM facebook_credentials').get(),before);
 await ctx.graphRequest({credentialId:c.id,method:'POST',endpoint:'pages',body:{}},A);
 const refreshed=store.get(c.id,{owner:A,includeTokens:true});assert.equal(refreshed.tokens.pageAccessTokens['200001'],'refreshed-page-token');assert.equal(refreshed.pageId,'200001');
});

test('stale refresh cannot resurrect a deleted credential or overwrite a reconnected token',t=>{
 const {store}=fixture(t),c=credential(store),snapshot=store.get(c.id,{owner:A,includeTokens:true});
 store.save({...c,tokens:{userAccessToken:'new-login',pageAccessTokens:{200001:'new-page'}}},A);
 assert.throws(()=>store.refreshPageTokens(snapshot,{200001:'stale-page'},A),/changed/);assert.equal(store.get(c.id,{owner:A,includeTokens:true}).tokens.userAccessToken,'new-login');
 store.delete(c.id,A);assert.throws(()=>store.refreshPageTokens(snapshot,{},A));assert.equal(store.get(c.id,{owner:A}),null);
});

test('Page-selection state is session-bound, encrypted, single-use and cannot reconnect a foreign ID',t=>{
 const {store,db}=fixture(t);const c=credential(store);const input={accountId:'100001',pages:[{id:'200001',name:'Page'}],tokens:{userAccessToken:'selection-private-token',pageAccessTokens:{200001:'selection-private-page'}},credentialId:c.id,sessionId:'session-a'};
 assert.throws(()=>store.createPageSelection(input,B),/not found/);const selection=store.createPageSelection(input,A);
 assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM facebook_oauth_page_selections').get()),/selection-private|session-a/);
 assert.equal(store.consumePageSelection({selectionId:selection.id,pageId:'200001',sessionId:'session-b'},B),null);
 assert.equal(store.consumePageSelection({selectionId:selection.id,pageId:'200001',sessionId:'other-session'},A),null);
 assert.ok(store.consumePageSelection({selectionId:selection.id,pageId:'200001',sessionId:'session-a'},A));assert.equal(store.consumePageSelection({selectionId:selection.id,pageId:'200001',sessionId:'session-a'},A),null);
});

test('production store can read and update candidate credentials after rollback; existing rows and schema remain intact',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const old=new ProductionStore({db,encryptionSecret:secret});old.open();
 const legacy=credential(old),before=db.prepare('SELECT * FROM facebook_credentials').get();const columns=db.prepare('PRAGMA table_info(facebook_credentials)').all();
 const meta=new MetaAppConfigStore({db,encryptionSecret:secret});meta.open();meta.save(config('111111'),A);
 const next=new FacebookCredentialStore({db,encryptionSecret:secret});next.open();assert.deepEqual(db.prepare('PRAGMA table_info(facebook_credentials)').all(),columns);
 assert.deepEqual(db.prepare('SELECT * FROM facebook_credentials').get(),before);
 for(let i=0;i<3;i++){next.get(legacy.id,{owner:A});next.get(legacy.id,{owner:A,includeTokens:true});next.list(A);}
 assert.deepEqual(db.prepare('SELECT * FROM facebook_credentials').get(),before);
 const fresh=next.save({id:FacebookCredentialStore.generateId(),accountId:'100002',pageId:'200002',appId:'111111',tokens:{userAccessToken:'new-private-token',pageAccessTokens:{200002:'new-private-page'}}},A);
 old.open();assert.equal(old.get(legacy.id,{owner:A,includeTokens:true}).tokens.userAccessToken,'private-user-token');assert.equal(old.get(fresh.id,{owner:A,includeTokens:true}).tokens.userAccessToken,'new-private-token');
 old.save({...fresh,tokens:{userAccessToken:'rollback-updated-token'}},A);assert.equal(next.get(fresh.id,{owner:A,includeTokens:true}).tokens.userAccessToken,'rollback-updated-token');
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,0);
});

test('API sanitization removes nested token fields and echoed values; token validation errors are generic',async()=>{
 const tokens={userAccessToken:'private-user-123',pageAccessTokens:{200001:'private-page-123'}};
 const output=publicMetaData({name:'private-user-123',nested:{refresh_token:'private-refresh',sessionToken:'session-value',appSecret:'app-value',pageAccessToken:'private-page-123'},message:'Bearer private-page-123'},secretValues(tokens));
 assert.doesNotMatch(JSON.stringify(output),/private-|session-value|app-value/);
 await assert.rejects(validateMetaTokenApp('input-secret',config('111111'),async()=>{throw Error('input-secret private-app-secret-111111')}),e=>!e.message.includes('secret'));
 await assert.rejects(exchangeMetaCode('code-secret',config('111111'),async()=>({ok:false,json:async()=>({error:{message:'private-app-secret-111111 code-secret'}})})),e=>!e.message.includes('secret'));
});

test('Meta provider success and errors do not expose returned or echoed token material',async()=>{
 const service=new FacebookGraphService({version:'v26.0',fetchImpl:async()=>({ok:true,json:async()=>({id:'200001',name:'echo private-user-token',access_token:'unexpected-token',nested:{refresh_token:'private-refresh'}})})});
 assert.doesNotMatch(JSON.stringify(await service.me('private-user-token')),/private-|unexpected-token|access_token|refresh_token/);
 const failure=new FacebookGraphService({version:'v26.0',fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{code:200,message:'denied private-user-token',error_user_msg:'Bearer private-user-token'}})})});
 await assert.rejects(failure.me('private-user-token'),e=>!JSON.stringify(e).includes('private-user-token')&&!e.message.includes('private-user-token'));
});

test("provider diagnostic codes cannot echo a credential token into logs",async()=>{
  const service=new FacebookGraphService({version:"v26.0",fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{code:"private-diagnostic-token",error_subcode:"private-diagnostic-token",message:"private-diagnostic-token",fbtrace_id:"private-diagnostic-token"}})})});
  await assert.rejects(service.me("private-diagnostic-token"),error=>!JSON.stringify(error).includes("private-diagnostic-token")&&!error.message.includes("private-diagnostic-token"));
});
