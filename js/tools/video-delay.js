// tools/video-delay.js — configurable 10–30s video delay via a frame ring buffer.
//
// A precise delay is achieved by capturing ImageData snapshots at a fixed cadence
// into a ring buffer, then replaying the frame captured `delay` seconds ago. This
// avoids the coarse/variable latency of MediaRecorder blob-chunking.
export const videoDelayTool = {
  name: "video-delay",
  raf: null,
  stream: null,
  video: null,
  liveCanvas: null,
  liveCtx: null,
  delayCanvas: null,
  delayCtx: null,
  buffer: [],
  head: 0,
  capacity: 0,
  captureInterval: null,
  drawRaf: null,

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">⏱️ Video Delay</h2>
      <p class="tool-desc">Replays the camera feed delayed by 10–30 seconds. Useful for self-review of technique without recording.</p>
      <div class="tool-controls">
        <label for="vd-delay">Delay:</label>
        <input type="range" id="vd-delay" min="10" max="30" step="1" value="15" />
        <span class="value" id="vd-delay-val">15s</span>
        <label style="margin-left:16px" for="vd-fps">Capture fps:</label>
        <select id="vd-fps">
          <option value="10">10</option>
          <option value="15" selected>15</option>
          <option value="20">20</option>
        </select>
        <label style="margin-left:16px"><input type="checkbox" id="vd-mirror" checked /> Mirror</label>
      </div>
      <div class="side-by-side">
        <div class="stage-block">
          <h3>Live</h3>
          <div class="video-stage">
            <video id="vd-video" autoplay playsinline muted></video>
            <canvas id="vd-live" width="640" height="480"></canvas>
          </div>
        </div>
        <div class="stage-block">
          <h3>Delayed</h3>
          <div class="video-stage">
            <canvas id="vd-delayed" width="640" height="480"></canvas>
          </div>
        </div>
      </div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.video = container.querySelector("#vd-video");
    this.liveCanvas = container.querySelector("#vd-live");
    this.liveCtx = this.liveCanvas.getContext("2d", { willReadFrequently: true });
    this.delayCanvas = container.querySelector("#vd-delayed");
    this.delayCtx = this.delayCanvas.getContext("2d");
    this.video.srcObject = stream;

    const mirror = container.querySelector("#vd-mirror");
    const applyMirror = () => {
      const on = mirror.checked;
      this.video.classList.toggle("mirror", on);
      this.liveCanvas.classList.toggle("mirror", on);
      this.delayCanvas.classList.toggle("mirror", on);
    };
    applyMirror();
    mirror.addEventListener("change", applyMirror);

    await new Promise((res) => { this.video.onloadedmetadata = () => res(); });
    this.video.play();

    const delayInput = container.querySelector("#vd-delay");
    const delayVal = container.querySelector("#vd-delay-val");
    const fpsInput = container.querySelector("#vd-fps");

    const resizeBuffer = () => {
      const fps = Number(fpsInput.value);
      const delaySec = Number(delayInput.value);
      const cap = Math.ceil(fps * delaySec);
      // Preserve as much existing data as possible.
      const old = this.buffer;
      this.capacity = cap;
      this.buffer = new Array(cap).fill(null);
      for (let i = 0; i < Math.min(cap, old.length); i++) {
        this.buffer[i] = old[i];
      }
      this.head = 0;
    };
    resizeBuffer();
    delayVal.textContent = delayInput.value + "s";

    delayInput.addEventListener("input", () => {
      delayVal.textContent = delayInput.value + "s";
      resizeBuffer();
    });
    fpsInput.addEventListener("change", resizeBuffer);

    setStatus("Running", "ok");

    const W = this.liveCanvas.width;
    const H = this.liveCanvas.height;

    // Capture loop at fixed fps.
    const fps = Number(fpsInput.value);
    const interval = 1000 / fps;
    this.captureInterval = setInterval(() => {
      this.liveCtx.drawImage(this.video, 0, 0, W, H);
      const frame = this.liveCtx.getImageData(0, 0, W, H);
      this.buffer[this.head] = frame;
      this.head = (this.head + 1) % this.capacity;
    }, interval);

    // Render loop: draw live + delayed frames.
    const render = () => {
      // live already drawn in capture; redraw for smoothness between captures.
      this.liveCtx.drawImage(this.video, 0, 0, W, H);
      const delayedIdx = (this.head + this.capacity - 1) % this.capacity;
      const delayedFrame = this.buffer[delayedIdx];
      if (delayedFrame) {
        this.delayCtx.putImageData(delayedFrame, 0, 0);
      } else {
        this.delayCtx.fillStyle = "#000";
        this.delayCtx.fillRect(0, 0, W, H);
      }
      this.drawRaf = requestAnimationFrame(render);
    };
    this.drawRaf = requestAnimationFrame(render);
  },

  stop() {
    if (this.captureInterval) clearInterval(this.captureInterval);
    this.captureInterval = null;
    if (this.drawRaf) cancelAnimationFrame(this.drawRaf);
    this.drawRaf = null;
    this.buffer = [];
    if (this.video) this.video.srcObject = null;
    this.stream = null;
  },
};
