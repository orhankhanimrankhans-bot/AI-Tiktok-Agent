import assert from "node:assert/strict";
import test from "node:test";

import { inferSchema, tableModel } from "./dataView.js";

test("Table viewer builds columns for arrays of objects and tolerates missing values", () => {
  const model = tableModel([{ id: 1, name: "A" }, { id: 2, size: 10 }]);
  assert.deepEqual(model.columns, ["id", "name", "size"]);
  assert.equal(model.rows[1].name, undefined);
});

test("Schema inference describes nested objects and arrays", () => {
  const schema = inferSchema({ user: { name: "Ada" }, tags: ["one", "two"] });
  assert.equal(schema.fields.user.fields.name.type, "string");
  assert.equal(schema.fields.tags.type, "array");
  assert.equal(schema.fields.tags.items.type, "string");
});
