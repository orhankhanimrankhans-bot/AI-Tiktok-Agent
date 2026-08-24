import assert from "node:assert/strict";
import test from "node:test";
import { findOfficeRoute, handoffIntent, interpolateRoutePosition, routePath } from "./officeMovement.js";

test("office handoff intent requires an explicit source and destination", () => {
  assert.deepEqual(handoffIntent("Nova, give this social report to Pulse."), { source: "nova", destination: "pulse", packageType: "task" });
  assert.deepEqual(handoffIntent("Link, take these video files to Kazim."), { source: "link", destination: "kazim", packageType: "video" });
  assert.equal(handoffIntent("Check Kazim workspace"), null);
  assert.deepEqual(handoffIntent("Link, take these product videos to the Amazon room."), { source: "link", destination: "amazon", packageType: "video" });
});

test("Amazon Operations participates in the generic corridor route graph", () => {
  for (const source of ["link", "atlas", "pulse"]) {
    const ids = findOfficeRoute(source, "amazon").map((point) => point.id);
    for (const anchor of ["amazonDoor", "amazonApproach", "amazonStanding", "amazonHandover", "amazonDesk", "amazon"]) assert.ok(ids.includes(anchor), `${source} route missing ${anchor}`);
  }
  assert.ok(findOfficeRoute("amazon", "imran").length > 6);
});

test("route graph sends LINK to Kazim through doors and the shared corridor", () => {
  const ids = findOfficeRoute("link", "kazim").map((point) => point.id);
  assert.deepEqual(ids, ["link", "linkStand", "coordinatorDoor", "corridorTop", "corridorJunction", "humanHall", "kazimDoor", "kazimStand", "kazim"]);
  assert.match(routePath(findOfficeRoute("orbit", "link")), /^M165 390\.59 L190 365\.3/);
});

test("walking interpolates continuously across multi-waypoint routes", () => {
  const route = findOfficeRoute("nova", "pulse");
  assert.deepEqual(route.map((point) => point.id), ["nova", "novaStand", "mainAisle", "pulseStand", "pulse"]);
  const start = interpolateRoutePosition(route, 0), middle = interpolateRoutePosition(route, 0.5), end = interpolateRoutePosition(route, 1);
  assert.deepEqual(start, { x: 18.5, y: 43.5 });
  assert.notDeepEqual(middle, start); assert.notDeepEqual(middle, end);
  assert.deepEqual(end, { x: 37, y: 43.5 });
});

test("return path reverses the exact safe waypoint route", () => {
  const route = findOfficeRoute("nova", "pulse");
  assert.equal(routePath(route, true).split(" ").at(0), "M370");
  assert.equal(route.at(0).id, "nova"); assert.equal(route.at(-1).id, "pulse");
});
