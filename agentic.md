# AGENTS.md — Sports Video Analytics (Standalone HTML App)

> Note: the user named this file `agentic.md` in their request. This file is the agent's
> working spec / guidance for building the application. It documents the plan, architecture,
> conventions, and module boundaries so future work (by an agent or human) stays consistent.

## 1. Goal

A **standalone, single-page HTML application** for sports performance video analytics.
The app must run entirely client-side (no server, no build step) by opening the HTML file
in a browser, and it must support **one or multiple USB cameras** connected to the machine.

It is a "Swiss army knife" of simple, focused sports-analytics tools. The user picks a tool
from a menu; each tool opens a focused workspace with a live camera feed plus the tool's
specific overlay/measurement.

## 2. Core Features (Modules)

Each module is self-contained and share the common camera/infrastructure layer.

### 2.1 Elbow Angle (Pose Estimation)
- Uses **TensorFlow.js** + **`@tensorflow-models/pose-detection`** (MoveNet).
- Detects shoulder / elbow / wrist keypoints and computes the joint angle.
- Draws skeleton lines and the angle value overlay.
- Reference behavior: the provided "hello world" snippet (MoveNet `singlepose_lightning`,
  angle via arccos of dot product of the two vectors meeting at the elbow).

### 2.2 Reaction Time (Line-Cross Motion)
- Two (or more) vertical "trigger lines" drawn on the canvas, one on each side of the video.
- A target appears on one line at a random position/time.
- When the image (motion) changes at the source line, the timer starts; when the image
  changes at the destination line, the timer stops. Reaction time = elapsed between the two
  line-motion events.
- Motion detection via per-pixel frame differencing along the line column
  (threshold + motion-count), mirroring the reference `detectMotion` approach.
- Shows latest time and running average.

### 2.3 Video Delay (10–30s)
- Presents a camera feed delayed by a configurable **10–30 second** window.
- Implementation approach: ring buffer of captured frames (canvas `ImageData` snapshots at a
  fixed cadence) replayed after the delay. Prefer a frame-buffer approach over
  `MediaRecorder` chunking because it gives precise, controllable delay and avoids the
  coarse/variable latency of blob-based recording (the reference snippet's 5s chunk approach
  is only a demo and not precise enough for 10–30s sports review).
- Delay is adjustable via a slider; live and delayed previews shown side by side.

### 2.4 (Optional / future) Camera selector & multi-camera layouts
- Choose which USB camera to use per tool.
- Future: show multiple cameras simultaneously (grid layout).

### 2.5 Ghost (Video Compare / Overlay)

A "ghost" comparison tool for technique analysis. The athlete records a short
reference clip (the "ghost"), stores it, then compares it against another clip
— either a second uploaded video or a newly recorded one. Both clips can be
played back in two modes:

- **Side-by-side** — two independent playback windows.
- **Overlay** — both videos composited on one canvas (the ghost rendered at
  reduced opacity over the second clip) so movement can be compared directly.

Key requirements:
- **Record a short clip** from the live camera into an in-memory `Blob` (no
  server). Recording is capped (e.g. ~15s) to bound memory. Capture via
  `MediaRecorder` on the camera stream.
- **Store clips locally.** Clips live in memory (an array of `{id, name, blob,
  url}`). Also support **uploading** a video file (`<input type="file"
  accept="video/*">`) so pre-recorded footage can be used as a clip. Persisted
  only for the session — no disk/server storage in v1 (localStorage is too
  small for video; IndexedDB is a future option).
- **Pick two clips** (A and B) from the clip library to compare.
- **Per-clip start offset.** Each of the two clips has its own "start point"
  scrubber so the two can be synchronized: set clip A's in-point and clip B's
  in-point, then play both from those offsets at the same time. This is the
  sync mechanism — align a recognizable frame (e.g. the start of the movement)
  in each, then play together.
