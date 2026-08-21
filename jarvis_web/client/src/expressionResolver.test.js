import assert from "node:assert/strict";
import test from "node:test";
import { executePerItem, resolveExpression } from "./expressionResolver.js";

test("resolves native, nested, and interpolated JSON expressions", () => {
  assert.equal(resolveExpression("{{ $json.id }}", { id: 7 }), 7);
  assert.equal(resolveExpression("{{ $json.parent.id }}", { parent: { id: "p1" } }), "p1");
  assert.equal(resolveExpression("File {{ $json.name }}", { name: "report" }), "File report");
});
test("missing paths fail safely and arbitrary JavaScript is not evaluated", () => {
  assert.throws(() => resolveExpression("{{ $json.missing }}", {}), /was not found/);
  globalThis.__jarvisExpressionPwned = false;
  assert.equal(resolveExpression("{{ globalThis.__jarvisExpressionPwned = true }}", {}), "{{ globalThis.__jarvisExpressionPwned = true }}");
  assert.equal(globalThis.__jarvisExpressionPwned, false);
});
test("array item execution is deterministic and flattens one level", async () => {
  assert.deepEqual(await executePerItem([{ id: 1 }, { id: 2 }], async (item) => [item.id]), [1, 2]);
});
