import test from "node:test";
import assert from "node:assert/strict";
import {buildTikTokUploadRequest,tiktokNodeDefaults} from "./tiktokConfig.js";
import {buildArchiveMoveRequest} from "./postPublishArchive.js";
import {validateConnectionCandidate,nodeConnectionHealth} from "./workflowCanvas.js";
test("Direct Post preserves operation and archives only a completed publication",()=>{
 const config={...tiktokNodeDefaults(),operation:"Direct Post",credentialId:"a".repeat(64)};
 const request=buildTikTokUploadRequest(config,{fileId:"drive",binary:{property:"data",referenceId:"bin_abcdefghijklmnopqrstuv"}});
 assert.equal(request.operation,"Direct Post");assert.equal(request.uploadConsent,false);
 const move={credentialId:"g",fileId:"{{ $json.sourceFileId }}",destinationFolderId:"done"};
 const result={success:true,provider:"tiktok",status:"direct_published",published:true,postStatus:"PUBLISH_COMPLETE",uploadId:"id",sourceFileId:"drive"};
 assert.equal(buildArchiveMoveRequest(move,result).fileId,"drive");
 for(const patch of [{published:false},{postStatus:"PROCESSING_DOWNLOAD"},{postStatus:"SEND_TO_USER_INBOX"},{uploadId:""}])assert.throws(()=>buildArchiveMoveRequest(move,{...result,...patch}));
});
test("TikTok config requires explicit consent, account and downloaded media",()=>{
 const config={...tiktokNodeDefaults(),credentialId:"a".repeat(64),uploadConsent:true};
 const item={fileId:"drive",binary:{property:"data",referenceId:"bin_abcdefghijklmnopqrstuv"}};
 assert.equal(buildTikTokUploadRequest(config,item).sourceFileId,"drive");
 for(const patch of [{uploadConsent:false},{credentialId:""},{binaryProperty:"wrong"}])assert.throws(()=>buildTikTokUploadRequest({...config,...patch},item));
});
test("TikTok archive requires confirmed inbox delivery",()=>{
 const config={credentialId:"g",fileId:"{{ $json.sourceFileId }}",destinationFolderId:"done"};
 const item={success:true,provider:"tiktok",status:"inbox_uploaded",uploadId:"id",inboxStatus:"SEND_TO_USER_INBOX",sourceFileId:"drive"};
 assert.equal(buildArchiveMoveRequest(config,item).fileId,"drive");
 for(const patch of [{success:false},{uploadId:""},{inboxStatus:"PROCESSING_UPLOAD"},{provider:"other"}])assert.throws(()=>buildArchiveMoveRequest(config,{...item,...patch}));
});
test("canvas accepts TikTok as third publisher and distinguishes account connection",()=>{
 const nodes=[{id:"p",name:"Prepare Content"},{id:"f",name:"Facebook Graph API"},{id:"y",name:"YouTube"},{id:"t",name:"TikTok"},{id:"m",name:"Move File"}];
 const links=[{source:"p",target:"f"},{source:"p",target:"y"},{source:"f",target:"m"},{source:"y",target:"m"}];
 assert.equal(validateConnectionCandidate(nodes,links,"p","t").ok,true);
 assert.equal(validateConnectionCandidate(nodes,[...links,{source:"p",target:"t"}],"t","m").ok,true);
 assert.equal(nodeConnectionHealth({name:"TikTok",config:{credentialId:"ready"}},{tiktokCredentials:[{id:"ready",connected:true}]}),"connected");
 assert.notEqual(nodeConnectionHealth({name:"TikTok",config:{credentialId:"stale"}},{tiktokCredentials:[{id:"ready",connected:true}]}),"connected");
});
