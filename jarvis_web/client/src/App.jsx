import { useEffect, useState } from "react";
import "./App.css";

const WORKFLOW_STORAGE_KEY = "jarvis_workflow_v2";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

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
  const [output, setOutput] = useState(null);

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

  const executeTrigger = () => {
    const now = new Date();

    const result = {
      success: true,
      trigger: "schedule",
      nodeId: node.id,
      executedAt: now.toISOString(),
      ruleCount: rules.length,
      rules: rules.map((rule, index) => ({
        rule: index + 1,
        interval: rule.interval,
      })),
    };

    setOutput(result);
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

                <button onClick={executeTrigger}>
                  Test this trigger
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
  onUpdate,
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
    const now = new Date().toISOString();
    onSave({ id: credential?.id ?? "google_drive_main", name: credentialName.trim() || "Google Drive account", provider: "google-drive", type: "oauth2", status, authMode, allowedDomains, visibility, createdAt: credential?.createdAt ?? now, updatedAt: now });
  };

  const disconnectCredential = async () => {
    setConnectionMessage("Disconnecting Google Drive...");

    try {
      await onDisconnect();
      const updated = { ...(credential ?? {}), id: credential?.id ?? "google_drive_main", name: credentialName.trim() || "Google Drive account", provider: "google-drive", type: "oauth2", status: "not_connected", authMode, allowedDomains, visibility, updatedAt: new Date().toISOString() };
      setStatus("not_connected");
      setConnectionMessage("Google Drive credential disconnected.");
      onUpdate(updated, "Google Drive credential disconnected");
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
            <button type="button" className="credential-delete-button" onClick={() => setShowDeleteConfirmation(true)} aria-label="Delete credential" title="Delete credential">⌫</button>
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

            {status === "connected" ? <div className="credential-connected"><span>✓</span><strong>Account connected{credential?.accountEmail ? ` · ${credential.accountEmail}` : ""}</strong><div><button type="button" onClick={onStartOAuth}>Switch account</button><button type="button" className="disconnect-button" onClick={disconnectCredential}>Disconnect</button></div></div> : <div className="credential-warning"><span>⚠</span><span>Connect your account to use this credential</span><button type="button" onClick={onStartOAuth}>Sign in with Google</button></div>}
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
            {activeTab === "Details" && <div className="credential-metadata-panel"><h3>Credential details</h3><dl><div><dt>Credential ID/reference</dt><dd>{credential?.id ?? "google_drive_main"}</dd></div><div><dt>Provider</dt><dd>Google Drive</dd></div><div><dt>Credential type</dt><dd>OAuth2</dd></div><div><dt>Status</dt><dd>{status}</dd></div><div><dt>Created</dt><dd>{credential?.createdAt ?? "Saved when settings are first saved"}</dd></div><div><dt>Updated</dt><dd>{credential?.updatedAt ?? "Not saved yet"}</dd></div></dl></div>}
          </section>
        </div>
        {showDeleteConfirmation && <div className="credential-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-credential-title"><div className="credential-confirm-modal"><h3 id="delete-credential-title">Delete credential?</h3><p>Delete "{credentialName.trim() || "Google Drive account"}"?</p><div><button type="button" onClick={() => setShowDeleteConfirmation(false)}>Cancel</button><button type="button" className="confirm-delete" onClick={() => onDelete(credential?.id ?? "google_drive_main")}>Delete</button></div></div></div>}
      </div>
    </div>
  );
}