- **Playback controls:** play/pause both together, a single shared timeline
  driven by the shorter clip's remaining duration, and a master offset. Loop
  toggle for repeated review.
- **Overlay rendering:** draw clip A (ghost) at ~50% opacity, then clip B on
  top at ~50–70% opacity, on a single canvas sized to the shared resolution.
  Both clips scaled to a common canvas size (letterboxed).
- **Two-window mode:** render each clip to its own canvas; both driven by the
  same play/pause + sync logic.

Implementation notes:
- Decode clips to `<video>` elements (offscreen or hidden) and draw frames to
  `<canvas>` on a shared `requestAnimationFrame` loop, advancing each video by
  `currentTime = inPoint + elapsed` where `elapsed` is shared clock time since
  play start. This keeps them in sync better than two independent `<video>`
  elements with separate `play()` calls.
- `requestVideoFrameCallback` is preferred when available for tighter frame
  sync; fall back to `requestAnimationFrame`.

## 3. Architecture

```
index.html              # entry — loads app shell, CSS, JS
css/
  style.css             # app shell, layout, controls
js/
  app.js                # router: tool selection, camera setup bootstrap
  camera.js             # shared camera layer: enumerate devices, getUserMedia, stream mgmt
  utils/
    math.js            # calculateAngle, helpers
    frame.js           # frame differencing, ImageData helpers
  tools/
    elbow-angle.js     # pose module
    reaction-time.js   # motion/timer module
    video-delay.js      # ring-buffer delay module
    ghost.js            # record/store/upload/compare two clips, sync + overlay
```


- **No build step.** Plain ES modules (`<script type="module">`) or classic scripts loaded in
  order. External deps (tfjs, pose-detection) loaded from CDN via `<script>` tags.
- **Shared camera layer** (`camera.js`): enumerate `navigator.mediaDevices.enumerateDevices()`,
  request streams, expose a camera picker. All tools consume a stream from this layer so a
  single camera is shared and switching is consistent.
- **Tool contract:** each tool exposes `{ init(container, stream), start(), stop(), dispose() }`.
  `app.js` mounts one tool at a time into the workspace and calls `stop()/dispose()` on the
  previous tool to release canvas/animation loops.
- All heavy work runs on `requestAnimationFrame` loops; tools must cancel their RAF handle on
  `stop()`.

## 4. Conventions

- Language: UI text in **English** (the reference snippets mix Swedish/English; keep the
  shipped UI English for consistency, comments may be English).
- No external services, no telemetry, no network calls beyond CDN script loads.
- No dependencies beyond what the reference already uses (tfjs, pose-detection). Do not add
  frameworks (React/Vue) or bundlers. The ghost module uses only the browser-native
  `MediaRecorder`, `<video>`, `<canvas>`, and File APIs.
- Keep each module focused and small. Reuse `utils/math.js` for angle calc, `utils/frame.js`
  for motion detection.
- Permissions: camera access requires a **secure context** (https or `file://` is allowed for
  `getUserMedia` in most browsers, but `localhost` is the safe test path). Document this in
  the README.
- Errors: surface `getUserMedia`/model-load failures to the user in the UI, not just console.

## 5. Build & Run

- Open `index.html` directly, or serve locally:
  ```bash
  python3 -m http.server 8000   # then visit http://localhost:8000
  ```
- There is no test suite or lint config yet. When adding one, prefer plain tooling
  (e.g. ESLint flat config) and keep it optional so the no-build property is preserved.

## 6. Out of Scope (for now)
- Server-side processing, cloud upload, saving recordings to disk.
- Multi-user / accounts.
- Non-camera video file sources (could be a future enhancement).

## 7. Open Decisions
- Exact ring-buffer frame rate for the delay module (start with ~10–15 fps snapshots).
- Whether to support simultaneous multi-camera in v1 or defer to a later milestone
  (current plan: single active camera per tool in v1, multi-camera layout as a follow-up).
