# VideoAnalytic

A standalone, client-side sports performance video analytics app. Runs entirely in the browser
from a single HTML page — no server, no build step. Supports one or multiple USB cameras.

## Tools

- **🦾 Elbow Angle** — TensorFlow.js MoveNet pose estimation; tracks shoulder–elbow–wrist and
  shows the joint angle live, with min/max tracking.
- **⚡ Reaction Time** — Two trigger lines on the canvas. Move into the START line to begin the
  timer, the STOP line to end it; reports latest, average, and best.
- **⏱️ Video Delay** — Replays the camera feed delayed by a configurable 10–30 seconds via a
  frame ring buffer, for technique self-review.

## Run locally

Camera access requires a secure context. Use one of:

```bash
# Option A: just open the file (works in most browsers)
open index.html

# Option B: serve locally (recommended)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Allow camera access when prompted. Use the camera dropdown to pick a USB camera.

## View online

Deployed to GitHub Pages on every push to `main`:

**https://jonaswillen.github.io/VideoAnalytic/**

(The deploy workflow lives in `.github/workflows/deploy.yml`. After the first push, enable
Pages in repo Settings → Pages → Source: **GitHub Actions**.)

## Architecture

```
index.html              # entry — app shell, loads CDN deps (tfjs, pose-detection) + app.js
css/style.css           # app shell + tool layout
js/app.js               # router: tool selection + camera lifecycle
js/camera.js            # shared camera layer (enumerate devices, getUserMedia)
js/utils/math.js        # angle calc helpers
js/utils/frame.js        # frame differencing / motion detection
js/tools/elbow-angle.js  # pose module
js/tools/reaction-time.js # motion/timer module
js/tools/video-delay.js  # ring-buffer delay module
```

See `agentic.md` for the full design spec.

## Notes

- The delay module uses a frame ring buffer for precise, adjustable delay rather than
  `MediaRecorder` blob-chunking (which has coarse, variable latency).
- All processing is on-device; no video leaves the browser.
