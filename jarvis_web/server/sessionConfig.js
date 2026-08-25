"use strict";

function configureSessionProxy(app, isProduction) {
  if (isProduction) app.set("trust proxy", 1);
}

function sessionOptions({ secret, isProduction }) {
  return {
    secret,
    resave: false,
    saveUninitialized: false,
    proxy: Boolean(isProduction),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(isProduction),
      maxAge: 10 * 60 * 1000,
    },
  };
}

module.exports = { configureSessionProxy, sessionOptions };
