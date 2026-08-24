import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./SecurityAccess.jsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
test("Tools renders the dedicated Security & Access interface", () => { assert.match(app, /topPage === "TOOLS"[\s\S]*<SecurityAccess/); assert.match(source, /Security &amp; Access/); assert.match(source, /Main Access/); });
test("Security UI contains truthful empty and failure states without fake accounts", () => { assert.match(source, /No additional access profiles yet/); assert.match(source, /role="alert"/); assert.doesNotMatch(source, /Child Access [1-9]|fake account/i); });
test("unconfigured Security uses a neutral informational message instead of an owner error", () => { assert.match(source, /Security is not configured yet\./); assert.match(source, /security-info/); assert.doesNotMatch(source, /Owner access is required\./); });
test("security controls use server sessions and never persist plaintext browser credentials", () => { assert.match(source, /credentials: "include"/); assert.match(source, /type="password"/); assert.doesNotMatch(source, /localStorage|sessionStorage/); assert.match(source, /Session expires/); });
