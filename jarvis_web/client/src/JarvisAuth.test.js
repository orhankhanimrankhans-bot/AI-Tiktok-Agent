import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./JarvisAuth.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
test("Jarvis is gated by server session restore before the private application renders", () => { assert.match(main, /<JarvisAuthGate><App \/><\/JarvisAuthGate>/); assert.match(source, /\/api\/security\/status/); assert.match(source, /credentials: "include"/); });
test("login offers Admin and Child without browser-stored authentication secrets", () => { assert.match(source, />ADMIN</); assert.match(source, />CHILD</); assert.match(source, /role, profileId/); assert.doesNotMatch(source, /localStorage|sessionStorage/); });
test("lock and logout invalidate server sessions", () => { assert.match(source, /endSession\("lock"\)/); assert.match(source, /endSession\("logout"\)/); assert.match(source, /\/api\/security\/\$\{action\}/); });
test("Admin recovery collects email and submits one-time reset links without browser storage", () => { assert.match(source, /Forgot password\?/); assert.match(source, /\/api\/security\/password-reset\/request/); assert.match(source, /\/api\/security\/password-reset\/complete/); assert.match(source, /reset_token/); assert.doesNotMatch(source, /localStorage|sessionStorage/); });
