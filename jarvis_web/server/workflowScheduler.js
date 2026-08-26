"use strict";

const DEFAULT_TIMEZONE = "Asia/Riyadh";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localParts(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", weekday: "long", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}
function hourNumber(value) { if (value === "Midnight") return 0; if (value === "Noon") return 12; const match = /^(\d{1,2})(am|pm)$/i.exec(String(value || "")); if (!match) return Number(value); const base = Number(match[1]) % 12; return base + (match[2].toLowerCase() === "pm" ? 12 : 0); }
function cronField(value, actual, minimum, maximum) { if (value === "*") return true; return value.split(",").some((part) => { if (/^\*\/\d+$/.test(part)) return (actual - minimum) % Number(part.slice(2)) === 0; if (/^\d+-\d+$/.test(part)) { const [from, to] = part.split("-").map(Number); return actual >= from && actual <= to; } const number = Number(part); return Number.isInteger(number) && number >= minimum && number <= maximum && actual === number; }); }
function ruleMatches(rule, date, timezone) {
  const p = localParts(date, timezone); const interval = rule?.interval || "Days";
  if (interval === "Custom (Cron)") { const fields = String(rule.cron || "").trim().split(/\s+/); return fields.length === 5 && cronField(fields[0], p.minute, 0, 59) && cronField(fields[1], p.hour, 0, 23) && cronField(fields[2], p.day, 1, 31) && cronField(fields[3], p.month, 1, 12) && cronField(fields[4], WEEKDAYS.indexOf(p.weekday), 0, 6); }
  if (interval === "Days") return p.hour === hourNumber(rule.hour) && p.minute === Number(rule.minute || 0);
  if (interval === "Weeks") return p.weekday === rule.weekday && p.hour === hourNumber(rule.hour) && p.minute === 0;
  if (interval === "Months") return p.day === Number(rule.monthDay) && p.hour === hourNumber(rule.hour) && p.minute === 0;
  const period = interval === "Hours" ? Number(rule.hours) * 60 : interval === "Minutes" ? Number(rule.minutes) : Math.max(1, Math.ceil(Number(rule.seconds) / 60));
  return Number.isInteger(period) && period > 0 && Math.floor(date.getTime() / 60_000) % period === 0 && (interval !== "Hours" || p.minute === Number(rule.minute || 0));
}
function scheduleRules(workflow) { const trigger = workflow.nodes.find((node) => node?.name === "Schedule Trigger"); return Array.isArray(trigger?.config?.rules) ? trigger.config.rules : Array.isArray(workflow.schedule?.rules) ? workflow.schedule.rules : []; }
function occurrenceKey(workflow, rule, scheduledFor) { return `${workflow.id}:${String(rule.id)}:${scheduledFor.toISOString()}`; }

function createWorkflowScheduler({ workflowStore, workflowExecutor, executionStore, now = () => new Date(), pollMs = 15_000, logger = console, timezone = DEFAULT_TIMEZONE } = {}) {
  if (!workflowStore || !workflowExecutor || !executionStore) throw new Error("Scheduler dependencies are required.");
  let timer = null, running = false, lastTick = null; const startedAt = now().toISOString();
  const dueAt = (value) => new Date(Math.floor(value.getTime() / 60_000) * 60_000);
  async function executeOccurrence(workflow, rule, scheduledFor) {
    const key = occurrenceKey(workflow, rule, scheduledFor); const owner = { ownerType: workflow.ownerType, ownerId: workflow.ownerId };
    if (!workflowStore.claimOccurrence({ key, workflowId: workflow.id, owner, ruleId: String(rule.id), scheduledFor: scheduledFor.toISOString(), status: "running" })) return false;
    const actualStart = now(); try { const result = await workflowExecutor.execute({ workflowId: workflow.id, nodes: workflow.nodes, connections: workflow.connections, triggerMode: "schedule", owner }); const finishedAt = now(); const record = executionStore.save({ ...result, workflowName: workflow.name, startedAt: result.startedAt || actualStart.toISOString(), finishedAt: result.completedAt || finishedAt.toISOString(), triggerMode: "schedule", nodes: result.nodes }, owner); workflowStore.finishOccurrence(key, { status: result.status, actualStart: actualStart.toISOString(), finishedAt: finishedAt.toISOString(), executionId: record.executionId }); return true; } catch (error) { const finishedAt = now(); workflowStore.finishOccurrence(key, { status: "error", actualStart: actualStart.toISOString(), finishedAt: finishedAt.toISOString(), error: "Scheduled workflow execution failed safely." }); logger.error?.("Scheduled workflow execution failed", { workflowId: workflow.id, ownerType: owner.ownerType, ruleId: String(rule.id) }); return true; }
  }
  async function tick() { if (running) return; running = true; try { const current = dueAt(now()); const workflows = workflowStore.listSchedulerWorkflows(); for (const workflow of workflows) for (const rule of scheduleRules(workflow)) if (ruleMatches(rule, current, workflow.timezone || timezone)) await executeOccurrence(workflow, rule, current); lastTick = now().toISOString(); } finally { running = false; } }
  function recordHeartbeat() { workflowStore.setSchedulerState("last_heartbeat", now().toISOString()); }
  function logSafe(message) { try { logger.error?.(message); } catch { /* Logging must not break the scheduler error boundary. */ } }
  async function runTickSafely() { try { await tick(); } catch { logSafe("Scheduler tick failed safely."); } finally { try { recordHeartbeat(); } catch { logSafe("Scheduler heartbeat failed safely."); } } }
  function markMissedAfterRestart() { const previousValue = workflowStore.schedulerState("last_heartbeat"); const current = dueAt(now()); if (!previousValue) return; const previous = dueAt(new Date(previousValue)); const earliest = new Date(Math.max(previous.getTime() + 60_000, current.getTime() - 7 * 86_400_000)); const workflows = workflowStore.listSchedulerWorkflows(); for (let timestamp = earliest.getTime(); timestamp < current.getTime(); timestamp += 60_000) { const candidate = new Date(timestamp); for (const workflow of workflows) for (const rule of scheduleRules(workflow)) if (ruleMatches(rule, candidate, workflow.timezone || timezone)) workflowStore.claimOccurrence({ key: occurrenceKey(workflow, rule, candidate), workflowId: workflow.id, owner: { ownerType: workflow.ownerType, ownerId: workflow.ownerId }, ruleId: String(rule.id), scheduledFor: candidate.toISOString(), status: "missed" }); } }
  function start() { if (timer) return; markMissedAfterRestart(); void runTickSafely(); timer = setInterval(() => { void runTickSafely(); }, pollMs); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function status() { const workflows = workflowStore.listSchedulerWorkflows(); const current = dueAt(now()); let next = null; for (let offset = 0; offset <= 8 * 24 * 60; offset++) { const candidate = new Date(current.getTime() + offset * 60_000); if (workflows.some((workflow) => scheduleRules(workflow).some((rule) => ruleMatches(rule, candidate, workflow.timezone || timezone)))) { next = candidate.toISOString(); break; } } return { running: Boolean(timer), timezone, scheduledWorkflows: workflows.filter((workflow) => scheduleRules(workflow).length).length, nextExecution: next, backendStartedAt: startedAt, lastTick, recentOccurrences: workflowStore.listOccurrences(10).map((row) => ({ workflowId: row.workflow_id, ownerType: row.owner_type, ruleId: row.rule_id, scheduledFor: row.scheduled_for, actualStart: row.actual_start, executionId: row.execution_id, status: row.status, finishedAt: row.finished_at })) }; }
  return Object.freeze({ executeOccurrence, start, status, stop, tick });
}
module.exports = { DEFAULT_TIMEZONE, createWorkflowScheduler, localParts, occurrenceKey, ruleMatches, scheduleRules };
