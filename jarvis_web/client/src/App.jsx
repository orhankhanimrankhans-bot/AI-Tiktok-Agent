import { useEffect, useRef, useState } from "react";
import "./App.css";
import AdvancedColorPicker from "./AdvancedColorPicker.jsx";
import CommandPipeline from "./CommandPipeline.jsx";
import DataViewer from "./DataViewer.jsx";
import { buildDashboardGraph } from "./dashboardPipeline.js";
import { executePerItem, resolveExpression } from "./expressionResolver.js";
import { ARCHIVE_AFTER_PUBLISH_ERROR, buildArchiveMoveRequest, preservePublishedSource } from "./postPublishArchive.js";
import { assertSafeFacebookConfig, facebookCredentialLabel, sanitizeFacebookConfig } from "./facebookConfig.js";
import { buildFacebookReelRequest, FACEBOOK_OPERATION_PUBLISH_REEL, FACEBOOK_OPERATION_READ, facebookNodeDefaults } from "./facebookReelConfig.js";
import { deleteManualFacebookCredential, facebookConnectionStatus, safeFacebookCredentialError, saveManualFacebookCredential, testManualFacebookCredential } from "./facebookManualCredential.js";
import {
  assignCredentialToNode,
  buildDriveSearchRequest,
  googleCredentialLabel,
  selectOAuthCredential,
} from "./googleCredentialState.js";
import {
  applyManualNodeResult,
  createStructuredExecutionError,
  createScheduleManualOutput,
  executeUpstreamLinear,
  executeWithLifecycle,
  upstreamInputError,
} from "./workflowExecution.js";
import { runLinearWorkflow } from "./workflowRunner.js";
import { isStrictlyLinearWorkflow, runFanOutWorkflow } from "./workflowFanOutRunner.js";
import { normalizeSavedWorkflow, workflowForStorage } from "./workflowStorage.js";
import { APPEARANCE_COLOR_SECTIONS, CANVAS_APPEARANCE_KEY, DEFAULT_APPEARANCE, THEME_PRESETS, appearanceCssVariables, canvasBackground,
  clampCanvasZoom, connectionMidpoint, connectionPath, connectionVisualState, fitCanvasViewport, insertNodeBetween, moveNodeFromPointer,
  nodeBorderVisualState, nodeConnectionHealth, readableForeground, safeAppearance, visualNodeStatus, workflowNodeSubtitle } from "./workflowCanvas.js";
import { buildPrepareContentRequest, mergePreparedContent, PREPARE_CONTENT_TONES, prepareContentDefaults } from "./prepareContentConfig.js";

const WORKFLOW_STORAGE_KEY = "jarvis_workflow_v2";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");

function loadCanvasAppearance() {
  try { return safeAppearance(JSON.parse(localStorage.getItem(CANVAS_APPEARANCE_KEY) || "{}")); } catch { return safeAppearance(); }
}

function AppearanceColorField({ label, value, onOpen, onReset }) {
  return <div className="appearance-color-field"><span>{label}</span><div><button type="button" className="appearance-color-swatch" style={{ background: value }}
    onClick={onOpen} aria-label={`Edit ${label}`} /><code>{value.toUpperCase()}</code><button type="button" className="appearance-property-reset" onClick={onReset}>Reset</button></div></div>;
}

function GoogleDriveIcon({ className = "" }) {
  return (
    <span className={`google-drive-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 42" focusable="false">
        <path d="M17 2h14l15 26H32z" fill="#54c782" />
        <path d="M17 2 2 28l7 12 15-26z" fill="#f7c948" />
        <path d="M9 40h30l7-12H16z" fill="#4aa3ff" />
      </svg>
    </span>
  );
}

function FacebookIcon({ className = "" }) {
  return (
    <span className={`facebook-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <circle cx="16" cy="16" r="15" fill="#1877f2" />
        <path d="M18.2 27V17.2h3.3l.5-3.8h-3.8V11c0-1.1.3-1.9 1.9-1.9h2V5.7c-.4-.1-1.6-.2-2.9-.2-2.9 0-4.9 1.8-4.9 5v2.8H11v3.8h3.3V27h3.9z" fill="#fff" />
      </svg>
    </span>
  );
}

function NodeProviderIcon({ node }) {
  if (node.provider === "Google Drive") return <GoogleDriveIcon />;
  if (node.provider === "Facebook") return <FacebookIcon />;
  if (node.name === "Schedule Trigger") return <span className="trigger-mark" aria-hidden="true">
    <svg viewBox="0 0 32 32" focusable="false">
      <circle className="trigger-clock-face" cx="16" cy="16" r="10.5" />
      <path className="trigger-clock-hand" d="M16 9.5v7l4.5 2.8" />
      <path className="trigger-clock-accent" d="M7.2 7.7A13 13 0 0 1 26.8 9M7.2 7.7H12M7.2 7.7v4.8" />
    </svg>
  </span>;
  if (node.name === "Prepare Content") return <span className="ai-mark" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false">
    <path d="M16 4.5 19 10l6 .8-4.4 4.3 1 6.1-5.6-2.9-5.6 2.9 1-6.1L7 10.8l6-.8L16 4.5Z" />
    <circle cx="16" cy="16" r="3.2" /><path d="M16 1.8v3M16 27.2v3M1.8 16h3M27.2 16h3" />
  </svg></span>;
  if (node.name === "Limit") return <span className="limit-mark" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false">
    <path d="M7 9h18M7 16h13M7 23h8" /><circle cx="25" cy="16" r="2.2" /><circle cx="18" cy="23" r="2.2" />
  </svg></span>;
  return node.icon;
}

const NODE_LIBRARY = [
  {
    id: "schedule-trigger",
    provider: "Jarvis",
    name: "Schedule Trigger",
    description: "Start a workflow automatically on a schedule",
    type: "TRIGGER",
    icon: "◷",
  },
  {
    id: "prepare-content",
    provider: "Jarvis AI",
    name: "Prepare Content",
    description: "Use OpenAI to Generate Content: title, caption, and hashtags from previous item metadata",
    type: "ACTION",
    icon: "AI",
  },
  {
    id: "facebook-graph-api",
    provider: "Facebook",
    name: "Facebook Graph API",
    description: "Interact with Facebook through the Meta Graph API",
    type: "ACTION",
    icon: "f",
  },
  {
    id: "facebook-page-post",
    provider: "Facebook",
    name: "Create Page Post",
    description: "Publish content to a connected Facebook Page",
    type: "ACTION",
    icon: "f",
  },
  {
    id: "facebook-page-video",
    provider: "Facebook",
    name: "Upload Page Video",
    description: "Upload supported video content to a Facebook Page",
    type: "ACTION",
    icon: "f",
  },
  ...[
    ["facebook-page-info", "Get Page Information"],
    ["facebook-page-posts", "Get Page Posts"],
    ["facebook-delete-post", "Delete Page Post"],
    ["facebook-comments", "Get Comments"],
    ["facebook-reply-comment", "Reply to Comment"],
    ["facebook-reactions", "Get Reactions"],
    ["facebook-trigger", "Facebook Trigger", "TRIGGER"],
    ["facebook-lead-ads-trigger", "Facebook Lead Ads Trigger", "TRIGGER"],
  ].map(([id, name, type = "ACTION"]) => ({ id, provider: "Facebook", name, description: `${name} through the Jarvis Meta integration`, type, icon: "f" })),
  {
    id: "google-search",
    provider: "Google Drive",
    name: "Search Files and Folders",
    description: "Search files and folders in Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-download",
    provider: "Google Drive",
    name: "Download File",
    description: "Download a file from Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-delete",
    provider: "Google Drive",
    name: "Delete File",
    description: "Delete the selected file from Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-copy",
    provider: "Google Drive",
    name: "Copy File",
    description: "Copy a file in Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-create-text",
    provider: "Google Drive",
    name: "Create File from Text",
    description: "Create a new Google Drive file from text",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-move",
    provider: "Google Drive",
    name: "Move File",
    description: "Move a file to another folder in Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-share-file",
    provider: "Google Drive",
    name: "Share File",
    description: "Share a Google Drive file",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-update",
    provider: "Google Drive",
    name: "Update File",
    description: "Update a Google Drive file",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-upload",
    provider: "Google Drive",
    name: "Upload File",
    description: "Upload a file to Google Drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-create-folder",
    provider: "Google Drive",
    name: "Create Folder",
    description: "Create a new Google Drive folder",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-delete-folder",
    provider: "Google Drive",
    name: "Delete Folder",
    description: "Delete a Google Drive folder",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-share-folder",
    provider: "Google Drive",
    name: "Share Folder",
    description: "Share a Google Drive folder",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-create-shared-drive",
    provider: "Google Drive",
    name: "Create Shared Drive",
    description: "Create a shared drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-delete-shared-drive",
    provider: "Google Drive",
    name: "Delete Shared Drive",
    description: "Delete a shared drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-get-shared-drive",
    provider: "Google Drive",
    name: "Get Shared Drive",
    description: "Get a shared drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-get-many-shared-drives",
    provider: "Google Drive",
    name: "Get Many Shared Drives",
    description: "List shared drives",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "google-update-shared-drive",
    provider: "Google Drive",
    name: "Update Shared Drive",
    description: "Update a shared drive",
    type: "ACTION",
    icon: "△",
  },
  {
    id: "limit",
    provider: "Logic",
    name: "Limit",
    description: "Pass only the first number of items you choose",
    type: "ACTION",
    icon: "1",
  },
  {
    id: "google-drive-trigger",
    provider: "Google Drive",
    name: "Google Drive Trigger",
    description: "Start when Google Drive activity is detected",
    type: "TRIGGER",
    icon: "Drive",
  },
  {
    id: "google-drive-file-trigger",
    provider: "Google Drive",
    name: "Google Drive File Trigger",
    description: "Start when a Google Drive file changes",
    type: "TRIGGER",
    icon: "Drive",
  },
];

const createRule = (index) => ({
  id: Date.now() + index,
  interval: "Days",
  seconds: 30,
  minutes: 5,
  hours: 1,
  days: 1,
  weeks: 1,
  months: 1,
  minute: 0,
  hour: "Midnight",
  weekday: "Monday",
  monthDay: 1,
  cron: "0 0 * * *",
  expanded: index === 0,
});

function ScheduleTriggerEditor({
  node,
  onClose,
  onExecuteNode,
  onSaveNode,
}) {
  const [activeTab, setActiveTab] = useState("Parameters");
  const [outputTab, setOutputTab] = useState("Schema");

 const [rules, setRules] = useState(
  node.config?.rules ?? [
    createRule(0),
    createRule(1),
  ]
);
  const [output, setOutput] = useState(node.output ?? null);
  const [isExecuting, setIsExecuting] = useState(false);

const [settings, setSettings] = useState(
  node.config?.settings ?? {
    alwaysOutput: false,
    executeOnce: false,
    retryOnFail: false,
    onError: "Stop Workflow",
    notes: "",
    displayNote: false,
  }
);

  const updateRule = (id, key, value) => {
    setRules((current) =>
      current.map((rule) =>
        rule.id === id ? { ...rule, [key]: value } : rule
      )
    );
  };

  const toggleRule = (id) => {
    setRules((current) =>
      current.map((rule) =>
        rule.id === id
          ? { ...rule, expanded: !rule.expanded }
          : rule
      )
    );
  };

  const addRule = () => {
    setRules((current) => [
      ...current,
      createRule(current.length),
    ]);
  };

  const deleteRule = (id) => {
    setRules((current) =>
      current.filter((rule) => rule.id !== id)
    );
  };

  const executeTrigger = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    const config = { ...node.config, rules, settings };
    const updatedNode = await onExecuteNode({ ...node, config }, null, { triggerMode: "manual" });
    setOutput(updatedNode.output);
    onSaveNode(updatedNode);
    setIsExecuting(false);
  };
const saveAndClose = () => {
  onSaveNode({
    ...node,
    config: {
      ...node.config,
      rules,
      settings,
    },
  });

  onClose();
};
  return (
    <div className="node-editor-overlay">
      <div className="node-editor-window">

        <header className="node-editor-header">
          <div className="node-editor-title">
            <div className="schedule-title-icon">◷</div>
            <strong>Schedule Trigger</strong>
          </div>

          <div className="node-editor-header-actions">
            <button>Docs ↗</button>

            <button
              className="node-editor-close"
             onClick={saveAndClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="node-editor-body">

          <section className="node-config-panel">

            <div className="node-editor-tabs">
              <button
                className={
                  activeTab === "Parameters"
                    ? "node-tab-active"
                    : ""
                }
                onClick={() => setActiveTab("Parameters")}
              >
                Parameters
              </button>

              <button
                className={
                  activeTab === "Settings"
                    ? "node-tab-active"
                    : ""
                }
                onClick={() => setActiveTab("Settings")}
              >
                Settings
              </button>

              <button
                className="execute-step"
                onClick={executeTrigger}
              >
                ♙ Execute step
              </button>
            </div>

            <div className="node-config-scroll">

              {activeTab === "Parameters" && (
                <>
                  <div className="schedule-info">
                    This workflow will run on the schedule you
                    define here once it is published.
                    <br />
                    For testing, you can also trigger it
                    manually using Execute Workflow.
                  </div>

                  <div className="trigger-rules-title">
                    <strong>Trigger Rules</strong>

                    <button onClick={addRule}>＋</button>
                  </div>

                  {rules.map((rule, index) => (
                    <div
                      className="trigger-rule-card"
                      key={rule.id}
                    >

                      <div className="trigger-rule-header">
                        <button
                          className="rule-expand"
                          onClick={() => toggleRule(rule.id)}
                        >
                          {rule.expanded ? "⌄" : "›"}
                        </button>

                        <strong>
                          Trigger Interval {index + 1}
                        </strong>

                        <button
                          className="rule-delete"
                          onClick={() =>
                            deleteRule(rule.id)
                          }
                        >
                          ♲
                        </button>
                      </div>

                      {rule.expanded && (
                        <div className="trigger-rule-content">

                          <label>Trigger Interval</label>

                          <select
                            value={rule.interval}
                            onChange={(e) =>
                              updateRule(
                                rule.id,
                                "interval",
                                e.target.value
                              )
                            }
                          >
                            <option>Seconds</option>
                            <option>Minutes</option>
                            <option>Hours</option>
                            <option>Days</option>
                            <option>Weeks</option>
                            <option>Months</option>
                            <option>Custom (Cron)</option>
                          </select>

                          {rule.interval === "Seconds" && (
                            <>
                              <label>
                                Seconds Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                max="59"
                                value={rule.seconds}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "seconds",
                                    e.target.value
                                  )
                                }
                              />

                              <small>
                                Must be in range 1–59
                              </small>
                            </>
                          )}

                          {rule.interval === "Minutes" && (
                            <>
                              <label>
                                Minutes Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                max="59"
                                value={rule.minutes}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "minutes",
                                    e.target.value
                                  )
                                }
                              />

                              <small>
                                Must be in range 1–59
                              </small>
                            </>
                          )}

                          {rule.interval === "Hours" && (
                            <>
                              <label>
                                Hours Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                value={rule.hours}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "hours",
                                    e.target.value
                                  )
                                }
                              />

                              <label>
                                Trigger at Minute
                              </label>

                              <input
                                type="number"
                                min="0"
                                max="59"
                                value={rule.minute}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "minute",
                                    e.target.value
                                  )
                                }
                              />
                            </>
                          )}

                          {rule.interval === "Days" && (
                            <>
                              <label>
                                Days Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                max="31"
                                value={rule.days}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "days",
                                    e.target.value
                                  )
                                }
                              />

                              <small>
                                Must be in range 1–31
                              </small>

                              <label>
                                Trigger at Hour
                              </label>

                              <select
                                value={rule.hour}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "hour",
                                    e.target.value
                                  )
                                }
                              >
                                <option>Midnight</option>
                                <option>1am</option>
                                <option>2am</option>
                                <option>3am</option>
                                <option>4am</option>
                                <option>5am</option>
                                <option>6am</option>
                                <option>7am</option>
                                <option>8am</option>
                                <option>9am</option>
                                <option>10am</option>
                                <option>11am</option>
                                <option>Noon</option>
                                <option>1pm</option>
                                <option>2pm</option>
                                <option>3pm</option>
                                <option>4pm</option>
                                <option>5pm</option>
                                <option>6pm</option>
                                <option>7pm</option>
                                <option>8pm</option>
                                <option>9pm</option>
                                <option>10pm</option>
                                <option>11pm</option>
                              </select>

                              <label>
                                Trigger at Minute
                              </label>

                              <input
                                type="number"
                                min="0"
                                max="59"
                                value={rule.minute}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "minute",
                                    e.target.value
                                  )
                                }
                              />
                            </>
                          )}

                          {rule.interval === "Weeks" && (
                            <>
                              <label>
                                Weeks Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                value={rule.weeks}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "weeks",
                                    e.target.value
                                  )
                                }
                              />

                              <label>Trigger On</label>

                              <select
                                value={rule.weekday}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "weekday",
                                    e.target.value
                                  )
                                }
                              >
                                <option>Monday</option>
                                <option>Tuesday</option>
                                <option>Wednesday</option>
                                <option>Thursday</option>
                                <option>Friday</option>
                                <option>Saturday</option>
                                <option>Sunday</option>
                              </select>

                              <label>
                                Trigger at Hour
                              </label>

                              <select
                                value={rule.hour}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "hour",
                                    e.target.value
                                  )
                                }
                              >
                                <option>Midnight</option>
                                <option>1am</option>
                                <option>2am</option>
                                <option>3am</option>
                                <option>4am</option>
                                <option>5am</option>
                                <option>6am</option>
                                <option>7am</option>
                                <option>8am</option>
                                <option>9am</option>
                                <option>10am</option>
                                <option>11am</option>
                                <option>Noon</option>
                                <option>1pm</option>
                                <option>2pm</option>
                                <option>3pm</option>
                                <option>4pm</option>
                                <option>5pm</option>
                                <option>6pm</option>
                                <option>7pm</option>
                                <option>8pm</option>
                                <option>9pm</option>
                                <option>10pm</option>
                                <option>11pm</option>
                              </select>
                            </>
                          )}

                          {rule.interval === "Months" && (
                            <>
                              <label>
                                Months Between Triggers
                              </label>

                              <input
                                type="number"
                                min="1"
                                max="12"
                                value={rule.months}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "months",
                                    e.target.value
                                  )
                                }
                              />

                              <label>Day of Month</label>

                              <input
                                type="number"
                                min="1"
                                max="31"
                                value={rule.monthDay}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "monthDay",
                                    e.target.value
                                  )
                                }
                              />

                              <label>
                                Trigger at Hour
                              </label>

                              <select
                                value={rule.hour}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "hour",
                                    e.target.value
                                  )
                                }
                              >
                                <option>Midnight</option>
                                <option>6am</option>
                                <option>Noon</option>
                                <option>6pm</option>
                              </select>
                            </>
                          )}

                          {rule.interval === "Custom (Cron)" && (
                            <>
                              <label>Cron Expression</label>

                              <input
                                value={rule.cron}
                                onChange={(e) =>
                                  updateRule(
                                    rule.id,
                                    "cron",
                                    e.target.value
                                  )
                                }
                                placeholder="0 0 * * *"
                              />

                              <small>
                                Standard cron format
                              </small>
                            </>
                          )}

                        </div>
                      )}

                    </div>
                  ))}

                  <button
                    className="add-rule-button"
                    onClick={addRule}
                  >
                    ＋ Add Rule
                  </button>
                </>
              )}

              {activeTab === "Settings" && (
                <div className="schedule-settings">

                  <ToggleSetting
                    label="Always Output Data"
                    value={settings.alwaysOutput}
                    onChange={() =>
                      setSettings({
                        ...settings,
                        alwaysOutput:
                          !settings.alwaysOutput,
                      })
                    }
                  />

                  <ToggleSetting
                    label="Execute Once"
                    value={settings.executeOnce}
                    onChange={() =>
                      setSettings({
                        ...settings,
                        executeOnce:
                          !settings.executeOnce,
                      })
                    }
                  />

                  <ToggleSetting
                    label="Retry On Fail"
                    value={settings.retryOnFail}
                    onChange={() =>
                      setSettings({
                        ...settings,
                        retryOnFail:
                          !settings.retryOnFail,
                      })
                    }
                  />

                  <label>On Error</label>

                  <select
                    value={settings.onError}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        onError: e.target.value,
                      })
                    }
                  >
                    <option>Stop Workflow</option>
                    <option>Continue Workflow</option>
                  </select>

                  <label>Notes</label>

                  <textarea
                    rows="6"
                    value={settings.notes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notes: e.target.value,
                      })
                    }
                  />

                  <ToggleSetting
                    label="Display Note in Flow?"
                    value={settings.displayNote}
                    onChange={() =>
                      setSettings({
                        ...settings,
                        displayNote:
                          !settings.displayNote,
                      })
                    }
                  />

                  <div className="node-version">
                    Schedule Trigger node version 1.0
                  </div>
                </div>
              )}

            </div>
          </section>

          <section className="node-output-panel">

            <div className="output-header">
              <strong>OUTPUT</strong>

              <div className="output-tabs">
                {["Schema", "Table", "JSON"].map(
                  (tab) => (
                    <button
                      key={tab}
                      className={
                        outputTab === tab
                          ? "output-tab-active"
                          : ""
                      }
                      onClick={() =>
                        setOutputTab(tab)
                      }
                    >
                      {tab}
                    </button>
                  )
                )}
              </div>
            </div>

            {!output ? (
              <div className="empty-output">
                <div className="output-bolt">ϟ</div>

                <h3>No trigger output</h3>

                <button onClick={executeTrigger} disabled={isExecuting}>
                  {isExecuting ? "Testing..." : "Test this trigger"}
                </button>

                <div>
                  or{" "}
                  <button className="mock-link">
                    set mock data
                  </button>
                </div>
              </div>
            ) : (
              <OutputViewer
                output={output}
                tab={outputTab}
              />
            )}

          </section>

        </div>
      </div>
    </div>
  );
}



