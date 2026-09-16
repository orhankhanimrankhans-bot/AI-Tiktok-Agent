"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),baseline=require('../candidate-review/baseline-files.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('Prepare Content, Gemini, workflow, scheduling, storage, Google and publisher modules are byte-identical to production-equivalent source',()=>{
 const files=['server/openaiPrepareContent.js','server/geminiVideoAnalysis.js','server/executionServices.js','server/workflowExecutor.js','server/workflowScheduler.js','server/workflowStore.js','server/workflowRoutes.js','server/driveFiles.js','server/driveSearch.js','server/credentialStore.js','server/credentialOwnership.js','server/executionStore.js','server/facebookReels.js','server/facebookPublicationStore.js','server/facebookPublicScanScheduler.js','server/facebookControlStore.js','client/src/prepareContentConfig.js','client/src/workflowStorage.js','client/src/workflowEditorBinding.js','client/src/facebookReelConfig.js','client/src/facebookConfig.js','package.json','package-lock.json','server/package.json','client/package.json'];
 for(const file of files)assert.equal(hash(fs.readFileSync(path.join(root,file))),baseline[file].sha256,file);
 for(const absent of ['server/videoValidation.js','server/prepareContentExecutor.js','server/binaryOwnershipStore.js','server/facebookPublishLedger.js','shared/prepareContentNode.json'])assert.equal(fs.existsSync(path.join(root,absent)),false,absent);
});
test('selected shared-file regions preserve Google UI, Prepare Content and production execution wiring',()=>{
 for(const region of require('../candidate-review/preserved-regions.json')) {
  const source=fs.readFileSync(path.join(root,region.file),'utf8').replaceAll('\r\n','\n'),start=source.indexOf(region.start),end=source.indexOf(region.candidateEnd,start);
  assert.ok(start>=0&&end>start,region.start);assert.equal(hash(source.slice(start,end)),region.sha256,region.file+': '+region.start);
 }
});
test('active Meta integration has no global App or token fallback and no token-read migration',()=>{
 const index=fs.readFileSync(path.join(__dirname,'index.js'),'utf8'),store=fs.readFileSync(path.join(__dirname,'facebookCredentialStore.js'),'utf8');
 assert.doesNotMatch(index,/process\.env\.(?:META_APP_ID|META_APP_SECRET|META_ACCESS_TOKEN|FACEBOOK_ACCESS_TOKEN)/);
 assert.doesNotMatch(index,/GEMINI_VERTEX|GEMINI_PROVIDER|validateProvider/);
 const get=store.slice(store.indexOf('  get(id,'),store.indexOf('  findByAccountId('));assert.doesNotMatch(get,/UPDATE|INSERT|DELETE|encryptTokens\(/);
 const meta=fs.readFileSync(path.join(__dirname,'metaAppConfigStore.js'),'utf8');assert.doesNotMatch(meta,/CREATE TRIGGER|ALTER TABLE|DROP TABLE/);
});

test('current production Gemini summarization script remains byte-identical to 3baaa4fc',()=>{
 const baseline=require('../candidate-review/production-baseline.json');
 assert.equal(baseline.commit,'3baaa4fc313356c500e5d189cce5bbe84aa0fd2e');
 assert.equal(hash(fs.readFileSync(path.join(root,'..','summarize_video.py'))),baseline.summarizeVideoSha256);
});
