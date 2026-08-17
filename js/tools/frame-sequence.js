// tools/frame-sequence.js — extract a sequence of 10 frames from a video.
//
// The user uploads (or records) a video, picks a start point and the time
// between frames, and the tool seeks through the video capturing 10 stills
// at that interval (default ~100 ms apart, i.e. ~3 frames at 30 fps). The
// captured frames are shown as a labeled strip and each one can be
// downloaded.
//
// Frame capture is done by seeking a hidden <video> to each target time and
// drawing the decoded frame to an offscreen <canvas> on the 'seeked' event.

const FRAME_COUNT = 10;

export const frameSequenceTool = {
  name: "frame-sequence",
  stream: null,
  video: null,
  setStatus: null,
  frames: [], // [{ canvas, time, url }]

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">🎞️ Frame Sequence</h2>
      <p class="tool-desc">Extract 10 frames from a recorded video at a chosen interval (default ~100 ms apart). Pick the start point and the time between each frame, then capture.</p>

      <div class="tool-controls">
        <label class="tool-btn" style="width:auto;cursor:pointer">
          ⬆ Upload video
          <input type="file" id="fs-upload" accept="video/*" hidden />
        </label>
        <span id="fs-file" class="value">No file</span>
      </div>

      <div class="tool-controls fs-seek-row">
        <label>Start:</label>
        <input type="range" id="fs-start" min="0" max="1" step="0.01" value="0" />
        <span class="value" id="fs-start-val">0.00s</span>
        <label style="margin-left:16px">Interval (ms):</label>
        <input type="number" id="fs-interval" min="16" max="10000" step="1" value="100" style="width:90px" />
      </div>

      <div class="tool-controls">
        <button id="fs-capture" type="button" class="tool-btn" style="width:auto" disabled>📸 Capture 10 frames</button>
        <button id="fs-download-all" type="button" class="tool-btn" style="width:auto" disabled>⬇ Download all</button>
        <span id="fs-info" class="value"></span>
      </div>

      <div id="fs-preview" class="fs-preview"></div>
      <div id="fs-strip" class="fs-strip"></div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream; // unused; this tool works on an uploaded file.
    this.setStatus = setStatus;

    // hidden video element used to decode + seek the uploaded file
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;

    const upload = container.querySelector("#fs-upload");
    const start = container.querySelector("#fs-start");
    const startVal = container.querySelector("#fs-start-val");
    const interval = container.querySelector("#fs-interval");
    const captureBtn = container.querySelector("#fs-capture");
    const dlAllBtn = container.querySelector("#fs-download-all");
    const info = container.querySelector("#fs-info");

    this.container = container;

    upload.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.resetFrames();
      container.querySelector("#fs-file").textContent = file.name;
      setStatus("Loading video…", "warn");
      await this.loadVideo(file);
      const dur = this.video.duration;
      if (!dur || !isFinite(dur)) {
        setStatus("Could not read video duration", "err");
        return;
      }
      // start slider spans the safe range: 0 .. (duration - 10*interval)
      this.updateStartRange(container, dur);
      captureBtn.disabled = false;
      setStatus(`Loaded: ${dur.toFixed(2)}s`, "ok");
      info.textContent = `duration ${dur.toFixed(2)}s · ${this.video.videoWidth}×${this.video.videoHeight}`;
      this.drawPreview(container, +start.value);
    });

    // Live-seek the preview while scrubbing the start point.
    start.addEventListener("input", () => {
      const t = +start.value;
      startVal.textContent = t.toFixed(2) + "s";
      this.drawPreview(container, t);
    });

    captureBtn.addEventListener("click", () => this.capture(container, setStatus, dlAllBtn));
    dlAllBtn.addEventListener("click", () => this.downloadAll());

    setStatus("Upload a video to begin.", "");
  },

  loadVideo(file) {
    return new Promise((resolve) => {
      const onMeta = () => {
        this.video.removeEventListener("loadedmetadata", onMeta);
        resolve();
      };
      this.video.addEventListener("loadedmetadata", onMeta);
      this.video.src = URL.createObjectURL(file);
      this.video.load();
      setTimeout(() => { this.video.removeEventListener("loadedmetadata", onMeta); resolve(); }, 1500);
    });
  },

  // The start point must leave room for 10 frames at the chosen interval.
  updateStartRange(container, dur) {
    const interval = +container.querySelector("#fs-interval").value / 1000;
    const span = Math.max(0, (FRAME_COUNT - 1) * interval);
    const maxStart = Math.max(0, dur - span);
    const start = container.querySelector("#fs-start");
    start.max = String(maxStart.toFixed(3));
    start.step = "0.01";
    start.value = "0";
    container.querySelector("#fs-start-val").textContent = "0.00s";
    container.querySelector("#fs-capture").disabled = false;
  },

  // Seek the hidden video to t and draw the frame into the preview canvas.
  drawPreview(container, t) {
    const wrap = container.querySelector("#fs-preview");
    wrap.innerHTML = "";
    if (!this.video.src) return;
    const canvas = document.createElement("canvas");
    canvas.className = "fs-preview-canvas";
    canvas.width = this.video.videoWidth || 640;
    canvas.height = this.video.videoHeight || 360;
    wrap.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const draw = () => {
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    };
    this.seekOnce(t, draw);
  },

  // Resolve once the video has finished seeking to `t`.
  seekOnce(t, onSeeked) {
    const v = this.video;
    if (!v.src) { if (onSeeked) onSeeked(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const done = () => {
        v.removeEventListener("seeked", done);
        if (onSeeked) onSeeked();
        resolve();
      };
      v.addEventListener("seeked", done);
      v.currentTime = Math.max(0, Math.min(t, v.duration || t));
      // fallback if 'seeked' never fires
      setTimeout(() => { v.removeEventListener("seeked", done); if (onSeeked) onSeeked(); resolve(); }, 800);
    });
  },

  async capture(container, setStatus, dlAllBtn) {
    const startT = +container.querySelector("#fs-start").value;
    const intervalMs = +container.querySelector("#fs-interval").value;
    const interval = intervalMs / 1000;
    const dur = this.video.duration;

    if (!this.video.src || !dur || !isFinite(dur)) {
      setStatus("Upload a video first", "err");
      return;
    }
    if (intervalMs < 16) {
      setStatus("Interval too small (min 16 ms)", "err");
      return;
    }
    // Make sure the sequence fits; clamp start if needed.
    const span = (FRAME_COUNT - 1) * interval;
    if (startT + span > dur) {
      setStatus("Sequence would exceed video — lower the start or interval", "err");
      return;
    }

    this.resetFrames();
    const strip = container.querySelector("#fs-strip");
    strip.innerHTML = '<p class="hint">Capturing…</p>';
    setStatus("Capturing frames…", "warn");

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = startT + i * interval;
      await this.seekOnce(t); // eslint-disable-line no-await-in-loop
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(this.video, 0, 0, w, h);
      const url = canvas.toDataURL("image/png");
      this.frames.push({ canvas, time: t, url });
      this.renderFrame(strip, i, t, url);
    }

    strip.querySelector(".hint")?.remove();
    dlAllBtn.disabled = false;
    setStatus(`Captured ${FRAME_COUNT} frames (interval ${intervalMs} ms)`, "ok");
  },

  renderFrame(strip, index, time, url) {
    const card = document.createElement("div");
    card.className = "fs-frame";
    card.innerHTML = `
      <img src="${url}" alt="frame ${index + 1}" />
      <div class="fs-frame-meta">
        <span class="fs-frame-i">#${index + 1}</span>
        <span class="fs-frame-t">${time.toFixed(3)}s</span>
      </div>
      <a class="fs-frame-dl" href="${url}" download="frame-${index + 1}-${(time * 1000).toFixed(0)}ms.png" title="Download frame">⬇</a>
    `;
    strip.appendChild(card);
  },

  resetFrames() {
    this.frames.forEach((f) => { if (f.url) URL.revokeObjectURL(f.url); });
    this.frames = [];
    if (this.container) this.container.querySelector("#fs-strip").innerHTML = "";
  },

  // Composite all 10 frames side by side into one tall image and download it.
  downloadAll() {
    if (this.frames.length === 0) return;
    const cols = 5;
    const rows = Math.ceil(this.frames.length / cols);
    const cellW = 240;
    const cellH = Math.round(cellW * (this.video.videoHeight / this.video.videoWidth));
    const gap = 8;
    const canvas = document.createElement("canvas");
    canvas.width = cols * cellW + (cols - 1) * gap;
    canvas.height = rows * (cellH + 28) + (rows - 1) * gap;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e6e9ef";
    ctx.font = "13px system-ui, sans-serif";
    this.frames.forEach((f, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = c * (cellW + gap);
      const y = r * (cellH + 28 + gap);
      ctx.drawImage(f.canvas, x, y, cellW, cellH);
      ctx.fillText(`#${i + 1}  ${f.time.toFixed(3)}s`, x + 4, y + cellH + 18);
    });
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "frame-sequence.png";
    a.click();
  },

  stop() {
    this.resetFrames();
    if (this.video) {
      if (this.video.src) URL.revokeObjectURL(this.video.src);
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.stream = null;
  },
};
