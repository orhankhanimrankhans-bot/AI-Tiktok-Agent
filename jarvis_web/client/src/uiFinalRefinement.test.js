import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");

test("workflow feedback is a temporary fixed toast rather than a canvas row", () => {
  assert.match(app, /window\.setTimeout\(\(\) => setWorkflowNotice\(null\), 3200\)/);
  const notice = css.slice(css.indexOf(".workflow-notice {"), css.indexOf(".workflow-notice.success"));
  assert.match(notice, /position: fixed/);
  assert.match(notice, /transform: translateX\(-50%\)/);
});
test("dashboard quick access opens the actual local workflow editor without fake cards", () => {
  assert.match(dashboard, /WORKFLOW QUICK ACCESS/);
  assert.match(dashboard, /workflowName/);
  assert.match(dashboard, /onOpenWorkflow/);
  assert.match(app, /workflowName="My Workflow"/);
  assert.match(app, /setTopPage\("WORKFLOW"\)/);
  assert.doesNotMatch(dashboard, /Workflow 2|Workflow 3|Workflow 4|Workflow 5/);
});
