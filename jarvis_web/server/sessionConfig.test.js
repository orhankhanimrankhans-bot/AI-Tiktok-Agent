"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { configureSessionProxy, sessionOptions } = require("./sessionConfig");

test("production trusts one proxy hop and keeps hardened secure cookies", () => {
  const app = express();
  configureSessionProxy(app, true);
  const options = sessionOptions({ secret: "test secret", isProduction: true });
  assert.equal(app.get("trust proxy fn")("127.0.0.1", 0), true);
  assert.equal(app.get("trust proxy fn")("127.0.0.1", 1), false);
  assert.equal(options.proxy, true);
  assert.deepEqual(options.cookie, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 600_000 });
});

test("development keeps proxy trust disabled and supports HTTP localhost cookies", () => {
  const app = express();
  configureSessionProxy(app, false);
  const options = sessionOptions({ secret: "test secret", isProduction: false });
  assert.equal(app.get("trust proxy"), false);
  assert.equal(options.proxy, false);
  assert.equal(options.cookie.secure, false);
  assert.equal(options.cookie.httpOnly, true);
  assert.equal(options.cookie.sameSite, "lax");
});
