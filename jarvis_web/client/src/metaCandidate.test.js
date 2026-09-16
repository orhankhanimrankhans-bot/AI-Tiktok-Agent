import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { metaSetupView, saveMetaAppSetup } from './metaAppSetup.js';
const read=f=>fs.readFileSync(new URL(f,import.meta.url),'utf8');

test('workspace changes remount credential state and Meta setup never persists App Secrets',()=>{
 const main=read('./main.jsx'),setup=read('./MetaAppSettings.jsx');
 assert.match(main,/<App key=\{session\?\.workspaceId/);
 assert.match(setup,/ref=\{secretInput\}/);assert.match(setup,/type="password"/);
 assert.doesNotMatch(setup,/localStorage|sessionStorage|useState\([^)]*appSecret/);
 assert.ok(setup.indexOf('secretInput.current.value = ""')<setup.indexOf('await saveMetaAppSetup'));
 assert.match(setup,/Existing authorization is retained/);assert.doesNotMatch(setup,/Reconnect required\./);
});
test('unconfigured workspaces see setup; legacy tokens do not produce automatic OAuth calls',()=>{
 assert.deepEqual(metaSetupView({configured:false}),{state:'required',showForm:true,showConnect:false});
 const setup=read('./MetaAppSettings.jsx'),effect=setup.slice(setup.indexOf('useEffect(() =>'),setup.indexOf('  const save ='));
 assert.doesNotMatch(effect,/onStartOAuth|window\.open|method: "PUT"/);
});
test('save response strips any unexpected credential or token fields',async()=>{
 const payload={appId:'123456',appSecret:'private-form-secret',graphVersion:'v26.0',redirectUri:'https://corex.example/api/facebook/auth/callback'};
 const result=await saveMetaAppSetup(async()=>({ok:true,json:async()=>({configured:true,...payload,access_token:'private-token',tokens:{refresh_token:'private-refresh'}})}),'https://corex.example',payload);
 assert.doesNotMatch(JSON.stringify(result),/private-|appSecret|access_token|refresh_token/);
});
