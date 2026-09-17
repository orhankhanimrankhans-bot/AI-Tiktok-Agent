const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {FacebookCredentialStore}=require('./facebookCredentialStore');
const {MetaAppConfigStore}=require('./metaAppConfigStore');
const {FacebookGraphService,FacebookGraphError}=require('./facebookGraph');
const {createFacebookPageCredentials,registerFacebookPageCredentialRoutes}=require('./facebookPageCredentials');
const {createFacebookExecutionContext}=require('./facebookExecutionContext');
const A={ownerType:'additional',ownerId:'a'},B={ownerType:'additional',ownerId:'b'};
function setup(t) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const meta=new MetaAppConfigStore({db,encryptionSecret:'test-private-secret'});meta.open();
 for(const w of [A,B])meta.save({appId:'111111',appSecret:'private-app-secret-long',graphVersion:'v26.0',redirectUri:'https://example.test/api/facebook/auth/callback'},w);
 const store=new FacebookCredentialStore({db,encryptionSecret:'test-private-secret'});store.open();
 const source=store.save({id:FacebookCredentialStore.generateId(),accountId:'123456',appId:'111111',pageId:'100001',pageName:'Page A',tokens:{userAccessToken:'private-user-token',pageAccessTokens:{100001:'private-page-A'}}},A);
 const available={pages:[{id:'100001',name:'Page A'},{id:'100002',name:'Page B'}],pageTokens:{100001:'private-page-A',100002:'private-page-B'}};
 const options={credentialStore:store,metaConfigStore:meta,graphServiceFactory:()=>({pages:async()=>available})};
 return {db,meta,store,source,available,options,service:createFacebookPageCredentials(options)};
}
test('multiple Pages: independent encrypted credentials, duplicate suppression and unchanged Page A',async t=>{
 const f=setup(t),before=f.db.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(f.source.id);
 const list=await f.service.list(f.source.id,A);assert.deepEqual(list.pages.map(p=>p.connected),[true,false]);
 const b=await f.service.add(f.source.id,'100002',A);assert.equal(b.created,true);assert.notEqual(b.credential.id,f.source.id);
 assert.match(b.credential.name,/Facebook - Page B - OAuth - /);
 assert.equal((await f.service.add(f.source.id,'100001',A)).created,false);
 const repeated=await Promise.all([f.service.add(f.source.id,'100002',A),f.service.add(f.source.id,'100002',A)]);
 assert.ok(repeated.every(r=>!r.created));assert.equal(f.store.list(A).length,2);
 assert.deepEqual(f.db.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(f.source.id),before);
 assert.deepEqual(f.store.get(b.credential.id,{owner:A,includeTokens:true}).tokens.pageAccessTokens,{'100002':'private-page-B'});
 assert.doesNotMatch(JSON.stringify([list,b,f.store.list(A),f.db.prepare('SELECT * FROM facebook_credentials').all()]),/private-user-token|private-page-[AB]/);
});
test('workspace + Page duplicate blocked even through another account',async t=>{
 const f=setup(t);const other=f.store.save({id:FacebookCredentialStore.generateId(),accountId:'222222',appId:'111111',pageId:'100002',tokens:{userAccessToken:'other'}},A);
 const result=await f.service.add(f.source.id,'100002',A);assert.equal(result.created,false);assert.equal(result.credential.id,other.id);
});
test('cross-workspace discovery, adding and execution rejected; forged Page rejected',async t=>{
 const f=setup(t);
 await assert.rejects(f.service.list(f.source.id,B),{code:'credential_not_found'});
 await assert.rejects(f.service.add(f.source.id,'100002',B),{code:'credential_not_found'});
 await assert.rejects(f.service.add(f.source.id,'999999',A),{code:'facebook_page_unavailable'});
 const ctx=createFacebookExecutionContext({credentialStore:f.store,graphServiceFactory:()=>({}),publishPageReel:()=>assert.fail('must not publish'),binaryDirectory:'test'});
 await assert.rejects(ctx.publishReel({credentialId:f.source.id,binary:{referenceId:'bin_test'}},B),{code:'credential_disconnected'});
});
test('workflow Page selections resolve separate credentials and preserve handoff metadata',async t=>{
 const f=setup(t),b=(await f.service.add(f.source.id,'100002',A)).credential,calls=[];
 const ctx=createFacebookExecutionContext({credentialStore:f.store,graphServiceFactory:()=>({}),binaryDirectory:'test',publishPageReel:async ({credential,request})=>{calls.push({page:credential.pageId,request});return {success:true};}});
 const workflows=[{credentialId:f.source.id},{credentialId:b.id}];
 for(const w of workflows)await ctx.publishReel({...w,binary:{referenceId:'bin_test'},title:'Title',caption:'Caption #tag'},A);
 assert.deepEqual(calls.map(c=>c.page),['100001','100002']);assert.ok(calls.every(c=>c.request.title==='Title'&&c.request.caption==='Caption #tag'&&c.request.binary.referenceId==='bin_test'));
 workflows[1].credentialId=f.source.id;assert.equal(workflows[0].credentialId,f.source.id);
});
test('refresh discovers new Pages without updating any saved credential',async t=>{
 const f=setup(t),before=f.store.list(A);await f.service.list(f.source.id,A);
 f.available.pages.push({id:'100003',name:'Page C'});f.available.pageTokens['100003']='private-page-C';
 assert.equal((await f.service.list(f.source.id,A)).pages.length,3);assert.deepEqual(f.store.list(A),before);
});
test('authorization rotation, removal and session change during discovery reject writes',async t=>{
 for(const change of ['remove','rotate','session']) {
  const f=setup(t);f.options.graphServiceFactory=()=>({pages:async()=>{if(change==='remove')f.store.delete(f.source.id,A);if(change==='rotate')f.meta.save({appId:'111111',appSecret:'rotated-private-secret',graphVersion:'v26.0',redirectUri:'https://example.test/api/facebook/auth/callback'},A);return f.available;}});
  const s=createFacebookPageCredentials(f.options);
  await assert.rejects(s.add(f.source.id,'100002',A,()=>{if(change==='session')throw new FacebookGraphError(401,'workspace_changed','Sign in again');}));
  assert.equal(f.store.list(A).some(c=>c.pageId==='100002'),false);
 }
});
test('provider errors are sanitized and expired authorization requests reconnect',async t=>{
 const f=setup(t);f.options.graphServiceFactory=()=>({pages:async()=>{throw new FacebookGraphError(401,'expired','private-user-token');}});
 await assert.rejects(createFacebookPageCredentials(f.options).list(f.source.id,A),e=>e.code==='facebook_reconnect_required'&&!e.message.includes('private-user-token'));
});
test('paginated Page discovery uses fixed Graph endpoint and separates tokens',async()=>{
 const service=new FacebookGraphService({version:'v26.0'}),calls=[];
 service.request=async(path,token,query)=>{calls.push({path,query});return calls.length===1?{data:[{id:'100001',name:'A',access_token:'private-A'}],paging:{next:'https://untrusted.test',cursors:{after:'cursor'}}}:{data:[{id:'100002',name:'B',access_token:'private-B'}]};};
 const result=await service.pages('private-user');
 assert.equal(result.pages.length,2);assert.equal(calls[1].path,'me/accounts');assert.equal(calls[1].query.after,'cursor');assert.doesNotMatch(JSON.stringify(result.pages),/private-/);
 service.request=async()=>({data:[],paging:{next:'x',cursors:{after:'same'}}});await assert.rejects(service.pages('x'),{code:'facebook_pages_incomplete'});
});
test('routes whitelist body/query and return only public Page credentials',async t=>{
 const f=setup(t),handlers={};registerFacebookPageCredentialRoutes({get:(p,h)=>handlers.get=h,post:(p,h)=>handlers.post=h},{getStore:()=>f.store,getMetaConfigStore:()=>f.meta,graphServiceFactory:f.options.graphServiceFactory,workspaceForRequest:()=>A});
 async function run(body,query={}){const res={set(){return this},status(n){this.code=n;return this},json(v){this.body=v;return this}};await handlers.post({params:{credentialId:f.source.id},body,query},res);return res;}
 assert.equal((await run({pageId:'100002',accessToken:'forged'})).code,400);
 assert.equal((await run({pageId:'100002'},{ownerId:'b'})).code,400);
 const result=await run({pageId:'100002'});assert.equal(result.code,201);assert.doesNotMatch(JSON.stringify(result.body),/private-|tokens|ciphertext/);
});
test('account-only OAuth connection adds both Page A and Page B without rewriting source',async t=>{
 const f=setup(t);f.store.delete(f.source.id,A);
 const source=f.store.save({id:FacebookCredentialStore.generateId(),accountId:'123456',appId:'111111',tokens:{userAccessToken:'private-user-token'}},A);
 const before=f.db.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(source.id);
 const a=await f.service.add(source.id,'100001',A),b=await f.service.add(source.id,'100002',A);
 assert.ok(a.created&&b.created);assert.notEqual(a.credential.id,b.credential.id);
 assert.deepEqual(f.db.prepare('SELECT * FROM facebook_credentials WHERE id=?').get(source.id),before);
});
test('provider metadata cannot reflect known Page tokens to the browser',async t=>{
 const f=setup(t);f.available.pages[1].name='Page private-page-B';
 const list=await f.service.list(f.source.id,A),added=await f.service.add(f.source.id,'100002',A);
 assert.doesNotMatch(JSON.stringify([list,added]),/private-page-B/);
});
