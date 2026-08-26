"use strict";

function configureSessionProxy(app, isProduction) {
  if (isProduction) app.set("trust proxy", 1);
}

const DEFAULT_SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
function sessionOptions({ secret, isProduction, store, maxAgeMs = DEFAULT_SESSION_MAX_AGE_MS }) {
  return {
    secret,
    resave: false,
    saveUninitialized: false,
    store,
    proxy: Boolean(isProduction),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(isProduction),
      maxAge: maxAgeMs,
    },
  };
}

module.exports = { DEFAULT_SESSION_MAX_AGE_MS, configureSessionProxy, sessionOptions };
