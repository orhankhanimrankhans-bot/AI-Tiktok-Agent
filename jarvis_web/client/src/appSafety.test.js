import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("workflow Save no longer uses a blocking browser alert", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.alert\s*\(/);
});
