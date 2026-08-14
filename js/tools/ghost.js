// tools/ghost.js — record/store/upload clips, compare two with sync + overlay
//
// Clips live in memory as { id, name, blob, url }. The tool records from the
// live camera (MediaRecorder) or accepts uploaded video files. Two clips
// (A = ghost, B = comparison) are played back on a shared requestAnimationFrame
// clock: each video's currentTime is set to inPoint + elapsed, keeping them
// in sync. Modes: side-by-side or overlay.

const MAX_RECORD_MS = 15000;

export const ghostTool = {
  name: "ghost",
  raf: null,
  stream: null,
  recorder: null,
  chunks: [],
  recordTimer: null,
  clips: [],
  nextId: 1,
  vidA: null,
  vidB: null,
  playing: false,
  playStart: 0, // performance.now() ms when current play started
  baseA: 0, // vidA.currentTime at play start (its inPoint)
  baseB: 0,

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">👻 Ghost Compare</h2>
      <p class="tool-desc">Record a short clip or upload videos, pick two, set each one's start point, then play them in sync — side-by-side or overlayed.</p>

      <div class="ghost-section">
        <h3>1. Add clips</h3>
        <div class="tool-controls">
          <video id="gh-preview" autoplay playsinline muted class="gh-preview"></video>
          <button id="gh-record" type="button" class="tool-btn" style="width:auto">● Record</button>
          <label class="tool-btn" style="width:auto;cursor:pointer">
            ⬆ Upload
            <input type="file" id="gh-upload" accept="video/*" hidden />
          </label>
          <span id="gh-rec-time" class="value"></span>
        </div>
      </div>

      <div class="ghost-section">
        <h3>2. Clip library</h3>
        <div id="gh-library" class="gh-library"></div>
      </div>

      <div class="ghost-section">
        <h3>3. Compare</h3>
        <div class="tool-controls">
          <label>Mode:</label>
          <select id="gh-mode">
            <option value="side">Side-by-side</option>
            <option value="overlay">Overlay</option>
          </select>
          <label style="margin-left:16px">Clip A (ghost):</label>
          <select id="gh-clipA"></select>
          <label style="margin-left:8px">Clip B:</label>
          <select id="gh-clipB"></select>
          <label style="margin-left:16px"><input type="checkbox" id="gh-loop" checked /> Loop</label>
        </div>

        <div class="tool-controls" style="margin-top:8px">
          <label>A start: <span id="gh-aIn-val" class="value">0.0s</span></label>
          <input type="range" id="gh-aIn" min="0" max="0" step="0.05" value="0" />
          <label style="margin-left:16px">B start: <span id="gh-bIn-val" class="value">0.0s</span></label>
          <input type="range" id="gh-bIn" min="0" max="0" step="0.05" value="0" />
        </div>

        <div class="tool-controls" style="margin-top:8px">
          <button id="gh-play" type="button" class="tool-btn" style="width:auto">▶ Play</button>
          <button id="gh-pause" type="button" class="tool-btn" style="width:auto" disabled>⏸ Pause</button>
          <span id="gh-elapsed" class="value">0.00s</span>
        </div>

        <div id="gh-stage" class="gh-stage"></div>
      </div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.preview = container.querySelector("#gh-preview");
    this.preview.srcObject = stream;
    await new Promise((r) => { this.preview.onloadedmetadata = () => r(); });
    this.preview.play();
    setStatus("Running", "ok");

    // hidden video elements for the two clips
    this.vidA = document.createElement("video");
    this.vidA.muted = true; this.vidA.playsInline = true;
    this.vidB = document.createElement("video");
    this.vidB.muted = true; this.vidB.playsInline = true;

    this.bind(container, setStatus);
    this.renderLibrary(container);
  },

  bind(container, setStatus) {
    const recordBtn = container.querySelector("#gh-record");
    const recTime = container.querySelector("#gh-rec-time");
    const upload = container.querySelector("#gh-upload");
    const modeSel = container.querySelector("#gh-mode");
    const clipA = container.querySelector("#gh-clipA");
    const clipB = container.querySelector("#gh-clipB");
    const aIn = container.querySelector("#gh-aIn");
    const bIn = container.querySelector("#gh-bIn");
    const aInVal = container.querySelector("#gh-aIn-val");
    const bInVal = container.querySelector("#gh-bIn-val");
    const playBtn = container.querySelector("#gh-play");
    const pauseBtn = container.querySelector("#gh-pause");
    const loopChk = container.querySelector("#gh-loop");
    const elapsedEl = container.querySelector("#gh-elapsed");

    this.setStatus = setStatus;

    // ---- Recording ----
    recordBtn.addEventListener("click", () => {
      if (this.recorder && this.recorder.state === "recording") {
        this.stopRecording();
        return;
      }
      this.startRecording(recordBtn, recTime, setStatus);
    });

    // ---- Upload ----
    upload.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.addClip(file.name, file);
      e.target.value = "";
    });

    // ---- Mode ----
    modeSel.addEventListener("change", () => this.layoutStage(container));

    // ---- Clip selection ----
    const onClipChange = () => {
      this.loadClipInto(this.vidA, clipA.value);
      this.loadClipInto(this.vidB, clipB.value);
      this.updateInRanges(container);
      this.layoutStage(container);
    };
    clipA.addEventListener("change", onClipChange);
    clipB.addEventListener("change", onClipChange);

    // ---- In-point scrubbers ----
    aIn.addEventListener("input", () => {
      aInVal.textContent = (+aIn.value).toFixed(1) + "s";
      if (!this.playing) {
        this.vidA.currentTime = +aIn.value;
        this.drawStill(container);
      }
    });
    bIn.addEventListener("input", () => {
      bInVal.textContent = (+bIn.value).toFixed(1) + "s";
      if (!this.playing) {
        this.vidB.currentTime = +bIn.value;
        this.drawStill(container);
      }
    });

    // ---- Play / Pause ----
    playBtn.addEventListener("click", () => this.play(container, playBtn, pauseBtn, elapsedEl, loopChk));
    pauseBtn.addEventListener("click", () => this.pause(playBtn, pauseBtn));

    // initial empty stage
    this.layoutStage(container);
  },

  // ---------- Recording ----------
  startRecording(recordBtn, recTime, setStatus) {
    let mime = "";
    for (const t of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) { mime = t; break; }
    }
    if (!mime) { setStatus("MediaRecorder not supported", "err"); return; }

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: mime });
      const name = `Recording ${this.nextId}`;
      this.addClip(name, blob);
      recordBtn.textContent = "● Record";
      recordBtn.classList.remove("rec");
      recTime.textContent = "";
      setStatus("Running", "ok");
    };

    this.recorder.start();
    recordBtn.textContent = "■ Stop";
    recordBtn.classList.add("rec");
    setStatus("Recording…", "warn");

    const t0 = performance.now();
    this.recordTimer = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000;
      recTime.textContent = elapsed.toFixed(1) + "s";
      if (elapsed * 1000 >= MAX_RECORD_MS) this.stopRecording();
    }, 100);
  },

  stopRecording() {
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  },

  // ---------- Clip library ----------
  addClip(name, blob) {
    const url = URL.createObjectURL(blob);
    this.clips.push({ id: this.nextId++, name, blob, url });
    const container = document.getElementById("workspace");
    this.renderLibrary(container);
    this.renderClipSelects(container);
  },

  removeClip(id) {
    const i = this.clips.findIndex((c) => c.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(this.clips[i].url);
    this.clips.splice(i, 1);
    const container = document.getElementById("workspace");
    this.renderLibrary(container);
    this.renderClipSelects(container);
  },

  renderLibrary(container) {
    const lib = container.querySelector("#gh-library");
    if (this.clips.length === 0) {
      lib.innerHTML = '<p class="hint">No clips yet. Record from the camera or upload a video.</p>';
      return;
    }
    lib.innerHTML = "";
    this.clips.forEach((c) => {
      const card = document.createElement("div");
      card.className = "clip-card";
      card.innerHTML = `
        <video src="${c.url}" muted playsinline></video>
        <div class="clip-info">
          <strong>${c.name}</strong>
          <span class="hint">${(c.blob.size / 1024 / 1024).toFixed(1)} MB</span>
        </div>
        <button type="button" class="clip-del" title="Delete">✕</button>
      `;
      card.querySelector(".clip-del").addEventListener("click", () => this.removeClip(c.id));
      lib.appendChild(card);
    });
  },

  renderClipSelects(container) {
    const selA = container.querySelector("#gh-clipA");
    const selB = container.querySelector("#gh-clipB");
    const opts = this.clips.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    const prevA = selA.value;
    const prevB = selB.value;
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (this.clips.find((c) => String(c.id) === prevA)) selA.value = prevA;
    if (this.clips.find((c) => String(c.id) === prevB)) selB.value = prevB;
  },

  loadClipInto(video, id) {
    const clip = this.clips.find((c) => String(c.id) === String(id));
    if (!clip) { video.removeAttribute("src"); video.load(); return; }
    if (video.src !== clip.url) {
      video.src = clip.url;
      video.load();
    }
  },

  updateInRanges(container) {
    const aIn = container.querySelector("#gh-aIn");
    const bIn = container.querySelector("#gh-bIn");
    const aInVal = container.querySelector("#gh-aIn-val");
    const bInVal = container.querySelector("#gh-bIn-val");
    const setRange = (el, val, video) => {
      const dur = video.duration && isFinite(video.duration) ? video.duration : 0;
      el.max = dur || 0;
      const v = Math.min(+val, dur || 0);
      el.value = v;
      return v;
    };
    const aV = setRange(aIn, aIn.value, this.vidA);
    const bV = setRange(bIn, bIn.value, this.vidB);
    aInVal.textContent = aV.toFixed(1) + "s";
    bInVal.textContent = bV.toFixed(1) + "s";
  },

  // ---------- Stage layout ----------
  layoutStage(container) {
    const stage = container.querySelector("#gh-stage");
    const mode = container.querySelector("#gh-mode").value;
    const hasA = this.vidA.src;
    const hasB = this.vidB.src;

    if (mode === "overlay") {
      stage.innerHTML = `
        <div class="video-stage solo">
          <canvas id="gh-canvas" width="640" height="360"></canvas>
        </div>`;
    } else {
      stage.innerHTML = `
        <div class="side-by-side">
          <div class="stage-block">
            <h3>A (ghost)</h3>
            <div class="video-stage solo"><canvas id="gh-canvasA" width="640" height="360"></canvas></div>
          </div>
          <div class="stage-block">
            <h3>B</h3>
            <div class="video-stage solo"><canvas id="gh-canvasB" width="640" height="360"></canvas></div>
          </div>
        </div>`;
    }
    if (!hasA && !hasB) {
      stage.innerHTML += '<p class="hint">Pick clip A and clip B above.</p>';
    }
    if (!this.playing) this.drawStill(container);
  },

  // ---------- Playback ----------
  play(container, playBtn, pauseBtn, elapsedEl, loopChk) {
    if (!this.vidA.src && !this.vidB.src) {
      this.setStatus("Pick two clips first", "err");
      return;
    }
    const aIn = +container.querySelector("#gh-aIn").value;
    const bIn = +container.querySelector("#gh-bIn").value;
    this.baseA = aIn;
    this.baseB = bIn;
    this.playing = true;
    this.loop = loopChk.checked;
    playBtn.disabled = true;
    pauseBtn.disabled = false;

    const seek = (v, base) => new Promise((res) => {
      if (!v.src) return res();
      const onSeek = () => { v.removeEventListener("seeked", onSeek); res(); };
      v.addEventListener("seeked", onSeek);
      v.currentTime = base;
      // fallback if seeked never fires
      setTimeout(res, 500);
    });

    Promise.all([seek(this.vidA, aIn), seek(this.vidB, bIn)]).then(() => {
      this.vidA.play().catch(() => {});
      this.vidB.play().catch(() => {});
      this.playStart = performance.now();
      this.renderLoop(container, elapsedEl);
    });
  },

  renderLoop(container, elapsedEl) {
    if (!this.playing) return;
    const mode = container.querySelector("#gh-mode").value;
    const elapsed = (performance.now() - this.playStart) / 1000;

    // Drift-correct: set currentTime from the shared clock so both stay in sync.
    const aIn = this.baseA;
    const bIn = this.baseB;
    const durA = this.vidA.duration && isFinite(this.vidA.duration) ? this.vidA.duration : Infinity;
    const durB = this.vidB.duration && isFinite(this.vidB.duration) ? this.vidB.duration : Infinity;
    const remainA = durA - aIn;
    const remainB = durB - bIn;
    const remain = Math.min(remainA, remainB);

    if (elapsed >= remain) {
      if (this.loop) {
        // restart
        this.playStart = performance.now();
        this.vidA.currentTime = aIn;
        this.vidB.currentTime = bIn;
      } else {
        this.pause(container.querySelector("#gh-play"), container.querySelector("#gh-pause"));
        return;
      }
    } else {
      // nudge each video to its target time if drifted
      const tA = aIn + elapsed;
      const tB = bIn + elapsed;
      if (this.vidA.src && Math.abs(this.vidA.currentTime - tA) > 0.1) this.vidA.currentTime = tA;
      if (this.vidB.src && Math.abs(this.vidB.currentTime - tB) > 0.1) this.vidB.currentTime = tB;
    }

    elapsedEl.textContent = elapsed.toFixed(2) + "s";

    if (mode === "overlay") {
      const canvas = container.querySelector("#gh-canvas");
      if (canvas) this.drawOverlay(canvas);
    } else {
      const cA = container.querySelector("#gh-canvasA");
      const cB = container.querySelector("#gh-canvasB");
      if (cA) this.drawTo(cA, this.vidA, 0.5);
      if (cB) this.drawTo(cB, this.vidB, 1.0);
    }

    this.raf = requestAnimationFrame(() => this.renderLoop(container, elapsedEl));
  },

  drawOverlay(canvas) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    // ghost A at reduced opacity
    if (this.vidA.src) {
      ctx.globalAlpha = 0.5;
      this.drawLetterboxed(ctx, this.vidA, W, H);
    }
    // B on top, also semi-transparent
    if (this.vidB.src) {
      ctx.globalAlpha = 0.7;
      this.drawLetterboxed(ctx, this.vidB, W, H);
    }
    ctx.globalAlpha = 1.0;
  },

  drawTo(canvas, video, alpha) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    this.drawLetterboxed(ctx, video, W, H);
    ctx.globalAlpha = 1.0;
  },

  drawLetterboxed(ctx, video, W, H) {
    if (!video.videoWidth || !video.videoHeight) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);
  },

  drawStill(container) {
    const mode = container.querySelector("#gh-mode").value;
    if (mode === "overlay") {
      const c = container.querySelector("#gh-canvas");
      if (c) this.drawOverlay(c);
    } else {
      const cA = container.querySelector("#gh-canvasA");
      const cB = container.querySelector("#gh-canvasB");
      if (cA) this.drawTo(cA, this.vidA, 0.5);
      if (cB) this.drawTo(cB, this.vidB, 1.0);
    }
  },

  pause(playBtn, pauseBtn) {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.vidA.pause();
    this.vidB.pause();
    if (playBtn) playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
  },

  stop() {
    this.pause();
    this.stopRecording();
    this.clips.forEach((c) => URL.revokeObjectURL(c.url));
    this.clips = [];
    if (this.preview) this.preview.srcObject = null;
    if (this.vidA) { this.vidA.removeAttribute("src"); this.vidA.load(); }
    if (this.vidB) { this.vidB.removeAttribute("src"); this.vidB.load(); }
    this.stream = null;
  },
};
