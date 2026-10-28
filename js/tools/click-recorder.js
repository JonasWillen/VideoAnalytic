// tools/click-recorder.js — manual timestamp recorder.
//
// Start a session, then tap "Record click" (or press Space) each time the
// athlete performs the marked event (rep, contact, shot…). Every click is
// logged with an absolute timestamp plus seconds elapsed since the session
// start, listed live in a session log, and exportable as JSON.

export const clickRecorderTool = {
  name: "click-recorder",
  stream: null,
  setStatus: null,
  sessionActive: false,
  sessionStart: null,
  clicks: [],

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">🖱️ Click Recorder</h2>
      <p class="tool-desc">Start a session, tap Record (or press Space) to log an event, then export the timestamps as JSON.</p>

      <div class="tool-controls">
        <span class="cr-status">
          <span class="cr-dot" id="cr-dot"></span>
          <span id="cr-status-label">Not started</span>
          <span class="cr-count" id="cr-count">0 clicks</span>
        </span>
      </div>

      <div class="tool-controls">
        <button type="button" class="tool-btn cr-start" id="cr-start" style="width:auto">▶ Start</button>
        <button type="button" class="tool-btn cr-stop" id="cr-stop" style="width:auto" disabled>■ Stop</button>
      </div>

      <div class="tool-controls">
        <button type="button" class="tool-btn cr-record" id="cr-record" disabled>● Record click</button>
      </div>

      <div class="tool-controls">
        <span class="value cr-log-header">Session log</span>
      </div>
      <div class="cr-log" id="cr-log">
        <span class="cr-log-empty" id="cr-log-empty">Clicks will appear here…</span>
      </div>

      <div class="tool-controls">
        <button type="button" class="tool-btn cr-download" id="cr-download" style="width:auto" hidden>⬇ Download JSON</button>
      </div>
    `;
  },

  init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream; // unused; this tool is camera-independent.
    this.setStatus = setStatus;
    this.container = container;
    this.sessionActive = false;
    this.clicks = [];

    container.querySelector("#cr-start").addEventListener("click", () => this.startSession());
    container.querySelector("#cr-stop").addEventListener("click", () => this.stopSession());
    container.querySelector("#cr-record").addEventListener("click", () => this.recordClick());
    container.querySelector("#cr-download").addEventListener("click", () => this.downloadJSON());

    this.keyHandler = (e) => {
      if (e.code !== "Space" || !this.sessionActive) return;
      e.preventDefault();
      this.recordClick();
    };
    document.addEventListener("keydown", this.keyHandler);

    setStatus("Start a session to begin recording clicks.", "");
  },

  startSession() {
    const c = this.container;
    this.sessionActive = true;
    this.sessionStart = new Date();
    this.clicks = [];
    this.clearLog();
    c.querySelector("#cr-start").disabled = true;
    c.querySelector("#cr-stop").disabled = false;
    c.querySelector("#cr-record").disabled = false;
    c.querySelector("#cr-download").hidden = true;
    c.querySelector("#cr-dot").classList.add("active");
    c.querySelector("#cr-status-label").textContent = "Recording…";
    this.updateCount();
    this.setStatus("Session started — tap Record or press Space.", "ok");
  },

  stopSession() {
    const c = this.container;
    this.sessionActive = false;
    c.querySelector("#cr-start").disabled = false;
    c.querySelector("#cr-stop").disabled = true;
    c.querySelector("#cr-record").disabled = true;
    c.querySelector("#cr-dot").classList.remove("active");
    c.querySelector("#cr-status-label").textContent = this.clicks.length
      ? `Stopped — ${this.clicks.length} click${this.clicks.length !== 1 ? "s" : ""} recorded`
      : "Stopped — no clicks recorded";
    if (this.clicks.length > 0) c.querySelector("#cr-download").hidden = false;
    this.setStatus("Session stopped.", "");
  },

  recordClick() {
    if (!this.sessionActive) return;
    const c = this.container;
    const now = new Date();
    const elapsed = parseFloat(((now - this.sessionStart) / 1000).toFixed(3));
    const entry = {
      index: this.clicks.length + 1,
      timestamp: now.toISOString(),
      elapsed_seconds: elapsed,
    };
    this.clicks.push(entry);

    const btn = c.querySelector("#cr-record");
    const ripple = document.createElement("span");
    ripple.className = "cr-ripple";
    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());

    this.addLogRow(entry);
    this.updateCount();
  },

  addLogRow(entry) {
    const log = this.container.querySelector("#cr-log");
    const empty = this.container.querySelector("#cr-log-empty");
    if (empty) empty.remove();
    const row = document.createElement("div");
    row.className = "cr-log-entry";
    const t = new Date(entry.timestamp);
    const hms = t.toLocaleTimeString("sv-SE", { hour12: false }) + "." + String(t.getMilliseconds()).padStart(3, "0");
    row.innerHTML = `
      <span class="cr-log-index">${entry.index}</span>
      <span class="cr-log-time">${hms}</span>
      <span class="cr-log-elapsed">+${entry.elapsed_seconds}s</span>
    `;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  },

  clearLog() {
    this.container.querySelector("#cr-log").innerHTML =
      '<span class="cr-log-empty" id="cr-log-empty">Clicks will appear here…</span>';
    this.updateCount();
  },

  updateCount() {
    const n = this.clicks.length;
    this.container.querySelector("#cr-count").textContent = `${n} click${n !== 1 ? "s" : ""}`;
  },

  downloadJSON() {
    const payload = {
      session_start: this.sessionStart.toISOString(),
      session_end: new Date().toISOString(),
      total_clicks: this.clicks.length,
      clicks: this.clicks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `click-log-${this.sessionStart.toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  stop() {
    this.sessionActive = false;
    this.clicks = [];
    if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = null;
    this.stream = null;
  },
};