function FacebookCredentialModal({ onClose, onSave }) {
  const [credentialName, setCredentialName] = useState("Facebook Graph account");
  const [connectionMessage, setConnectionMessage] = useState("");
  return (
    <div className="credential-modal-overlay">
      <div className="credential-modal">
        <header className="credential-modal-header">
          <div className="credential-modal-title"><FacebookIcon className="facebook-provider-logo" /><div><input className="credential-name-input" value={credentialName} onChange={(event) => setCredentialName(event.target.value)} /><div className="credential-subtitle">Meta Graph API</div></div></div>
          <div className="credential-modal-actions"><button onClick={() => onSave(credentialName)}>Save</button><button onClick={onClose}>×</button></div>
        </header>
        <div className="credential-modal-body">
          <aside className="credential-tabs"><button className="credential-tab-active">Connection</button><button>Sharing</button><button>Details</button></aside>
          <section className="credential-content">
            <div className="credential-content-top"><h3>Credential Type</h3><strong>Meta Access Token</strong></div>
            <div className="meta-connection-state"><span className="meta-status-dot" /> <strong>Not connected</strong><button onClick={() => setConnectionMessage("Facebook authentication backend is not configured. No connection was attempted.")}>Connect Meta Account</button></div>
            <p>Authentication will be completed securely through the Jarvis backend.</p>
            {connectionMessage && <div className="credential-backend-status" role="status">{connectionMessage}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

function GoogleDriveSearchEditor({
  node,
  onClose,
  onSaveNode,
  previousNode,
  onCreateCredential,
  credentials,
}) {
  const [activeTab, setActiveTab] = useState("Parameters");
  const [inputTab, setInputTab] = useState("Schema");
  const [outputTab, setOutputTab] = useState("Schema");
  const [input, setInput] = useState(null);
  const [output, setOutput] = useState(null);

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

  const executeStep = () => {
    setOutput({
      status: "not_configured",
      configured: false,
      provider: "google-drive",
      operation: "search-files-and-folders",
      message:
        "Google Drive is not connected yet. Configure a Google Drive credential before real execution.",
      request: {
        resource: config.resource,
        operation: config.operation,
        searchMethod: config.searchMethod,
        query: config.query,
        folderId: config.folderId,
        mimeType: config.mimeType,
        returnAll: config.returnAll,
        limit: Number(config.limit) || 0,
      },
    });
  };

  const executePreviousNodes = () => {
    const now = new Date();
    setInput({
      timestamp: now.toISOString(),
      "Readable date": now.toLocaleDateString(),
      "Readable time": now.toLocaleTimeString(),
      "Day of week": now.toLocaleDateString(undefined, { weekday: "long" }),
      Year: now.getFullYear(),
      Month: now.getMonth() + 1,
      "Day of month": now.getDate(),
      Hour: now.getHours(),
      Minute: now.getMinutes(),
      Second: now.getSeconds(),
      Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
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
              >
                Execute previous nodes
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
              >
                Execute step
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
                        <option key={credential.id} value={credential.id}>{credential.name}</option>
                      ))}
                      <option value="__create__">
                        + Create new credential
                      </option>
                    </select>

                    <button
                      type="button"
                      className="credential-button"
                      onClick={onCreateCredential}
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
  if (nodeId === "facebook-graph-api") return { credentialId: "", method: "GET", apiVersion: "", endpoint: "", queryParameters: [], headers: [], bodyParameters: [], sendBinaryData: false, binaryProperty: "data", pageVideo: { pageId: "", description: "", published: false }, settings: defaultNodeSettings() };
  return null;
}

function NodeInputPanel({ previousNode, input, onInputChange, allowMock = false }) {
  const [tab, setTab] = useState("Schema");

  const loadPreviousOutput = () => {
    if (previousNode?.output != null) onInputChange(previousNode.output);
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

function Phase2NodeEditor({ node, kind, previousNode, credentials, onCreateCredential, onSaveNode, onClose }) {
  const isLimit = kind === "limit";
  const isDownload = kind === "download";
  const defaults = isLimit
    ? { maxItems: 1, keep: "First Items", settings: defaultNodeSettings() }
    : { credentialId: "", resource: "File", operation: isDownload ? "Download" : "Delete", fileIdMode: "Expression", fileId: "{{ $json.id }}", binaryProperty: "data", requireConfirmation: true, settings: defaultNodeSettings() };
  const [activeTab, setActiveTab] = useState("Parameters");
  const [config, setConfig] = useState({ ...defaults, ...node.config, settings: { ...defaults.settings, ...node.config?.settings } });
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);

  const updateSetting = (key, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const persist = (changes = {}) => onSaveNode({ ...node, config, input, output, status: node.status ?? "idle", ...changes });

  const executeStep = async () => {
    persist({ status: "running", input, output });
    await Promise.resolve();
    let result;
    let status;
    if (isLimit) {
      if (!Array.isArray(input)) {
        result = { status: "error", message: "Limit requires an input array. Execute previous nodes or provide clearly labeled mock input." };
        status = "error";
      } else {
        const count = Math.max(1, Number(config.maxItems) || 1);
        result = config.keep === "Last Items" ? input.slice(-count) : input.slice(0, count);
        status = "success";
      }
    } else {
      result = {
        status: "not_configured",
        provider: "google-drive",
        operation: isDownload ? "download-file" : "delete-file",
        message: "Google Drive backend/credential is not configured",
      };
      status = "not_configured";
    }
    setOutput(result);
    onSaveNode({ ...node, config, input, output: result, status });
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
          <NodeInputPanel previousNode={previousNode} input={input} onInputChange={setInput} allowMock={isLimit} />
          <section className="node-config-panel google-config-panel">
            <div className="node-editor-tabs">
              {["Parameters", "Settings"].map((tab) => <button key={tab} className={activeTab === tab ? "node-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
              <button className="execute-step" onClick={executeStep}>Execute step</button>
            </div>
            <div className="node-config-scroll">
              {activeTab === "Parameters" ? (
                <div className="drive-parameters">
                  {isLimit ? <>
                    <label>Max Items</label><input type="number" min="1" value={config.maxItems} onChange={(event) => setConfig({ ...config, maxItems: Math.max(1, Number(event.target.value) || 1) })} />
                    <label>Keep</label><select value={config.keep} onChange={(event) => setConfig({ ...config, keep: event.target.value })}><option>First Items</option><option>Last Items</option></select>
                  </> : <>
                    <label>Credential</label>
                    <div className="credential-row"><select value={config.credentialId} onChange={(event) => event.target.value === "__create__" ? onCreateCredential() : setConfig({ ...config, credentialId: event.target.value })}><option value="">Select credential</option>{config.credentialId && !credentials.some((credential) => credential.id === config.credentialId) && <option value={config.credentialId}>Credential missing</option>}{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}<option value="__create__">+ Create new credential</option></select><button className="credential-button" onClick={onCreateCredential}>✎</button></div>
                    <label>Resource</label><select value={config.resource} disabled><option>File</option></select>
                    <label>Operation</label><select value={config.operation} disabled><option>{config.operation}</option></select>
                    <label>File ID</label><div className="value-mode-switch">{["Fixed", "Expression"].map((mode) => <button key={mode} className={config.fileIdMode === mode ? "active" : ""} onClick={() => setConfig({ ...config, fileIdMode: mode })}>{mode}</button>)}</div>
                    <input value={config.fileId} onChange={(event) => setConfig({ ...config, fileId: event.target.value })} placeholder={config.fileIdMode === "Expression" ? "{{ $json.id }}" : "Google Drive file ID"} />
                    {isDownload ? <><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /><div className="config-section-row"><span>Options</span><button>+</button></div><button className="config-add-button">+ Add option</button></> : <><ToggleSetting label="Require Confirmation" value={config.requireConfirmation} onChange={() => setConfig({ ...config, requireConfirmation: !config.requireConfirmation })} /><div className="destructive-warning">This action can permanently delete a file. Confirmation is required before destructive execution.</div></>}
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

function FacebookGraphEditor({ node, previousNode, credentials, onCreateCredential, onSaveNode, onClose }) {
  const defaults = { credentialId: "", method: "GET", apiVersion: "", endpoint: "", queryParameters: [], headers: [], bodyParameters: [], sendBinaryData: false, binaryProperty: "data", pageVideo: { pageId: "", description: "", published: false }, settings: defaultNodeSettings() };
  const [activeTab, setActiveTab] = useState("Parameters");
  const [config, setConfig] = useState({ ...defaults, ...node.config, pageVideo: { ...defaults.pageVideo, ...node.config?.pageVideo }, settings: { ...defaults.settings, ...node.config?.settings } });
  const [input, setInput] = useState(node.input ?? previousNode?.output ?? null);
  const [output, setOutput] = useState(node.output ?? null);
  const [validationMessage, setValidationMessage] = useState("");
  const updateSetting = (key, value) => setConfig((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const showPageVideo = config.method === "POST" && config.endpoint.toLowerCase().includes("videos");

  const executeStep = async () => {
    onSaveNode({ ...node, config, input, output, status: "running" });
    await Promise.resolve();
    let message = "";
    if (!["GET", "POST", "DELETE"].includes(config.method)) message = "HTTP Method is invalid";
    else if (!config.endpoint.trim()) message = "Endpoint is required";
    else if (config.sendBinaryData && !config.binaryProperty.trim()) message = "Binary Property is required when Send Binary Data is enabled";
    else if (showPageVideo && (config.pageVideo.description || config.pageVideo.published) && !config.pageVideo.pageId.trim()) message = "Page ID is required when Facebook Page Video helpers are configured";
    if (message) {
      const result = { status: "error", message };
      setValidationMessage(message); setOutput(result); onSaveNode({ ...node, config, input, output: result, status: "error" }); return;
    }
    setValidationMessage("");
    const result = { status: "not_configured", provider: "facebook", operation: "graph-api", message: "Facebook Graph API backend/credential is not configured", request: { method: config.method, version: config.apiVersion, endpoint: config.endpoint } };
    setOutput(result); onSaveNode({ ...node, config, input, output: result, status: "not_configured" });
  };
  const saveAndClose = () => { onSaveNode({ ...node, config, input, output, status: node.status ?? "idle" }); onClose(); };
  const updatePageVideo = (key, value) => setConfig((current) => ({ ...current, pageVideo: { ...current.pageVideo, [key]: value } }));

  return (
    <div className="node-editor-overlay"><div className="node-editor-window">
      <header className="node-editor-header"><div className="node-editor-title"><FacebookIcon className="facebook-title-icon" /><strong>Facebook Graph API</strong></div><div className="node-editor-header-actions"><button className="node-editor-close" onClick={saveAndClose}>×</button></div></header>
      <div className="node-editor-body google-three-column">
        <NodeInputPanel previousNode={previousNode} input={input} onInputChange={setInput} />
        <section className="node-config-panel google-config-panel"><div className="node-editor-tabs">{["Parameters", "Settings"].map((tab) => <button key={tab} className={activeTab === tab ? "node-tab-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}<button className="execute-step" onClick={executeStep}>Execute step</button></div>
          <div className="node-config-scroll">{activeTab === "Parameters" ? <div className="drive-parameters facebook-parameters">
            {validationMessage && <div className="field-validation" role="alert">{validationMessage}</div>}
            <label>Credential</label><div className="credential-row"><select value={config.credentialId} onChange={(event) => event.target.value === "__create__" ? onCreateCredential() : setConfig({ ...config, credentialId: event.target.value })}><option value="">Select credential</option>{credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}<option value="__create__">+ Create new credential</option></select><button className="credential-button" onClick={onCreateCredential}>✎</button></div>
            <label>HTTP Method</label><select value={config.method} onChange={(event) => setConfig({ ...config, method: event.target.value })}><option>GET</option><option>POST</option><option>DELETE</option></select>
            <label>Graph API Version</label><input value={config.apiVersion} onChange={(event) => setConfig({ ...config, apiVersion: event.target.value })} placeholder="vXX.X" />
            <label>Endpoint / Node</label><input value={config.endpoint} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} placeholder="me, me/accounts, {page-id}/feed, {page-id}/videos" /><small>Examples only: me, me/accounts, {'{page-id}'}/feed, {'{page-id}'}/videos</small>
            <ParameterList title="Query Parameters" addLabel="Add Parameter" items={config.queryParameters} onChange={(items) => setConfig({ ...config, queryParameters: items })} />
            <ParameterList title="Headers" addLabel="Add Header" items={config.headers} onChange={(items) => setConfig({ ...config, headers: items })} />
            <ParameterList title="Body Parameters" addLabel="Add Parameter" items={config.bodyParameters} onChange={(items) => setConfig({ ...config, bodyParameters: items })} />
            <ToggleSetting label="Send Binary Data" value={config.sendBinaryData} onChange={() => setConfig({ ...config, sendBinaryData: !config.sendBinaryData })} />
            {config.sendBinaryData && <><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /><small>Binary property from a previous node, for example data.</small></>}
            {showPageVideo && <div className="page-video-helper"><h3>Facebook Page Video</h3><label>Page ID</label><input value={config.pageVideo.pageId} onChange={(event) => updatePageVideo("pageId", event.target.value)} /><label>Caption / Description</label><textarea rows="4" value={config.pageVideo.description} onChange={(event) => updatePageVideo("description", event.target.value)} /><ToggleSetting label="Published" value={config.pageVideo.published} onChange={() => updatePageVideo("published", !config.pageVideo.published)} /><label>Binary Property</label><input value={config.binaryProperty} onChange={(event) => setConfig({ ...config, binaryProperty: event.target.value })} /></div>}
          </div> : <GenericNodeSettings settings={config.settings} onChange={updateSetting} version="Facebook Graph API node version 1.0" />}</div>
        </section>
        <NodeOutputPanel output={output} onExecute={executeStep} allowMock onMock={() => setOutput({ status: "MOCK", provider: "facebook", message: "Explicit mock output. No Facebook request was made." })} />
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
  if (tab === "JSON") {
    return (
      <pre className="json-output">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  if (tab === "Table") {
    if (Array.isArray(output)) {
      const columns = [...new Set(output.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : ["value"]))];
      return (
        <div className="array-table-wrap"><table className="array-output-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{output.map((item, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(item && typeof item === "object" ? item[column] ?? "" : item)}</td>)}</tr>)}</tbody></table></div>
      );
    }
    return (
      <div className="output-table">
        {Object.entries(output).map(
          ([key, value]) => (
            <div
              className="output-table-row"
              key={key}
            >
              <strong>{key}</strong>

              <span>
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
              </span>
            </div>
          )
        )}
      </div>
    );
  }


  if (Array.isArray(output)) {
    const sample = output.find((item) => item && typeof item === "object");
    return (
      <div className="schema-output">
        <div><strong>items</strong><span>array ({output.length})</span></div>
        {sample && Object.entries(sample).map(([key, value]) => <div key={key}><strong>{key}</strong><span>{Array.isArray(value) ? "array" : typeof value}</span></div>)}
      </div>
    );
  }

  return (
    <div className="schema-output">
      {Object.entries(output).map(
        ([key, value]) => (
          <div key={key}>
            <strong>{key}</strong>
            <span>
              {Array.isArray(value)
                ? "array"
                : typeof value}
            </span>
          </div>
        )
      )}
    </div>
  );
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

  const [editingNode, setEditingNode] =
    useState(null);

  const [connections, setConnections] = useState([]);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState(null);
  const [providerBrowser, setProviderBrowser] = useState(null);
  const [showGoogleCredential, setShowGoogleCredential] = useState(false);
  const [googleCredentials, setGoogleCredentials] = useState([]);
  const [credentialToast, setCredentialToast] = useState("");
  const [showFacebookCredential, setShowFacebookCredential] = useState(false);
  const [facebookCredentials, setFacebookCredentials] = useState([]);

  const syncGoogleCredential = async ({ showToast = false } = {}) => {
    const response = await fetch(`${API_BASE_URL}/api/google/credential/status`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Credential status request failed (${response.status}).`);
    }

    const data = await response.json();
    const connected = Boolean(data?.connected ?? (data?.status === "connected"));
    const now = new Date().toISOString();

    setGoogleCredentials((current) => {
      const existing = current.find((item) => item.id === "google_drive_main");
      const credential = {
        ...(existing ?? {}),
        id: data?.id ?? "google_drive_main",
        name: existing?.name ?? data?.name ?? "Google Drive account",
        provider: "google-drive",
        type: "oauth2",
        status: connected ? "connected" : "not_connected",
        accountEmail: data?.accountEmail ?? existing?.accountEmail ?? "",
        accountName: data?.accountName ?? existing?.accountName ?? "",
        authMode: existing?.authMode ?? "managed_oauth2",
        allowedDomains: existing?.allowedDomains ?? "none",
        visibility: existing?.visibility ?? "private",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      return [
        ...current.filter((item) => item.id !== "google_drive_main"),
        credential,
      ];
    });

    if (showToast && connected) {
      setCredentialToast(
        data?.accountEmail
          ? `Google Drive connected: ${data.accountEmail}`
          : "Google Drive account connected"
      );
      setShowGoogleCredential(true);
      window.setTimeout(() => setCredentialToast(""), 3500);
    }

    return { connected, data };
  };

  const startGoogleOAuth = () => {
    const width = 560;
    const height = 720;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      `${API_BASE_URL}/api/google/auth/start?mode=popup`,
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

  const disconnectGoogleOAuth = async () => {
    const response = await fetch(`${API_BASE_URL}/api/google/auth/disconnect`, {
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

    setGoogleCredentials((current) =>
      current.map((item) =>
        item.id === "google_drive_main"
          ? {
              ...item,
              status: "not_connected",
              accountEmail: "",
              accountName: "",
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  };

  useEffect(() => {
    let cancelled = false;

    const handleOAuthMessage = async (event) => {
      let backendOrigin;
      try {
        backendOrigin = new URL(API_BASE_URL).origin;
      } catch {
        return;
      }

      if (event.origin !== backendOrigin) return;
      if (event.data?.type !== "jarvis-google-oauth") return;

      if (event.data.status === "connected") {
        try {
          if (!cancelled) {
            await syncGoogleCredential({ showToast: true });
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

    const clearOAuthQuery = () => {
      if (!oauthResult) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("google_oauth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const initialSync = async () => {
      try {
        const result = await syncGoogleCredential({
          showToast: oauthResult === "connected",
        });

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
    try {
      const saved = localStorage.getItem(WORKFLOW_STORAGE_KEY);
      if (!saved) return;

      const workflow = JSON.parse(saved);
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

  const updateCanvasNode = (updatedNode) => {
    setCanvasNodes((nodes) =>
      nodes.map((node) =>
        node.id === updatedNode.id ? updatedNode : node
      )
    );

    setEditingNode(updatedNode);
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
        JSON.stringify(workflow)
      );

      window.alert("Workflow saved");
    } catch (error) {
      console.error("Could not save Jarvis workflow:", error);
      window.alert("Could not save workflow");
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

    setCanvasNodes((nodes) => [...nodes, newNode]);

    if (connectingFromNodeId) {
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
    setSearch("");

    if (nodeDefinition.id === "schedule-trigger") {
      setEditingNode(newNode);
    }
  };

  const getPreviousNode = (nodeId) => {
    const connection = connections.find((item) => item.target === nodeId);
    return connection ? canvasNodes.find((item) => item.id === connection.source) : null;
  };

  return (
    <div className="jarvis-app">

      <aside className="sidebar">

        <div className="brand">
          <div className="jarvis-logo">J</div>

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

            <div className="workflow-header">

              <div className="workflow-title">
                <div className="breadcrumb">
                  Jarvis / Workflow
                </div>

                <h1>My Workflow</h1>
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
                    onClick={() =>
                      setWorkflowTab(tab)
                    }
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="workflow-actions">
                <button className="run-button">
                  ▶ Run Workflow
                </button>

                <button onClick={saveWorkflow}>Save</button>

                <button className="publish-button">
                  Publish
                </button>
              </div>
            </div>

            {workflowTab === "EDITOR" && (
              <div className="editor-layout">

                <div className="workflow-canvas">

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

                  {canvasNodes.length > 0 && (
                    <svg className="workflow-connections" aria-hidden="true">
                      {connections.map((connection) => {
                        const source = canvasNodes.find((node) => node.id === connection.source);
                        const target = canvasNodes.find((node) => node.id === connection.target);

                        if (!source || !target) return null;

                        const sourceX = (source.x ?? 140) + 120;
                        const sourceY = (source.y ?? 200) + 55;
                        const targetX = target.x ?? 140;
                        const targetY = (target.y ?? 200) + 55;
                        const curve = Math.max(70, (targetX - sourceX) * 0.45);

                        return (
                          <path
                            key={connection.id}
                            d={`M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`}
                            className="workflow-connection-path"
                          />
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
                        (node, index) => (
                         <div
  key={node.id}
  className="workflow-node"
  style={{
    left: node.x ?? 140 + index * 180,
    top: node.y ?? 200 + (index % 2) * 100,
  }}
  onClick={() => setEditingNode(node)}
  role="button"
  tabIndex={0}
>
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
                              {node.provider === "Facebook" ? <FacebookIcon /> : node.icon}
                            </div>

                            <strong>
                              {node.name}
                            </strong>

                            <small>
                              {node.type}
                            </small>

                            <span className={`node-status-indicator ${node.status ?? "idle"}`} title={`Status: ${node.status ?? "idle"}`} />

                            <button
                              className="node-output-port"
                              onClick={(event) => {
                                event.stopPropagation();
                                openNextNodePicker(node.id);
                              }}
                              title="Add next step"
                            >
                              +
                            </button>
                          </div>
                        )
                      )}

                    </div>
                  )}

                  <div className="zoom-tools">
                    <button>⌗</button>
                    <button>＋</button>
                    <button>−</button>
                    <button>↖</button>
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
              <div className="simple-page">
                <h2>Executions</h2>
                <p>
                  No workflow executions yet.
                </p>
              </div>
            )}

            {workflowTab ===
              "EVALUATIONS" && (
              <div className="simple-page">
                <h2>Evaluations</h2>
              </div>
            )}

          </section>
        ) : (
          <section className="placeholder-page">
            <h1>{topPage}</h1>
          </section>
        )}

      </main>

      {editingNode &&
        editingNode.name ===
          "Schedule Trigger" && (
<ScheduleTriggerEditor
  node={editingNode}
  onSaveNode={updateCanvasNode}
  onClose={() => setEditingNode(null)}
/>
        )}

      {editingNode?.name === "Search Files and Folders" && (
        <GoogleDriveSearchEditor
          node={editingNode}
          previousNode={canvasNodes.find((candidate) => connections.some((connection) => connection.source === candidate.id && connection.target === editingNode.id))}
          credentials={googleCredentials}
          onCreateCredential={() => setShowGoogleCredential(true)}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode && ["Limit", "Download File", "Delete File"].includes(editingNode.name) && (
        <Phase2NodeEditor
          node={editingNode}
          kind={editingNode.name === "Limit" ? "limit" : editingNode.name === "Download File" ? "download" : "delete"}
          previousNode={getPreviousNode(editingNode.id)}
          credentials={googleCredentials}
          onCreateCredential={() => setShowGoogleCredential(true)}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.name === "Facebook Graph API" && (
        <FacebookGraphEditor
          node={editingNode}
          previousNode={getPreviousNode(editingNode.id)}
          credentials={facebookCredentials}
          onCreateCredential={() => setShowFacebookCredential(true)}
          onSaveNode={updateCanvasNode}
          onClose={() => setEditingNode(null)}
        />
      )}

      {editingNode?.provider === "Facebook" && editingNode.name !== "Facebook Graph API" && (
        <NotImplementedNodeEditor node={editingNode} onClose={() => setEditingNode(null)} />
      )}

      {showGoogleCredential && (
        <GoogleCredentialModal
          onClose={() => setShowGoogleCredential(false)}
          credential={googleCredentials.find((item) => item.id === "google_drive_main")}
          onSave={(credential) => {
            setGoogleCredentials((current) => [...current.filter((item) => item.id !== credential.id), credential]);
            setCredentialToast("Credential settings saved");
            setShowGoogleCredential(false);
            window.setTimeout(() => setCredentialToast(""), 3000);
          }}
          onUpdate={(credential, message) => {
            setGoogleCredentials((current) => [...current.filter((item) => item.id !== credential.id), credential]);
            setCredentialToast(message);
            window.setTimeout(() => setCredentialToast(""), 3000);
          }}
          onDelete={(credentialId) => {
            setGoogleCredentials((current) => current.filter((item) => item.id !== credentialId));
            setShowGoogleCredential(false);
            setCredentialToast("Credential metadata deleted");
            window.setTimeout(() => setCredentialToast(""), 3000);
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
          onClose={() => setShowFacebookCredential(false)}
          onSave={(name) => {
            setFacebookCredentials((current) => [...current, { id: `facebook-${Date.now()}`, name, provider: "facebook", status: "not_connected" }]);
            setShowFacebookCredential(false);
          }}
        />
      )}

    </div>
  );
}

export default App;