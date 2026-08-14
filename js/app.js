// app.js — router: tool selection + camera lifecycle
import { listCameras, startCamera, stopStream } from "./camera.js";
import { elbowAngleTool } from "./tools/elbow-angle.js";
import { reactionTimeTool } from "./tools/reaction-time.js";
import { videoDelayTool } from "./tools/video-delay.js";
import { ghostTool } from "./tools/ghost.js";

const TOOLS = {
  "elbow-angle": elbowAngleTool,
  "reaction-time": reactionTimeTool,
  "video-delay": videoDelayTool,
  "ghost": ghostTool,
};

const workspace = document.getElementById("workspace");
const cameraSelect = document.getElementById("cameraSelect");
const refreshCameras = document.getElementById("refreshCameras");
const stopBtn = document.getElementById("stopTool");
const statusEl = document.getElementById("status");
const toolBtns = document.querySelectorAll(".tool-btn[data-tool]");

let currentTool = null;
let currentStream = null;

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = "status " + kind;
}

function showError(msg) {
  workspace.innerHTML = `<div class="error-banner">${msg}</div>`;
  setStatus(msg, "err");
}

async function refreshCameraList() {
  cameraSelect.innerHTML = "";
  const cams = await listCameras();
  if (cams.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(no cameras — allow camera access)";
    opt.disabled = true;
    cameraSelect.appendChild(opt);
    return;
  }
  cams.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.deviceId;
    opt.textContent = c.label;
    cameraSelect.appendChild(opt);
  });
}

// First getUserMedia is needed to populate device labels.
async function primePermissions() {
  try {
    const stream = await startCamera(undefined, 320, 240);
    stopStream(stream);
    await refreshCameraList();
  } catch (err) {
    setStatus(`Camera permission denied: ${err.message}`, "err");
  }
}

async function activateTool(toolKey) {
  // tear down previous
  if (currentTool) {
    currentTool.stop();
    currentTool = null;
  }
  if (currentStream) {
    stopStream(currentStream);
    currentStream = null;
  }
  toolBtns.forEach((b) => b.classList.toggle("active", b.dataset.tool === toolKey));
  stopBtn.disabled = false;

  const tool = TOOLS[toolKey];
  const deviceId = cameraSelect.value || undefined;

  try {
    setStatus("Starting camera…", "warn");
    currentStream = await startCamera(deviceId, 640, 480);
    await tool.init(workspace, currentStream, setStatus);
    currentTool = tool;
  } catch (err) {
    showError(`Failed to start "${toolKey}": ${err.message}`);
    stopBtn.disabled = true;
    toolBtns.forEach((b) => b.classList.remove("active"));
  }
}

function stopCurrent() {
  if (currentTool) currentTool.stop();
  currentTool = null;
  if (currentStream) stopStream(currentStream);
  currentStream = null;
  toolBtns.forEach((b) => b.classList.remove("active"));
  stopBtn.disabled = true;
  workspace.innerHTML = `<div class="placeholder"><p>Select a tool on the left to begin.</p></div>`;
  setStatus("Idle");
}

toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => activateTool(btn.dataset.tool));
});
stopBtn.addEventListener("click", stopCurrent);
refreshCameras.addEventListener("click", refreshCameraList);

primePermissions();
