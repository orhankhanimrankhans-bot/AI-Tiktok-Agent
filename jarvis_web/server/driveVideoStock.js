"use strict";

const { GOOGLE_DRIVE_PROVIDER } = require("./credentialStore");
const SIX_HOURS = 6 * 60 * 60 * 1000;
const folderMime = "application/vnd.google-apps.folder";
const statusFor = count => count <= 5 ? "CRITICAL" : count <= 10 ? "LOW" : "HEALTHY";
const isVideo = file => !String(file.mimeType || "").startsWith("application/vnd.google-apps.") && (/^video\//i.test(file.mimeType || "") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name || ""));

function discoverSources(workflows) {
  const sources = new Map();
  for (const workflow of workflows) for (const node of workflow.nodes || []) {
    if (node.name !== "Search Files and Folders") continue;
    const { folderId, credentialId } = node.config || {};
    // Expressions cannot be evaluated safely outside a workflow execution.
    if (!folderId || !credentialId) continue;
    const source = { ownerType: workflow.ownerType, ownerId: workflow.ownerId, folderId: String(folderId).trim(), credentialId: String(credentialId).trim() };
    sources.set(JSON.stringify(Object.values(source)), source);
  }
  return [...sources.values()];
}

async function countFolder({ source, credentialStore, createOAuthClient, createDriveClient }) {
  if (!/^[\w-]+$/.test(source.folderId)) throw new Error("Invalid source folder configuration.");
  const owner = { ownerType: source.ownerType, ownerId: source.ownerId };
  const credential = await credentialStore.get(source.credentialId, { owner, provider: GOOGLE_DRIVE_PROVIDER, includeTokens: true });
  if (!credential?.tokens) throw new Error("Reconnect the configured Google Drive account.");
  const auth = createOAuthClient();
  if (!auth) throw new Error("Google Drive connection is unavailable.");
  auth.setCredentials(credential.tokens);
  let refreshed = null;
  auth.on("tokens", tokens => { refreshed = { ...refreshed, ...tokens }; });
  const drive = createDriveClient(auth);
  try {
    const { data: folder } = await drive.files.get({ fileId: source.folderId, fields: "id,name,mimeType,trashed", supportsAllDrives: true }, { timeout: 30000 });
    if (folder.trashed || folder.mimeType !== folderMime) throw new Error("Source folder is missing or unavailable.");
    let count = 0, pageToken;
    const seen = new Set();
    do {
      const { data } = await drive.files.list({ q: `'${source.folderId}' in parents and trashed = false`, fields: "nextPageToken,incompleteSearch,files(id,name,mimeType)", pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true }, { timeout: 30000 });
      if (data.incompleteSearch) throw new Error("Google Drive returned an incomplete scan.");
      count += (data.files || []).filter(isVideo).length;
      pageToken = data.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw new Error("Google Drive pagination could not finish.");
      seen.add(pageToken);
    } while (pageToken);
    return { name: folder.name, count };
  } finally {
    if (refreshed) await credentialStore.save({ id: credential.id, provider: GOOGLE_DRIVE_PROVIDER, accountEmail: credential.accountEmail, accountName: credential.accountName, tokens: { ...credential.tokens, ...refreshed } }, owner);
  }
}

function createDriveVideoStock({ db, listWorkflows, authorize, credentialStore, createOAuthClient, createDriveClient, now = Date.now, logger = console, count = countFolder }) {
  db.exec(`CREATE TABLE IF NOT EXISTS drive_video_stock (
    owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, folder_id TEXT NOT NULL, credential_id TEXT NOT NULL,
    folder_name TEXT, video_count INTEGER, stock_status TEXT, last_checked INTEGER, last_success INTEGER, error TEXT,
    PRIMARY KEY(owner_type,owner_id,folder_id,credential_id));
    CREATE TABLE IF NOT EXISTS drive_stock_scan_lock (id INTEGER PRIMARY KEY, token TEXT, expires INTEGER);
    INSERT OR IGNORE INTO drive_stock_scan_lock(id,expires) VALUES(1,0);`);
  const key = s => [s.ownerType, s.ownerId, s.folderId, s.credentialId];
  const get = s => db.prepare("SELECT * FROM drive_video_stock WHERE owner_type=? AND owner_id=? AND folder_id=? AND credential_id=?").get(...key(s));
  const sources = () => discoverSources(listWorkflows()).filter(s => { try { authorize(s); return true; } catch { return false; } });
  let running = false, timer = null;
  function snapshot(owner) {
    authorize(owner);
    const folders = sources().filter(s => s.ownerType === owner.ownerType && s.ownerId === owner.ownerId).map(s => {
      const row = get(s);
      return { folderId: s.folderId, name: row?.folder_name || "Source folder awaiting scan", count: row?.video_count ?? null, status: row?.error ? "UNAVAILABLE" : row?.stock_status || "UNAVAILABLE", lastChecked: row?.last_checked || null, lastSuccess: row?.last_success || null, error: row?.error || null };
    });
    const order = { UNAVAILABLE: -1, CRITICAL: 0, LOW: 1, HEALTHY: 2 };
    folders.sort((a,b) => order[a.status] - order[b.status] || (a.count ?? -1) - (b.count ?? -1) || a.name.localeCompare(b.name));
    return { folders, scanning: db.prepare("SELECT expires FROM drive_stock_scan_lock WHERE id=1").get().expires > now(), intervalHours: 6 };
  }
  async function scan(owner = null, force = false) {
    if (owner) authorize(owner);
    if (running) return false;
    const token = require("node:crypto").randomUUID();
    if (!db.prepare("UPDATE drive_stock_scan_lock SET token=?,expires=? WHERE id=1 AND expires<=?").run(token, now()+90000, now()).changes) return false;
    running = true;
    const heartbeat = setInterval(() => db.prepare("UPDATE drive_stock_scan_lock SET expires=? WHERE id=1 AND token=?").run(now()+90000, token), 20000);
    heartbeat.unref?.();
    try {
      for (const source of sources()) {
        if (owner && (owner.ownerType !== source.ownerType || owner.ownerId !== source.ownerId)) continue;
        const prior = get(source);
        if (!force && prior?.last_checked && now()-prior.last_checked < SIX_HOURS) continue;
        try {
          authorize(source);
          const result = await count({ source, credentialStore, createOAuthClient, createDriveClient });
          authorize(source);
          const status = statusFor(result.count), time = now();
          db.prepare(`INSERT INTO drive_video_stock VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(owner_type,owner_id,folder_id,credential_id) DO UPDATE SET folder_name=excluded.folder_name,video_count=excluded.video_count,stock_status=excluded.stock_status,last_checked=excluded.last_checked,last_success=excluded.last_success,error=NULL`).run(...key(source), result.name, result.count, status, time, time);
          if (prior?.stock_status !== status) logger.info("Drive video stock transition", { folderId: source.folderId, from: prior?.stock_status || "UNKNOWN", to: status });
        } catch {
          db.prepare(`INSERT INTO drive_video_stock(owner_type,owner_id,folder_id,credential_id,last_checked,error) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,folder_id,credential_id) DO UPDATE SET last_checked=excluded.last_checked,error=excluded.error`).run(...key(source), now(), "Unable to scan this source folder. Check its configuration and Google Drive access, then refresh.");
        }
      }
      return true;
    } finally { clearInterval(heartbeat); db.prepare("UPDATE drive_stock_scan_lock SET expires=0 WHERE id=1 AND token=?").run(token); running = false; }
  }
  return { snapshot, scan, start() { if (timer) return; const tick = () => scan().catch(() => logger.error("Drive stock scan unavailable.")); tick(); timer = setInterval(tick, 60000); timer.unref?.(); }, stop() { clearInterval(timer); timer = null; } };
}

module.exports = { createDriveVideoStock, discoverSources, countFolder, statusFor, isVideo, SIX_HOURS };
