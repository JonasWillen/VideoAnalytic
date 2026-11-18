// tools/photocell.js — virtual photocell / timing gate on the live camera feed.
//
// A small gate spot is drawn on the canvas (position adjustable). Frame
// differencing along the gate column detects a pass: each crossing logs a
// timestamp with the time since the previous pass (splits), like a real
// photocell aligned on a track. Events are listed live and exportable as
// JSON. A configurable cooldown prevents one crossing from double-triggering,
// and the gate re-arms once the column stays quiet.

import { motionOnColumn, grabFrame } from "../utils/frame.js";

export const photocellTool = {
  name: "photocell",
  raf: null,
  stream: null,
  video: null,
  canvas: null,
  ctx: null,
  prevFrame: null,
  events: [], // [{ t, clock, split }]
  lastPassAt: null,
  gateBusy: false,

  ui(container) {
    container.innerHTML = `
      <h2 class="tool-title">🔦 Photocell</h2>
      <p class="tool-desc">A virtual timing gate on the video: each time motion crosses the gate it logs an automatic timestamp and the split since the previous pass. Align the gate on the track (e.g. a finish line) and let it run.</p>

      <div class="tool-controls">
        <label for="pc-x">Gate position:</label>
        <input type="range" id="pc-x" min="10" max="90" value="50" />
        <label style="margin-left:16px" for="pc-sens">Sensitivity:</label>
        <input type="range" id="pc-sens" min="5" max="60" value="25" />
        <label style="margin-left:16px" for="pc-cool">Cooldown (ms):</label>
        <input type="number" id="pc-cool" min="100" max="10000" step="100" value="1000" style="width:80px" />
        <label style="margin-left:16px"><input type="checkbox" id="pc-mirror" checked /> Mirror</label>
      </div>

      <div class="tool-controls">
        <button id="pc-arm" type="button" class="tool-btn" style="width:auto">▶ Arm gate</button>
        <button id="pc-clear" type="button" class="tool-btn" style="width:auto">Clear events</button>
        <button id="pc-export" type="button" class="tool-btn" style="width:auto" disabled>⬇ Export JSON</button>
      </div>

      <div class="video-stage">
        <video id="pc-video" autoplay playsinline muted></video>
        <canvas id="pc-canvas" width="640" height="480"></canvas>
      </div>

      <div class="readout">
        <div class="stat"><span class="label">Passes</span><span class="val" id="pc-count">0</span></div>
        <div class="stat"><span class="label">Latest split (s)</span><span class="val" id="pc-latest">–</span></div>
        <div class="stat"><span class="label">Average (s)</span><span class="val" id="pc-avg">–</span></div>
        <div class="stat"><span class="label">Best (s)</span><span class="val" id="pc-best">–</span></div>
      </div>

      <h3 class="pc-list-title">Events</h3>
      <div id="pc-list" class="pc-list"></div>
    `;
  },

  async init(container, stream, setStatus) {
    this.ui(container);
    this.stream = stream;
    this.setStatus = setStatus;
    this.video = container.querySelector("#pc-video");
    this.canvas = container.querySelector("#pc-canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.container = container;
    this.video.srcObject = stream;

    const mirror = container.querySelector("#pc-mirror");
    const applyMirror = () => {
      this.mirrored = mirror.checked;
      this.video.classList.toggle("mirror", mirror.checked);
      this.canvas.classList.toggle("mirror", mirror.checked);
    };
    applyMirror();
    mirror.addEventListener("change", applyMirror);

    const posSlider = container.querySelector("#pc-x");
    posSlider.addEventListener("input", () => {
      this.gateX = (Number(posSlider.value) / 100) * this.canvas.width;
    });
    this.gateX = this.canvas.width / 2;

    const armBtn = container.querySelector("#pc-arm");
    armBtn.addEventListener("click", () => {
      this.armed = !this.armed;
      armBtn.textContent = this.armed ? "⏸ Pause" : "▶ Arm gate";
      setStatus(this.armed ? "Watching the gate…" : "Paused — arm to detect passes", this.armed ? "ok" : "warn");
    });

    container.querySelector("#pc-clear").addEventListener("click", () => {
      this.events = [];
      this.lastPassAt = null;
      this.renderEvents(container);
      this.updateStats(container);
      container.querySelector("#pc-export").disabled = true;
    });

    container.querySelector("#pc-export").addEventListener("click", () => this.exportJson());

    await new Promise((res) => { this.video.onloadedmetadata = () => res(); });
    this.video.play();
    setStatus("Paused — press Arm gate to start detecting passes", "warn");

    const loop = () => {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const frame = grabFrame(this.ctx, this.canvas.width, this.canvas.height);
      const now = performance.now();

      if (this.prevFrame) {
        const motion = motionOnColumn(frame, this.prevFrame, this.gateX, Number(container.querySelector("#pc-sens").value));
        const cooldown = Number(container.querySelector("#pc-cool").value);

        if (this.gateBusy) {
          // re-arm once the gate column stays quiet
          if (motion < 6) this.gateBusy = false;
        } else if (this.armed && motion > 25 && (this.lastPassAt === null || now - this.lastPassAt >= cooldown)) {
          this.recordPass(now, container, setStatus);
        }
      }
      this.prevFrame = frame;

      this.drawGate(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  recordPass(now, container, setStatus) {
    const split = this.lastPassAt === null ? null : (now - this.lastPassAt) / 1000;
    this.lastPassAt = now;
    this.gateBusy = true;
    const ev = {
      index: this.events.length + 1,
      clock: new Date().toISOString(),
      t: (now / 1000).toFixed(3),
      split: split === null ? null : Number(split.toFixed(3)),
    };
    this.events.push(ev);
    this.lastFlash = now;
    this.renderEvents(container);
    this.updateStats(container);
    container.querySelector("#pc-export").disabled = false;
    setStatus(split === null
      ? `Pass #${ev.index} — first trigger`
      : `Pass #${ev.index} — split ${split.toFixed(3)}s`, "ok");
  },

  drawGate(now) {
    const ctx = this.ctx;
    const x = this.gateX;
    const y = this.canvas.height / 2;
    // gate stem: a short vertical line segment, like a photo beam
    ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 60);
    ctx.lineTo(x, y + 60);
    ctx.stroke();
    // the "beam" spot
    const flash = this.lastFlash && now - this.lastFlash < 400;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 2 * Math.PI);
    ctx.fillStyle = flash ? "#66ff66" : "rgba(255, 80, 80, 0.85)";
    ctx.fill();
    // label pill (counter-flip text when CSS-mirrored)
    ctx.save();
    if (this.mirrored) {
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.translate(-x, -y);
    }
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = "GATE";
    const tw = ctx.measureText(label).width + 10;
    const bx = x - tw / 2;
    const by = y + 22 - 9.5;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + tw, by, bx + tw, by + 19, r);
    ctx.arcTo(bx + tw, by + 19, bx, by + 19, r);
    ctx.arcTo(bx, by + 19, bx, by, r);
    ctx.arcTo(bx, by, bx + tw, by, r);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeText(label, x, y + 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, y + 22);
    ctx.restore();
  },

  renderEvents(container) {
    const list = container.querySelector("#pc-list");
    if (this.events.length === 0) {
      list.innerHTML = '<p class="hint">No passes yet — arm the gate and cross it.</p>';
      return;
    }
    list.innerHTML = "";
    [...this.events].reverse().forEach((ev) => {
      const row = document.createElement("div");
      row.className = "pc-event";
      const split = ev.split === null
        ? "first"
        : `${ev.split.toFixed(3)}s`;
      row.innerHTML = `
        <span class="pc-event-i">#${ev.index}</span>
        <span class="pc-event-clock">${ev.clock}</span>
        <span class="pc-event-split ${ev.split === null ? "muted" : ""}">${split}</span>
      `;
      list.appendChild(row);
    });
  },

  updateStats(container) {
    const splits = this.events.map((e) => e.split).filter((s) => s !== null);
    container.querySelector("#pc-count").textContent = this.events.length;
    container.querySelector("#pc-latest").textContent =
      splits.length ? splits[splits.length - 1].toFixed(3) : "–";
    container.querySelector("#pc-avg").textContent =
      splits.length ? (splits.reduce((a, b) => a + b, 0) / splits.length).toFixed(3) : "–";
    container.querySelector("#pc-best").textContent =
      splits.length ? Math.min(...splits).toFixed(3) : "–";
  },

  exportJson() {
    if (this.events.length === 0) return;
    const payload = {
      tool: "photocell",
      exportedAt: new Date().toISOString(),
      passes: this.events.length,
      events: this.events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "photocell-events.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.prevFrame = null;
    this.gateBusy = false;
    this.lastFlash = null;
    if (this.video) this.video.srcObject = null;
    this.stream = null;
  },
};
