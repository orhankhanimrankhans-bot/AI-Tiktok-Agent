"use strict";
const crypto = require("node:crypto");
const { normalizeCredentialOwner } = require("./credentialOwnership");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const ownerKey = owner => { if (!owner?.ownerType || !owner?.ownerId) throw Error("Workspace required."); const w = normalizeCredentialOwner(owner); return `${w.ownerType}:${w.ownerId}`; };
class InstagramStore {
  constructor(db, secret) {
    if (!secret) throw Error("Instagram encryption requires a server secret.");
    this.db = db; this.key = crypto.scryptSync(secret, "corex-instagram-v1", 32);
    db.exec(`CREATE TABLE IF NOT EXISTS instagram_private (owner TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,kind));
      CREATE TABLE IF NOT EXISTS instagram_oauth (state TEXT PRIMARY KEY,owner TEXT NOT NULL,session TEXT NOT NULL,revision TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS instagram_posts (owner TEXT NOT NULL,account TEXT NOT NULL,digest TEXT NOT NULL,id TEXT NOT NULL UNIQUE,reference TEXT NOT NULL,caption TEXT NOT NULL,share_feed INTEGER NOT NULL,status TEXT NOT NULL,container TEXT,media_id TEXT,created INTEGER NOT NULL,PRIMARY KEY(owner,account,digest));
      CREATE TABLE IF NOT EXISTS instagram_media (token TEXT PRIMARY KEY,job TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS instagram_locks (owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires INTEGER NOT NULL);`);
  }
  get(owner, kind) {
    const identity = ownerKey(owner), row = this.db.prepare("SELECT payload FROM instagram_private WHERE owner=? AND kind=?").get(identity,kind);
    if (!row) return null;
    const [iv,tag,data] = JSON.parse(row.payload).map(v=>Buffer.from(v,"base64"));
    const cipher=crypto.createDecipheriv("aes-256-gcm",this.key,iv);cipher.setAAD(Buffer.from(`${identity}:${kind}`));cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString());
  }
  save(owner,kind,value) {
    const identity=ownerKey(owner),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",this.key,iv);
    cipher.setAAD(Buffer.from(`${identity}:${kind}`));const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    this.db.prepare("INSERT INTO instagram_private VALUES(?,?,?) ON CONFLICT(owner,kind) DO UPDATE SET payload=excluded.payload").run(identity,kind,JSON.stringify([iv,cipher.getAuthTag(),bytes].map(v=>v.toString("base64"))));
  }
  removeAccount(owner) { const key=ownerKey(owner);this.db.prepare("DELETE FROM instagram_private WHERE owner=? AND kind='account'").run(key);this.db.prepare("DELETE FROM instagram_oauth WHERE owner=?").run(key);this.db.prepare("DELETE FROM instagram_media WHERE job IN (SELECT id FROM instagram_posts WHERE owner=?)").run(key); }
  begin(owner,session,revision) { const state=crypto.randomBytes(32).toString("base64url");this.db.prepare("DELETE FROM instagram_oauth WHERE expires<? OR owner=?").run(Date.now(),ownerKey(owner));this.db.prepare("INSERT INTO instagram_oauth VALUES(?,?,?,?,?)").run(digest(state),ownerKey(owner),digest(session),revision,Date.now()+600000);return state; }
  consume(state,owner,session,revision) { if(typeof state!=="string" || state.length>128)return false;return !!this.db.prepare("DELETE FROM instagram_oauth WHERE state=? AND owner=? AND session=? AND revision=? AND expires>? RETURNING state").get(digest(state),ownerKey(owner),digest(session),revision,Date.now()); }
  lock(owner) { const token=crypto.randomUUID();return this.db.prepare("INSERT INTO instagram_locks VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE instagram_locks.expires<? RETURNING token").get(ownerKey(owner),token,Date.now()+90000,Date.now())?.token; }
  renew(owner,token) { return this.db.prepare("UPDATE instagram_locks SET expires=? WHERE owner=? AND token=?").run(Date.now()+90000,ownerKey(owner),token).changes===1; }
  unlock(owner,token) { this.db.prepare("DELETE FROM instagram_locks WHERE owner=? AND token=?").run(ownerKey(owner),token); }
}
module.exports={InstagramStore,digest,ownerKey};
