"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { requireWorkspace } = require("./metaAppConfigStore");
const PUBLISHERS = new Set(["Facebook Graph API", "YouTube", "Instagram", "TikTok"]);

// Reservations are released only before any submission. An uncertain upload is
// never made eligible by a timeout or restart. Skipped source files are not moved.
class WorkflowVideoSelection {
  constructor({ db, binaryDirectory, requireMedia, facebookCredentials, now = Date.now }) {
    Object.assign(this, { db, binaryDirectory, requireMedia, facebookCredentials, now });
    db.exec(`CREATE TABLE IF NOT EXISTS workflow_video_claims (
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, destination TEXT NOT NULL,
      identity TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(owner_type,owner_id,destination,identity));`);
  }
  create(request) {
    const owner = requireWorkspace(request.owner), runId = crypto.randomUUID();
    const args = [owner.ownerType, owner.ownerId], skips = [], alternatives = new Map(), reservedKeys = new Map();
    const byId = new Map(request.nodes.map(n => [n.id, n]));
    const descendants = id => {
      const result = [], seen = new Set();
      const visit = key => { if (seen.has(key)) return; seen.add(key);
        for (const edge of request.connections.filter(e => e.source === key)) {
          const n = byId.get(edge.target); if (PUBLISHERS.has(n?.name)) result.push(n); visit(edge.target);
        }
      }; visit(id); return result;
    };
    const destination = node => `${node.name}:${node.name === "Facebook Graph API"
      ? this.facebookCredentials.get(node.config?.credentialId, { owner })?.pageId || node.config?.credentialId || "missing"
      : node.config?.credentialId || "missing"}`;
    const historical = new Map();
    // Old histories have no reliable destination binding. Conservatively skip a
    // previously successful source in this same workflow/node, never replay it.
    for (const row of this.db.prepare(`SELECT nodes_json FROM workflow_executions
      WHERE owner_type=? AND owner_id=? AND workflow_id=?`).all(...args, request.workflowId || "")) {
      for (const n of JSON.parse(row.nodes_json)) {
        if (n.status !== "success" || !PUBLISHERS.has(byId.get(n.nodeId)?.name)) continue;
        for (const output of Array.isArray(n.output) ? n.output : [n.output]) {
          if (output?.success !== true || !output.sourceFileId) continue;
          const ids = historical.get(n.nodeId) || new Set(); ids.add(output.sourceFileId); historical.set(n.nodeId, ids);
        }
      }
    }
    const identities = (source, digest) => [...(source ? [`source:${source}`] : []), ...(digest ? [`sha256:${digest}`] : [])];
    const blocked = (publishers, source, digest) => {
      for (const node of publishers) {
        if (historical.get(node.id)?.has(source)) return "previous_publishing_success";
        for (const identity of identities(source, digest)) {
          const row = this.db.prepare(`SELECT state,run_id,expires FROM workflow_video_claims
            WHERE owner_type=? AND owner_id=? AND destination=? AND identity=?`).get(...args, destination(node), identity);
          if (row && (row.state !== "reserved" || row.expires > this.now())) return row.state === "reserved" ? "video_in_use" : "previous_submission";
        }
        if (node.name === "Facebook Graph API") {
          const credential = this.facebookCredentials.get(node.config?.credentialId, { owner });
          if (!credential) continue; // The publisher reports the disconnected credential.
          for (const identity of identities(source, digest)) {
            if (this.db.prepare(`SELECT 1 FROM facebook_duplicate_keys WHERE owner_type=? AND owner_id=? AND page_id=? AND identity=?`)
              .get(...args, credential.pageId, identity)) return "facebook_previous_submission";
          }
        }
      }
      return null;
    };
    const skip = (fileId, reason) => skips.push({ sourceFileId: fileId, reason, sourceRetained: true });
    const getSource = item => String(item?.sourceFileId || item?.fileId || item?.id || "");
    const reserve = (publishers, source, digest) => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("DELETE FROM workflow_video_claims WHERE state='reserved' AND expires<=?").run(this.now());
        const reason = blocked(publishers, source, digest);
        if (reason) { this.db.exec("COMMIT"); return reason; }
        for (const target of new Set(publishers.map(destination))) for (const identity of identities(source, digest))
          this.db.prepare("INSERT INTO workflow_video_claims VALUES(?,?,?,?,?,'reserved',?)")
            .run(...args, target, identity, runId, this.now() + 120000);
        this.db.exec("COMMIT"); reservedKeys.set(source, identities(source, digest)); return null;
      } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    };
    const heartbeat = setInterval(() => {
      try { this.db.prepare("UPDATE workflow_video_claims SET expires=? WHERE run_id=? AND state='reserved'").run(this.now() + 120000, runId); } catch { /* lease expires safely */ }
    }, 15000); heartbeat.unref();
    return {
      skips,
      expandSearch: node => request.connections.some(edge => edge.source === node.id && byId.get(edge.target)?.name === "Limit"),
      filter: (node, files) => files.filter(file => {
        const reason = blocked(descendants(node.id), file.id);
        if (reason) skip(file.id, reason); return !reason;
      }),
      limit: (node, files, count) => {
        const ordered = node.config?.keep === "Last Items" ? [...files].reverse() : [...files];
        const chosen = ordered.slice(0, count);
        for (const edge of request.connections.filter(e => e.source === node.id)) alternatives.set(edge.target, ordered.slice(count));
        return node.config?.keep === "Last Items" ? chosen.reverse() : chosen;
      },
      download: async (node, item, download) => {
        let candidate = item;
        for (let attempt = 0; candidate && attempt < 50; attempt++) {
          const source = getSource(candidate), publishers = descendants(node.id);
          let reason = blocked(publishers, source);
          if (!reason) {
            const result = await download(candidate);
            this.requireMedia(result.binary?.referenceId, owner);
            if (!/^bin_[A-Za-z0-9_-]{16,128}$/.test(result.binary?.referenceId || "")) throw new Error("Invalid video reference.");
            const file = path.join(this.binaryDirectory, result.binary.referenceId), stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid video file.");
            const hash = crypto.createHash("sha256"); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
            const after = fs.statSync(file);
            if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error("Video changed during selection.");
            reason = reserve(publishers, getSource(result) || source, hash.digest("hex"));
            if (!reason) return result;
          }
          skip(source, reason); candidate = alternatives.get(node.id)?.shift();
        }
        return [];
      },
      submitting: (node, item) => {
        // All identities of this source/destination share this run's reservation.
        const source = getSource(item);
        const row = this.db.prepare(`SELECT 1 FROM workflow_video_claims WHERE owner_type=? AND owner_id=?
          AND destination=? AND identity=? AND run_id=?`).get(...args, destination(node), `source:${source}`, runId);
        if (!row) throw Object.assign(new Error("Video reservation unavailable; no upload started."), { code: "video_reservation_missing" });
        for (const identity of reservedKeys.get(source) || []) this.db.prepare("UPDATE workflow_video_claims SET state='submitted' WHERE run_id=? AND destination=? AND identity=?").run(runId, destination(node), identity);
      },
      failed: (node, item, error) => {
        // These are local preflight failures: no remote upload can have started.
        if (!["invalid_credential_id", "credential_disconnected", "youtube_credential_not_found", "invalid_title", "invalid_description", "invalid_privacy_status", "invalid_category", "missing_binary", "missing_binary_reference", "binary_not_found", "invalid_source_file_id", "invalid_source_file_name"].includes(error?.code)) return;
        for (const identity of reservedKeys.get(getSource(item)) || []) this.db.prepare("UPDATE workflow_video_claims SET state='reserved' WHERE run_id=? AND destination=? AND identity=?").run(runId, destination(node), identity);
      },
      close: () => {
        clearInterval(heartbeat);
        this.db.prepare("DELETE FROM workflow_video_claims WHERE run_id=? AND state='reserved'").run(runId);
      },
    };
  }
}
module.exports = { WorkflowVideoSelection };
