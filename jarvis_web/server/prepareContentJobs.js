"use strict";
const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");
const { PrepareContentError, validatePrepareContentInput } = require("./openaiPrepareContent");
const { privateVideoPath } = require("./geminiVideoAnalysis");
const { trackPrepareContentHttp } = require("./prepareContentHttpDiagnostics");
const MAX_RUN_MS = 40 * 60 * 1000, RETENTION_MS = 60 * 60 * 1000;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
class PrepareContentJobs {
  constructor(dbPath, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS prepare_content_jobs (
        id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
        request_id TEXT NOT NULL, input_hash TEXT NOT NULL, state TEXT NOT NULL,
        created INTEGER NOT NULL, heartbeat INTEGER NOT NULL, payload TEXT,
        UNIQUE(owner_type, owner_id, request_id));`);
  }
  sweep() {
    const now = this.now();
    this.db.prepare("UPDATE prepare_content_jobs SET state='failed', payload=? WHERE state='running' AND (heartbeat < ? OR created < ?)")
      .run(JSON.stringify({code:'prepare_content_job_interrupted',error:'Prepare Content stopped before completion. Execute again to start a new job.'}), now-60000, now-MAX_RUN_MS);
    this.db.prepare('DELETE FROM prepare_content_jobs WHERE created < ?').run(now-RETENTION_MS);
  }
  start(owner, requestId, body, run) {
    if (!UUID.test(requestId || '')) throw new PrepareContentError(400,'invalid_job_request','Invalid Prepare Content request ID.');
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    let job;
    try {
      this.sweep();
      job=this.db.prepare('SELECT * FROM prepare_content_jobs WHERE owner_type=? AND owner_id=? AND request_id=?').get(owner.ownerType,owner.ownerId,requestId);
      if(job && job.input_hash!==hash) throw new PrepareContentError(409,'job_request_conflict','This request ID belongs to different Prepare Content input.');
      if(!job) {
        const count=this.db.prepare("SELECT count(*) AS n FROM prepare_content_jobs WHERE state='running' AND owner_type=? AND owner_id=?").get(owner.ownerType,owner.ownerId).n;
        const total=this.db.prepare("SELECT count(*) AS n FROM prepare_content_jobs WHERE state='running'").get().n;
        if(count>=2 || total>=16) throw new PrepareContentError(429,'prepare_content_busy','Prepare Content is busy. Wait for an existing job to finish.');
        job={id:randomUUID()};const now=this.now();
        this.db.prepare("INSERT INTO prepare_content_jobs VALUES (?,?,?,?,?,'running',?,?,NULL)").run(job.id,owner.ownerType,owner.ownerId,requestId,hash,now,now);
      } else job.existing=true;
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    if(!job.existing) setImmediate(async()=>{
      const heartbeat=setInterval(()=>{try{this.db.prepare("UPDATE prepare_content_jobs SET heartbeat=? WHERE id=? AND state='running'").run(this.now(),job.id);}catch{}},15000);heartbeat.unref();
      try {
        const result=await run(body);
        this.finish(job.id,'succeeded',result);
      } catch(error) {
        const safe=error instanceof PrepareContentError ? {code:error.code,error:error.message} : {code:'prepare_content_failed',error:'Prepare Content could not be completed.'};
        this.finish(job.id,'failed',safe);
      } finally {clearInterval(heartbeat);}
    });
    return {jobId:job.id,state:'running'};
  }
  finish(id,state,payload) {try{this.db.prepare("UPDATE prepare_content_jobs SET state=?, payload=? WHERE id=? AND state='running'").run(state,JSON.stringify(payload),id);}catch{ /* Polling reports expired heartbeat if persistence fails. */ }}
  get(owner,id) {
    this.sweep();
    const row=this.db.prepare('SELECT state,payload FROM prepare_content_jobs WHERE id=? AND owner_type=? AND owner_id=?').get(id,owner.ownerType,owner.ownerId);
    if(!row)return null;
    return {jobId:id,state:row.state,...(row.payload ? row.state==='succeeded'?{result:JSON.parse(row.payload)}:{failure:JSON.parse(row.payload)}:{})};
  }
}
function registerPrepareContentJobs(app,{getStore,getOwner,getService,binaryDir}) {
  const fail=(res,error)=>res.status(error instanceof PrepareContentError?error.statusCode:500).json({error:error instanceof PrepareContentError?error.message:'Prepare Content job could not be accessed.'});
  app.post('/api/ai/prepare-content/jobs',(req,res)=>{
    trackPrepareContentHttp(req,res);res.set('Cache-Control','no-store');
    try {
      const owner=getOwner(req);if(!owner)return res.status(401).json({error:'Authentication is required.'});
      validatePrepareContentInput(req.body);
      privateVideoPath(binaryDir,req.body.binary,req.body.mimeType);
      const service=getService();
      const job=getStore().start(owner,req.get('X-Corex-Job-Request'),req.body,body=>service.prepare({body,apiKey:service.apiKey,model:service.model}));
      return res.status(202).json(job);
    }catch(error){return fail(res,error);}
  });
  app.get('/api/ai/prepare-content/jobs/:id',(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const owner=getOwner(req);if(!owner)return res.status(401).json({error:'Authentication is required.'});
      const job=UUID.test(req.params.id)?getStore().get(owner,req.params.id):null;
      return job?res.json(job):res.status(404).json({error:'Prepare Content job not found or expired.'});
    }catch(error){return fail(res,error);}
  });
}
module.exports={PrepareContentJobs,registerPrepareContentJobs};
