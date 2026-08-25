import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./SecurityAccess.jsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
test("Admin Tools renders the dedicated Security & Access interface", () => { assert.match(app, /visibleTopPage === "TOOLS"[\s\S]*session\.role === "admin"[\s\S]*<SecurityAccess/); assert.match(source, /Security &amp; Access/); assert.match(source, /Child Access/); });
test("Security UI contains truthful empty and failure states without fake accounts", () => { assert.match(source, /No additional access profiles yet/); assert.match(source, /role="alert"/); assert.doesNotMatch(source, /Child Access [1-9]|fake account/i); });
test("Child configuration is centralized and separate from Additional Access", () => { assert.match(source, /CHILD_PERMISSIONS/); assert.match(source, /\/api\/security\/child-access/); assert.match(source, /Add Additional Access/); assert.doesNotMatch(source, /Owner access is required\./); });
test("security controls use server sessions and never persist plaintext browser credentials", () => { assert.match(source, /credentials: "include"/); assert.match(source, /type="password"/); assert.doesNotMatch(source, /localStorage|sessionStorage/); assert.match(source, /Session Management/); });
test("Owner, Child, and Additional Access forms require validated email fields", () => { assert.match(source, /Owner \/ Admin email/); assert.match(source, /Child email/); assert.match(source, /Email address/); assert.match(source, /type="email"/); assert.match(source, /Email required/); });
test("Additional Access keeps update and enable controls and confirms permanent removal", () => { assert.match(source, /Update Email/); assert.match(source, /profile\.enabled \? "Disable"/); assert.match(source, />Remove</); assert.match(source, /Remove this access profile permanently\?/); assert.match(source, /method: "DELETE"/); assert.match(source, /setRemoveProfile\(null\)/); assert.match(source, /Add Access Profile/); });
test("Additional Access exposes the exact storage capabilities used by Drive routes", () => { assert.match(source, /\["storage", "View storage"\]/); assert.match(source, /\["storage_modify", "Modify storage"\]/); });
