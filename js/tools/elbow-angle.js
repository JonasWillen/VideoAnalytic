// tools/elbow-angle.js — pose estimation elbow angle (TensorFlow.js MoveNet)
import { calculateAngle } from "../utils/math.js";

export const elbowAngleTool = {
  name: "elbow-angle",
  detector: null,
  raf: null,
  stream: null,
  video: null,
  canvas: null,
  ctx: null,

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">🦾 Elbow Angle</h2>
      <p class="tool-desc">MoveNet pose estimation. Tracks shoulder–elbow–wrist and shows the joint angle in real time.</p>
      <div class="tool-controls">
        <label for="sideSelect">Arm:</label>
        <select id="sideSelect">
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
        <label style="margin-left:16px"><input type="checkbox" id="mirror" checked /> Mirror</label>
      </div>
      <div class="video-stage">
        <video id="ea-video" autoplay playsinline muted></video>
        <canvas id="ea-canvas" width="640" height="480"></canvas>
      </div>
      <div class="readout">
        <div class="stat"><span class="label">Elbow angle</span><span class="val" id="ea-angle">–</span></div>
        <div class="stat"><span class="label">Min</span><span class="val" id="ea-min">–</span></div>
        <div class="stat"><span class="label">Max</span><span class="val" id="ea-max">–</span></div>
      </div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.video = container.querySelector("#ea-video");
    this.canvas = container.querySelector("#ea-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.video.srcObject = stream;

    const mirror = container.querySelector("#mirror");
    const applyMirror = () => {
      const on = mirror.checked;
      this.video.classList.toggle("mirror", on);
      this.canvas.classList.toggle("mirror", on);
    };
    applyMirror();
    mirror.addEventListener("change", applyMirror);

    await new Promise((res) => {
      this.video.onloadedmetadata = () => res();
    });
    this.video.play();

    setStatus("Loading pose model…", "warn");
    // pose-detection v2 expects the enum, not the raw string. Use the
    // movenet.modelType enum with a string fallback for older builds.
    const movenet = poseDetection.movenet || {};
    const modelType =
      movenet.modelType?.singleposelightning || "SinglePose.Lightning";
    this.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType }
    );
    setStatus("Running", "ok");

    let min = null;
    let max = null;
    const sideSel = container.querySelector("#sideSelect");

    const loop = async () => {
      const side = sideSel.value;
      try {
        const poses = await this.detector.estimatePoses(this.video, { flipHorizontal: false });
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        if (poses.length > 0) {
          const kp = poses[0].keypoints;
          const shoulder = kp.find((k) => k.name === `${side}_shoulder`);
          const elbow = kp.find((k) => k.name === `${side}_elbow`);
          const wrist = kp.find((k) => k.name === `${side}_wrist`);

          const ok =
            shoulder && elbow && wrist &&
            shoulder.score > 0.3 && elbow.score > 0.3 && wrist.score > 0.3;

          if (ok) {
            const angle = calculateAngle(shoulder, elbow, wrist);
            if (angle !== null) {
              container.querySelector("#ea-angle").textContent = angle.toFixed(1) + "°";
              if (min === null || angle < min) min = angle;
              if (max === null || angle > max) max = angle;
              container.querySelector("#ea-min").textContent = min.toFixed(1) + "°";
              container.querySelector("#ea-max").textContent = max.toFixed(1) + "°";
            }
            this.drawSkeleton([shoulder, elbow, wrist]);
          }
        }
      } catch (err) {
        console.error("pose loop error", err);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  drawSkeleton(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineTo(points[2].x, points[2].y);
    ctx.strokeStyle = "yellow";
    ctx.lineWidth = 3;
    ctx.stroke();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "red";
      ctx.fill();
    });
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.detector) {
      try { this.detector.dispose(); } catch (_) {}
      this.detector = null;
    }
    if (this.video) this.video.srcObject = null;
    this.stream = null;
  },
};
