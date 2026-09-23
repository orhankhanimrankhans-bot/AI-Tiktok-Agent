import test from 'node:test';
import assert from 'node:assert/strict';
import {isTikTokOAuthMessage,returnTikTokPopup} from './tiktokOAuth.js';
test('OAuth completion accepts only the opened window and exact Corex origin',()=>{
 const popup={},origin='https://corex.test',event={source:popup,origin,data:{type:'corex-tiktok-oauth',status:'connected'}};
 assert.equal(isTikTokOAuthMessage(event,popup,origin),true);
 for(const patch of [{source:{}},{origin:'https://evil.test'},{data:{type:'other',status:'connected'}},{data:{type:'corex-tiktok-oauth',status:'unknown'}}]) assert.equal(isTikTokOAuthMessage({...event,...patch},popup,origin),false);
 assert.equal(isTikTokOAuthMessage(event,null,origin),false);
});
test('popup returns only a status to its same-origin opener, standalone flow stays open',()=>{
 const messages=[];let closed=false;
 const win={opener:{postMessage:(...args)=>messages.push(args)},location:{origin:'https://corex.test'},setTimeout:fn=>fn(),close:()=>{closed=true;}};
 assert.equal(returnTikTokPopup(win,'connected'),true);assert.equal(closed,true);
 assert.deepEqual(messages,[[{type:'corex-tiktok-oauth',status:'connected'},'https://corex.test']]);
 assert.equal(returnTikTokPopup({...win,opener:null},'connected'),false);
 assert.equal(returnTikTokPopup(win,'forged'),false);
 assert.equal(returnTikTokPopup({...win,opener:{closed:true}},'failed'),false);
});
