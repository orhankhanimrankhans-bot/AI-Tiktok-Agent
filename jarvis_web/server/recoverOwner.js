"use strict";

const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const dotenv = require("dotenv");
const { DatabaseSync } = require("node:sqlite");
const { AccessControlStore, normalizeEmail } = require("./accessControl");

function assertLocalOnly(env = process.env) {
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("Owner recovery is disabled in production.");
  }
}

async function recoverOwner({ store, email, password, confirmPassword, env = process.env }) {
  assertLocalOnly(env);
  const normalizedEmail = normalizeEmail(email);
  if (password !== confirmPassword) throw new Error("Passwords do not match.");
  await store.recoverOwnerLocally(normalizedEmail, password);
}

async function promptHidden(rl, prompt) {
  const originalWrite = rl._writeToOutput;
  rl._writeToOutput = function (text) { if (!this.stdoutMuted) this.output.write(text); };
  rl.stdoutMuted = false;
  const pending = rl.question(prompt);
  rl.stdoutMuted = true;
  try { return await pending; } finally { rl.stdoutMuted = false; rl._writeToOutput = originalWrite; stdout.write("\n"); }
}

async function main() {
  assertLocalOnly(process.env);
  dotenv.config({ quiet: true });
  assertLocalOnly(process.env);
  const dbPath = path.resolve(process.env.JARVIS_DB_PATH || path.join(__dirname, "data", "credentials.sqlite3"));
  const db = new DatabaseSync(dbPath);
  const store = new AccessControlStore({ db });
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    store.open();
    const email = await rl.question("Owner/Admin email: ");
    const password = await promptHidden(rl, "New Admin password: ");
    const confirmPassword = await promptHidden(rl, "Confirm new Admin password: ");
    await recoverOwner({ store, email, password, confirmPassword });
    console.log("Local Owner recovery completed.");
  } finally {
    rl.close();
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message || "Local Owner recovery failed."); process.exitCode = 1; });
}

module.exports = { assertLocalOnly, recoverOwner };
