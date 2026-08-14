// tools/reaction-time.js — line-cross motion reaction timer
import { motionOnColumn, grabFrame } from "../utils/frame.js";

export const reactionTimeTool = {
  name: "reaction-time",
  raf: null,
  stream: null,
  video: null,
  canvas: null,
  ctx: null,
  prevFrame: null,
  startTime: null,
  armed: false,        // waiting for source-line motion
  times: [],

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">⚡ Reaction Time</h2>
      <p class="tool-desc">A target appears on the left line. Move into it (motion) to start the timer; move into the right line to stop. Measures reaction between the two line-cross events.</p>
      <div class="tool-controls">
        <label for="rt-sens">Sensitivity:</label>
        <input type="range" id="rt-sens" min="5" max="60" value="25" />
        <label style="margin-left:16px"><input type="checkbox" id="rt-mirror" checked /> Mirror</label>
        <button id="rt-arm" type="button" class="tool-btn" style="width:auto">Start</button>
        <button id="rt-reset" type="button" class="tool-btn" style="width:auto">Reset stats</button>
      </div>
      <div class="video-stage">
        <video id="rt-video" autoplay playsinline muted></video>
        <canvas id="rt-canvas" width="640" height="480"></canvas>
      </div>
      <div class="readout">
        <div class="stat"><span class="label">Latest (s)</span><span class="val" id="rt-latest">–</span></div>
        <div class="stat"><span class="label">Average (s)</span><span class="val" id="rt-avg">–</span></div>
        <div class="stat"><span class="label">Best (s)</span><span class="val" id="rt-best">–</span></div>
        <div class="stat"><span class="label">Runs</span><span class="val" id="rt-runs">0</span></div>
      </div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.video = container.querySelector("#rt-video");
    this.canvas = container.querySelector("#rt-canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.video.srcObject = stream;

    const mirror = container.querySelector("#rt-mirror");
    const applyMirror = () => {
      const on = mirror.checked;
      this.video.classList.toggle("mirror", on);
      this.canvas.classList.toggle("mirror", on);
    };
    applyMirror();
    mirror.addEventListener("change", applyMirror);

    await new Promise((res) => { this.video.onloadedmetadata = () => res(); });
    this.video.play();
    setStatus("Running", "ok");

    const sens = container.querySelector("#rt-sens");
    const getThresh = () => Number(sens.value);

    const lines = [this.canvas.width * 0.15, this.canvas.width * 0.85];
    const [srcX, dstX] = lines;

    container.querySelector("#rt-arm").addEventListener("click", () => {
      this.armed = true;
      this.startTime = null;
      setStatus("Armed — move into the LEFT line to start", "warn");
    });
    container.querySelector("#rt-reset").addEventListener("click", () => {
      this.times = [];
      this.updateStats(container);
    });

    const loop = () => {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const frame = grabFrame(this.ctx, this.canvas.width, this.canvas.height);

      if (this.prevFrame) {
        const threshold = getThresh();
        const srcMotion = motionOnColumn(frame, this.prevFrame, srcX, threshold);
        const dstMotion = motionOnColumn(frame, this.prevFrame, dstX, threshold);

        if (this.armed && this.startTime === null && srcMotion > 25) {
          this.startTime = performance.now();
          this.armed = false;
          setStatus("Started — move into the RIGHT line to stop", "warn");
        } else if (this.startTime !== null && dstMotion > 25) {
          const t = (performance.now() - this.startTime) / 1000;
          this.times.push(t);
          this.startTime = null;
          this.updateStats(container);
          setStatus(`Measured: ${t.toFixed(3)}s`, "ok");
        }
      }
      this.prevFrame = frame;

      this.drawLines(lines);
      this.drawMarkers(lines, srcX, dstX);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  drawLines(lines) {
    const ctx = this.ctx;
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    lines.forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    });
  },

  drawMarkers(_lines, srcX, dstX) {
    const ctx = this.ctx;
    const y = this.canvas.height / 2;
    const drawDot = (x, color, label) => {
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y + 4);
    };
    drawDot(srcX, "lime", "START");
    drawDot(dstX, "orange", "STOP");
  },

  updateStats(container) {
    container.querySelector("#rt-latest").textContent =
      this.times.length ? this.times[this.times.length - 1].toFixed(3) : "–";
    container.querySelector("#rt-avg").textContent =
      this.times.length ? (this.times.reduce((a, b) => a + b, 0) / this.times.length).toFixed(3) : "–";
    container.querySelector("#rt-best").textContent =
      this.times.length ? Math.min(...this.times).toFixed(3) : "–";
    container.querySelector("#rt-runs").textContent = this.times.length;
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.prevFrame = null;
    if (this.video) this.video.srcObject = null;
    this.stream = null;
  },
};