function GoogleDriveProviderBrowser({
  onBack,
  onSelectAction,
}) {
  const [actionSearch, setActionSearch] = useState("");

  const groups = [
    {
      title: "FILE ACTIONS",
      items: [
        ["google-copy", "Copy File"],
        ["google-create-text", "Create File from Text"],
        ["google-delete", "Delete File"],
        ["google-download", "Download File"],
        ["google-move", "Move File"],
        ["google-share-file", "Share File"],
        ["google-update", "Update File"],
        ["google-upload", "Upload File"],
      ],
    },
    {
      title: "FILE/FOLDER ACTIONS",
      items: [["google-search", "Search Files and Folders"]],
    },
    {
      title: "FOLDER ACTIONS",
      items: [
        ["google-create-folder", "Create Folder"],
        ["google-delete-folder", "Delete Folder"],
        ["google-share-folder", "Share Folder"],
      ],
    },
    {
      title: "SHARED DRIVE ACTIONS",
      items: [
        ["google-create-shared-drive", "Create Shared Drive"],
        ["google-delete-shared-drive", "Delete Shared Drive"],
        ["google-get-shared-drive", "Get Shared Drive"],
        ["google-get-many-shared-drives", "Get Many Shared Drives"],
        ["google-update-shared-drive", "Update Shared Drive"],
      ],
    },
    {
      title: "TRIGGERS",
      items: [
        ["google-drive-trigger", "Google Drive Trigger"],
        ["google-drive-file-trigger", "Google Drive File Trigger"],
      ],
    },
  ];

  const q = actionSearch.trim().toLowerCase();

  return (
    <div className="provider-browser">
      <div className="provider-browser-header">
        <button className="provider-back" onClick={onBack}>←</button>
        <GoogleDriveIcon className="drive-provider-logo" />
        <h2>Google Drive</h2>
      </div>

      <div className="provider-action-search">
        <span>⌕</span>
        <input
          autoFocus
          value={actionSearch}
          onChange={(e) => setActionSearch(e.target.value)}
          placeholder="Search Google Drive Actions..."
        />
      </div>

      <div className="provider-action-scroll">
        {groups.map((group) => {
          const filtered = group.items.filter(([, label]) =>
            label.toLowerCase().includes(q)
          );

          if (!filtered.length) return null;

          return (
            <div className="provider-action-group" key={group.title}>
              <div className="provider-action-group-title">
                {group.title}
              </div>

              {filtered.map(([id, label]) => (
                <button
                  className="provider-action-item"
                  key={id}
                  onClick={() => onSelectAction(id)}
                >
                  <GoogleDriveIcon className="drive-mini-logo" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          );
        })}

      </div>
    </div>
  );
}

function FacebookProviderBrowser({ onBack, onSelectAction }) {
  const [actionSearch, setActionSearch] = useState("");
  const groups = [
    { title: "GRAPH API", items: [["facebook-graph-api", "Facebook Graph API"]] },
    { title: "PAGE ACTIONS", items: [["facebook-page-post", "Create Page Post"], ["facebook-page-video", "Upload Page Video"], ["facebook-page-info", "Get Page Information"], ["facebook-page-posts", "Get Page Posts"], ["facebook-delete-post", "Delete Page Post"]] },
    { title: "ENGAGEMENT", items: [["facebook-comments", "Get Comments"], ["facebook-reply-comment", "Reply to Comment"], ["facebook-reactions", "Get Reactions"]] },
    { title: "TRIGGERS", items: [["facebook-trigger", "Facebook Trigger"], ["facebook-lead-ads-trigger", "Facebook Lead Ads Trigger"]] },
  ];
  const query = actionSearch.trim().toLowerCase();

  return (
    <div className="provider-browser">
      <div className="provider-browser-header facebook-provider-header"><button className="provider-back" onClick={onBack}>←</button><FacebookIcon className="facebook-provider-logo" /><h2>Facebook</h2></div>
      <div className="provider-action-search"><span>⌕</span><input autoFocus value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} placeholder="Search Facebook Actions..." /></div>
      <div className="provider-action-scroll">
        {groups.map((group) => {
          const items = group.items.filter(([, label]) => label.toLowerCase().includes(query));
          return items.length ? <div className="provider-action-group" key={group.title}><div className="provider-action-group-title">{group.title}</div>{items.map(([id, label]) => <button className="provider-action-item" key={id} onClick={() => onSelectAction(id)}><FacebookIcon className="facebook-mini-logo" /><span>{label}</span></button>)}</div> : null;
        })}
      </div>
    </div>
  );
}

function GoogleCredentialModal({
  onClose,
  onSave,
  onDelete,
  onNotify,
  onStartOAuth,
  onDisconnect,
  credential,
}) {
  const [credentialName, setCredentialName] = useState(
    credential?.name ?? "Google Drive account"
  );
  const [activeTab, setActiveTab] = useState("Connection");
  const [authMode, setAuthMode] = useState(credential?.authMode ?? "managed_oauth2");
  const [allowedDomains, setAllowedDomains] = useState(credential?.allowedDomains ?? "none");
  const [visibility, setVisibility] = useState(credential?.visibility ?? "private");
  const [status, setStatus] = useState(credential?.status ?? "not_connected");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setStatus(credential?.status ?? "not_connected");
  }, [credential?.status]);


  const saveCredential = () => {
    if (!credential?.id) {
      onNotify("Connect a Google account before saving this credential");
      return;
    }
    const now = new Date().toISOString();
    onSave({ ...credential, id: credential.id, name: credentialName.trim() || credential.accountEmail || "Google Drive account", authMode, allowedDomains, visibility, updatedAt: now });
  };

  const disconnectCredential = async () => {
    if (!credential?.id) return;
    setConnectionMessage("Disconnecting Google Drive...");

    try {
      await onDisconnect(credential.id);
      setStatus("not_connected");
      setConnectionMessage("Google Drive credential disconnected.");
      onNotify("Google Drive credential disconnected");
      onClose();
    } catch (error) {
      setConnectionMessage(error?.message || "Could not disconnect Google Drive.");
    }
  };

  return (
    <div className="credential-modal-overlay">
      <div className="credential-modal">
        <header className="credential-modal-header">
          <div className="credential-modal-title">
            <GoogleDriveIcon className="drive-provider-logo" />
            <div>
              <input
                className="credential-name-input"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
              />
              <div className="credential-subtitle">
                Google Drive OAuth2 API
              </div>
            </div>
          </div>

          <div className="credential-modal-actions">
            <button type="button" onClick={saveCredential}>Save</button>
            {credential?.id && <button type="button" className="credential-delete-button" onClick={() => setShowDeleteConfirmation(true)} aria-label="Delete credential" title="Delete credential">⌫</button>}
            <button type="button" onClick={onClose} aria-label="Close credential modal">×</button>
          </div>
        </header>

        <div className="credential-modal-body">
          <aside className="credential-tabs">
            {["Connection", "Sharing", "Details"].map((tab) => (
              <button type="button" key={tab} className={activeTab === tab ? "credential-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
          </aside>

          <section className="credential-content google-credential-content">
            {activeTab === "Connection" && <><div className="credential-content-top">
              <h3>Setup credential</h3>
              <select value={authMode} onChange={(event) => setAuthMode(event.target.value)}>
                <option value="managed_oauth2">Managed OAuth2 (recommended)</option>
              </select>
            </div>

            {status === "connected" ? <div className="credential-connected"><span>✓</span><strong>Account connected{credential?.accountEmail ? ` · ${credential.accountEmail}` : ""}</strong><div><button type="button" onClick={() => onStartOAuth(credential.id)}>Reconnect</button><button type="button" className="disconnect-button" onClick={disconnectCredential}>Disconnect</button></div></div> : <div className="credential-warning"><span>⚠</span><span>Connect your account to use this credential</span><button type="button" onClick={() => onStartOAuth(null)}>Sign in with Google</button></div>}
            {connectionMessage && <div className="credential-backend-status" role="status">{connectionMessage}</div>}

            <label htmlFor="google-allowed-domains">Allowed HTTP Request Domains</label>
            <select id="google-allowed-domains" value={allowedDomains} onChange={(event) => setAllowedDomains(event.target.value)}>
              <option value="none">None</option>
              <option value="google_only">Google APIs only</option>
              <option value="all">All</option>
            </select>

            <div className="credential-note">
              OAuth tokens are stored on the Jarvis backend, not in this browser.
            </div>
            </>}
            {activeTab === "Sharing" && <div className="credential-metadata-panel"><h3>Credential visibility</h3><label htmlFor="google-credential-visibility">Visibility</label><select id="google-credential-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Private</option><option value="shared">Shared</option></select><p>Private credentials are available only to this Jarvis workspace. Sharing is metadata only until backend permissions are configured.</p></div>}
            {activeTab === "Details" && <div className="credential-metadata-panel"><h3>Credential details</h3><dl><div><dt>Credential ID/reference</dt><dd>{credential?.id ?? "Created after Google sign-in"}</dd></div><div><dt>Provider</dt><dd>Google Drive</dd></div><div><dt>Credential type</dt><dd>OAuth2</dd></div><div><dt>Status</dt><dd>{status}</dd></div><div><dt>Created</dt><dd>{credential?.createdAt ?? "Created after Google sign-in"}</dd></div><div><dt>Updated</dt><dd>{credential?.updatedAt ?? "Not saved yet"}</dd></div></dl></div>}
          </section>
        </div>
        {showDeleteConfirmation && <div className="credential-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-credential-title"><div className="credential-confirm-modal"><h3 id="delete-credential-title">Delete credential?</h3><p>Delete "{credentialName.trim() || "Google Drive account"}"?</p><div><button type="button" onClick={() => setShowDeleteConfirmation(false)}>Cancel</button><button type="button" className="confirm-delete" onClick={() => onDelete(credential.id)}>Delete</button></div></div></div>}
      </div>
    </div>
  );
}

function FacebookCredentialModal({ onClose, credential, onStartOAuth, onDisconnect, onTestAccessToken, onSaveAccessToken, onDeleteAccessToken }) {
  const [credentialName, setCredentialName] = useState(credential?.name ?? (credential ? facebookCredentialLabel(credential) : "Facebook Graph account"));
  const [authMode, setAuthMode] = useState(credential?.authMode === "manual_access_token" ? "manual_access_token" : "managed_oauth2");
  const [accessToken, setAccessToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [connectionState, setConnectionState] = useState(credential?.connectionStatus ?? "not_tested");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const isManual = authMode === "manual_access_token";
  const isExistingManual = credential?.authMode === "manual_access_token";

  const testAccessToken = async () => {
    setConnectionState("testing");
    setConnectionMessage("");
    try {
      await onTestAccessToken({ name: credentialName.trim(), accessToken });
      setConnectionState("success");
    } catch (error) {
      setConnectionState("failed");
      setConnectionMessage(safeFacebookCredentialError(error));
    }
  };

  const saveAccessToken = async () => {
    setConnectionMessage("");
    try {
      await onSaveAccessToken({ credentialId: credential?.id ?? null, name: credentialName.trim(), accessToken });
      setAccessToken("");
      onClose();
    } catch (error) {
      setConnectionState("failed");
      setConnectionMessage(safeFacebookCredentialError(error));
    }
  };

  const deleteAccessToken = async () => {
    if (!credential?.id) return;
    try {
      await onDeleteAccessToken(credential.id);
      onClose();
    } catch (error) {
      setShowDeleteConfirmation(false);
      setConnectionState("failed");
      setConnectionMessage(safeFacebookCredentialError(error));
    }
  };

  const disconnect = async () => {
    if (!credential?.id) return;
    try { setConnectionMessage("Disconnecting Meta account..."); await onDisconnect(credential.id); onClose(); }
    catch (error) { setConnectionMessage(error?.message || "Could not disconnect Meta account."); }
  };

  return (
    <div className="credential-modal-overlay">
      <div className="credential-modal">
        <header className="credential-modal-header">
          <div className="credential-modal-title"><FacebookIcon className="facebook-provider-logo" /><div><input aria-label="Credential name" className="credential-name-input" value={credentialName} onChange={(event) => setCredentialName(event.target.value)} /><div className="credential-subtitle">Facebook Graph API credential</div></div></div>
          <div className="credential-modal-actions">{isManual && <button type="button" onClick={saveAccessToken} disabled={!isExistingManual && !accessToken.trim()}>Save</button>}{isExistingManual && <button type="button" className="credential-delete-button" onClick={() => setShowDeleteConfirmation(true)} aria-label="Delete credential" title="Delete credential">⌫</button>}<button type="button" onClick={onClose} aria-label="Close credential modal">×</button></div>
        </header>
        <div className="credential-modal-body">
          <aside className="credential-tabs"><button type="button" className="credential-tab-active">Connection</button><button type="button">Sharing</button><button type="button">Details</button></aside>
          <section className="credential-content">
            <div className="credential-content-top"><h3>Setup credential</h3><select aria-label="Authentication type" value={authMode} onChange={(event) => { setAuthMode(event.target.value); setAccessToken(""); setConnectionState("not_tested"); setConnectionMessage(""); }} disabled={Boolean(credential)}><option value="managed_oauth2">Managed Meta OAuth2</option><option value="manual_access_token">Access Token</option></select></div>
            {!isManual && <>{credential ? <div className="credential-connected"><span>✓</span><strong>Account connected · {credential.accountName || credential.accountId}</strong><div><button type="button" onClick={() => onStartOAuth(credential.id)}>Reconnect</button><button type="button" className="disconnect-button" onClick={disconnect}>Disconnect</button></div></div> : <div className="meta-connection-state"><span className="meta-status-dot" /> <strong>Not connected</strong><button type="button" onClick={() => onStartOAuth(null)}>Connect Meta Account</button></div>}<p>Meta OAuth tokens and Page tokens are encrypted and stored only by the Jarvis backend.</p>{connectionMessage && <div className="credential-backend-status" role="status">{connectionMessage}</div>}</>}
            {isManual && <div className="facebook-token-credential">
              <label htmlFor="facebook-access-token">Access Token</label>
              <div className="secret-input-row"><input id="facebook-access-token" type={showToken ? "text" : "password"} autoComplete="off" value={accessToken} onChange={(event) => { setAccessToken(event.target.value); setConnectionState("not_tested"); setConnectionMessage(""); }} placeholder={isExistingManual ? "Enter a new token to replace the saved token" : "Enter a Facebook Graph API access token"} /><button type="button" onClick={() => setShowToken((visible) => !visible)} aria-label={showToken ? "Hide access token" : "Show access token"}>{showToken ? "Hide" : "Show"}</button></div>
              {isExistingManual && <p className="credential-note">Access token securely stored. The saved token is never sent back to this browser. Enter a new token only to replace it.</p>}
              <div className={`facebook-test-status status-${connectionState}`} role="status" aria-live="polite"><strong>{facebookConnectionStatus(connectionState)}</strong>{connectionState === "failed" && connectionMessage && <span>{connectionMessage}</span>}</div>
              <div className="facebook-token-actions"><button type="button" onClick={testAccessToken} disabled={!accessToken.trim() || connectionState === "testing"}>Test Connection</button></div>
              <p className="credential-note">The token remains only in this modal until it is submitted securely to the Jarvis backend.</p>
            </div>}
          </section>
        </div>
        {showDeleteConfirmation && <div className="credential-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-facebook-credential-title"><div className="credential-confirm-modal"><h3 id="delete-facebook-credential-title">Delete credential?</h3><p>Delete "{credentialName.trim() || "Facebook Graph account"}"?</p><div><button type="button" onClick={() => setShowDeleteConfirmation(false)}>Cancel</button><button type="button" className="confirm-delete" onClick={deleteAccessToken}>Delete</button></div></div></div>}
      </div>
    </div>
  );
}

function GoogleDriveSearchEditor({
  node,
  onClose,
  onSaveNode,
  previousNode,
  onExecutePreviousNodes,
  onExecuteNode,
  onCreateCredential,
  credentials,
}) {
  const [activeTab, setActiveTab] = useState("Parameters");
  const [inputTab, setInputTab] = useState("Schema");
  const [outputTab, setOutputTab] = useState("Schema");
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isExecutingPrevious, setIsExecutingPrevious] = useState(false);

  const [config, setConfig] = useState(
    node.config ?? {
      credentialId: "",
      resource: "File/Folder",
      operation: "Search",
      searchMethod: "Search File/Folder Name",
      query: "",
      folderId: "",
      mimeType: "Any",
      returnAll: false,
      limit: 50,
      settings: {
        alwaysOutput: false,
        executeOnce: false,
        retryOnFail: false,
        onError: "Stop Workflow",
        notes: "",
        displayNote: false,
      },
    }
  );

  const updateConfig = (key, value) => {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateSetting = (key, value) => {
    setConfig((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value,
      },
    }));
  };

  const executeStep = async () => {
    if (isExecuting) return;
    try {
      buildDriveSearchRequest(config);
    } catch (error) {
      const validationOutput = { status: "error", message: error.message };
      setOutput(validationOutput);
      onSaveNode({ ...node, config, input, output: validationOutput, status: "error", error: error.message, executionFinishedAt: new Date().toISOString() });
      return;
    }
    setIsExecuting(true);
    const updatedNode = await onExecuteNode({ ...node, config }, input, { triggerMode: "manual" });
    setOutput(updatedNode.output);
    onSaveNode(updatedNode);
    setIsExecuting(false);
  };

  const executePreviousNodes = async () => {
    if (isExecutingPrevious) return;
    setIsExecutingPrevious(true);
    try {
      const previousInput = await onExecutePreviousNodes(node.id);
      setInput(previousInput);
    } catch (error) {
      setInput(upstreamInputError(error));
    } finally {
      setIsExecutingPrevious(false);
    }
  };

  const saveAndClose = () => {
    onSaveNode({
      ...node,
      config,
    });
    onClose();
  };

  return (
    <div className="node-editor-overlay">
      <div className="node-editor-window">
        <header className="node-editor-header">
          <div className="node-editor-title">
            <GoogleDriveIcon className="drive-title-icon" />
            <strong>Search Files and Folders</strong>
          </div>

          <div className="node-editor-header-actions">
            <button>Docs ↗</button>
            <button
              className="node-editor-close"
              onClick={saveAndClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="node-editor-body google-three-column">
          <section className="node-input-panel">
            <div className="input-header">
              <strong>INPUT</strong>
              <div className="input-tabs">
                {["Schema", "Table", "JSON"].map((tab) => (
                  <button key={tab} className={inputTab === tab ? "input-tab-active" : ""} onClick={() => setInputTab(tab)}>{tab}</button>
                ))}
              </div>
            </div>

            <div className="input-source-select">
              <span>{previousNode?.icon ?? "◷"}</span>
              <span>{previousNode?.name ?? "Schedule Trigger"}</span>
              <span>⌄</span>
            </div>

            {!input ? <div className="input-empty-state">
              <div className="input-arrow">→|</div>
              <h3>No input data</h3>
              <button
                onClick={executePreviousNodes}
                disabled={isExecutingPrevious}
              >
                {isExecutingPrevious ? "Executing..." : "Execute previous nodes"}
              </button>
              <div>to view input data</div>
            </div> : <div className="input-data-view"><OutputViewer output={input} tab={inputTab} /></div>}
            <div className="variables-context">Variables and context</div>
          </section>

          <section className="node-config-panel google-config-panel">
            <div className="node-editor-tabs">
              <button
                className={
                  activeTab === "Parameters"
                    ? "node-tab-active"
                    : ""
                }
                onClick={() => setActiveTab("Parameters")}
              >
                Parameters
              </button>

              <button
                className={
                  activeTab === "Settings"
                    ? "node-tab-active"
                    : ""
                }
                onClick={() => setActiveTab("Settings")}
              >
                Settings
              </button>

                <button
                  className="execute-step"
                  onClick={executeStep}
                  disabled={isExecuting}
                >
                  {isExecuting ? "Running..." : "Execute step"}
              </button>
            </div>

            <div className="node-config-scroll">
              {activeTab === "Parameters" && (
                <div className="drive-parameters">
                  <div className="drive-info">
                    Search Google Drive for files or folders.
                    Connect a Google Drive credential before
                    using real execution.
                  </div>

                  <label>Credential</label>
                  <div className="credential-row">
                    <select
                      value={config.credentialId}
                      onChange={(e) => {
                        if (e.target.value === "__create__") {
                          onCreateCredential();
                          return;
                        }

                        updateConfig(
                          "credentialId",
                          e.target.value
                        );
                      }}
                    >
                      <option value="">Select credential</option>
                      {config.credentialId && !credentials.some((credential) => credential.id === config.credentialId) && <option value={config.credentialId}>Credential missing</option>}
                      {credentials.map((credential) => (
                        <option key={credential.id} value={credential.id}>{googleCredentialLabel(credential)}</option>
                      ))}
                      <option value="__create__">
                        + Create new credential
                      </option>
                    </select>

                    <button
                      type="button"
                      className="credential-button"
                      onClick={() => onCreateCredential(config.credentialId || null)}
                      title="Edit credential"
                    >
                      ✎
                    </button>
                  </div>

                  <label>Resource</label>
                  <select
                    value={config.resource}
                    onChange={(e) =>
                      updateConfig(
                        "resource",
                        e.target.value
                      )
                    }
                  >
                    <option>File</option>
                    <option>File/Folder</option>
                    <option>Folder</option>
                    <option>Shared Drive</option>
                    <option>Custom API Call</option>
                  </select>

                  <label>Operation</label>
                  <select
                    value={config.operation}
                    onChange={(e) =>
                      updateConfig(
                        "operation",
                        e.target.value
                      )
                    }
                  >
                    <option>Search</option>
                  </select>

                  <label>Search Method</label>
                  <select
                    value={config.searchMethod}
                    onChange={(e) =>
                      updateConfig(
                        "searchMethod",
                        e.target.value
                      )
                    }
                  >
                    <option>Search File/Folder Name</option>
                    <option>Advanced Search</option>
                  </select>

                  <label>Search Query</label>
                  <input
                    value={config.query}
                    onChange={(e) =>
                      updateConfig(
                        "query",
                        e.target.value
                      )
                    }
                    placeholder="e.g. My File / My Folder"
                  />

                  <label>Folder ID (optional)</label>
                  <input
                    value={config.folderId}
                    onChange={(e) =>
                      updateConfig(
                        "folderId",
                        e.target.value
                      )
                    }
                    placeholder="Leave empty to search broadly"
                  />

                  <label>MIME Type</label>
                  <select
                    value={config.mimeType}
                    onChange={(e) => updateConfig("mimeType", e.target.value)}
                  >
                    <option value="Any">Any</option>
                    <option value="application/pdf">PDF</option>
                    <option value="application/vnd.google-apps.folder">Google Drive folder</option>
                    <option value="application/vnd.google-apps.document">Google Docs document</option>
                    <option value="application/vnd.google-apps.spreadsheet">Google Sheets spreadsheet</option>
                  </select>

                  <ToggleSetting
                    label="Return All"
                    value={config.returnAll}
                    onChange={() =>
                      updateConfig(
                        "returnAll",
                        !config.returnAll
                      )
                    }
                  />

                  {!config.returnAll && (
                    <>
                      <label>Limit</label>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={config.limit}
                        onChange={(e) =>
                          updateConfig(
                            "limit",
                            e.target.value
                          )
                        }
                      />
                    </>
                  )}

                  <div className="config-section-row">
                    <span>Filter</span>
                    <button>＋</button>
                  </div>
                  <button className="config-add-button">
                    ＋ Add Filter
                  </button>

                  <div className="config-section-row">
                    <span>Options</span>
                    <button>＋</button>
                  </div>
                  <button className="config-add-button">
                    ＋ Add option
                  </button>
                </div>
              )}

              {activeTab === "Settings" && (
                <div className="schedule-settings">
                  <ToggleSetting
                    label="Always Output Data"
                    value={
                      config.settings?.alwaysOutput ??
                      false
                    }
                    onChange={() =>
                      updateSetting(
                        "alwaysOutput",
                        !config.settings?.alwaysOutput
                      )
                    }
                  />

                  <ToggleSetting
                    label="Execute Once"
                    value={
                      config.settings?.executeOnce ??
                      false
                    }
                    onChange={() =>
                      updateSetting(
                        "executeOnce",
                        !config.settings?.executeOnce
                      )
                    }
                  />

                  <ToggleSetting
                    label="Retry On Fail"
                    value={
                      config.settings?.retryOnFail ??
                      false
                    }
                    onChange={() =>
                      updateSetting(
                        "retryOnFail",
                        !config.settings?.retryOnFail
                      )
                    }
                  />

                  <label>On Error</label>
                  <select
                    value={
                      config.settings?.onError ??
                      "Stop Workflow"
                    }
                    onChange={(e) =>
                      updateSetting(
                        "onError",
                        e.target.value
                      )
                    }
                  >
                    <option>Stop Workflow</option>
                    <option>Continue Workflow</option>
                  </select>

                  <label>Notes</label>
                  <textarea
                    rows="6"
                    value={
                      config.settings?.notes ?? ""
                    }
                    onChange={(e) =>
                      updateSetting(
                        "notes",
                        e.target.value
                      )
                    }
                  />

                  <ToggleSetting
                    label="Display Note in Flow?"
                    value={
                      config.settings?.displayNote ??
                      false
                    }
                    onChange={() =>
                      updateSetting(
                        "displayNote",
                        !config.settings?.displayNote
                      )
                    }
                  />

                  <div className="node-version">
                    Google Drive Search node version 1.0
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="node-output-panel">
            <div className="output-header">
              <strong>OUTPUT</strong>

              <div className="output-tabs">
                {["Schema", "Table", "JSON"].map(
                  (tab) => (
                    <button
                      key={tab}
                      className={
                        outputTab === tab
                          ? "output-tab-active"
                          : ""
                      }
                      onClick={() =>
                        setOutputTab(tab)
                      }
                    >
                      {tab}
                    </button>
                  )
                )}
              </div>
            </div>

            {!output ? (
              <div className="empty-output">
                <div className="output-bolt">→|</div>
                <h3>No output data</h3>
                <button onClick={executeStep}>
                  Execute step
                </button>
                <div className="output-help">
                  Configure a Google Drive credential for
                  real search results.
                </div>
                <button className="mock-data-action" type="button" onClick={() => setOutput({ status: "mock", message: "Mock data mode is ready. No Google Drive results were generated." })}>set mock data</button>
              </div>
            ) : (
              <OutputViewer
                output={output}
                tab={outputTab}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const defaultNodeSettings = () => ({
  alwaysOutput: false,
  executeOnce: false,
  retryOnFail: false,
  onError: "Stop Workflow",
  notes: "",
  displayNote: false,
});

function createPhase2Config(nodeId) {
  if (nodeId === "limit") return { maxItems: 1, keep: "First Items", settings: defaultNodeSettings() };
  if (nodeId === "google-download") return { credentialId: "", resource: "File", operation: "Download", fileIdMode: "Expression", fileId: "{{ $json.id }}", binaryProperty: "data", settings: defaultNodeSettings() };
  if (nodeId === "google-delete") return { credentialId: "", resource: "File", operation: "Delete", fileIdMode: "Expression", fileId: "{{ $json.id }}", requireConfirmation: true, settings: defaultNodeSettings() };
  if (nodeId === "google-move") return { credentialId: "", resource: "File", operation: "Move", fileIdMode: "Expression",
    fileId: "{{ $json.sourceFileId }}", destinationFolderId: "", settings: defaultNodeSettings() };
  if (nodeId === "facebook-graph-api") return { ...facebookNodeDefaults(), settings: defaultNodeSettings() };
  if (nodeId === "prepare-content") return { ...prepareContentDefaults(), settings: defaultNodeSettings() };
  return null;
}

function NodeInputPanel({ previousNode, input, onInputChange, onExecutePreviousNodes, nodeId, allowMock = false }) {
  const [tab, setTab] = useState("Schema");

  const loadPreviousOutput = async () => {
    try {
      if (onExecutePreviousNodes && nodeId) {
        onInputChange(await onExecutePreviousNodes(nodeId));
      } else if (previousNode?.output != null) {
        onInputChange(previousNode.output);
      }
    } catch (error) {
      onInputChange({ status: "error", message: error?.message || "Upstream execution failed." });
    }
  };

  return (
    <section className="node-input-panel">
      <div className="input-header">
        <strong>INPUT</strong>
        <div className="input-tabs">
          {["Schema", "Table", "JSON"].map((item) => (
            <button key={item} className={tab === item ? "input-tab-active" : ""} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
      </div>
      <div className="input-source-select">
        <span>{previousNode?.icon ?? "○"}</span>
        <span>{previousNode?.name ?? "No connected node"}</span>
        <span>⌄</span>
      </div>
      {input == null ? (
        <div className="input-empty-state">
          <div className="input-arrow">→|</div>
          <h3>No input data</h3>
          <button onClick={loadPreviousOutput}>Execute previous nodes</button>
          <div>to view input data</div>
          {allowMock && <button className="mock-data-action" onClick={() => onInputChange([{ id: 1 }, { id: 2 }, { id: 3 }])}>Use clearly labeled mock input</button>}
        </div>
      ) : <div className="input-data-view"><OutputViewer output={input} tab={tab} /></div>}
      <div className="variables-context">Variables and context</div>
    </section>
  );
}

function NodeOutputPanel({ output, onExecute, allowMock = false, onMock }) {
  const [tab, setTab] = useState("Schema");
  return (
    <section className="node-output-panel">
      <div className="output-header">
        <strong>OUTPUT</strong>
        <div className="output-tabs">
          {["Schema", "Table", "JSON"].map((item) => (
            <button key={item} className={tab === item ? "output-tab-active" : ""} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
      </div>
      {output == null ? (
        <div className="empty-output">
          <div className="output-bolt">→|</div>
          <h3>No output data</h3>
          <button onClick={onExecute}>Execute step</button>
          {allowMock && <button className="mock-data-action" onClick={onMock}>set clearly labeled mock data</button>}
        </div>
      ) : <OutputViewer output={output} tab={tab} />}
    </section>
  );
}

function GenericNodeSettings({ settings, onChange, version }) {
  return (
    <div className="schedule-settings">
      {[['alwaysOutput', 'Always Output Data'], ['executeOnce', 'Execute Once'], ['retryOnFail', 'Retry On Fail']].map(([key, label]) => (
        <ToggleSetting key={key} label={label} value={Boolean(settings[key])} onChange={() => onChange(key, !settings[key])} />
      ))}
      <label>On Error</label>
      <select value={settings.onError} onChange={(event) => onChange("onError", event.target.value)}>
        <option>Stop Workflow</option><option>Continue Workflow</option>
      </select>
      <label>Notes</label>
      <textarea rows="6" value={settings.notes} onChange={(event) => onChange("notes", event.target.value)} />
      <ToggleSetting label="Display Note in Flow?" value={Boolean(settings.displayNote)} onChange={() => onChange("displayNote", !settings.displayNote)} />
      <div className="node-version">{version}</div>
    </div>
  );
}

function Phase2NodeEditor({ node, kind, previousNode, credentials, onCreateCredential, onExecutePreviousNodes, onExecuteNode, onSaveNode, onClose }) {
  const isLimit = kind === "limit";
  const isDownload = kind === "download";
  const isMove = kind === "move";
  const defaults = isLimit
    ? { maxItems: 1, keep: "First Items", settings: defaultNodeSettings() }
    : { credentialId: "", resource: "File", operation: isDownload ? "Download" : isMove ? "Move" : "Delete", fileIdMode: "Expression",
      fileId: isMove ? "{{ $json.sourceFileId }}" : "{{ $json.id }}", destinationFolderId: "", binaryProperty: "data", requireConfirmation: true, settings: defaultNodeSettings() };
  const [activeTab, setActiveTab] = useState("Parameters");
  const [config, setConfig] = useState({ ...defaults, ...node.config, settings: { ...defaults.settings, ...node.config?.settings } });
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);
  const [isExecuting, setIsExecuting] = useState(false);

  const updateSetting = (key, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const executeStep = async () => {
    if (isExecuting) return;
    if (kind === "delete" && config.requireConfirmation && !window.confirm("Permanently delete the selected Google Drive file(s)?")) return;
    setIsExecuting(true);
    const executed = await onExecuteNode({ ...node, config }, input, { triggerMode: "manual" });
    setOutput(executed.output);
    onSaveNode(executed);
    setIsExecuting(false);
  };

  const saveAndClose = () => {
    onSaveNode({ ...node, config, input, output, status: node.status ?? "idle" });
    onClose();
  };

  return (
    <div className="node-editor-overlay">
      <div className="node-editor-window">
        <header className="node-editor-header">
          <div className="node-editor-title">{isLimit ? <span className="logic-title-icon">1</span> : <GoogleDriveIcon className="drive-title-icon" />}<strong>{node.name}</strong></div>
          <div className="node-editor-header-actions"><button className="node-editor-close" onClick={saveAndClose}>×</button></div>
        </header>
        <div className="node-editor-body google-three-column">
          <NodeInputPanel previousNode={previousNode} input={input} onInputChange={setInput} onExecutePreviousNodes={onExecutePreviousNodes} nodeId={node.id} allowMock={isLimit} />
          <section className="node-config-panel google-config-panel">
            <div className="node-editor-tabs">
              {["Parameters", "Settings"].map((tab) => <button key={tab} className={activeTab === tab ? "node-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
              <button className="execute-step" onClick={executeStep} disabled={isExecuting}>{isExecuting ? "Executing..." : "Execute step"}</button>
            </div>
            <div className="node-config-scroll">
              {activeTab === "Parameters" ? (
                <div className="drive-parameters">
                  {isLimit ? <>
                    <label>Max Items</label><input type="number" min="1" value={config.maxItems} onChange={(event) => setConfig({ ...config, maxItems: Math.max(1, Number(event.target.value) || 1) })} />
                    <label>Keep</label><select value={config.keep} onChange={(event) => setConfig({ ...config, keep: event.target.value })}><option>First Items</option><option>Last Items</option></select>
                  </> : <>
                    <label>Credential</label>
                    <div className="credential-row"><select value={config.credentialId} onChange={(event) => event.target.value === "__create__" ? onCreateCredential() : setConfig({ ...config, credentialId: event.target.value })}><option value="">Select credential</option>{config.credentialId && !credentials.some((credential) => credential.id === config.credentialId) && <option value={config.credentialId}>Credential missing</option>}{credentials.map((credential) => <option key={credential.id} value={credential.id}>{googleCredentialLabel(credential)}</option>)}<option value="__create__">+ Create new credential</option></select><button className="credential-button" onClick={() => onCreateCredential(config.credentialId || null)}>✎</button></div>
                    <label>Resource</label><select value={config.resource} disabled><option>File</option></select>
                    <label>Operation</label><select value={config.operation} disabled><option>{config.operation}</option></select>
                    <label>File ID</label><div className="value-mode-switch">{["Fixed", "Expression"].map((mode) => <button key={mode} className={config.fileIdMode === mode ? "active" : ""} onClick={() => setConfig({ ...config, fileIdMode: mode })}>{mode}</button>)}</div>
                    <input value={config.fileId} onChange={(event) => setConfig({ ...config, fileId: event.target.value })} placeholder={config.fileIdMode === "Expression" ? "{{ $json.id }}" : "Google Drive file ID"} />
                    {isDownload ? <><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /><div className="config-section-row"><span>Options</span><button>+</button></div><button className="config-add-button">+ Add option</button></>
                      : isMove ? <><label>Destination Folder ID</label><input value={config.destinationFolderId} onChange={(event) => setConfig({ ...config, destinationFolderId: event.target.value })} placeholder="Google Drive Done folder ID" /><p className="credential-note">Select or create the Done folder once, then paste its exact Google Drive folder ID here.</p></>
                      : <><ToggleSetting label="Require Confirmation" value={config.requireConfirmation} onChange={() => setConfig({ ...config, requireConfirmation: !config.requireConfirmation })} /><ToggleSetting label="Approved for unattended workflow deletion" value={Boolean(config.approvedForWorkflow)} onChange={() => setConfig({ ...config, approvedForWorkflow: !config.approvedForWorkflow })} /><div className="destructive-warning">This action can permanently delete a file. Confirmation is required before destructive execution.</div></>}
                  </>}
                </div>
              ) : <GenericNodeSettings settings={config.settings} onChange={updateSetting} version={`${node.name} node version 1.0`} />}
            </div>
          </section>
          <NodeOutputPanel output={output} onExecute={executeStep} />
        </div>
      </div>
    </div>
  );
}

function ParameterList({ title, addLabel, items, onChange }) {
  const update = (index, key, value) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  return (
    <div className="request-parameter-section">
      <div className="config-section-row"><span>{title}</span><button onClick={() => onChange([...items, { name: "", value: "" }])}>+</button></div>
      {items.map((item, index) => <div className="parameter-pair" key={index}><input aria-label={`${title} name`} placeholder="Name" value={item.name} onChange={(event) => update(index, "name", event.target.value)} /><input aria-label={`${title} value`} placeholder="Value" value={item.value} onChange={(event) => update(index, "value", event.target.value)} /><button aria-label={`Remove ${title} item`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}
      <button className="config-add-button" onClick={() => onChange([...items, { name: "", value: "" }])}>+ {addLabel}</button>
    </div>
  );
}

function PrepareContentEditor({ node, previousNode, openAIConfigured, onExecutePreviousNodes, onExecuteNode, onSaveNode, onClose }) {
  const defaults = { ...prepareContentDefaults(), settings: defaultNodeSettings() };
  const [activeTab, setActiveTab] = useState("Parameters");
  const [config, setConfig] = useState({ ...defaults, ...node.config, settings: { ...defaults.settings, ...node.config?.settings } });
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);
  const [isExecuting, setIsExecuting] = useState(false);
  const updateSetting = (key, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const executeStep = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    try { const executed = await onExecuteNode({ ...node, config }, input, { triggerMode: "manual" }); setOutput(executed.output); onSaveNode(executed); }
    finally { setIsExecuting(false); }
  };
  const saveAndClose = () => { onSaveNode({ ...node, config, input, output, status: node.status ?? "idle" }); onClose(); };
  return <div className="node-editor-overlay"><div className="node-editor-window">
    <header className="node-editor-header"><div className="node-editor-title"><span className="logic-title-icon">AI</span><strong>Prepare Content</strong></div><div className="node-editor-header-actions"><button className="node-editor-close" onClick={saveAndClose}>×</button></div></header>
    <div className="node-editor-body google-three-column">
      <NodeInputPanel previousNode={previousNode} input={input} onInputChange={setInput} onExecutePreviousNodes={onExecutePreviousNodes} nodeId={node.id} />
      <section className="node-config-panel google-config-panel"><div className="node-editor-tabs">{["Parameters", "Settings"].map((tab) => <button key={tab} className={activeTab === tab ? "node-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}<button className="execute-step" onClick={executeStep} disabled={isExecuting}>{isExecuting ? "Executing..." : "Execute step"}</button></div>
        <div className="node-config-scroll">{activeTab === "Parameters" ? <div className="drive-parameters">
          <div className={openAIConfigured ? "connection-status success" : "connection-status not-tested"}>{openAIConfigured ? "OpenAI configured on server" : "OpenAI not configured on server"}</div>
          <label>Input Source</label><select value={config.inputSource} disabled><option>Previous Item Metadata</option></select>
          <label>Filename Expression</label><input value={config.fileName} onChange={(event) => setConfig({ ...config, fileName: event.target.value })} placeholder="{{ $json.fileName }}" />
          <label>Title Instructions</label><textarea rows="3" value={config.titleInstructions} onChange={(event) => setConfig({ ...config, titleInstructions: event.target.value })} />
          <label>Caption Instructions</label><textarea rows="4" value={config.captionInstructions} onChange={(event) => setConfig({ ...config, captionInstructions: event.target.value })} />
          <label>Hashtag Count</label><input type="number" min="1" max="20" value={config.hashtagCount} onChange={(event) => setConfig({ ...config, hashtagCount: Number(event.target.value) })} />
          <label>Language</label><input value={config.language} onChange={(event) => setConfig({ ...config, language: event.target.value })} />
          <label>Tone</label><select value={config.tone} onChange={(event) => setConfig({ ...config, tone: event.target.value })}>{PREPARE_CONTENT_TONES.map((tone) => <option key={tone}>{tone}</option>)}</select>
          <ToggleSetting label="Preserve Input" value={config.preserveInput !== false} onChange={() => setConfig({ ...config, preserveInput: config.preserveInput === false })} />
          <small>Jarvis generates copy from filename and metadata only. It does not analyze the video.</small>
        </div> : <GenericNodeSettings settings={config.settings} onChange={updateSetting} version="Prepare Content node version 1.0" />}</div>
      </section>
      <NodeOutputPanel output={output} onExecute={executeStep} />
    </div>
  </div></div>;
}

function FacebookGraphEditor({ node, previousNode, credentials, onCreateCredential, onExecutePreviousNodes, onExecuteNode, onSaveNode, onClose }) {
  const defaults = { ...facebookNodeDefaults(), settings: defaultNodeSettings() };
  const [activeTab, setActiveTab] = useState("Parameters");
  const [config, setConfig] = useState(() => { const safe = sanitizeFacebookConfig(node.config); return { ...defaults, ...safe, pageVideo: { ...defaults.pageVideo, ...safe.pageVideo }, settings: { ...defaults.settings, ...safe.settings } }; });
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);
  const [validationMessage, setValidationMessage] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const updateSetting = (key, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const showPageVideo = config.method === "POST" && config.endpoint.toLowerCase().includes("videos");
  const publishReel = config.operation === FACEBOOK_OPERATION_PUBLISH_REEL;

  const executeStep = async () => {
    let message = "";
    try { assertSafeFacebookConfig(config); } catch (error) { message = error.message; }
    if (!message && !config.credentialId) message = "Select a connected Facebook credential";
    else if (!message && publishReel && !config.binaryProperty.trim()) message = "Binary Property is required";
    else if (!message && !publishReel && config.method !== "GET") message = "Graph API Request supports read-only Facebook GET operations only";
    else if (!message && !publishReel && config.apiVersion && !/^v\d{1,2}\.\d{1,2}$/.test(config.apiVersion)) message = "Graph API Version must look like v25.0";
    else if (!message && !publishReel && !config.endpoint.trim()) message = "Endpoint is required";
    else if (!publishReel && config.sendBinaryData && !config.binaryProperty.trim()) message = "Binary Property is required when Send Binary Data is enabled";
    else if (!publishReel && showPageVideo && (config.pageVideo.description || config.pageVideo.published) && !config.pageVideo.pageId.trim()) message = "Page ID is required when Facebook Page Video helpers are configured";
    if (message) {
      const result = { status: "error", message };
      setValidationMessage(message); setOutput(result); onSaveNode({ ...node, config, input, output: result, status: "error" }); return;
    }
    setValidationMessage(""); setIsExecuting(true);
    const executed = await onExecuteNode({ ...node, config }, input, { triggerMode: "manual" });
    setOutput(executed.output); onSaveNode(executed); setIsExecuting(false);
  };
  const saveAndClose = () => { try { assertSafeFacebookConfig(config); onSaveNode({ ...node, config: sanitizeFacebookConfig(config), input, output, status: node.status ?? "idle" }); onClose(); } catch (error) { setValidationMessage(error.message); } };
  const updatePageVideo = (key, value) => setConfig((current) => ({ ...current, pageVideo: { ...current.pageVideo, [key]: value } }));
  const updateSafeParameters = (key, items) => { try { assertSafeFacebookConfig({ [key]: items }); setConfig({ ...config, [key]: items }); setValidationMessage(""); } catch (error) { setValidationMessage(error.message); } };

  return (
    <div className="node-editor-overlay"><div className="node-editor-window">
      <header className="node-editor-header"><div className="node-editor-title"><FacebookIcon className="facebook-title-icon" /><strong>Facebook Graph API</strong></div><div className="node-editor-header-actions"><button className="node-editor-close" onClick={saveAndClose}>×</button></div></header>
      <div className="node-editor-body google-three-column">
        <NodeInputPanel previousNode={previousNode} input={input} onInputChange={setInput} onExecutePreviousNodes={onExecutePreviousNodes} nodeId={node.id} />
        <section className="node-config-panel google-config-panel"><div className="node-editor-tabs">{["Parameters", "Settings"].map((tab) => <button key={tab} className={activeTab === tab ? "node-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}<button className="execute-step" onClick={executeStep} disabled={isExecuting}>{isExecuting ? "Executing..." : "Execute step"}</button></div>
          <div className="node-config-scroll">{activeTab === "Parameters" ? <div className="drive-parameters facebook-parameters">
            {validationMessage && <div className="field-validation" role="alert">{validationMessage}</div>}
            <label>Credential</label><div className="credential-row"><select value={config.credentialId} onChange={(event) => event.target.value === "__create__" ? onCreateCredential(null) : setConfig({ ...config, credentialId: event.target.value })}><option value="">Select credential</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{facebookCredentialLabel(credential)}</option>)}<option value="__create__">+ Create new credential</option></select><button className="credential-button" onClick={() => onCreateCredential(config.credentialId || null)}>✎</button></div>
            <label>Operation</label><select value={config.operation} onChange={(event) => setConfig({ ...config, operation: event.target.value })}><option>{FACEBOOK_OPERATION_READ}</option><option>{FACEBOOK_OPERATION_PUBLISH_REEL}</option></select>
            {publishReel && <>
              <label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} placeholder="data" />
              <label>Title</label><input value={config.title} onChange={(event) => setConfig({ ...config, title: event.target.value })} placeholder="Optional; expressions supported" />
              <label>Description / Caption</label><textarea rows="4" value={config.description} onChange={(event) => setConfig({ ...config, description: event.target.value })} placeholder="Optional; expressions supported" />
              <ToggleSetting label="Wait for Processing" value={config.waitForProcessing} onChange={() => setConfig({ ...config, waitForProcessing: !config.waitForProcessing })} />
            </>}
            {!publishReel && <><label>HTTP Method</label><select value={config.method} onChange={(event) => setConfig({ ...config, method: event.target.value })}><option>GET</option><option>POST</option><option>DELETE</option></select>
            <label>Graph API Version</label><input value={config.apiVersion} onChange={(event) => setConfig({ ...config, apiVersion: event.target.value })} placeholder="vXX.X" />
            <label>Endpoint / Node</label><input value={config.endpoint} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} placeholder="me, me/accounts, or a numeric Page ID" /><small>Phase 3A read-only endpoints: me, me/accounts, or a numeric Page ID.</small>
            <ParameterList title="Query Parameters" addLabel="Add Parameter" items={config.queryParameters} onChange={(items) => updateSafeParameters("queryParameters", items)} />
            <ParameterList title="Headers" addLabel="Add Header" items={config.headers} onChange={(items) => updateSafeParameters("headers", items)} />
            <ParameterList title="Body Parameters" addLabel="Add Parameter" items={config.bodyParameters} onChange={(items) => updateSafeParameters("bodyParameters", items)} />
            <ToggleSetting label="Send Binary Data" value={config.sendBinaryData} onChange={() => setConfig({ ...config, sendBinaryData: !config.sendBinaryData })} />
            {config.sendBinaryData && <><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /><small>Binary property from a previous node, for example data.</small></>}
            {showPageVideo && <div className="page-video-helper"><h3>Facebook Page Video</h3><label>Page ID</label><input value={config.pageVideo.pageId} onChange={(event) => updatePageVideo("pageId", event.target.value)} /><label>Caption / Description</label><textarea rows="4" value={config.pageVideo.description} onChange={(event) => updatePageVideo("description", event.target.value)} /><ToggleSetting label="Published" value={config.pageVideo.published} onChange={() => updatePageVideo("published", !config.pageVideo.published)} /><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /></div>}</>}
          </div> : <GenericNodeSettings settings={config.settings} onChange={updateSetting} version="Facebook Graph API node version 1.0" />}</div>
        </section>
        <NodeOutputPanel output={output} onExecute={executeStep} />
      </div>
    </div></div>
  );
}

function NotImplementedNodeEditor({ node, onClose }) {
  return <div className="credential-modal-overlay"><div className="not-implemented-modal"><FacebookIcon className="facebook-provider-logo" /><h2>{node.name}</h2><p>This Facebook action is registered, but its editor is not implemented in Phase 3.</p><button onClick={onClose}>Close</button></div></div>;
}

function ToggleSetting({
  label,
  value,
  onChange,
}) {
  return (
    <div className="toggle-setting">
      <button
        className={`toggle-switch ${
          value ? "toggle-on" : ""
        }`}
        onClick={onChange}
      >
        <span />
      </button>

      <strong>{label}</strong>
    </div>
  );
}

function OutputViewer({ output, tab }) {
  return <DataViewer value={output} tab={tab} />;
}

function ExecutionHistory({ executions, selected, onSelect }) {
  const [tab, setTab] = useState("Schema");
  return <div className="execution-history">
    <div className="execution-list">
      <h2>Executions</h2>
      {!executions.length && <p>No workflow executions yet.</p>}
      {executions.map((execution) => <button key={execution.executionId} className={selected?.executionId === execution.executionId ? "active" : ""} onClick={() => onSelect(execution.executionId)}>
        <strong>{execution.executionId.slice(0, 13)}</strong><span className={`execution-status ${execution.status}`}>{execution.status}</span>
        <small>{new Date(execution.startedAt).toLocaleString()} · {Math.max(0, new Date(execution.finishedAt) - new Date(execution.startedAt))} ms · {execution.triggerMode}</small>
      </button>)}
    </div>
    <div className="execution-detail">
      {!selected ? <p>Select an execution to inspect it.</p> : <>
        <h3>{selected.workflowName} · {selected.status}</h3>
        <p>{selected.startedAt} → {selected.finishedAt}</p>
        <div className="output-tabs">{["Schema", "Table", "JSON"].map((name) => <button key={name} className={tab === name ? "output-tab-active" : ""} onClick={() => setTab(name)}>{name}</button>)}</div>
        <DataViewer value={selected.nodes} tab={tab} />
      </>}
    </div>
  </div>;
}

function App() {
  const [topPage, setTopPage] =
    useState("WORKFLOW");

  const [workflowTab, setWorkflowTab] =
    useState("EDITOR");

  const [showNodePicker, setShowNodePicker] =
    useState(false);

  const [search, setSearch] = useState("");

  const [canvasNodes, setCanvasNodes] =
    useState([]);
  const canvasNodesRef = useRef(canvasNodes);

  const [editingNode, setEditingNode] =
    useState(null);

  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState(null);
  const [insertingConnectionId, setInsertingConnectionId] = useState(null);
  const connectionsRef = useRef(connections);
  const workflowCanvasRef = useRef(null);
  const dragStateRef = useRef(null);
  const panStateRef = useRef(null);
  const suppressNodeClickRef = useRef(false);
  const [canvasViewport, setCanvasViewport] = useState(() => loadCanvasAppearance().viewport);
  const [canvasAppearance, setCanvasAppearance] = useState(loadCanvasAppearance);
  const [colorEditor, setColorEditor] = useState(null);
  const [showAppearance, setShowAppearance] = useState(false);
  const [lastExecutionAt, setLastExecutionAt] = useState(null);
  useEffect(() => {
    canvasNodesRef.current = canvasNodes;
  }, [canvasNodes]);
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState(null);
  const [providerBrowser, setProviderBrowser] = useState(null);
  const [showGoogleCredential, setShowGoogleCredential] = useState(false);
  const [googleCredentials, setGoogleCredentials] = useState([]);
  const [editingGoogleCredentialId, setEditingGoogleCredentialId] = useState(null);
  const pendingGoogleCredentialNodeId = useRef(null);
  const [credentialToast, setCredentialToast] = useState("");
  const [showFacebookCredential, setShowFacebookCredential] = useState(false);
  const [facebookCredentials, setFacebookCredentials] = useState([]);
  const [editingFacebookCredentialId, setEditingFacebookCredentialId] = useState(null);
  const pendingFacebookCredentialNodeId = useRef(null);
  const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [openAIConfigured, setOpenAIConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/health`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((health) => { if (!cancelled) setOpenAIConfigured(Boolean(health?.openAIConfigured)); })
      .catch(() => { if (!cancelled) setOpenAIConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  const syncGoogleCredential = async ({ showToast = false, credentialId = null } = {}) => {
    const response = await fetch(`${API_BASE_URL}/api/google/credentials`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Credential status request failed (${response.status}).`);
    }

    const data = await response.json();
    let credentials = Array.isArray(data?.credentials) ? data.credentials : [];
    let selectedCredential = selectOAuthCredential(credentials, credentialId);
    if (credentialId) {
      const statusResponse = await fetch(`${API_BASE_URL}/api/google/credentials/${encodeURIComponent(credentialId)}`, {
        credentials: "include",
      });
      if (!statusResponse.ok) {
        throw new Error(`Connected credential status request failed (${statusResponse.status}).`);
      }
      selectedCredential = await statusResponse.json();
      credentials = [
        ...credentials.filter((credential) => credential.id !== selectedCredential.id),
        selectedCredential,
      ];
    }
    setGoogleCredentials(credentials.map((credential) => ({
      ...credential,
      name: googleCredentialLabel(credential),
    })));

    if (showToast && credentials.length) {
      const latest = selectedCredential || credentials[credentials.length - 1];
      setCredentialToast(
        latest.accountEmail
          ? `Google Drive connected: ${latest.accountEmail}`
          : "Google Drive account connected"
      );
      window.setTimeout(() => setCredentialToast(""), 3500);
    }

    return { connected: Boolean(selectedCredential || credentials.length), credentials, selectedCredential };
  };

  const syncFacebookCredentials = async (credentialId = null) => {
    const response = await fetch(`${API_BASE_URL}/api/facebook/credentials`, { credentials: "include" });
    if (!response.ok) throw new Error("Could not load Facebook credentials.");
    const data = await response.json(); let credentials = Array.isArray(data.credentials) ? data.credentials : [];
    if (credentialId) {
      const status = await fetch(`${API_BASE_URL}/api/facebook/credentials/${encodeURIComponent(credentialId)}`, { credentials: "include" });
      if (!status.ok) throw new Error("Connected Facebook credential was not found.");
      const selected = await status.json(); credentials = [...credentials.filter((item) => item.id !== selected.id), selected];
    }
    setFacebookCredentials(credentials); return credentials.find((item) => item.id === credentialId) || null;
  };

  const startFacebookOAuth = (credentialId = null) => {
    const popup = window.open(`${API_BASE_URL}/api/facebook/auth/start?mode=popup${credentialId ? `&credentialId=${encodeURIComponent(credentialId)}` : ""}`,
      "jarvis_facebook_oauth", "popup=yes,width=600,height=760,resizable=yes,scrollbars=yes");
    if (!popup) setCredentialToast("Popup was blocked. Allow popups and try again."); else popup.focus();
  };

  const disconnectFacebook = async (credentialId) => {
    const response = await fetch(`${API_BASE_URL}/api/facebook/credentials/${encodeURIComponent(credentialId)}/disconnect`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Could not disconnect Facebook credential.");
    setFacebookCredentials((items) => items.filter((item) => item.id !== credentialId));
  };

  const startGoogleOAuth = (credentialId = null) => {
    const width = 560;
    const height = 720;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      `${API_BASE_URL}/api/google/auth/start?mode=popup${credentialId ? `&credentialId=${encodeURIComponent(credentialId)}` : ""}`,
      "jarvis_google_oauth",
      `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      setCredentialToast("Popup was blocked. Allow popups for Jarvis and try again.");
      window.setTimeout(() => setCredentialToast(""), 5000);
      return;
    }

    popup.focus();
  };

  const disconnectGoogleOAuth = async (credentialId) => {
    const response = await fetch(`${API_BASE_URL}/api/google/credentials/${encodeURIComponent(credentialId)}/disconnect`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      let message = "Could not disconnect Google Drive.";
      try {
        const data = await response.json();
        message = data?.error || data?.message || message;
      } catch {
        // Keep the user-friendly fallback message.
      }
      throw new Error(message);
    }

    setGoogleCredentials((current) => current.filter((item) => item.id !== credentialId));
  };

  const deleteGoogleCredential = async (credentialId) => {
    const response = await fetch(`${API_BASE_URL}/api/google/credentials/${encodeURIComponent(credentialId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Could not delete Google Drive credential.");
    setGoogleCredentials((current) => current.filter((item) => item.id !== credentialId));
  };

  useEffect(() => {
    let cancelled = false;

    const handleOAuthMessage = async (event) => {
      let backendOrigin;
      try {
        backendOrigin = new URL(API_BASE_URL || window.location.origin, window.location.origin).origin;
      } catch {
        return;
      }

      if (event.origin !== backendOrigin) return;
      if (event.data?.type !== "jarvis-google-oauth") return;

      if (event.data.status === "connected") {
        try {
          if (!cancelled) {
            const credentialId = event.data.credentialId;
            if (!credentialId) throw new Error("Google OAuth did not return a credential ID.");
            const result = await syncGoogleCredential({ showToast: true, credentialId });
            if (!result.selectedCredential) throw new Error("Connected credential was not found.");
            setEditingGoogleCredentialId(credentialId);
            const pendingNodeId = pendingGoogleCredentialNodeId.current;
            if (pendingNodeId) {
              setCanvasNodes((nodes) => assignCredentialToNode(nodes, pendingNodeId, credentialId));
              setEditingNode((node) =>
                node?.id === pendingNodeId
                  ? assignCredentialToNode([node], pendingNodeId, credentialId)[0]
                  : node
              );
              pendingGoogleCredentialNodeId.current = null;
            }
            setShowGoogleCredential(true);
          }
        } catch (error) {
          if (!cancelled) {
            setCredentialToast(
              error?.message || "Could not confirm the Google Drive connection."
            );
            window.setTimeout(() => setCredentialToast(""), 5000);
          }
        }
        return;
      }

      if (!cancelled) {
        setCredentialToast(
          event.data?.message || "Google sign-in was not completed."
        );
        window.setTimeout(() => setCredentialToast(""), 5000);
      }
    };

    window.addEventListener("message", handleOAuthMessage);

    // Fallback for a non-popup OAuth callback or a manually opened callback page.
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("google_oauth");
    const oauthCredentialId = params.get("credential_id");

    const clearOAuthQuery = () => {
      if (!oauthResult) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("google_oauth");
      url.searchParams.delete("credential_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const initialSync = async () => {
      try {
        const result = await syncGoogleCredential({
          showToast: oauthResult === "connected",
          credentialId: oauthCredentialId,
        });

        if (oauthResult === "connected" && result.selectedCredential && !cancelled) {
          setEditingGoogleCredentialId(result.selectedCredential.id);
          setShowGoogleCredential(true);
        }

        if (oauthResult === "connected" && !result.connected && !cancelled) {
          setCredentialToast(
            "Google sign-in returned, but the backend did not report a connected credential."
          );
          window.setTimeout(() => setCredentialToast(""), 5000);
        } else if (oauthResult === "error" && !cancelled) {
          setCredentialToast("Google sign-in was not completed.");
          window.setTimeout(() => setCredentialToast(""), 5000);
        }
      } catch (error) {
        if (!cancelled && oauthResult) {
          setCredentialToast(
            error?.message || "Could not check Google Drive connection status."
          );
          window.setTimeout(() => setCredentialToast(""), 5000);
        }
      } finally {
        if (!cancelled) clearOAuthQuery();
      }
    };

    initialSync();

    return () => {
      cancelled = true;
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handleFacebookOAuth = async (event) => {
      let origin; try { origin = new URL(API_BASE_URL || window.location.origin, window.location.origin).origin; } catch { return; }
      if (event.origin !== origin || event.data?.type !== "jarvis-facebook-oauth") return;
      if (event.data.status !== "connected" || !event.data.credentialId) {
        setCredentialToast(event.data?.message || "Meta sign-in was not completed."); return;
      }
      try {
        const credential = await syncFacebookCredentials(event.data.credentialId); if (cancelled || !credential) return;
        setEditingFacebookCredentialId(credential.id); setShowFacebookCredential(true);
        const nodeId = pendingFacebookCredentialNodeId.current;
        if (nodeId) {
          setCanvasNodes((nodes) => nodes.map((node) => node.id === nodeId ? { ...node, config: { ...node.config, credentialId: credential.id } } : node));
          setEditingNode((node) => node?.id === nodeId ? { ...node, config: { ...node.config, credentialId: credential.id } } : node);
          pendingFacebookCredentialNodeId.current = null;
        }
        setCredentialToast(`Facebook connected: ${credential.accountName || credential.accountId}`);
      } catch (error) { if (!cancelled) setCredentialToast(error?.message || "Could not confirm Meta connection."); }
    };
    window.addEventListener("message", handleFacebookOAuth);
    const initialSyncTimer = window.setTimeout(() => syncFacebookCredentials().catch(() => {}), 0);
    return () => { cancelled = true; window.clearTimeout(initialSyncTimer); window.removeEventListener("message", handleFacebookOAuth); };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      if (!saved) return;

      const parsedWorkflow = JSON.parse(saved);
      const workflow = normalizeSavedWorkflow(parsedWorkflow);
      const safeWorkflow = workflowForStorage(parsedWorkflow);
      if (JSON.stringify(safeWorkflow) !== JSON.stringify(parsedWorkflow)) {
        localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(safeWorkflow));
      }
      if (Array.isArray(workflow?.nodes)) {
        setCanvasNodes(workflow.nodes);
      }
      if (Array.isArray(workflow?.connections)) {
        setConnections(workflow.connections);
      }
    } catch (error) {
      console.error("Could not load saved Jarvis workflow:", error);
    }
  }, []);

  const updateAppearance = (patch) => {
    setCanvasAppearance((current) => safeAppearance({ ...current, ...patch, viewport: canvasViewport }));
  };

  const applyThemePreset = (preset) => {
    updateAppearance({ ...preset, preset: preset.id, canvasStyle: "linear-gradient" });
  };

  const resetAppearanceSection = (section) => updateAppearance(Object.fromEntries(section.fields.map(([key]) => [key, DEFAULT_APPEARANCE[key]])));

  const contrastBackgroundFor = (key) => ({ nodeTitle: canvasAppearance.nodeBackground, nodeSubtitle: canvasAppearance.nodeBackground,
    headerTextColor: canvasAppearance.headerColor, statusTextColor: canvasAppearance.headerColor, sidebarText: canvasAppearance.sidebarBackground,
    sidebarActiveText: canvasAppearance.sidebarActiveBackground, controlText: canvasAppearance.controlBackground,
    mainText: canvasAppearance.panelBackground, mutedText: canvasAppearance.panelBackground }[key] || null);

  useEffect(() => {
    localStorage.setItem(CANVAS_APPEARANCE_KEY, JSON.stringify({ ...canvasAppearance, viewport: canvasViewport }));
  }, [canvasAppearance, canvasViewport]);

  const updateCanvasNode = (updatedNode) => {
    const nextNodes = canvasNodesRef.current.map((node) => node.id === updatedNode.id ? updatedNode : node);
    canvasNodesRef.current = nextNodes;
    setCanvasNodes(nextNodes);

    setEditingNode(updatedNode);
  };

  const executeNodeOperation = async (node, input, context = {}) => {
      if (node.name === "Schedule Trigger") {
        return createScheduleManualOutput(node.config);
      }
      if (node.name === "Search Files and Folders") {
        const request = buildDriveSearchRequest(node.config);
        const response = await fetch(`${API_BASE_URL}/api/google/drive/search`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Google Drive search failed.");
        return Array.isArray(data?.files) ? data.files : [];
      }
      if (node.name === "Limit") {
        if (!Array.isArray(input)) throw new Error("Limit requires array input.");
        const count = Number(node.config?.maxItems);
        if (!Number.isInteger(count) || count < 1) throw new Error("Limit Max Items must be a positive whole number.");
        return node.config?.keep === "Last Items" ? input.slice(-count) : input.slice(0, count);
      }
      if (["Download File", "Delete File", "Move File"].includes(node.name)) {
        if (!node.config?.credentialId) throw new Error("Select a Google Drive credential before executing.");
        if (node.name === "Delete File" && context.triggerMode === "workflow" && node.config.requireConfirmation && !node.config.approvedForWorkflow) {
          throw new Error("Delete File requires explicit approval for unattended workflow execution.");
        }
        return executePerItem(input, async (item) => {
          const moveRequest = node.name === "Move File" ? buildArchiveMoveRequest(node.config, item) : null;
          const fileId = moveRequest?.fileId || resolveExpression(node.config?.fileId || "", item);
          const action = node.name === "Download File" ? "download" : node.name === "Move File" ? "move" : "delete";
          const response = await fetch(`${API_BASE_URL}/api/google/drive/${action}`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credentialId: node.config.credentialId, fileId, destinationFolderId: moveRequest?.destinationFolderId,
              binaryProperty: node.config.binaryProperty || "data" }),
          });
          const data = await response.json();
          if (!response.ok && node.name === "Move File") {
            throw new Error(ARCHIVE_AFTER_PUBLISH_ERROR);
          }
          if (!response.ok) throw new Error(data?.error || `${node.name} failed.`);
          return data;
        });
      }
      if (node.name === "Prepare Content") {
        return executePerItem(input, async (item) => {
          const response = await fetch(`${API_BASE_URL}/api/ai/prepare-content`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPrepareContentRequest(node.config, item)),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || "Prepare Content failed.");
          return mergePreparedContent(item, data, node.config?.preserveInput !== false);
        });
      }
      if (node.name === "Facebook Graph API") {
        assertSafeFacebookConfig(node.config);
        if (!node.config?.credentialId) throw new Error("Select a connected Facebook credential.");
        if (node.config?.operation === FACEBOOK_OPERATION_PUBLISH_REEL) {
          return executePerItem(input, async (item) => {
            const request = buildFacebookReelRequest(node.config, item);
            const response = await fetch(`${API_BASE_URL}/api/facebook/reels/publish`, { method: "POST", credentials: "include",
              headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
            const data = await response.json();
            if (!response.ok) throw createStructuredExecutionError({
              message: data?.error || data?.message || "Facebook Reel publishing failed.",
              code: data?.code,
              diagnostic: data?.diagnostic,
            });
            return preservePublishedSource(data, item);
          });
        }
        if (node.config?.method !== "GET") throw new Error("Graph API Request supports read-only Facebook GET operations only.");
        const executeRead = async (item) => {
          const endpoint = String(resolveExpression(node.config.endpoint, item)).trim().replace(/^\/+|\/+$/g, "");
          const route = endpoint === "me" ? "me" : endpoint === "me/accounts" ? "pages" : /^\d{3,30}$/.test(endpoint) ? "page" : null;
          if (!route) throw new Error("Phase 3A supports only me, me/accounts, or a numeric Page ID.");
          const response = await fetch(`${API_BASE_URL}/api/facebook/graph/${route}`, { method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialId: node.config.credentialId, pageId: route === "page" ? endpoint : undefined }) });
          const data = await response.json(); if (!response.ok) throw new Error(data?.error || "Facebook Graph request failed."); return data;
        };
        return String(node.config.endpoint || "").includes("{{") ? executePerItem(input, executeRead) : executeRead(input);
      }
      throw new Error(`${node.name} does not support real execution in Phase 2.`);
  };

  const executeRuntimeNode = async (node, input, context = {}) => {
    const executed = await executeWithLifecycle({
      node,
      input,
      onTransition: (updatedNode) => {
        setCanvasNodes((nodes) => nodes.map((item) => item.id === updatedNode.id ? updatedNode : item));
      },
      executor: async () => executeNodeOperation(node, input, context),
    });
    if (context.triggerMode === "manual") {
      const nextNodes = applyManualNodeResult(canvasNodesRef.current, connectionsRef.current, executed);
      canvasNodesRef.current = nextNodes;
      setCanvasNodes(nextNodes);
    }
    return executed;
  };

  const executePreviousNodesFor = async (targetNodeId) => {
    try {
      const result = await executeUpstreamLinear({
        targetNodeId,
        nodes: canvasNodesRef.current,
        connections: connectionsRef.current,
        executeNode: executeRuntimeNode,
      });
      canvasNodesRef.current = result.nodes;
      setCanvasNodes(result.nodes);
      setEditingNode((node) => node?.id === targetNodeId ? { ...node, input: result.input } : node);
      return result.input;
    } catch (error) {
      const visibleError = upstreamInputError(error);
      const nodesAfterFailure = (Array.isArray(error?.updatedNodes)
        ? error.updatedNodes
        : canvasNodesRef.current
      ).map((node) => node.id === targetNodeId ? { ...node, input: visibleError } : node);
      canvasNodesRef.current = nodesAfterFailure;
      setCanvasNodes(nodesAfterFailure);
      setEditingNode((node) => node?.id === targetNodeId ? { ...node, input: visibleError } : node);
      throw error;
    }
  };

  const loadExecutions = async () => {
    const response = await fetch(`${API_BASE_URL}/api/executions`, { credentials: "include" });
    if (!response.ok) throw new Error("Could not load workflow executions.");
    const data = await response.json();
    setExecutions(Array.isArray(data.executions) ? data.executions : []);
  };

  const selectExecution = async (executionId) => {
    const response = await fetch(`${API_BASE_URL}/api/executions/${encodeURIComponent(executionId)}`, { credentials: "include" });
    if (!response.ok) throw new Error("Could not load execution details.");
    setSelectedExecution(await response.json());
  };

  const runWorkflow = async () => {
    if (isWorkflowRunning) return;
    setIsWorkflowRunning(true);
    setWorkflowNotice({ status: "running", message: "Workflow is running..." });
    const startedAt = new Date().toISOString();
    let executionWasPersisted = false;
    try {
      const runNodes = canvasNodesRef.current.map((node) => ({ ...node, status: "idle", error: null }));
      canvasNodesRef.current = runNodes;
      setCanvasNodes(runNodes);
      const runner = isStrictlyLinearWorkflow(runNodes, connectionsRef.current) ? runLinearWorkflow : runFanOutWorkflow;
      const result = await runner({
        nodes: runNodes,
        connections: connectionsRef.current,
        executeNode: executeNodeOperation,
        onNodeTransition: (updatedNode) => setCanvasNodes((nodes) => {
          const next = nodes.map((node) => node.id === updatedNode.id ? updatedNode : node); canvasNodesRef.current = next; return next;
        }),
      });
      canvasNodesRef.current = result.nodes;
      setCanvasNodes(result.nodes);
      const record = { workflowId: "local-workflow", workflowName: "My Workflow", status: result.status,
        triggerMode: "workflow", startedAt, finishedAt: new Date().toISOString(), nodes: result.summaries };
      const response = await fetch(`${API_BASE_URL}/api/executions`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(record) });
      if (!response.ok) throw new Error("Workflow ran, but its execution record could not be saved.");
      executionWasPersisted = true;
      setWorkflowNotice({ status: result.status, message: result.status === "success" ? "Workflow completed successfully." : result.error });
      await loadExecutions();
    } catch (error) {
      if (!executionWasPersisted) {
        try {
          await fetch(`${API_BASE_URL}/api/executions`, { method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflowId: "local-workflow",
              workflowName: "My Workflow", status: "error", triggerMode: "workflow", startedAt,
              finishedAt: new Date().toISOString(), nodes: [{ nodeId: "workflow", name: "Workflow validation", status: "error", error: error?.message || "Workflow execution failed." }] }) });
        } catch {
          // The visible workflow error remains primary if history persistence is unavailable.
        }
      }
      setWorkflowNotice({ status: "error", message: error?.message || "Workflow execution failed." });
    } finally {
      setIsWorkflowRunning(false);
      setLastExecutionAt(new Date().toISOString());
    }
  };

  const saveWorkflow = () => {
    try {
      const workflow = {
        version: 2,
        name: "My Workflow",
        nodes: canvasNodes,
        connections,
        savedAt: new Date().toISOString(),
      };

      localStorage.setItem(
        WORKFLOW_STORAGE_KEY,
        JSON.stringify(workflowForStorage(workflow))
      );

      setWorkflowNotice({ status: "success", message: "Workflow saved." });
    } catch (error) {
      console.error("Could not save Jarvis workflow:", error);
      setWorkflowNotice({ status: "error", message: "Could not save workflow." });
    }
  };

  const openNextNodePicker = (sourceNodeId) => {
    setConnectingFromNodeId(sourceNodeId);
    setProviderBrowser(null);
    setSearch("");
    setShowNodePicker(true);
  };

  const openProviderBrowser = (providerName) => {
    setProviderBrowser(providerName);
    setSearch("");
  };

  const closeProviderBrowser = () => {
    setProviderBrowser(null);
    setSearch("");
  };

  const deleteNode = (nodeId) => {
    const node = canvasNodes.find((item) => item.id === nodeId);
    if (!node) return;

    const confirmed = window.confirm(
      `Delete "${node.name}" and its connections?`
    );

    if (!confirmed) return;

    setCanvasNodes((nodes) =>
      nodes.filter((item) => item.id !== nodeId)
    );

    setConnections((current) =>
      current.filter(
        (connection) =>
          connection.source !== nodeId &&
          connection.target !== nodeId
      )
    );

    if (editingNode?.id === nodeId) {
      setEditingNode(null);
    }

    if (connectingFromNodeId === nodeId) {
      setConnectingFromNodeId(null);
      setShowNodePicker(false);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const showGoogleDriveProvider = Boolean(normalizedSearch) &&
    ("google drive".includes(normalizedSearch) || normalizedSearch.includes("google drive"));
  const showFacebookProvider = Boolean(normalizedSearch) &&
    ("facebook".includes(normalizedSearch) || normalizedSearch.includes("facebook") || "meta".includes(normalizedSearch));

  const filteredNodes = NODE_LIBRARY.filter(
    (node) => {
      const q = normalizedSearch;

      if (showGoogleDriveProvider && node.provider === "Google Drive") {
        return false;
      }
      if (showFacebookProvider && node.provider === "Facebook") return false;

      return (
        node.name.toLowerCase().includes(q) ||
        node.provider.toLowerCase().includes(q) ||
        node.description
          .toLowerCase()
          .includes(q)
      );
    }
  );

  const addNode = (nodeDefinition) => {
    const sourceNode = canvasNodes.find(
      (node) => node.id === connectingFromNodeId
    );

    const defaultIndex = canvasNodes.length;

    const newNode = {
      ...nodeDefinition,
      id: `${nodeDefinition.id}-${Date.now()}`,
      status: "idle",
      input: null,
      output: null,
      x: sourceNode ? (sourceNode.x ?? 140) + 210 : 140 + defaultIndex * 180,
      y: sourceNode ? (sourceNode.y ?? 200) : 200 + (defaultIndex % 2) * 100,
      config:
        nodeDefinition.id === "schedule-trigger"
          ? {
              rules: [createRule(0), createRule(1)],
              settings: {
                alwaysOutput: false,
                executeOnce: false,
                retryOnFail: false,
                onError: "Stop Workflow",
                notes: "",
                displayNote: false,
              },
            }
          : nodeDefinition.id === "google-search"
            ? {
                credentialId: "",
                resource: "File/Folder",
                operation: "Search",
                searchMethod: "Search File/Folder Name",
                query: "",
                folderId: "",
                mimeType: "Any",
                returnAll: false,
                limit: 50,
                settings: {
                  alwaysOutput: false,
                  executeOnce: false,
                  retryOnFail: false,
                  onError: "Stop Workflow",
                  notes: "",
                  displayNote: false,
                },
              }
            : createPhase2Config(nodeDefinition.id) ?? {},
    };

    if (insertingConnectionId) {
      const inserted = insertNodeBetween({ nodes: canvasNodesRef.current, connections: connectionsRef.current, connectionId: insertingConnectionId, node: newNode });
      canvasNodesRef.current = inserted.nodes; connectionsRef.current = inserted.connections;
      setCanvasNodes(inserted.nodes); setConnections(inserted.connections); setInsertingConnectionId(null); setHoveredConnectionId(null);
    } else {
      setCanvasNodes((nodes) => [...nodes, newNode]);
    }

    if (connectingFromNodeId && !insertingConnectionId) {
      setConnections((current) => [
        ...current,
        {
          id: `connection-${Date.now()}`,
          source: connectingFromNodeId,
          target: newNode.id,
        },
      ]);
    }

    setShowNodePicker(false);
    setConnectingFromNodeId(null);
    setInsertingConnectionId(null);
    setSearch("");

    if (nodeDefinition.id === "schedule-trigger") {
      setEditingNode(newNode);
    }
  };

  const getPreviousNode = (nodeId) => {
    const connection = connections.find((item) => item.target === nodeId);
    return connection ? canvasNodes.find((item) => item.id === connection.source) : null;
  };

  const zoomCanvas = (nextZoom, anchor = null) => {
    setCanvasViewport((viewport) => {
      const zoom = clampCanvasZoom(nextZoom);
      if (!anchor) return { ...viewport, zoom };
      const logicalX = (anchor.x - viewport.x) / viewport.zoom;
      const logicalY = (anchor.y - viewport.y) / viewport.zoom;
      return { x: anchor.x - logicalX * zoom, y: anchor.y - logicalY * zoom, zoom };
    });
  };

  const fitWorkflow = () => {
    const bounds = workflowCanvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setCanvasViewport(fitCanvasViewport(canvasNodesRef.current, bounds.width, bounds.height - 34));
  };

  const startNodeDrag = (event, node) => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea, .node-port")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { nodeId: node.id, nodeX: node.x ?? 140, nodeY: node.y ?? 200, pointerX: event.clientX, pointerY: event.clientY, moved: false };
  };

  const moveNode = (event) => {
    const drag = dragStateRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const moved = Math.abs(event.clientX - drag.pointerX) + Math.abs(event.clientY - drag.pointerY) > 3;
    if (moved) drag.moved = true;
    const pointer = { x: event.clientX, y: event.clientY };
    setCanvasNodes((nodes) => nodes.map((node) => node.id === drag.nodeId ? moveNodeFromPointer(node, drag, pointer, canvasViewport.zoom) : node));
  };

  const endNodeDrag = (event) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    suppressNodeClickRef.current = drag.moved;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startCanvasPan = (event) => {
    if (event.button !== 0 || event.target.closest(".workflow-node, button, input, select, textarea")) return;
    if (!event.target.closest(".workflow-connection-hit-area")) setSelectedConnectionId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    panStateRef.current = { pointerX: event.clientX, pointerY: event.clientY, x: canvasViewport.x, y: canvasViewport.y };
  };

  const moveCanvasPan = (event) => {
    const pan = panStateRef.current;
    if (!pan || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setCanvasViewport((viewport) => ({ ...viewport, x: pan.x + event.clientX - pan.pointerX, y: pan.y + event.clientY - pan.pointerY }));
  };

  const endCanvasPan = (event) => {
    if (!panStateRef.current) return;
    panStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const workflowStatus = isWorkflowRunning ? "running" : "idle";
  const dashboardGraph = buildDashboardGraph(canvasNodes, connections);

  return (
    <div className={`jarvis-app theme-${workflowStatus} provider-logos-${canvasAppearance.providerLogoMode}`} data-workflow-active={isWorkflowRunning ? "true" : "false"}
      style={appearanceCssVariables(canvasAppearance)}>

      <aside className="sidebar">

        <div className="brand">
          <div className="jarvis-logo" aria-label="ISK">ISK</div>

          <div>
            <div className="brand-name">
              JARVIS
            </div>

            <div className="brand-subtitle">
              AI COMMAND CENTER
            </div>
          </div>
        </div>

        <nav className="side-nav">
          {[
            ["⌂", "Home"],
            ["▣", "Chat"],
            ["◉", "Voice"],
            ["◌", "WhatsApp"],
            ["♪", "TikTok"],
            ["♧", "Memory"],
            ["✓", "Tasks"],
            ["▤", "Logs"],
            ["↻", "Updates"],
            ["▰", "Backups"],
            ["⚙", "Settings"],
            ["〽", "System Health"],
          ].map(([icon, label]) => (
            <button key={label}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">

          <div className="assisted">
            ⬡ ASSISTED MODE
          </div>

          <small>
            Smarter. Faster. Always with You
          </small>

          <div className="version">
            v3.0 WEB
          </div>
        </div>

      </aside>

      <main className="main-area">

        <header className="top-nav">
          {[
            "DASHBOARD",
            "WORKFLOW",
            "TOOLS",
          ].map((item) => (
            <button
              key={item}
              className={
                topPage === item
                  ? "top-active"
                  : ""
              }
              onClick={() =>
                setTopPage(item)
              }
            >
              {item}
            </button>
          ))}
        </header>

        {topPage === "WORKFLOW" ? (
          <section className="workflow-page">

            <div className="workflow-header" style={{ background: canvasAppearance.headerColor, color: readableForeground(canvasAppearance.headerColor) }}>

              <div className="workflow-title">
                <div className="breadcrumb">
                  Jarvis / Workflow
                </div>

                <h1>My Workflow</h1>
                <div className={`workflow-live-status ${workflowStatus}`}><span />{workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}
                  {lastExecutionAt && !isWorkflowRunning && <small> · {new Date(lastExecutionAt).toLocaleTimeString()}</small>}
                </div>
              </div>

              <div className="workflow-tabs">
                {[
                  "EDITOR",
                  "EXECUTIONS",
                  "EVALUATIONS",
                ].map((tab) => (
                  <button
                    key={tab}
                    className={
                      workflowTab === tab
                        ? "tab-active"
                        : ""
                    }
                    onClick={() => {
                      setWorkflowTab(tab);
                      if (tab === "EXECUTIONS") loadExecutions().catch((error) => setWorkflowNotice({ status: "error", message: error.message }));
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="workflow-actions">
                <button className="run-button" onClick={() => runWorkflow()} disabled={isWorkflowRunning}>
                  {isWorkflowRunning ? "Running..." : "▶ Run Workflow"}
                </button>

                <button onClick={saveWorkflow}>Save</button>

                <button className="publish-button">
                  Publish
                </button>
              </div>
            </div>

            {workflowNotice && <div className={`workflow-notice ${workflowNotice.status}`} role="status">{workflowNotice.message}</div>}

            {workflowTab === "EDITOR" && (
              <div className="editor-layout">

                <div
                  className="workflow-canvas"
                  ref={workflowCanvasRef}
                  style={{ background: canvasBackground(canvasAppearance), color: readableForeground(canvasAppearance.canvasColor) }}
                  onPointerDown={startCanvasPan}
                  onPointerMove={moveCanvasPan}
                  onPointerUp={endCanvasPan}
                  onPointerCancel={endCanvasPan}
                  onWheel={(event) => {
                    event.preventDefault();
                    const bounds = workflowCanvasRef.current?.getBoundingClientRect();
                    if (!bounds) return;
                    zoomCanvas(canvasViewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
                  }}
                >

                  <div className="canvas-tools">
                    <button
                      onClick={() =>
                        setShowNodePicker(true)
                      }
                    >
                      ＋
                    </button>

                    <button>⌕</button>
                    <button>▤</button>
                    <button>⌘</button>
                    <button>✦</button>
                  </div>

                  <div className="canvas-command-tools" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => { setInsertingConnectionId(null); setConnectingFromNodeId(null); setShowNodePicker(true); }} title="Add node" aria-label="Add node">+</button>
                    <button type="button" onClick={() => { setShowNodePicker(true); setTimeout(() => document.querySelector('.node-search')?.focus(), 0); }} title="Search nodes" aria-label="Search nodes">⌕</button>
                    <button type="button" onClick={() => setShowAppearance((open) => !open)} title="Canvas appearance" aria-label="Canvas appearance">◐</button>
                    <button type="button" onClick={fitWorkflow} title="Fit workflow" aria-label="Fit workflow">⌗</button>
                  </div>
                  {showAppearance && <aside className="appearance-popover" onPointerDown={(event) => event.stopPropagation()}>
                    <header><div><span>APPEARANCE</span><strong>Jarvis Theme System</strong></div><button type="button" onClick={() => setShowAppearance(false)} aria-label="Close appearance">×</button></header>
                    <div><strong>Presets</strong><div className="theme-presets">{THEME_PRESETS.map((preset) => <button key={preset.id} type="button"
                      className={canvasAppearance.preset === preset.id ? "selected" : ""} onClick={() => applyThemePreset(preset)}>
                      <span style={{ background: `linear-gradient(135deg, ${preset.canvasColor}, ${preset.canvasColorB})` }} />{preset.label}</button>)}</div></div>
                    <div><strong>Background Type</strong><div className="appearance-segmented three-way">{[["solid", "Solid"], ["linear-gradient", "Linear"], ["radial-gradient", "Radial"]].map(([value, label]) =>
                      <button key={value} type="button" className={canvasAppearance.canvasStyle === value ? "selected" : ""} onClick={() => updateAppearance({ canvasStyle: value })}>{label}</button>)}</div></div>
                    {canvasAppearance.canvasStyle === "linear-gradient" && <label className="gradient-angle"><span>Gradient Angle</span><input type="range" min="0" max="360" value={canvasAppearance.gradientAngle}
                      onChange={(event) => updateAppearance({ gradientAngle: Number(event.target.value), preset: "custom" })} /><b>{canvasAppearance.gradientAngle}°</b></label>}
                    <div><strong>Provider Logos</strong><div className="appearance-segmented">{[["original", "Original Brand"], ["monochrome", "Theme Tint"]].map(([value, label]) =>
                      <button key={value} type="button" className={canvasAppearance.providerLogoMode === value ? "selected" : ""} onClick={() => updateAppearance({ providerLogoMode: value, preset: "custom" })}>{label}</button>)}</div></div>
                    <div className="appearance-sections">{APPEARANCE_COLOR_SECTIONS.map((section, index) => <details key={section.id} open={index === 0}>
                      <summary><span>{section.label}</span><button type="button" onClick={(event) => { event.preventDefault(); resetAppearanceSection(section); }}>Reset Section</button></summary>
                      <div className="appearance-color-fields">{section.fields.map(([key, label]) => <AppearanceColorField key={key} label={label} value={canvasAppearance[key]}
                        onOpen={() => setColorEditor({ key, label, original: canvasAppearance[key] })}
                        onReset={() => updateAppearance({ [key]: DEFAULT_APPEARANCE[key], preset: "custom" })} />)}</div>
                    </details>)}</div>
                    <button type="button" className="reset-entire-theme" onClick={() => setCanvasAppearance(safeAppearance({ viewport: canvasViewport }))}>Reset Entire Theme</button>
                  </aside>}

                  <div className="canvas-viewport" style={{ transform: `translate3d(${canvasViewport.x}px, ${canvasViewport.y}px, 0) scale(${canvasViewport.zoom})` }}>
                  {canvasNodes.length > 0 && (
                    <svg className="workflow-connections" aria-label="Workflow connections">
                      <defs><marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
                      {connections.map((connection) => {
                        const source = canvasNodes.find((node) => node.id === connection.source);
                        const target = canvasNodes.find((node) => node.id === connection.target);

                        if (!source || !target) return null;

                        const edgeState = connectionVisualState(source, target, isWorkflowRunning);

                        return (
                          <g key={connection.id} className={`workflow-connection ${edgeState}${selectedConnectionId === connection.id ? " selected" : ""}`}
                            onMouseEnter={() => setHoveredConnectionId(connection.id)} onMouseLeave={() => setHoveredConnectionId(null)}>
                            <path d={connectionPath(source, target)} className="workflow-connection-hit-area" onClick={(event) => { event.stopPropagation(); setSelectedConnectionId(connection.id); }} />
                            <path d={connectionPath(source, target)} className="workflow-connection-path" markerEnd="url(#workflow-arrow)" />
                            {edgeState === "running" && <circle className="workflow-edge-pulse" r="4"><animateMotion dur="0.9s" repeatCount="indefinite" path={connectionPath(source, target)} /></circle>}
                            {hoveredConnectionId === connection.id && (() => { const midpoint = connectionMidpoint(source, target); return <foreignObject x={midpoint.x - 15} y={midpoint.y - 15} width="30" height="30">
                              <button type="button" className="edge-insert-button" title="Insert node on connection" aria-label="Insert node on connection"
                                onClick={(event) => { event.stopPropagation(); setInsertingConnectionId(connection.id); setConnectingFromNodeId(null); setProviderBrowser(null); setSearch(""); setShowNodePicker(true); }}>+</button>
                            </foreignObject>; })()}
                          </g>
                        );
                      })}
                    </svg>
                  )}

                  {canvasNodes.length === 0 ? (
                    <div className="empty-workflow">

                      <button
                        className="empty-card"
                        onClick={() =>
                          setShowNodePicker(true)
                        }
                      >
                        <div className="empty-icon">
                          ＋
                        </div>

                        <div>
                          Add first step...
                        </div>
                      </button>

                      <div className="or-text">
                        or
                      </div>

                      <button className="empty-card">
                        <div className="empty-icon">
                          ✦
                        </div>

                        <div>
                          Build with Jarvis AI
                        </div>
                      </button>

                    </div>
                  ) : (
                    <div className="canvas-node-area">

                      {canvasNodes.map(
                        (node, index) => {
                          const health = nodeConnectionHealth(node, { googleCredentials, facebookCredentials, openAIConfigured });
                          const borderState = nodeBorderVisualState(node, isWorkflowRunning, health);
                          return <div
  key={node.id}
  className={`workflow-node status-${visualNodeStatus(node, isWorkflowRunning)} border-${borderState}${node.name === "Schedule Trigger" ? " schedule-trigger-node" : ""}${editingNode?.id === node.id ? " selected" : ""}`}
  style={{
    left: node.x ?? 140 + index * 210,
    top: node.y ?? 200 + (index % 2) * 100,
  }}
  onPointerDown={(event) => startNodeDrag(event, node)}
  onPointerMove={moveNode}
  onPointerUp={endNodeDrag}
  onPointerCancel={endNodeDrag}
  onClick={() => { if (suppressNodeClickRef.current) { suppressNodeClickRef.current = false; return; } setEditingNode(node); }}
  role="button"
  tabIndex={0}
  aria-label={`${node.name}: ${workflowNodeSubtitle(node)}`}
>
                            {node.name !== "Schedule Trigger" && <span className="node-port node-input-port" title="Input" aria-hidden="true" />}
                            <button
                              className="node-delete-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteNode(node.id);
                              }}
                              title="Delete node"
                              aria-label={`Delete ${node.name}`}
                            >
                              ×
                            </button>

                            <div
                              className={`workflow-node-icon ${node.provider
                                .toLowerCase()
                                .replaceAll(
                                  " ",
                                  "-"
                                )}`}
                            >
                              <NodeProviderIcon node={node} />
                            </div>

                            <div className="workflow-node-copy"><strong>{node.name}</strong><small title={workflowNodeSubtitle(node)}>{workflowNodeSubtitle(node)}</small></div>

                            <span className={`node-status-indicator health-${health}`} title={`Connection health: ${health}`} aria-label={`Connection health: ${health}`} />

                            <button
                              className="node-port node-output-port"
                              onClick={(event) => {
                                event.stopPropagation();
                                openNextNodePicker(node.id);
                              }}
                              title="Add next step"
                            >
                              +
                            </button>
                          </div>;
                        }
                      )}

                    </div>
                  )}
                  </div>

                  <div className="zoom-tools" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => setCanvasViewport({ x: 0, y: 0, zoom: 1 })} title="Reset view" aria-label="Reset canvas view">1:1</button>
                    <button type="button" onClick={() => zoomCanvas(canvasViewport.zoom + 0.1)} title="Zoom in" aria-label="Zoom in">+</button>
                    <button type="button" onClick={() => zoomCanvas(canvasViewport.zoom - 0.1)} title="Zoom out" aria-label="Zoom out">−</button>
                    <button type="button" onClick={fitWorkflow} title="Fit workflow" aria-label="Fit workflow to screen">↙</button>
                  </div>

                  <div className="logs-bar">
                    LOGS
                  </div>

                </div>

                {showNodePicker && (
                  <aside className="node-picker">
                    {providerBrowser === "Google Drive" ? (
                      <GoogleDriveProviderBrowser
                        onBack={closeProviderBrowser}
                        onSelectAction={(id) => {
                          const def = NODE_LIBRARY.find(
                            (item) => item.id === id
                          );
                          if (def) addNode(def);
                        }}
                      />
                    ) : providerBrowser === "Facebook" ? (
                      <FacebookProviderBrowser
                        onBack={closeProviderBrowser}
                        onSelectAction={(id) => {
                          const definition = NODE_LIBRARY.find((item) => item.id === id);
                          if (definition) addNode(definition);
                        }}
                      />
                    ) : (
                    <>

                    <div className="picker-header">

                      <div>
                        <h2>
                          {connectingFromNodeId
                            ? "What happens next?"
                            : "What starts this workflow?"}
                        </h2>

                        <p>
                          {connectingFromNodeId
                            ? "Choose the next action, integration, or Jarvis tool"
                            : "Choose a trigger, integration, or Jarvis tool"}
                        </p>
                      </div>

                      <button
                        className="close-picker"
                        onClick={() =>
                          setShowNodePicker(false)
                        }
                      >
                        ×
                      </button>

                    </div>

                    <div className="search-box">

                      <span>⌕</span>

                      <input
                        autoFocus
                        value={search}
                        onChange={(e) =>
                          setSearch(
                            e.target.value
                          )
                        }
                        placeholder="Search nodes..."
                      />

                      {search && (
                        <button
                          onClick={() =>
                            setSearch("")
                          }
                        >
                          ×
                        </button>
                      )}

                    </div>

                    <div className="node-results">

                      {showGoogleDriveProvider && (
                        <button className="node-result provider-result" onClick={() => openProviderBrowser("Google Drive")}>
                          <GoogleDriveIcon className="provider-icon google-drive" />
                          <div className="node-result-text">
                            <div className="node-name">Google Drive</div>
                            <div className="node-description">Connect Google Drive actions and triggers</div>
                          </div>
                          <span className="node-type">PROVIDER</span>
                        </button>
                      )}

                      {showFacebookProvider && (
                        <button className="node-result provider-result" onClick={() => openProviderBrowser("Facebook")}>
                          <FacebookIcon className="provider-icon facebook" />
                          <div className="node-result-text"><div className="node-name">Facebook</div><div className="node-description">Connect Facebook and Meta Graph API actions</div></div>
                          <span className="node-type">PROVIDER</span>
                        </button>
                      )}

                      {filteredNodes.map(
                        (node) => (
                          <button
                            className="node-result"
                            key={node.id}
                            onClick={() => {
                              addNode(node);
                            }}
                          >

                            <div
                              className={`provider-icon ${node.provider
                                .toLowerCase()
                                .replaceAll(
                                  " ",
                                  "-"
                                )}`}
                            >
                              {node.provider === "Facebook" ? <FacebookIcon /> : node.icon}
                            </div>

                            <div className="node-result-text">
                              <div className="node-name">
                                {node.name}
                              </div>

                              <div className="node-description">
                                {
                                  node.description
                                }
                              </div>
                            </div>

                            <span className="node-type">
                              {node.type}
                            </span>

                          </button>
                        )
                      )}

                    </div>
                    </>
                    )}
                  </aside>
                )}

              </div>
            )}

            {workflowTab ===
              "EXECUTIONS" && (
              <ExecutionHistory executions={executions} selected={selectedExecution} onSelect={(id) => selectExecution(id).catch((error) => setWorkflowNotice({ status: "error", message: error.message }))} />
            )}

            {workflowTab ===
              "EVALUATIONS" && (
              <div className="simple-page">
                <h2>Evaluations</h2>
              </div>
            )}

          </section>
        ) : topPage === "DASHBOARD" ? (
          <section className={`dashboard-page jarvis-command-center ${isWorkflowRunning ? "workflow-running" : "workflow-idle"}`}>
            <header className="dashboard-heading"><div><span className="eyebrow">ISK · JARVIS AUTOMATION</span><h1>Command Center</h1><p>Live workflow intelligence and automation telemetry.</p></div>
              <div className={`dashboard-state ${workflowStatus}`}><span />{workflowStatus}</div></header>
            <CommandPipeline graph={dashboardGraph} workflowActive={isWorkflowRunning} workflowError={!isWorkflowRunning && workflowNotice?.status === "error"}
              healthContext={{ googleCredentials, facebookCredentials, openAIConfigured }} />
            <div className="dashboard-metrics">
              <aside className="command-panel">
                <span className="panel-kicker">CONNECTED WORKFLOW</span><strong>{dashboardGraph.nodes.length}</strong><p>Reachable workflow nodes</p>
                <div className="telemetry-line"><span>Connections</span><b>{dashboardGraph.connections.length}</b></div>
                <div className="telemetry-line"><span>Schedule triggers</span><b>{dashboardGraph.triggers.length}</b></div>
                <div className="telemetry-line"><span>Branches</span><b>{dashboardGraph.branches.length}</b></div>
              </aside>
              <aside className="command-panel">
                <span className="panel-kicker">EXECUTION TELEMETRY</span><strong>{workflowStatus}</strong><p>Current workflow state</p>
                <div className="telemetry-line"><span>Last execution</span><b>{lastExecutionAt ? new Date(lastExecutionAt).toLocaleTimeString() : "—"}</b></div>
                <div className="telemetry-line"><span>History</span><b>{executions.length}</b></div>
              </aside>
            </div>
            <div className="dashboard-status-rail"><span>Runtime linked</span><i /><span>Credentials protected</span><i /><span>Production workflow ready</span></div>
          </section>
        ) : (
          <section className="placeholder-page">
            <h1>{topPage}</h1>
          </section>
        )}

      </main>

      {colorEditor && <AdvancedColorPicker key={`${colorEditor.key}-${colorEditor.original}`} label={colorEditor.label} initialColor={colorEditor.original}
        contrastBackground={contrastBackgroundFor(colorEditor.key)} customColors={canvasAppearance.customColors}
        onPreview={(color) => updateAppearance({ [colorEditor.key]: color, preset: "custom" })}
        onConfirm={(color) => { updateAppearance({ [colorEditor.key]: color, preset: "custom" }); setColorEditor(null); }}
        onCancel={() => { updateAppearance({ [colorEditor.key]: colorEditor.original }); setColorEditor(null); }}
        onAddCustom={(color) => updateAppearance({ customColors: [...canvasAppearance.customColors, color] })} />}

      {editingNode &&
        editingNode.name ===
          "Schedule Trigger" && (
<ScheduleTriggerEditor
  node={editingNode}
  onExecuteNode={executeRuntimeNode}
  onSaveNode={updateCanvasNode}
  onClose={() => setEditingNode(null)}
/>
        )}

      {editingNode?.name === "Search Files and Folders" && (
        <GoogleDriveSearchEditor
          key={`${editingNode.id}:${editingNode.config?.credentialId || "none"}`}
          node={editingNode}
          previousNode={canvasNodes.find((candidate) => connections.some((connection) => connection.source === candidate.id && connection.target === editingNode.id))}
          credentials={googleCredentials}
          onExecutePreviousNodes={executePreviousNodesFor}
          onExecuteNode={executeRuntimeNode}
          onCreateCredential={(credentialId = null) => { pendingGoogleCredentialNodeId.current = editingNode.id; setEditingGoogleCredentialId(credentialId); setShowGoogleCredential(true); }}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode && ["Limit", "Download File", "Delete File", "Move File"].includes(editingNode.name) && (
        <Phase2NodeEditor
          key={`${editingNode.id}:${editingNode.config?.credentialId || "none"}`}
          node={editingNode}
          kind={editingNode.name === "Limit" ? "limit" : editingNode.name === "Download File" ? "download" : editingNode.name === "Move File" ? "move" : "delete"}
          previousNode={getPreviousNode(editingNode.id)}
          credentials={googleCredentials}
          onExecutePreviousNodes={executePreviousNodesFor}
          onExecuteNode={executeRuntimeNode}
          onCreateCredential={(credentialId = null) => { pendingGoogleCredentialNodeId.current = editingNode.id; setEditingGoogleCredentialId(credentialId); setShowGoogleCredential(true); }}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.name === "Facebook Graph API" && (
        <FacebookGraphEditor
          node={editingNode}
          previousNode={getPreviousNode(editingNode.id)}
          credentials={facebookCredentials}
          onCreateCredential={(credentialId = null) => { pendingFacebookCredentialNodeId.current = editingNode.id; setEditingFacebookCredentialId(credentialId); setShowFacebookCredential(true); }}
          onExecutePreviousNodes={executePreviousNodesFor}
          onExecuteNode={executeRuntimeNode}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.name === "Prepare Content" && (
        <PrepareContentEditor
          node={editingNode}
          previousNode={getPreviousNode(editingNode.id)}
          openAIConfigured={openAIConfigured}
          onExecutePreviousNodes={executePreviousNodesFor}
          onExecuteNode={executeRuntimeNode}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.provider === "Facebook" && editingNode.name !== "Facebook Graph API" && (
        <NotImplementedNodeEditor node={editingNode} onClose={() => setEditingNode(null)} />
      )}

      {showGoogleCredential && (
        <GoogleCredentialModal
          onClose={() => { setShowGoogleCredential(false); setEditingGoogleCredentialId(null); }}
          credential={googleCredentials.find((item) => item.id === editingGoogleCredentialId)}
          onSave={(credential) => {
            setGoogleCredentials((current) => [...current.filter((item) => item.id !== credential.id), credential]);
            setCredentialToast("Credential settings saved");
            setShowGoogleCredential(false);
            window.setTimeout(() => setCredentialToast(""), 3000);
          }}
          onDelete={(credentialId) => {
            deleteGoogleCredential(credentialId)
              .then(() => {
                setShowGoogleCredential(false);
                setEditingGoogleCredentialId(null);
                setCredentialToast("Google Drive credential deleted");
                window.setTimeout(() => setCredentialToast(""), 3000);
              })
              .catch((error) => setCredentialToast(error?.message || "Could not delete credential"));
          }}
          onNotify={(message) => {
            setCredentialToast(message);
            window.setTimeout(() => setCredentialToast(""), 3000);
          }}
          onStartOAuth={startGoogleOAuth}
          onDisconnect={disconnectGoogleOAuth}
        />
      )}

      {credentialToast && <div className="jarvis-credential-toast" role="status">{credentialToast}</div>}

      {showFacebookCredential && (
        <FacebookCredentialModal
          onClose={() => { setShowFacebookCredential(false); setEditingFacebookCredentialId(null); }}
          credential={facebookCredentials.find((item) => item.id === editingFacebookCredentialId)}
          onStartOAuth={startFacebookOAuth}
          onDisconnect={disconnectFacebook}
          onTestAccessToken={({ accessToken }) => testManualFacebookCredential(fetch, API_BASE_URL, accessToken)}
          onSaveAccessToken={async (payload) => {
            const saved = await saveManualFacebookCredential(fetch, API_BASE_URL, payload);
            await syncFacebookCredentials(saved.id);
            setEditingFacebookCredentialId(saved.id);
            const nodeId = pendingFacebookCredentialNodeId.current;
            if (nodeId) {
              setCanvasNodes((nodes) => nodes.map((node) => node.id === nodeId ? { ...node, config: { ...node.config, credentialId: saved.id } } : node));
              setEditingNode((node) => node?.id === nodeId ? { ...node, config: { ...node.config, credentialId: saved.id } } : node);
              pendingFacebookCredentialNodeId.current = null;
            }
            setCredentialToast("Facebook Page credential saved");
            window.setTimeout(() => setCredentialToast(""), 3000);
            return saved;
          }}
          onDeleteAccessToken={async (credentialId) => {
            await deleteManualFacebookCredential(fetch, API_BASE_URL, credentialId);
            setFacebookCredentials((items) => items.filter((item) => item.id !== credentialId));
            setEditingFacebookCredentialId(null);
            setCredentialToast("Facebook Page credential deleted");
            window.setTimeout(() => setCredentialToast(""), 3000);
          }}
        />
      )}

    </div>
  );
}

export default App;
