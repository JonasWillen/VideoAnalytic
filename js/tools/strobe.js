// tools/strobe.js — strobe image / chronophotography.
//
// During a capture, every Nth frame of the live camera is composited into a
// single offscreen canvas. The composite is updated live so the "fan" builds
// up in real time. Three compositing modes:
//   - overlay (ghosts): the first sampled frame is the opaque base image;
//     every following frame is drawn on top with adjustable transparency —
//     semi-transparent figures stacked over a fixed background.
//   - lighten (pixel-max): each output pixel keeps the brightest value seen.
//   - lighter (additive): frames add up, glowing trails (good in low light).
// The finished image can be downloaded as PNG.

export const strobeTool = {
  name: "strobe",
  raf: null,
  stream: null,
  video: null,
  canvas: null,   // live preview stage
  ctx: null,
  strobe: null,   // accumulating composite
  sctx: null,
  frameIndex: 0,
  capturing: false,
  captureEnd: 0,
  used: 0,

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">✨ Strobe Image</h2>
      <p class="tool-desc">Chronophotography: every Nth camera frame is superimposed on the previous ones in one image, so a jump or throw appears as a "fan". Capture for a few seconds, then download the composite.</p>

      <div class="tool-controls">
        <label for="st-skip">Every Nth frame:</label>
        <input type="number" id="st-skip" min="1" max="30" step="1" value="3" style="width:70px" />
        <label style="margin-left:16px" for="st-duration">Duration (s):</label>
        <input type="number" id="st-duration" min="1" max="20" step="1" value="3" style="width:70px" />
        <label style="margin-left:16px" for="st-mode">Mode:</label>
        <select id="st-mode">
          <option value="overlay" selected>Ghost overlay</option>
          <option value="lighten">Pixel-max (lighten)</option>
          <option value="lighter">Additive glow</option>
        </select>
        <label style="margin-left:16px" for="st-alpha">Ghost opacity:</label>
        <input type="range" id="st-alpha" min="10" max="100" step="5" value="30" title="Opacity of each overlaid figure" />
        <label style="margin-left:16px"><input type="checkbox" id="st-mirror" checked /> Mirror</label>
      </div>

      <div class="tool-controls">
        <button id="st-start" type="button" class="tool-btn" style="width:auto">⏺ Start strobe</button>
        <button id="st-clear" type="button" class="tool-btn" style="width:auto">Clear</button>
        <button id="st-download" type="button" class="tool-btn" style="width:auto" disabled>⬇ Download PNG</button>
        <span id="st-info" class="value"></span>
      </div>

      <div class="st-stage-wrap">
        <div class="video-stage">
          <video id="st-video" autoplay playsinline muted></video>
          <canvas id="st-canvas" width="640" height="480"></canvas>
        </div>
        <div class="st-result-wrap">
          <span class="st-result-label">Strobe composite</span>
          <canvas id="st-result" width="640" height="480" class="st-result"></canvas>
        </div>
      </div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.video = container.querySelector("#st-video");
    this.canvas = container.querySelector("#st-canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.strobe = container.querySelector("#st-result");
    this.sctx = this.strobe.getContext("2d", { willReadFrequently: true });
    this.video.srcObject = stream;
    this.container = container;

    this.clearStrobe(setStatus);

    const mirror = container.querySelector("#st-mirror");
    const applyMirror = () => {
      this.video.classList.toggle("mirror", mirror.checked);
      this.canvas.classList.toggle("mirror", mirror.checked);
      this.strobe.classList.toggle("mirror", mirror.checked);
    };
    applyMirror();
    mirror.addEventListener("change", applyMirror);

    const startBtn = container.querySelector("#st-start");
    startBtn.addEventListener("click", () => {
      if (this.capturing) {
        this.stopCapture(container, setStatus);
      } else {
        const duration = Number(container.querySelector("#st-duration").value) * 1000;
        this.clearComposite();
        this.capturing = true;
        this.frameIndex = 0;
        this.used = 0;
        this.captureEnd = performance.now() + duration;
        startBtn.textContent = "⏹ Stop";
        setStatus("Capturing strobe frames…", "warn");
      }
    });

    container.querySelector("#st-clear").addEventListener("click", () => this.clearStrobe(setStatus));

    container.querySelector("#st-download").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = this.strobe.toDataURL("image/png");
      a.download = `strobe-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      a.click();
    });

    await new Promise((res) => { this.video.onloadedmetadata = () => res(); });
    this.video.play();
    setStatus("Press Start strobe, then perform the movement.", "ok");

    const loop = () => {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

      const skip = Math.max(1, Number(container.querySelector("#st-skip").value));
      this.frameIndex += 1;
      if (this.capturing && this.frameIndex % skip === 0) {
        this.composite();
        this.used += 1;
        container.querySelector("#st-info").textContent =
          `${this.used} frames composited`;
      }
      if (this.capturing && performance.now() >= this.captureEnd) {
        this.stopCapture(container, setStatus);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  // Composite one frame into the strobe canvas.
  composite() {
    const mode = this.container.querySelector("#st-mode").value;
    if (mode === "overlay") {
      // First sampled frame becomes the opaque base (fixed background);
      // each following frame is stacked as a semi-transparent figure.
      if (this.used === 0) {
        this.sctx.globalAlpha = 1;
      } else {
        this.sctx.globalAlpha = Math.max(0.1, Math.min(1, Number(this.container.querySelector("#st-alpha").value) / 100));
      }
      this.sctx.globalCompositeOperation = "source-over";
      this.sctx.drawImage(this.video, 0, 0, this.strobe.width, this.strobe.height);
      this.sctx.globalAlpha = 1;
      return;
    }
    if (mode === "lighten") {
      // 'lighten' keeps the brightest value per pixel with each draw,
      // i.e. an exact running pixel-max across all captured frames.
      this.sctx.globalCompositeOperation = "lighten";
      this.sctx.drawImage(this.video, 0, 0, this.strobe.width, this.strobe.height);
      this.sctx.globalCompositeOperation = "source-over";
    } else {
      this.sctx.globalAlpha = 0.6;
      this.sctx.globalCompositeOperation = "lighter";
      this.sctx.drawImage(this.video, 0, 0, this.strobe.width, this.strobe.height);
      this.sctx.globalCompositeOperation = "source-over";
      this.sctx.globalAlpha = 1;
    }
  },

  clearComposite() {
    this.sctx.globalCompositeOperation = "source-over";
    this.sctx.fillStyle = "#000";
    this.sctx.fillRect(0, 0, this.strobe.width, this.strobe.height);
  },

  clearStrobe(setStatus) {
    this.capturing = false;
    this.used = 0;
    this.clearComposite();
    const startBtn = this.container?.querySelector("#st-start");
    if (startBtn) startBtn.textContent = "⏺ Start strobe";
    const info = this.container?.querySelector("#st-info");
    if (info) info.textContent = "";
    if (this.container) this.container.querySelector("#st-download").disabled = true;
    if (setStatus) setStatus("Cleared.", "");
  },

  stopCapture(container, setStatus) {
    this.capturing = false;
    container.querySelector("#st-start").textContent = "⏺ Start strobe";
    container.querySelector("#st-download").disabled = this.used === 0;
    setStatus(`Done — ${this.used} frames superimposed`, "ok");
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.capturing = false;
    if (this.video) this.video.srcObject = null;
    this.stream = null;
  },
};
