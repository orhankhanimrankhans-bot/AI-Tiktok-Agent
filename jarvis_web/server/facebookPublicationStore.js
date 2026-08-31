"use strict";
const { normalizeOwner, sanitizeRuntimeData } = require("./executionStore");

const CHECKPOINTS_MS = Object.freeze([5 * 60_000, 15 * 60_000, 60 * 60_000]);
const FINAL_STATES = new Set(["unavailable_after_publish"]);

class FacebookPublicationStore {
  constructor(db, { now = () => new Date() } = {}) { this.db = db; this.now = now; }
  open() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_publications (
      video_id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
      execution_id TEXT, workflow_id TEXT, workflow_name TEXT, trigger_mode TEXT,
      credential_id TEXT NOT NULL, auth_mode TEXT NOT NULL,
      expected_page_id TEXT NOT NULL, resolved_page_id TEXT NOT NULL, page_name TEXT NOT NULL,
      source_file_id TEXT, source_file_name TEXT, submitted_at TEXT NOT NULL, published_at TEXT,
      status TEXT NOT NULL, meta_verification TEXT NOT NULL, public_audience_check TEXT NOT NULL,
      final_processing_state TEXT, copyright_state TEXT, permalink TEXT,
      page_identity_verified INTEGER NOT NULL, last_verified_at TEXT, snapshots_json TEXT NOT NULL DEFAULT '[]')`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_publication_checks (
      video_id TEXT NOT NULL, checkpoint_minutes INTEGER NOT NULL, due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempted_at TEXT, diagnostic_json TEXT,
      PRIMARY KEY(video_id, checkpoint_minutes),
      FOREIGN KEY(video_id) REFERENCES facebook_publications(video_id) ON DELETE CASCADE)`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_facebook_publication_checks_due ON facebook_publication_checks(status, due_at)");
  }
  create(record) {
    const owner = normalizeOwner(record.owner); const safe = sanitizeRuntimeData(record); const now = new Date(record.submittedAt || this.now()).toISOString();
    this.db.prepare(`INSERT INTO facebook_publications
      (video_id,owner_type,owner_id,execution_id,workflow_id,workflow_name,trigger_mode,credential_id,auth_mode,expected_page_id,resolved_page_id,page_name,source_file_id,source_file_name,submitted_at,published_at,status,meta_verification,public_audience_check,final_processing_state,copyright_state,permalink,page_identity_verified,last_verified_at,snapshots_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(safe.videoId, owner.ownerType, owner.ownerId, safe.executionId || null, safe.workflowId || null, safe.workflowName || null,
        safe.triggerMode || null, safe.credentialId, safe.authMode, safe.expectedPageId, safe.resolvedPageId, safe.pageName,
        safe.sourceFileId || null, safe.sourceFileName || null, now, safe.publishedAt || null, safe.status,
        safe.metaVerification, "manual_check_required", safe.finalProcessingState || null, safe.copyrightState || null,
        safe.permalink || null, safe.pageIdentityVerified ? 1 : 0, safe.lastVerifiedAt || null, JSON.stringify(safe.snapshots || []));
    for (const delay of CHECKPOINTS_MS) this.db.prepare("INSERT OR IGNORE INTO facebook_publication_checks(video_id,checkpoint_minutes,due_at) VALUES (?,?,?)")
      .run(safe.videoId, delay / 60_000, new Date(new Date(now).getTime() + delay).toISOString());
    return this.get(safe.videoId);
  }
  get(videoId) { const row = this.db.prepare("SELECT * FROM facebook_publications WHERE video_id = ?").get(String(videoId)); return row ? this.#public(row) : null; }
  due(limit = 20) { return this.db.prepare("SELECT * FROM facebook_publication_checks WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(this.now().toISOString(), limit); }
  completeCheck(videoId, checkpointMinutes, update) {
    const current = this.get(videoId); if (!current) return null;
    const safe = sanitizeRuntimeData(update); const timestamp = this.now().toISOString();
    const snapshots = [...current.statusSnapshots, { checkedAt: timestamp, checkpointMinutes, status: safe.status, processingState: safe.finalProcessingState || null, copyrightState: safe.copyrightState || null }].slice(-20);
    this.db.prepare(`UPDATE facebook_publications SET status=?, meta_verification=?, final_processing_state=?, copyright_state=?, permalink=COALESCE(?,permalink), last_verified_at=?, snapshots_json=? WHERE video_id=?`)
      .run(safe.status, safe.metaVerification, safe.finalProcessingState || null, safe.copyrightState || null, safe.permalink || null, timestamp, JSON.stringify(snapshots), videoId);
    this.db.prepare("UPDATE facebook_publication_checks SET status='complete', attempted_at=?, diagnostic_json=? WHERE video_id=? AND checkpoint_minutes=?")
      .run(timestamp, safe.diagnostic ? JSON.stringify(safe.diagnostic) : null, videoId, checkpointMinutes);
    if (FINAL_STATES.has(safe.status)) this.db.prepare("UPDATE facebook_publication_checks SET status='cancelled' WHERE video_id=? AND status='pending'").run(videoId);
    return this.get(videoId);
  }
  #public(row) { return { videoId: row.video_id, ownerType: row.owner_type, ownerId: row.owner_id, executionId: row.execution_id, workflowId: row.workflow_id, workflowName: row.workflow_name,
    triggerMode: row.trigger_mode, credentialId: row.credential_id, authMode: row.auth_mode, expectedPageId: row.expected_page_id,
    resolvedPageId: row.resolved_page_id, pageName: row.page_name, sourceFileId: row.source_file_id, sourceFileName: row.source_file_name,
    submittedAt: row.submitted_at, publishedAt: row.published_at, status: row.status, metaVerification: row.meta_verification,
    publicAudienceCheck: row.public_audience_check, finalProcessingState: row.final_processing_state, copyrightState: row.copyright_state,
    permalink: row.permalink, pageIdentityVerified: row.page_identity_verified === 1, lastVerifiedAt: row.last_verified_at,
    statusSnapshots: JSON.parse(row.snapshots_json || "[]") }; }
}

module.exports = { CHECKPOINTS_MS, FacebookPublicationStore };
