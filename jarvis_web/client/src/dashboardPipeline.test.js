import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardGraph, dashboardNodeState, dashboardRoutingStatus } from "./dashboardPipeline.js";

const trigger = { id: "trigger", name: "Schedule Trigger" };

test("dashboard graph renders only nodes reachable from the workflow trigger", () => {
  const search = { id: "search", name: "Search Files and Folders" }; const limit = { id: "limit", name: "Limit" };
  const disconnected = { id: "demo", name: "YouTube" };
  const graph = buildDashboardGraph([trigger, search, limit, disconnected], [{ source: "trigger", target: "search" }, { source: "search", target: "limit" }]);
  assert.deepEqual(graph.nodes.map((node) => node.id), ["trigger", "search", "limit"]);
  assert.deepEqual(graph.connections.map(({ source, target }) => [source, target]), [["trigger", "search"], ["search", "limit"]]);
  assert.equal(graph.branches.length, 1); assert.deepEqual(graph.branches[0].nodes.map((node) => node.id), ["search", "limit"]);
});

test("dashboard graph preserves two actual fan-out branches without flattening", () => {
  const nodes = [trigger, { id: "a1", name: "Search A" }, { id: "a2", name: "Facebook A" }, { id: "b1", name: "Search B" }, { id: "b2", name: "Facebook B" }];
  const connections = [{ source: "trigger", target: "a1" }, { source: "a1", target: "a2" }, { source: "trigger", target: "b1" }, { source: "b1", target: "b2" }];
  const graph = buildDashboardGraph(nodes, connections);
  assert.deepEqual(graph.branches.map((branch) => branch.nodes.map((node) => node.id)), [["a1", "a2"], ["b1", "b2"]]);
  assert.equal(graph.nodes.length, 5); assert.equal(graph.connections.length, 4); assert.equal(graph.triggers.length, 1);
});

test("execution presentation is neutral while idle and truthful while running", () => {
  const running = { id: "facebook", name: "Facebook Graph API", status: "running" };
  const graph = { nodes: [trigger, running], trigger, branches: [{ nodes: [running] }] };
  assert.equal(dashboardNodeState({ status: "success" }, false), "idle");
  assert.equal(dashboardNodeState(running, true), "running"); assert.equal(dashboardNodeState({ status: "error" }, true), "error");
  assert.equal(dashboardRoutingStatus(graph, false), "Waiting"); assert.equal(dashboardRoutingStatus(graph, true), "Facebook Graph API");
  assert.equal(dashboardRoutingStatus(graph, false, true), "Last run error");
});

test("fan-out routing status reports actual active branch count", () => {
  const a = { id: "a", name: "A", status: "running" }; const b = { id: "b", name: "B", status: "queued" };
  const graph = { nodes: [trigger, a, b], trigger, branches: [{ nodes: [a] }, { nodes: [b] }] };
  assert.equal(dashboardRoutingStatus(graph, true), "1 active branch");
});
