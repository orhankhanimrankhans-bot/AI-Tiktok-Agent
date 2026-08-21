import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicPage } from "./publicRoutes.js";

test("privacy policy has a dedicated public route", () => {
  assert.equal(resolvePublicPage("/privacy-policy"), "privacy-policy");
  assert.equal(resolvePublicPage("/privacy-policy/"), "privacy-policy");
});

test("workflow and unknown paths are not treated as the privacy policy", () => {
  assert.equal(resolvePublicPage("/"), null);
  assert.equal(resolvePublicPage("/workflows"), null);
  assert.equal(resolvePublicPage("/privacy-policy-extra"), null);
});
