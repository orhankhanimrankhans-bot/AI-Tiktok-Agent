"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const { requireWorkspace } = require("./metaAppConfigStore");
const { FacebookGraphError } = require("./facebookGraph");

// A reservation never expires into permission to upload again. A lost response
// can mean Facebook accepted the video even though Corex did not receive its ID.
class FacebookDuplicateGuard {
  constructor(db) { this.db = db; }
  open() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_duplicate_posts (
      id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
      page_id TEXT NOT NULL, video_id TEXT, result_json TEXT);
      CREATE TABLE IF NOT EXISTS facebook_duplicate_keys (
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, page_id TEXT NOT NULL,
      identity TEXT NOT NULL, post_id TEXT NOT NULL,
      PRIMARY KEY(owner_type,owner_id,page_id,identity));`);
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE name='facebook_publications'").get()) {
      for (const row of this.db.prepare("SELECT * FROM facebook_publications WHERE source_file_id IS NOT NULL AND source_file_id != ''").all()) {
        const claim = this.reserve({ owner: { ownerType: row.owner_type, ownerId: row.owner_id },
          pageId: row.expected_page_id, sourceId: row.source_file_id });
        if (claim.acquired) this.video(claim.id, row.video_id);
      }
    }
  }
  reserve({ owner, pageId, sourceId, digest }) {
    const w = requireWorkspace(owner);
    if (!/^\d{3,30}$/.test(String(pageId))) throw new Error("Invalid Facebook destination.");
    const keys = [...(sourceId ? [`source:${sourceId}`] : []), ...(digest ? [`sha256:${digest}`] : [])];
    if (!keys.length) throw new Error("Missing video identity.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = keys.map(key => this.db.prepare(`SELECT p.* FROM facebook_duplicate_keys k JOIN facebook_duplicate_posts p ON p.id=k.post_id
        WHERE k.owner_type=? AND k.owner_id=? AND k.page_id=? AND k.identity=?`).get(w.ownerType,w.ownerId,pageId,key)).filter(Boolean);
      let row = rows[0]; const acquired = !row;
      if (!row) {
        const id = crypto.randomUUID();
        this.db.prepare("INSERT INTO facebook_duplicate_posts(id,owner_type,owner_id,page_id) VALUES(?,?,?,?)").run(id,w.ownerType,w.ownerId,pageId);
        row = { id };
      }
      for (const key of keys) this.db.prepare("INSERT OR IGNORE INTO facebook_duplicate_keys VALUES(?,?,?,?,?)").run(w.ownerType,w.ownerId,pageId,key,row.id);
      this.db.exec("COMMIT");
      return { ...row, acquired };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  video(id, videoId) { this.db.prepare("UPDATE facebook_duplicate_posts SET video_id=? WHERE id=?").run(videoId,id); }
  complete(id, result) { this.db.prepare("UPDATE facebook_duplicate_posts SET result_json=? WHERE id=?").run(JSON.stringify(result),id); }
  async claim(owner, pageId, sourceId, filePath) {
    const fingerprint = () => { const s = fs.statSync(filePath); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; };
    const before = fingerprint();
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    if (fingerprint() !== before) throw new FacebookGraphError(409,"facebook_media_changed","The video changed while checking for duplicates. No upload was started.");
    return this.reserve({ owner, pageId, sourceId, digest: hash.digest("hex") });
  }
  blocked() { return new FacebookGraphError(409,"facebook_duplicate_pending","Duplicate blocked: this video already has a Facebook submission for this Page. Its outcome is not confirmed; no new video was sent."); }
}
module.exports = { FacebookDuplicateGuard };
