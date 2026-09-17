import test from 'node:test';import assert from 'node:assert/strict';
import {loadFacebookPages,addFacebookPage} from './facebookPagesApi.js';
import {sanitizeFacebookConfig} from './facebookConfig.js';
test('Page list strips unexpected secret fields and refresh calls backend each time',async()=>{
 let count=0;const fetcher=async(url,options)=>{count++;assert.equal(options.credentials,'include');return {ok:true,json:async()=>({pages:[{id:'100001',name:'A',connected:true,access_token:'private-secret'},{id:'100002',name:'B',canAdd:true}]})};};
 const pages=await loadFacebookPages(fetcher,'','cred');await loadFacebookPages(fetcher,'','cred');
 assert.equal(count,2);assert.equal(pages.length,2);assert.doesNotMatch(JSON.stringify(pages),/private-secret|access_token/);
});
test('adding a Page submits only Page ID and existing opaque source credential',async()=>{
 await addFacebookPage(async(url,options)=>{assert.match(url,/credentials\/source\/pages$/);assert.equal(options.body,JSON.stringify({pageId:'100002'}));assert.equal(options.method,'POST');return {ok:true,json:async()=>({credential:{id:'new'}})};},'','source','100002');
});
test('reconnect errors are safe and use existing reconnect flow',async()=>{
 await assert.rejects(loadFacebookPages(async()=>({ok:false,status:409,json:async()=>({code:'facebook_reconnect_required',error:'private-token'})}),'','source'),e=>e.reconnect&&!e.message.includes('private-token'));
});
test('workflow credential selections stay independent through config serialization',()=>{
 const a=sanitizeFacebookConfig({credentialId:'page-A'}),b=sanitizeFacebookConfig({credentialId:'page-B'});
 b.credentialId='page-C';assert.equal(a.credentialId,'page-A');assert.equal(JSON.parse(JSON.stringify(b)).credentialId,'page-C');
});
