const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { registerDriveVideoStockRoutes } = require("./driveVideoStockRoutes");
const { requiredPermissions } = require("./securityAccess");
test("stock endpoints require read storage and workflow access, including refresh", () => {
  for (const method of ["GET","POST"]) assert.deepEqual(requiredPermissions({path:"/api/drive/video-stock/refresh",method}),["storage","view_workflow"]);
});
test("HTTP API derives workspace server-side, rejects unauthenticated and denied users", async t => {
  const app=express();let scanned;
  registerDriveVideoStockRoutes(app,{workspaceForRequest:req=>req.headers["x-test-session"]?{ownerType:"additional",ownerId:req.headers["x-test-session"]}:null,service:{snapshot(owner){if(owner.ownerId==="denied")throw Error("denied");return {folders:[{name:owner.ownerId}],scanning:false};},async scan(owner){scanned=owner;}}});
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/drive/video-stock`)).status,401);
  assert.equal((await fetch(`${base}/api/drive/video-stock`,{headers:{"x-test-session":"denied"}})).status,403);
  const response=await fetch(`${base}/api/drive/video-stock?ownerId=foreign`,{headers:{"x-test-session":"own"}});
  assert.deepEqual((await response.json()).folders,[{name:"own"}]);assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal((await fetch(`${base}/api/drive/video-stock/refresh`,{method:"POST",headers:{"x-test-session":"own"}})).status,202);assert.equal(scanned.ownerId,"own");
});
